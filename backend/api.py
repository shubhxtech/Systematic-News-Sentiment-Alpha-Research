import copy
import json
import os
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import requests

import catalysts
import earnings
import market_data as md
import premomentum
import state
from news import fetch_news

MAX_BODY = 20 * 1024 * 1024  # uploads are CSV text; 20 MB is plenty


class JSONEncoderExt(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer): return int(obj)
        if isinstance(obj, np.floating): return None if np.isnan(obj) or np.isinf(obj) else float(obj)
        if isinstance(obj, np.bool_): return bool(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        if isinstance(obj, (pd.Timestamp,)): return obj.isoformat()
        if isinstance(obj, (pd.DataFrame, pd.Series)): return None  # internal caches are not API data
        return str(obj)


def _profile_for(symbol=None, isin=None, bse=None):
    """Name, ISIN, revenue and market cap for a company, from the instrument + fundamentals masters."""
    symbol = (symbol or "").upper() or None
    try:
        instr = md.load_instruments()
    except Exception:
        instr = {"nse": {}, "bse": {}, "nse_rev": {}}
    if not isin and symbol:
        isin = instr.get("nse_rev", {}).get(symbol)
    if not isin and bse:
        isin = (instr["bse"].get(str(bse)) or {}).get("isin")
    if isin and not symbol:
        symbol = instr["nse"].get(isin)
    out = {"symbol": symbol, "isin": isin, "bse_code": bse}
    m = earnings.load_master()
    hit = m[m["ISIN Code"] == isin] if isin else m.iloc[0:0]
    if hit.empty and symbol:
        hit = m[m["NSE Code"].astype(str).str.upper() == symbol]
    if not hit.empty:
        f = hit.iloc[-1]
        sales_q = earnings._num(f.get("Sales latest quarter"))
        out.update(name=f.get("Name"), annual_revenue_cr=sales_q * 4 if sales_q else None,
                   market_cap_cr=earnings._num(f.get("Market Capitalization")),
                   bse_code=out["bse_code"] or (int(f["BSE Code"]) if pd.notna(f.get("BSE Code")) else None))
    if isin:  # the exchange name ("Chennai Petroleum Corporation") searches better than "C P C L"
        for code, b in instr["bse"].items():
            if b.get("isin") == isin:
                if b.get("name"):
                    out["short_name"] = out.get("name")
                    out["name"] = _title(b["name"])
                out["bse_code"] = out["bse_code"] or code
                break
    return out


def _title(name):
    n = name.strip().rstrip(".")
    return n.title() if n.isupper() else n


class LiveAPIHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ── plumbing ───────────────────────────────────────────────────────────
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin:
            host = urlparse(origin).hostname or ""
            if host in ("localhost", "127.0.0.1", "::1"):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Credentials", "true")
                self.send_header("Vary", "Origin")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send(self, body, code=200, ctype="application/json", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(json.dumps(obj, cls=JSONEncoderExt, allow_nan=False) if not _has_nan(obj)
                   else json.dumps(_nan_to_none(obj), cls=JSONEncoderExt), code)

    def _err(self, msg, code=400):
        self._json({"error": msg}, code)

    def _query(self):
        q = urllib.parse.parse_qs(urlparse(self.path).query)
        return lambda k, d="": (q.get(k) or [d])[0].strip()

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("bad Content-Length")
        if n > MAX_BODY:
            raise ValueError("request body too large")
        raw = self.rfile.read(n) if n > 0 else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"invalid JSON: {e.msg}")
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object")
        return data

    def _run(self, fn):
        try:
            fn()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            traceback.print_exc()
            try:
                self._err(f"internal error: {type(e).__name__}: {e}", 500)
            except Exception:
                pass

    def log_message(self, format, *args):
        pass

    # ── POST ───────────────────────────────────────────────────────────────
    def do_POST(self):
        self._run(self._post)

    def _post(self):
        path = urlparse(self.path).path
        try:
            payload = self._body()
        except ValueError as e:
            return self._err(str(e), 400)

        if path == "/api/earnings/upload":
            text = payload.get("csv", "")
            if not isinstance(text, str) or not text.strip():
                return self._err("empty CSV")
            try:
                earnings.parse_board_meetings(text)  # fail fast on bad format
            except Exception as e:
                return self._err(str(e))
            return self._json({"job_id": earnings.start_job(text, str(payload.get("filename") or "upload.csv"))})

        if path == "/api/earnings/fundamentals":
            try:
                return self._json(earnings.merge_fundamentals_csv(payload.get("csv", "")))
            except Exception as e:
                return self._err(str(e))

        if path == "/api/premomentum/scan":
            try:
                days = int(payload.get("days_ahead", 30))
                top_k = int(payload.get("top_k", 60))
            except (TypeError, ValueError):
                return self._err("days_ahead and top_k must be integers")
            days, top_k = min(max(days, 3), 60), min(max(top_k, 5), 200)
            return self._json({"job_id": premomentum.start(days, top_k)})

        if path in ("/api/start-sim", "/api/stop-sim"):
            return self._json({"status": "ok", "msg": "Backtesting removed"})

        if path == "/api/set-fundamental-filter":
            try:
                with state.state_lock:
                    if "min_score" in payload:
                        state.APP_STATE["fundamental_min_score"] = int(payload["min_score"])
                    return self._json({"status": "ok", "fundamental_min_score": state.APP_STATE["fundamental_min_score"]})
            except (TypeError, ValueError) as e:
                return self._err(str(e))

        if path == "/api/settings/upstox-token":
            token = payload.get("token", "")
            if not isinstance(token, str):
                return self._err("token must be a string")
            token = token.strip()
            state.UPSTOX_TOKEN = token
            token_file = state.STATIC_DIR / ".upstox_token"
            if token:
                fd = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w") as f:
                    f.write(token)
            elif token_file.exists():
                token_file.unlink()
            return self._json({"status": "ok", "has_upstox_token": bool(token)})

        return self._err("Not Found", 404)

    # ── GET ────────────────────────────────────────────────────────────────
    def do_GET(self):
        self._run(self._get)

    def _get(self):
        url = urlparse(self.path)
        path = url.path
        q = self._query()

        if path == "/api/health":
            return self._json({"status": "ok"})

        # earnings screen
        if path == "/api/earnings/status":
            job = earnings.get_job(q("id"))
            return self._json(job or {"error": "unknown job", "status": "unknown"}, 200 if job else 404)
        if path == "/api/earnings/runs":
            return self._json(earnings.list_runs())
        if path == "/api/earnings/results":
            return self._results(earnings.read_run, q, "earnings_screen")

        # pre-results momentum
        if path == "/api/premomentum/status":
            job = premomentum.get_job(q("id"))
            return self._json(job or {"error": "unknown job", "status": "unknown"}, 200 if job else 404)
        if path == "/api/premomentum/active":
            return self._json(premomentum.active_job() or {"status": "idle"})
        if path == "/api/premomentum/runs":
            return self._json(premomentum.list_runs())
        if path == "/api/premomentum/results":
            return self._results(premomentum.read_run, q, "premomentum")

        # catalyst intelligence for one company
        if path == "/api/catalysts":
            return self._catalysts(q)

        if path == "/api/instrument":
            prof = _profile_for(q("symbol"), q("isin") or None, q("bse") or None)
            if not prof.get("isin"):
                return self._err("unknown instrument", 404)
            seg = "NSE_EQ" if prof.get("symbol") else "BSE_EQ"
            return self._json({**prof, "key": f"{seg}|{prof['isin']}"})

        if path == "/api/candles":
            prof = _profile_for(q("symbol"), q("isin") or None)
            if not prof.get("isin"):
                return self._err("unknown instrument", 404)
            try:
                days = min(max(int(q("days", "400")), 30), 1100)
            except ValueError:
                days = 400
            df, seg = md.equity_candles(prof["isin"], days=days)
            if df is None:
                return self._err("no candle data", 502)
            rows = [{"date": t.strftime("%Y-%m-%dT00:00:00+05:30"), "open": r.o, "high": r.h, "low": r.l,
                     "close": r.c, "volume": r.v} for t, r in df.iterrows()]
            return self._json({"symbol": prof.get("symbol"), "isin": prof["isin"], "segment": seg,
                               "name": prof.get("name"), "candles": rows})

        if path == "/api/news":
            query = q("q", "Indian Stock Market") or "Indian Stock Market"
            ticker = q("ticker")
            articles = fetch_news(query, ticker)
            try:
                articles = catalysts.analyse(articles, company_name=query if ticker else "")
            except Exception:
                traceback.print_exc()  # classification is an enhancement; never fail the feed over it
            return self._json(articles)

        # legacy / stub endpoints kept for older UI code
        if path == "/api/sentiment/summary":
            return self._json({})
        if path.startswith("/api/sentiment/"):
            return self._json({"series": []})
        if path in ("/api/transcript-signals", "/api/insider-signals"):
            return self._json([])
        if path == "/api/regime-status":
            return self._json({"current_regime": "N/A", "confidence": 0, "history": []})
        if path in ("/api/optimal-config", "/api/tearsheet", "/api/signals-db", "/api/trade-journal"):
            return self._json({})

        if path == "/api/factor-scores":
            with state.state_lock:
                df = state.APP_STATE.get("factor_scores")
                data = df.to_dict(orient="index") if isinstance(df, pd.DataFrame) and not df.empty else {}
            return self._json(data)

        if path == "/api/fundamentals":
            with state.state_lock:
                fc = copy.deepcopy(state.APP_STATE.get("fundamental_cache") or {})
                min_score = state.APP_STATE.get("fundamental_min_score", 45)
            return self._json({"min_score": min_score, "loaded": len(fc) > 0, "stocks": fc})

        if path == "/api/settings/status":
            return self._json({"has_upstox_token": bool(state.UPSTOX_TOKEN)})

        if path == "/api/live-state":
            with state.state_lock:
                # Skip the price-cache DataFrames: they are large and not JSON.
                data = {k: copy.deepcopy(v) for k, v in state.APP_STATE.items()
                        if not isinstance(v, (pd.DataFrame, pd.Series))}
            data["timeline_bounds"] = {"min": "2024-01-01", "max": "2024-12-31"}
            data["regime"] = "N/A"
            return self._json(data)

        if path.startswith("/upstox-api/"):
            return self._proxy_upstox(url)

        return self._err("Not Found", 404)

    # ── helpers ────────────────────────────────────────────────────────────
    def _results(self, reader, q, name):
        fmt = q("format", "json")
        if fmt not in ("json", "csv"):
            return self._err("format must be json or csv")
        body = reader(q("run", "latest") or "latest", fmt)
        if body is None:
            return self._err("no results yet", 404)
        extra = {"Content-Disposition": f'attachment; filename="{name}.{fmt}"'} if q("download") else None
        self._send(body, 200, "text/csv; charset=utf-8" if fmt == "csv" else "application/json", extra)

    def _catalysts(self, q):
        prof = _profile_for(q("symbol"), q("isin") or None, q("bse") or None)
        if not prof.get("isin") and not prof.get("symbol"):
            return self._err("unknown company", 404)
        try:
            days = min(max(int(q("days", "45")), 7), 365)
        except ValueError:
            days = 45
        notes = []
        raw = []
        if prof.get("symbol"):
            filings = md.nse_announcements(prof["symbol"], days)
            if not filings:
                notes.append("no NSE filings returned (none in window, or nseindia.com unreachable)")
            raw += filings
        elif prof.get("bse_code"):
            raw += md.bse_announcements(prof["bse_code"], days)
        if q("news", "1") != "0":
            name = prof.get("name") or prof.get("symbol") or ""
            try:
                arts = fetch_news(name, prof.get("symbol") or "", max_age_h=days * 24)
                for a in arts:
                    a.setdefault("source_type", "media")
                raw += arts
            except Exception as e:
                notes.append(f"news unavailable: {e}")
        df = md.equity_candles(prof["isin"], days=400)[0] if prof.get("isin") else None
        items = catalysts.analyse(raw, prof.get("name") or "", prof.get("annual_revenue_cr"),
                                  prof.get("market_cap_cr"), df)
        if q("include_routine", "0") != "1":
            items = [i for i in items if i["event_type"] != "routine"]
        return self._json({"profile": prof, "summary": catalysts.summarise(items), "items": items, "notes": notes})

    def _proxy_upstox(self, url):
        upstream_path = url.path[len("/upstox-api"):]
        if ".." in upstream_path or not upstream_path.startswith("/v"):
            return self._err("bad path", 400)
        public = "/historical-candle/" in upstream_path  # Upstox serves these without auth
        if not state.UPSTOX_TOKEN and not public:
            return self._err("Missing Upstox Token", 401)
        target = "https://api.upstox.com" + upstream_path + (f"?{url.query}" if url.query else "")
        headers = {"Accept": "application/json", "Api-Version": "2.0", **md.UA}
        if state.UPSTOX_TOKEN:
            headers["Authorization"] = f"Bearer {state.UPSTOX_TOKEN}"
        try:
            resp = requests.get(target, headers=headers, timeout=15)
            if resp.status_code == 401 and public and "Authorization" in headers:
                headers.pop("Authorization")  # expired token: public data still works without it
                resp = requests.get(target, headers=headers, timeout=15)
        except requests.RequestException as e:
            return self._err(f"upstream error: {e}", 502)
        self._send(resp.content, resp.status_code, resp.headers.get("Content-Type", "application/json"))


def _has_nan(o):
    if isinstance(o, float):
        return o != o or o in (float("inf"), float("-inf"))
    if isinstance(o, dict):
        return any(_has_nan(v) for v in o.values())
    if isinstance(o, (list, tuple)):
        return any(_has_nan(v) for v in o)
    return False


def _nan_to_none(o):
    if isinstance(o, float) and (o != o or o in (float("inf"), float("-inf"))):
        return None
    if isinstance(o, dict):
        return {k: _nan_to_none(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_nan_to_none(v) for v in o]
    return o

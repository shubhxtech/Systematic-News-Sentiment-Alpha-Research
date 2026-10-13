"""Earnings-momentum pipeline.

Upload a board-meeting CSV -> resolve each company (BSE code -> ISIN -> NSE symbol)
-> attach fundamentals (master CSV, yfinance fallback) -> attach price/volume
indicators (Upstox candles) -> score -> save JSON + CSV under data/earnings/.
"""
import gzip
import io
import json
import math
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

import state

try:
    import yfinance as yf
except ImportError:
    yf = None

DATA_DIR = Path(__file__).parent / "data"
EARN_DIR = DATA_DIR / "earnings"
MASTER_CSV = DATA_DIR / "fundamentals_master.csv"
INSTR_CACHE = DATA_DIR / "instruments_eq.json"
INSTR_URL = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
UA = {"User-Agent": "Mozilla/5.0"}
KEEP_RUNS = 20

FUND_COLS = [
    "Industry Group", "Industry", "Current Price", "Price to Earning", "Market Capitalization",
    "Dividend yield", "Net Profit latest quarter", "YOY Quarterly profit growth",
    "Sales latest quarter", "YOY Quarterly sales growth", "Return on capital employed",
    "PEG Ratio", "CFO by PAT", "Debt to equity", "OPM", "Change in FII holding",
]

JOBS = {}
JOBS_LOCK = threading.Lock()


# ── helpers ────────────────────────────────────────────────────────────────
def _clean(v):
    """Make a value JSON-safe (NaN/inf -> None, numpy -> python)."""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if (math.isnan(v) or math.isinf(v)) else round(float(v), 4)
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d")
    if v is pd.NaT or (not isinstance(v, str) and pd.isna(v)):
        return None
    return v


def _clip01(x, lo, hi):
    return float(np.clip((x - lo) / (hi - lo), 0, 1))


def _set_job(job_id, **kw):
    with JOBS_LOCK:
        JOBS[job_id].update(kw)


# ── 1. parse board-meeting CSV ─────────────────────────────────────────────
def parse_board_meetings(text):
    """Tolerates trailing commas (BSE exports) and several date formats."""
    df = pd.read_csv(io.StringIO(text), index_col=False, dtype=str)
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]
    df.columns = [c.strip() for c in df.columns]
    low = {c.lower(): c for c in df.columns}

    def col(*names):
        for n in names:
            if n in low:
                return low[n]
        return None

    c_code = col("security code", "bse code", "scrip code", "code")
    c_name = col("company name", "company", "name")
    c_date = col("meeting date", "result date", "date", "board meeting date")
    if not c_code or not c_date:
        raise ValueError(
            "CSV needs a 'Security Code' (BSE code) column and a 'Meeting Date' column. "
            f"Found: {list(df.columns)}"
        )
    c_ind, c_purpose = col("industry"), col("purpose")

    out = pd.DataFrame({
        "bse_code": pd.to_numeric(df[c_code], errors="coerce"),
        "company": df[c_name].str.strip() if c_name else "",
        "bm_industry": df[c_ind].str.strip() if c_ind else "",
        "purpose": df[c_purpose].str.strip() if c_purpose else "",
    })
    d = pd.to_datetime(df[c_date], format="%d %b %Y", errors="coerce")
    miss = d.isna()
    if miss.any():
        d[miss] = pd.to_datetime(df.loc[miss, c_date], dayfirst=True, errors="coerce")
    out["result_date"] = d
    bad = int(out.bse_code.isna().sum() + out.result_date.isna().sum())
    out = out.dropna(subset=["bse_code", "result_date"])
    out["bse_code"] = out.bse_code.astype(int)
    before = len(out)
    out = out.sort_values("result_date").drop_duplicates(["bse_code", "result_date"])
    return out.reset_index(drop=True), {"rows_read": len(df), "rows_unparseable": bad,
                                        "duplicates_removed": before - len(out)}


# ── 2. instrument resolution ───────────────────────────────────────────────
def load_instruments():
    """BSE scrip code -> ISIN/name, ISIN -> NSE symbol. Cached for 24h."""
    if INSTR_CACHE.exists() and time.time() - INSTR_CACHE.stat().st_mtime < 86400:
        return json.loads(INSTR_CACHE.read_text())
    r = requests.get(INSTR_URL, headers=UA, timeout=60)
    r.raise_for_status()
    raw = json.loads(gzip.decompress(r.content))
    bse, nse = {}, {}
    for x in raw:
        if x.get("segment") == "BSE_EQ" and x.get("instrument_type") != "F":
            bse[str(x["exchange_token"])] = {"isin": x.get("isin"), "bse_symbol": x.get("trading_symbol"),
                                              "name": x.get("name")}
        elif x.get("segment") == "NSE_EQ" and x.get("instrument_type") == "EQ":
            nse[x["isin"]] = x["trading_symbol"]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data = {"bse": bse, "nse": nse}
    INSTR_CACHE.write_text(json.dumps(data))
    return data


# ── 3. fundamentals ────────────────────────────────────────────────────────
def load_master():
    if not MASTER_CSV.exists():
        return pd.DataFrame(columns=["Name", "BSE Code", "NSE Code", "ISIN Code"] + FUND_COLS)
    m = pd.read_csv(MASTER_CSV)
    m["BSE Code"] = pd.to_numeric(m["BSE Code"], errors="coerce").astype("Int64")
    return m


def merge_fundamentals_csv(text):
    """Upsert a Screener-style fundamentals CSV into the master (keyed by ISIN)."""
    new = pd.read_csv(io.StringIO(text), index_col=False)
    new = new.loc[:, ~new.columns.str.startswith("Unnamed")]
    if "ISIN Code" not in new.columns:
        raise ValueError("fundamentals CSV needs an 'ISIN Code' column")
    new = new.dropna(subset=["ISIN Code"]).drop_duplicates("ISIN Code", keep="last")
    old = load_master()
    keep = old[~old["ISIN Code"].isin(new["ISIN Code"])]
    merged = pd.concat([keep, new], ignore_index=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    merged.to_csv(MASTER_CSV, index=False)
    return {"added_or_updated": len(new), "total": len(merged)}


def _yf_fundamentals(nse_symbol, bse_symbol):
    """Fallback for names missing from the master. Only fields yfinance really has."""
    if yf is None:
        return None
    for suffix, sym in ((".NS", nse_symbol), (".BO", bse_symbol)):
        if not sym:
            continue
        try:
            i = yf.Ticker(sym + suffix).info
            if not i or (i.get("currentPrice") is None and i.get("regularMarketPrice") is None):
                continue
            mc = i.get("marketCap")
            g = lambda k, f=1: (i[k] * f) if i.get(k) is not None else None
            return {
                "Current Price": i.get("currentPrice") or i.get("regularMarketPrice"),
                "Price to Earning": i.get("trailingPE"),
                "Market Capitalization": mc / 1e7 if mc else None,  # ₹ crore, as in master
                "Debt to equity": g("debtToEquity", 0.01),
                "OPM": g("operatingMargins", 100),
                "YOY Quarterly profit growth": g("earningsQuarterlyGrowth", 100),
                "YOY Quarterly sales growth": g("revenueGrowth", 100),
                "Industry": i.get("industry"),
            }
        except Exception:
            continue
    return None


# ── 4. price data ──────────────────────────────────────────────────────────
def fetch_candles(isin, days=600):
    """Public Upstox historical-candle endpoint (daily, no auth needed)."""
    to = datetime.now().strftime("%Y-%m-%d")
    frm = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    url = f"https://api.upstox.com/v2/historical-candle/NSE_EQ%7C{isin}/day/{to}/{frm}"
    for attempt in range(3):
        try:
            r = requests.get(url, headers=UA, timeout=20)
            if r.status_code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            r.raise_for_status()
            c = r.json()["data"]["candles"]
            df = pd.DataFrame(c, columns=["t", "o", "h", "l", "c", "v", "oi"])
            df["t"] = pd.to_datetime(df.t, utc=True).dt.tz_convert(None).dt.normalize()
            return df.sort_values("t").set_index("t")
        except Exception:
            time.sleep(0.5)
    return None


def fetch_ltp(isins):
    """Live last price via the user's Upstox token, if configured. {isin: ltp}"""
    if not state.UPSTOX_TOKEN or not isins:
        return {}
    out = {}
    h = {"Authorization": f"Bearer {state.UPSTOX_TOKEN}", "Accept": "application/json", **UA}
    for i in range(0, len(isins), 400):
        chunk = isins[i:i + 400]
        keys = ",".join("NSE_EQ|" + x for x in chunk)
        try:
            r = requests.get("https://api.upstox.com/v2/market-quote/ltp", params={"instrument_key": keys},
                             headers=h, timeout=20)
            if r.ok:
                for v in r.json().get("data", {}).values():
                    tok = v.get("instrument_token", "")
                    out[tok.split("|")[-1]] = v.get("last_price")
        except Exception:
            pass
    return out


def price_features(df, trading_days_left):
    c = df.c
    n = len(c)
    ret = lambda k: float(c.iloc[-1] / c.iloc[-1 - k] - 1) if n > k else None
    lr = np.log(c).diff()
    f = {
        "last_close": float(c.iloc[-1]), "last_candle_date": c.index[-1].strftime("%Y-%m-%d"),
        "ret_5d": ret(5), "ret_20d": ret(20), "ret_60d": ret(60),
        "pct_of_52w_high": float(c.iloc[-1] / c.tail(250).max()),
        "vol_ann": float(lr.tail(60).std() * np.sqrt(250)) if n > 20 else None,
        "vol_ratio_5v60": float(df.v.tail(5).mean() / df.v.tail(60).mean()) if df.v.tail(60).mean() else None,
        "adv20_cr": float((df.c * df.v).tail(20).mean() / 1e7),
        "above_50dma": bool(c.iloc[-1] > c.tail(50).mean()) if n >= 50 else None,
        "history_days": n,
    }
    # Unconditional base rate: how often did THIS stock touch +10% / close -10% within h days?
    # Descriptive history only — not a forecast, and biased by the stock's own trend.
    h = 7 if trading_days_left <= 9 else 15
    if n > h + 30:
        fwd_max = pd.concat([c.shift(-k) for k in range(1, h + 1)], axis=1).max(axis=1) / c - 1
        fwd_end = c.shift(-h) / c - 1
        ok = fwd_end.dropna().index
        f["base_window_days"] = h
        f["base_touch_10pct"] = float((fwd_max.loc[ok] >= 0.10).mean())
        f["base_close_below_m10pct"] = float((fwd_end.loc[ok] <= -0.10).mean())
    return f


# ── 5. scoring ─────────────────────────────────────────────────────────────
def _wavg(parts):
    """Weighted mean over components that actually have data. parts: [(weight, value|None)]."""
    have = [(w, v) for w, v in parts if v is not None]
    if not have:
        return None
    return sum(w * v for w, v in have) / sum(w for w, _ in have)


def score_row(r):
    nz = lambda k: None if r.get(k) is None or pd.isna(r.get(k)) else float(r[k])
    pg, sg = nz("YOY Quarterly profit growth"), nz("YOY Quarterly sales growth")
    growth = _wavg([
        (.5, None if pg is None else _clip01(math.log1p(max(min(pg, 300), -90) / 100), 0, 1.4)),
        (.5, None if sg is None else _clip01(sg, 0, 60))])
    roce, opm, cfo = nz("Return on capital employed"), nz("OPM"), nz("CFO by PAT")
    quality = _wavg([
        (.4, None if roce is None else _clip01(roce, 10, 35)),
        (.3, None if opm is None else _clip01(opm, 8, 30)),
        (.3, None if cfo is None else _clip01(cfo, 0, 1))])
    de = nz("Debt to equity")
    balance = None if de is None else _clip01(1.5 - de, 0, 1.5)
    pe, peg = nz("Price to Earning"), nz("PEG Ratio")
    value = _wavg([
        (.5, None if pe is None else (0.0 if pe <= 0 else _clip01(60 - pe, 0, 50))),
        (.5, None if peg is None else _clip01(2.5 - peg, 0, 2))])
    fii = nz("Change in FII holding")
    fii_s = None if fii is None else _clip01(fii, 0, 2)
    liq = _clip01(math.log10(max(r["adv20_cr"], .1)), .3, 2) if r.get("adv20_cr") is not None else None
    core = any(v is not None for v in (growth, quality, value))
    fund = _wavg([(.30, growth), (.25, quality), (.10, balance), (.15, value), (.10, fii_s), (.10, liq)])
    fund = 100 * fund if (fund is not None and core) else None  # liquidity alone is not a score

    r60 = r.get("ret_60d")
    tech = None
    if r60 is not None and not pd.isna(r60):
        tech = 100 * _wavg([
            (.4, None if r.get("above_50dma") is None else float(r["above_50dma"])),
            (.3, _clip01(r60, -.1, .3)),
            (.3, 1 - _clip01(r60, .4, .8))])  # penalise crowded, already-extended runs
    comp = None
    if fund is not None:
        comp = (.7 * fund + .3 * tech) if tech is not None else fund * .85
        if r["trading_days_left"] < 5:
            comp -= 15   # too little time for a 10-20% pre-result drift
        if r.get("adv20_cr") is not None and r["adv20_cr"] < 10:
            comp -= 10   # illiquid
    return fund, tech, comp


def flags(r):
    out = []
    if r["fundamentals_source"] == "none":
        out.append("no fundamentals")
    if r["fundamentals_source"] == "yfinance":
        out.append("partial fundamentals (no ROCE/FII/CFO)")
    g = r.get("YOY Quarterly profit growth")
    if g is not None and g > 500:
        out.append("profit growth >500%: low base / one-off likely")
    if r["trading_days_left"] < 5:
        out.append("<5 trading days to result")
    if r.get("adv20_cr") is not None and r["adv20_cr"] < 10:
        out.append("illiquid (<₹10cr/day)")
    if r.get("pct_of_52w_high") and r["pct_of_52w_high"] > .97 and (r.get("ret_60d") or 0) > .4:
        out.append("extended: near 52w high after >40% run")
    if r.get("history_days") and r["history_days"] < 120:
        out.append("short price history")
    return "; ".join(out)


# ── 6. pipeline ────────────────────────────────────────────────────────────
def run_pipeline(job_id, csv_text, filename="upload.csv", use_yfinance=True):
    try:
        today = pd.Timestamp(datetime.now().date())
        _set_job(job_id, stage="parsing", done=0, total=0)
        meetings, parse_info = parse_board_meetings(csv_text)
        meetings = meetings[meetings.result_date >= today]
        parse_info["past_dates_dropped"] = parse_info["rows_read"] - len(meetings) - parse_info["rows_unparseable"] \
            - parse_info["duplicates_removed"]

        _set_job(job_id, stage="resolving symbols")
        instr = load_instruments()
        master = load_master()
        by_isin = {r["ISIN Code"]: r for _, r in master.iterrows() if pd.notna(r["ISIN Code"])}
        by_bse = {int(r["BSE Code"]): r for _, r in master.iterrows() if pd.notna(r["BSE Code"])}

        rows = []
        for _, m in meetings.iterrows():
            ins = instr["bse"].get(str(m.bse_code), {})
            isin = ins.get("isin")
            nse = instr["nse"].get(isin) if isin else None
            f = by_isin.get(isin) if isin else None
            if f is None:
                f = by_bse.get(m.bse_code)
            row = {
                "company": m.company, "bse_code": m.bse_code, "nse_symbol": nse or (f["NSE Code"] if f is not None and pd.notna(f["NSE Code"]) else None),
                "bse_symbol": ins.get("bse_symbol"), "isin": isin or (f["ISIN Code"] if f is not None else None),
                "board_meeting_industry": m.bm_industry, "result_date": m.result_date,
                "trading_days_left": int(np.busday_count(today.date(), m.result_date.date())),
                "days_left": int((m.result_date - today).days),
                "fundamentals_source": "none",
            }
            if f is not None:
                row["fundamentals_source"] = "master"
                for c in FUND_COLS:
                    row[c] = f.get(c)
            rows.append(row)

        # fundamentals fallback (parallel, best effort)
        if use_yfinance and yf is not None:
            todo = [r for r in rows if r["fundamentals_source"] == "none"]
            _set_job(job_id, stage="fundamentals fallback (yfinance)", done=0, total=len(todo))
            def fb(r):
                return r, _yf_fundamentals(r["nse_symbol"], r["bse_symbol"])
            with ThreadPoolExecutor(4) as ex:
                for k, (r, got) in enumerate(ex.map(fb, todo), 1):
                    if got:
                        r.update(got)
                        r["fundamentals_source"] = "yfinance"
                    _set_job(job_id, done=k)

        # prices
        priced = [r for r in rows if r["isin"] and r["nse_symbol"]]
        _set_job(job_id, stage="prices (Upstox)", done=0, total=len(priced))
        def px(r):
            time.sleep(0.15)
            return r, fetch_candles(r["isin"])
        with ThreadPoolExecutor(3) as ex:
            for k, (r, df) in enumerate(ex.map(px, priced), 1):
                if df is not None and len(df) > 20:
                    r.update(price_features(df, r["trading_days_left"]))
                _set_job(job_id, done=k)

        _set_job(job_id, stage="live quotes")
        ltp = fetch_ltp([r["isin"] for r in priced])
        for r in rows:
            r["ltp"] = ltp.get(r["isin"]) or r.get("last_close") or r.get("Current Price")
            r["ltp_source"] = "upstox_live" if ltp.get(r["isin"]) else ("upstox_candle" if r.get("last_close") else "fundamentals_csv")

        _set_job(job_id, stage="scoring")
        for r in rows:
            r["fund_score"], r["tech_score"], r["composite"] = score_row(r)
            r["flags"] = flags(r)
        rows.sort(key=lambda r: (r["composite"] is None, -(r["composite"] or 0)))
        for i, r in enumerate(rows, 1):
            r["rank"] = i if r["composite"] is not None else None

        clean = [{k: _clean(v) for k, v in r.items()} for r in rows]
        summary = {
            **parse_info, "meetings_upcoming": len(rows),
            "with_fundamentals": sum(r["fundamentals_source"] != "none" for r in rows),
            "from_master": sum(r["fundamentals_source"] == "master" for r in rows),
            "from_yfinance": sum(r["fundamentals_source"] == "yfinance" for r in rows),
            "with_prices": sum(r.get("last_close") is not None for r in rows),
            "scored": sum(r["composite"] is not None for r in rows),
            "live_quotes": bool(ltp), "yfinance_available": yf is not None,
        }
        run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_run(run_id, {"run_id": run_id, "generated_at": datetime.now().isoformat(timespec="seconds"),
                          "source_file": filename, "summary": summary, "rows": clean})
        _set_job(job_id, stage="done", status="done", run_id=run_id, summary=summary)
    except Exception as e:
        _set_job(job_id, status="error", error=str(e))


def save_run(run_id, payload):
    d = EARN_DIR / run_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "results.json").write_text(json.dumps(payload, indent=1))
    pd.DataFrame(payload["rows"]).to_csv(d / "results.csv", index=False)
    (EARN_DIR / "latest.json").write_text(json.dumps(payload, indent=1))
    pd.DataFrame(payload["rows"]).to_csv(EARN_DIR / "latest.csv", index=False)
    runs = sorted(p for p in EARN_DIR.iterdir() if p.is_dir())
    for old in runs[:-KEEP_RUNS]:
        for f in old.iterdir():
            f.unlink()
        old.rmdir()


def start_job(csv_text, filename):
    job_id = uuid.uuid4().hex[:8]
    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "status": "running", "stage": "queued", "done": 0, "total": 0}
    threading.Thread(target=run_pipeline, args=(job_id, csv_text, filename), daemon=True).start()
    return job_id


def get_job(job_id):
    with JOBS_LOCK:
        return dict(JOBS.get(job_id) or {})


def list_runs():
    if not EARN_DIR.exists():
        return []
    out = []
    for d in sorted((p for p in EARN_DIR.iterdir() if p.is_dir()), reverse=True):
        try:
            j = json.loads((d / "results.json").read_text())
            out.append({"run_id": d.name, "generated_at": j["generated_at"], "source_file": j["source_file"],
                        "rows": len(j["rows"])})
        except Exception:
            pass
    return out


def read_run(run_id="latest", fmt="json"):
    if run_id != "latest" and not re.fullmatch(r"\d{8}_\d{6}", run_id):
        return None
    p = (EARN_DIR / f"latest.{fmt}") if run_id == "latest" else (EARN_DIR / run_id / f"results.{fmt}")
    return p.read_bytes() if p.exists() else None

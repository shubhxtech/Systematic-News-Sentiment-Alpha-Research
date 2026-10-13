import json
import copy
import datetime
import email.utils
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import timezone
import logging
import pandas as pd
import numpy as np
import os
import requests
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

try:
    import yfinance as yf
except ImportError:
    yf = None

import state
import earnings
from data_manager import TICKER_ALIASES

class JSONEncoderExt(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer): return int(obj)
        if isinstance(obj, np.floating): return float(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        return super().default(obj)

class LiveAPIHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin and ("localhost" in origin or "127.0.0.1" in origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, cls=JSONEncoderExt).encode()
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        url = urlparse(self.path)
        payload = {}
        content_length_str = self.headers.get('Content-Length')
        
        if content_length_str:
            content_length = int(content_length_str)
            post_data = self.rfile.read(content_length)
            if post_data:
                payload = json.loads(post_data)

        if url.path == "/api/earnings/upload":
            try:
                text = payload.get("csv", "")
                if not text.strip():
                    return self._json({"error": "empty CSV"}, 400)
                earnings.parse_board_meetings(text)  # fail fast on bad format
                job_id = earnings.start_job(text, payload.get("filename", "upload.csv"))
                return self._json({"job_id": job_id})
            except Exception as e:
                return self._json({"error": str(e)}, 400)

        if url.path == "/api/earnings/fundamentals":
            try:
                return self._json(earnings.merge_fundamentals_csv(payload.get("csv", "")))
            except Exception as e:
                return self._json({"error": str(e)}, 400)

        if url.path in ["/api/start-sim", "/api/stop-sim"]:
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"ok", "msg": "Backtesting removed"}')
            return

        elif url.path == "/api/set-fundamental-filter":
            try:
                with state.state_lock:
                    if "min_score" in payload:
                        state.APP_STATE["fundamental_min_score"] = int(payload["min_score"])
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "fundamental_min_score": state.APP_STATE["fundamental_min_score"]}).encode())
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return
            
        elif url.path == "/api/settings/upstox-token":
            try:
                token = payload.get("token", "")
                state.UPSTOX_TOKEN = token
                token_file = state.STATIC_DIR / ".upstox_token"
                with open(token_file, "w") as f:
                    f.write(token)
                os.chmod(token_file, 0o600)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"status": "ok"}')
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return
            
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "Not Found"}')
            return

    def do_GET(self):
        url = urlparse(self.path)

        if url.path == "/api/earnings/status":
            q = urllib.parse.parse_qs(url.query)
            job = earnings.get_job((q.get("id") or [""])[0])
            return self._json(job or {"error": "unknown job"}, 200 if job else 404)

        if url.path == "/api/earnings/runs":
            return self._json(earnings.list_runs())

        if url.path == "/api/earnings/results":
            q = urllib.parse.parse_qs(url.query)
            fmt = (q.get("format") or ["json"])[0]
            body = earnings.read_run((q.get("run") or ["latest"])[0], fmt) if fmt in ("json", "csv") else None
            if body is None:
                return self._json({"error": "no results yet"}, 404)
            self.send_response(200)
            self.send_header('Content-type', 'text/csv' if fmt == "csv" else 'application/json')
            if q.get("download"):
                self.send_header('Content-Disposition', f'attachment; filename="earnings_screen.{fmt}"')
            self.end_headers()
            self.wfile.write(body)
            return

        if url.path == "/api/sentiment/summary":
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{}')
            return

        if url.path.startswith("/api/sentiment/"):
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"series": []}')
            return

        if url.path in ["/api/transcript-signals", "/api/insider-signals"]:
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'[]')
            return
            
        if url.path == "/api/regime-status":
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"current_regime": "N/A", "confidence": 0, "history": []}')
            return
            
        if url.path == "/api/factor-scores":
            with state.state_lock:
                df = state.APP_STATE.get("factor_scores", pd.DataFrame())
                data = df.to_dict(orient="index") if df is not None and not df.empty else {}
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
            return

        if url.path == "/api/fundamentals":
            with state.state_lock:
                fc = copy.deepcopy(state.APP_STATE.get("fundamental_cache", {}))
                min_score = state.APP_STATE.get("fundamental_min_score", 45)
            out = {"min_score": min_score, "loaded": len(fc) > 0, "stocks": fc}
            payload = json.dumps(out, cls=JSONEncoderExt).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Content-length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if url.path in ["/api/optimal-config", "/api/tearsheet", "/api/signals-db", "/api/trade-journal"]:
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{}')
            return

        if url.path == "/api/settings/status":
            payload = json.dumps({"has_upstox_token": bool(state.UPSTOX_TOKEN)}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Content-length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if url.path == "/api/live-state":
            with state.state_lock:
                data = copy.deepcopy(state.APP_STATE)
                data["timeline_bounds"] = {"min": "2024-01-01", "max": "2024-12-31"}
                data["regime"] = "N/A"
            payload = json.dumps(data, cls=JSONEncoderExt).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Content-length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
            
        if url.path == "/api/news":
            parsed_query = urllib.parse.parse_qs(url.query) if url.query else {}
            query = parsed_query.get("q", ["Indian Stock Market"])[0].strip()
            ticker = parsed_query.get("ticker", [""])[0].strip()

            articles = []
            now = datetime.datetime.now(timezone.utc)

            # 1. Macro market RSS feeds
            if query.lower() in ["indian stock market", "markets", "nifty 50", "sensex", "nifty"]:
                feeds = [
                    ("https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", "Economic Times"),
                    ("https://www.moneycontrol.com/rss/marketreports.xml", "Moneycontrol")
                ]
                for feed_url, default_source in feeds:
                    try:
                        req = urllib.request.Request(feed_url, headers={'User-Agent': 'Mozilla/5.0'})
                        with urllib.request.urlopen(req, timeout=5) as response:
                            root = ET.fromstring(response.read())
                            for item in root.findall('./channel/item')[:15]:
                                title_elem = item.find('title')
                                link_elem = item.find('link')
                                if title_elem is None or not title_elem.text:
                                    continue
                                title = title_elem.text.strip()
                                link = link_elem.text.strip() if link_elem is not None and link_elem.text else ""
                                pub_node = item.find('pubDate')
                                pub_text = pub_node.text.strip() if pub_node is not None and pub_node.text else ""
                                hours_ago = 24.0
                                if pub_text:
                                    try:
                                        dt = email.utils.parsedate_to_datetime(pub_text)
                                        if dt.tzinfo is None:
                                            dt = dt.replace(tzinfo=timezone.utc)
                                        hours_ago = (now - dt).total_seconds() / 3600
                                    except Exception:
                                        hours_ago = 24.0
                                articles.append({"title": title, "link": link, "source": default_source, "hours_ago": hours_ago})
                    except Exception as e:
                        print(f"[News API] Feed error ({default_source}): {e}")

            # 2. Google News RSS search
            try:
                search_term = query
                if not any(w in query.lower() for w in ["stock", "share", "market", "nifty", "sensex"]):
                    search_term += " stock"

                rss_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(search_term)}&hl=en-IN&gl=IN&ceid=IN:en"
                req = urllib.request.Request(rss_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    xml_data = response.read()

                root = ET.fromstring(xml_data)
                for item in root.findall('./channel/item'):
                    title_elem = item.find('title')
                    link_elem = item.find('link')
                    if title_elem is None or not title_elem.text:
                        continue
                    title = title_elem.text.strip()
                    link = link_elem.text.strip() if link_elem is not None and link_elem.text else ""

                    source_elem = item.find('source')
                    source = source_elem.text.strip() if source_elem is not None and source_elem.text else "Google News"

                    pub_node = item.find('pubDate')
                    pub_text = pub_node.text.strip() if pub_node is not None and pub_node.text else ""
                    hours_ago = 24.0
                    if pub_text:
                        try:
                            dt = email.utils.parsedate_to_datetime(pub_text)
                            if dt.tzinfo is None:
                                dt = dt.replace(tzinfo=timezone.utc)
                            hours_ago = (now - dt).total_seconds() / 3600
                        except Exception:
                            hours_ago = 24.0

                    articles.append({"title": title, "link": link, "source": source, "hours_ago": hours_ago})
            except Exception as e:
                print(f"[News API] Google RSS error for '{query}': {e}")

            # 3. Yahoo Finance news (supports old & new yfinance schemas)
            if ticker and yf:
                try:
                    yf_ticker = yf.Ticker(ticker + ".NS")
                    news = getattr(yf_ticker, "news", []) or []
                    for n in news:
                        if not isinstance(n, dict):
                            continue
                        content = n.get("content") if isinstance(n.get("content"), dict) else n
                        title = content.get("title") or n.get("title", "")
                        if not title:
                            continue

                        link = ""
                        if "canonicalUrl" in content and isinstance(content["canonicalUrl"], dict):
                            link = content["canonicalUrl"].get("url", "")
                        elif "clickThroughUrl" in content and isinstance(content["clickThroughUrl"], dict):
                            link = content["clickThroughUrl"].get("url", "")
                        if not link:
                            link = content.get("link") or n.get("link", "")

                        provider = content.get("provider")
                        if isinstance(provider, dict):
                            source = provider.get("displayName") or "Yahoo Finance"
                        else:
                            source = n.get("publisher") or "Yahoo Finance"

                        pub_time = content.get("pubDate") or n.get("providerPublishTime", 0)
                        hours_ago = 24.0
                        if isinstance(pub_time, (int, float)) and pub_time > 0:
                            dt = datetime.datetime.fromtimestamp(pub_time, tz=timezone.utc)
                            hours_ago = (now - dt).total_seconds() / 3600
                        elif isinstance(pub_time, str):
                            try:
                                dt = email.utils.parsedate_to_datetime(pub_time)
                                if dt.tzinfo is None:
                                    dt = dt.replace(tzinfo=timezone.utc)
                                hours_ago = (now - dt).total_seconds() / 3600
                            except Exception:
                                hours_ago = 24.0

                        articles.append({"title": title, "link": link, "source": source, "hours_ago": hours_ago})
                except Exception as e:
                    print(f"[News API] yfinance error for {ticker}: {e}")

            final_articles = []
            seen_titles = set()
            for a in articles:
                if not a.get("title"):
                    continue
                if a["title"] in seen_titles:
                    continue
                seen_titles.add(a["title"])

                h = a.get("hours_ago", 48)
                if h <= 24:
                    a["category"] = "Last 24 Hours"
                elif h <= 168:
                    a["category"] = "Past 7 Days"
                elif h <= 720:
                    a["category"] = "Past 30 Days"
                else:
                    continue

                final_articles.append(a)

            # Semantic deduplication (fastembed MiniLM + guards + multi-source attribution)
            try:
                from news_dedup import dedupe_articles
                final_articles = dedupe_articles(final_articles, window_h=24)
            except Exception as e:
                print(f"[News API] Deduplication error: {e}")

            final_articles.sort(key=lambda x: x["hours_ago"])
            payload = json.dumps(final_articles).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Content-length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
            
        elif url.path.startswith("/upstox-api/"):
            if not state.UPSTOX_TOKEN:
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"error": "Missing Upstox Token"}')
                return
                
            upstream_path = url.path.replace("/upstox-api", "")
            target_url = "https://api.upstox.com" + upstream_path
            if url.query:
                target_url += "?" + url.query
                
            headers = {'Authorization': f'Bearer {state.UPSTOX_TOKEN}', 'Accept': 'application/json', 'Api-Version': '2.0'}
            try:
                resp = requests.get(target_url, headers=headers, timeout=10)
                self.send_response(resp.status_code)
                for k, v in resp.headers.items():
                    if k.lower() not in ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'access-control-allow-origin', 'authorization']:
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp.content)
            except Exception as e:
                self.send_response(502)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return
            
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 Not Found")

    def log_message(self, format, *args): pass

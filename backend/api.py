import json
import copy
import datetime
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import timezone
import pandas as pd
import numpy as np
import os
import requests
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

import state
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
        allowed_origins = ["http://localhost:5175", "http://127.0.0.1:5175"]
        if origin in allowed_origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        url = urlparse(self.path)
        payload = {}
        content_length_str = self.headers.get('Content-Length')
        
        if content_length_str:
            content_length = int(content_length_str)
            post_data = self.rfile.read(content_length)
            if post_data:
                payload = json.loads(post_data)

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
            query_dict = dict(q.split("=") for q in url.query.split("&") if "=" in q) if url.query else {}
            query = query_dict.get("q", "Indian Stock Market")
            ticker = query_dict.get("ticker", "")
            import yfinance as yf
            
            articles = []
            now = datetime.datetime.now(timezone.utc)
            
            try:
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
                                    title = item.find('title').text
                                    link = item.find('link').text
                                    pub_node = item.find('pubDate')
                                    pubDate = pub_node.text if pub_node is not None else ""
                                    source = default_source
                                    try:
                                        dt = datetime.datetime.strptime(pubDate, "%a, %d %b %Y %H:%M:%S %Z")
                                        dt = dt.replace(tzinfo=timezone.utc)
                                        hours_ago = (now - dt).total_seconds() / 3600
                                    except:
                                        hours_ago = 48
                                    articles.append({"title": title, "link": link, "source": source, "hours_ago": hours_ago})
                        except Exception as e:
                            pass

                search_term = query
                if not any(w in query.lower() for w in ["stock", "share", "market", "nifty", "sensex"]):
                    search_term += " stock"
                    
                rss_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(search_term)}&hl=en-IN&gl=IN&ceid=IN:en"
                req = urllib.request.Request(rss_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    xml_data = response.read()
                
                root = ET.fromstring(xml_data)
                for item in root.findall('./channel/item'):
                    title = item.find('title').text
                    link = item.find('link').text
                    pubDate = item.find('pubDate').text
                    source = item.find('source').text if item.find('source') is not None else "Google News"
                    try:
                        dt = datetime.datetime.strptime(pubDate, "%a, %d %b %Y %H:%M:%S %Z")
                        dt = dt.replace(tzinfo=timezone.utc)
                        hours_ago = (now - dt).total_seconds() / 3600
                    except:
                        hours_ago = 48
                        
                    articles.append({"title": title, "link": link, "source": source, "hours_ago": hours_ago})
            except Exception as e:
                pass

            if ticker:
                try:
                    yf_ticker = yf.Ticker(ticker + ".NS")
                    news = yf_ticker.news
                    for n in news:
                        title = n.get("title", "")
                        link = n.get("link", "")
                        source = n.get("publisher", "Yahoo Finance")
                        pub_time = n.get("providerPublishTime", 0)
                        if pub_time:
                            dt = datetime.datetime.fromtimestamp(pub_time, tz=timezone.utc)
                            hours_ago = (now - dt).total_seconds() / 3600
                        else:
                            hours_ago = 48
                        articles.append({"title": title, "link": link, "source": source, "hours_ago": hours_ago})
                except Exception as e:
                    pass

            final_articles = []
            seen_titles = set()
            for a in articles:
                if a["title"] in seen_titles: continue
                seen_titles.add(a["title"])
                
                if a["hours_ago"] <= 24:
                    a["category"] = "Last 24 Hours"
                elif a["hours_ago"] <= 168:
                    a["category"] = "Past 7 Days"
                else:
                    continue
                    
                final_articles.append(a)
                
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

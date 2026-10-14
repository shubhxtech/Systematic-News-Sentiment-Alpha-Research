"""Headline aggregation (ET/Moneycontrol RSS, Google News, Yahoo Finance) with a short cache."""
import datetime
import email.utils
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import timezone

try:
    import yfinance as yf
except ImportError:
    yf = None

MARKET_QUERIES = {"indian stock market", "markets", "nifty 50", "sensex", "nifty"}
MARKET_FEEDS = [
    ("https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", "Economic Times"),
    ("https://www.moneycontrol.com/rss/marketreports.xml", "Moneycontrol"),
]
_cache = {}
_cache_lock = threading.Lock()
CACHE_TTL = 300


def _hours_ago(dt, now):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (now - dt).total_seconds() / 3600


def _parse_rss_date(text, now):
    if not text:
        return None
    try:
        return _hours_ago(email.utils.parsedate_to_datetime(text.strip()), now)
    except Exception:
        return None


def _rss(url, default_source, now, limit=None, timeout=6):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        root = ET.fromstring(resp.read())
    out = []
    for item in root.findall("./channel/item")[:limit]:
        t = item.find("title")
        if t is None or not (t.text or "").strip():
            continue
        link = item.find("link")
        src = item.find("source")
        h = _parse_rss_date(item.findtext("pubDate"), now)
        out.append({"title": t.text.strip(),
                    "link": (link.text or "").strip() if link is not None else "",
                    "source": (src.text or "").strip() if src is not None and src.text else default_source,
                    "hours_ago": 24.0 if h is None else h, "time_known": h is not None})
    return out


def _yahoo(ticker, now):
    out = []
    news = getattr(yf.Ticker(ticker + ".NS"), "news", []) or []
    for n in news:
        if not isinstance(n, dict):
            continue
        content = n.get("content") if isinstance(n.get("content"), dict) else n
        title = content.get("title") or n.get("title", "")
        if not title:
            continue
        link = ""
        for k in ("canonicalUrl", "clickThroughUrl"):
            if isinstance(content.get(k), dict):
                link = content[k].get("url", "")
                if link:
                    break
        link = link or content.get("link") or n.get("link", "")
        provider = content.get("provider")
        source = (provider.get("displayName") if isinstance(provider, dict) else None) or n.get("publisher") or "Yahoo Finance"
        pub = content.get("pubDate") or n.get("providerPublishTime", 0)
        h = None
        if isinstance(pub, (int, float)) and pub > 0:
            h = _hours_ago(datetime.datetime.fromtimestamp(pub, tz=timezone.utc), now)
        elif isinstance(pub, str) and pub:
            try:
                h = _hours_ago(datetime.datetime.fromisoformat(pub.replace("Z", "+00:00")), now)
            except ValueError:
                h = _parse_rss_date(pub, now)
        out.append({"title": title, "link": link, "source": source,
                    "hours_ago": 24.0 if h is None else h, "time_known": h is not None})
    return out


def fetch_news(query="Indian Stock Market", ticker="", max_age_h=720):
    """Deduplicated articles, newest first, each with hours_ago, time (ISO, UTC) and category."""
    query = (query or "Indian Stock Market").strip()
    ticker = (ticker or "").strip().upper()
    key = (query.lower(), ticker)
    with _cache_lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return [dict(a) for a in hit[1]]

    now = datetime.datetime.now(timezone.utc)
    articles = []
    if query.lower() in MARKET_QUERIES:
        for url, src in MARKET_FEEDS:
            try:
                articles += _rss(url, src, now, limit=15)
            except Exception as e:
                print(f"[News] Feed error ({src}): {e}")
    try:
        term = query
        if not any(w in query.lower() for w in ("stock", "share", "market", "nifty", "sensex")):
            term += " stock"
        articles += _rss(f"https://news.google.com/rss/search?q={urllib.parse.quote(term)}&hl=en-IN&gl=IN&ceid=IN:en",
                         "Google News", now)
    except Exception as e:
        print(f"[News] Google RSS error for '{query}': {e}")
    if ticker and yf:
        try:
            articles += _yahoo(ticker, now)
        except Exception as e:
            print(f"[News] yfinance error for {ticker}: {e}")

    final, seen = [], set()
    for a in articles:
        t = a["title"].strip()
        if t.lower() in seen:
            continue
        seen.add(t.lower())
        h = a["hours_ago"]
        if h > max_age_h:
            continue
        a["hours_ago"] = max(h, 0.0)  # clock skew can make fresh items look "future"
        a["category"] = "Last 24 Hours" if h <= 24 else "Past 7 Days" if h <= 168 else "Past 30 Days"
        a["time"] = (now - datetime.timedelta(hours=a["hours_ago"])).isoformat()
        final.append(a)

    try:
        from news_dedup import dedupe_articles
        final = dedupe_articles(final, window_h=24)
    except Exception as e:
        print(f"[News] Deduplication error: {e}")

    final.sort(key=lambda x: x["hours_ago"])
    with _cache_lock:
        _cache[key] = (time.time(), final)
        if len(_cache) > 200:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:50]:
                _cache.pop(k, None)
    return [dict(a) for a in final]

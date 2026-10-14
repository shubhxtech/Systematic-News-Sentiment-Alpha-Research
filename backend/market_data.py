"""Shared market-data access: exchange calendar, Upstox candles, NSE/BSE clients, delivery data.

Everything here is best-effort and cached on disk so a flaky upstream degrades a feature
instead of breaking a whole pipeline. All dates are exchange dates (IST).
"""
import csv
import io
import json
import threading
import time
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

IST = ZoneInfo("Asia/Kolkata")
DATA_DIR = Path(__file__).parent / "data"
CACHE_DIR = DATA_DIR / "cache"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

# Used only when the NSE holiday API is unreachable. Source: NSE holiday-master (CM), 2026.
FALLBACK_HOLIDAYS = [
    "2026-01-15", "2026-01-26", "2026-02-15", "2026-03-03", "2026-03-21", "2026-03-26",
    "2026-03-31", "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26",
    "2026-08-15", "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-08", "2026-11-10",
    "2026-11-24", "2026-12-25",
]


def today_ist():
    return datetime.now(IST).date()


def _read_json(path, max_age_s):
    try:
        if path.exists() and time.time() - path.stat().st_mtime < max_age_s:
            return json.loads(path.read_text())
    except Exception:
        pass
    return None


def _write_json(path, obj):
    """Atomic write so a concurrent reader never sees a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(obj))
    tmp.replace(path)


# ── NSE client ─────────────────────────────────────────────────────────────
class _NSE:
    """NSE's JSON API needs a cookie from the home page and rejects bursts."""

    def __init__(self):
        self._s = None
        self._born = 0
        self._lock = threading.Lock()
        self._last = 0.0

    def _session(self, fresh=False):
        if fresh or self._s is None or time.time() - self._born > 300:
            s = requests.Session()
            s.headers.update({**UA, "Accept": "application/json, text/plain, */*",
                              "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/"})
            try:
                s.get("https://www.nseindia.com/", timeout=15)
            except Exception:
                pass
            self._s, self._born = s, time.time()
        return self._s

    def get(self, path, params=None, timeout=25):
        for attempt in range(3):
            with self._lock:  # serialise + space out calls; NSE blocks parallel scrapers
                wait = 0.35 - (time.time() - self._last)
                if wait > 0:
                    time.sleep(wait)
                self._last = time.time()
                s = self._session(fresh=attempt > 0)
            try:
                r = s.get("https://www.nseindia.com" + path, params=params, timeout=timeout)
                if r.status_code == 200 and r.headers.get("content-type", "").startswith("application/json"):
                    return r.json()
                if r.status_code in (401, 403, 429, 503):
                    time.sleep(1.0 + attempt)
                    continue
                return None
            except (requests.RequestException, ValueError):
                time.sleep(0.8 + attempt)
        return None


nse = _NSE()


def bse_get(path, params=None, timeout=25):
    h = {**UA, "Referer": "https://www.bseindia.com/", "Origin": "https://www.bseindia.com",
         "Accept": "application/json"}
    for attempt in range(2):
        try:
            r = requests.get("https://api.bseindia.com/BseIndiaAPI/api/" + path, params=params,
                             headers=h, timeout=timeout)
            if r.ok:
                return r.json()
        except (requests.RequestException, ValueError):
            time.sleep(0.8)
    return None


# ── trading calendar ───────────────────────────────────────────────────────
_holidays = None


def holidays():
    """Set of NSE equity trading holidays (date objects). Cached for a week."""
    global _holidays
    if _holidays is not None:
        return _holidays
    path = CACHE_DIR / "nse_holidays.json"
    days = _read_json(path, 7 * 86400)
    if not days:
        j = nse.get("/api/holiday-master", {"type": "trading"})
        try:
            days = [datetime.strptime(x["tradingDate"], "%d-%b-%Y").strftime("%Y-%m-%d") for x in j["CM"]]
            _write_json(path, days)
        except Exception:
            days = _read_json(path, 10 ** 9) or FALLBACK_HOLIDAYS
    _holidays = {date.fromisoformat(d) for d in days}
    return _holidays


def trading_days_between(start, end):
    """Trading sessions in [start, end) — i.e. sessions left before a result on `end`."""
    if end <= start:
        return 0
    hol = np.array(sorted(holidays()), dtype="datetime64[D]")
    return int(np.busday_count(start, end, holidays=hol))


# ── Upstox candles ─────────────────────────────────────────────────────────
_candle_mem = {}
_candle_lock = threading.Lock()


def _parse_candles(rows):
    df = pd.DataFrame(rows, columns=["t", "o", "h", "l", "c", "v", "oi"])
    # Timestamps are IST midnight ("2026-10-13T00:00:00+05:30"). Keep the exchange date:
    # converting to UTC first would shift every bar to the previous day.
    df["t"] = pd.to_datetime(df.t.str.slice(0, 10))
    df = df.drop_duplicates("t").sort_values("t").set_index("t")
    return df[["o", "h", "l", "c", "v"]].astype(float)


def fetch_candles(instrument_key, days=600, ttl=3 * 3600):
    """Daily candles for an Upstox instrument key ("NSE_EQ|<ISIN>", "NSE_INDEX|Nifty 500").

    Uses the public historical endpoint (no token). Returns a DataFrame indexed by exchange date
    or None. Cached in memory and on disk.
    """
    ck = (instrument_key, days)
    with _candle_lock:
        hit = _candle_mem.get(ck)
    if hit is not None and time.time() - hit[0] < ttl:
        return hit[1]

    safe = instrument_key.replace("|", "_").replace(" ", "_")
    path = CACHE_DIR / "candles" / f"{safe}_{days}.json"
    rows = _read_json(path, ttl)
    if rows is None:
        to = today_ist().isoformat()
        frm = (today_ist() - timedelta(days=days)).isoformat()
        url = (f"https://api.upstox.com/v2/historical-candle/"
               f"{urllib.parse.quote(instrument_key, safe='')}/day/{to}/{frm}")
        for attempt in range(3):
            try:
                r = requests.get(url, headers=UA, timeout=20)
                if r.status_code == 429:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                if r.status_code == 400:  # invalid instrument: retrying will not help
                    break
                r.raise_for_status()
                rows = r.json()["data"]["candles"]
                _write_json(path, rows)
                break
            except Exception:
                time.sleep(0.5 * (attempt + 1))
    if not rows:
        stale = _read_json(path, 10 ** 9)  # serve stale data rather than nothing
        if not stale:
            return None
        rows = stale
    df = _parse_candles(rows)
    with _candle_lock:
        _candle_mem[ck] = (time.time(), df)
    return df


def equity_candles(isin, prefer="NSE_EQ", days=600):
    """Try NSE first, then BSE (for BSE-only listings)."""
    if not isin:
        return None, None
    for seg in ([prefer] + [s for s in ("NSE_EQ", "BSE_EQ") if s != prefer]):
        df = fetch_candles(f"{seg}|{isin}", days)
        if df is not None and len(df) > 0:
            return df, seg
    return None, None


# Board-meeting "Industry" (NSE macro sector) -> NSE sectoral index on Upstox.
SECTOR_INDEX = {
    "financial services": "Nifty Fin Service",
    "information technology": "Nifty IT",
    "automobile and auto components": "Nifty Auto",
    "fast moving consumer goods": "Nifty FMCG",
    "healthcare": "Nifty Pharma",
    "metals & mining": "Nifty Metal",
    "realty": "Nifty Realty",
    "oil gas & consumable fuels": "Nifty Energy",
    "power": "Nifty Energy",
    "media entertainment & publication": "Nifty Media",
    "chemicals": "Nifty Chemicals",
    "construction": "Nifty Infra",
    "construction materials": "Nifty Infra",
    "capital goods": "Nifty Infra",
    "telecommunication": "Nifty Infra",
    "consumer services": "Nifty FMCG",
    "consumer durables": "Nifty FMCG",
}
MARKET_INDEX = "Nifty 500"


_SECTOR_KEYWORDS = [
    (("bank", "financ", "nbfc", "insurance", "lending", "broking", "capital market", "asset management"), "Nifty Fin Service"),
    (("software", "it services", "it enabled", "information technology", "computers"), "Nifty IT"),
    (("pharma", "drug", "hospital", "healthcare", "diagnostic", "biotech"), "Nifty Pharma"),
    (("auto", "tyre", "two wheeler", "vehicle"), "Nifty Auto"),
    (("steel", "metal", "alumin", "copper", "zinc", "mining", "iron"), "Nifty Metal"),
    (("refiner", "oil", "gas", "coal", "power", "energy", "petroleum"), "Nifty Energy"),
    (("chemical", "fertili", "pesticide", "agrochem", "dyes", "pigment"), "Nifty Chemicals"),
    (("realty", "real estate", "residential", "commercial projects"), "Nifty Realty"),
    (("media", "entertainment", "broadcast", "publishing"), "Nifty Media"),
    (("food", "beverage", "personal care", "fmcg", "tobacco", "household", "consumer"), "Nifty FMCG"),
    (("cement", "construction", "infra", "engineering", "electrical equipment", "capital goods", "industrial"), "Nifty Infra"),
]


def sector_index_for(*industries):
    """Best NSE sectoral index for any of the given industry labels (macro sector first, then keywords)."""
    for ind in industries:
        key = " ".join((ind or "").lower().split())
        if key in SECTOR_INDEX:
            return SECTOR_INDEX[key]
    for ind in industries:
        key = (ind or "").lower()
        if not key:
            continue
        for words, idx in _SECTOR_KEYWORDS:
            if any(w in key for w in words):
                return idx
    return None


def index_candles(name, days=600):
    return fetch_candles(f"NSE_INDEX|{name}", days)


# ── delivery data (NSE full bhavcopy) ──────────────────────────────────────
def _bhav_day(d):
    """{symbol: (deliv_qty, traded_qty, deliv_pct)} for EQ series on day d, or None if no file."""
    path = CACHE_DIR / "bhav" / f"{d:%Y%m%d}.json"
    cached = _read_json(path, 10 ** 9)
    if cached is not None:
        return cached or None
    url = f"https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{d:%d%m%Y}.csv"
    try:
        r = requests.get(url, headers=UA, timeout=25)
    except requests.RequestException:
        return None  # network problem: do not cache, try again next time
    if r.status_code == 404 or not r.ok or "SYMBOL" not in r.text[:200]:
        # Holiday or not published yet. Only cache the miss for days that are clearly final.
        if d < today_ist() - timedelta(days=3):
            _write_json(path, {})
        return None
    out = {}
    for row in csv.DictReader(io.StringIO(r.text)):
        row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
        if row.get("SERIES") not in ("EQ", "BE", "BZ", "SM", "ST"):
            continue
        try:
            dq = float(row["DELIV_QTY"]) if row["DELIV_QTY"] not in ("", "-") else None
            tq = float(row["TTL_TRD_QNTY"])
            dp = float(row["DELIV_PER"]) if row["DELIV_PER"] not in ("", "-") else None
        except (KeyError, ValueError):
            continue
        out[row["SYMBOL"]] = [dq, tq, dp]
    _write_json(path, out)
    return out


def delivery_history(sessions=25, progress=None):
    """{date: {symbol: [deliv_qty, traded_qty, deliv_pct]}} for the most recent sessions."""
    out = {}
    d = today_ist()
    tries = 0
    hol = holidays()
    while len(out) < sessions and tries < sessions * 2 + 10:
        tries += 1
        if d.weekday() < 5 and d not in hol:
            day = _bhav_day(d)
            if day:
                out[d] = day
                if progress:
                    progress(len(out), sessions)
        d -= timedelta(days=1)
    return out


def delivery_features(symbol, hist):
    """Delivery % trend for one symbol from delivery_history() output."""
    rows = [(d, v[symbol]) for d, v in sorted(hist.items()) if symbol in v]
    pct = [r[2] for _, r in rows if r[2] is not None]
    if len(pct) < 8:
        return {}
    last5 = float(np.mean(pct[-5:]))
    base = float(np.mean(pct[:-5])) if len(pct) > 5 else None
    dq = [r[0] for _, r in rows if r[0] is not None]
    f = {"deliv_pct_5d": last5, "deliv_pct_base": base,
         "deliv_pct_change": (last5 - base) if base is not None else None}
    if len(dq) >= 10:
        b = np.mean(dq[:-5])
        f["deliv_qty_ratio"] = float(np.mean(dq[-5:]) / b) if b else None
    return f


# ── NSE corporate data ─────────────────────────────────────────────────────
def _is_results_purpose(x):
    t = f"{x.get('bm_purpose', '')} {x.get('bm_desc', '')}".lower()
    return "result" in t


def nse_upcoming_results(days_ahead=45):
    """Upcoming results board meetings from NSE: [{symbol, isin, company, result_date, industry}]."""
    path = CACHE_DIR / "nse_upcoming_results.json"
    cached = _read_json(path, 6 * 3600)
    if cached is not None:
        return cached
    t = today_ist()
    j = nse.get("/api/corporate-board-meetings",
                {"index": "equities", "from_date": f"{t:%d-%m-%Y}",
                 "to_date": f"{t + timedelta(days=days_ahead):%d-%m-%Y}"}, timeout=40)
    if not isinstance(j, list):
        return _read_json(path, 10 ** 9) or []
    seen, out = set(), []
    for x in j:
        if not _is_results_purpose(x):
            continue
        try:
            d = datetime.strptime(x["bm_date"], "%d-%b-%Y").date()
        except Exception:
            continue
        k = (x.get("bm_symbol"), d)
        if k in seen:
            continue
        seen.add(k)
        out.append({"symbol": x.get("bm_symbol"), "isin": x.get("sm_isin"), "company": x.get("sm_name"),
                    "result_date": d.isoformat(),
                    "industry": None if x.get("sm_indusrty") in (None, "-") else x.get("sm_indusrty")})
    _write_json(path, out)
    return out


def nse_past_result_dates(symbol, years=3):
    """Past results board-meeting dates for a symbol (most recent first). Cached 7 days."""
    if not symbol:
        return []
    path = CACHE_DIR / "result_dates" / f"{symbol.replace('/', '_')}.json"
    cached = _read_json(path, 7 * 86400)
    if cached is not None:
        return [date.fromisoformat(d) for d in cached]
    t = today_ist()
    j = nse.get("/api/corporate-board-meetings",
                {"index": "equities", "symbol": symbol,
                 "from_date": f"{t - timedelta(days=365 * years):%d-%m-%Y}", "to_date": f"{t:%d-%m-%Y}"})
    if not isinstance(j, list):
        stale = _read_json(path, 10 ** 9)
        return [date.fromisoformat(d) for d in stale] if stale else []
    ds = set()
    for x in j:
        if _is_results_purpose(x):
            try:
                d = datetime.strptime(x["bm_date"], "%d-%b-%Y").date()
                if d < t:
                    ds.add(d)
            except Exception:
                pass
    out = sorted(ds, reverse=True)
    _write_json(path, [d.isoformat() for d in out])
    return out


def nse_announcements(symbol, days=45):
    """Exchange filings for a symbol: [{time, title, text, category, url, source}]. Cached 30 min."""
    if not symbol:
        return []
    path = CACHE_DIR / "announcements" / f"NSE_{symbol.replace('/', '_')}_{days}.json"
    cached = _read_json(path, 1800)
    if cached is not None:
        return cached
    t = today_ist()
    j = nse.get("/api/corporate-announcements",
                {"index": "equities", "symbol": symbol,
                 "from_date": f"{t - timedelta(days=days):%d-%m-%Y}", "to_date": f"{t:%d-%m-%Y}"})
    if not isinstance(j, list):
        return _read_json(path, 10 ** 9) or []
    out = []
    for x in j:
        try:
            ts = datetime.strptime(x["an_dt"], "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
        except Exception:
            continue
        text = (x.get("attchmntText") or "").strip()
        out.append({"time": ts.isoformat(), "title": x.get("desc") or "Announcement", "text": text,
                    "category": x.get("desc") or "", "url": x.get("attchmntFile") or "",
                    "source": "NSE filing", "source_type": "exchange"})
    _write_json(path, out)
    return out


def bse_announcements(bse_code, days=45):
    """BSE filings (used for BSE-only companies)."""
    if not bse_code:
        return []
    path = CACHE_DIR / "announcements" / f"BSE_{bse_code}_{days}.json"
    cached = _read_json(path, 1800)
    if cached is not None:
        return cached
    t = today_ist()
    j = bse_get("AnnSubCategoryGetData/w", {
        "pageno": 1, "strCat": -1, "strPrevDate": f"{t - timedelta(days=days):%Y%m%d}",
        "strScrip": bse_code, "strSearch": "P", "strToDate": f"{t:%Y%m%d}", "strType": "C", "subcategory": -1})
    if not isinstance(j, dict):
        return _read_json(path, 10 ** 9) or []
    out = []
    for x in j.get("Table") or []:
        try:
            ts = datetime.fromisoformat(str(x.get("NEWS_DT") or x.get("DT_TM"))[:19]).replace(tzinfo=IST)
        except Exception:
            continue
        att = x.get("ATTACHMENTNAME")
        out.append({"time": ts.isoformat(), "title": x.get("NEWSSUB") or "Announcement",
                    "text": (x.get("MORE") or x.get("HEADLINE") or "").strip(),
                    "category": x.get("CATEGORYNAME") or "",
                    "url": f"https://www.bseindia.com/xml-data/corpfiling/AttachLive/{att}" if att else "",
                    "source": "BSE filing", "source_type": "exchange"})
    _write_json(path, out)
    return out


# ── instrument master (BSE code / ISIN / NSE symbol) ───────────────────────
INSTR_CACHE = DATA_DIR / "instruments_eq.json"
INSTR_URL = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
_instr = None
_instr_lock = threading.Lock()


def load_instruments():
    """{"bse": {code: {isin, bse_symbol, name}}, "nse": {isin: symbol}}. Refreshed daily; stale copy on failure."""
    global _instr
    import gzip
    with _instr_lock:
        if _instr is not None and time.time() - _instr[0] < 86400:
            return _instr[1]
        data = _read_json(INSTR_CACHE, 86400)
        if data is None:
            try:
                r = requests.get(INSTR_URL, headers=UA, timeout=60)
                r.raise_for_status()
                raw = json.loads(gzip.decompress(r.content))
                bse, nse_map = {}, {}
                for x in raw:
                    if x.get("segment") == "BSE_EQ" and x.get("instrument_type") != "F":
                        bse[str(x["exchange_token"])] = {"isin": x.get("isin"), "bse_symbol": x.get("trading_symbol"),
                                                         "name": x.get("name")}
                    elif x.get("segment") == "NSE_EQ" and x.get("instrument_type") == "EQ":
                        nse_map[x["isin"]] = x["trading_symbol"]
                data = {"bse": bse, "nse": nse_map}
                _write_json(INSTR_CACHE, data)
            except Exception:
                data = _read_json(INSTR_CACHE, 10 ** 9)
                if data is None:
                    raise
        data.setdefault("nse_rev", {v: k for k, v in data["nse"].items()})
        _instr = (time.time(), data)
        return data


def isin_for_symbol(symbol):
    try:
        return load_instruments()["nse_rev"].get((symbol or "").upper())
    except Exception:
        return None

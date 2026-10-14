"""Long daily price history for every NSE-listed stock, used by the research study and backtests.

* Universe: NSE's current equity list (EQUITY_L.csv), series EQ and BE.
* Candles: Upstox public endpoint, split/bonus adjusted, ~20 years (two 10-year requests per stock).
* Storage: one compressed .npz per stock under data/cache/history/, plus a combined panel
  (dates × symbols matrices) that the backtester loads in one go.

Known bias: the list only contains companies listed today. Companies that were delisted, merged or
went bust are missing, which flatters historical hit rates and understates losses (survivorship bias).
"""
import csv
import io
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

import market_data as md

HIST_DIR = md.CACHE_DIR / "history"
PANEL_PATH = md.CACHE_DIR / "panel.npz"
EQUITY_LIST_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
START = date(2006, 10, 1)
MAX_SPAN = timedelta(days=3650)       # Upstox rejects ranges longer than ~10 years

INDEX_SERIES = {"NIFTY500": "Nifty 500", "NIFTY50": "Nifty 50", "SMALLCAP250": "NIFTY SMLCAP 250"}


def equity_list(max_age_s=86400):
    """[{symbol, name, isin, series, listed}] for NSE mainboard equities."""
    path = md.CACHE_DIR / "equity_list.json"
    cached = md._read_json(path, max_age_s)
    if cached:
        return cached
    try:
        r = requests.get(EQUITY_LIST_URL, headers=md.UA, timeout=30)
        r.raise_for_status()
        out = []
        for row in csv.DictReader(io.StringIO(r.text)):
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            if row.get("SERIES") not in ("EQ", "BE"):
                continue
            out.append({"symbol": row["SYMBOL"], "name": row["NAME OF COMPANY"], "isin": row["ISIN NUMBER"],
                        "series": row["SERIES"], "listed": row.get("DATE OF LISTING", "")})
        md._write_json(path, out)
        return out
    except Exception:
        return md._read_json(path, 10 ** 9) or []


def _fetch_range(key, frm, to):
    url = (f"https://api.upstox.com/v2/historical-candle/"
           f"{requests.utils.quote(key, safe='')}/day/{to.isoformat()}/{frm.isoformat()}")
    for attempt in range(4):
        try:
            r = requests.get(url, headers=md.UA, timeout=30)
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code == 400:
                return []
            r.raise_for_status()
            return r.json()["data"]["candles"]
        except (requests.RequestException, ValueError, KeyError):
            time.sleep(1 + attempt)
    raise RuntimeError(f"failed to fetch {key} {frm}..{to}")


def _rows_to_arrays(rows):
    if not rows:
        return None
    rows = sorted(rows, key=lambda x: x[0])
    d = np.array([x[0][:10] for x in rows], dtype="datetime64[D]")
    a = np.array([x[1:6] for x in rows], dtype=np.float64)  # o h l c v
    _, keep = np.unique(d, return_index=True)
    return d[keep], a[keep]


def load_stock(key):
    p = HIST_DIR / f"{key.replace('|', '_').replace(' ', '_')}.npz"
    if not p.exists():
        return None
    z = np.load(p)
    return z["d"], z["a"], z["fetched"].item() if "fetched" in z else ""


def update_stock(key, today=None):
    """Fetch (or extend) full history for one instrument key. Returns number of rows."""
    today = today or md.today_ist()
    p = HIST_DIR / f"{key.replace('|', '_').replace(' ', '_')}.npz"
    have = load_stock(key)
    if have and have[2] == today.isoformat():
        return len(have[0])
    frm = START if not have or not len(have[0]) else (pd.Timestamp(have[0][-1]).date() - timedelta(days=7))
    rows = []
    while frm <= today:
        to = min(frm + MAX_SPAN, today)
        rows += _fetch_range(key, frm, to)
        frm = to + timedelta(days=1)
    new = _rows_to_arrays(rows)
    if have and len(have[0]):
        if new is not None:
            d = np.concatenate([have[0], new[0]])
            a = np.concatenate([have[1], new[1]])
            _, keep = np.unique(d[::-1], return_index=True)   # prefer the freshest copy of a day
            keep = len(d) - 1 - keep
            order = np.argsort(d[keep])
            d, a = d[keep][order], a[keep][order]
        else:
            d, a = have[0], have[1]
    elif new is not None:
        d, a = new
    else:
        d, a = np.array([], dtype="datetime64[D]"), np.zeros((0, 5))
    HIST_DIR.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp.npz")
    np.savez_compressed(tmp, d=d, a=a, fetched=np.array(today.isoformat()))
    tmp.replace(p)
    return len(d)


def update_all(progress=None, workers=6):
    """Download/refresh history for every stock and the benchmark indices, then rebuild the panel."""
    stocks = equity_list()
    keys = [f"NSE_EQ|{s['isin']}" for s in stocks] + [f"NSE_INDEX|{v}" for v in INDEX_SERIES.values()]
    done, errors = [0], []
    lock = threading.Lock()

    def one(k):
        try:
            update_stock(k)
        except Exception as e:
            errors.append(f"{k}: {e}")
        with lock:
            done[0] += 1
            if progress:
                progress(done[0], len(keys))

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(one, keys))
    build_panel()
    return {"stocks": len(stocks), "errors": errors[:20], "error_count": len(errors)}


def build_panel():
    """Combine per-stock files into dates × symbols matrices (close, high, volume) + index closes."""
    stocks = equity_list()
    series = {}
    for s in stocks:
        got = load_stock(f"NSE_EQ|{s['isin']}")
        if got and len(got[0]) > 60:
            series[s["symbol"]] = got
    if not series:
        raise RuntimeError("no history downloaded yet")
    idx = {}
    for code, name in INDEX_SERIES.items():
        got = load_stock(f"NSE_INDEX|{name}")
        if got and len(got[0]):
            idx[code] = got
    dates = np.unique(np.concatenate([v[0] for v in idx.values()] or [v[0] for v in series.values()]))
    syms = sorted(series)
    n, m = len(dates), len(syms)
    close = np.full((n, m), np.nan, dtype=np.float32)
    high = np.full((n, m), np.nan, dtype=np.float32)
    low = np.full((n, m), np.nan, dtype=np.float32)
    vol = np.full((n, m), np.nan, dtype=np.float32)
    for j, s in enumerate(syms):
        d, a, _ = series[s]
        pos = np.searchsorted(dates, d)
        ok = (pos < n) & (dates[np.minimum(pos, n - 1)] == d)
        close[pos[ok], j] = a[ok, 3]
        high[pos[ok], j] = a[ok, 1]
        low[pos[ok], j] = a[ok, 2]
        vol[pos[ok], j] = a[ok, 4]
    index_close = {}
    for code, (d, a, _) in idx.items():
        s = pd.Series(a[:, 3], index=d).reindex(dates).ffill()
        index_close[code] = s.to_numpy(dtype=np.float32)
    meta = {s["symbol"]: {"name": s["name"], "isin": s["isin"]} for s in stocks if s["symbol"] in series}
    tmp = PANEL_PATH.with_suffix(".tmp.npz")
    np.savez_compressed(tmp, dates=dates, symbols=np.array(syms), close=close, high=high, low=low, vol=vol,
                        meta=np.array(json.dumps(meta)),
                        **{f"idx_{k}": v for k, v in index_close.items()})
    tmp.replace(PANEL_PATH)
    return {"dates": n, "symbols": m}


_panel = None
_panel_lock = threading.Lock()


def load_panel():
    """Cached Panel object (reloaded when the file changes)."""
    global _panel
    with _panel_lock:
        if not PANEL_PATH.exists():
            return None
        mtime = PANEL_PATH.stat().st_mtime
        if _panel is None or _panel.mtime != mtime:
            _panel = Panel(np.load(PANEL_PATH), mtime)
        return _panel


class Panel:
    def __init__(self, z, mtime):
        self.mtime = mtime
        self.dates = pd.DatetimeIndex(z["dates"])
        self.symbols = list(z["symbols"])
        self.close = z["close"].astype(np.float64)
        self.high = z["high"].astype(np.float64)
        self.low = z["low"].astype(np.float64)
        self.vol = z["vol"].astype(np.float64)
        self.meta = json.loads(str(z["meta"]))
        self.index = {k[4:]: z[k].astype(np.float64) for k in z.files if k.startswith("idx_")}

    @property
    def last_date(self):
        return self.dates[-1].date()

"""Build frontend/src/lib/universe.json from NSE's index constituent lists.

The screener universe is Nifty Total Market: Nifty 500 + Nifty Microcap 250 (about 750 stocks).
Each stock gets its NSE sector and a size bucket taken from the index it belongs to:

    Large = Nifty 100, Mid = Midcap 150, Small = Smallcap 250, Micro = Microcap 250

Run it whenever NSE rebalances its indices (March and September):

    cd backend && python3 build_universe.py
"""
import csv
import io
import json
import sys
from pathlib import Path

import requests

OUT = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "universe.json"
BASE = "https://nsearchives.nseindia.com/content/indices/"
UA = {"User-Agent": "Mozilla/5.0"}

# Order matters: a stock takes the first bucket whose list contains it.
BUCKETS = [
    ("Large", "ind_nifty100list.csv"),
    ("Mid", "ind_niftymidcap150list.csv"),
    ("Small", "ind_niftysmallcap250list.csv"),
    ("Micro", "ind_niftymicrocap250_list.csv"),
]


def fetch(name):
    r = requests.get(BASE + name, headers=UA, timeout=30)
    r.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(r.text)))
    if not rows or "ISIN Code" not in rows[0]:
        raise ValueError(f"{name}: unexpected format")
    return rows


def main():
    nifty50 = {r["Symbol"] for r in fetch("ind_nifty50list.csv")}
    universe = {}
    for bucket, name in BUCKETS:
        rows = fetch(name)
        print(f"{name}: {len(rows)} stocks")
        for r in rows:
            sym = r["Symbol"].strip()
            if sym in universe:
                continue
            isin = r["ISIN Code"].strip()
            universe[sym] = {
                "name": r["Company Name"].strip(),
                "sector": r["Industry"].strip() or "Other",
                "cap": bucket,
                "nifty50": sym in nifty50,
                "isin": isin,
                "key": f"NSE_EQ|{isin}",
            }
    if len(universe) < 700:
        sys.exit(f"Only {len(universe)} stocks found; refusing to overwrite {OUT.name}")
    OUT.write_text(json.dumps(dict(sorted(universe.items())), indent=1))
    sectors = sorted({v["sector"] for v in universe.values()})
    print(f"Wrote {len(universe)} stocks across {len(sectors)} sectors to {OUT}")


if __name__ == "__main__":
    main()

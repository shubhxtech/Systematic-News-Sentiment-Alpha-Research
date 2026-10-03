import urllib.request
import gzip
import json
import csv
import io

print("Downloading NSE EQUITY_L (Official list of actual companies)...")
req = urllib.request.Request("https://archives.nseindia.com/content/equities/EQUITY_L.csv", headers={'User-Agent': 'Mozilla/5.0'})
nse_companies = {}
try:
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
        reader = csv.reader(content.splitlines())
        next(reader) # headers
        for row in reader:
            if len(row) > 6:
                symbol = row[0].strip()
                name = row[1].strip()
                series = row[2].strip()
                isin = row[6].strip()
                if series in ['EQ', 'BE']:
                    nse_companies[isin] = {"symbol": symbol, "name": name, "series": series}
except Exception as e:
    print("Failed NSE EQUITY_L:", e)

print(f"Loaded {len(nse_companies)} real companies. Downloading Upstox NSE.csv.gz...")
req = urllib.request.Request("https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz", headers={'User-Agent': 'Mozilla/5.0'})
universe = {}
with urllib.request.urlopen(req) as response:
    content = gzip.decompress(response.read()).decode('utf-8')
    reader = csv.reader(content.splitlines())
    headers = next(reader)
    for row in reader:
        if len(row) < 11: continue
        instrument_key = row[0]
        tradingsymbol = row[2]
        instrument_type = row[9]
        if instrument_type == 'EQUITY':
            isin = instrument_key.split('|')[1] if '|' in instrument_key else ""
            if isin in nse_companies:
                comp = nse_companies[isin]
                universe[tradingsymbol] = {
                    "name": comp["name"],
                    "sector": "Unknown",
                    "isin": isin,
                    "key": instrument_key
                }
                if len(universe) >= 2000:
                    break

with open("screener/src/lib/universe_500.json", "w") as f:
    json.dump(universe, f, indent=2)

print(f"Saved {len(universe)} real stocks.")

print(f"Saved {len(universe)} stocks.")

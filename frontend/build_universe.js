import fs from 'fs';
import axios from 'axios';
import https from 'https';

async function run() {
  console.log("Fetching Upstox complete instruments...");
  // Upstox instruments
  const res = await axios.get("https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz");
  // Assuming it parses JSON automatically if not gzipped properly or axios handles gzip
  const instruments = res.data; 

  console.log("Fetching Nifty 500 list...");
  // Nifty 500
  let nifty500 = [];
  try {
    const n500 = await axios.get("https://niftyindices.com/IndexConstituent/ind_nifty500list.csv", {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    const lines = n500.data.split('\n').slice(1);
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length > 2) {
        // Symbol is usually the 3rd column in Nifty indices CSVs (Company Name, Industry, Symbol, Series, ISIN)
        nifty500.push(parts[2].trim().replace(/"/g, ''));
      }
    }
  } catch (e) {
    console.log("Failed to fetch Nifty 500, using fallback top 500 from NSE_EQ");
  }

  const universe = {};
  for (const k of Object.keys(instruments)) {
    const inst = instruments[k];
    if (inst.exchange === 'NSE_EQ') {
      const ticker = inst.tradingsymbol;
      if (nifty500.length > 0 && !nifty500.includes(ticker)) continue;
      universe[ticker] = {
        name: inst.name || ticker,
        sector: 'Unknown',
        isin: inst.isin,
        key: inst.instrument_key
      };
      if (Object.keys(universe).length >= 500) break; // limit to 500
    }
  }

  fs.writeFileSync('src/lib/universe_500.json', JSON.stringify(universe, null, 2));
  console.log(`Saved ${Object.keys(universe).length} stocks to universe_500.json`);
}

run();

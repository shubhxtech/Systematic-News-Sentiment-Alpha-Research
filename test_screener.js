const fs = require('fs');
const axios = require('axios');

const TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI4QkJBRDkiLCJqdGkiOiI2YWMxMTAxODliZDhmMzEyMTA2YjdlYmIiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzkxMDM3NDY0LCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MjI2MDA4MDB9.hII6uw6jJC6VTUfA0prcgtt9_tjb6KLgnQ6RR2Cra6o";

const UNIVERSE = {
  RELIANCE:  { name: 'Reliance Ind.',       sector: 'Energy',   isin: 'INE002A01018', key: 'NSE_EQ|INE002A01018' },
  TCS:       { name: 'TCS',                 sector: 'IT',       isin: 'INE467B01029', key: 'NSE_EQ|INE467B01029' },
};
const TICKERS = Object.keys(UNIVERSE);

async function run() {
  try {
    const keys = TICKERS.map(t => UNIVERSE[t]?.key).filter(Boolean).join(',');
    console.log("Fetching quotes for:", keys);
    const { data } = await axios.get('https://api.upstox.com/v3/market-quote/quotes', {
      params: { instrument_key: keys },
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json', 'Api-Version': '2.0' }
    });
    const quotes = data.data;
    console.log("Quotes keys:", Object.keys(quotes));
    
    const screenerData = {};
    for (const k of Object.keys(quotes)) {
      const q = quotes[k];
      const ticker = q.symbol || TICKERS.find(t => UNIVERSE[t].key === k) || k.split(':')[1];
      console.log("Parsed ticker:", ticker, "from key:", k);
      if (!ticker || !UNIVERSE[ticker]) {
        console.log("Skipping", ticker);
        continue;
      }
      screenerData[ticker] = { ticker, ltp: q.last_price };
    }
    console.log("Final screener data:", screenerData);
  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}
run();

const fs = require('fs');
const axios = require('axios');
const UNIVERSE = {
  TCS:       { key: 'NSE_EQ|INE467B01029' },
  HDFCBANK:  { key: 'NSE_EQ|INE040A01034' },
  INFY:      { key: 'NSE_EQ|INE009A01021' },
  ICICIBANK: { key: 'NSE_EQ|INE090A01021' },
  HINDUNILVR:{ key: 'NSE_EQ|INE030A01027' },
  SBIN:      { key: 'NSE_EQ|INE062A01020' },
  BHARTIARTL:{ key: 'NSE_EQ|INE397D01024' },
  ITC:       { key: 'NSE_EQ|INE154A01025' },
  KOTAKBANK: { key: 'NSE_EQ|INE237A01028' },
  LT:        { key: 'NSE_EQ|INE018A01030' },
  AXISBANK:  { key: 'NSE_EQ|INE238A01034' },
  ASIANPAINT:{ key: 'NSE_EQ|INE021A01026' },
  BAJFINANCE:{ key: 'NSE_EQ|INE296A01024' },
  MARUTI:    { key: 'NSE_EQ|INE585B01010' },
  HCLTECH:   { key: 'NSE_EQ|INE860A01027' },
  SUNPHARMA: { key: 'NSE_EQ|INE044A01036' },
  TITAN:     { key: 'NSE_EQ|INE280A01028' },
  WIPRO:     { key: 'NSE_EQ|INE075A01022' },
  ULTRACEMCO:{ key: 'NSE_EQ|INE481G01011' },
  NTPC:      { key: 'NSE_EQ|INE733E01010' },
  POWERGRID: { key: 'NSE_EQ|INE752E01010' },
  ONGC:      { key: 'NSE_EQ|INE213A01029' },
  DRREDDY:   { key: 'NSE_EQ|INE089A01023' },
  TATAMOTORS:{ key: 'NSE_EQ|INE155A01022' },
  RELIANCE:  { key: 'NSE_EQ|INE002A01018' }
};

const TICKERS = Object.keys(UNIVERSE);
const keys = TICKERS.map(t => UNIVERSE[t].key).join(',');

const TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI4QkJBRDkiLCJqdGkiOiI2YWMxMTAxODliZDhmMzEyMTA2YjdlYmIiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzkxMDM3NDY0LCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MjI2MDA4MDB9.hII6uw6jJC6VTUfA0prcgtt9_tjb6KLgnQ6RR2Cra6o";

axios.get('https://api.upstox.com/v3/market-quote/quotes', {
  params: { instrument_key: keys },
  headers: { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json', 'Api-Version': '2.0' }
}).then(res => {
  const quotes = res.data.data;
  let matches = [];
  for (const k of Object.keys(quotes)) {
    const q = quotes[k];
    const ticker = q.symbol || TICKERS.find(t => UNIVERSE[t].key === k) || k.split(':')[1];
    if (ticker && UNIVERSE[ticker]) matches.push(ticker);
  }
  console.log("Matched tickers:", matches);
}).catch(err => {
  console.error(err.response ? err.response.data : err.message);
});

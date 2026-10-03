import axios from 'axios';
import universe500 from './universe_500.json';

// ── Stock universe ─────────────────────────────────────────────────────────
export const UNIVERSE = universe500;
export const TICKERS = Object.keys(UNIVERSE);
export const SECTORS = [...new Set(Object.values(UNIVERSE).map(s => s.sector))];

// ── Axios instance ─────────────────────────────────────────────────────────
const upstox = axios.create({
  baseURL: '/upstox-api',
  timeout: 15000,
});

// Inject token from localStorage on every request
upstox.interceptors.request.use(cfg => {
  const token = localStorage.getItem('upstox_token');
  if (token) cfg.headers['Authorization'] = `Bearer ${token}`;
  cfg.headers['Accept'] = 'application/json';
  cfg.headers['Api-Version'] = '2.0';
  return cfg;
});

// Helper for chunks
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ── API calls ──────────────────────────────────────────────────────────────
export async function getMarketQuotes(tickers = TICKERS) {
  const keys = tickers.map(t => UNIVERSE[t]?.key).filter(Boolean);
  const chunks = chunkArray(keys, 500); // Use max allowed 500 to minimize requests
  
  const allQuotes = {};
  for (const chunk of chunks) {
    try {
      const { data } = await upstox.get('/v3/market-quote/quotes', { 
        params: { instrument_key: chunk.join(',') } 
      });
      if (data?.data) {
        Object.assign(allQuotes, data.data);
      }
    } catch (e) {
      console.error("Quotes chunk failed", e?.response?.status || e.message);
    }
    // Respect rate limits strongly
    await new Promise(r => setTimeout(r, 800));
  }
  return allQuotes;
}

export async function getHistoricalCandles(ticker) {
  const key = UNIVERSE[ticker]?.key;
  if (!key) throw new Error(`Unknown ticker: ${ticker}`);
  
  const today = new Date().toISOString().split('T')[0];
  const dayFrom = new Date(Date.now() - 100 * 86400000).toISOString().split('T')[0];
  const minFrom = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];

  const dayRes = await upstox.get(`/v2/historical-candle/${encodeURIComponent(key)}/day/${today}/${dayFrom}`).catch(()=>({data:{}}));
  await new Promise(r => setTimeout(r, 100)); // Stagger to prevent parallel 429 limits
  const minRes = await upstox.get(`/v2/historical-candle/${encodeURIComponent(key)}/1minute/${today}/${minFrom}`).catch(()=>({data:{}}));

  const daily = (dayRes.data?.data?.candles || []).map(([ts, o, h, l, c, vol]) => ({
    date: new Date(ts).toISOString(), open: o, high: h, low: l, close: c, volume: vol
  })).reverse();

  const raw1m = (minRes.data?.data?.candles || []).map(([ts, o, h, l, c, vol]) => ({
    date: new Date(ts).toISOString(), open: o, high: h, low: l, close: c, volume: vol
  })).reverse();

  const intraday = [];
  let current5m = null;
  for (const c of raw1m) {
    const time = new Date(c.date);
    const m = time.getMinutes();
    const periodStart = Math.floor(m / 5) * 5;
    
    if (!current5m || current5m.periodStart !== periodStart || current5m.h !== time.getHours() || current5m.d !== time.getDate()) {
      if (current5m) intraday.push(current5m.candle);
      current5m = { periodStart, h: time.getHours(), d: time.getDate(), candle: { ...c } };
    } else {
      const agg = current5m.candle;
      agg.high = Math.max(agg.high, c.high);
      agg.low = Math.min(agg.low, c.low);
      agg.close = c.close;
      agg.volume += c.volume;
    }
  }
  if (current5m) intraday.push(current5m.candle);

  let todaysIntraday = intraday;
  if (intraday.length > 0) {
    const lastDate = new Date(intraday[intraday.length - 1].date).getDate();
    todaysIntraday = intraday.filter(c => new Date(c.date).getDate() === lastDate);
  }

  return { daily, intraday: todaysIntraday };
}

export async function testConnection() {
  const { data } = await upstox.get('/v2/market/status/NSE');
  return data?.data?.market_status === 'open' || data?.data?.market_status === 'close';
}

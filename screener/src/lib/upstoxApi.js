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

upstox.interceptors.request.use(cfg => {
  const token = localStorage.getItem('upstox_token');
  if (token) cfg.headers['Authorization'] = `Bearer ${token}`;
  cfg.headers['Accept'] = 'application/json';
  cfg.headers['Api-Version'] = '2.0';
  return cfg;
});

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ── API calls ──────────────────────────────────────────────────────────────
export async function getMarketQuotes(tickers = TICKERS) {
  // Only fetch tickers that exist in universe
  const knownTickers = tickers.filter(t => UNIVERSE[t]);
  const keys = knownTickers.map(t => UNIVERSE[t]?.key).filter(Boolean);
  const chunks = chunkArray(keys, 500);

  const allQuotes = {};
  for (const chunk of chunks) {
    try {
      const { data } = await upstox.get('/v3/market-quote/quotes', {
        params: { instrument_key: chunk.join(',') }
      });
      if (data?.data) Object.assign(allQuotes, data.data);
    } catch (e) {
      console.error('Quotes chunk failed', e?.response?.status || e.message);
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  return allQuotes;
}

/**
 * Get historical candles for a ticker.
 * Works for both universe_500 tickers (uses pre-mapped instrument key)
 * and custom tickers (derives the NSE_EQ key from symbol name).
 */
export async function getHistoricalCandles(ticker) {
  // Try to get key from universe, fall back to constructing NSE_EQ key
  let key = UNIVERSE[ticker]?.key;
  if (!key) {
    // For custom tickers, search Upstox instrument list
    try {
      const { data } = await upstox.get('/v2/market/instruments', {
        params: { segment: 'NSE_EQ' }
      });
      const instruments = data?.data || [];
      const match = instruments.find(i =>
        i.tradingsymbol?.toUpperCase() === ticker.toUpperCase()
      );
      if (match) key = match.instrument_key;
    } catch {
      // fallback: construct key directly (works for most NSE stocks)
      key = `NSE_EQ|${ticker.toUpperCase()}`;
    }
  }

  if (!key) throw new Error(`Cannot resolve instrument key for: ${ticker}`);

  const today = new Date().toISOString().split('T')[0];
  const dayFrom = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]; // 1 year

  const dayRes = await upstox.get(
    `/v2/historical-candle/${encodeURIComponent(key)}/day/${today}/${dayFrom}`
  ).catch(() => ({ data: {} }));

  await new Promise(r => setTimeout(r, 100));

  const minFrom = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
  const minRes = await upstox.get(
    `/v2/historical-candle/${encodeURIComponent(key)}/1minute/${today}/${minFrom}`
  ).catch(() => ({ data: {} }));

  const daily = (dayRes.data?.data?.candles || []).map(([ts, o, h, l, c, vol]) => ({
    date: new Date(ts).toISOString(), open: o, high: h, low: l, close: c, volume: vol
  })).reverse();

  const raw1m = (minRes.data?.data?.candles || []).map(([ts, o, h, l, c, vol]) => ({
    date: new Date(ts).toISOString(), open: o, high: h, low: l, close: c, volume: vol
  })).reverse();

  // Aggregate 1m → 5m candles
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

  // Only keep today's intraday bars
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

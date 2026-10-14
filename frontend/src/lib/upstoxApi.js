import axios from 'axios';
import universe500 from './universe_500.json';

// ── Stock universe ─────────────────────────────────────────────────────────
export const UNIVERSE = universe500;
export const TICKERS = Object.keys(UNIVERSE);
export const SECTORS = [...new Set(Object.values(UNIVERSE).map(s => s.sector))];
/** instrument key ("NSE_EQ|INE...") → ticker, for mapping quote responses back */
export const KEY_TO_TICKER = Object.fromEntries(TICKERS.map(t => [UNIVERSE[t].key, t]));

/** YYYY-MM-DD in IST (Upstox dates are exchange dates; toISOString() is UTC). */
const istDate = (msAgo = 0) =>
  new Date(Date.now() - msAgo + 5.5 * 3600 * 1000).toISOString().split('T')[0];

// ── Axios instance ─────────────────────────────────────────────────────────
const upstox = axios.create({
  baseURL: '/upstox-api',
  timeout: 15000,
});

upstox.interceptors.request.use(cfg => {
  cfg.headers['Accept'] = 'application/json';
  // Api-Version and Authorization are added by the Python proxy
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
/**
 * Quotes for the universe. Returns { quotes, unauthorized } — unauthorized is true when every
 * chunk was rejected with 401 (missing/expired token), so callers can tell the user.
 */
export async function getMarketQuotes(tickers = TICKERS) {
  const keys = tickers.filter(t => UNIVERSE[t]).map(t => UNIVERSE[t].key).filter(Boolean);
  const chunks = chunkArray(keys, 500);

  const quotes = {};
  let rejected = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const { data } = await upstox.get('/v3/market-quote/quotes', {
        params: { instrument_key: chunks[i].join(',') }
      });
      if (data?.data) Object.assign(quotes, data.data);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401) rejected++;
      console.error('Quotes chunk failed', status || e.message);
      if (status === 401 && rejected === 1 && i === 0) break; // no point hammering with a bad token
    }
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1200));
  }
  return { quotes, unauthorized: rejected > 0 && Object.keys(quotes).length === 0 };
}

/** Resolve any NSE symbol to its instrument via the backend's instrument master. */
const instrumentCache = {};
export async function resolveInstrument(ticker) {
  const t = ticker.toUpperCase();
  if (UNIVERSE[t]?.key) return { key: UNIVERSE[t].key, name: UNIVERSE[t].name, symbol: t };
  if (!instrumentCache[t]) {
    instrumentCache[t] = fetch(`/api/instrument?symbol=${encodeURIComponent(t)}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  const info = await instrumentCache[t];
  if (!info) delete instrumentCache[t]; // allow a retry later
  return info;
}

/**
 * Get historical candles for a ticker.
 * Works for both universe_500 tickers (uses pre-mapped instrument key)
 * and custom tickers (derives the NSE_EQ key from symbol name).
 */
export async function getHistoricalCandles(ticker) {
  // Universe tickers carry their key; anything else is resolved by ISIN on the backend.
  const info = await resolveInstrument(ticker);
  const key = info?.key;
  if (!key) throw new Error(`Unknown symbol: ${ticker}`);

  const today = istDate();
  const dayFrom = istDate(400 * 86400000); // ~13 months: enough for 52-week stats and EMA200

  const dayRes = await upstox.get(
    `/v2/historical-candle/${encodeURIComponent(key)}/day/${today}/${dayFrom}`
  ).catch(() => ({ data: {} }));

  await new Promise(r => setTimeout(r, 100));

  const minFrom = istDate(3 * 86400000);
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

  return { daily, intraday: todaysIntraday, name: info?.name, key };
}

export async function testConnection() {
  const { data } = await upstox.get('/v2/market/status/NSE');
  return data?.data?.market_status === 'open' || data?.data?.market_status === 'close';
}

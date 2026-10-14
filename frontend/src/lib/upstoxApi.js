import axios from 'axios';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import universe from './universe.json';

// ── Stock universe ─────────────────────────────────────────────────────────
// Nifty Total Market (Nifty 500 + Microcap 250), built by backend/build_universe.py.
export const UNIVERSE = universe;
export const TICKERS = Object.keys(UNIVERSE);
export const SECTORS = [...new Set(Object.values(UNIVERSE).map(s => s.sector))].sort();
export const CAPS = ['Large', 'Mid', 'Small', 'Micro'];
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

const toCandles = (rows) => (rows || []).map(([ts, o, h, l, c, vol]) => ({
  date: new Date(ts).toISOString(), open: o, high: h, low: l, close: c, volume: vol,
})).reverse();

// Daily candles persist in IndexedDB for the rest of the IST day, so a page reload does not
// re-download history for 750 stocks. The historical endpoint has no bar for today anyway.
const DAILY_CACHE_VERSION = 1;
async function cachedDaily(key) {
  try {
    const hit = await idbGet(`daily:${key}`);
    if (hit?.v === DAILY_CACHE_VERSION && hit.day === istDate() && hit.candles?.length) return hit.candles;
  } catch { /* private mode / blocked storage: just refetch */ }
  return null;
}

/** Daily candles (~13 months) for any NSE symbol, plus its resolved name and key. */
export async function getDailyCandles(ticker) {
  // Universe tickers carry their key; anything else is resolved by ISIN on the backend.
  const info = await resolveInstrument(ticker);
  const key = info?.key;
  if (!key) throw new Error(`Unknown symbol: ${ticker}`);

  let daily = await cachedDaily(key);
  const cached = !!daily;
  if (!daily) {
    const res = await upstox.get(
      `/v2/historical-candle/${encodeURIComponent(key)}/day/${istDate()}/${istDate(400 * 86400000)}`
    ).catch(() => ({ data: {} }));
    daily = toCandles(res.data?.data?.candles);
    if (daily.length) {
      idbSet(`daily:${key}`, { v: DAILY_CACHE_VERSION, day: istDate(), candles: daily }).catch(() => {});
    }
  }
  return { daily, name: info?.name, key, cached };
}

/**
 * 5-minute bars for the latest session. Today's bars come from the intraday endpoint; before the
 * open (or on holidays) it is empty, so fall back to the previous session from the historical one.
 */
export async function getIntradayCandles(ticker) {
  const info = await resolveInstrument(ticker);
  if (!info?.key) throw new Error(`Unknown symbol: ${ticker}`);
  const k = encodeURIComponent(info.key);
  let res = await upstox.get(`/v2/historical-candle/intraday/${k}/1minute`).catch(() => ({ data: {} }));
  let raw = toCandles(res.data?.data?.candles);
  if (!raw.length) {
    res = await upstox.get(`/v2/historical-candle/${k}/1minute/${istDate()}/${istDate(5 * 86400000)}`)
      .catch(() => ({ data: {} }));
    raw = toCandles(res.data?.data?.candles);
  }
  // Aggregate 1m → 5m on IST boundaries, keep only the last session
  const IST = 5.5 * 3600 * 1000;
  const bars = new Map();
  for (const c of raw) {
    const slot = Math.floor((new Date(c.date).getTime() + IST) / 300000);
    const b = bars.get(slot);
    if (!b) bars.set(slot, { ...c, _day: Math.floor(slot / 288) });
    else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.volume += c.volume;
    }
  }
  const all = [...bars.values()];
  const lastDay = all.length ? all[all.length - 1]._day : null;
  return all.filter(b => b._day === lastDay).map(({ _day, ...b }) => b); // eslint-disable-line no-unused-vars
}

/** Daily candles plus the latest session's 5-minute bars (used by the chart modal). */
export async function getHistoricalCandles(ticker, { intraday = false } = {}) {
  const d = await getDailyCandles(ticker);
  return { ...d, intraday: intraday ? await getIntradayCandles(ticker).catch(() => []) : [] };
}

export async function testConnection() {
  const { data } = await upstox.get('/v2/market/status/NSE');
  return data?.data?.market_status === 'open' || data?.data?.market_status === 'close';
}

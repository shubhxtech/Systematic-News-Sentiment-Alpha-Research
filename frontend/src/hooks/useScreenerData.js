/**
 * useScreenerData.js
 *
 * Fetches real market data from Upstox (via the backend proxy).
 * If no API token is configured, sets needsApiToken=true and stops.
 * No synthetic / random data is ever generated.
 *
 * useScreenerPolling() owns the poll loop and must be mounted exactly once (App).
 * useScreenerData() only returns actions, so any component can call it without
 * starting a second loop.
 */
import { useEffect, useCallback } from 'react';
import { useStore } from '../lib/store';
import {
  UNIVERSE, KEY_TO_TICKER,
  getMarketQuotes, getHistoricalCandles,
} from '../lib/upstoxApi';
import { computeSignal } from '../lib/signal';
import {
  getMarketStatus, getPollInterval, shouldSkipLiveQuotes, timeUntilOpen,
} from '../lib/marketHours';

const maxOf = (arr, k) => arr.reduce((m, c) => (c[k] > m ? c[k] : m), -Infinity);
const minOf = (arr, k) => arr.reduce((m, c) => (c[k] < m ? c[k] : m), Infinity);

function tickerForQuote(key, q) {
  return KEY_TO_TICKER[q?.instrument_token] || KEY_TO_TICKER[key] || q?.symbol || key.split(':')[1];
}

async function fetchFundamentals() {
  try {
    const res = await fetch('/api/fundamentals');
    if (res.ok) return (await res.json()).stocks || {};
  } catch (e) {
    console.warn('Fundamentals fetch failed', e);
  }
  return {};
}

/** Signal fields derived from daily candles (empty object when history is too short). */
function signalFields(daily, fundScore) {
  if (!daily || daily.length < 50) return null;
  const { score, signal, breakdown, indicators, warning } = computeSignal(daily, { fundamentalScore: fundScore });
  const last252 = daily.slice(-252);
  return {
    signalScore: score, signal, breakdown, signalWarning: warning,
    ...indicators,
    rsi: indicators?.rsiVal,
    adx: indicators?.adxVal,
    week52High: maxOf(last252, 'high'),
    week52Low: minOf(last252, 'low'),
  };
}

// One background history loader for the whole app.
let historyLoopRunning = false;

async function loadMissingHistory(tickers) {
  if (historyLoopRunning) return;
  historyLoopRunning = true;
  try {
    for (const ticker of tickers) {
      const st = useStore.getState();
      if (!st.apiToken) break;
      if (st.candleCache[ticker]) continue;
      const result = await getHistoricalCandles(ticker).catch(() => ({ daily: [], intraday: [] }));
      if (result.daily.length || result.intraday.length) {
        st.setCandleCache(ticker, result);
        const row = st.screenerData[ticker];
        const sig = signalFields(result.daily, row?.fundamentalScore ?? null);
        if (sig) {
          const last20 = result.daily.slice(-20);
          const avgVolume = last20.length === 20 ? last20.reduce((a, c) => a + c.volume, 0) / 20 || null : null;
          st.updateTicker(ticker, {
            ...sig, avgVolume,
            relVol: avgVolume && row?.volume != null ? row.volume / avgVolume : null,
          });
        }
      }
      if (!result.cached) await new Promise(r => setTimeout(r, 1200)); // throttle network fetches only
    }
  } finally {
    historyLoopRunning = false;
  }
}

// ── Actions (no side-effects on mount) ─────────────────────────────────────
export function useScreenerData() {
  const apiToken = useStore(s => s.apiToken);

  const poll = useCallback(async ({ force = false } = {}) => {
    const st = useStore.getState();
    if (!st.apiToken) {
      st.setNeedsApiToken(true);
      return;
    }
    st.setNeedsApiToken(false);

    const marketStatus = getMarketStatus();
    st.setMarketOpen(marketStatus === 'open');
    const haveData = Object.keys(st.screenerData).length > 0;

    // Outside market hours prices do not change. Fetch once (so the screener is never empty
    // after a reload at night or on a weekend), then only refresh fundamentals/signals.
    if (shouldSkipLiveQuotes() && haveData && !force) {
      const fundData = await fetchFundamentals();
      const { screenerData, candleCache, updateTicker } = useStore.getState();
      for (const [ticker, prev] of Object.entries(screenerData)) {
        const fundScore = fundData[ticker + '.NS']?.score ?? null;
        const sig = signalFields(candleCache[ticker]?.daily, fundScore);
        updateTicker(ticker, {
          ...(sig || {}),
          fundamentalScore: fundScore,
          fundamentals: fundData[ticker + '.NS'] || prev.fundamentals || null,
        });
      }
      const timeLeft = timeUntilOpen();
      st.setLastUpdated(`Closed${timeLeft ? ` · opens in ${timeLeft}` : ''}`);
      return;
    }

    st.setLoading('screener', true);
    try {
      const [{ quotes, unauthorized }, fundData] = await Promise.all([getMarketQuotes(), fetchFundamentals()]);
      if (unauthorized) {
        st.setError('Upstox token rejected or expired — update it in Settings');
        return;
      }
      st.setError(null);
      const keys = Object.keys(quotes);

      st.setScreenerData(prevData => {
        const data = { ...prevData };
        const { candleCache } = useStore.getState();
        for (const k of keys) {
          const q = quotes[k];
          const ticker = tickerForQuote(k, q);
          if (!ticker || !UNIVERSE[ticker]) continue;

          const prev = data[ticker] || {};
          const daily = candleCache[ticker]?.daily;
          const avgVol = daily?.length >= 20
            ? (daily.slice(-20).reduce((a, c) => a + c.volume, 0) / 20) || null
            : null;
          const fundScore = fundData[ticker + '.NS']?.score ?? null;
          const sig = signalFields(daily, fundScore) || {
            signalScore: prev.signalScore ?? null,
            signal: prev.signal ?? null,
            breakdown: prev.breakdown ?? {},
            signalWarning: prev.signalWarning || 'Price history not yet loaded',
          };
          const prevClose = q.prev_close_price || q.ohlc?.close;
          const changePct = q.net_change_percentage
            ?? (q.net_change != null && prevClose ? (q.net_change / (q.last_price - q.net_change)) * 100 : null)
            ?? (prevClose ? ((q.last_price - prevClose) / prevClose) * 100 : null);

          data[ticker] = {
            ...prev,
            ticker,
            ...UNIVERSE[ticker],
            ...sig,
            ltp: q.last_price,
            open: q.ohlc?.open,
            high: q.ohlc?.high,
            low: q.ohlc?.low,
            changePct,
            volume: q.volume,
            avgVolume: avgVol,
            relVol: avgVol && q.volume != null ? q.volume / avgVol : null,
            fundamentalScore: fundScore,
            fundamentals: fundData[ticker + '.NS'] || null,
            week52High: q['52_week_high'] ?? sig.week52High ?? prev.week52High ?? null,
            week52Low: q['52_week_low'] ?? sig.week52Low ?? prev.week52Low ?? null,
          };
        }
        return data;
      });

      // Candle history for signals loads slowly in the background (rate limits).
      loadMissingHistory(keys.map(k => tickerForQuote(k, quotes[k])).filter(t => t && UNIVERSE[t]));

      st.setLastUpdated(new Date().toLocaleTimeString('en-IN'));
    } catch (err) {
      console.error('[screener poll]', err);
      st.setError(err?.message || 'Quote fetch failed');
    } finally {
      st.setLoading('screener', false);
    }
  }, []);

  // ── Watchlist ticker fetch (live only, no random fallback) ─────────────────
  const fetchWatchlistTicker = useCallback(async (ticker, force = false) => {
    const st = useStore.getState();
    if (!st.apiToken) {
      st.setNeedsApiToken(true);
      return;
    }
    if (!force && st.candleCache[ticker]?.daily?.length) return;

    try {
      st.setLoading('candles', true);
      const candles = await getHistoricalCandles(ticker).catch(() => ({ daily: [], intraday: [] }));
      const sig = signalFields(candles.daily, st.screenerData[ticker]?.fundamentalScore ?? null);
      if (sig) {
        st.setCandleCache(ticker, candles);
        const last = candles.daily[candles.daily.length - 1];
        const prev = candles.daily[candles.daily.length - 2];
        const existing = useStore.getState().screenerData[ticker];
        st.updateTicker(ticker, {
          ticker,
          name: UNIVERSE[ticker]?.name || candles.name || ticker,
          sector: UNIVERSE[ticker]?.sector || '–',
          ...sig,
          // keep a live quote if the screener already has one
          ltp: existing?.ltp ?? last?.close,
          changePct: existing?.changePct ?? (prev ? ((last.close - prev.close) / prev.close) * 100 : null),
        });
      } else {
        st.updateTicker(ticker, {
          ticker,
          name: UNIVERSE[ticker]?.name || ticker,
          sector: UNIVERSE[ticker]?.sector || '–',
          signalWarning: 'Insufficient price history returned from API',
        });
      }
    } catch (e) {
      console.error('[watchlist fetch]', ticker, e);
    } finally {
      useStore.getState().setLoading('candles', false);
    }
  }, []);

  return { pollOnce: () => poll({ force: true }), poll, fetchWatchlistTicker, apiToken };
}

// ── Poll loop — mount once ─────────────────────────────────────────────────
export function useScreenerPolling() {
  const apiToken = useStore(s => s.apiToken);
  const watchlist = useStore(s => s.watchlist);
  const { poll, fetchWatchlistTicker } = useScreenerData();

  useEffect(() => {
    let timerId;
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      await poll();
      if (!stopped && useStore.getState().apiToken) timerId = setTimeout(run, getPollInterval());
    };
    run();
    return () => { stopped = true; clearTimeout(timerId); };
  }, [poll, apiToken]);

  useEffect(() => {
    if (!apiToken) return;
    for (const ticker of watchlist) fetchWatchlistTicker(ticker);
  }, [watchlist, apiToken, fetchWatchlistTicker]);
}

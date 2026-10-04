/**
 * useScreenerData.js
 * Polls Upstox API every 30s for universe stocks.
 * Also fetches data for custom watchlist tickers on demand.
 */
import { useEffect, useCallback, useRef } from 'react';
import { useStore } from '../lib/store';
import { TICKERS, UNIVERSE, getMarketQuotes, getHistoricalCandles, testConnection } from '../lib/upstoxApi';
import { computeSignalScore } from '../lib/indicators';

// ── Demo price seeds (realistic NSE levels) ────────────────────────────────
const PRICE_SEEDS = {
  RELIANCE:1280,TCS:3850,HDFCBANK:1720,INFY:1550,ICICIBANK:1050,
  HINDUNILVR:2450,SBIN:815,BHARTIARTL:1590,ITC:470,KOTAKBANK:1780,
  LT:3620,AXISBANK:1150,ASIANPAINT:2750,BAJFINANCE:6900,MARUTI:12500,
  HCLTECH:1720,SUNPHARMA:1730,TITAN:3450,WIPRO:560,ULTRACEMCO:10400,
  NTPC:385,POWERGRID:320,ONGC:285,DRREDDY:6800,TATAMOTORS:985,
};

const demoPrices = {};
function nextDemoPrice(ticker) {
  if (!demoPrices[ticker]) demoPrices[ticker] = PRICE_SEEDS[ticker] || 1000;
  const drift = (Math.random() - 0.495) * 0.008;
  demoPrices[ticker] *= (1 + drift);
  return demoPrices[ticker];
}

const demoCandles = {};
function getDemoCandles(ticker) {
  if (demoCandles[ticker]) return demoCandles[ticker];
  const seed = PRICE_SEEDS[ticker] || 1000;
  let price = seed * 0.75;
  const candles = [];
  const now = new Date();
  for (let i = 252; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    price *= 1 + (Math.random() - 0.49) * 0.022;
    const open  = price * (1 + (Math.random() - 0.5) * 0.005);
    const close = price;
    const high  = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low   = Math.min(open, close) * (1 - Math.random() * 0.01);
    const vol   = Math.floor(500000 + Math.random() * 2000000);
    candles.push({ date: d.toISOString().split('T')[0], open, high, low, close, volume: vol });
  }
  demoCandles[ticker] = candles;
  return candles;
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useScreenerData() {
  const {
    apiToken, setScreenerData, updateTicker,
    setCandleCache, candleCache, setNLPSentiments,
    setMarketOpen, setLastUpdated, setLoading, nlpSentiments,
    watchlist,
  } = useStore();

  const isDemo = !apiToken;

  // Main screener poll
  const poll = useCallback(async () => {
    setLoading('screener', true);
    try {
      if (isDemo) {
        const now = new Date();
        const data = {};
        for (const ticker of TICKERS) {
          const candles  = getDemoCandles(ticker);
          const ltp      = nextDemoPrice(ticker);
          const prev     = candles[candles.length - 2]?.close || ltp;
          const changePct = (ltp - prev) / prev * 100;
          const { score, signal, breakdown, indicators } = computeSignalScore(candles, nlpSentiments[ticker] ?? 0, 50);
          const avgVol = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
          data[ticker] = {
            ticker, ...UNIVERSE[ticker],
            ltp, open: candles[candles.length-1].open,
            high: candles[candles.length-1].high,
            low:  candles[candles.length-1].low,
            changePct, volume: candles[candles.length-1].volume, avgVolume: avgVol,
            signalScore: score, signal, breakdown,
            rsi: indicators?.rsiVal, ema21: indicators?.ema21, ema50: indicators?.ema50,
            adx: indicators?.adxVal, bbUp: indicators?.bbUp, bbLow: indicators?.bbLow,
            stTrend: indicators?.stTrend,
            nlpSentiment: nlpSentiments[ticker] ?? (Math.random() - 0.5) * 0.6,
            fundamentalScore: 40 + Math.random() * 40,
            week52High: Math.max(...candles.slice(-252).map(c => c.high)),
            week52Low:  Math.min(...candles.slice(-252).map(c => c.low)),
          };
          if (!candleCache[ticker]) setCandleCache(ticker, { daily: candles, intraday: [] });
        }
        setScreenerData(data);
        setMarketOpen(false);
      } else {
        // ── Live mode ──────────────────────────────────────────────────────
        const marketOpen = await testConnection().catch(() => false);
        setMarketOpen(marketOpen);

        const quotes = await getMarketQuotes();
        const keys = Object.keys(quotes);
        setScreenerData(prevData => {
          let data = { ...prevData };
          for (const k of keys) {
            const q = quotes[k];
            const ticker = q.symbol || TICKERS.find(t => UNIVERSE[t]?.key === k) || k.split(':')[1];
            if (!ticker || !UNIVERSE[ticker]) continue;

            let prev = data[ticker] || {};
            let candles = candleCache[ticker];
            const avgVol = candles?.daily ? candles.daily.slice(-20).reduce((a, c) => a + c.volume, 0) / 20 || 1 : 1;
            const nlp  = nlpSentiments[ticker] ?? 0;

            let indicators = prev;
            if (candles?.daily?.length) {
              const { score, signal, breakdown, indicators: ind } = computeSignalScore(candles.daily, nlp, 50);
              indicators = { signalScore: score, signal, breakdown, rsi: ind?.rsiVal, ema21: ind?.ema21, ema50: ind?.ema50, adx: ind?.adxVal, bbUp: ind?.bbUp, bbLow: ind?.bbLow, stTrend: ind?.stTrend };
            }

            data[ticker] = {
              ticker, ...UNIVERSE[ticker], ...indicators,
              ltp: q.last_price, open: q.ohlc?.open, high: q.ohlc?.high, low: q.ohlc?.low,
              changePct: q.net_change_percentage ?? ((q.last_price - (q.prev_close_price || q.ohlc?.close)) / (q.prev_close_price || q.ohlc?.close)) * 100,
              volume: q.volume, avgVolume: avgVol, nlpSentiment: nlp, fundamentalScore: 50,
              week52High: q['52_week_high'] ?? (candles?.daily ? Math.max(...candles.daily.slice(-252).map(c => c.high)) : q.last_price),
              week52Low:  q['52_week_low']  ?? (candles?.daily ? Math.min(...candles.daily.slice(-252).map(c => c.low)) : q.last_price),
            };
          }
          return data;
        });

        // Background history fetch
        if (!window.__isFetchingHistory) {
          window.__isFetchingHistory = true;
          (async () => {
            try {
              for (const k of keys) {
                const q = quotes[k];
                const ticker = q.symbol || TICKERS.find(t => UNIVERSE[t]?.key === k) || k.split(':')[1];
                if (!ticker || !UNIVERSE[ticker]) continue;
                if (!candleCache[ticker]) {
                  const data = await getHistoricalCandles(ticker).catch(() => ({ daily: [], intraday: [] }));
                  if (data.daily.length || data.intraday.length) setCandleCache(ticker, data);
                  await new Promise(r => setTimeout(r, 1500));
                }
              }
            } finally {
              window.__isFetchingHistory = false;
            }
          })();
        }
      }
      setLastUpdated(new Date().toLocaleTimeString('en-IN'));
    } catch (err) {
      console.error('[screener poll]', err);
    } finally {
      setLoading('screener', false);
    }
  }, [apiToken, nlpSentiments, candleCache, isDemo]);

  // ── Watchlist ticker fetch ────────────────────────────────────────────────
  // Works in both demo mode (generates synthetic candles) and live mode.
  // `force` skips the already-cached check.
  const fetchWatchlistTicker = useCallback(async (ticker, force = false) => {
    if (!force && candleCache[ticker]?.daily?.length) return; // already have data

    try {
      setLoading('candles', true);

      let candles;
      if (!apiToken) {
        // ── Demo mode: generate synthetic candles ──────────────────────────
        const seed = PRICE_SEEDS[ticker] || 1200;
        let price = seed * 0.75;
        const daily = [];
        const now = new Date();
        for (let i = 365; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          price *= 1 + (Math.random() - 0.49) * 0.018;
          const open  = price * (1 + (Math.random() - 0.5) * 0.005);
          const close = price;
          const high  = Math.max(open, close) * (1 + Math.random() * 0.01);
          const low   = Math.min(open, close) * (1 - Math.random() * 0.01);
          const vol   = Math.floor(300000 + Math.random() * 2000000);
          daily.push({ date: d.toISOString(), open, high, low, close, volume: vol });
        }
        candles = { daily, intraday: [] };
      } else {
        // ── Live mode: fetch from Upstox ─────────────────────────────────
        candles = await getHistoricalCandles(ticker).catch(() => ({ daily: [], intraday: [] }));
      }

      if (candles.daily.length) {
        setCandleCache(ticker, candles);
        const { score, signal, breakdown, indicators } = computeSignalScore(candles.daily, 0, 50);
        const lastCandle = candles.daily[candles.daily.length - 1];
        const prevCandle = candles.daily[candles.daily.length - 2];
        const changePct  = prevCandle ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100 : 0;
        updateTicker(ticker, {
          ticker,
          name: UNIVERSE[ticker]?.name || ticker,
          sector: UNIVERSE[ticker]?.sector || 'Watchlist',
          signalScore: score, signal, breakdown,
          rsi: indicators?.rsiVal, ema21: indicators?.ema21, ema50: indicators?.ema50,
          adx: indicators?.adxVal, bbUp: indicators?.bbUp, bbLow: indicators?.bbLow,
          stTrend: indicators?.stTrend,
          ltp: lastCandle?.close,
          changePct,
          week52High: Math.max(...candles.daily.slice(-252).map(c => c.high)),
          week52Low:  Math.min(...candles.daily.slice(-252).map(c => c.low)),
        });
      }
    } catch (e) {
      console.error('[watchlist fetch]', ticker, e);
    } finally {
      setLoading('candles', false);
    }
  }, [apiToken, candleCache, setCandleCache, updateTicker, setLoading]);

  useEffect(() => {
    let timerId;
    let isUnmounted = false;

    const runPoll = async () => {
      if (isUnmounted) return;
      await poll();
      if (!isUnmounted) timerId = setTimeout(runPoll, 30000); // 30s poll
    };
    runPoll();

    return () => {
      isUnmounted = true;
      clearTimeout(timerId);
    };
  }, [poll]);

  // Eagerly fetch all watchlist tickers on mount / watchlist change
  useEffect(() => {
    for (const ticker of watchlist) {
      fetchWatchlistTicker(ticker); // skips if already cached
    }
  }, [watchlist]); // intentionally exclude fetchWatchlistTicker to avoid loop

  return { pollOnce: poll, fetchWatchlistTicker };
}

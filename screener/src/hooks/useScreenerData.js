/**
 * useScreenerData.js
 * Polls Upstox API every 30s, falls back to synthetic demo data without a token.
 */
import { useEffect, useCallback, useRef } from 'react';
import { useStore } from '../lib/store';
import { TICKERS, UNIVERSE, getMarketQuotes, getHistoricalCandles, testConnection } from '../lib/upstoxApi';
import { computeSignalScore, ema, rsi } from '../lib/indicators';

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

// Pre-build 252 days of synthetic daily candles
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
  } = useStore();

  const isDemo = !apiToken;

  // Fetch NLP sentiments from the Python backend
  const fetchNLP = useCallback(async () => {
    try {
      const res = await fetch('/api/screener');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.scores) setNLPSentiments(data.scores);
    } catch { /* backend not running — ignore */ }
  }, [setNLPSentiments]);

  // Main poll function
  const poll = useCallback(async () => {
    setLoading('screener', true);
    try {
      if (isDemo) {
        // ── Demo mode: generate synthetic data ──────────────────────────
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
          if (!candleCache[ticker]) setCandleCache(ticker, candles);
        }
        setScreenerData(data);
        setMarketOpen(false);
      } else {
        // ── Live mode: call Upstox API ──────────────────────────────────
        const marketOpen = await testConnection().catch(() => false);
        setMarketOpen(marketOpen);

        const quotes = await getMarketQuotes();
        const keys = Object.keys(quotes);
        setScreenerData(prevData => {
          let data = { ...prevData }; // preserve previous state
          
          // 1. Instant UI update with LTP
          for (const k of keys) {
            const q = quotes[k];
            const ticker = q.symbol || TICKERS.find(t => UNIVERSE[t].key === k) || k.split(':')[1];
            if (!ticker || !UNIVERSE[ticker]) continue;
            
            let prev = data[ticker] || {};
            let candles = candleCache[ticker]; // this is now {daily, intraday}
            
            const avgVol = candles?.daily ? candles.daily.slice(-20).reduce((a, c) => a + c.volume, 0) / 20 || 1 : 1;
            const nlp  = nlpSentiments[ticker] ?? 0;
            
            let indicators = prev; // retain previous indicators if candles not loaded
            if (candles?.daily?.length) {
               // Compute signal based on Daily to ensure stability (since 5m intraday might only have a few ticks early in the day)
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
        }); // INSTANT UPDATE
        
        // 2. Background Historical Fetch (Progressive)
        if (!window.__isFetchingHistory) {
          window.__isFetchingHistory = true;
          (async () => {
            try {
              for (const k of keys) {
                const q = quotes[k];
                const ticker = q.symbol || TICKERS.find(t => UNIVERSE[t].key === k) || k.split(':')[1];
                if (!ticker || !UNIVERSE[ticker]) continue;
                if (!candleCache[ticker]) {
                  const data = await getHistoricalCandles(ticker).catch(() => ({ daily: [], intraday: [] }));
                  if (data.daily.length || data.intraday.length) {
                    setCandleCache(ticker, data);
                  }
                  await new Promise(r => setTimeout(r, 600)); // Respect 10/sec rate limit safely
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


  useEffect(() => {
    fetchNLP();
    const nlpInterval = setInterval(fetchNLP, 60000);
    let timerId;
    let isUnmounted = false;

    const runPoll = async () => {
      if (isUnmounted) return;
      await poll();
      if (!isUnmounted) timerId = setTimeout(runPoll, 5000);
    };
    runPoll();

    return () => { 
      isUnmounted = true;
      clearInterval(nlpInterval); 
      clearTimeout(timerId); 
    };
  }, [poll, fetchNLP]);

  return { pollOnce: poll };
}

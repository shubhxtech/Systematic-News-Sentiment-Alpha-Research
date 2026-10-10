/**
 * useScreenerData.js
 *
 * Fetches real market data from Upstox.
 * If no API token is configured, sets needsApiToken=true and stops.
 * No synthetic / random data is ever generated.
 */
import { useEffect, useCallback, useRef } from 'react';
import { useStore } from '../lib/store';
import {
  TICKERS, UNIVERSE,
  getMarketQuotes, getHistoricalCandles, testConnection,
} from '../lib/upstoxApi';
import { computeSignal } from '../lib/signal';
import {
  isMarketOpen, isPreOpen, getMarketStatus, getPollInterval, shouldSkipLiveQuotes, timeUntilOpen,
} from '../lib/marketHours';

// ── Hook ───────────────────────────────────────────────────────────────────
export function useScreenerData() {
  const {
    apiToken,
    setScreenerData,
    updateTicker,
    setCandleCache,
    candleCache,
    setMarketOpen,
    setLastUpdated,
    setLoading,
    setNeedsApiToken,
    nlpSentiments,
    setNLPSentiments,  // Fix: was called but never destructured → silent TypeError
    watchlist,
    screenerData,
  } = useStore();

  // ── Main screener poll (live data only) ────────────────────────────────────
  const poll = useCallback(async () => {
    if (!apiToken) {
      setNeedsApiToken(true);
      return;
    }
    setNeedsApiToken(false);

    const marketStatus = getMarketStatus();
    const skipLive = shouldSkipLiveQuotes();
    setMarketOpen(marketStatus === 'open');

    // ── When market is closed: skip live quotes, just recompute signals ───────
    if (skipLive) {
      // Only show loading on the first call (when store is empty)
      const { screenerData } = useStore.getState();
      if (Object.keys(screenerData).length === 0) {
        setLoading('screener', true);
      }

      // Still fetch NLP / fundamentals if we don't have them yet
      let nlpData = nlpSentiments;
      if (!Object.keys(nlpData).length) {
        try {
          const res = await fetch('/api/sentiment/summary');
          if (res.ok) { nlpData = await res.json(); setNLPSentiments(nlpData); }
        } catch (e) { console.warn('NLP fetch failed', e); }
      }

      try {
        const res = await fetch('/api/fundamentals');
        if (res.ok) {
          const parsed = await res.json();
          const fundData = parsed.stocks || {};
          // Recompute signals with latest fundamentals but keep last prices
          const { screenerData } = useStore.getState();
          for (const [ticker, prev] of Object.entries(screenerData)) {
            const candles = candleCache[ticker];
            if (!candles?.daily?.length || candles.daily.length < 50) continue;
            const nlp = nlpData[ticker]?.score_7d ?? null;
            const fundScore = fundData[ticker + '.NS']?.score ?? null;
            const { score, signal, breakdown, indicators, warning } =
              computeSignal(candles.daily, { nlpScore: nlp, fundamentalScore: fundScore });
            updateTicker(ticker, {
              signalScore: score, signal, breakdown,
              signalWarning: warning,
              rsi: indicators?.rsiVal,
              fundamentalScore: fundScore,
              fundamentals: fundData[ticker + '.NS'] || prev.fundamentals || null,
              nlpSentiment: nlp,
              nlpSummary: nlpData[ticker] || prev.nlpSummary || null,
            });
          }
        }
      } catch (e) { console.warn('Fundamentals fetch failed (closed market)', e); }

      const timeLeft = timeUntilOpen();
      setLastUpdated(`Closed${timeLeft ? ` · opens in ${timeLeft}` : ''}`);
      setLoading('screener', false);
      return;
    }

    // ── Market is open: full live fetch ──────────────────────────────────────
    setLoading('screener', true);
    try {
      const quotes = await getMarketQuotes();
      const keys   = Object.keys(quotes);

      // 1. Fetch sentiment and fundamentals if missing
      let nlpData = nlpSentiments;
      if (!Object.keys(nlpData).length) {
        try {
          const res = await fetch('/api/sentiment/summary');
          if (res.ok) {
            nlpData = await res.json();
            setNLPSentiments(nlpData);
          }
        } catch (e) {
          console.error("Failed to fetch NLP sentiment", e);
        }
      }

      let fundData = {};
      try {
        const res = await fetch('/api/fundamentals');
        if (res.ok) {
          const parsed = await res.json();
          fundData = parsed.stocks || {};
        }
      } catch (e) {
        console.error("Failed to fetch fundamentals", e);
      }

      setScreenerData(prevData => {
        const data = { ...prevData };
        for (const k of keys) {
          const q      = quotes[k];
          const ticker = q.symbol
            || TICKERS.find(t => UNIVERSE[t]?.key === k)
            || k.split(':')[1];
          if (!ticker || !UNIVERSE[ticker]) continue;

          const prev    = data[ticker] || {};
          const candles = candleCache[ticker];
          const avgVol  = candles?.daily?.length
            ? candles.daily.slice(-20).reduce((a, c) => a + c.volume, 0) / 20 || 1
            : null;
          
          // nlpData has keys like 'RELIANCE', ticker is 'RELIANCE'
          const nlp = nlpData[ticker]?.score_7d ?? null;
          const fundScore = fundData[ticker + '.NS']?.score ?? null;

          // Only compute signals when we have candle history
          let signalData = {};
          if (candles?.daily?.length >= 50) {
            const { score, signal, breakdown, indicators, warning } =
              computeSignal(candles.daily, { nlpScore: nlp, fundamentalScore: fundScore });
            signalData = {
              signalScore:   score,
              signal:        signal,
              breakdown,
              signalWarning: warning,
              ...indicators,
              rsi:    indicators?.rsiVal,
            };
          } else {
            // Keep old signal data if we had it; else null
            signalData = {
              signalScore:  prev.signalScore  ?? null,
              signal:       prev.signal       ?? null,
              breakdown:    prev.breakdown    ?? {},
              signalWarning: 'Price history not yet loaded',
            };
          }

          data[ticker] = {
            ticker,
            ...UNIVERSE[ticker],
            ...signalData,
            ltp:        q.last_price,
            open:       q.ohlc?.open,
            high:       q.ohlc?.high,
            low:        q.ohlc?.low,
            changePct:  q.net_change_percentage
              ?? ((q.last_price - (q.prev_close_price || q.ohlc?.close))
                  / (q.prev_close_price || q.ohlc?.close)) * 100,
            volume:     q.volume,
            avgVolume:  avgVol,
            nlpSentiment: nlp,
            fundamentalScore: fundScore,
            fundamentals: fundData[ticker + '.NS'] || null,
            nlpSummary: nlpData[ticker] || null,
            week52High: q['52_week_high']
              ?? (candles?.daily ? Math.max(...candles.daily.slice(-252).map(c => c.high)) : null),
            week52Low:  q['52_week_low']
              ?? (candles?.daily ? Math.min(...candles.daily.slice(-252).map(c => c.low)) : null),
          };
        }
        return data;
      });

      // Background history fetch — only run when market open (data will be fresh)
      // Skip if market just closed (candles won't have changed since yesterday)
      if (!window.__isFetchingHistory && isMarketOpen()) {
        window.__isFetchingHistory = true;
        (async () => {
          try {
            for (const k of keys) {
              const q      = quotes[k];
              const ticker = q.symbol
                || TICKERS.find(t => UNIVERSE[t]?.key === k)
                || k.split(':')[1];
              if (!ticker || !UNIVERSE[ticker] || candleCache[ticker]) continue;
              const result = await getHistoricalCandles(ticker)
                .catch(() => ({ daily: [], intraday: [] }));
              if (result.daily.length || result.intraday.length) {
                setCandleCache(ticker, result);
                // Recompute signal now that we have candles
                if (result.daily.length >= 50) {
                  const nlp = nlpSentiments[ticker] ?? null;
                  const { score, signal, breakdown, indicators, warning } =
                    computeSignal(result.daily, { nlpScore: nlp, fundamentalScore: null });
                  updateTicker(ticker, {
                    signalScore:   score,
                    signal,
                    breakdown,
                    signalWarning: warning,
                    rsi:    indicators?.rsiVal,
                    ema21:  indicators?.ema21,
                    ema50:  indicators?.ema50,
                    adx:    indicators?.adxVal,
                    bbUp:   indicators?.bbUp,
                    bbLow:  indicators?.bbLow,
                    stTrend: indicators?.stTrend,
                    week52High: Math.max(...result.daily.slice(-252).map(c => c.high)),
                    week52Low:  Math.min(...result.daily.slice(-252).map(c => c.low)),
                  });
                }
              }
              await new Promise(r => setTimeout(r, 1500));
            }
          } finally {
            window.__isFetchingHistory = false;
          }
        })();
      }

      setLastUpdated(new Date().toLocaleTimeString('en-IN'));
    } catch (err) {
      console.error('[screener poll]', err);
    } finally {
      setLoading('screener', false);
    }
  }, [apiToken, nlpSentiments, setNLPSentiments, candleCache, setCandleCache, setLastUpdated, setLoading, setMarketOpen, setNeedsApiToken, setScreenerData, updateTicker]);

  // ── Watchlist ticker fetch (live only, no random fallback) ─────────────────
  const fetchWatchlistTicker = useCallback(async (ticker, force = false) => {
    if (!apiToken) {
      setNeedsApiToken(true);
      return;
    }
    if (!force && candleCache[ticker]?.daily?.length) return;

    try {
      setLoading('candles', true);
      const candles = await getHistoricalCandles(ticker)
        .catch(() => ({ daily: [], intraday: [] }));

      if (candles.daily.length >= 50) {
        setCandleCache(ticker, candles);
        const nlp = nlpSentiments[ticker] ?? null;
        const { score, signal, breakdown, indicators, warning } =
          computeSignal(candles.daily, { nlpScore: nlp, fundamentalScore: null });
        const last = candles.daily[candles.daily.length - 1];
        const prev = candles.daily[candles.daily.length - 2];
        const changePct = prev ? ((last.close - prev.close) / prev.close) * 100 : null;
        updateTicker(ticker, {
          ticker,
          name:    UNIVERSE[ticker]?.name    || ticker,
          sector:  UNIVERSE[ticker]?.sector  || '–',
          signalScore:   score,
          signal,
          breakdown,
          signalWarning: warning,
          rsi:    indicators?.rsiVal,
          ema21:  indicators?.ema21,
          ema50:  indicators?.ema50,
          adx:    indicators?.adxVal,
          bbUp:   indicators?.bbUp,
          bbLow:  indicators?.bbLow,
          stTrend: indicators?.stTrend,
          ltp:       last?.close,
          changePct,
          week52High: Math.max(...candles.daily.slice(-252).map(c => c.high)),
          week52Low:  Math.min(...candles.daily.slice(-252).map(c => c.low)),
        });
      } else {
        // Not enough history — mark it so the UI can show a warning
        updateTicker(ticker, {
          ticker,
          name:    UNIVERSE[ticker]?.name || ticker,
          sector:  UNIVERSE[ticker]?.sector || '–',
          signalWarning: 'Insufficient price history returned from API',
        });
      }
    } catch (e) {
      console.error('[watchlist fetch]', ticker, e);
    } finally {
      setLoading('candles', false);
    }
  }, [apiToken, candleCache, nlpSentiments, setCandleCache, setLoading, setNeedsApiToken, updateTicker]);

  // ── Poll loop — interval adapts to market hours ────────────────────────────
  useEffect(() => {
    let timerId;
    let isUnmounted = false;

    const runPoll = async () => {
      if (isUnmounted) return;
      await poll();
      if (!isUnmounted && apiToken) {
        // Use market-aware interval: 30s during live, much longer when closed
        const interval = getPollInterval();
        timerId = setTimeout(runPoll, interval);
      }
    };
    runPoll();

    return () => {
      isUnmounted = true;
      clearTimeout(timerId);
    };
  }, [poll, apiToken]);

  // ── Fetch all watchlist tickers when watchlist changes ─────────────────────
  useEffect(() => {
    if (!apiToken) return;
    for (const ticker of watchlist) {
      fetchWatchlistTicker(ticker);
    }
  }, [watchlist, apiToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pollOnce: poll, fetchWatchlistTicker };
}

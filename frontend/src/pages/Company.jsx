import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { createChart, CrosshairMode, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { ema } from '../lib/indicators';
import { ArrowLeft, Activity, BookOpen, Check, X, Newspaper, ExternalLink, Clock, TrendingUp } from 'lucide-react';
import { inr, pct, signalLabel, signalClass } from '../lib/format';
import { getHistoricalCandles, UNIVERSE } from '../lib/upstoxApi';
import { computeSignal } from '../lib/signal';

export default function Company() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const { screenerData, candleCache, theme, updateTicker, setCandleCache } = useStore();
  const data = screenerData[symbol];
  
  const [loadError, setLoadError] = useState(null);
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);

  const chartContainerRef = useRef();
  
  const cache = candleCache[symbol] || { daily: [], intraday: [] };
  const candles = cache['daily'] || [];

  // Fetch candle data and initialize ticker if missing (handles direct navigation / refresh)
  useEffect(() => {
    if (!symbol) return;
    let active = true;

    async function loadData() {
      if (!candles.length || !data) {
        try {
          const res = await getHistoricalCandles(symbol);
          if (!active) return;
          if (res?.daily?.length) {
            setCandleCache(symbol, res);
            const last = res.daily[res.daily.length - 1];
            const prev = res.daily[res.daily.length - 2];
            const changePct = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
            const { score, signal, breakdown, indicators, warning } = computeSignal(res.daily);
            updateTicker(symbol, {
              ticker: symbol,
              name: UNIVERSE[symbol]?.name || symbol,
              sector: UNIVERSE[symbol]?.sector || '–',
              ltp: last?.close,
              changePct,
              signalScore: score,
              signal,
              breakdown,
              signalWarning: warning,
              rsi: indicators?.rsiVal,
              ema21: indicators?.ema21,
              ema50: indicators?.ema50,
              volume: last?.volume,
              week52High: Math.max(...res.daily.slice(-252).map(c => c.high)),
              week52Low: Math.min(...res.daily.slice(-252).map(c => c.low)),
            });
          }
        } catch (e) {
          if (active) setLoadError(e.message);
        }
      }
    }

    loadData();
    return () => { active = false; };
  }, [symbol, candles.length, data, setCandleCache, updateTicker]);

  // Fetch company news
  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setNewsLoading(true);

    const query = data?.name || UNIVERSE[symbol]?.name || symbol;
    fetch(`/api/news?q=${encodeURIComponent(query)}&ticker=${symbol}`)
      .then(res => res.json())
      .then(d => {
        if (active) setNews(Array.isArray(d) ? d : []);
      })
      .catch(err => {
        console.error('Failed to load company news:', err);
        if (active) setNews([]);
      })
      .finally(() => {
        if (active) setNewsLoading(false);
      });

    return () => { active = false; };
  }, [symbol, data?.name]);

  const chartData = useMemo(() => {
    if (!candles.length) return { prices: [], volume: [], ema21: [], ema50: [] };
    
    const closes = candles.map(c => c.close);
    const ema21Data = ema(closes, 21);
    const ema50Data = ema(closes, 50);

    const prices = [];
    const volume = [];
    const e21 = [];
    const e50 = [];

    candles.forEach((c, i) => {
      const time = Math.floor(new Date(c.date).getTime() / 1000);
      prices.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
      volume.push({
        time,
        value: c.volume,
        color: c.close > c.open ? 'rgba(11, 138, 75, 0.5)' : 'rgba(198, 40, 40, 0.5)'
      });
      if (ema21Data[i] != null) e21.push({ time, value: ema21Data[i] });
      if (ema50Data[i] != null) e50.push({ time, value: ema50Data[i] });
    });

    return { prices, volume, ema21: e21, ema50: e50 };
  }, [candles]);

  useEffect(() => {
    if (!chartContainerRef.current || !chartData.prices.length) return;

    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: v('--text-muted') },
      grid: { vertLines: { color: v('--border') }, horzLines: { color: v('--border') } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: v('--border') },
      timeScale: { borderColor: v('--border') },
      autoSize: true,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: v('--up'), downColor: v('--down'), borderVisible: false, wickUpColor: v('--up'), wickDownColor: v('--down')
    });
    candlestickSeries.setData(chartData.prices);

    const ema21Series = chart.addSeries(LineSeries, { color: v('--accent'), lineWidth: 2, title: 'EMA 21' });
    ema21Series.setData(chartData.ema21);

    const ema50Series = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 2, title: 'EMA 50' });
    ema50Series.setData(chartData.ema50);

    return () => chart.remove();
  }, [chartData, theme]);

  if (!data && !loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-10 text-[var(--text-muted)]">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium">Loading market data for {symbol}...</p>
      </div>
    );
  }

  if (!data && loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-10 text-[var(--text-muted)] space-y-4">
        <p className="text-sm text-[var(--down)]">Could not load data for {symbol}: {loadError}</p>
        <button onClick={() => navigate(-1)} className="btn btn-primary text-xs">
          <ArrowLeft size={14} /> Go Back
        </button>
      </div>
    );
  }

  const isUp = (data.changePct || 0) >= 0;
  
  const price = data.ltp || 0;
  const ema21 = data.ema21 || 0;
  const ema50 = data.ema50 || 0;
  const rsi = data.rsi || 0;
  const macdHistogram = data.breakdown?.macd || 0;

  const checks = [
    { label: 'Price > EMA 50', passed: price > ema50 },
    { label: 'Trend is Up (EMA 21 > EMA 50)', passed: ema21 > ema50 },
    { label: 'Momentum is Positive (RSI > 50)', passed: rsi > 50 },
    { label: 'MACD is Bullish', passed: macdHistogram > 0 },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* ── Top Header ─────────────────────────────────────────────────────── */}
      <div className="border-b flex items-center px-6 py-4 shrink-0 gap-6" style={{ borderColor: 'var(--border)' }}>
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-[var(--bg-hover)] rounded-md transition-colors" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={20} />
        </button>
        
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>{data.ticker}</h1>
            <span className="text-xs uppercase font-bold tracking-wide px-2 py-0.5 rounded" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              {data.sector}
            </span>
          </div>
          <div className="text-sm" style={{ color: 'var(--text-faint)' }}>{data.name}</div>
        </div>

        <div className="text-right">
          <div className="text-3xl font-bold num tracking-tight" style={{ color: 'var(--text)' }}>₹{inr(data.ltp)}</div>
          <div className="text-base font-semibold mt-1 num" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
            {isUp ? '+' : ''}{pct(data.changePct)}
          </div>
        </div>
        
        {/* Additional Stats */}
        <div className="hidden lg:flex items-center gap-8 pl-8 border-l ml-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>Volume</div>
            <div className="text-sm font-semibold num" style={{ color: 'var(--text)' }}>{data.volume ? inr(data.volume) : '--'}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>52W High</div>
            <div className="text-sm font-semibold num" style={{ color: 'var(--text)' }}>{data.week52High ? `₹${inr(data.week52High)}` : '--'}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>52W Low</div>
            <div className="text-sm font-semibold num" style={{ color: 'var(--text)' }}>{data.week52Low ? `₹${inr(data.week52Low)}` : '--'}</div>
          </div>
        </div>
      </div>

      {/* ── Main Content Grid ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        
        {/* Left Chart Area */}
        <div className="flex-[2] border-b md:border-b-0 md:border-r flex flex-col min-h-[400px]" style={{ borderColor: 'var(--border)' }}>
          <div className="px-5 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-subtle)' }}>
            <span className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text)' }}>Technical Chart (Daily)</span>
          </div>
          <div className="flex-1 p-2">
            <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Right Details Panel */}
        <div className="flex-1 overflow-auto p-6 space-y-6 bg-opacity-50" style={{ background: 'var(--bg-subtle)' }}>
          
          {/* Signal */}
          <div className="card shadow-sm">
            <div className="card-header border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <span className="card-title flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                <Activity size={15} style={{ color: 'var(--accent)' }} /> 
                Quantitative Signal
              </span>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold num tracking-tighter" style={{ color: 'var(--text)' }}>
                    {data.signalScore != null ? Math.abs(data.signalScore) : '--'}
                  </span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-faint)' }}>/ 100</span>
                </div>
                {data.signal && (
                  <span className={`signal-badge px-3 py-1 text-sm font-bold shadow-sm ${signalClass(data.signal)}`}>
                    {signalLabel(data.signal)}
                  </span>
                )}
              </div>
              
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text)] border-b pb-2" style={{ borderColor: 'var(--border)' }}>Buy Setup Checklist</h4>
                <div className="space-y-3">
                  {checks.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span style={{ color: 'var(--text-muted)' }}>{c.label}</span>
                      {c.passed ? (
                        <span className="flex items-center justify-center w-5 h-5 rounded-full shadow-sm" style={{ background: 'var(--up-bg)', color: 'var(--up)' }}>
                          <Check size={12} strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="flex items-center justify-center w-5 h-5 rounded-full shadow-sm" style={{ background: 'var(--down-bg)', color: 'var(--down)' }}>
                          <X size={12} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Fundamentals & Technical Health */}
          <div className="card shadow-sm">
            <div className="card-header border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <span className="card-title flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                <BookOpen size={15} style={{ color: 'var(--accent)' }} /> 
                Factor Quality & Momentum
              </span>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-faint)' }}>Quality Factor Score</span>
                <span className="font-bold text-sm num" style={{ color: 'var(--text)' }}>
                  {data.fundamentalScore != null ? `${data.fundamentalScore} / 100` : 'Neutral'}
                </span>
              </div>
              <div className="w-full h-px" style={{ background: 'var(--border)' }} />
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-faint)' }}>RSI (14)</span>
                <span className="font-bold text-sm num" style={{ color: rsi > 70 ? 'var(--down)' : rsi < 30 ? 'var(--up)' : 'var(--text)' }}>
                  {rsi ? rsi.toFixed(1) : '--'}
                </span>
              </div>
              <div className="w-full h-px" style={{ background: 'var(--border)' }} />
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-faint)' }}>EMA 21 / 50</span>
                <span className="font-medium text-xs num" style={{ color: 'var(--text)' }}>
                  ₹{inr(data.ema21)} / ₹{inr(data.ema50)}
                </span>
              </div>
            </div>
          </div>

          {/* ── Recent Company News ───────────────────────────────────────── */}
          <div className="card shadow-sm">
            <div className="card-header border-b pb-3 flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <span className="card-title flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                <Newspaper size={15} style={{ color: 'var(--accent)' }} /> 
                Recent News & Catalysts
              </span>
              {news.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
                  {news.length} {news.length === 1 ? 'story' : 'stories'}
                </span>
              )}
            </div>
            <div className="p-0 flex flex-col divide-y divide-[var(--border)]">
              {newsLoading ? (
                <div className="p-5 space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="animate-pulse space-y-2">
                      <div className="h-3.5 bg-[var(--bg)] rounded w-4/5"></div>
                      <div className="h-2.5 bg-[var(--bg)] rounded w-1/3"></div>
                    </div>
                  ))}
                </div>
              ) : news.length > 0 ? (
                news.slice(0, 5).map((item, idx) => {
                  const hours = Math.round(item.hours_ago || 0);
                  const timeStr = hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
                  return (
                    <a
                      key={idx}
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-4 hover:bg-[var(--bg-hover)] transition-colors group block"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="text-xs font-semibold leading-snug group-hover:text-[var(--accent)] transition-colors line-clamp-2" style={{ color: 'var(--text)' }}>
                          {item.title}
                        </h4>
                        <ExternalLink size={12} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--accent)] mt-0.5" />
                      </div>
                      <div className="flex items-center gap-2.5 mt-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                        <span className="px-1.5 py-0.5 rounded font-medium text-[10px]" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
                          {item.source}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {timeStr}
                        </span>
                      </div>
                    </a>
                  );
                })
              ) : (
                <div className="p-6 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
                  No recent news headlines found for {data.name || data.ticker}.
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

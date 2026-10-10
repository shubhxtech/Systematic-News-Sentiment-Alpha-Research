import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { createChart, CrosshairMode, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { ema } from '../lib/indicators';
import { ArrowLeft, Activity, BookOpen, Check, X } from 'lucide-react';
import { inr, pct, signalLabel, signalClass } from '../lib/format';

export default function Company() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const { screenerData, candleCache, theme } = useStore();
  const data = screenerData[symbol];
  
  const chartContainerRef = useRef();
  
  const cache = candleCache[symbol] || { daily: [], intraday: [] };
  const candles = cache['daily'] || [];

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

  if (!data) return <div className="p-10 text-center text-[var(--text-muted)]">Loading {symbol}...</div>;

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

  let nlpLabel = 'Neutral';
  let nlpColor = 'var(--text-muted)';
  const nlpScore = data.nlpSentiment;
  if (nlpScore == null) {
    nlpLabel = 'No recent news';
  } else {
    if (nlpScore > 0.2) { nlpLabel = 'Positive'; nlpColor = 'var(--up)'; }
    else if (nlpScore < -0.2) { nlpLabel = 'Negative'; nlpColor = 'var(--down)'; }
  }

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

          {/* Fundamentals & NLP */}
          <div className="card shadow-sm">
            <div className="card-header border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <span className="card-title flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                <BookOpen size={15} style={{ color: 'var(--accent)' }} /> 
                AI & Fundamentals
              </span>
            </div>
            <div className="p-5 flex flex-col gap-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>News Sentiment (7d)</div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base" style={{ color: nlpColor }}>{nlpLabel}</span>
                  {nlpScore != null && (
                    <span className="text-sm font-medium px-2 py-0.5 rounded-sm bg-[var(--bg)] border" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                      Score: {nlpScore}
                    </span>
                  )}
                </div>
              </div>
              
              <div className="w-full h-px" style={{ background: 'var(--border)' }} />
              
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>Quality Factor Score</div>
                <div className="font-bold text-base num" style={{ color: 'var(--text)' }}>
                  {data.fundamentalScore != null ? `${data.fundamentalScore} / 100` : '--'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

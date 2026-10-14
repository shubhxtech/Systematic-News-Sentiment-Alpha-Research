import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { createChart, CrosshairMode, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { ema } from '../lib/indicators';
import { ArrowLeft, Activity, BookOpen, Check, X, Newspaper, ExternalLink, RefreshCw } from 'lucide-react';
import { inr, pct, signalLabel, signalClass, chartTime } from '../lib/format';
import { CatalystItem, NetScore } from '../components/CatalystList';
import { getHistoricalCandles, UNIVERSE } from '../lib/upstoxApi';
import { computeSignal } from '../lib/signal';

// Default view: new, typed events. Untyped news, market colour and repeats sit behind "Show all".
const isHeadline = (i) => i.novelty >= 0.5 && !['price_commentary', 'other', 'routine'].includes(i.event_type);

export default function Company() {
  const { symbol: rawSymbol } = useParams();
  const symbol = (rawSymbol || '').toUpperCase();
  const navigate = useNavigate();
  const { screenerData, candleCache, theme, updateTicker, setCandleCache } = useStore();
  const data = screenerData[symbol];
  
  const [loadError, setLoadError] = useState(null);
  const [cat, setCat] = useState(null);           // {profile, summary, items, notes}
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState('');
  const [catReload, setCatReload] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const chartContainerRef = useRef();
  
  const cache = candleCache[symbol] || { daily: [], intraday: [] };
  const candles = cache['daily'] || [];

  // Fetch candles when missing (direct navigation / refresh / non-universe symbol). Depends only on
  // symbol + "do we have candles", so screener updates no longer refetch, and a failure sets an
  // error instead of spinning forever.
  const needsCandles = !candles.length;
  useEffect(() => {
    if (!symbol || !needsCandles) return;
    let active = true;
    setLoadError(null); // eslint-disable-line react-hooks/set-state-in-effect
    getHistoricalCandles(symbol)
      .then(res => {
        if (!active) return;
        if (!res?.daily?.length) {
          setLoadError('no price history returned');
          return;
        }
        setCandleCache(symbol, res);
        const last = res.daily[res.daily.length - 1];
        const prev = res.daily[res.daily.length - 2];
        const { score, signal, breakdown, indicators, warning } = computeSignal(res.daily);
        const existing = useStore.getState().screenerData[symbol];
        const last252 = res.daily.slice(-252);
        updateTicker(symbol, {
          ticker: symbol,
          name: existing?.name || UNIVERSE[symbol]?.name || res.name || symbol,
          sector: existing?.sector || UNIVERSE[symbol]?.sector || '–',
          ltp: existing?.ltp ?? last?.close,
          changePct: existing?.changePct ?? (prev ? ((last.close - prev.close) / prev.close) * 100 : null),
          volume: existing?.volume ?? last?.volume,
          signalScore: score,
          signal,
          breakdown,
          signalWarning: warning,
          ...indicators,
          rsi: indicators?.rsiVal,
          week52High: last252.reduce((m, c) => Math.max(m, c.high), -Infinity),
          week52Low: last252.reduce((m, c) => Math.min(m, c.low), Infinity),
        });
      })
      .catch(e => { if (active) setLoadError(e.message); });
    return () => { active = false; };
  }, [symbol, needsCandles, setCandleCache, updateTicker]);

  // Catalyst intelligence: exchange filings + headlines, typed and scored on the backend
  useEffect(() => {
    if (!symbol) return;
    const ctrl = new AbortController();
    setCatLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    setCatError('');
    fetch(`/api/catalysts?symbol=${encodeURIComponent(symbol)}&days=45`, { signal: ctrl.signal })
      .then(async res => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        setCat(d);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setCat(null);
        setCatError(err.message);
      })
      .finally(() => { if (!ctrl.signal.aborted) setCatLoading(false); });
    return () => ctrl.abort();
  }, [symbol, catReload]);

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
      const time = chartTime(c.date);
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

    chart.timeScale().fitContent();
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
  // breakdown has no "macd" key (it is "momentum"), so this check used to always fail
  const macdHistogram = data.macdLine != null && data.macdSig != null
    ? data.macdLine - data.macdSig
    : (data.breakdown?.momentum?.score ?? 0);

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
            <a href={`https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }}>
              Screener.in <ExternalLink size={11} />
            </a>
          </div>
          <div className="text-sm" style={{ color: 'var(--text-faint)' }}>{data.name}</div>
        </div>

        <div className="text-right">
          <div className="text-3xl font-bold num tracking-tight" style={{ color: 'var(--text)' }}>₹{inr(data.ltp)}</div>
          <div className="text-base font-semibold mt-1 num" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
            {pct(data.changePct)}
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
          <div className="flex-1 p-2 relative">
            <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
            {!candles.length && (
              <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: loadError ? 'var(--down)' : 'var(--text-faint)' }}>
                {loadError ? `Price history unavailable: ${loadError}` : 'Loading price history…'}
              </div>
            )}
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

          {/* ── Catalyst intelligence ─────────────────────────────────────── */}
          <div className="card shadow-sm">
            <div className="card-header border-b pb-3 flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
              <span className="card-title flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                <Newspaper size={15} style={{ color: 'var(--accent)' }} />
                Catalysts (45 days)
              </span>
              <div className="flex items-center gap-2">
                {cat?.summary && <NetScore value={cat.summary.net_score} />}
                <button className="btn btn-ghost" style={{ width: 26, height: 26, padding: 0, justifyContent: 'center' }}
                  title="Refresh" onClick={() => setCatReload(n => n + 1)} disabled={catLoading}>
                  <RefreshCw size={12} style={catLoading ? { animation: 'spin 0.8s linear infinite' } : {}} />
                </button>
              </div>
            </div>
            <div className="p-0 flex flex-col divide-y divide-[var(--border)]">
              {catLoading && !cat ? (
                <div className="p-5 space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="animate-pulse space-y-2">
                      <div className="h-3.5 bg-[var(--bg)] rounded w-4/5"></div>
                      <div className="h-2.5 bg-[var(--bg)] rounded w-1/3"></div>
                    </div>
                  ))}
                </div>
              ) : catError ? (
                <div className="p-6 text-center text-xs" style={{ color: 'var(--down)' }}>Could not load catalysts: {catError}</div>
              ) : cat?.items?.length ? (
                <>
                  {(showAll ? cat.items : cat.items.filter(isHeadline).slice(0, 8)).map((item, idx) => (
                    <CatalystItem key={`${item.time}-${idx}`} item={item} />
                  ))}
                  {!showAll && !cat.items.some(isHeadline) && (
                    <div className="p-5 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
                      No new material events — only general coverage and market colour.
                    </div>
                  )}
                  <div className="px-4 py-2 flex items-center justify-between text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    <span>Typed and scored by rules. Impact = direction × materiality × novelty × reliability, reduced if already priced in.</span>
                    {cat.items.filter(isHeadline).length < cat.items.length || cat.items.length > 8 ? (
                      <button className="underline shrink-0 ml-2" onClick={() => setShowAll(v => !v)}>
                        {showAll ? 'Show fewer' : `Show all ${cat.items.length}`}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="p-6 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
                  No material filings or headlines in the last 45 days.
                  {cat?.notes?.length ? <div className="mt-1">{cat.notes.join(' · ')}</div> : null}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

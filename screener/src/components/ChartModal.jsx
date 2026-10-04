import { useEffect, useRef, useState, useMemo } from 'react';
import { useStore } from '../lib/store';
import { X, Layers } from 'lucide-react';
import { createChart, CrosshairMode, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import { ema } from '../lib/indicators';
import { UNIVERSE } from '../lib/upstoxApi';

export default function ChartModal({ ticker }) {
  const { candleCache, setChartModalTicker, theme } = useStore();
  const [overlays, setOverlays] = useState({ ema21: true, ema50: true, bb: false, supertrend: false, rsi: false, macd: false });
  const [timeframe, setTimeframe] = useState('daily'); // 'daily' or 'intraday'

  const chartContainerRef = useRef();
  
  const cache = candleCache[ticker] || { daily: [], intraday: [] };
  const candles = cache[timeframe] || [];

  const chartData = useMemo(() => {
    if (!candles.length) return { prices: [], volume: [], ema21: [], ema50: [], bbUpper: [], bbLower: [], st: [], rsi: [], macdLine: [], macdSig: [], macdHist: [] };
    
    // Import indicators dynamically if needed, but they are already imported.
    import('../lib/indicators').then(mod => {
        // Just in case we need them to be globally available, but we can just import at top.
    });
    
    // We can't import inside useMemo like this normally, let's assume they are imported at the top of the file
    // Wait, the file already imports ema. I need to make sure bollingerBands, supertrend, rsi, macd are imported.
    const closes = candles.map(c => c.close);
    const ema21Data = ema(closes, 21);
    const ema50Data = ema(closes, 50);

    const prices = [];
    const volume = [];
    const e21 = [];
    const e50 = [];

    candles.forEach((c, i) => {
      // Lightweight charts requires time to be a string (yyyy-mm-dd) or unix timestamp
      // Assuming c.date is ISO string or similar. We convert to unix timestamp.
      const time = Math.floor(new Date(c.date).getTime() / 1000);
      
      prices.push({
        time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      });

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

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: v('--text-muted'),
      },
      grid: {
        vertLines: { color: v('--border') },
        horzLines: { color: v('--border') },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: v('--border'),
      },
      timeScale: {
        borderColor: v('--border'),
        timeVisible: timeframe === 'intraday',
      },
      autoSize: true,
    });

    // Price Candlesticks
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: v('--up'),
      downColor: v('--down'),
      borderVisible: false,
      wickUpColor: v('--up'),
      wickDownColor: v('--down'),
    });
    candlestickSeries.setData(chartData.prices);

    // EMA 21
    if (overlays.ema21) {
      const ema21Series = chart.addSeries(LineSeries, {
        color: v('--accent'),
        lineWidth: 2,
        title: 'EMA 21'
      });
      ema21Series.setData(chartData.ema21);
    }

    // EMA 50
    if (overlays.ema50) {
      const ema50Series = chart.addSeries(LineSeries, {
        color: '#f59e0b', // Amber/orange
        lineWidth: 2,
        title: 'EMA 50'
      });
      ema50Series.setData(chartData.ema50);
    }

    // Volume Histogram (Auto-scaled to bottom 20% of pane)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: v('--accent'),
      priceFormat: { type: 'volume' },
      priceScaleId: '', // Set to empty string to attach to an overlay scale
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // Push to bottom 20%
        bottom: 0,
      },
    });
    
    // Determine dynamic volume colors based on theme
    const isDark = theme === 'dark';
    const upVolColor = isDark ? 'rgba(46, 160, 67, 0.4)' : 'rgba(11, 138, 75, 0.4)';
    const downVolColor = isDark ? 'rgba(248, 81, 73, 0.4)' : 'rgba(198, 40, 40, 0.4)';
    const styledVolume = chartData.volume.map(v => ({
      ...v,
      color: chartData.prices.find(p => p.time === v.time)?.close > chartData.prices.find(p => p.time === v.time)?.open ? upVolColor : downVolColor
    }));
    volumeSeries.setData(styledVolume);

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [chartData, overlays, timeframe, theme]);

  if (!candles.length) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-8 animate-in fade-in duration-200">
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl w-full max-w-6xl h-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden slide-up">
        
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-subtle)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)] flex items-baseline gap-3">
              {UNIVERSE[ticker]?.name || ticker} 
              <span className="text-muted font-mono text-xs">{ticker}</span>
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setChartModalTicker(null)} 
              className="p-1.5 bg-[var(--bg)] border border-[var(--border)] hover:bg-[var(--bg-hover)] rounded-md text-muted hover:text-[var(--text)] transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────────── */}
        <div className="px-6 py-3 border-b border-[var(--border)] flex items-center gap-6 bg-[var(--bg)]">
          <select 
            className="select" 
            value={timeframe} 
            onChange={e => setTimeframe(e.target.value)}
          >
            <option value="daily">Daily</option>
            <option value="intraday">Intraday (5m)</option>
          </select>

          <div className="h-4 w-px bg-[var(--border)]"></div>

          <div className="flex gap-4 items-center text-xs">
            <span className="text-muted flex items-center gap-1"><Layers size={13}/> Overlays:</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[var(--text)]">
              <input 
                type="checkbox" 
                checked={overlays.ema21} 
                onChange={e => setOverlays(s => ({...s, ema21: e.target.checked}))} 
              /> 
              EMA 21
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-[var(--text)]">
              <input 
                type="checkbox" 
                checked={overlays.ema50} 
                onChange={e => setOverlays(s => ({...s, ema50: e.target.checked}))} 
              /> 
              EMA 50
            </label>
          </div>
        </div>

        {/* ── Chart Area ─────────────────────────────────────────────────── */}
        <div className="flex-1 relative" ref={chartContainerRef}>
          {/* Lightweight Charts attaches the canvas here */}
        </div>
      </div>
    </div>
  );
}

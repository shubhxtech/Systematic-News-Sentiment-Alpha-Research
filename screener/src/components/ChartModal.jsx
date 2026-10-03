import { useEffect, useState, useMemo } from 'react';
import { useStore } from '../lib/store';
import { X, Layers, Activity, Maximize, Target } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Bar, Line, Area } from 'recharts';
import { rsi, macd, bollingerBands, ema } from '../lib/indicators';
import { TICKERS, UNIVERSE } from '../lib/upstoxApi';

export default function ChartModal({ ticker }) {
  const { candleCache, setChartModalTicker } = useStore();
  const [pane, setPane] = useState('price'); // 'price', 'rsi', 'macd', 'volume'
  const [overlays, setOverlays] = useState({ ema21: true, ema50: true, bb: false });
  const [compareTicker, setCompareTicker] = useState('none');
  const [timeframe, setTimeframe] = useState('daily'); // 'daily' or 'intraday'

  const cache = candleCache[ticker] || { daily: [], intraday: [] };
  const candles = cache[timeframe] || [];
  
  const compCache = compareTicker !== 'none' ? (candleCache[compareTicker] || { daily: [], intraday: [] }) : { daily: [], intraday: [] };
  const compCandles = compCache[timeframe] || [];

  const chartData = useMemo(() => {
    if (!candles.length) return [];
    
    // Indicators
    const cClose = candles.map(c => c.close);
    const ema21 = ema(cClose, 21);
    const ema50 = ema(cClose, 50);
    const bb = bollingerBands(cClose);
    const rsi14 = rsi(cClose);
    const { histogram } = macd(cClose);

    // Normalization for comparison
    const basePrice = candles[0].close;
    const compBasePrice = compCandles.length ? compCandles[0].close : 1;

    return candles.map((c, i) => {
      const d = {
        date: c.date,
        close: c.close,
        open: c.open,
        high: c.high,
        low: c.low,
        volume: c.volume,
        ema21: ema21[i],
        ema50: ema50[i],
        bbUp: bb.upper[i],
        bbLow: bb.lower[i],
        rsi: rsi14[i],
        macd: histogram[i],
        normalized: (c.close / basePrice) * 100
      };

      if (compCandles.length > i) {
        d.compNormalized = (compCandles[i].close / compBasePrice) * 100;
      }

      return d;
    }).slice(-150); // Show last 150 days
  }, [candles, compCandles]);

  if (!candles.length) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 animate-in fade-in duration-200">
      <div className="bg-[#0a111f] border border-white/10 rounded-2xl w-full max-w-6xl h-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden slide-up">
        
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-[#060b12]">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              {UNIVERSE[ticker]?.name} <span className="text-slate-500 font-mono text-sm">{ticker}</span>
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            <select className="select-field bg-slate-900 border-white/10" value={compareTicker} onChange={e => setCompareTicker(e.target.value)}>
              <option value="none">Compare to...</option>
              {TICKERS.filter(t => t !== ticker).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            
            <button onClick={() => setChartModalTicker(null)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────────── */}
        <div className="px-6 py-3 border-b border-white/5 flex items-center gap-6 bg-[#080d18]">
          <div className="flex gap-2">
            <select className="select-field bg-slate-800 border-white/10 px-3 py-1 rounded text-sm text-white h-[34px]" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="intraday">Intraday (5m)</option>
            </select>
          </div>
          <div className="h-6 w-px bg-white/10 mx-2"></div>
          <div className="flex gap-2">
            <PaneBtn active={pane==='price'} onClick={() => setPane('price')} label="Price" />
            <PaneBtn active={pane==='volume'} onClick={() => setPane('volume')} label="Volume" />
            <PaneBtn active={pane==='rsi'} onClick={() => setPane('rsi')} label="RSI" />
            <PaneBtn active={pane==='macd'} onClick={() => setPane('macd')} label="MACD" />
          </div>

          <div className="h-4 w-px bg-white/10"></div>

          <div className="flex gap-4 items-center text-xs">
            <span className="text-slate-500 flex items-center gap-1"><Layers size={14}/> Overlays:</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
              <input type="checkbox" checked={overlays.ema21} onChange={e => setOverlays(s => ({...s, ema21: e.target.checked}))} className="accent-blue-500" /> EMA 21
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
              <input type="checkbox" checked={overlays.ema50} onChange={e => setOverlays(s => ({...s, ema50: e.target.checked}))} className="accent-orange-500" /> EMA 50
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
              <input type="checkbox" checked={overlays.bb} onChange={e => setOverlays(s => ({...s, bb: e.target.checked}))} className="accent-purple-500" /> Bollinger Bands
            </label>
          </div>
        </div>

        {/* ── Chart Area ─────────────────────────────────────────────────── */}
        <div className="flex-1 p-6 relative">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} tickMargin={10} />
              
              {compareTicker !== 'none' ? (
                <>
                  <YAxis domain={['auto', 'auto']} stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} orientation="right" />
                  <Tooltip content={<CustomTooltip isNormalized />} />
                  <Line type="monotone" dataKey="normalized" stroke="#3b82f6" strokeWidth={2} dot={false} name={ticker} />
                  <Line type="monotone" dataKey="compNormalized" stroke="#eab308" strokeWidth={2} dot={false} name={compareTicker} />
                </>
              ) : (
                <>
                  <YAxis 
                    domain={pane === 'rsi' ? [0, 100] : ['auto', 'auto']} 
                    stroke="rgba(255,255,255,0.2)" 
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} 
                    orientation="right" 
                  />
                  <Tooltip content={<CustomTooltip />} />

                  {pane === 'price' && (
                    <>
                      <Line type="step" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      {overlays.bb && <Area type="monotone" dataKey="bbUp" stroke="none" fill="rgba(168,85,247,0.1)" />}
                      {overlays.bb && <Area type="monotone" dataKey="bbLow" stroke="none" fill="rgba(168,85,247,0.1)" />}
                      {overlays.bb && <Line type="monotone" dataKey="bbUp" stroke="rgba(168,85,247,0.4)" strokeDasharray="5 5" dot={false} />}
                      {overlays.bb && <Line type="monotone" dataKey="bbLow" stroke="rgba(168,85,247,0.4)" strokeDasharray="5 5" dot={false} />}
                      {overlays.ema21 && <Line type="monotone" dataKey="ema21" stroke="#3b82f6" strokeWidth={1.5} dot={false} />}
                      {overlays.ema50 && <Line type="monotone" dataKey="ema50" stroke="#f97316" strokeWidth={1.5} dot={false} />}
                    </>
                  )}

                  {pane === 'volume' && <Bar dataKey="volume" fill="#3b82f6" opacity={0.5} />}
                  
                  {pane === 'rsi' && (
                    <>
                      <Line type="monotone" dataKey="rsi" stroke="#ec4899" strokeWidth={2} dot={false} />
                      {/* RSI Zones */}
                      <Line type="monotone" data={chartData.map(d => ({...d, rsi70: 70}))} dataKey="rsi70" stroke="rgba(255,255,255,0.2)" strokeDasharray="5 5" dot={false} />
                      <Line type="monotone" data={chartData.map(d => ({...d, rsi30: 30}))} dataKey="rsi30" stroke="rgba(255,255,255,0.2)" strokeDasharray="5 5" dot={false} />
                    </>
                  )}

                  {pane === 'macd' && (
                    <Bar dataKey="macd">
                      {chartData.map((entry, index) => (
                        <cell key={`cell-${index}`} fill={entry.macd > 0 ? '#10b981' : '#ef4444'} opacity={0.7} />
                      ))}
                    </Bar>
                  )}
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function PaneBtn({ active, onClick, label }) {
  return (
    <button 
      onClick={onClick}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
    >
      {label}
    </button>
  );
}

const CustomTooltip = ({ active, payload, label, isNormalized }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0a111f]/95 border border-white/10 p-3 rounded-lg shadow-xl backdrop-blur-md">
        <p className="text-slate-400 text-xs mb-2 font-mono">{label}</p>
        {payload.map((p, i) => {
          if (p.dataKey.includes('rsi') && p.value === 70 || p.value === 30) return null;
          let val = p.value;
          if (typeof val === 'number') {
            if (isNormalized) val = val.toFixed(2);
            else if (val > 10000) val = (val/1000).toFixed(1) + 'k';
            else val = val.toFixed(2);
          }
          return (
            <p key={i} className="text-sm font-semibold flex justify-between gap-4" style={{ color: p.color || p.fill }}>
              <span>{p.name || p.dataKey}:</span>
              <span className="font-mono">{val}</span>
            </p>
          );
        })}
      </div>
    );
  }
  return null;
};

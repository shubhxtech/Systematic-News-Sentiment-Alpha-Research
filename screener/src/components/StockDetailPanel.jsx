import { useEffect, useState, useMemo } from 'react';
import { useStore } from '../lib/store';
import { X, Maximize2, Activity, TrendingUp, TrendingDown, BookOpen } from 'lucide-react';

export default function StockDetailPanel({ ticker }) {
  const { screenerData, setSelectedTicker, setChartModalTicker } = useStore();
  const data = screenerData[ticker];

  if (!data) return null;

  const chgColor = data.changePct >= 0 ? 'text-emerald-400' : 'text-red-400';
  
  return (
    <div className="flex flex-col h-full animate-in slide-in-from-right-8 duration-300">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="p-5 border-b border-white/[0.05] relative">
        <button 
          onClick={() => setSelectedTicker(null)}
          className="absolute right-4 top-4 p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-md transition-colors"
        >
          <X size={18} />
        </button>
        
        <div className="text-[10px] font-bold tracking-widest text-blue-500 uppercase mb-1">{data.sector}</div>
        <h2 className="text-2xl font-bold text-white mb-2">{data.ticker}</h2>
        <div className="text-xs text-slate-400 leading-relaxed max-w-[90%]">{data.name}</div>
        
        <div className="mt-5 flex items-end gap-3">
          <div className="text-3xl font-mono font-medium text-white">₹{data.ltp?.toFixed(2) || '-'}</div>
          <div className={`text-sm font-mono font-medium pb-1 ${chgColor}`}>
            {data.changePct > 0 ? '▲' : '▼'} {Math.abs(data.changePct || 0).toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-6">
        
        {/* ── Chart Action ───────────────────────────────────────────────── */}
        <button 
          onClick={() => setChartModalTicker(ticker)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg shadow-blue-900/20 transition-all active:scale-[0.98]"
        >
          <Maximize2 size={16} /> Expand Full Chart
        </button>

        {/* ── Signal Summary ─────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><Activity size={14}/> Quantitative Signal</span>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-3xl font-bold text-white">{data.signalScore}</span>
              <span className={`px-3 py-1 rounded text-xs font-bold border ${sigColor(data.signal || '')}`}>
                {data.signal}
              </span>
            </div>
            
            <div className="space-y-3">
              <SignalRow label="Trend (EMA 21/50)" score={data.breakdown?.trend} />
              <SignalRow label="Momentum (RSI)" score={data.breakdown?.rsi} />
              <SignalRow label="MACD Cross" score={data.breakdown?.macd} />
              <SignalRow label="Volatility (BB)" score={data.breakdown?.bollinger} />
              <SignalRow label="Volume Profile" score={data.breakdown?.volume} />
            </div>
          </div>
        </div>

        {/* ── NLP Sentiment ──────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2"><BookOpen size={14}/> News Sentiment (FinBERT)</span>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-4">
              <div className={`text-2xl font-mono ${data.nlpSentiment > 0.2 ? 'text-emerald-400' : data.nlpSentiment < -0.2 ? 'text-red-400' : 'text-slate-400'}`}>
                {data.nlpSentiment?.toFixed(2) || '0.00'}
              </div>
              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
                <div 
                  className={`absolute h-full top-0 ${data.nlpSentiment > 0 ? 'bg-emerald-500 left-1/2' : 'bg-red-500 right-1/2'}`} 
                  style={{ width: `${Math.min(Math.abs(data.nlpSentiment || 0) * 100, 50)}%` }}
                />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20"></div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Key Levels ─────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Key Levels</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            <Stat label="RSI (14)" value={data.rsi?.toFixed(1)} />
            <Stat label="ADX (14)" value={data.adx?.toFixed(1)} />
            <Stat label="EMA (21)" value={`₹${data.ema21?.toFixed(2)}`} />
            <Stat label="EMA (50)" value={`₹${data.ema50?.toFixed(2)}`} />
            <Stat label="BB Upper" value={`₹${data.bbUp?.toFixed(2)}`} />
            <Stat label="BB Lower" value={`₹${data.bbLow?.toFixed(2)}`} />
            <Stat label="52W High" value={`₹${data.week52High?.toFixed(2)}`} />
            <Stat label="52W Low" value={`₹${data.week52Low?.toFixed(2)}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalRow({ label, score = 0 }) {
  const isPos = score > 0;
  const isNeg = score < 0;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <div className="flex items-center gap-2 w-32">
        <div className="flex-1 h-1 bg-slate-800 rounded-full relative">
          <div 
            className={`absolute h-full top-0 ${isPos ? 'bg-emerald-500 left-1/2' : 'bg-red-500 right-1/2'}`}
            style={{ width: `${Math.min(Math.abs(score), 50)}%` }}
          />
        </div>
        <span className={`w-8 text-right font-mono ${isPos ? 'text-emerald-400' : isNeg ? 'text-red-400' : 'text-slate-500'}`}>
          {score > 0 ? '+' : ''}{score}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase mb-1">{label}</div>
      <div className="font-mono text-slate-200 text-sm">{value || '-'}</div>
    </div>
  );
}

function sigColor(sig) {
  if (sig.includes('BUY')) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (sig.includes('SELL')) return 'text-red-400 bg-red-500/10 border-red-500/20';
  return 'text-slate-400 bg-slate-800 border-white/5';
}

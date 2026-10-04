import { useStore } from '../lib/store';
import { X, Maximize2, Activity, BookOpen, Check, Minus } from 'lucide-react';
import { inr, pct, signalLabel, signalClass } from '../lib/format';

export default function StockDetailPanel({ ticker }) {
  const { screenerData, setSelectedTicker, setChartModalTicker } = useStore();
  const data = screenerData[ticker];

  if (!data) return null;

  const isUp = (data.changePct || 0) >= 0;

  // Buy Setup Checklist Logic
  const price = data.ltp || 0;
  const ema21 = data.ema21 || 0;
  const ema50 = data.ema50 || 0;
  const rsi = data.rsi || 0;
  const macdHistogram = data.breakdown?.macd || 0; // Using score for now, but really it's MACD > signal

  const checks = [
    { label: 'Price > EMA 50', passed: price > ema50 },
    { label: 'Trend is Up (EMA 21 > EMA 50)', passed: ema21 > ema50 },
    { label: 'Momentum is Positive (RSI > 50)', passed: rsi > 50 },
    { label: 'MACD is Bullish', passed: macdHistogram > 0 },
  ];

  // NLP Label
  let nlpLabel = 'Neutral';
  let nlpColor = 'var(--text-muted)';
  if (data.nlpSentiment > 0.2) { nlpLabel = 'Positive'; nlpColor = 'var(--up)'; }
  else if (data.nlpSentiment < -0.2) { nlpLabel = 'Negative'; nlpColor = 'var(--down)'; }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] border-l border-[var(--border)] animate-in slide-in-from-right-4 duration-200">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="p-5 border-b border-[var(--border)] relative bg-[var(--bg-subtle)]">
        <button 
          onClick={() => setSelectedTicker(null)}
          className="absolute right-4 top-4 p-1.5 text-muted hover:text-[var(--text)] hover:bg-[var(--bg-hover)] rounded transition-colors"
        >
          <X size={18} />
        </button>
        
        <div className="text-[11px] font-semibold tracking-wider text-[var(--accent)] uppercase mb-1">
          {data.sector}
        </div>
        <h2 className="text-xl font-bold text-[var(--text)] mb-1">{data.ticker}</h2>
        <div className="text-xs text-muted leading-relaxed max-w-[90%]">
          {data.name}
        </div>
        
        <div className="mt-4 flex items-end gap-3">
          <div className="text-2xl font-semibold num text-[var(--text)]">
            ₹{inr(data.ltp)}
          </div>
          <div className="text-sm font-medium pb-1 num" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
            {pct(data.changePct)}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-6">
        
        {/* ── Chart Action ───────────────────────────────────────────────── */}
        <button 
          onClick={() => setChartModalTicker(ticker)}
          className="btn btn-primary w-full justify-center py-2"
        >
          <Maximize2 size={15} /> Expand Full Chart
        </button>

        {/* ── Signal Summary ─────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2">
              <Activity size={14} style={{ color: 'var(--text-faint)' }} /> 
              Quantitative Signal
            </span>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold num" style={{ color: 'var(--text)' }}>
                  {data.signalScore}
                </span>
                <span className="text-xs text-muted">/ 100</span>
              </div>
              <span className={`signal-badge ${signalClass(data.signal)}`}>
                {signalLabel(data.signal)}
              </span>
            </div>
            
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-[var(--text)] border-b border-[var(--border)] pb-2">Buy Setup Checklist</h4>
              <div className="space-y-2">
                {checks.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-muted">{c.label}</span>
                    {c.passed ? (
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--up-bg)] text-[var(--up)]">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--bg-subtle)] text-[var(--text-faint)]">
                        <Minus size={12} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── NLP Sentiment ──────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2">
              <BookOpen size={14} style={{ color: 'var(--text-faint)' }} /> 
              News Sentiment (FinBERT)
            </span>
          </div>
          <div className="p-4 flex items-center justify-between">
            <span className="text-xs text-muted">Latest analysis</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: nlpColor }}>
                {nlpLabel}
              </span>
              <span className="text-xs font-mono text-muted bg-[var(--bg-subtle)] px-2 py-0.5 rounded">
                {data.nlpSentiment != null ? data.nlpSentiment.toFixed(2) : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Key Levels ─────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Key Levels</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-y-4 gap-x-2">
            <Stat label="RSI (14)" value={data.rsi?.toFixed(1)} />
            <Stat label="ADX (14)" value={data.adx?.toFixed(1)} />
            <Stat label="EMA (21)" value={data.ema21 != null ? `₹${inr(data.ema21)}` : null} />
            <Stat label="EMA (50)" value={data.ema50 != null ? `₹${inr(data.ema50)}` : null} />
            <Stat label="BB Upper" value={data.bbUp != null ? `₹${inr(data.bbUp)}` : null} />
            <Stat label="BB Lower" value={data.bbLow != null ? `₹${inr(data.bbLow)}` : null} />
            <Stat label="52W High" value={data.week52High != null ? `₹${inr(data.week52High)}` : null} />
            <Stat label="52W Low" value={data.week52Low != null ? `₹${inr(data.week52Low)}` : null} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="font-semibold text-sm num" style={{ color: 'var(--text)' }}>
        {value || '–'}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import { X, Maximize2, Activity, BookOpen, Check, Minus, Briefcase, Trash2, ExternalLink, Clock } from 'lucide-react';
import { inr, pct, signalLabel, signalClass } from '../lib/format';

export default function StockDetailPanel({ ticker }) {
  const { screenerData, setSelectedTicker, setChartModalTicker, portfolio, updatePortfolio } = useStore();
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

  // P&L Logic
  const position = portfolio[ticker];
  const [isEditingPnl, setIsEditingPnl] = useState(!position);
  const [buyPrice, setBuyPrice] = useState(position?.buyPrice || '');
  const [qty, setQty] = useState(position?.qty || '');

  const pnl = position ? (price - position.buyPrice) * position.qty : 0;
  const pnlPct = position ? ((price - position.buyPrice) / position.buyPrice) * 100 : 0;

  const handleSavePosition = () => {
    if (buyPrice && qty) {
      updatePortfolio(ticker, { buyPrice, qty });
      setIsEditingPnl(false);
    }
  };

  const handleClearPosition = () => {
    updatePortfolio(ticker, null);
    setBuyPrice('');
    setQty('');
    setIsEditingPnl(true);
  };

  // Fetch News for this ticker
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  
  useEffect(() => {
    let active = true;
    if (!ticker) return;
    
    setNewsLoading(true);
    const query = data.name || ticker;
    fetch(`/api/news?q=${encodeURIComponent(query)}&ticker=${ticker}`)
      .then(res => res.json())
      .then(d => {
        if (active) setNews(d.slice(0, 5)); // show top 5
      })
      .catch(e => console.error("News fetch failed", e))
      .finally(() => { if (active) setNewsLoading(false); });
      
    return () => { active = false; };
  }, [ticker, data.name]);

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

        {/* ── Live P&L Tracker ───────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header justify-between">
            <span className="card-title flex items-center gap-2">
              <Briefcase size={14} style={{ color: 'var(--text-faint)' }} /> 
              Live P&L Tracker
            </span>
            {position && !isEditingPnl && (
              <div className="flex gap-2">
                <button onClick={() => setIsEditingPnl(true)} className="text-xs text-muted hover:text-[var(--accent)]">Edit</button>
                <button onClick={handleClearPosition} className="text-xs text-muted hover:text-[var(--down)]"><Trash2 size={13}/></button>
              </div>
            )}
          </div>
          <div className="p-4">
            {isEditingPnl ? (
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">Buy Price (₹)</label>
                    <input type="number" className="input w-full" placeholder="e.g. 1500" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">Quantity</label>
                    <input type="number" className="input w-full" placeholder="e.g. 100" value={qty} onChange={e => setQty(e.target.value)} />
                  </div>
                </div>
                <button onClick={handleSavePosition} className="btn btn-primary py-1.5 justify-center w-full mt-1">Save Position</button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Unrealized P&L</div>
                  <div className="text-2xl font-bold num" style={{ color: pnl >= 0 ? 'var(--up)' : 'var(--down)' }}>
                    {pnl >= 0 ? '+' : ''}₹{inr(pnl)}
                  </div>
                  <div className="text-sm font-medium num mt-1" style={{ color: pnlPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                  </div>
                </div>
                <div className="text-right">
                  <Stat label="Avg Price" value={`₹${inr(position.buyPrice)}`} />
                  <div className="mt-2"></div>
                  <Stat label="Quantity" value={position.qty} />
                </div>
              </div>
            )}
          </div>
        </div>

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
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">7-Day Score ({data.nlpSummary?.n_articles_7d || 0} articles)</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: nlpColor }}>
                  {nlpLabel}
                </span>
                <span className="text-xs font-mono text-muted bg-[var(--bg-subtle)] px-2 py-0.5 rounded">
                  {data.nlpSentiment != null ? (data.nlpSentiment > 0 ? '+' : '') + data.nlpSentiment.toFixed(2) : 'N/A'}
                </span>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">30-Day Score</span>
              <span className="text-xs font-mono" style={{ color: 'var(--text)' }}>
                {data.nlpSummary?.score_30d != null ? (data.nlpSummary.score_30d > 0 ? '+' : '') + data.nlpSummary.score_30d.toFixed(2) : 'N/A'}
              </span>
            </div>
            
            <div className="flex items-center justify-between border-t border-[var(--border)] pt-2 mt-1">
              <span className="text-xs text-muted">Change vs 30D</span>
              <span className="text-xs font-mono font-medium" style={{ color: data.nlpSummary?.change_vs_30d > 0 ? 'var(--up)' : data.nlpSummary?.change_vs_30d < 0 ? 'var(--down)' : 'var(--text)' }}>
                {data.nlpSummary?.change_vs_30d != null ? (data.nlpSummary.change_vs_30d > 0 ? '▲ +' : '▼ ') + data.nlpSummary.change_vs_30d.toFixed(2) : 'N/A'}
              </span>
            </div>
          </div>
        </div>
        
        {/* ── Recent News ────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2">
              <BookOpen size={14} style={{ color: 'var(--text-faint)' }} /> 
              Recent News
            </span>
          </div>
          <div className="p-0 flex flex-col">
            {newsLoading ? (
              <div className="p-4 text-xs text-muted text-center animate-pulse">Loading news...</div>
            ) : news.length > 0 ? (
              news.map((n, i) => (
                <a key={i} href={n.link} target="_blank" rel="noreferrer" className="p-3 border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-subtle)] transition-colors group block">
                  <div className="flex justify-between items-start gap-2">
                    <h4 className="text-[13px] font-medium leading-tight group-hover:text-[var(--accent)] transition-colors line-clamp-2 flex-1">
                      {n.title}
                    </h4>
                    <ExternalLink size={12} className="text-[var(--text-faint)] shrink-0 mt-0.5 group-hover:text-[var(--accent)]" />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted font-medium uppercase tracking-wider">
                    <span>{n.source}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {n.hours_ago < 1 ? 'Just now' : n.hours_ago < 24 ? `${Math.floor(n.hours_ago)}h ago` : `${Math.floor(n.hours_ago/24)}d ago`}
                    </span>
                  </div>
                </a>
              ))
            ) : (
              <div className="p-4 text-xs text-muted text-center">No recent news available.</div>
            )}
          </div>
        </div>
        
        {/* ── Fundamentals ───────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title flex items-center gap-2">
              <Activity size={14} style={{ color: 'var(--text-faint)' }} /> 
              Fundamental Quality
            </span>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted">Quality Score (0-100)</span>
              <span className="text-lg font-bold num" style={{ color: data.fundamentalScore >= 60 ? 'var(--up)' : data.fundamentalScore < 40 ? 'var(--down)' : 'var(--text)' }}>
                {data.fundamentalScore != null ? data.fundamentalScore : 'N/A'}
              </span>
            </div>
            {data.fundamentals && (
              <div className="grid grid-cols-2 gap-y-3 gap-x-2">
                <Stat label="P/E Ratio" value={data.fundamentals.pe?.toFixed(1)} />
                <Stat label="ROE" value={data.fundamentals.roe != null ? (data.fundamentals.roe * 100).toFixed(1) + '%' : null} />
                <Stat label="Debt/Equity" value={data.fundamentals.debt_equity?.toFixed(2)} />
                <Stat label="Net Margin" value={data.fundamentals.net_margin != null ? (data.fundamentals.net_margin * 100).toFixed(1) + '%' : null} />
              </div>
            )}
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

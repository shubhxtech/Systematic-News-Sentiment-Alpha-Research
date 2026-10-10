import { useState } from 'react';
import { useStore } from '../lib/store';
import { useScreenerData } from '../hooks/useScreenerData';
import { Star, Plus, Trash2, ExternalLink, X, Loader2 } from 'lucide-react';
import { inr, pct, signalClass, signalLabel } from '../lib/format';
import StockDetailPanel from './StockDetailPanel';

export default function WatchlistPanel() {
  const { watchlist, addToWatchlist, removeFromWatchlist, screenerData } = useStore();
  const { fetchWatchlistTicker } = useScreenerData();

  const [input, setInput] = useState('');
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const handleAdd = async () => {
    const ticker = input.trim().toUpperCase();
    if (!ticker) return;
    if (watchlist.includes(ticker)) { setAddError('Already in watchlist'); return; }
    
    setAdding(true);
    setAddError('');
    addToWatchlist(ticker);
    
    await fetchWatchlistTicker(ticker);
    
    setInput('');
    setAdding(false);
    setSelected(ticker);
  };

  return (
    <div className="flex h-full" style={{ background: 'var(--bg)' }}>
      {/* ── LEFT: Watchlist sidebar ──────────────────────────────────────── */}
      <div 
        className="w-80 flex flex-col shrink-0"
        style={{ background: 'var(--bg-subtle)', borderRight: '1px solid var(--border)' }}
      >
        <div className="p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Star size={16} style={{ fill: 'var(--accent)', color: 'var(--accent)' }} />
            <h2 className="font-semibold text-lg" style={{ color: 'var(--text)' }}>Watchlist</h2>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
              {watchlist.length} stocks
            </span>
            {watchlist.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('Clear all watchlist stocks?')) {
                    watchlist.forEach(t => removeFromWatchlist(t));
                    setSelected(null);
                  }
                }}
                className="text-xs hover:opacity-70 ml-2"
                style={{ color: 'var(--text-faint)' }}
                title="Clear all"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value.toUpperCase()); setAddError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="NSE ticker (e.g. RELIANCE)"
              className="input flex-1 font-mono text-xs uppercase"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !input.trim()}
              className="btn btn-primary"
              style={{ width: 32, padding: 0, justifyContent: 'center' }}
            >
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            </button>
          </div>
          {addError && <p className="text-xs mt-1" style={{ color: 'var(--down)' }}>{addError}</p>}
          <a
            href="https://www.nseindia.com/market-data/securities-available-for-trading"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] mt-2 hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            <ExternalLink size={10} /> Find NSE symbols on nseindia.com
          </a>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {watchlist.length === 0 ? (
            <div className="empty-state">
              <Star size={24} style={{ color: 'var(--border-strong)' }} />
              <p>Add stocks to monitor.</p>
            </div>
          ) : (
            watchlist.map(ticker => {
              const d = screenerData[ticker];
              const isSelected = selected === ticker;
              const isUp = (d?.changePct ?? 0) >= 0;
              
              return (
                <div
                  key={ticker}
                  onClick={() => setSelected(ticker)}
                  className="px-4 py-3 flex items-center justify-between cursor-pointer"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: isSelected ? 'var(--accent-bg)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                        {ticker}
                      </span>
                      {d?.signal && (
                        <span className={`signal-badge ${signalClass(d.signal)}`} style={{ fontSize: 10, padding: '2px 4px' }}>
                          {signalLabel(d.signal)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted">
                        {d?.ltp ? `₹${inr(d.ltp)}` : 'Loading...'}
                      </span>
                      {d?.ltp && (
                        <span className="text-xs font-mono" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
                          {pct(d.changePct)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); removeFromWatchlist(ticker); if (selected === ticker) setSelected(null); }}
                    className="ml-3 p-1 rounded"
                    style={{ color: 'var(--text-faint)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseOver={e => e.currentTarget.style.color = 'var(--down)'}
                    onMouseOut={e => e.currentTarget.style.color = 'var(--text-faint)'}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── RIGHT: Detail ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {selected ? (
          <div className="flex-1 w-full max-w-4xl mx-auto overflow-auto">
            <StockDetailPanel ticker={selected} />
          </div>
        ) : (
          <div className="empty-state m-auto">
            <Star size={32} style={{ color: 'var(--border-strong)' }} />
            <p>Select a stock from your watchlist to see analysis</p>
          </div>
        )}
      </div>
    </div>
  );
}

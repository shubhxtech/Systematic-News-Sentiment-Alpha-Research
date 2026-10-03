import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { Search, SlidersHorizontal, Star } from 'lucide-react';
import { SECTORS } from '../lib/upstoxApi';

export default function ScreenerTable() {
  const { screenerData, filters, setFilter, selectedTicker, setSelectedTicker, watchlist, toggleWatchlist } = useStore();

  const data = Object.values(screenerData);

  const filtered = useMemo(() => {
    return data.filter(d => {
      if (filters.search && !d.ticker.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.sector !== 'All' && d.sector !== filters.sector) return false;
      if (filters.signal !== 'All' && d.signal !== filters.signal) return false;
      if (filters.minRSI > 0 || filters.maxRSI < 100) {
        if (d.rsi == null || d.rsi < filters.minRSI || d.rsi > filters.maxRSI) return false;
      }
      if (filters.minScore > 0) {
        if (d.signalScore == null || d.signalScore < filters.minScore) return false;
      }
      if (filters.showWatchlistOnly && !watchlist.includes(d.ticker)) return false;
      return true;
    }).sort((a, b) => {
      const vA = a[filters.sortBy] != null && !isNaN(a[filters.sortBy]) ? a[filters.sortBy] : -Infinity;
      const vB = b[filters.sortBy] != null && !isNaN(b[filters.sortBy]) ? b[filters.sortBy] : -Infinity;
      return filters.sortDir === 'desc' ? vB - vA : vA - vB;
    });
  }, [data, filters, watchlist]);

  const handleSort = (key) => {
    if (filters.sortBy === key) setFilter('sortDir', filters.sortDir === 'desc' ? 'asc' : 'desc');
    else { setFilter('sortBy', key); setFilter('sortDir', 'desc'); }
  };

  const sigColor = (sig) => {
    if (sig.includes('BUY')) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (sig.includes('SELL')) return 'text-red-400 bg-red-500/10 border-red-500/20';
    return 'text-slate-400 bg-slate-800 border-white/5';
  };

  return (
    <div className="flex flex-col h-full bg-[#060b12]">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="p-4 border-b border-white/[0.05] flex items-center gap-4 bg-[#0a111f] sticky top-0 z-10">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search NSE tickers..."
            className="input-field pl-8 w-64"
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
          />
        </div>
        
        <div className="h-4 w-px bg-white/[0.1]"></div>
        
        <select className="select-field" value={filters.sector} onChange={e => setFilter('sector', e.target.value)}>
          <option value="All">All Sectors</option>
          {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        
        <select className="select-field" value={filters.signal} onChange={e => setFilter('signal', e.target.value)}>
          <option value="All">All Signals</option>
          <option value="STRONG BUY">Strong Buy</option>
          <option value="BUY">Buy</option>
          <option value="NEUTRAL">Neutral</option>
          <option value="SELL">Sell</option>
          <option value="STRONG SELL">Strong Sell</option>
        </select>

        <button 
          onClick={() => setFilter('showWatchlistOnly', !filters.showWatchlistOnly)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${filters.showWatchlistOnly ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' : 'bg-slate-800 border-white/[0.07] text-slate-400 hover:text-slate-200'}`}
        >
          <Star size={14} className={filters.showWatchlistOnly ? 'fill-amber-400' : ''} /> Watchlist
        </button>
        
        <div className="ml-auto text-xs text-slate-500 font-mono">
          {filtered.length} / {data.length} tickers
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="sticky top-0 bg-[#0a111f] border-b border-white/[0.05] z-10 backdrop-blur-md">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-white w-10">W</th>
              <Th label="Ticker" sortKey="ticker" curr={filters.sortBy} dir={filters.sortDir} onClick={handleSort} />
              <Th label="Sector" sortKey="sector" curr={filters.sortBy} dir={filters.sortDir} onClick={handleSort} />
              <Th label="LTP (₹)" sortKey="ltp" curr={filters.sortBy} dir={filters.sortDir} onClick={handleSort} align="right" />
              <Th label="% Chg" sortKey="changePct" curr={filters.sortBy} dir={filters.sortDir} onClick={handleSort} align="right" />
              <Th label="Signal" sortKey="signalScore" curr={filters.sortBy} dir={filters.sortDir} onClick={handleSort} align="center" />
              <Th label="Score" sortKey="signalScore" curr={filters.sortBy} dir={filters.sortDir} onClick={handleSort} align="right" />
              <Th label="RSI" sortKey="rsi" curr={filters.sortBy} dir={filters.sortDir} onClick={handleSort} align="right" />
              <Th label="NLP Sentiment" sortKey="nlpSentiment" curr={filters.sortBy} dir={filters.sortDir} onClick={handleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-slate-500">No stocks match your filters</td></tr>
            ) : (
              filtered.map(row => {
                const isSel = selectedTicker === row.ticker;
                const chgColor = row.changePct >= 0 ? 'text-emerald-400' : 'text-red-400';
                const isWatch = watchlist.includes(row.ticker);
                
                return (
                  <tr 
                    key={row.ticker} 
                    onClick={() => setSelectedTicker(isSel ? null : row.ticker)}
                    className={`border-b border-white/[0.02] hover:bg-white/[0.02] cursor-pointer transition-colors ${isSel ? 'bg-blue-900/20' : ''}`}
                  >
                    <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleWatchlist(row.ticker); }}>
                      <Star size={16} className={`cursor-pointer transition-colors ${isWatch ? 'text-amber-400 fill-amber-400' : 'text-slate-600 hover:text-slate-400'}`} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-200">{row.ticker}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{row.sector}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {row.ltp ? row.ltp.toFixed(2) : '-'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${chgColor}`}>
                      {row.changePct != null ? `${row.changePct > 0 ? '+' : ''}${row.changePct.toFixed(2)}%` : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold border ${sigColor(row.signal || '')}`}>
                        {row.signal || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">{row.signalScore ?? '-'}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">{row.rsi ? row.rsi.toFixed(1) : '-'}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">
                      {row.nlpSentiment != null ? (
                        <span className={row.nlpSentiment > 0.2 ? 'text-emerald-400' : row.nlpSentiment < -0.2 ? 'text-red-400' : 'text-slate-400'}>
                          {row.nlpSentiment.toFixed(2)}
                        </span>
                      ) : '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ label, sortKey, curr, dir, onClick, align = 'left' }) {
  const active = curr === sortKey;
  return (
    <th 
      onClick={() => onClick(sortKey)}
      className={`px-4 py-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-white transition-colors select-none text-${align}`}
    >
      <div className={`flex items-center gap-1 justify-${align === 'right' ? 'end' : align === 'center' ? 'center' : 'start'}`}>
        {label}
        {active && (
          <span className="text-blue-500 text-[10px]">
            {dir === 'desc' ? '▼' : '▲'}
          </span>
        )}
      </div>
    </th>
  );
}

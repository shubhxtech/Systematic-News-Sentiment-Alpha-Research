import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { Search, Star, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { SECTORS } from '../lib/upstoxApi';
import { Delta, RsiCell, RangeBar, signalLabel, signalClass, inr, compactVol, volRatio } from '../lib/format.jsx';

import { filterDataByQuery } from '../lib/query';

const EN_DASH = '–';

// Columns definition
const COLUMNS = [
  { key: 'name',        label: 'Name',          sortable: false },
  { key: 'ltp',         label: 'Price (₹)',      sortable: true,  align: 'right' },
  { key: 'changePct',   label: 'Change %',       sortable: true,  align: 'right' },
  { key: 'volume',      label: 'Volume',         sortable: true,  align: 'right', hideOnMobile: true },
  { key: 'rsi',         label: 'RSI',            sortable: true,  align: 'right', hideOnMobile: true },
  { key: 'nlpSentiment',label: 'Sentiment (7d)', sortable: true,  align: 'right', hideOnMobile: true },
  { key: 'fundamentalScore', label: 'Fund. Score', sortable: true, align: 'right', hideOnMobile: true },
  { key: '52w',         label: '52w range',      sortable: false, align: 'center', hideOnMobile: true },
  { key: 'signalScore', label: 'Signal',         sortable: true,  align: 'center' },
];

export default function ScreenerTable() {
  const navigate = useNavigate();
  const {
    screenerData, filters, setFilter,
    selectedTicker, setSelectedTicker,
    watchlist, toggleWatchlist,
    loading, needsApiToken,
  } = useStore();

  // Memoize Object.values to avoid a new array on every render
  const dataArr = useMemo(() => Object.values(screenerData), [screenerData]);

  const filtered = useMemo(() => {
    let result = dataArr;
    
    // 1. Advanced query parsing
    if (filters.search && filters.search.includes('=')) {
      result = filterDataByQuery(result, filters.search);
    } else if (filters.search) {
      result = result.filter(d => `${d.ticker} ${d.name || ''}`.toLowerCase().includes(filters.search.toLowerCase()));
    }

    return result
      .filter(d => {
        if (filters.sector !== 'All' && d.sector !== filters.sector) return false;
        if (filters.signal !== 'All' && d.signal !== filters.signal) return false;
        if (filters.showWatchlistOnly && !watchlist.includes(d.ticker)) return false;
        return true;
      })
      .sort((a, b) => {
        const vA = a[filters.sortBy] != null && !isNaN(a[filters.sortBy]) ? a[filters.sortBy] : -Infinity;
        const vB = b[filters.sortBy] != null && !isNaN(b[filters.sortBy]) ? b[filters.sortBy] : -Infinity;
        return filters.sortDir === 'desc' ? vB - vA : vA - vB;
      });
  }, [dataArr, filters, watchlist]);

  const handleSort = (key) => {
    if (filters.sortBy === key) setFilter('sortDir', filters.sortDir === 'desc' ? 'asc' : 'desc');
    else { setFilter('sortBy', key); setFilter('sortDir', 'desc'); }
  };

  // ── No token state ───────────────────────────────────────────────────────
  if (needsApiToken) {
    return (
      <div className="empty-state" style={{ paddingTop: 80 }}>
        <Star size={32} style={{ color: 'var(--border-strong)' }} />
        <p style={{ color: 'var(--text-muted)', maxWidth: 360, textAlign: 'center' }}>
          Configure your <strong>Upstox API token</strong> in Settings to load real market data.
          No demo data will be shown.
        </p>
      </div>
    );
  }

  // ── Loading skeletons ────────────────────────────────────────────────────
  if (loading.screener && dataArr.length === 0) {
    return (
      <div className="overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              {COLUMNS.map(c => <th key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 12 }).map((_, i) => (
              <tr key={i}>
                <td colSpan={COLUMNS.length + 1}>
                  <div className="skeleton" style={{ height: 16, margin: '6px 12px', borderRadius: 4 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Empty results ────────────────────────────────────────────────────────
  if (dataArr.length === 0) {
    return (
      <div className="empty-state">
        <p>No data yet. Data loads in the background after the first quote fetch.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-3 sticky top-0 z-10 border-b"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            type="text"
            placeholder="Search or query (e.g. RSI < 40)..."
            className="input"
            style={{ paddingLeft: 28, width: 240 }}
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
          />
        </div>

        <select
          className="select"
          value={filters.sector}
          onChange={e => setFilter('sector', e.target.value)}
        >
          <option value="All">All sectors</option>
          {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          className="select"
          value={filters.signal}
          onChange={e => setFilter('signal', e.target.value)}
        >
          <option value="All">All signals</option>
          <option value="STRONG BUY">Strong buy</option>
          <option value="BUY">Buy</option>
          <option value="NEUTRAL">Neutral</option>
          <option value="SELL">Sell</option>
          <option value="STRONG SELL">Strong sell</option>
        </select>

        <button
          onClick={() => setFilter('showWatchlistOnly', !filters.showWatchlistOnly)}
          className={`chip${filters.showWatchlistOnly ? ' active' : ''}`}
        >
          <Star size={11} style={filters.showWatchlistOnly ? { fill: 'var(--accent)' } : {}} />
          Watchlist only
        </button>

        <span className="ml-auto text-xs" style={{ color: 'var(--text-faint)' }}>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="data-table">
          <thead>
            <tr>
              {/* Watchlist star */}
              <th style={{ width: 36, paddingLeft: 12, paddingRight: 4 }} />
              {COLUMNS.map(c => (
                <th
                  key={c.key}
                  className={`${c.align === 'right' ? 'num' : ''} ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}
                  style={{ textAlign: c.align === 'center' ? 'center' : undefined }}
                  onClick={c.sortable ? () => handleSort(c.key) : undefined}
                >
                  <span className={`inline-flex items-center gap-1 ${c.align === 'right' ? 'justify-end w-full' : ''}`}>
                    {c.label}
                    {c.sortable && (
                      filters.sortBy === c.key
                        ? filters.sortDir === 'desc'
                          ? <ChevronDown size={11} style={{ color: 'var(--accent)' }} />
                          : <ChevronUp size={11} style={{ color: 'var(--accent)' }} />
                        : <ChevronsUpDown size={11} style={{ color: 'var(--text-faint)', opacity: 0.5 }} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <TableRow
                key={row.ticker}
                row={row}
                isSelected={selectedTicker === row.ticker}
                isWatched={watchlist.includes(row.ticker)}
                onSelect={() => navigate(`/company/${row.ticker}`)}
                onToggleWatch={() => toggleWatchlist(row.ticker)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableRow({ row, isSelected, isWatched, onSelect, onToggleWatch }) {
  return (
    <tr
      style={isSelected ? { background: 'var(--accent-bg)' } : undefined}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onSelect()}
      aria-selected={isSelected}
    >
      {/* Watchlist button */}
      <td style={{ paddingLeft: 12, paddingRight: 4, width: 36 }}>
        <button
          aria-label={isWatched ? `Remove ${row.ticker} from watchlist` : `Add ${row.ticker} to watchlist`}
          onClick={e => { e.stopPropagation(); onToggleWatch(); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: isWatched ? '#f59e0b' : 'var(--border-strong)',
          }}
        >
          <Star size={13} style={isWatched ? { fill: '#f59e0b' } : {}} />
        </button>
      </td>

      {/* Name + ticker */}
      <td>
        <div className="font-medium text-sm" style={{ color: 'var(--text)' }}>
          {row.name || row.ticker}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {row.ticker}
          {row.sector && <span style={{ marginLeft: 6 }}>· {row.sector}</span>}
        </div>
      </td>

      {/* Price */}
      <td className="num">
        {row.ltp != null ? `₹${inr(row.ltp)}` : EN_DASH}
      </td>

      {/* Change % */}
      <td className="num">
        <Delta value={row.changePct} />
      </td>

      {/* Volume */}
      <td className="num hidden md:table-cell" style={{ color: 'var(--text-muted)' }}>
        {compactVol(row.volume)}
      </td>

      {/* RSI */}
      <td className="num hidden md:table-cell">
        <RsiCell value={row.rsi} />
      </td>

      {/* NLP Sentiment */}
      <td className="num hidden md:table-cell">
        {row.nlpSentiment != null ? (
          <span style={{ color: row.nlpSentiment > 0.1 ? 'var(--up)' : row.nlpSentiment < -0.1 ? 'var(--down)' : 'var(--text)' }}>
            {row.nlpSentiment > 0 ? '+' : ''}{row.nlpSentiment.toFixed(2)}
          </span>
        ) : <span style={{ color: 'var(--text-faint)' }}>{EN_DASH}</span>}
      </td>

      {/* Fundamental Score */}
      <td className="num hidden md:table-cell">
        {row.fundamentalScore != null ? (
          <span style={{ color: row.fundamentalScore >= 60 ? 'var(--up)' : row.fundamentalScore < 40 ? 'var(--down)' : 'var(--text)' }}>
            {row.fundamentalScore}
          </span>
        ) : <span style={{ color: 'var(--text-faint)' }}>{EN_DASH}</span>}
      </td>

      {/* 52w range */}
      <td className="hidden md:table-cell" style={{ textAlign: 'center' }}>
        <RangeBar low={row.week52Low} high={row.week52High} current={row.ltp} />
      </td>

      {/* Signal badge */}
      <td style={{ textAlign: 'center' }}>
        {row.signal
          ? <span className={`signal-badge ${signalClass(row.signal)}`}>{signalLabel(row.signal)}</span>
          : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
              {row.signalWarning ? 'Loading…' : EN_DASH}
            </span>
        }
      </td>
    </tr>
  );
}

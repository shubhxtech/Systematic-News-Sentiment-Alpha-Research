const filters = { search: '', sector: 'All', signal: 'All', minRSI: 0, maxRSI: 100, minScore: 0, showWatchlistOnly: false, sortBy: 'signalScore', sortDir: 'desc' };
const watchlist = [];

const data = [
  { ticker: 'HDFCBANK', rsi: 45, signalScore: 80 },
  { ticker: 'TITAN', rsi: 55, signalScore: 90 },
  { ticker: 'ONGC', rsi: undefined, signalScore: 0 },
  { ticker: 'RELIANCE', rsi: NaN, signalScore: 0 },
  { ticker: 'MARUTI', rsi: null, signalScore: 0 }
];

const filtered = data.filter(d => {
  if (filters.search && !d.ticker.toLowerCase().includes(filters.search.toLowerCase())) return false;
  if (filters.sector !== 'All' && d.sector !== filters.sector) return false;
  if (filters.signal !== 'All' && d.signal !== filters.signal) return false;
  if (d.rsi < filters.minRSI || d.rsi > filters.maxRSI) return false;
  if (d.signalScore < filters.minScore) return false;
  if (filters.showWatchlistOnly && !watchlist.includes(d.ticker)) return false;
  return true;
}).sort((a, b) => {
  const vA = a[filters.sortBy] ?? 0;
  const vB = b[filters.sortBy] ?? 0;
  return filters.sortDir === 'desc' ? vB - vA : vA - vB;
});

console.log(filtered.map(d => d.ticker));

import { useState, useEffect, useRef } from 'react';
import { useStore } from '../lib/store';
import { Newspaper, Search, ExternalLink, Clock } from 'lucide-react';
import { UNIVERSE } from '../lib/upstoxApi';
import { EventChip, Chip } from '../components/CatalystList';

export default function News() {
  const { watchlist } = useStore();
  const [query, setQuery] = useState('');
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [materialOnly, setMaterialOnly] = useState(false);
  const reqId = useRef(0);
  
  // Default search options
  const defaultQueries = ['Indian Stock Market', 'Nifty 50', 'Sensex', 'RBI', ...watchlist.slice(0, 3)];

  const fetchNews = async (searchQuery) => {
    const q = searchQuery.trim();
    if (!q) return;
    const id = ++reqId.current;   // only the latest request may update state
    setLoading(true);
    setError(null);
    try {
      // Map ticker to name if it's in the universe
      const sym = q.toUpperCase();
      const isTicker = !!UNIVERSE[sym];
      const queryStr = isTicker ? UNIVERSE[sym].name : q;
      const tickerParam = isTicker ? `&ticker=${encodeURIComponent(sym)}` : '';

      const res = await fetch(`/api/news?q=${encodeURIComponent(queryStr)}${tickerParam}`);
      if (!res.ok) throw new Error('Failed to fetch news');
      const data = await res.json();
      if (id === reqId.current) setNews(Array.isArray(data) ? data : []);
    } catch (e) {
      if (id === reqId.current) setError(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews('Indian Stock Market'); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchNews(query);
  };

  const shown = materialOnly
    ? news.filter(n => n.materiality_label && n.materiality_label !== 'low' && n.event_type !== 'routine')
    : news;
  const last24h = shown.filter(n => n.category === 'Last 24 Hours');
  const past7d = shown.filter(n => n.category === 'Past 7 Days');
  const past30d = shown.filter(n => n.category === 'Past 30 Days');

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] p-6 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        
        {/* Header & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
              <Newspaper size={24} className="text-[var(--accent)]" />
              Market News
            </h1>
            <p className="text-sm text-muted mt-1">Aggregated stock and market news</p>
          </div>
          
          <form onSubmit={handleSearch} className="relative max-w-sm w-full">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input 
              type="text" 
              placeholder="Search ticker or topic..." 
              className="input w-full pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="absolute right-1 top-1 bottom-1 px-3 btn btn-primary py-0 text-xs h-auto">
              Search
            </button>
          </form>
        </div>

        {/* Quick Links */}
        <div className="flex flex-wrap gap-2 items-center">
          {defaultQueries.map(q => (
            <button 
              key={q} 
              onClick={() => { setQuery(q); fetchNews(q); }}
              className="px-3 py-1 text-xs rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {q}
            </button>
          ))}
          <button onClick={() => setMaterialOnly(v => !v)} className={`chip ml-auto${materialOnly ? ' active' : ''}`}
            title="Hide routine, low-materiality items">
            Material only
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-4 mt-8">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-4 h-24 animate-pulse bg-[var(--bg-subtle)] rounded-lg"></div>
            ))}
          </div>
        ) : error ? (
          <div className="text-[var(--down)] p-4 bg-[var(--down-bg)] rounded-lg text-sm border border-[var(--down-border)]">
            Error: {error}
          </div>
        ) : shown.length === 0 ? (
          <div className="text-center p-12 text-muted border border-[var(--border)] rounded-lg border-dashed">
            No recent news found for this query.
          </div>
        ) : (
          <div className="space-y-8 mt-6">
            
            {last24h.length > 0 && (
              <section>
                <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text)] mb-4 flex items-center gap-2 border-b border-[var(--border)] pb-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--up)] shadow-[0_0_8px_var(--up)]" />
                  Last 24 Hours
                </h2>
                <div className="grid gap-3">
                  {last24h.map((article, i) => <NewsCard key={i} article={article} />)}
                </div>
              </section>
            )}

            {past7d.length > 0 && (
              <section>
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted mb-4 flex items-center gap-2 border-b border-[var(--border)] pb-2">
                  <Clock size={14} />
                  Past 7 Days
                </h2>
                <div className="grid gap-3 opacity-90">
                  {past7d.map((article, i) => <NewsCard key={i} article={article} />)}
                </div>
              </section>
            )}

            {past30d.length > 0 && (
              <section>
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted mb-4 flex items-center gap-2 border-b border-[var(--border)] pb-2">
                  <Clock size={14} />
                  Past 30 Days
                </h2>
                <div className="grid gap-3 opacity-80">
                  {past30d.map((article, i) => <NewsCard key={i} article={article} />)}
                </div>
              </section>
            )}
            
          </div>
        )}
      </div>
    </div>
  );
}

function NewsCard({ article }) {
  return (
    <a 
      href={article.link} 
      target="_blank" 
      rel="noreferrer"
      className="block card p-4 hover:border-[var(--accent)] hover:shadow-md transition-all group"
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <h3 className="font-semibold text-[var(--text)] text-sm md:text-base group-hover:text-[var(--accent)] transition-colors line-clamp-2 leading-tight">
            {article.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted">
            <span className="font-medium px-2 py-0.5 rounded bg-[var(--bg-subtle)] border border-[var(--border)]">
              {article.source}
            </span>
            {article.event_type && article.event_type !== 'other' && <EventChip item={article} />}
            {article.reliability_label === 'Unverified report' && <Chip color="var(--warn)">unverified</Chip>}
            {article.novelty != null && article.novelty < 0.5 && <Chip color="var(--warn)">repeat</Chip>}
            {article.related_sources?.length > 0 && (
              <span title={article.related_sources.join(', ')}>+{article.related_sources.length} sources</span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {article.hours_ago < 1 
                ? 'Just now' 
                : article.hours_ago < 24 
                  ? `${Math.floor(article.hours_ago)}h ago` 
                  : `${Math.floor(article.hours_ago/24)}d ago`}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-[var(--border-strong)] group-hover:text-[var(--accent)] transition-colors mt-1">
          <ExternalLink size={16} />
        </div>
      </div>
    </a>
  );
}

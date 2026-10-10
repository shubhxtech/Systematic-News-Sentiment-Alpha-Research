import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import { Newspaper, Search, ExternalLink, Clock } from 'lucide-react';
import { UNIVERSE } from '../lib/upstoxApi';

export default function News() {
  const { watchlist } = useStore();
  const [query, setQuery] = useState('');
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Default search options
  const defaultQueries = ['Indian Stock Market', 'Nifty 50', 'Sensex', 'RBI', ...watchlist.slice(0, 3)];

  const fetchNews = async (searchQuery) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Map ticker to name if it's in the universe
      const isTicker = !!UNIVERSE[searchQuery];
      const queryStr = isTicker ? UNIVERSE[searchQuery].name : searchQuery;
      const tickerParam = isTicker ? `&ticker=${searchQuery}` : '';
      
      const res = await fetch(`/api/news?q=${encodeURIComponent(queryStr)}${tickerParam}`);
      if (!res.ok) throw new Error('Failed to fetch news');
      const data = await res.json();
      setNews(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews('Indian Stock Market');
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchNews(query);
  };

  const last24h = news.filter(n => n.category === 'Last 24 Hours');
  const past7d = news.filter(n => n.category === 'Past 7 Days');

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
        <div className="flex flex-wrap gap-2">
          {defaultQueries.map(q => (
            <button 
              key={q} 
              onClick={() => { setQuery(q); fetchNews(q); }}
              className="px-3 py-1 text-xs rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {q}
            </button>
          ))}
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
        ) : news.length === 0 ? (
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
          <div className="flex items-center gap-3 mt-2 text-xs text-muted">
            <span className="font-medium px-2 py-0.5 rounded bg-[var(--bg-subtle)] border border-[var(--border)]">
              {article.source}
            </span>
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

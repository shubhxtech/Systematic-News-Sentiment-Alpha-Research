import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from './lib/store';
import { useScreenerData, useScreenerPolling } from './hooks/useScreenerData';
import { useAlertMonitor } from './hooks/useAlertMonitor';
import { UNIVERSE } from './lib/upstoxApi';
import {
  LineChart, LayoutGrid, Star, BellRing, Settings,
  RefreshCw, KeyRound, AlertCircle, Moon, Sun, Newspaper, CalendarClock, Rocket, PieChart
} from 'lucide-react';
import Screens          from './pages/Screens';

// Everything except the default screen loads on first visit, which keeps the chart library
// and the bigger pages out of the initial bundle.
const Company        = lazy(() => import('./pages/Company'));
const SettingsPanel  = lazy(() => import('./components/SettingsPanel'));
const ChartModal     = lazy(() => import('./components/ChartModal'));
const Sectors        = lazy(() => import('./pages/Sectors'));
const AlertsPanel    = lazy(() => import('./components/AlertsPanel'));
const WatchlistPanel = lazy(() => import('./components/WatchlistPanel'));
const News           = lazy(() => import('./pages/News'));
const Earnings       = lazy(() => import('./pages/Earnings'));
const PreResults     = lazy(() => import('./pages/PreResults'));

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    apiToken, loading, error, lastUpdated, marketOpen,
    watchlist, needsApiToken, theme, toggleTheme, chartModalTicker,
  } = useStore();

  const { pollOnce } = useScreenerData();
  useScreenerPolling();   // the only poll loop in the app
  useAlertMonitor();      // alerts fire on every page, not just /alerts

  // The backend owns the token; sync the UI flag with it (it may have a token from .upstox_token
  // even when this browser has never seen one, or the token may have been removed).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/status')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) useStore.getState().setApiToken(!!d.has_upstox_token); })
      .catch(() => { if (!cancelled) useStore.getState().setError('Backend unreachable — start it with ./start.sh'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }, [theme]);

  const path = location.pathname;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {needsApiToken && (
        <div className="flex items-center gap-3 px-6 py-2.5 text-sm border-b" style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-border)', color: 'var(--warn)' }}>
          <KeyRound size={14} className="shrink-0" />
          <span className="flex-1 text-xs">
            <strong>No Upstox API token configured.</strong> Real-time data requires a valid token. No demo or random data is shown.
          </span>
          <button onClick={() => navigate('/settings')} className="text-xs font-semibold underline shrink-0 hover:opacity-75" style={{ color: 'var(--warn)' }}>
            Configure →
          </button>
        </div>
      )}

      <header className="h-14 flex items-center justify-between px-6 shrink-0 border-b" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-6 min-w-0">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <LineChart size={14} color="#fff" />
            </div>
            <span className="font-semibold text-sm whitespace-nowrap hidden sm:inline" style={{ color: 'var(--text)' }}>India Screener</span>
          </div>

          <nav className="flex items-center gap-1 overflow-x-auto min-w-0" style={{ scrollbarWidth: 'none' }}>
            <NavLink active={path === '/'} onClick={() => navigate('/')} icon={LayoutGrid} label="Screener" />
            <NavLink active={path === '/watchlist'} onClick={() => navigate('/watchlist')} icon={Star} label={`Watchlist${watchlist.length ? ` (${watchlist.length})` : ''}`} />
            <NavLink active={path === '/sectors' || path === '/heatmap'} onClick={() => navigate('/sectors')} icon={PieChart} label="Sectors" />
            <NavLink active={path === '/earnings'} onClick={() => navigate('/earnings')} icon={CalendarClock} label="Earnings" />
            <NavLink active={path === '/pre-results'} onClick={() => navigate('/pre-results')} icon={Rocket} label="Pre-Results" />
            <NavLink active={path === '/news'} onClick={() => navigate('/news')} icon={Newspaper} label="News" />
            <NavLink active={path === '/alerts'} onClick={() => navigate('/alerts')} icon={BellRing} label="Alerts" />
          </nav>
        </div>

        <div className="flex items-center gap-3 shrink-0 pl-3">
          {error && <div className="flex items-center gap-1 text-xs max-w-[280px] truncate" title={error} style={{ color: 'var(--down)' }}><AlertCircle size={13} className="shrink-0" /> {error}</div>}
          {marketOpen && (
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-medium whitespace-nowrap" style={{ color: 'var(--up)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--up)', animation: 'pulse 1.5s ease-in-out infinite' }} />
              Market open
            </div>
          )}
          {lastUpdated && !loading.screener && apiToken && (
            <span className="text-xs hidden md:block" style={{ color: 'var(--text-faint)' }}>Updated {lastUpdated}</span>
          )}
          {apiToken && (
            <span className="text-xs px-2 py-0.5 rounded-chip border font-medium" style={{ color: 'var(--up)', background: 'var(--up-bg)', borderColor: 'var(--up)' }}>Live</span>
          )}

          <button onClick={pollOnce} disabled={!apiToken || loading.screener} className="btn btn-ghost" style={{ width: 32, padding: 0, justifyContent: 'center' }}>
            <RefreshCw size={14} style={loading.screener ? { animation: 'spin 0.8s linear infinite' } : {}} />
          </button>
          <button onClick={toggleTheme} className="btn btn-ghost" style={{ width: 32, padding: 0, justifyContent: 'center' }}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={() => navigate('/settings')} className="btn btn-ghost" style={{ width: 32, padding: 0, justifyContent: 'center', ...(path === '/settings' ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : {}) }}>
            <Settings size={14} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <Suspense fallback={<div className="p-10 text-sm text-center" style={{ color: 'var(--text-faint)' }}>Loading…</div>}>
          <Routes>
            <Route path="/" element={<Screens />} />
            <Route path="/company/:symbol" element={<Company />} />
            <Route path="/watchlist" element={<WatchlistPanel />} />
            <Route path="/sectors" element={<Sectors />} />
            <Route path="/heatmap" element={<Sectors />} />
            <Route path="/earnings" element={<Earnings />} />
            <Route path="/pre-results" element={<PreResults />} />
            <Route path="/news" element={<News />} />
            <Route path="/alerts" element={<AlertsPanel />} />
            <Route path="/settings" element={<SettingsPanel />} />
            <Route path="*" element={<Screens />} />
          </Routes>
        </Suspense>
      </main>

      {chartModalTicker && <Suspense fallback={null}><ChartModal ticker={chartModalTicker} /></Suspense>}

      <footer className="px-6 py-2 text-xs border-t flex items-center justify-between" style={{ color: 'var(--text-faint)', borderColor: 'var(--border)', background: 'var(--bg-subtle)' }}>
        <span>{apiToken ? `Data: Upstox live${lastUpdated ? ` · updated ${lastUpdated}` : ''}` : 'Data: no API token configured — connect in Settings'}</span>
        <span>Nifty Total Market ({Object.keys(UNIVERSE).length} stocks) · Rule-based signals · Not investment advice</span>
      </footer>
    </div>
  );
}

function NavLink({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className={`nav-link whitespace-nowrap shrink-0${active ? ' active' : ''}`}>
      <Icon size={13} />
      {label}
    </button>
  );
}

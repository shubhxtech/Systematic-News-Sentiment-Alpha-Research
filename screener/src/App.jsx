import { useStore } from './lib/store';
import { useScreenerData } from './hooks/useScreenerData';
import {
  LineChart, LayoutGrid, Star, BellRing, Settings,
  RefreshCw, KeyRound, AlertCircle,
} from 'lucide-react';
import ScreenerTable    from './components/ScreenerTable';
import StockDetailPanel from './components/StockDetailPanel';
import SettingsPanel    from './components/SettingsPanel';
import SectorHeatmap    from './components/SectorHeatmap';
import AlertsPanel      from './components/AlertsPanel';
import WatchlistPanel   from './components/WatchlistPanel';
import MarketBreadth    from './components/MarketBreadth';
import ChartModal       from './components/ChartModal';

export default function App() {
  const {
    activeTab, setActiveTab,
    selectedTicker,
    apiToken,
    loading, error,
    chartModalTicker,
    lastUpdated,
    marketOpen,
    watchlist,
    needsApiToken,
  } = useStore();

  const { pollOnce } = useScreenerData();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>

      {/* ── No-token warning banner ──────────────────────────────────────── */}
      {needsApiToken && (
        <div
          className="flex items-center gap-3 px-6 py-2.5 text-sm border-b"
          style={{
            background:   'var(--warn-bg)',
            borderColor:  'var(--warn-border)',
            color:        'var(--warn)',
          }}
        >
          <KeyRound size={14} className="shrink-0" />
          <span className="flex-1 text-xs">
            <strong>No Upstox API token configured.</strong>{' '}
            Real-time data requires a valid token. No demo or random data is shown.
          </span>
          <button
            onClick={() => setActiveTab('settings')}
            className="text-xs font-semibold underline shrink-0 hover:opacity-75"
            style={{ color: 'var(--warn)' }}
          >
            Configure →
          </button>
        </div>
      )}

      {/* ── Top nav ────────────────────────────────────────────────────────── */}
      <header
        className="h-14 flex items-center justify-between px-6 shrink-0 border-b"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        {/* Logo + nav links */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded flex items-center justify-center"
              style={{ background: 'var(--accent)' }}
            >
              <LineChart size={14} color="#fff" />
            </div>
            <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              India Screener
            </span>
          </div>

          <nav className="flex items-center gap-1">
            <NavLink active={activeTab === 'screener'} onClick={() => setActiveTab('screener')} icon={LayoutGrid} label="Screener" />
            <NavLink
              active={activeTab === 'watchlist'}
              onClick={() => setActiveTab('watchlist')}
              icon={Star}
              label={`Watchlist${watchlist.length ? ` (${watchlist.length})` : ''}`}
            />
            <NavLink active={activeTab === 'heatmap'} onClick={() => setActiveTab('heatmap')} icon={LayoutGrid} label="Sectors" />
            <NavLink active={activeTab === 'alerts'}  onClick={() => setActiveTab('alerts')}  icon={BellRing}   label="Alerts" />
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {error && (
            <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--down)' }}>
              <AlertCircle size={13} /> Error
            </div>
          )}

          {marketOpen && (
            <div
              className="flex items-center gap-1.5 text-xs font-medium"
              style={{ color: 'var(--up)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--up)', animation: 'pulse 1.5s ease-in-out infinite' }}
              />
              Market open
            </div>
          )}

          {lastUpdated && !loading.screener && apiToken && (
            <span className="text-xs hidden md:block" style={{ color: 'var(--text-faint)' }}>
              Updated {lastUpdated}
            </span>
          )}

          {apiToken && (
            <span
              className="text-xs px-2 py-0.5 rounded-chip border font-medium"
              style={{ color: 'var(--up)', background: 'var(--up-bg)', borderColor: 'var(--up)' }}
            >
              Live
            </span>
          )}

          <button
            onClick={pollOnce}
            disabled={!apiToken || loading.screener}
            title={apiToken ? 'Refresh data' : 'Add API token first'}
            className="btn btn-ghost"
            style={{ width: 32, padding: 0, justifyContent: 'center' }}
          >
            <RefreshCw
              size={14}
              style={loading.screener ? { animation: 'spin 0.8s linear infinite' } : {}}
            />
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className="btn btn-ghost"
            style={{
              width: 32, padding: 0, justifyContent: 'center',
              ...(activeTab === 'settings' ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : {}),
            }}
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'screener' && (
          <div className="absolute inset-0 flex">
            <div
              className="flex-1 overflow-auto"
              style={{ borderRight: selectedTicker ? `1px solid var(--border)` : 'none' }}
            >
              <MarketBreadth />
              <ScreenerTable />
            </div>
            {selectedTicker && (
              <div
                className="w-[420px] overflow-auto flex-shrink-0"
                style={{ background: 'var(--bg-subtle)' }}
              >
                <StockDetailPanel ticker={selectedTicker} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'watchlist' && <WatchlistPanel />}
        {activeTab === 'heatmap'   && <SectorHeatmap />}
        {activeTab === 'alerts'    && <AlertsPanel />}
        {activeTab === 'settings'  && <SettingsPanel />}
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer
        className="px-6 py-2 text-xs border-t flex items-center justify-between"
        style={{ color: 'var(--text-faint)', borderColor: 'var(--border)', background: 'var(--bg-subtle)' }}
      >
        <span>
          {apiToken
            ? `Data: Upstox live${lastUpdated ? ` · updated ${lastUpdated}` : ''}`
            : 'Data: no API token configured — connect in Settings'}
        </span>
        <span>Nifty 500 universe · Rule-based signals · Not investment advice</span>
      </footer>

      {/* ── Chart modal ───────────────────────────────────────────────────── */}
      {chartModalTicker && <ChartModal ticker={chartModalTicker} />}
    </div>
  );
}

function NavLink({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className={`nav-link${active ? ' active' : ''}`}>
      <Icon size={13} />
      {label}
    </button>
  );
}

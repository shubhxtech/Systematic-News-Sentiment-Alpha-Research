import { useStore } from './lib/store';
import { useScreenerData } from './hooks/useScreenerData';
import { LineChart, LayoutGrid, BellRing, Star, RefreshCw, AlertCircle, Settings, KeyRound } from 'lucide-react';
import ScreenerTable from './components/ScreenerTable';
import StockDetailPanel from './components/StockDetailPanel';
import SettingsPanel from './components/SettingsPanel';
import SectorHeatmap from './components/SectorHeatmap';
import AlertsPanel from './components/AlertsPanel';
import WatchlistPanel from './components/WatchlistPanel';
import MarketBreadth from './components/MarketBreadth';
import ChartModal from './components/ChartModal';

export default function App() {
  const {
    activeTab, setActiveTab, selectedTicker,
    apiToken, loading, error, chartModalTicker,
    lastUpdated, marketOpen, watchlist, needsApiToken,
  } = useStore();
  const { pollOnce } = useScreenerData();

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── No-Token Banner ────────────────────────────────────────────────── */}
      {needsApiToken && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2.5 flex items-center gap-3">
          <KeyRound size={15} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300 flex-1">
            <strong>No Upstox API token configured.</strong>{' '}
            Real-time market data and charts require a valid token. No demo or random data will be shown.
          </p>
          <button
            onClick={() => setActiveTab('settings')}
            className="text-xs font-semibold text-amber-400 hover:text-amber-200 underline shrink-0"
          >
            Configure in Settings →
          </button>
        </div>
      )}

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav className="h-14 border-b border-white/[0.05] bg-[#080d18] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
              <LineChart size={14} className="text-white" />
            </div>
            <span className="font-semibold text-slate-100 tracking-tight">
              India Screener
            </span>
          </div>

          <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-white/[0.03]">
            <NavBtn active={activeTab === 'screener'} onClick={() => setActiveTab('screener')} icon={LayoutGrid} label="Screener" />
            <NavBtn
              active={activeTab === 'watchlist'}
              onClick={() => setActiveTab('watchlist')}
              icon={Star}
              label={`Watchlist${watchlist.length ? ` (${watchlist.length})` : ''}`}
            />
            <NavBtn active={activeTab === 'heatmap'} onClick={() => setActiveTab('heatmap')} icon={LayoutGrid} label="Heatmap" />
            <NavBtn active={activeTab === 'alerts'}  onClick={() => setActiveTab('alerts')}  icon={BellRing}   label="Alerts" />
          </div>
        </div>

        <div className="flex items-center gap-4">
          {error && <div className="text-xs text-red-400 flex items-center gap-1"><AlertCircle size={14}/> Error</div>}
          {lastUpdated && !loading.screener && apiToken && (
            <div className="text-xs text-slate-500 hidden md:block">Updated {lastUpdated}</div>
          )}
          {marketOpen && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              MARKET OPEN
            </div>
          )}
          {apiToken && (
            <div className="px-2 py-1 rounded text-xs border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              LIVE
            </div>
          )}
          <button
            onClick={pollOnce}
            disabled={!apiToken}
            className={`text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${loading.screener ? 'animate-spin' : ''}`}
            title={apiToken ? 'Refresh now' : 'Add API token to refresh'}
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`p-1.5 rounded-md transition-colors ${activeTab === 'settings' ? 'bg-blue-600/20 text-blue-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
          >
            <Settings size={18} />
          </button>
        </div>
      </nav>

      {/* ── Main Content ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'screener' && (
          <div className="absolute inset-0 flex">
            <div className="flex-1 overflow-auto border-r border-white/[0.05]">
              <MarketBreadth />
              <ScreenerTable />
            </div>
            {selectedTicker && (
              <div className="w-[420px] bg-[#0a111f] border-l border-white/[0.05] overflow-auto flex-shrink-0">
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

      {/* ── Portals ────────────────────────────────────────────────────────── */}
      {chartModalTicker && <ChartModal ticker={chartModalTicker} />}
    </div>
  );
}

function NavBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all
        ${active ? 'bg-slate-800 text-blue-400 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

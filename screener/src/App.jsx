import { useEffect } from 'react';
import { useStore } from './lib/store';
import { useScreenerData } from './hooks/useScreenerData';
import { LineChart, LayoutGrid, BellRing, Star, RefreshCw, AlertCircle, Settings } from 'lucide-react';
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
    lastUpdated, marketOpen, watchlist,
  } = useStore();
  const { pollOnce } = useScreenerData();

  const isDemo = !apiToken;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav className="h-14 border-b border-white/[0.05] bg-[#080d18] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
              <LineChart size={14} className="text-white" />
            </div>
            <span className="font-semibold text-slate-100 tracking-tight">
              India Quant Screener <span className="text-blue-500 font-mono text-[10px] ml-1">v2.0</span>
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
          {lastUpdated && !loading.screener && (
            <div className="text-[10px] text-slate-600 font-mono hidden md:block">Updated {lastUpdated}</div>
          )}
          {marketOpen && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              MARKET OPEN
            </div>
          )}
          <div className={`px-2 py-1 rounded text-[10px] font-mono border ${isDemo ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
            {isDemo ? 'DEMO MODE' : 'LIVE API'}
          </div>
          <button
            onClick={pollOnce}
            className={`text-slate-400 hover:text-white transition-colors ${loading.screener ? 'animate-spin' : ''}`}
            title="Refresh now"
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
            <div className={`flex-1 overflow-auto border-r border-white/[0.05] transition-all duration-300`}>
              <MarketBreadth />
              <ScreenerTable />
            </div>
            {selectedTicker && (
              <div className="w-[420px] bg-[#0a111f] border-l border-white/[0.05] overflow-auto flex-shrink-0 shadow-2xl">
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

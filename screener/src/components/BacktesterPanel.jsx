import { useState } from 'react';
import { useStore } from '../lib/store';
import { TICKERS, getHistoricalCandles } from '../lib/upstoxApi';
import { runBacktest } from '../lib/indicators';
import { Play, TrendingUp, TrendingDown, Target, Zap, ChevronRight } from 'lucide-react';
import { ResponsiveContainer, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip, Area } from 'recharts';

export default function BacktesterPanel() {
  const { backtestConfig, setBacktestConfig, backtestResult, setBacktestResult, backtestRunning, setBacktestRunning } = useStore();
  const [activeTab, setActiveTab] = useState('chart');

  const executeBacktest = async () => {
    setBacktestRunning(true);
    setBacktestResult(null);
    try {
      const candles = await getHistoricalCandles(backtestConfig.ticker, 'day', backtestConfig.startDate, backtestConfig.endDate);
      const res = runBacktest(candles, backtestConfig);
      if (res) setBacktestResult(res);
      else alert("Not enough data to run backtest.");
    } catch (e) {
      alert("Error fetching historical data: " + e.message);
    } finally {
      setBacktestRunning(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* ── Sidebar config ─────────────────────────────────────────────────── */}
      <div className="w-80 border-r border-white/5 bg-[#0a111f] p-6 flex flex-col gap-6 overflow-auto">
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><Zap size={18} className="text-yellow-500" /> Backtester Engine</h2>
        
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Target Asset</label>
            <select className="select-field" value={backtestConfig.ticker} onChange={e => setBacktestConfig({ticker: e.target.value})}>
              {TICKERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Strategy Model</label>
            <select className="select-field" value={backtestConfig.strategy} onChange={e => setBacktestConfig({strategy: e.target.value})}>
              <option value="full_alpha">Full Alpha (Tech + NLP + Fund)</option>
              <option value="tech_only">Technical Only (RSI/MACD/BB)</option>
              <option value="trend_following">Trend Following (EMA Cross)</option>
              <option value="mean_reversion">Mean Reversion (RSI/BB)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-semibold uppercase">Start Date</label>
              <input type="date" className="input-field" value={backtestConfig.startDate} onChange={e => setBacktestConfig({startDate: e.target.value})} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-semibold uppercase">End Date</label>
              <input type="date" className="input-field" value={backtestConfig.endDate} onChange={e => setBacktestConfig({endDate: e.target.value})} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-semibold uppercase">Stop Loss %</label>
              <input type="number" step="0.1" className="input-field" value={backtestConfig.stopLoss} onChange={e => setBacktestConfig({stopLoss: parseFloat(e.target.value)})} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-semibold uppercase">Take Profit %</label>
              <input type="number" step="0.1" className="input-field" value={backtestConfig.takeProfit} onChange={e => setBacktestConfig({takeProfit: parseFloat(e.target.value)})} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 font-semibold uppercase">Trading Costs (BPS)</label>
            <input type="number" className="input-field" value={backtestConfig.costs} onChange={e => setBacktestConfig({costs: parseFloat(e.target.value)})} />
          </div>
        </div>

        <button 
          onClick={executeBacktest} 
          disabled={backtestRunning}
          className="mt-auto w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 disabled:opacity-50 transition-all"
        >
          {backtestRunning ? <div className="spinner w-5 h-5 border-2 border-white/20 border-t-white rounded-full"></div> : <Play size={16} />}
          {backtestRunning ? 'Running Simulation...' : 'Run Backtest'}
        </button>
      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="flex-1 bg-[#060b12] p-8 flex flex-col">
        {!backtestResult ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <Target size={48} className="mb-4 opacity-20" />
            <p>Configure parameters and click "Run Backtest" to view results.</p>
          </div>
        ) : (
          <div className="flex flex-col h-full animate-in fade-in duration-500">
            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <KPICard label="Total Return" value={`${backtestResult.totalReturn}%`} icon={backtestResult.totalReturn >= 0 ? TrendingUp : TrendingDown} color={backtestResult.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <KPICard label="CAGR" value={`${backtestResult.cagr}%`} />
              <KPICard label="Max Drawdown" value={`${backtestResult.maxDrawdown}%`} color="text-red-400" />
              <KPICard label="Sharpe Ratio" value={backtestResult.sharpe} />
              <KPICard label="Win Rate" value={`${backtestResult.winRate}%`} />
              <KPICard label="Profit Factor" value={backtestResult.profitFactor} />
              <KPICard label="Total Trades" value={backtestResult.tradeCount} />
              <KPICard label="Avg Win / Loss" value={`${backtestResult.avgWin}% / ${backtestResult.avgLoss}%`} />
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/5 mb-6">
              <button onClick={() => setActiveTab('chart')} className={`px-4 py-2 border-b-2 font-medium text-sm transition-colors ${activeTab === 'chart' ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>Equity Curve</button>
              <button onClick={() => setActiveTab('trades')} className={`px-4 py-2 border-b-2 font-medium text-sm transition-colors ${activeTab === 'trades' ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>Trade Log</button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 min-h-0 bg-[#0a111f] rounded-2xl border border-white/5 p-4">
              {activeTab === 'chart' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={backtestResult.equity}>
                    <defs>
                      <linearGradient id="colorEq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="date" stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                    <YAxis domain={['auto', 'auto']} stroke="rgba(255,255,255,0.2)" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<EqTooltip />} />
                    <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorEq)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#060b12] sticky top-0 border-b border-white/5">
                      <tr>
                        <th className="px-4 py-2 text-slate-400 font-semibold">Entry Date</th>
                        <th className="px-4 py-2 text-slate-400 font-semibold">Exit Date</th>
                        <th className="px-4 py-2 text-slate-400 font-semibold text-right">Entry Price</th>
                        <th className="px-4 py-2 text-slate-400 font-semibold text-right">Exit Price</th>
                        <th className="px-4 py-2 text-slate-400 font-semibold text-right">Return %</th>
                        <th className="px-4 py-2 text-slate-400 font-semibold text-right">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtestResult.trades.map((t, i) => (
                        <tr key={i} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                          <td className="px-4 py-2 text-slate-300 font-mono text-xs">{t.entryDate}</td>
                          <td className="px-4 py-2 text-slate-300 font-mono text-xs">{t.exitDate}</td>
                          <td className="px-4 py-2 text-slate-300 font-mono text-xs text-right">₹{t.entryPrice.toFixed(2)}</td>
                          <td className="px-4 py-2 text-slate-300 font-mono text-xs text-right">₹{t.exitPrice.toFixed(2)}</td>
                          <td className={`px-4 py-2 font-mono text-xs font-bold text-right ${t.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {t.returnPct > 0 ? '+' : ''}{t.returnPct.toFixed(2)}%
                          </td>
                          <td className="px-4 py-2 text-slate-400 text-xs text-right">{t.reason}</td>
                        </tr>
                      ))}
                      {backtestResult.trades.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-slate-500">No trades executed.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ label, value, icon: Icon, color = 'text-white' }) {
  return (
    <div className="card p-4 flex flex-col justify-between">
      <div className="text-xs text-slate-400 uppercase font-semibold">{label}</div>
      <div className="mt-2 flex items-center justify-between">
        <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
        {Icon && <Icon size={20} className={color} />}
      </div>
    </div>
  );
}

const EqTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0a111f]/95 border border-white/10 p-3 rounded-lg shadow-xl backdrop-blur-md">
        <p className="text-slate-400 text-xs mb-1 font-mono">{label}</p>
        <p className="text-blue-400 font-bold font-mono text-sm">₹{payload[0].value.toFixed(2)}</p>
      </div>
    );
  }
  return null;
};

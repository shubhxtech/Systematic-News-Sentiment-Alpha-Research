import { useState, useMemo } from 'react';
import { useStore } from '../lib/store';
import { useScreenerData } from '../hooks/useScreenerData';
import {
  Star, Plus, Trash2, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, XCircle, Clock, Loader2, ChevronRight, Bell,
  Maximize2, ExternalLink, X
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Line, Bar
} from 'recharts';
import { ema, rsi as calcRsi, macd, bollingerBands } from '../lib/indicators';
import { UNIVERSE } from '../lib/upstoxApi';

// ── Technical buy-setup checklist ─────────────────────────────────────────
function buildChecklist(candles, data) {
  if (!candles?.daily?.length || !data) return [];
  const daily = candles.daily;
  const closes = daily.map(c => c.close);
  const vols   = daily.map(c => c.volume);
  const ema21  = ema(closes, 21);
  const ema50  = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsiArr = calcRsi(closes);
  const { histogram } = macd(closes);
  const bb = bollingerBands(closes);

  const last  = closes.length - 1;
  const price = closes[last];
  const e21   = ema21[last];
  const e50   = ema50[last];
  const e200  = ema200[last];
  const rsiV  = rsiArr[last];
  const macdH = histogram[last];
  const macdH1= histogram[last - 1];
  const bbMid = (bb.upper[last] + bb.lower[last]) / 2;
  const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const curVol = vols[last];

  return [
    {
      label: 'Price above EMA 21 (short-term uptrend)',
      pass: price > e21,
      detail: `Price ₹${price?.toFixed(1)} vs EMA21 ₹${e21?.toFixed(1)}`,
    },
    {
      label: 'EMA 21 above EMA 50 (medium-term bullish)',
      pass: e21 > e50,
      detail: `EMA21 ₹${e21?.toFixed(1)} vs EMA50 ₹${e50?.toFixed(1)}`,
    },
    {
      label: 'Price above EMA 200 (long-term uptrend)',
      pass: price > e200,
      detail: `Price ₹${price?.toFixed(1)} vs EMA200 ₹${e200?.toFixed(1)}`,
    },
    {
      label: 'RSI in buyable zone (40–65)',
      pass: rsiV >= 40 && rsiV <= 65,
      detail: `RSI: ${rsiV?.toFixed(1)} — ${rsiV < 40 ? 'Oversold/weak' : rsiV > 65 ? 'Overbought' : 'Good zone'}`,
    },
    {
      label: 'MACD Histogram turning bullish',
      pass: macdH > macdH1 && macdH > 0,
      detail: `Histogram: ${macdH?.toFixed(2)} (prev: ${macdH1?.toFixed(2)})`,
    },
    {
      label: 'Price above Bollinger Band midline',
      pass: price > bbMid,
      detail: `Price ₹${price?.toFixed(1)} vs BB Mid ₹${bbMid?.toFixed(1)}`,
    },
    {
      label: 'Volume above 20-day average',
      pass: curVol > avgVol,
      detail: `Vol: ${(curVol / 1000).toFixed(0)}K vs Avg: ${(avgVol / 1000).toFixed(0)}K`,
    },
    {
      label: 'ADX > 20 (trending market)',
      pass: (data.adx ?? 0) > 20,
      detail: `ADX: ${data.adx?.toFixed(1) ?? 'N/A'}`,
    },
  ];
}

// ── Mini chart data ────────────────────────────────────────────────────────
function buildChartData(candles) {
  if (!candles?.daily?.length) return [];
  const daily = candles.daily.slice(-90); // last 90 days
  const closes = daily.map(c => c.close);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  return daily.map((c, i) => ({
    date: c.date?.slice(0, 10),
    close: c.close,
    ema21: e21[i],
    ema50: e50[i],
    volume: c.volume,
  }));
}

// ── Alert dispatch helper ──────────────────────────────────────────────────
async function sendTelegramAlert(botToken, chatId, message) {
  if (!botToken || !chatId) return false;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
export default function WatchlistPanel() {
  const {
    watchlist, addToWatchlist, removeFromWatchlist,
    screenerData, candleCache,
    telegramBotToken, telegramChatId,
    alerts, addAlert,
    setChartModalTicker,
  } = useStore();
  const { fetchWatchlistTicker } = useScreenerData();

  const [input, setInput] = useState('');
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const handleAdd = async () => {
    const ticker = input.trim().toUpperCase();
    if (!ticker) return;
    if (watchlist.includes(ticker)) { setAddError('Already in watchlist'); return; }
    setAdding(true);
    setAddError('');
    addToWatchlist(ticker);
    // If not in universe, try to fetch
    if (!UNIVERSE[ticker]) {
      await fetchWatchlistTicker(ticker);
    }
    setInput('');
    setAdding(false);
    setSelected(ticker);
  };

  const handleRemove = (ticker) => {
    removeFromWatchlist(ticker);
    if (selected === ticker) setSelected(null);
  };

  const selectedData    = selected ? screenerData[selected] : null;
  const selectedCandles = selected ? candleCache[selected] : null;
  const checklist       = useMemo(() => buildChecklist(selectedCandles, selectedData), [selectedCandles, selectedData]);
  const chartData       = useMemo(() => buildChartData(selectedCandles), [selectedCandles]);

  const passCount = checklist.filter(c => c.pass).length;
  const readiness = checklist.length ? Math.round((passCount / checklist.length) * 100) : 0;

  const readinessColor =
    readiness >= 75 ? 'text-emerald-400' :
    readiness >= 50 ? 'text-amber-400' : 'text-red-400';

  const readinessBg =
    readiness >= 75 ? 'bg-emerald-500' :
    readiness >= 50 ? 'bg-amber-500' : 'bg-red-500';

  // Quick alert: set signal alert to BUY for selected ticker
  const handleSetAlert = () => {
    if (!selected) return;
    addAlert({
      id: Date.now().toString(),
      ticker: selected,
      metric: 'signal',
      condition: 'eq',
      value: 'BUY',
      createdAt: new Date().toISOString(),
      triggered: false,
      telegramEnabled: !!(telegramBotToken && telegramChatId),
    });
  };

  return (
    <div className="flex h-full bg-[#060b12]">
      {/* ── LEFT: Watchlist ────────────────────────────────────────────────── */}
      <div className="w-80 border-r border-white/[0.05] bg-[#0a111f] flex flex-col shrink-0">
        <div className="p-5 border-b border-white/[0.05]">
          <div className="flex items-center gap-2 mb-4">
            <Star size={18} className="text-amber-400 fill-amber-400" />
            <h2 className="font-bold text-white text-lg">Watchlist</h2>
            <span className="text-xs text-slate-500 font-mono ml-auto">{watchlist.length} stocks</span>
            {watchlist.length > 0 && (
              <button
                onClick={() => { if (window.confirm('Clear all watchlist stocks?')) { watchlist.forEach(t => removeFromWatchlist(t)); setSelected(null); } }}
                className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
                title="Clear all"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Add ticker input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value.toUpperCase()); setAddError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="NSE ticker, e.g. RELIANCE"
              className="input-field flex-1 font-mono text-sm"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !input.trim()}
              className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition-colors"
            >
              {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            </button>
          </div>
          {addError && <p className="text-red-400 text-xs mt-1">{addError}</p>}
          <a
            href="https://www.nseindia.com/market-data/securities-available-for-trading"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-blue-500/70 hover:text-blue-400 transition-colors mt-1"
          >
            <ExternalLink size={10} /> Find NSE symbols on nseindia.com
          </a>
        </div>

        {/* Watchlist items */}
        <div className="flex-1 overflow-auto">
          {watchlist.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3 p-6">
              <Star size={36} className="opacity-30" />
              <p className="text-sm text-center">Add stocks you want to monitor.<br />Type a ticker above and press Enter.</p>
            </div>
          ) : (
            watchlist.map(ticker => {
              const d = screenerData[ticker];
              const isSelected = selected === ticker;
              const chgPos = (d?.changePct ?? 0) >= 0;
              return (
                <div
                  key={ticker}
                  onClick={() => setSelected(ticker)}
                  className={`px-4 py-3 border-b border-white/[0.03] cursor-pointer flex items-center justify-between transition-all
                    ${isSelected ? 'bg-blue-900/20 border-l-2 border-l-blue-500' : 'hover:bg-white/[0.02]'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100 text-sm">{ticker}</span>
                      {d?.signal && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border
                          ${d.signal.includes('BUY') ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                            d.signal.includes('SELL') ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                            'text-slate-400 bg-slate-800 border-white/5'}`}
                        >{d.signal}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {d?.ltp ? (
                        <>
                          <span className="text-xs text-slate-300 font-mono">₹{d.ltp.toFixed(2)}</span>
                          <span className={`text-xs font-mono ${chgPos ? 'text-emerald-400' : 'text-red-400'}`}>
                            {chgPos ? '+' : ''}{d.changePct?.toFixed(2)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-600">Loading...</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ChevronRight size={14} className={`text-slate-600 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                    <button
                      onClick={e => { e.stopPropagation(); handleRemove(ticker); }}
                      className="p-1 text-slate-600 hover:text-red-400 transition-colors rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── RIGHT: Detail ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
            <Star size={48} className="opacity-20" />
            <p className="text-sm">Select a stock from your watchlist to see analysis</p>
          </div>
        ) : (
          <div className="p-6 flex flex-col gap-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-bold tracking-widest text-blue-500 uppercase mb-1">
                  {selectedData?.sector || UNIVERSE[selected]?.sector || 'Watchlist'}
                </div>
                <h2 className="text-3xl font-bold text-white">{selected}</h2>
                <p className="text-slate-400 text-sm mt-1">{selectedData?.name || UNIVERSE[selected]?.name || selected}</p>
                {selectedData?.ltp && (
                  <div className="flex items-end gap-3 mt-3">
                    <span className="text-2xl font-mono text-white">₹{selectedData.ltp.toFixed(2)}</span>
                    <span className={`text-sm font-mono pb-0.5 ${(selectedData.changePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(selectedData.changePct ?? 0) >= 0 ? '▲' : '▼'} {Math.abs(selectedData.changePct ?? 0).toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setChartModalTicker(selected)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600/10 border border-blue-500/20 text-blue-400 rounded-xl text-sm font-semibold hover:bg-blue-600/20 transition-colors"
                >
                  <Maximize2 size={16} /> Full Chart
                </button>
                <button
                  onClick={handleSetAlert}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-sm font-semibold hover:bg-amber-500/20 transition-colors"
                >
                  <Bell size={16} /> Set BUY Alert
                </button>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 ? (
              <div className="card p-4">
                <div className="flex items-center gap-4 mb-3">
                  <h3 className="font-semibold text-white">Price Chart (90 days)</h3>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-blue-400"><span className="w-4 h-0.5 bg-blue-400 inline-block"></span> EMA 21</span>
                    <span className="flex items-center gap-1 text-orange-400"><span className="w-4 h-0.5 bg-orange-400 inline-block"></span> EMA 50</span>
                    <span className="flex items-center gap-1 text-slate-400"><span className="w-4 h-0.5 bg-slate-400 inline-block"></span> Price</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="rgba(255,255,255,0.15)"
                      tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                      tickFormatter={d => d?.slice(5)}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      stroke="rgba(255,255,255,0.15)"
                      tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                      orientation="right"
                    />
                    <Tooltip
                      contentStyle={{ background: '#0a111f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Line type="monotone" dataKey="close" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} dot={false} name="Price" />
                    <Line type="monotone" dataKey="ema21" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="EMA 21" />
                    <Line type="monotone" dataKey="ema50" stroke="#f97316" strokeWidth={1.5} dot={false} name="EMA 50" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="card p-8 flex items-center justify-center text-slate-500 gap-3">
                <Loader2 size={20} className="animate-spin" />
                Loading chart data...
              </div>
            )}

            {/* Buy Setup Checklist + Monitoring */}
            <div className="grid grid-cols-2 gap-6">
              {/* Checklist */}
              <div className="card p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">Buy Setup Checklist</h3>
                  {checklist.length > 0 && (
                    <div className={`text-lg font-bold font-mono ${readinessColor}`}>{readiness}%</div>
                  )}
                </div>
                {checklist.length > 0 && (
                  <>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full ${readinessBg} transition-all duration-500`} style={{ width: `${readiness}%` }} />
                    </div>
                    <div className="space-y-2.5">
                      {checklist.map((item, i) => (
                        <div key={i} className="flex items-start gap-3">
                          {item.pass
                            ? <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                            : <XCircle size={16} className="text-red-400/60 mt-0.5 shrink-0" />
                          }
                          <div>
                            <div className={`text-xs font-medium ${item.pass ? 'text-slate-200' : 'text-slate-500'}`}>{item.label}</div>
                            <div className="text-[10px] text-slate-600 mt-0.5 font-mono">{item.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {!checklist.length && (
                  <p className="text-slate-600 text-sm text-center py-4">Loading indicators...</p>
                )}
              </div>

              {/* Monitoring Guidelines */}
              <div className="card p-5 flex flex-col gap-4">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <Clock size={16} className="text-blue-400" /> Monitoring Guidelines
                </h3>
                <div className="space-y-4 text-sm">
                  <GuideSection
                    icon={TrendingUp}
                    color="text-emerald-400"
                    title="Entry Trigger"
                    points={[
                      'All 8 checklist items pass (100%)',
                      'EMA 21 crosses above EMA 50 on daily chart',
                      'RSI reclaims 50 from below after a dip',
                      'Volume spike (≥2× average) on green candle',
                    ]}
                  />
                  <GuideSection
                    icon={AlertTriangle}
                    color="text-amber-400"
                    title="Watch for Entry (50–75%)"
                    points={[
                      'Price consolidating near EMA 21 support',
                      'RSI between 40–55 (cooling off, not broken)',
                      'MACD histogram shrinking (momentum pause)',
                      'Set alert: Signal turns BUY',
                    ]}
                  />
                  <GuideSection
                    icon={TrendingDown}
                    color="text-red-400"
                    title="Avoid / Exit Warning"
                    points={[
                      'Price below EMA 50 (medium-term breakdown)',
                      'RSI < 40 or > 70 (momentum extreme)',
                      'MACD histogram deeply negative',
                      'Volume drying up on up-days',
                    ]}
                  />
                </div>
              </div>
            </div>

            {/* Key Indicators */}
            {selectedData && (
              <div className="card p-5">
                <h3 className="font-semibold text-white mb-4">Key Indicators</h3>
                <div className="grid grid-cols-4 gap-4">
                  <StatCard label="RSI (14)" value={selectedData.rsi?.toFixed(1)} color={selectedData.rsi > 65 ? 'text-red-400' : selectedData.rsi < 40 ? 'text-amber-400' : 'text-emerald-400'} />
                  <StatCard label="ADX (14)" value={selectedData.adx?.toFixed(1)} color={(selectedData.adx ?? 0) > 25 ? 'text-emerald-400' : 'text-amber-400'} />
                  <StatCard label="EMA 21" value={selectedData.ema21 ? `₹${selectedData.ema21.toFixed(2)}` : '-'} />
                  <StatCard label="EMA 50" value={selectedData.ema50 ? `₹${selectedData.ema50.toFixed(2)}` : '-'} />
                  <StatCard label="BB Upper" value={selectedData.bbUp ? `₹${selectedData.bbUp.toFixed(2)}` : '-'} />
                  <StatCard label="BB Lower" value={selectedData.bbLow ? `₹${selectedData.bbLow.toFixed(2)}` : '-'} />
                  <StatCard label="52W High" value={selectedData.week52High ? `₹${selectedData.week52High.toFixed(2)}` : '-'} />
                  <StatCard label="52W Low"  value={selectedData.week52Low  ? `₹${selectedData.week52Low.toFixed(2)}`  : '-'} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GuideSection({ icon: Icon, color, title, points }) {
  return (
    <div>
      <div className={`flex items-center gap-2 font-semibold mb-2 ${color}`}>
        <Icon size={14} /> {title}
      </div>
      <ul className="space-y-1 pl-5 list-disc text-slate-500 text-xs">
        {points.map((p, i) => <li key={i}>{p}</li>)}
      </ul>
    </div>
  );
}

function StatCard({ label, value, color = 'text-slate-200' }) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-3">
      <div className="text-[10px] text-slate-600 uppercase mb-1">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>{value || '-'}</div>
    </div>
  );
}

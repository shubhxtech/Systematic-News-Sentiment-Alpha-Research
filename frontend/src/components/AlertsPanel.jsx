import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import { Bell, Plus, Trash2, CheckCircle2, Send } from 'lucide-react';
import { TICKERS } from '../lib/upstoxApi';
import { inr } from '../lib/format';

export default function AlertsPanel() {
  const { alerts, addAlert, removeAlert, telegramBotToken, telegramChatId, watchlist } = useStore();
  const [ticker, setTicker] = useState('RELIANCE');
  const [metric, setMetric] = useState('price');
  const [condition, setCondition] = useState('above');
  const [value, setValue] = useState('');

  // All available tickers = universe + watchlist
  const allTickers = [...new Set([...TICKERS, ...watchlist])].sort();

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch?.(() => {});
    }
  }, []);

  const handleAdd = (e) => {
    e.preventDefault();
    if (metric !== 'signal' && !Number.isFinite(parseFloat(value))) return;
    if (metric === 'signal' && !value) return;
    addAlert({
      id: Date.now().toString(),
      ticker,
      metric,
      condition,
      value: metric === 'signal' ? value : parseFloat(value),
      createdAt: new Date().toISOString(),
      triggered: false,
    });
    setValue('');
  };

  const tgConfigured = !!(telegramBotToken && telegramChatId);

  return (
    <div className="p-8 max-w-4xl mx-auto h-full flex flex-col gap-8 overflow-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-[var(--accent)] flex items-center justify-center text-white">
          <Bell size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)] tracking-tight">Alerts Engine</h1>
          <p className="text-muted text-sm mt-1">Set conditions and get instant browser notifications.</p>
        </div>
      </div>

      {/* Create Alert */}
      <div className="card p-6">
        <h3 className="font-semibold text-[var(--text)] mb-4">Create New Alert</h3>
        <form onSubmit={handleAdd} className="flex gap-4 items-end flex-wrap">
          <div className="flex flex-col gap-1.5 flex-1 min-w-[120px]">
            <label className="text-xs text-muted uppercase font-semibold">Ticker</label>
            <select className="select" value={ticker} onChange={e => setTicker(e.target.value)}>
              {allTickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 flex-1 min-w-[120px]">
            <label className="text-xs text-muted uppercase font-semibold">Metric</label>
            <select className="select" value={metric} onChange={e => { setMetric(e.target.value); setValue(''); }}>
              <option value="price">Price (LTP)</option>
              <option value="rsi">RSI</option>
              <option value="signal">Quant Signal</option>
            </select>
          </div>

          {metric !== 'signal' ? (
            <>
              <div className="flex flex-col gap-1.5 w-36">
                <label className="text-xs text-muted uppercase font-semibold">Condition</label>
                <select className="select" value={condition} onChange={e => setCondition(e.target.value)}>
                  <option value="above">Crosses Above</option>
                  <option value="below">Crosses Below</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-[100px]">
                <label className="text-xs text-muted uppercase font-semibold">Target Value</label>
                <input type="number" step="any" className="input" value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 1500" required />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5 flex-[2] min-w-[140px]">
              <label className="text-xs text-muted uppercase font-semibold">Target Signal</label>
              <select className="select" value={value} onChange={e => setValue(e.target.value)} required>
                <option value="" disabled>Select Signal...</option>
                <option value="BUY">BUY (includes Strong Buy)</option>
                <option value="STRONG BUY">STRONG BUY only</option>
                <option value="SELL">SELL</option>
                <option value="STRONG SELL">STRONG SELL</option>
              </select>
            </div>
          )}

          <button type="submit" className="btn btn-primary h-[34px] px-6">
            <Plus size={16} /> Add
          </button>
        </form>
      </div>

      {/* Active Alerts */}
      <div className="flex-1">
        <h3 className="font-semibold text-[var(--text)] mb-4">Active Alerts ({alerts.length})</h3>
        {alerts.length === 0 ? (
          <div className="empty-state">
            No alerts configured. Add one above.
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map(alert => (
              <div key={alert.id} className={`card p-4 flex items-center justify-between ${alert.triggered ? 'bg-[var(--up-bg)] border-[var(--up)]' : ''}`}>
                <div className="flex items-center gap-4">
                  {alert.triggered
                    ? <CheckCircle2 className="text-[var(--up)]" size={20} />
                    : <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                  }
                  <div>
                    <div className="font-bold text-[var(--text)]">{alert.ticker}</div>
                    <div className="text-sm text-muted font-mono mt-1">
                      {alert.metric.toUpperCase()} {alert.metric !== 'signal' ? (alert.condition === 'above' ? '≥' : '≤') : '='} {alert.value}
                    </div>
                    {alert.triggeredAt && (
                      <div className="text-[10px] text-muted mt-0.5">Triggered: {new Date(alert.triggeredAt).toLocaleTimeString('en-IN')}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {alert.triggered && <span className="text-xs font-bold text-[var(--up)] bg-[var(--up-bg)] px-2 py-1 rounded">TRIGGERED</span>}
                  <button onClick={() => removeAlert(alert.id)} className="p-2 text-muted hover:text-[var(--down)] hover:bg-[var(--bg-subtle)] rounded transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

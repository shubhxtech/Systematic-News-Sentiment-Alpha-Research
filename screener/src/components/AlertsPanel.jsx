import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import { Bell, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { TICKERS } from '../lib/upstoxApi';

export default function AlertsPanel() {
  const { alerts, addAlert, removeAlert, screenerData, triggerAlert } = useStore();
  const [ticker, setTicker] = useState('RELIANCE');
  const [metric, setMetric] = useState('price');
  const [condition, setCondition] = useState('above');
  const [value, setValue] = useState('');

  // Form submission
  const handleAdd = (e) => {
    e.preventDefault();
    if (!value && metric !== 'signal') return;
    
    addAlert({
      id: Date.now().toString(),
      ticker,
      metric,
      condition,
      value: metric === 'signal' ? value : parseFloat(value),
      createdAt: new Date().toISOString(),
      triggered: false
    });
    setValue('');
  };

  // Monitor loop
  useEffect(() => {
    if (!Object.keys(screenerData).length) return;

    alerts.forEach(alert => {
      if (alert.triggered) return;
      const data = screenerData[alert.ticker];
      if (!data) return;

      let isTriggered = false;
      if (alert.metric === 'price') {
        isTriggered = alert.condition === 'above' ? data.ltp >= alert.value : data.ltp <= alert.value;
      } else if (alert.metric === 'rsi') {
        isTriggered = alert.condition === 'above' ? data.rsi >= alert.value : data.rsi <= alert.value;
      } else if (alert.metric === 'signal') {
        isTriggered = data.signal === alert.value;
      }

      if (isTriggered) {
        triggerAlert(alert.id);
        // Browser notification
        if (Notification.permission === 'granted') {
          new Notification('Quant Screener Alert', {
            body: `${alert.ticker} ${alert.metric} is ${alert.condition} ${alert.value}`,
            icon: '/favicon.ico'
          });
        }
      }
    });
  }, [screenerData, alerts, triggerAlert]);

  // Request notification permission on mount
  useEffect(() => {
    if (Notification.permission === 'default') Notification.requestPermission();
  }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto h-full flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center shadow-lg shadow-purple-900/20">
          <Bell className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Alerts Engine</h1>
          <p className="text-slate-400 text-sm mt-1">Set background conditions. Get browser notifications instantly.</p>
        </div>
      </div>

      <div className="card p-6">
        <h3 className="font-semibold text-white mb-4">Create New Alert</h3>
        <form onSubmit={handleAdd} className="flex gap-4 items-end">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-xs text-slate-500 uppercase font-semibold">Ticker</label>
            <select className="select-field" value={ticker} onChange={e => setTicker(e.target.value)}>
              {TICKERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-xs text-slate-500 uppercase font-semibold">Metric</label>
            <select className="select-field" value={metric} onChange={e => {setMetric(e.target.value); setValue('');}}>
              <option value="price">Price (LTP)</option>
              <option value="rsi">RSI</option>
              <option value="signal">Quant Signal</option>
            </select>
          </div>

          {metric !== 'signal' ? (
            <>
              <div className="flex flex-col gap-1.5 w-32">
                <label className="text-xs text-slate-500 uppercase font-semibold">Condition</label>
                <select className="select-field" value={condition} onChange={e => setCondition(e.target.value)}>
                  <option value="above">Crosses Above</option>
                  <option value="below">Crosses Below</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-xs text-slate-500 uppercase font-semibold">Target Value</label>
                <input type="number" step="any" className="input-field" value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 1500" required />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5 flex-[2]">
              <label className="text-xs text-slate-500 uppercase font-semibold">Target Signal</label>
              <select className="select-field" value={value} onChange={e => setValue(e.target.value)} required>
                <option value="" disabled>Select Signal...</option>
                <option value="STRONG BUY">STRONG BUY</option>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="STRONG SELL">STRONG SELL</option>
              </select>
            </div>
          )}

          <button type="submit" className="btn-primary h-[34px] px-6">
            <Plus size={16} /> Add
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-auto">
        <h3 className="font-semibold text-white mb-4">Active Alerts ({alerts.length})</h3>
        
        {alerts.length === 0 ? (
          <div className="text-center p-12 border border-dashed border-white/10 rounded-xl text-slate-500">
            No alerts configured.
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map(alert => (
              <div key={alert.id} className={`card p-4 flex items-center justify-between ${alert.triggered ? 'border-emerald-500/30 bg-emerald-500/5' : ''}`}>
                <div className="flex items-center gap-4">
                  {alert.triggered ? (
                    <CheckCircle2 className="text-emerald-500" size={20} />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-blue-500 pulse-dot"></div>
                  )}
                  
                  <div>
                    <div className="font-bold text-white">{alert.ticker}</div>
                    <div className="text-sm text-slate-400 font-mono mt-1">
                      {alert.metric.toUpperCase()} {alert.metric !== 'signal' ? (alert.condition === 'above' ? '>' : '<') : '=='} {alert.value}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  {alert.triggered && <span className="text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">TRIGGERED</span>}
                  <button onClick={() => removeAlert(alert.id)} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
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

import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import { Key, Shield, CheckCircle2, Server, Clock, Database, Globe } from 'lucide-react';
import { testConnection } from '../lib/upstoxApi';

export default function SettingsPanel() {
  const { apiToken, setApiToken } = useStore();
  const [tokenInput, setTokenInput] = useState(apiToken);
  const [status, setStatus] = useState('unknown'); // 'checking', 'valid', 'invalid'

  const checkToken = async (token) => {
    if (!token) { setStatus('unknown'); return; }
    setStatus('checking');
    try {
      const ok = await testConnection();
      setStatus(ok ? 'valid' : 'invalid');
    } catch {
      setStatus('invalid');
    }
  };

  useEffect(() => {
    checkToken(apiToken);
  }, [apiToken]);

  const handleSave = () => {
    setApiToken(tokenInput);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto h-full flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
          <SettingsIcon className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">System Settings</h1>
          <p className="text-slate-400 text-sm mt-1">Configure data feeds and API connections.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        
        {/* ── API Configuration ────────────────────────────────────────────── */}
        <div className="card p-6 flex flex-col gap-6 h-fit">
          <div className="flex items-center gap-2 pb-4 border-b border-white/5">
            <Key size={18} className="text-blue-400" />
            <h3 className="font-semibold text-white">Upstox API Authentication</h3>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400 uppercase font-semibold">Access Token (JWT)</label>
            <input 
              type="password" 
              className="input-field py-2" 
              value={tokenInput} 
              onChange={e => setTokenInput(e.target.value)} 
              placeholder="Paste your Upstox API token here..."
            />
            <p className="text-[10px] text-slate-500">
              Leave blank to use <strong className="text-orange-400">DEMO MODE</strong> with synthetic generated data. 
              Tokens usually expire daily at 6:00 AM IST.
            </p>
          </div>

          <button onClick={handleSave} className="btn-primary justify-center py-2">
            Save Configuration
          </button>

          <div className="mt-2 p-3 rounded-lg border border-white/5 bg-slate-900/50 flex items-center justify-between">
            <span className="text-sm text-slate-400">Connection Status</span>
            {status === 'checking' && <div className="spinner w-4 h-4 border-2 border-slate-500 border-t-white rounded-full"></div>}
            {status === 'valid' && <span className="text-sm font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={16}/> LIVE</span>}
            {status === 'invalid' && <span className="text-sm font-bold text-red-400 flex items-center gap-1"><Shield size={16}/> UNAUTHORIZED</span>}
            {status === 'unknown' && <span className="text-sm font-bold text-orange-400 flex items-center gap-1"><Globe size={16}/> DEMO DATA</span>}
          </div>
        </div>

        {/* ── System Status ──────────────────────────────────────────────── */}
        <div className="card p-6 flex flex-col gap-6 h-fit">
          <div className="flex items-center gap-2 pb-4 border-b border-white/5">
            <Server size={18} className="text-emerald-400" />
            <h3 className="font-semibold text-white">System Diagnostics</h3>
          </div>

          <div className="space-y-4">
            <DiagnosticRow icon={Globe} label="Market Data API (Upstox)" status={apiToken ? (status === 'valid' ? 'Connected' : 'Error') : 'Demo Mode Fallback'} ok={status === 'valid' || !apiToken} />
            <DiagnosticRow icon={Server} label="NLP Backend (Port 8766)" status="Polling via /api" ok={true} />
            <DiagnosticRow icon={Database} label="Local Storage Cache" status="Active (Watchlist & Alerts)" ok={true} />
            <DiagnosticRow icon={Clock} label="Polling Interval" status="30 seconds" ok={true} />
          </div>
        </div>

      </div>
    </div>
  );
}

function SettingsIcon({ className }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>;
}

function DiagnosticRow({ icon: Icon, label, status, ok }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-3 text-slate-300">
        <Icon size={16} className="text-slate-500" />
        {label}
      </div>
      <div className={`font-mono text-xs ${ok ? 'text-emerald-400' : 'text-orange-400'}`}>
        {status}
      </div>
    </div>
  );
}

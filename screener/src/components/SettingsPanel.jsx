import { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import { Key, Shield, CheckCircle2, Server, Clock, Database, Globe, Send, Eye, EyeOff } from 'lucide-react';
import { testConnection } from '../lib/upstoxApi';

export default function SettingsPanel() {
  const { apiToken, setApiToken, telegramBotToken, telegramChatId, setTelegramConfig } = useStore();
  const [tokenInput, setTokenInput] = useState(apiToken);
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState('unknown');
  const [tgBotToken, setTgBotToken] = useState(telegramBotToken);
  const [tgChatId, setTgChatId] = useState(telegramChatId);
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTest, setTgTest] = useState(null);

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

  useEffect(() => { checkToken(apiToken); }, [apiToken]);

  const handleSaveToken = () => setApiToken(tokenInput);

  const handleSaveTelegram = async () => {
    setTgSaving(true);
    setTelegramConfig(tgBotToken, tgChatId);
    // Test it
    try {
      const res = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgChatId,
          text: `✅ <b>Quant Screener</b> connected!\n\nYour alerts will be delivered here.`,
          parse_mode: 'HTML',
        }),
      });
      setTgTest(res.ok ? 'success' : 'fail');
    } catch {
      setTgTest('fail');
    }
    setTgSaving(false);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto h-full flex flex-col gap-8 overflow-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
          <SettingsIcon className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">System Settings</h1>
          <p className="text-slate-400 text-sm mt-1">Configure data feeds and notification channels.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* ── Upstox API ───────────────────────────────────────────────────── */}
        <div className="card p-6 flex flex-col gap-5 h-fit">
          <div className="flex items-center gap-2 pb-4 border-b border-white/5">
            <Key size={18} className="text-blue-400" />
            <h3 className="font-semibold text-white">Upstox API Token</h3>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400 uppercase font-semibold">Access Token (JWT)</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className="input-field py-2 pr-10 w-full font-mono text-xs"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder="Paste your Upstox API token here..."
              />
              <button
                onClick={() => setShowToken(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              Leave blank for <strong className="text-orange-400">DEMO MODE</strong> with synthetic data.
              Tokens expire daily at 6:00 AM IST.
            </p>
          </div>

          <button onClick={handleSaveToken} className="btn-primary justify-center py-2">
            Save Token
          </button>

          <div className="p-3 rounded-lg border border-white/5 bg-slate-900/50 flex items-center justify-between">
            <span className="text-sm text-slate-400">Connection Status</span>
            {status === 'checking' && <div className="spinner w-4 h-4 border-2 border-slate-500 border-t-white rounded-full" />}
            {status === 'valid'    && <span className="text-sm font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={16}/> LIVE</span>}
            {status === 'invalid' && <span className="text-sm font-bold text-red-400 flex items-center gap-1"><Shield size={16}/> UNAUTHORIZED</span>}
            {status === 'unknown' && <span className="text-sm font-bold text-orange-400 flex items-center gap-1"><Globe size={16}/> DEMO DATA</span>}
          </div>
        </div>

        {/* ── Telegram ─────────────────────────────────────────────────────── */}
        <div className="card p-6 flex flex-col gap-5 h-fit">
          <div className="flex items-center gap-2 pb-4 border-b border-white/5">
            <Send size={18} className="text-blue-400" />
            <h3 className="font-semibold text-white">Telegram Alerts</h3>
          </div>

          <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/15 text-xs text-slate-400 space-y-1.5 leading-relaxed">
            <p className="text-blue-400 font-semibold">Setup in 3 steps:</p>
            <p>1. Message <span className="text-white font-mono">@BotFather</span> on Telegram → <code className="bg-slate-800 px-1 rounded">/newbot</code> → copy Bot Token</p>
            <p>2. Start your bot, then message <span className="text-white font-mono">@userinfobot</span> to get your Chat ID</p>
            <p>3. Paste both below and click Save</p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 uppercase font-semibold">Bot Token</label>
              <input
                type="password"
                className="input-field font-mono text-xs"
                value={tgBotToken}
                onChange={e => setTgBotToken(e.target.value)}
                placeholder="123456789:ABCDefGHIjklmNoPQRstUV..."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 uppercase font-semibold">Chat ID</label>
              <input
                type="text"
                className="input-field font-mono text-xs"
                value={tgChatId}
                onChange={e => setTgChatId(e.target.value)}
                placeholder="e.g. 123456789"
              />
            </div>
          </div>

          <button
            onClick={handleSaveTelegram}
            disabled={tgSaving || !tgBotToken || !tgChatId}
            className="btn-primary justify-center py-2 disabled:opacity-40"
          >
            {tgSaving ? 'Saving & Testing...' : 'Save & Send Test Message'}
          </button>

          {tgTest === 'success' && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              <CheckCircle2 size={16} /> Test message sent! Check Telegram.
            </div>
          )}
          {tgTest === 'fail' && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <Shield size={16} /> Failed. Double-check your Bot Token and Chat ID.
            </div>
          )}
        </div>

        {/* ── System Diagnostics ───────────────────────────────────────────── */}
        <div className="card p-6 flex flex-col gap-5 h-fit col-span-2">
          <div className="flex items-center gap-2 pb-4 border-b border-white/5">
            <Server size={18} className="text-emerald-400" />
            <h3 className="font-semibold text-white">System Diagnostics</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <DiagnosticRow icon={Globe}    label="Market Data API (Upstox)" status={apiToken ? (status === 'valid' ? 'Connected — Live Data' : 'Token error') : 'Demo Mode'} ok={status === 'valid' || !apiToken} />
            <DiagnosticRow icon={Send}     label="Telegram Notifications"   status={telegramBotToken && telegramChatId ? 'Configured' : 'Not configured'} ok={!!(telegramBotToken && telegramChatId)} />
            <DiagnosticRow icon={Database} label="Local Storage Cache"      status="Active (Watchlist & Alerts)" ok={true} />
            <DiagnosticRow icon={Clock}    label="Screener Poll Interval"   status="30 seconds (rate-limit safe)" ok={true} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsIcon({ className }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  );
}

function DiagnosticRow({ icon: Icon, label, status, ok }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-3 text-slate-300">
        <Icon size={16} className="text-slate-500" />
        {label}
      </div>
      <div className={`font-mono text-xs ${ok ? 'text-emerald-400' : 'text-orange-400'}`}>{status}</div>
    </div>
  );
}

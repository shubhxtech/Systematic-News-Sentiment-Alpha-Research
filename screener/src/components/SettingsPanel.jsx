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

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { checkToken(apiToken); }, [apiToken]);

  const handleSaveToken = () => setApiToken(tokenInput);

  const handleSaveTelegram = async () => {
    setTgSaving(true);
    setTelegramConfig(tgBotToken, tgChatId);
    try {
      const res = await fetch(`https://api.telegram.org/bot${tgBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgChatId,
          text: `✅ <b>India Screener</b> connected!\n\nAlerts will be delivered here.`,
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
    <div className="p-8 max-w-3xl mx-auto overflow-auto" style={{ color: 'var(--text)' }}>
      <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text)' }}>Settings</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        Configure your data source and notification channels.
      </p>

      <div className="flex flex-col gap-6">
        {/* ── Upstox API Token ───────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Key size={15} style={{ color: 'var(--accent)' }} />
              <span className="card-title">Upstox API Token</span>
            </div>
            <StatusBadge status={status} />
          </div>
          <div className="p-4 flex flex-col gap-4">
            <div
              className="text-xs p-3 rounded"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)', borderRadius: 'var(--radius)' }}
            >
              Tokens are stored in your browser's <code>localStorage</code> and expire daily at 6:00 AM IST.
              Without a token, no data will be shown.
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Access Token (JWT)
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  className="input w-full pr-9"
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveToken()}
                  placeholder="Paste your Upstox access token…"
                />
                <button
                  onClick={() => setShowToken(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={handleSaveToken} className="btn btn-primary">
                Save token
              </button>
              {apiToken && (
                <button
                  onClick={() => { setApiToken(''); setTokenInput(''); setStatus('unknown'); }}
                  className="btn btn-secondary"
                  style={{ color: 'var(--down)' }}
                >
                  Remove token
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Telegram Alerts ────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Send size={15} style={{ color: 'var(--accent)' }} />
              <span className="card-title">Telegram Alerts</span>
            </div>
            {telegramBotToken && telegramChatId && (
              <span className="text-xs font-medium" style={{ color: 'var(--up)' }}>Configured</span>
            )}
          </div>
          <div className="p-4 flex flex-col gap-4">
            <div
              className="text-xs p-3 rounded leading-relaxed"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)', borderRadius: 'var(--radius)' }}
            >
              <strong style={{ color: 'var(--text)' }}>Setup:</strong>{' '}
              1. Message <code>@BotFather</code> on Telegram → <code>/newbot</code> → copy Bot Token.{' '}
              2. Message <code>@userinfobot</code> to get your Chat ID.{' '}
              3. Paste both below.{' '}
              <br />
              <strong style={{ color: 'var(--down)' }}>Note:</strong>{' '}
              Alerts currently send directly from your browser. Keep this tab open for alerts to fire.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Bot Token</label>
                <input
                  type="password"
                  className="input"
                  value={tgBotToken}
                  onChange={e => setTgBotToken(e.target.value)}
                  placeholder="123456:ABCdef…"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Chat ID</label>
                <input
                  type="text"
                  className="input"
                  value={tgChatId}
                  onChange={e => setTgChatId(e.target.value)}
                  placeholder="123456789"
                />
              </div>
            </div>

            <button
              onClick={handleSaveTelegram}
              disabled={tgSaving || !tgBotToken || !tgChatId}
              className="btn btn-primary"
            >
              {tgSaving ? 'Saving & testing…' : 'Save & send test message'}
            </button>

            {tgTest === 'success' && (
              <div className="flex items-center gap-2 text-sm p-2 rounded" style={{ background: 'var(--up-bg)', color: 'var(--up)', borderRadius: 'var(--radius)' }}>
                <CheckCircle2 size={14} /> Test message sent — check Telegram.
              </div>
            )}
            {tgTest === 'fail' && (
              <div className="flex items-center gap-2 text-sm p-2 rounded" style={{ background: 'var(--down-bg)', color: 'var(--down)', borderRadius: 'var(--radius)' }}>
                <Shield size={14} /> Failed. Double-check your Bot Token and Chat ID.
              </div>
            )}
          </div>
        </div>

        {/* ── System Info ────────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <Server size={15} style={{ color: 'var(--text-muted)' }} />
              <span className="card-title">System info</span>
            </div>
          </div>
          <div className="p-4">
            <table className="w-full text-sm">
              <tbody>
                <InfoRow icon={Globe}    label="Market data" value={apiToken ? (status === 'valid' ? 'Connected — Upstox live' : 'Token error') : 'No token configured'} ok={status === 'valid'} />
                <InfoRow icon={Send}     label="Telegram alerts" value={telegramBotToken && telegramChatId ? 'Configured' : 'Not configured'} ok={!!(telegramBotToken && telegramChatId)} />
                <InfoRow icon={Database} label="Local cache" value="localStorage (watchlist, alerts, columns)" ok={true} />
                <InfoRow icon={Clock}    label="Screener poll interval" value="30 seconds" ok={true} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === 'checking') return (
    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Checking…</span>
  );
  if (status === 'valid') return (
    <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--up)' }}>
      <CheckCircle2 size={12} /> Connected
    </span>
  );
  if (status === 'invalid') return (
    <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--down)' }}>
      <Shield size={12} /> Unauthorized
    </span>
  );
  return <span className="text-xs" style={{ color: 'var(--text-faint)' }}>No token</span>;
}

function InfoRow({ icon: Icon, label, value, ok }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td className="py-2 pr-4 w-8">
        <Icon size={14} style={{ color: 'var(--text-faint)' }} />
      </td>
      <td className="py-2 pr-4" style={{ color: 'var(--text-muted)' }}>{label}</td>
      <td className="py-2 text-right" style={{ color: ok ? 'var(--up)' : 'var(--text-faint)' }}>{value}</td>
    </tr>
  );
}

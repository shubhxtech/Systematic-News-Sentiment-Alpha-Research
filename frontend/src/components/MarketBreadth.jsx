import { useMemo } from 'react';
import { useStore } from '../lib/store';

export default function MarketBreadth() {
  const screenerData = useStore(s => s.screenerData);
  const lastUpdated  = useStore(s => s.lastUpdated);
  const needsApiToken = useStore(s => s.needsApiToken);

  const stats = useMemo(() => {
    const rows = Object.values(screenerData);
    if (!rows.length) return null;
    const advancing = rows.filter(r => (r.changePct ?? 0) > 0).length;
    const declining = rows.filter(r => (r.changePct ?? 0) < 0).length;
    const unchanged = rows.length - advancing - declining;
    return { total: rows.length, advancing, declining, unchanged };
  }, [screenerData]);

  if (needsApiToken || !stats) return null;

  return (
    <div
      className="px-4 py-2 flex items-center gap-4 text-xs border-b"
      style={{ color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--bg-subtle)' }}
    >
      <span className="font-medium" style={{ color: 'var(--text)' }}>
        Nifty 500 · {stats.total} stocks
      </span>

      <span className="flex items-center gap-1">
        <span style={{ color: 'var(--up)', fontWeight: 600 }}>▲ {stats.advancing}</span>
        {' '}advancing
      </span>

      <span className="flex items-center gap-1">
        <span style={{ color: 'var(--down)', fontWeight: 600 }}>▼ {stats.declining}</span>
        {' '}declining
      </span>

      {stats.unchanged > 0 && (
        <span>{stats.unchanged} unchanged</span>
      )}

      {lastUpdated && (
        <span className="ml-auto" style={{ color: 'var(--text-faint)' }}>
          Updated {lastUpdated}
        </span>
      )}
    </div>
  );
}

import { ExternalLink, Clock, Repeat, ShieldCheck, ShieldAlert } from 'lucide-react';

const DIR_COLOR = { 1: 'var(--up)', '-1': 'var(--down)', 0: 'var(--text-muted)' };

function ago(iso) {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (!Number.isFinite(h)) return '';
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const crore = (v) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: v < 100 ? 1 : 0 })} cr`;

export function Chip({ children, color = 'var(--text-muted)', bg = 'var(--bg)', title }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap"
      style={{ color, background: bg, border: '1px solid var(--border)' }}>
      {children}
    </span>
  );
}

/** Event-type chip coloured by direction (green positive, red negative, grey neutral). */
export function EventChip({ item }) {
  const d = item.direction > 0 ? 1 : item.direction < 0 ? -1 : 0;
  const bg = d > 0 ? 'var(--up-bg)' : d < 0 ? 'var(--down-bg)' : 'var(--bg)';
  return <Chip color={DIR_COLOR[d]} bg={bg} title={item.matched ? `matched: “${item.matched}”` : undefined}>{item.event_label}</Chip>;
}

function Reliability({ item }) {
  const strong = item.reliability >= 0.8;
  const Icon = strong ? ShieldCheck : ShieldAlert;
  const color = item.reliability >= 0.8 ? 'var(--up)' : item.reliability >= 0.5 ? 'var(--text-muted)' : 'var(--warn)';
  return <Chip color={color} title={`Source reliability ${Math.round(item.reliability * 100)}%`}><Icon size={10} />{item.reliability_label}</Chip>;
}

export function CatalystItem({ item }) {
  const link = item.url || item.link;
  const pre = item.pre_move;
  return (
    <div className="p-4 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold leading-snug" style={{ color: 'var(--text)' }}>
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.title}</a>
          ) : item.title}
          {item.text && item.source_type === 'exchange' && (
            <div className="font-normal mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{item.text}</div>
          )}
        </div>
        {link && <ExternalLink size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <EventChip item={item} />
        <Chip title="Could this change expected earnings or business risk?"
          color={item.materiality_label === 'high' ? 'var(--accent)' : 'var(--text-muted)'}>
          {item.materiality_label} materiality
        </Chip>
        {item.novelty < 0.5 && <Chip color="var(--warn)" title="Repeats an earlier filing or article"><Repeat size={10} />repeat</Chip>}
        <Reliability item={item} />
        {item.order_value_cr != null && (
          <Chip color="var(--text)">
            {crore(item.order_value_cr)}
            {item.order_pct_revenue != null && ` · ${item.order_pct_revenue.toFixed(1)}% of rev`}
            {item.execution_months != null && ` · ${item.execution_months} mo`}
          </Chip>
        )}
        {item.client && <Chip>client: {item.client}</Chip>}
        {pre != null && Math.abs(pre) >= 0.03 && (
          <Chip color={item.priced_in > 0.3 ? 'var(--warn)' : 'var(--text-muted)'}
            title="Move in the 5 sessions before this item">
            {pre > 0 ? '+' : ''}{(pre * 100).toFixed(1)}% before
          </Chip>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        <span>{item.source}</span>
        <span className="flex items-center gap-1"><Clock size={10} />{ago(item.time)}</span>
        {item.impact !== 0 && (
          <span style={{ color: DIR_COLOR[item.impact > 0 ? 1 : -1] }}>impact {item.impact > 0 ? '+' : ''}{item.impact.toFixed(2)}</span>
        )}
      </div>
      {item.reasons?.length > 0 && (
        <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{item.reasons.join(' · ')}</div>
      )}
    </div>
  );
}

/** Net catalyst score bar: -1 … +1, centred. */
export function NetScore({ value }) {
  if (value == null) return null;
  const pct = Math.min(Math.abs(value), 1) * 50;
  const color = value > 0 ? 'var(--up)' : value < 0 ? 'var(--down)' : 'var(--text-faint)';
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-24 rounded-full" style={{ background: 'var(--border)' }}>
        <div className="absolute top-0 h-1.5 rounded-full" style={{
          background: color, width: `${pct}%`, left: value >= 0 ? '50%' : `${50 - pct}%`,
        }} />
        <div className="absolute top-[-2px] h-2.5 w-px left-1/2" style={{ background: 'var(--text-faint)' }} />
      </div>
      <span className="text-xs num font-semibold" style={{ color }}>{value > 0 ? '+' : ''}{value.toFixed(2)}</span>
    </div>
  );
}

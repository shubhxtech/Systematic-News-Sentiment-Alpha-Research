import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { CAPS } from '../lib/upstoxApi';
import { inr, signalLabel } from '../lib/format.jsx';

const DASH = '–';
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? DASH : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const median = (xs) => {
  const a = xs.filter(x => x != null && Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const retOver = (daily, k) => (daily?.length > k ? (daily.at(-1).close / daily.at(-1 - k).close - 1) * 100 : null);

/**
 * Diverging fill for a % move: up/down tokens as poles, neutral surface at zero.
 * ±4% (or ±40 signal points) saturates. Text never takes this colour; the number is always printed.
 */
function fill(v, scale = 4) {
  if (v == null || Number.isNaN(v)) return 'var(--bg-subtle)';
  const t = Math.min(Math.abs(v) / scale, 1);
  if (t < 0.05) return 'var(--bg-subtle)';
  return `color-mix(in srgb, ${v > 0 ? 'var(--up)' : 'var(--down)'} ${Math.round(10 + t * 45)}%, var(--bg))`;
}
const tone = (v) => (v == null ? 'var(--text-faint)' : v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-muted)');

const SORTS = {
  today: { label: 'Today', get: s => s.today },
  rel5: { label: '5D vs market', get: s => s.rel5 },
  rel20: { label: '20D vs market', get: s => s.rel20 },
  breadth: { label: 'Breadth', get: s => (s.n ? s.adv / s.n : null) },
};

export default function Sectors() {
  const navigate = useNavigate();
  const screenerData = useStore(s => s.screenerData);
  const candleCache = useStore(s => s.candleCache);
  const needsApiToken = useStore(s => s.needsApiToken);
  const [cap, setCap] = useState('All');
  const [colorBy, setColorBy] = useState('change');
  const [sortKey, setSortKey] = useState('today');
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [idx, setIdx] = useState(null);   // /api/sectors: sector index trend (last close)

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sectors').then(r => (r.ok ? r.json() : null)).then(d => !cancelled && setIdx(d)).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const mkt = idx?.market;
  const sectors = useMemo(() => {
    const groups = {};
    for (const d of Object.values(screenerData)) {
      if (!d.sector || (cap !== 'All' && d.cap !== cap)) continue;
      (groups[d.sector] ||= []).push(d);
    }
    return Object.entries(groups).map(([name, stocks]) => {
      const chg = stocks.map(s => s.changePct);
      const adv = chg.filter(c => c > 0).length;
      const dec = chg.filter(c => c < 0).length;
      // Trend from the sector's own stocks when enough history has loaded, else its NSE index.
      const withHist = stocks.filter(s => candleCache[s.ticker]?.daily?.length > 61);
      const own = withHist.length >= Math.max(3, stocks.length * 0.5);
      const ixName = idx?.sector_to_index?.[name.toLowerCase().replace(/\s+/g, ' ')];
      const ix = ixName ? idx?.indices?.[ixName] : null;
      const trend = (k) => {
        if (own) {
          const r = median(withHist.map(s => retOver(candleCache[s.ticker].daily, k)));
          const m = mkt?.[`ret_${k}d`];
          return r == null || m == null ? null : r - m * 100;
        }
        return ix?.[`rel_${k}d`] != null ? ix[`rel_${k}d`] * 100 : null;
      };
      const sorted = [...stocks].sort((a, b) => (b.changePct ?? -99) - (a.changePct ?? -99));
      return {
        name, stocks: sorted, n: stocks.length, adv, dec, flat: stocks.length - adv - dec,
        today: median(chg), score: median(stocks.map(s => s.signalScore)),
        rel5: trend(5), rel20: trend(20), rel60: trend(60),
        trendSource: own ? `median of ${withHist.length} stocks` : ixName ? `${ixName} index (proxy)` : null,
        proxy: !own && !!ix,
        best: sorted.find(s => s.changePct != null), worst: [...sorted].reverse().find(s => s.changePct != null),
      };
    }).sort((a, b) =>
      // a median of one or two stocks is noise, so tiny groups always sort last
      (a.n < 3) - (b.n < 3)
      || (SORTS[sortKey].get(b) ?? -Infinity) - (SORTS[sortKey].get(a) ?? -Infinity));
  }, [screenerData, candleCache, cap, sortKey, idx, mkt]);

  const all = Object.values(screenerData);
  if (needsApiToken) {
    return <div className="empty-state h-full">Configure your Upstox token in Settings to load sector data.</div>;
  }
  if (!all.length) return <div className="empty-state h-full">Loading quotes…</div>;

  const totalAdv = all.filter(d => d.changePct > 0).length;
  const totalDec = all.filter(d => d.changePct < 0).length;
  const shown = selected ? sectors.filter(s => s.name === selected) : sectors;
  const maxAbsToday = Math.max(1, ...sectors.map(s => Math.abs(s.today ?? 0)));

  return (
    <div className="absolute inset-0 overflow-auto" style={{ background: 'var(--bg)' }}>
      {/* header */}
      <div className="px-6 pt-5 pb-3 flex flex-wrap items-end gap-x-8 gap-y-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Sectors</h1>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
            Today: equal-weighted median of live quotes. Trend vs {mkt?.index || 'Nifty 500'}
            {mkt?.as_of ? ` as of ${mkt.as_of} close` : ''}.
          </div>
        </div>
        <Stat label="Advancing" value={totalAdv} color="var(--up)" />
        <Stat label="Declining" value={totalDec} color="var(--down)" />
        {mkt && <Stat label={`${mkt.index} 5D / 20D`} value={`${fmt(mkt.ret_5d * 100)} / ${fmt(mkt.ret_20d * 100)}`} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {['All', ...CAPS].map(c => (
            <button key={c} className={`chip${cap === c ? ' active' : ''}`} onClick={() => setCap(c)}>
              {c === 'All' ? 'All sizes' : `${c} cap`}
            </button>
          ))}
        </div>
      </div>

      {/* rotation table */}
      <div className="px-6 pt-4">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Rotation</h2>
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Click a sector to focus the heatmap</span>
          <label className="ml-auto text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>Sort by
            <select className="select" value={sortKey} onChange={e => setSortKey(e.target.value)}>
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Sector</th>
              <th className="num">Stocks</th>
              <th style={{ width: 200 }}>Today (median)</th>
              <th style={{ width: 180 }}>Breadth</th>
              <th className="num" title="Sector return minus Nifty 500 return">5D vs mkt</th>
              <th className="num">20D vs mkt</th>
              <th className="num hidden lg:table-cell">60D vs mkt</th>
              <th className="hidden lg:table-cell">Best / worst today</th>
            </tr>
          </thead>
          <tbody>
            {sectors.map(s => (
              <tr key={s.name} role="button" tabIndex={0}
                onClick={() => setSelected(selected === s.name ? null : s.name)}
                onKeyDown={e => e.key === 'Enter' && setSelected(selected === s.name ? null : s.name)}
                style={{ ...(selected === s.name ? { background: 'var(--accent-bg)' } : {}), ...(s.n < 3 ? { opacity: 0.6 } : {}) }}>
                <td className="font-medium text-sm" style={{ color: 'var(--text)' }}>{s.name}</td>
                <td className="num" style={{ color: 'var(--text-muted)' }}>{s.n}</td>
                <td><DivergingBar value={s.today} max={maxAbsToday} /></td>
                <td><Breadth adv={s.adv} dec={s.dec} flat={s.flat} /></td>
                {[s.rel5, s.rel20, s.rel60].map((v, i) => (
                  <td key={i} className={`num${i === 2 ? ' hidden lg:table-cell' : ''}`} title={s.trendSource || 'no sector index mapped'}
                    style={{ color: tone(v), fontStyle: s.proxy ? 'italic' : 'normal', opacity: s.proxy ? 0.75 : 1 }}>
                    {fmt(v)}{s.proxy && v != null && <sup className="ml-0.5 not-italic" style={{ color: 'var(--text-faint)' }}>idx</sup>}
                  </td>
                ))}
                <td className="hidden lg:table-cell text-xs" style={{ color: 'var(--text-muted)' }}>
                  {s.best && <span>{s.best.ticker} <span style={{ color: tone(s.best.changePct) }}>{fmt(s.best.changePct)}</span></span>}
                  {s.worst && s.worst !== s.best && <span> · {s.worst.ticker} <span style={{ color: tone(s.worst.changePct) }}>{fmt(s.worst.changePct)}</span></span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
          Trend figures are the median of the sector's own stocks once their price history has loaded.
          Until then, figures marked <i>idx</i> come from the closest NSE sector index, so several sectors can
          share one. Hover for the source. Faded rows have fewer than 3 stocks.
        </div>
      </div>

      {/* heatmap */}
      <div className="px-6 py-5">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Heatmap{selected ? ` · ${selected}` : ''}
          </h2>
          {selected && <button className="chip" onClick={() => setSelected(null)}>Show all sectors</button>}
          <div className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Colour by
            {[['change', 'Today %'], ['signal', 'Signal score']].map(([k, l]) => (
              <button key={k} className={`chip${colorBy === k ? ' active' : ''}`} onClick={() => setColorBy(k)}>{l}</button>
            ))}
            <Legend colorBy={colorBy} />
          </div>
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: selected ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {shown.map(s => {
            const open = selected === s.name || expanded[s.name];
            const tiles = open ? s.stocks : s.stocks.slice(0, 24);
            return (
              <div key={s.name} className="card overflow-hidden">
                <div className="px-3 py-2 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{s.name}</span>
                  <span className="text-xs num" style={{ color: tone(s.today) }}>{fmt(s.today, 2)}</span>
                </div>
                <div className="p-1.5 grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))' }}>
                  {tiles.map(st => {
                    const v = colorBy === 'change' ? st.changePct : st.signalScore;
                    return (
                      <button key={st.ticker} onClick={() => navigate(`/company/${st.ticker}`)}
                        className="rounded px-1.5 py-1 text-left hover:outline hover:outline-1"
                        style={{ background: fill(v, colorBy === 'change' ? 4 : 50), outlineColor: 'var(--border-strong)' }}
                        title={`${st.name}\n₹${inr(st.ltp)} · ${fmt(st.changePct, 2)} today\nSignal: ${st.signal ? signalLabel(st.signal) : '–'}${st.signalScore != null ? ` (${st.signalScore})` : ''}\n${st.cap || ''} cap`}>
                        <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--text)' }}>{st.ticker}</div>
                        <div className="text-[10px] num" style={{ color: 'var(--text-muted)' }}>
                          {colorBy === 'change' ? fmt(st.changePct, 2) : (st.signalScore ?? DASH)}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {s.n > 24 && selected !== s.name && (
                  <button className="w-full text-xs py-1.5 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                    onClick={() => setExpanded(e => ({ ...e, [s.name]: !e[s.name] }))}>
                    {expanded[s.name] ? 'Show top 24' : `Show all ${s.n}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color = 'var(--text)' }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="text-base font-semibold num" style={{ color }}>{value}</div>
    </div>
  );
}

/** Bar from a centre line; length ∝ |value| / max. The printed number carries the sign. */
function DivergingBar({ value, max }) {
  const w = value == null ? 0 : Math.min(Math.abs(value) / max, 1) * 50;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2.5 flex-1" style={{ minWidth: 90 }}>
        <div className="absolute top-[-2px] bottom-[-2px] left-1/2 w-px" style={{ background: 'var(--border-strong)' }} />
        {value != null && (
          <div className="absolute top-0 h-2.5" style={{
            left: value >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`,
            background: value >= 0 ? 'var(--up)' : 'var(--down)',
            borderRadius: value >= 0 ? '0 4px 4px 0' : '4px 0 0 4px',
          }} />
        )}
      </div>
      <span className="text-xs num w-12 text-right" style={{ color: 'var(--text)' }}>{fmt(value, 2)}</span>
    </div>
  );
}

/** Advancers / unchanged / decliners as one stacked bar with 2px gaps. */
function Breadth({ adv, dec, flat }) {
  const n = adv + dec + flat || 1;
  const parts = [[adv, 'var(--up)'], [flat, 'var(--border-strong)'], [dec, 'var(--down)']].filter(([v]) => v > 0);
  return (
    <div className="flex items-center gap-2" title={`${adv} up · ${flat} unchanged · ${dec} down`}>
      <div className="flex h-2.5 flex-1 gap-[2px]" style={{ minWidth: 80 }}>
        {parts.map(([v, c], i) => (
          <div key={i} style={{
            width: `${(v / n) * 100}%`, background: c,
            borderRadius: `${i === 0 ? 4 : 0}px ${i === parts.length - 1 ? 4 : 0}px ${i === parts.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
          }} />
        ))}
      </div>
      <span className="text-xs num w-10 text-right" style={{ color: 'var(--text-muted)' }}>{Math.round((adv / n) * 100)}% ↑</span>
    </div>
  );
}

function Legend({ colorBy }) {
  const steps = colorBy === 'change' ? [-4, -2, 0, 2, 4] : [-50, -25, 0, 25, 50];
  return (
    <span className="flex items-center gap-1 ml-2" aria-label="colour scale">
      <span>{colorBy === 'change' ? '−4%' : '−50'}</span>
      {steps.map(v => (
        <span key={v} className="inline-block w-4 h-3 rounded-sm border" style={{ background: fill(v, steps[4]), borderColor: 'var(--border)' }} />
      ))}
      <span>{colorBy === 'change' ? '+4%' : '+50'}</span>
    </span>
  );
}

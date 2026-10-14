import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Download, Search, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, AlertCircle, ExternalLink,
} from 'lucide-react';
import { inr } from '../lib/format.jsx';
import { NetScore } from '../components/CatalystList';

const DASH = '–';
const pctTxt = (v, d = 1) => (v == null ? DASH : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const tone = (v) => (v == null ? 'var(--text-faint)' : v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-muted)');

const STAGES = {
  Early:       { color: 'var(--up)',     bg: 'var(--up-bg)',   tip: 'Relative strength turning up with acceleration or rising participation; not yet extended' },
  Building:    { color: 'var(--accent)', bg: 'var(--accent-bg)', tip: 'Clear outperformance under way, not yet extended' },
  Neutral:     { color: 'var(--text-muted)', bg: 'var(--bg)',  tip: 'No clear signal' },
  Extended:    { color: 'var(--warn)',   bg: 'var(--warn-bg)', tip: 'Already rallied hard (20-day move > 1.5σ or RSI > 70) — likely priced in' },
  Weak:        { color: 'var(--down)',   bg: 'var(--down-bg)', tip: 'Underperforming its sector / market' },
  'Too close': { color: 'var(--text-faint)', bg: 'var(--bg)',  tip: 'Results in under 2 sessions — too late for a pre-results setup' },
  'No data':   { color: 'var(--text-faint)', bg: 'var(--bg)',  tip: 'Not enough price history' },
};

const COMPONENT_LABELS = {
  timing: 'Timing', rel_strength: 'Relative strength', acceleration: 'Acceleration', participation: 'Volume / delivery',
  history: 'Past pre-results drift', fundamentals: 'Fundamentals', catalysts: 'Filings', liquidity: 'Liquidity / risk',
};

function StageBadge({ stage }) {
  const s = STAGES[stage] || STAGES.Neutral;
  return (
    <span title={s.tip} className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ color: s.color, background: s.bg, border: '1px solid var(--border)' }}>{stage}</span>
  );
}

function Bar({ value, color = 'var(--accent)', width = 64 }) {
  if (value == null) return <span style={{ color: 'var(--text-faint)' }}>{DASH}</span>;
  return (
    <div className="h-1.5 rounded-full" style={{ width, background: 'var(--border)' }}>
      <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

const COLUMNS = [
  { key: 'rank', label: '#', num: true },
  { key: 'company', label: 'Company' },
  { key: 'trading_days_left', label: 'Result', num: true, title: 'Trading sessions until the results board meeting' },
  { key: 'stage', label: 'Stage' },
  { key: 'score', label: 'Score', num: true },
  { key: 'rel5', label: 'RS 5d', num: true, title: 'Return minus sector index (or Nifty 500) over 5 sessions' },
  { key: 'rel10', label: 'RS 10d', num: true, hide: true },
  { key: 'accel', label: 'Accel.', num: true, hide: true, title: 'Last 5-session return minus the 5 before' },
  { key: 'rvol_5d', label: 'RVol', num: true, title: '5-day volume ÷ 50-day average' },
  { key: 'deliv_qty_ratio', label: 'Deliv×', num: true, hide: true, title: 'Delivered shares, last 5 sessions ÷ prior 20' },
  { key: 'hist_pre_excess_mean', label: 'Hist. drift', num: true, hide: true, title: 'Average excess return in the 10 sessions before past results' },
  { key: 'fund_score', label: 'Fund.', num: true, hide: true },
  { key: 'catalyst_score', label: 'Filings', num: true, hide: true, title: 'Net catalyst score from the last 30 days of exchange filings' },
  { key: 'adv20_cr', label: 'ADV ₹cr', num: true, hide: true },
];

const sortVal = (r, k) => {
  if (k === 'rel5') return r.rel_sec_5d ?? r.rel_mkt_5d;
  if (k === 'rel10') return r.rel_sec_10d ?? r.rel_mkt_10d;
  return r[k];
};

export default function PreResults() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [opts, setOpts] = useState({ days: 30, topK: 60 });
  const [f, setF] = useState({ search: '', stages: ['Early', 'Building'], minAdv: 2, enrichedOnly: false });
  const [sort, setSort] = useState({ key: 'score', dir: 'desc' });
  const [open, setOpen] = useState(null);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch('/api/premomentum/runs');
      if (r.ok) setRuns(await r.json());
    } catch { /* backend offline: handled by loadRun */ }
  }, []);

  const loadRun = useCallback(async (run = 'latest') => {
    setError('');
    try {
      const res = await fetch(`/api/premomentum/results?run=${encodeURIComponent(run)}`);
      if (res.status === 404) { setData(null); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setOpen(null);
    } catch (e) {
      setError(`Could not load results: ${e.message}. Is the backend running?`);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount
  useEffect(() => { loadRun(); loadRuns(); }, [loadRun, loadRuns]);

  // Reattach to a scan that is still running (started before navigating away or reloading)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/premomentum/active')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled && j?.status === 'running') setJob(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const jobId = job?.id;
  const running = job?.status === 'running';
  useEffect(() => {
    if (!jobId || !running) return;
    let misses = 0;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/premomentum/status?id=${jobId}`);
        if (res.status === 404) {
          setJob(p => ({ ...p, status: 'error' }));
          setError('The scan was lost (backend restarted). Start it again.');
          return;
        }
        const j = await res.json();
        misses = 0;
        setJob(p => ({ ...p, ...j }));
        if (j.status === 'done') { loadRun(j.run_id); loadRuns(); }
        if (j.status === 'error') setError(j.error || 'Scan failed');
      } catch {
        if (++misses >= 20) {
          setJob(p => ({ ...p, status: 'error' }));
          setError('Lost contact with the backend during the scan.');
        }
      }
    }, 1500);
    return () => clearInterval(t);
  }, [jobId, running, loadRun, loadRuns]);

  async function startScan() {
    setError('');
    try {
      const res = await fetch('/api/premomentum/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days_ahead: opts.days, top_k: opts.topK }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setJob({ id: j.job_id, status: 'running', stage: 'queued', done: 0, total: 0 });
    } catch (e) {
      setError(e.message);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const q = f.search.trim().toLowerCase();
    const r = data.rows.filter(x =>
      (!q || (x.company || '').toLowerCase().includes(q) || (x.symbol || '').toLowerCase().includes(q)) &&
      (!f.stages.length || f.stages.includes(x.stage)) &&
      (x.adv20_cr == null || x.adv20_cr >= f.minAdv) &&
      (!f.enrichedOnly || x.enriched));
    const m = sort.dir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => {
      const av = sortVal(a, sort.key), bv = sortVal(b, sort.key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * m;
    });
  }, [data, f, sort]);

  const s = data?.summary;
  const pctDone = job?.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const toggleStage = (st) => setF(p => ({ ...p, stages: p.stages.includes(st) ? p.stages.filter(x => x !== st) : [...p.stages, st] }));

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* header */}
      <div className="px-6 py-4 border-b flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--border)' }}>
        <div className="mr-4 max-w-xl">
          <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Pre-results momentum</div>
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            Companies whose momentum is starting to build before quarterly results. Calendar from NSE plus your uploaded
            board-meeting file. Stocks that have already rallied are penalised.
          </div>
        </div>
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>Results within
          <select className="select" value={opts.days} onChange={e => setOpts(o => ({ ...o, days: +e.target.value }))}>
            {[14, 21, 30, 45].map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}
          title="The top N from the price screen get the slower checks: past-results history and exchange filings">
          Deep-check top
          <select className="select" value={opts.topK} onChange={e => setOpts(o => ({ ...o, topK: +e.target.value }))}>
            {[30, 60, 100, 150].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" disabled={running} onClick={startScan}>
          <Play size={13} /> {running ? 'Scanning…' : 'Run scan'}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {runs.length > 0 && (
            <select className="select" value={data?.run_id || ''} onChange={e => e.target.value && loadRun(e.target.value)}>
              {!data?.run_id && <option value="">Select a run</option>}
              {runs.map(r => <option key={r.run_id} value={r.run_id}>{r.generated_at.replace('T', ' ').slice(0, 16)} · {r.rows} names</option>)}
            </select>
          )}
          {data && <>
            <a className="btn btn-secondary" href={`/api/premomentum/results?run=${data.run_id || 'latest'}&format=csv&download=1`}><Download size={13} /> CSV</a>
            <a className="btn btn-secondary" href={`/api/premomentum/results?run=${data.run_id || 'latest'}&format=json&download=1`}><Download size={13} /> JSON</a>
          </>}
        </div>
      </div>

      {running && (
        <div className="px-6 py-2 text-xs border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          {job.stage}{job.total ? ` · ${job.done}/${job.total}` : ''} <span style={{ color: 'var(--text-faint)' }}>(usually 1–3 minutes; NSE is rate-limited)</span>
          <div style={{ height: 3, background: 'var(--border)', marginTop: 6 }}>
            <div style={{ height: 3, width: `${pctDone}%`, background: 'var(--accent)', transition: 'width .3s' }} />
          </div>
        </div>
      )}
      {error && <div className="px-6 py-2 text-xs flex items-center gap-2" style={{ color: 'var(--down)' }}><AlertCircle size={13} />{error}</div>}

      {s && (
        <div className="px-6 py-2 text-xs border-b flex flex-wrap items-center gap-x-5 gap-y-1" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <span>{s.upcoming} upcoming results · <b>{s.scored}</b> scored · {s.enriched} deep-checked</span>
          <span>{s.with_sector_index} vs sector index · {s.with_delivery} with delivery data · {s.with_fundamentals} with fundamentals</span>
          {s.market && (
            <span>
              {s.market.index}: 5d <b style={{ color: tone(s.market.ret_5d) }}>{pctTxt(s.market.ret_5d)}</b>,
              20d <b style={{ color: tone(s.market.ret_20d) }}>{pctTxt(s.market.ret_20d)}</b>
              {s.market.above_50dma === false && <span style={{ color: 'var(--warn)' }}> · below 50-DMA (weak tape)</span>}
            </span>
          )}
          <span style={{ color: 'var(--text-faint)' }}>{data.generated_at?.replace('T', ' ').slice(0, 16)} · sources: {(s.calendar_sources || []).join(', ')}</span>
          {s.notes?.map(n => <span key={n} style={{ color: 'var(--warn)' }}>⚠ {n}</span>)}
        </div>
      )}

      {data && (
        <div className="px-6 py-2 flex flex-wrap items-center gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input className="input" style={{ paddingLeft: 28, width: 180 }} placeholder="Company or symbol"
              value={f.search} onChange={e => setF({ ...f, search: e.target.value })} />
          </div>
          {Object.keys(STAGES).map(st => (
            <button key={st} title={STAGES[st].tip} className={`chip${f.stages.includes(st) ? ' active' : ''}`} onClick={() => toggleStage(st)}>
              {st}{s?.stages?.[st] != null ? ` (${s.stages[st]})` : ''}
            </button>
          ))}
          <button className="chip" onClick={() => setF(p => ({ ...p, stages: [] }))}>All</button>
          <label className="text-xs flex items-center gap-1.5 ml-2" style={{ color: 'var(--text-muted)' }}>Min ADV ₹cr
            <input className="input" type="number" min="0" style={{ width: 60 }} value={f.minAdv}
              onChange={e => setF({ ...f, minAdv: Math.max(0, +e.target.value || 0) })} />
          </label>
          <button className={`chip${f.enrichedOnly ? ' active' : ''}`} onClick={() => setF(p => ({ ...p, enrichedOnly: !p.enrichedOnly }))}
            title="Only names that got the history + filings checks">Deep-checked only</button>
          <span className="ml-auto text-xs" style={{ color: 'var(--text-faint)' }}>{rows.length} of {data.rows.length}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {!data ? (
          <div className="p-10 text-sm text-center" style={{ color: 'var(--text-faint)' }}>
            No scan yet. Click <b>Run scan</b>. Uploading a board-meeting CSV on the Earnings tab adds companies NSE has not listed yet.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                {COLUMNS.map(c => (
                  <th key={c.key} title={c.title} className={`${c.num ? 'num' : ''}${c.hide ? ' hidden lg:table-cell' : ''}`}
                    onClick={() => setSort(p => ({ key: c.key, dir: p.key === c.key && p.dir === 'desc' ? 'asc' : 'desc' }))}>
                    {c.label}{sort.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const key = `${r.isin}-${r.result_date}`;
                const isOpen = open === key;
                const rel5 = r.rel_sec_5d ?? r.rel_mkt_5d;
                const rel10 = r.rel_sec_10d ?? r.rel_mkt_10d;
                return (
                  <Fragment key={key}>
                    <tr role="button" tabIndex={0} onClick={() => setOpen(isOpen ? null : key)}
                      onKeyDown={e => e.key === 'Enter' && setOpen(isOpen ? null : key)}
                      style={{ opacity: r.score == null ? 0.55 : 1 }}>
                      <td>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                      <td className="num">{r.rank ?? DASH}</td>
                      <td>
                        <div className="font-medium text-sm" style={{ color: 'var(--text)' }}>{r.company || r.symbol}</div>
                        <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {r.symbol || `BSE ${r.bse_code ?? ''}`} · {r.sector_index || 'Nifty 500'}
                        </div>
                      </td>
                      <td className="num">
                        <div>{r.result_date?.slice(5)}</div>
                        <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{r.trading_days_left} sess.</div>
                      </td>
                      <td><StageBadge stage={r.stage} /></td>
                      <td className="num">
                        <div className="font-semibold">{r.score == null ? DASH : r.score.toFixed(0)}</div>
                        <Bar value={r.score == null ? null : r.score / 100} width={48} />
                      </td>
                      <td className="num" style={{ color: tone(rel5) }}>{pctTxt(rel5)}</td>
                      <td className="num hidden lg:table-cell" style={{ color: tone(rel10) }}>{pctTxt(rel10)}</td>
                      <td className="num hidden lg:table-cell" style={{ color: tone(r.accel) }}>{pctTxt(r.accel)}</td>
                      <td className="num">{r.rvol_5d == null ? DASH : `${r.rvol_5d.toFixed(1)}×`}</td>
                      <td className="num hidden lg:table-cell">{r.deliv_qty_ratio == null ? DASH : `${r.deliv_qty_ratio.toFixed(1)}×`}</td>
                      <td className="num hidden lg:table-cell" style={{ color: tone(r.hist_pre_excess_mean) }}>
                        {r.hist_events ? <>{pctTxt(r.hist_pre_excess_mean)} <span style={{ color: 'var(--text-faint)' }}>({r.hist_events})</span></> : DASH}
                      </td>
                      <td className="num hidden lg:table-cell">{r.fund_score == null ? DASH : r.fund_score.toFixed(0)}</td>
                      <td className="num hidden lg:table-cell" style={{ color: tone(r.catalyst_score) }}>
                        {r.catalyst_score == null ? DASH : r.catalyst_score.toFixed(2)}
                      </td>
                      <td className="num hidden lg:table-cell">{r.adv20_cr == null ? DASH : r.adv20_cr.toFixed(0)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={COLUMNS.length + 1} style={{ background: 'var(--bg-subtle)', cursor: 'default' }}>
                          <Detail r={r} onOpen={() => r.symbol && navigate(`/company/${r.symbol}`)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-6 py-1.5 text-xs border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}>
        Scores describe the current setup and each stock's own history. They are not forecasts or earnings-beat
        probabilities, and they are not investment advice.
      </div>
    </div>
  );
}

function Detail({ r, onOpen }) {
  return (
    <div className="p-4 grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Why it qualifies</div>
        {r.reasons?.length ? r.reasons.map(x => (
          <div key={x} className="flex gap-2 text-xs" style={{ color: 'var(--text)' }}>
            <CheckCircle2 size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--up)' }} />{x}
          </div>
        )) : <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Nothing stands out.</div>}
        {r.risks?.length > 0 && (
          <>
            <div className="text-xs font-bold uppercase tracking-wider pt-2" style={{ color: 'var(--text-muted)' }}>Risks</div>
            {r.risks.map(x => (
              <div key={x} className="flex gap-2 text-xs" style={{ color: 'var(--text)' }}>
                <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />{x}
              </div>
            ))}
          </>
        )}
        <div className="flex gap-2 pt-2">
          {r.symbol && <button className="btn btn-secondary" onClick={onOpen}>Open company</button>}
          {(r.symbol || r.bse_code) && (
            <a className="btn btn-ghost" target="_blank" rel="noopener noreferrer"
              href={`https://www.screener.in/company/${encodeURIComponent(r.symbol || r.bse_code)}/consolidated/`}>
              Screener <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Score components</div>
        {Object.entries(COMPONENT_LABELS).map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>{label}</span>
            <Bar value={r.components?.[k]} width={120} />
          </div>
        ))}
        {r.extension > 0 && (
          <div className="text-xs" style={{ color: 'var(--warn)' }}>Extension penalty: −{Math.round(r.extension * 45)}%</div>
        )}
        <div className="text-xs pt-2 grid grid-cols-2 gap-x-4 gap-y-1" style={{ color: 'var(--text-muted)' }}>
          <span>Last close</span><span className="num text-right">₹{inr(r.last_close)}</span>
          <span>5d / 20d return</span><span className="num text-right">{pctTxt(r.ret_5d)} / {pctTxt(r.ret_20d)}</span>
          <span>RSI 14</span><span className="num text-right">{r.rsi14 == null ? DASH : r.rsi14.toFixed(0)}</span>
          <span>% of 52w high</span><span className="num text-right">{r.pct_of_52w_high == null ? DASH : `${(r.pct_of_52w_high * 100).toFixed(0)}%`}</span>
          <span>Volatility (ann.)</span><span className="num text-right">{r.vol_ann == null ? DASH : `${(r.vol_ann * 100).toFixed(0)}%`}</span>
          <span>Delivery 5d / before</span>
          <span className="num text-right">{r.deliv_pct_5d == null ? DASH : `${r.deliv_pct_5d.toFixed(0)}% / ${r.deliv_pct_base?.toFixed(0) ?? DASH}%`}</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Around past results</div>
        {r.hist_events ? (
          <>
            <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1" style={{ color: 'var(--text-muted)' }}>
              <span>Pre-results drift (avg)</span><span className="num text-right" style={{ color: tone(r.hist_pre_excess_mean) }}>{pctTxt(r.hist_pre_excess_mean)}</span>
              <span>Positive before results</span><span className="num text-right">{Math.round(r.hist_pre_hit_rate * r.hist_events)}/{r.hist_events}</span>
              <span>Next-day gap (avg / size)</span><span className="num text-right">{pctTxt(r.hist_gap_mean)} / {(r.hist_gap_abs_mean * 100).toFixed(1)}%</span>
              <span>2-day reaction (avg)</span><span className="num text-right" style={{ color: tone(r.hist_reaction_mean) }}>{pctTxt(r.hist_reaction_mean)}</span>
            </div>
            <table className="w-full text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              <thead><tr><th className="text-left font-medium">Result</th><th className="text-right font-medium">10d before</th><th className="text-right font-medium">Gap</th><th className="text-right font-medium">2d</th></tr></thead>
              <tbody>
                {(r.hist_detail || []).map(e => (
                  <tr key={e.date}>
                    <td>{e.date}</td>
                    <td className="text-right num" style={{ color: tone(e.pre_excess ?? e.pre_ret) }}>{pctTxt(e.pre_excess ?? e.pre_ret)}</td>
                    <td className="text-right num" style={{ color: tone(e.gap) }}>{pctTxt(e.gap)}</td>
                    <td className="text-right num" style={{ color: tone(e.reaction_2d) }}>{pctTxt(e.reaction_2d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {r.enriched ? 'Fewer than 2 past results inside the price history.' : 'Not deep-checked (outside the top N). Raise "Deep-check top" to include it.'}
          </div>
        )}
        {r.catalyst_score != null && (
          <>
            <div className="text-xs font-bold uppercase tracking-wider pt-2 flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
              Filings (30d) <NetScore value={r.catalyst_score} />
            </div>
            {r.catalyst_top?.length ? r.catalyst_top.map(ev => (
              <div key={ev.time + ev.title} className="text-xs" style={{ color: 'var(--text)' }}>
                <span style={{ color: tone(ev.impact) }}>{ev.event_label}</span> · {(ev.text || ev.title || '').slice(0, 120)}
              </div>
            )) : <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Only routine filings.</div>}
          </>
        )}
      </div>
    </div>
  );
}

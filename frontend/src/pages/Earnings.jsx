import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Upload, Download, Search, ChevronUp, ChevronDown, ChevronsUpDown, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { inr } from '../lib/format.jsx';

const DASH = '–';
const num = (v, d = 1) => (v == null ? DASH : Number(v).toFixed(d));

// Earnings-based filters: [field, label, unit]. Rows missing a field are excluded once a bound is set.
const EARN_FILTERS = [
  ['YOY Quarterly profit growth', 'Profit growth YoY', '%'],
  ['YOY Quarterly sales growth',  'Sales growth YoY',  '%'],
  ['OPM',                         'Operating margin',  '%'],
  ['Return on capital employed',  'ROCE',              '%'],
  ['CFO by PAT',                  'CFO / PAT',         'x'],
  ['Price to Earning',            'P/E',               'x'],
  ['PEG Ratio',                   'PEG',               'x'],
  ['Debt to equity',              'Debt / equity',     'x'],
  ['Change in FII holding',       'FII holding change', 'pp'],
  ['Net Profit latest quarter',   'Net profit (₹cr)',  ''],
  ['Sales latest quarter',        'Sales (₹cr)',       ''],
  ['Market Capitalization',       'Market cap (₹cr)',  ''],
];
const PRESETS = {
  'Growth': { 'YOY Quarterly profit growth': { min: 25 }, 'YOY Quarterly sales growth': { min: 15 } },
  'Quality': { 'Return on capital employed': { min: 20 }, 'Debt to equity': { max: 0.5 }, 'CFO by PAT': { min: 0.7 } },
  'Value + growth': { 'Price to Earning': { max: 25 }, 'PEG Ratio': { max: 1.5 }, 'YOY Quarterly profit growth': { min: 20 } },
  'Margin expansion': { 'OPM': { min: 15 }, 'YOY Quarterly profit growth': { min: 30 } },
};

const COLUMNS = [
  { key: 'rank',               label: '#',            align: 'right' },
  { key: 'company',            label: 'Company' },
  { key: 'result_date',        label: 'Result',       },
  { key: 'trading_days_left',  label: 'Days',         align: 'right', title: 'Trading days until result' },
  { key: 'ltp',                label: 'Price (₹)',    align: 'right' },
  { key: 'Price to Earning',   label: 'P/E',          align: 'right' },
  { key: 'YOY Quarterly profit growth', label: 'Profit YoY %', align: 'right', hide: true },
  { key: 'YOY Quarterly sales growth',  label: 'Sales YoY %',  align: 'right', hide: true },
  { key: 'Return on capital employed',  label: 'ROCE %',       align: 'right', hide: true },
  { key: 'OPM',                label: 'OPM %',        align: 'right', hide: true },
  { key: 'Debt to equity',     label: 'D/E',          align: 'right', hide: true },
  { key: 'ret_60d',            label: '60d %',        align: 'right', hide: true },
  { key: 'pct_of_52w_high',    label: '% of 52w hi',  align: 'right', hide: true },
  { key: 'adv20_cr',           label: 'ADV ₹cr',      align: 'right', hide: true },
  { key: 'base_touch_10pct',   label: 'Hist. +10% freq', align: 'right', hide: true,
    title: "How often THIS stock touched +10% in a similar-length window since 2025. Descriptive history, not a forecast." },
  { key: 'fund_score',         label: 'Fund.',        align: 'right' },
  { key: 'tech_score',         label: 'Tech.',        align: 'right', hide: true },
  { key: 'composite',          label: 'Score',        align: 'right' },
];

function cell(r, k) {
  switch (k) {
    case 'rank': return r.rank ?? DASH;
    case 'result_date': return r.result_date;
    case 'ltp': return r.ltp == null ? DASH : inr(r.ltp);
    case 'ret_60d': return r.ret_60d == null ? DASH : (r.ret_60d * 100).toFixed(0);
    case 'pct_of_52w_high': return r.pct_of_52w_high == null ? DASH : (r.pct_of_52w_high * 100).toFixed(0);
    case 'base_touch_10pct': return r.base_touch_10pct == null ? DASH : `${(r.base_touch_10pct * 100).toFixed(0)}%`;
    case 'adv20_cr': return num(r.adv20_cr, 0);
    case 'trading_days_left': return r.trading_days_left;
    default: return num(r[k]);
  }
}

export default function Earnings() {
  const navigate = useNavigate();
  const boardRef = useRef(null);
  const fundRef = useRef(null);
  const [data, setData] = useState(null);       // {run_id, generated_at, summary, rows}
  const [runs, setRuns] = useState([]);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [f, setF] = useState({ search: '', maxDays: 60, minFund: 0, scoredOnly: true, hideFlagged: false });
  const [ef, setEf] = useState({});          // { field: {min, max} }
  const [showEf, setShowEf] = useState(false);
  const [sort, setSort] = useState({ key: 'composite', dir: 'desc' });

  const loadRuns = useCallback(async () => {
    try { setRuns(await (await fetch('/api/earnings/runs')).json()); } catch { /* backend offline */ }
  }, []);

  const loadRun = useCallback(async (run = 'latest') => {
    setError('');
    const res = await fetch(`/api/earnings/results?run=${run}`);
    if (res.status === 404) { setData(null); return; }
    if (!res.ok) { setError('Could not load results'); return; }
    setData(await res.json());
  }, []);

  useEffect(() => { loadRun(); loadRuns(); }, [loadRun, loadRuns]);

  // poll running job
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setInterval(async () => {
      try {
        const j = await (await fetch(`/api/earnings/status?id=${job.id ?? job.job_id}`)).json();
        setJob(prev => ({ ...prev, ...j }));
        if (j.status === 'done') { loadRun(j.run_id); loadRuns(); }
        if (j.status === 'error') setError(j.error);
      } catch { /* retry next tick */ }
    }, 1500);
    return () => clearInterval(t);
  }, [job, loadRun, loadRuns]);

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  async function onBoardFile(file) {
    if (!file) return;
    setError(''); setNotice('');
    try {
      const j = await post('/api/earnings/upload', { csv: await file.text(), filename: file.name });
      setJob({ id: j.job_id, status: 'running', stage: 'queued', done: 0, total: 0 });
    } catch (e) { setError(e.message); }
  }

  async function onFundFile(file) {
    if (!file) return;
    setError(''); setNotice('');
    try {
      const j = await post('/api/earnings/fundamentals', { csv: await file.text() });
      setNotice(`Fundamentals master updated: ${j.added_or_updated} rows added/updated, ${j.total} total. Re-upload the board-meeting CSV to re-screen.`);
    } catch (e) { setError(e.message); }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const q = f.search.trim().toLowerCase();
    let r = data.rows.filter(x =>
      (!q || (x.company || '').toLowerCase().includes(q) || (x.nse_symbol || '').toLowerCase().includes(q)) &&
      x.days_left <= f.maxDays &&
      (!f.scoredOnly || x.composite != null) &&
      (x.fund_score ?? 0) >= f.minFund &&
      (!f.hideFlagged || !x.flags) &&
      Object.entries(ef).every(([k, b]) => {
        const v = x[k];
        const lo = b.min === '' || b.min == null ? null : +b.min;
        const hi = b.max === '' || b.max == null ? null : +b.max;
        if (lo == null && hi == null) return true;
        if (v == null) return false;
        return (lo == null || v >= lo) && (hi == null || v <= hi);
      }));
    const { key, dir } = sort;
    const m = dir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * m;
    });
  }, [data, f, ef, sort]);

  const activeEf = Object.values(ef).filter(b => (b.min ?? '') !== '' || (b.max ?? '') !== '').length;
  const s = data?.summary;
  const pctDone = job?.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--border)' }}>
        <div className="mr-4">
          <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Earnings screen</div>
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            Upload a board-meeting CSV (Security Code, Company name, Meeting Date…). Fundamentals and prices are attached automatically.
          </div>
        </div>
        <input ref={boardRef} type="file" accept=".csv" hidden onChange={e => { onBoardFile(e.target.files[0]); e.target.value = ''; }} />
        <input ref={fundRef} type="file" accept=".csv" hidden onChange={e => { onFundFile(e.target.files[0]); e.target.value = ''; }} />
        <button className="btn btn-primary" disabled={job?.status === 'running'} onClick={() => boardRef.current.click()}>
          <Upload size={13} /> Upload board meetings
        </button>
        <button className="btn btn-secondary" onClick={() => fundRef.current.click()} title="Screener-style fundamentals CSV; merged by ISIN into the master file">
          <FileSpreadsheet size={13} /> Add fundamentals CSV
        </button>
        <div className="ml-auto flex items-center gap-2">
          {runs.length > 0 && (
            <select className="select" value={data?.run_id || ''} onChange={e => loadRun(e.target.value)}>
              {runs.map(r => <option key={r.run_id} value={r.run_id}>{r.generated_at.replace('T', ' ')} · {r.source_file}</option>)}
            </select>
          )}
          <a className={`btn btn-secondary${data ? '' : ' disabled'}`} href={`/api/earnings/results?run=${data?.run_id || 'latest'}&format=csv&download=1`}><Download size={13} /> CSV</a>
          <a className={`btn btn-secondary${data ? '' : ' disabled'}`} href={`/api/earnings/results?run=${data?.run_id || 'latest'}&format=json&download=1`}><Download size={13} /> JSON</a>
        </div>
      </div>

      {job?.status === 'running' && (
        <div className="px-6 py-2 text-xs border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          {job.stage}{job.total ? ` · ${job.done}/${job.total}` : ''}
          <div style={{ height: 3, background: 'var(--border)', marginTop: 6 }}>
            <div style={{ height: 3, width: `${pctDone}%`, background: 'var(--accent)', transition: 'width .3s' }} />
          </div>
        </div>
      )}
      {error && (
        <div className="px-6 py-2 text-xs flex items-center gap-2" style={{ color: 'var(--down)' }}><AlertCircle size={13} />{error}</div>
      )}
      {notice && <div className="px-6 py-2 text-xs" style={{ color: 'var(--up)' }}>{notice}</div>}

      {s && (
        <div className="px-6 py-2 text-xs border-b flex flex-wrap gap-x-5 gap-y-1" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <span>{s.meetings_upcoming} upcoming results</span>
          <span><b>{s.scored}</b> scored (have fundamentals + prices)</span>
          <span>{s.with_fundamentals} with fundamentals{s.yfinance_available ? '' : ' · yfinance not installed, so only the master CSV is used'}</span>
          <span>{s.with_prices} with prices</span>
          <span>{s.live_quotes ? 'live quotes ✓' : 'no Upstox token: using last close'}</span>
          {s.with_fundamentals < s.meetings_upcoming && (
            <span style={{ color: 'var(--warn)' }}>{s.meetings_upcoming - s.with_fundamentals} companies have no fundamentals: add a fundamentals CSV to include them</span>
          )}
        </div>
      )}

      {data && (
        <div className="px-6 py-2 flex flex-wrap items-center gap-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input className="input" style={{ paddingLeft: 28, width: 200 }} placeholder="Company or symbol"
              value={f.search} onChange={e => setF({ ...f, search: e.target.value })} />
          </div>
          <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>Result within
            <select className="select" value={f.maxDays} onChange={e => setF({ ...f, maxDays: +e.target.value })}>
              {[3, 7, 14, 21, 30, 60].map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
          <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>Min fund. score
            <input className="input" type="number" min="0" max="100" style={{ width: 64 }} value={f.minFund}
              onChange={e => setF({ ...f, minFund: +e.target.value || 0 })} />
          </label>
          <button className={`chip${f.scoredOnly ? ' active' : ''}`} onClick={() => setF({ ...f, scoredOnly: !f.scoredOnly })}>Scored only</button>
          <button className={`chip${f.hideFlagged ? ' active' : ''}`} onClick={() => setF({ ...f, hideFlagged: !f.hideFlagged })}>Hide flagged</button>
          <button className={`chip${showEf || activeEf ? ' active' : ''}`} onClick={() => setShowEf(v => !v)}>
            Earnings filters{activeEf ? ` (${activeEf})` : ''}
          </button>
          <span className="ml-auto text-xs" style={{ color: 'var(--text-faint)' }}>{rows.length} of {data.rows.length}</span>
        </div>
      )}
      {data && showEf && (
        <div className="px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-subtle)' }}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Presets</span>
            {Object.entries(PRESETS).map(([name, p]) => (
              <button key={name} className="chip" onClick={() => setEf(p)}>{name}</button>
            ))}
            <button className="chip" onClick={() => setEf({})}>Clear</button>
            <span className="text-xs ml-2" style={{ color: 'var(--text-faint)' }}>
              Last reported quarter (Q1 FY27). Companies missing a field are hidden once you set a bound on it.
            </span>
          </div>
          <div className="grid gap-x-6 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {EARN_FILTERS.map(([k, label, unit]) => (
              <div key={k} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span style={{ width: 120 }}>{label}{unit && <span style={{ color: 'var(--text-faint)' }}> ({unit})</span>}</span>
                {['min', 'max'].map(side => (
                  <input key={side} className="input" type="number" step="any" placeholder={side} style={{ width: 72 }}
                    value={ef[k]?.[side] ?? ''}
                    onChange={e => setEf(p => ({ ...p, [k]: { ...p[k], [side]: e.target.value } }))} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {!data ? (
          <div className="p-10 text-sm text-center" style={{ color: 'var(--text-faint)' }}>
            No results yet. Upload a board-meeting CSV to start.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {COLUMNS.map(c => (
                  <th key={c.key} title={c.title} className={`${c.align === 'right' ? 'num' : ''}${c.hide ? ' hidden md:table-cell' : ''}`}
                    onClick={() => setSort(p => ({ key: c.key, dir: p.key === c.key && p.dir === 'desc' ? 'asc' : 'desc' }))}>
                    <span className={`inline-flex items-center gap-1 ${c.align === 'right' ? 'justify-end w-full' : ''}`}>
                      {c.label}
                      {sort.key === c.key
                        ? (sort.dir === 'desc' ? <ChevronDown size={11} style={{ color: 'var(--accent)' }} /> : <ChevronUp size={11} style={{ color: 'var(--accent)' }} />)
                        : <ChevronsUpDown size={11} style={{ color: 'var(--text-faint)', opacity: .5 }} />}
                    </span>
                  </th>
                ))}
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.bse_code}-${r.result_date}`} role="button" tabIndex={0}
                  style={{ opacity: r.composite == null ? 0.6 : 1 }}
                  onClick={() => r.nse_symbol && navigate(`/company/${r.nse_symbol}`)}>
                  {COLUMNS.map(c => (
                    <td key={c.key} className={`${c.align === 'right' ? 'num' : ''}${c.hide ? ' hidden md:table-cell' : ''}`}>
                      {c.key === 'company' ? (
                        <>
                          <div className="font-medium text-sm" style={{ color: 'var(--text)' }}>{r.company}</div>
                          <div className="text-xs flex items-center gap-2" style={{ color: 'var(--text-faint)' }}>
                            {r.nse_symbol || `BSE ${r.bse_code}`}
                            <a href={`https://www.screener.in/company/${encodeURIComponent(r.nse_symbol || r.bse_code)}/consolidated/`}
                               target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()}
                               className="inline-flex items-center gap-0.5 hover:underline" style={{ color: 'var(--accent)' }}>
                              Screener <ExternalLink size={10} />
                            </a>
                          </div>
                        </>
                      ) : cell(r, c.key)}
                    </td>
                  ))}
                  <td className="text-xs" style={{ color: 'var(--warn)', maxWidth: 260 }}>{r.flags}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-6 py-1.5 text-xs border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}>
        Score ranks fundamentals and setup quality only. It is not an earnings-beat probability and not investment advice.
        Fundamentals reflect the last reported quarter, so YoY growth is not an earnings surprise.
      </div>
    </div>
  );
}

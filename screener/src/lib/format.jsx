/**
 * format.js — Number & text formatting utilities.
 * All functions return '–' (en dash) for null/undefined — never '0' or '-'.
 */

const EN_DASH = '–';

/** Indian-locale number */
export const inr = (n, d = 2) =>
  n == null || isNaN(n) ? EN_DASH
  : new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(n);

/** Market-cap in crore / lakh-crore */
export const crore = (n) => {
  if (n == null || isNaN(n)) return EN_DASH;
  if (n >= 1e5) return `₹${inr(n / 1e5, 2)} L Cr`;
  return `₹${inr(n, 0)} Cr`;
};

/** Percentage with explicit sign */
export const pct = (n, d = 2) => {
  if (n == null || isNaN(n)) return EN_DASH;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(d)}%`;
};

/** Delta component: arrow + signed % */
export function Delta({ value, digits = 2 }) {
  if (value == null || isNaN(value)) return <span className="text-faint">{EN_DASH}</span>;
  const up = value >= 0;
  return (
    <span className={up ? 'delta-up' : 'delta-down'}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(digits)}%
    </span>
  );
}

/** Compact volume: 1.2M, 45.3K etc. */
export const compactVol = (n) =>
  n == null || isNaN(n) ? EN_DASH
  : new Intl.NumberFormat('en-IN', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);

/** Volume ratio: 1.8× */
export const volRatio = (vol, avg) => {
  if (vol == null || avg == null || avg === 0) return EN_DASH;
  return `${(vol / avg).toFixed(1)}×`;
};

/** Price: ₹1,284.50 */
export const price = (n) =>
  n == null || isNaN(n) ? EN_DASH : `₹${inr(n, 2)}`;

/** Signal label (sentence-case) */
export const signalLabel = (sig) => {
  if (!sig) return EN_DASH;
  return sig.charAt(0).toUpperCase() + sig.slice(1).toLowerCase().replace(/_/g, ' ');
};

/** Signal badge CSS class */
export const signalClass = (sig) => {
  if (!sig) return 'neutral';
  const s = sig.toUpperCase().replace(/\s/g, '_');
  if (s === 'STRONG_BUY')  return 'strong-buy';
  if (s === 'BUY')          return 'buy';
  if (s === 'STRONG_SELL')  return 'strong-sell';
  if (s === 'SELL')         return 'sell';
  return 'neutral';
};

/** RSI — coloured if stretched */
export function RsiCell({ value }) {
  if (value == null || isNaN(value)) return <span className="text-faint">{EN_DASH}</span>;
  const v = value.toFixed(1);
  if (value < 30) return <span className="delta-down font-semibold">{v}</span>;
  if (value > 70) return <span className="delta-up font-semibold">{v}</span>;
  return <span className="text-muted">{v}</span>;
}

/** 52-week range bar */
export function RangeBar({ low, high, current }) {
  if (low == null || high == null || current == null || high === low) {
    return <span className="text-faint">{EN_DASH}</span>;
  }
  const pctPos = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  return (
    <div className="range-bar" title={`Low ₹${inr(low)} · Current ₹${inr(current)} · High ₹${inr(high)}`}>
      <div className="range-bar__fill" style={{ width: `${pctPos}%` }} />
      <div className="range-bar__dot"  style={{ left: `${pctPos}%` }} />
    </div>
  );
}

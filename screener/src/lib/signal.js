/**
 * signal.js — Composite signal engine.
 *
 * Each component returns a score in [-1, +1].
 * Weights must sum to 1.0.
 * If a component's input is unavailable (null/undefined), it is dropped
 * and the remaining weights are renormalised so they still sum to 1.
 *
 * composite ∈ [-100, +100]
 * Thresholds:  ≥ +40 → Strong buy, ≥ +15 → Buy, ≤ -15 → Sell, ≤ -40 → Strong sell
 */
import {
  ema as calcEma,
  rsi as calcRsi,
  macd as calcMacd,
  bollingerBands,
  supertrend,
  adx as calcAdx,
  closes,
  volumes,
} from './indicators.js';

// ── Configurable weights (must sum to 1.0) ──────────────────────────────────
export const SIGNAL_WEIGHTS = {
  trend:     0.30,   // EMA21 vs EMA50
  momentum:  0.20,   // MACD
  supertrend: 0.15,  // Supertrend direction
  volume:    0.10,   // Volume confirmation of trend
  sentiment: 0.15,   // NLP news sentiment
  fundamental: 0.10, // Fundamental quality score (0–100, normalised vs 50)
};

// ── Thresholds ───────────────────────────────────────────────────────────────
export const THRESHOLDS = {
  STRONG_BUY:  40,
  BUY:         15,
  SELL:       -15,
  STRONG_SELL: -40,
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * computeSignal(candles, { nlpScore, fundamentalScore })
 *
 * @param {Array}  candles         - OHLCV array, at least 50 bars
 * @param {object} extras          - optional external scores
 * @param {number|null} extras.nlpScore          - [-1, +1], null if unavailable
 * @param {number|null} extras.fundamentalScore  - [0, 100], null if unavailable
 * @returns {object} { score, signal, breakdown, indicators, basedOn }
 */
export function computeSignal(candles, { nlpScore = null, fundamentalScore = null } = {}) {
  if (!candles || candles.length < 50) {
    return {
      score: null, signal: 'NEUTRAL',
      breakdown: {}, indicators: {}, basedOn: [],
      warning: 'Insufficient price history (need ≥ 50 bars)',
    };
  }

  const c   = closes(candles);
  const n   = c.length;

  // ── Compute raw indicators ──────────────────────────────────────────────────
  const ema21    = calcEma(c, 21)[n - 1];
  const ema50    = calcEma(c, 50)[n - 1];
  const rsiVal   = calcRsi(c, 14)[n - 1];
  const { macdLine, signal: macdSig } = calcMacd(c);
  const macdDiff = (macdLine[n - 1] ?? null) !== null && (macdSig[n - 1] ?? null) !== null
    ? macdLine[n - 1] - macdSig[n - 1] : null;
  const stTrend  = supertrend(candles, 10, 3)[n - 1]; // +1 or -1 or null
  const adxVal   = calcAdx(candles, 14)[n - 1];
  const price    = c[n - 1];
  const vol      = candles[n - 1].volume;
  const avgVol   = volumes(candles.slice(-20)).reduce((a, b) => a + b, 0) / 20;
  const { upper: bbUp, lower: bbLow, middle: bbMid } = bollingerBands(c);

  // ── Component scores [-1, +1] with reason strings ──────────────────────────
  const components = {};

  // 1. Trend: EMA crossover with magnitude
  if (ema21 != null && ema50 != null) {
    const raw = (ema21 - ema50) / ema50;                 // % gap
    const score = clamp(raw * 25, -1, 1);                // 4% gap → ±1
    const dir = raw > 0 ? 'above' : 'below';
    const pct = Math.abs(raw * 100).toFixed(2);
    components.trend = {
      score,
      reason: `EMA21 (${ema21.toFixed(0)}) is ${dir} EMA50 (${ema50.toFixed(0)}) by ${pct}%`,
    };
  }

  // 2. Momentum: MACD crossover (normalised by price)
  if (macdDiff != null && price > 0) {
    const norm = clamp(macdDiff / (price * 0.004), -1, 1);
    const dir = norm > 0 ? 'bullish' : 'bearish';
    components.momentum = {
      score: norm,
      reason: `MACD histogram is ${dir} (${macdDiff.toFixed(2)})`,
    };
  }

  // 3. Supertrend direction (+1 bullish, -1 bearish)
  if (stTrend != null) {
    components.supertrend = {
      score: stTrend,
      reason: stTrend > 0 ? 'Supertrend is bullish (price above band)' : 'Supertrend is bearish (price below band)',
    };
  }

  // 4. Volume confirmation: volume vs 20-day average, directionally adjusted
  if (avgVol > 0 && stTrend != null) {
    const vRatio = vol / avgVol;                         // 1.0 = average
    const vSig = clamp((vRatio - 1) * 2, -1, 1);        // 1.5× avg → +1
    // Confirm direction only when trend is clear; flat trend = no signal
    const score = stTrend !== 0 ? Math.sign(stTrend) * Math.abs(vSig) : 0;
    components.volume = {
      score,
      reason: `Volume is ${(vRatio).toFixed(1)}× the 20-day average (${stTrend > 0 ? 'confirms' : 'contrarian to'} trend)`,
    };
  }

  // 5. NLP sentiment: passed in directly as [-1, +1]
  if (nlpScore != null) {
    const norm = clamp(nlpScore, -1, 1);
    components.sentiment = {
      score: norm,
      reason: `News sentiment score: ${norm.toFixed(2)} (7-day average)`,
    };
  }

  // 6. Fundamental quality: [0, 100] → [-1, +1] centred at 50
  if (fundamentalScore != null) {
    const norm = clamp((fundamentalScore - 50) / 50, -1, 1);
    components.fundamental = {
      score: norm,
      reason: `Fundamental quality score: ${fundamentalScore.toFixed(0)}/100`,
    };
  }

  // ── Renormalise weights for available components ────────────────────────────
  const basedOn = Object.keys(components);
  const totalWeight = basedOn.reduce((sum, k) => sum + (SIGNAL_WEIGHTS[k] ?? 0), 0);

  if (totalWeight === 0) {
    return { score: null, signal: 'NEUTRAL', breakdown: {}, indicators: {}, basedOn, warning: 'No components available' };
  }

  let composite = 0;
  const breakdown = {};
  for (const k of basedOn) {
    const w = (SIGNAL_WEIGHTS[k] ?? 0) / totalWeight;   // renormalised weight
    const contribution = w * components[k].score * 100;
    composite += contribution;
    breakdown[k] = {
      score: Math.round(components[k].score * 100),
      contribution: Math.round(contribution),
      reason: components[k].reason,
      weight: Math.round(w * 100),
    };
  }

  composite = Math.round(composite);

  const signal =
    composite >= THRESHOLDS.STRONG_BUY  ? 'STRONG BUY'  :
    composite >= THRESHOLDS.BUY         ? 'BUY'          :
    composite <= THRESHOLDS.STRONG_SELL ? 'STRONG SELL'  :
    composite <= THRESHOLDS.SELL        ? 'SELL'         :
    'NEUTRAL';

  const missingComponents = Object.keys(SIGNAL_WEIGHTS).filter(k => !basedOn.includes(k));
  const warning = missingComponents.length > 0
    ? `Based on technicals only (missing: ${missingComponents.join(', ')})`
    : null;

  return {
    score: composite,
    signal,
    breakdown,
    indicators: {
      rsiVal,
      ema21,
      ema50,
      adxVal,
      bbUp:    bbUp[n - 1],
      bbLow:   bbLow[n - 1],
      bbMid:   bbMid[n - 1],
      stTrend,
      macdLine: macdLine[n - 1],
      macdSig:  macdSig[n - 1],
    },
    basedOn,
    warning,
  };
}

/**
 * Align two candle arrays by date (for compare charts).
 * Returns [alignedA, alignedB] where both arrays have the same dates,
 * with null for dates missing in either series.
 */
export function alignByDate(a, b) {
  const mapA = new Map(a.map(c => [c.date, c]));
  const mapB = new Map(b.map(c => [c.date, c]));
  const dates = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();
  return [
    dates.map(d => mapA.get(d) ?? null),
    dates.map(d => mapB.get(d) ?? null),
  ];
}

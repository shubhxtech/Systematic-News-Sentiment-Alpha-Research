/**
 * indicators.js — Pure JS technical analysis library
 */

// ── Helpers ────────────────────────────────────────────────────────────────
export const closes  = (candles) => candles.map(c => c.close);
export const highs   = (candles) => candles.map(c => c.high);
export const lows    = (candles) => candles.map(c => c.low);
export const volumes = (candles) => candles.map(c => c.volume);

// ── SMA ────────────────────────────────────────────────────────────────────
export function sma(data, period) {
  const result = new Array(data.length).fill(null);
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] == null) continue;
    sum += data[i];
    count++;
    if (count === period) {
      result[i] = sum / period;
    } else if (count > period) {
      let prev = data[i - period];
      while (prev == null && i - period >= 0) {
        // Technically SMA skips nulls, but if data is contiguous:
        prev = data[i - period];
      }
      sum -= (data[i - period] || 0); // simplistic assumption of contiguous data
      result[i] = sum / period;
    }
  }
  return result;
}

// ── EMA ────────────────────────────────────────────────────────────────────
export function ema(data, period) {
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] == null) continue;
    if (count < period) { sum += data[i]; count++; if (count === period) result[i] = sum / period; }
    else result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ── RSI ────────────────────────────────────────────────────────────────────
export function rsi(data, period = 14) {
  const result = new Array(data.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period && i < data.length; i++) {
    const d = data[i] - data[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  if (avgLoss === 0) result[period] = 100;
  else result[period] = 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ── MACD ───────────────────────────────────────────────────────────────────
export function macd(data, fast = 12, slow = 26, signal = 9) {
  const fastEMA = ema(data, fast);
  const slowEMA = ema(data, slow);
  const macdLine = data.map((_, i) =>
    fastEMA[i] != null && slowEMA[i] != null ? fastEMA[i] - slowEMA[i] : null);
  const sigLine  = ema(macdLine.filter(v => v != null), signal);
  const sigFull  = new Array(data.length).fill(null);
  let si = 0;
  for (let i = 0; i < data.length; i++) if (macdLine[i] != null) sigFull[i] = sigLine[si++] ?? null;
  const histogram = macdLine.map((v, i) => v != null && sigFull[i] != null ? v - sigFull[i] : null);
  return { macdLine, signal: sigFull, histogram };
}

// ── Bollinger Bands ────────────────────────────────────────────────────────
export function bollingerBands(data, period = 20, stdMult = 2) {
  const upper = [], lower = [], middle = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); middle.push(null); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    const mean  = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    middle.push(mean);
    upper.push(mean + stdMult * std);
    lower.push(mean - stdMult * std);
  }
  return { upper, lower, middle };
}

// ── VWAP ───────────────────────────────────────────────────────────────────
export function vwap(candles) {
  const result = new Array(candles.length).fill(null);
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c.volume) {
      result[i] = i > 0 ? result[i-1] : null;
      continue;
    }
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
    
    result[i] = cumulativeVolume ? cumulativeTPV / cumulativeVolume : null;
  }
  return result;
}

// ── ATR ────────────────────────────────────────────────────────────────────
export function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  const k = 2 / (period + 1);
  const result = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
  result[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++)
    result[i] = tr[i] * k + result[i - 1] * (1 - k);
  return result;
}

// ── ADX ────────────────────────────────────────────────────────────────────
export function adx(candles, period = 14) {
  const result = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return result;
  const dmPlus = [], dmMinus = [], trArr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const upMove = c.high - p.high, downMove = p.low - c.low;
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trArr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let smTR = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smPlus = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let smMinus = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);
  const diPlus = [], diMinus = [], dx = [];
  const push = () => {
    const dp = smTR ? (smPlus / smTR) * 100 : 0;
    const dm = smTR ? (smMinus / smTR) * 100 : 0;
    diPlus.push(dp); diMinus.push(dm);
    const s = dp + dm; dx.push(s ? Math.abs(dp - dm) / s * 100 : 0);
  };
  push();
  for (let i = period; i < trArr.length; i++) {
    smTR    = smTR    - smTR / period    + trArr[i];
    smPlus  = smPlus  - smPlus / period  + dmPlus[i];
    smMinus = smMinus - smMinus / period + dmMinus[i];
    push();
  }
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[2 * period] = adxVal;
  for (let i = period + 1; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
    result[period + i] = adxVal;
  }
  return result;
}

// ── Supertrend ─────────────────────────────────────────────────────────────
export function supertrend(candles, period = 10, multiplier = 3) {
  const atrArr = atr(candles, period);
  const result = new Array(candles.length).fill(null);
  let trend = 1, upper = null, lower = null;
  for (let i = period; i < candles.length; i++) {
    const c = candles[i];
    const mid = (c.high + c.low) / 2;
    const a = atrArr[i] ?? 0;
    const basicUpper = mid + multiplier * a;
    const basicLower = mid - multiplier * a;
    upper = (upper == null || basicUpper < upper || candles[i - 1].close > upper) ? basicUpper : upper;
    lower = (lower == null || basicLower > lower || candles[i - 1].close < lower) ? basicLower : lower;
    if (c.close > upper) trend = 1;
    if (c.close < lower) trend = -1;
    result[i] = trend;
  }
  return result;
}

// ── OBV ────────────────────────────────────────────────────────────────────
export function obv(candles) {
  const result = [0];
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    result.push(result[i - 1] + (d > 0 ? candles[i].volume : d < 0 ? -candles[i].volume : 0));
  }
  return result;
}

// ── Stochastic ────────────────────────────────────────────────────────────
export function stochastic(candles, kPeriod = 14, dPeriod = 3) {
  const kLine = candles.map((c, i) => {
    if (i < kPeriod - 1) return null;
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const lo = Math.min(...slice.map(x => x.low));
    const hi = Math.max(...slice.map(x => x.high));
    return hi === lo ? 50 : ((c.close - lo) / (hi - lo)) * 100;
  });
  const dLine = ema(kLine.filter(v => v != null), dPeriod);
  const dFull = new Array(candles.length).fill(null);
  let di = 0;
  for (let i = 0; i < candles.length; i++) if (kLine[i] != null) dFull[i] = dLine[di++] ?? null;
  return { k: kLine, d: dFull };
}

// ── Composite Signal Score (deprecated shim) ──────────────────────────────
// Use src/lib/signal.js → computeSignal() for new code.
// This shim exists only to avoid breaking components not yet migrated.
import { computeSignal } from './signal.js';
export function computeSignalScore(candles, nlpScore = null, fundamentalScore = null) {
  const fundamentalInput = fundamentalScore != null && fundamentalScore !== 50
    ? fundamentalScore : null;   // treat the old hard-coded 50 as "unknown"
  return computeSignal(candles, { nlpScore, fundamentalScore: fundamentalInput });
}


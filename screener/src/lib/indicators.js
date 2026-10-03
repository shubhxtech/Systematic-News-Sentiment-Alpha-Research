/**
 * indicators.js — Pure JS technical analysis library
 */

// ── Helpers ────────────────────────────────────────────────────────────────
export const closes  = (candles) => candles.map(c => c.close);
export const highs   = (candles) => candles.map(c => c.high);
export const lows    = (candles) => candles.map(c => c.low);
export const volumes = (candles) => candles.map(c => c.volume);

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

// ── Composite Signal Score ─────────────────────────────────────────────────
export function computeSignalScore(candles, nlpScore = 0, fundamentalScore = 50) {
  if (!candles || candles.length < 50) return { score: 0, signal: 'NEUTRAL', breakdown: {} };
  const c  = closes(candles);
  const n  = c.length;

  const rsiVal     = rsi(c, 14)[n - 1] ?? 50;
  const ema21      = ema(c, 21)[n - 1];
  const ema50      = ema(c, 50)[n - 1];
  const { macdLine, signal: macdSig } = macd(c);
  const macdCross  = (macdLine[n - 1] ?? 0) - (macdSig[n - 1] ?? 0);
  const { upper: bbUp, lower: bbLow } = bollingerBands(c);
  const stTrend    = supertrend(candles, 10, 3)[n - 1] ?? 0;
  const adxVal     = adx(candles, 14)[n - 1] ?? 0;
  const price      = c[n - 1];
  const vol        = candles[n - 1].volume;
  const avgVol     = volumes(candles.slice(-20)).reduce((a, b) => a + b, 0) / 20;

  // Individual signals (-1 to +1)
  const rsiSig     = rsiVal > 70 ? -1 : rsiVal < 30 ? 1 : (50 - rsiVal) / 50 * -1;
  const trendSig   = ema21 && ema50 ? (ema21 > ema50 ? 1 : -1) * Math.min(Math.abs(ema21 - ema50) / ema50 * 20, 1) : 0;
  const macdSigVal = Math.sign(macdCross) * Math.min(Math.abs(macdCross) / (price * 0.005), 1);
  const bbSig      = bbUp[n-1] && bbLow[n-1] ?
    price > bbUp[n-1] ? -1 : price < bbLow[n-1] ? 1 : 0 : 0;
  const stSig      = stTrend;
  const volSig     = avgVol > 0 ? Math.sign(stTrend) * Math.min(vol / avgVol - 1, 1) : 0;

  // Weighted composite: Technical 45%, NLP 30%, Fundamental 25%
  const techScore  = (rsiSig * 0.15 + trendSig * 0.15 + macdSigVal * 0.1 + bbSig * 0.05 + stSig * 0.1 + volSig * 0.05) * 100;
  const nlpNorm    = Math.max(-1, Math.min(1, nlpScore));
  const fundNorm   = (fundamentalScore - 50) / 50;
  const composite  = techScore * 0.45 + nlpNorm * 30 + fundNorm * 25;

  const signal = composite >= 30 ? 'STRONG BUY'
    : composite >= 12 ? 'BUY'
    : composite <= -30 ? 'STRONG SELL'
    : composite <= -12 ? 'SELL'
    : 'NEUTRAL';

  return {
    score: Math.round(composite),
    signal,
    breakdown: {
      rsi: Math.round(rsiSig * 100),
      trend: Math.round(trendSig * 100),
      macd: Math.round(macdSigVal * 100),
      bollinger: Math.round(bbSig * 100),
      supertrend: Math.round(stSig * 100),
      volume: Math.round(volSig * 100),
    },
    indicators: { rsiVal, ema21, ema50, adxVal, bbUp: bbUp[n-1], bbLow: bbLow[n-1], stTrend },
  };
}

// ── Backtester ─────────────────────────────────────────────────────────────
export function runBacktest(candles, config = {}) {
  const {
    strategy = 'full_alpha',
    stopLoss = 5, takeProfit = 15, costs = 20,
    startDate, endDate,
  } = config;

  let data = candles;
  if (startDate) data = data.filter(c => c.date >= startDate);
  if (endDate)   data = data.filter(c => c.date <= endDate);
  if (data.length < 60) return null;

  const capital0 = 100000;
  let capital = capital0, position = null;
  const trades = [], equity = [];
  const costBps = costs / 10000;

  for (let i = 50; i < data.length; i++) {
    const slice = data.slice(0, i + 1);
    const c = slice.map(x => x.close);
    const { score, signal } = computeSignalScore(slice, 0, 50);

    if (!position && (signal === 'BUY' || signal === 'STRONG BUY')) {
      const entryPrice = data[i].close * (1 + costBps);
      position = { entryIdx: i, entryDate: data[i].date, entryPrice, size: capital / entryPrice };
    } else if (position) {
      const price = data[i].close;
      const pct   = (price - position.entryPrice) / position.entryPrice * 100;
      const exit  = pct <= -stopLoss || pct >= takeProfit
        || signal === 'SELL' || signal === 'STRONG SELL';
      if (exit) {
        const exitPrice = price * (1 - costBps);
        const ret = (exitPrice - position.entryPrice) / position.entryPrice;
        capital += position.size * (exitPrice - position.entryPrice);
        trades.push({
          entryDate: position.entryDate, exitDate: data[i].date,
          entryPrice: position.entryPrice, exitPrice,
          returnPct: ret * 100,
          reason: pct <= -stopLoss ? 'Stop-Loss' : pct >= takeProfit ? 'Take-Profit' : 'Signal',
        });
        position = null;
      }
    }
    equity.push({ date: data[i].date, value: capital + (position ? position.size * data[i].close - position.size * position.entryPrice : 0) });
  }

  // Metrics
  const totalReturn = (capital / capital0 - 1) * 100;
  const years = (data[data.length - 1].date > data[0].date)
    ? (new Date(data[data.length - 1].date) - new Date(data[0].date)) / (365.25 * 86400000) : 1;
  const cagr = ((capital / capital0) ** (1 / years) - 1) * 100;
  const rets  = equity.map((e, i) => i === 0 ? 0 : (e.value - equity[i - 1].value) / equity[i - 1].value);
  const mean  = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std   = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  let peak = capital0, maxDD = 0;
  for (const e of equity) { if (e.value > peak) peak = e.value; maxDD = Math.max(maxDD, (peak - e.value) / peak * 100); }
  const wins = trades.filter(t => t.returnPct > 0);
  const losses = trades.filter(t => t.returnPct <= 0);
  const avgWin = wins.length  ? wins.reduce((a, t) => a + t.returnPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.returnPct, 0) / losses.length) : 0;

  return {
    totalReturn: totalReturn.toFixed(2),
    cagr: cagr.toFixed(2),
    sharpe: sharpe.toFixed(2),
    maxDrawdown: maxDD.toFixed(2),
    winRate: trades.length ? ((wins.length / trades.length) * 100).toFixed(1) : '0.0',
    profitFactor: avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '∞',
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    tradeCount: trades.length,
    trades, equity,
  };
}

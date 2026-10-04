/**
 * signal.test.js — Unit tests for the signal engine
 */
import { describe, it, expect } from 'vitest';
import { computeSignal, THRESHOLDS } from './signal.js';
import { ema, rsi, macd, bollingerBands, atr, adx, supertrend } from './indicators.js';

// ── Helpers ─────────────────────────────────────────────────────────────────
function syntheticCandles({ n = 200, trend = 'up', startPrice = 1000 } = {}) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const dir = trend === 'up' ? 1 : trend === 'down' ? -1 : 0;
    const drift = dir * 0.008 + (Math.random() - 0.5) * 0.004;
    price *= (1 + drift);
    const open  = price * (1 + (Math.random() - 0.5) * 0.003);
    const close = price;
    const high  = Math.max(open, close) * (1 + Math.random() * 0.005);
    const low   = Math.min(open, close) * (1 - Math.random() * 0.005);
    const vol   = 1_000_000 + Math.random() * 500_000;
    const d = new Date(2023, 0, i + 1);
    candles.push({ date: d.toISOString().split('T')[0], open, high, low, close, volume: vol });
  }
  return candles;
}

// ── Indicator math tests ─────────────────────────────────────────────────────
describe('EMA', () => {
  it('returns null for warm-up period', () => {
    const data = Array.from({ length: 30 }, (_, i) => i + 1);
    const result = ema(data, 21);
    expect(result[0]).toBeNull();
    expect(result[20]).not.toBeNull(); // index 20 is the 21st value
  });

  it('correctly computes EMA for known data', () => {
    // EMA(5) of [1,2,3,4,5] = 3, then next(6): 6*(2/6) + 3*(4/6) = 4
    const data = [1, 2, 3, 4, 5, 6];
    const result = ema(data, 5);
    expect(result[4]).toBeCloseTo(3.0, 4);
    expect(result[5]).toBeCloseTo(4.0, 4); // 6*(2/6) + 3*(4/6)
  });

  it('returns array of same length as input', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(ema(data, 21).length).toBe(100);
  });
});

describe('RSI', () => {
  it('returns null for warm-up period', () => {
    const data = Array.from({ length: 30 }, (_, i) => 100 + i);
    const result = rsi(data, 14);
    expect(result[0]).toBeNull();
    expect(result[13]).toBeNull();
    expect(result[14]).not.toBeNull();
  });

  it('returns 100 when all moves are up', () => {
    const data = Array.from({ length: 30 }, (_, i) => 100 + i); // always rising
    const result = rsi(data, 14);
    expect(result[result.length - 1]).toBeCloseTo(100, 0);
  });

  it('returns near 0 when all moves are down', () => {
    const data = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5); // always falling
    const result = rsi(data, 14);
    expect(result[result.length - 1]).toBeLessThan(10);
  });

  it('returns value between 0 and 100 for mixed data', () => {
    const candles = syntheticCandles({ n: 100 });
    const data = candles.map(c => c.close);
    const result = rsi(data, 14);
    const last = result[result.length - 1];
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThanOrEqual(100);
  });
});

describe('MACD', () => {
  it('returns arrays of correct length', () => {
    const data = Array.from({ length: 100 }, (_, i) => 1000 + i);
    const { macdLine, signal, histogram } = macd(data);
    expect(macdLine.length).toBe(100);
    expect(signal.length).toBe(100);
    expect(histogram.length).toBe(100);
  });

  it('histogram = macdLine - signal (where both are not null)', () => {
    const data = Array.from({ length: 100 }, (_, i) => 1000 + Math.sin(i / 10) * 50);
    const { macdLine, signal: sig, histogram } = macd(data);
    for (let i = 0; i < data.length; i++) {
      if (macdLine[i] != null && sig[i] != null) {
        expect(histogram[i]).toBeCloseTo(macdLine[i] - sig[i], 6);
      }
    }
  });
});

describe('Bollinger Bands', () => {
  it('upper > middle > lower for valid bars', () => {
    const data = Array.from({ length: 100 }, (_, i) => 1000 + Math.sin(i / 5) * 20);
    const { upper, lower, middle } = bollingerBands(data, 20);
    for (let i = 20; i < data.length; i++) {
      expect(upper[i]).toBeGreaterThanOrEqual(middle[i]);
      expect(middle[i]).toBeGreaterThanOrEqual(lower[i]);
    }
  });
});

describe('ATR', () => {
  it('returns positive values after warm-up', () => {
    const candles = syntheticCandles({ n: 100 });
    const result = atr(candles, 14);
    for (let i = 14; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(0);
    }
  });
});

describe('ADX', () => {
  it('returns values in [0, 100] range after warm-up', () => {
    const candles = syntheticCandles({ n: 100 });
    const result = adx(candles, 14);
    for (let i = 0; i < result.length; i++) {
      if (result[i] != null) {
        expect(result[i]).toBeGreaterThanOrEqual(0);
        expect(result[i]).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('Supertrend', () => {
  it('returns only +1 or -1 (or null) values', () => {
    const candles = syntheticCandles({ n: 100 });
    const result = supertrend(candles, 10, 3);
    for (const v of result) {
      if (v != null) expect([1, -1]).toContain(v);
    }
  });
});

// ── Signal engine tests ──────────────────────────────────────────────────────
describe('computeSignal', () => {
  it('returns null score for < 50 bars', () => {
    const candles = syntheticCandles({ n: 30 });
    const { score, warning } = computeSignal(candles);
    expect(score).toBeNull();
    expect(warning).toBeTruthy();
  });

  it('returns a numeric score in [-100, 100]', () => {
    const candles = syntheticCandles({ n: 200 });
    const { score } = computeSignal(candles);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(-100);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns no NaN or undefined in breakdown', () => {
    const candles = syntheticCandles({ n: 200 });
    const { breakdown } = computeSignal(candles);
    for (const [, v] of Object.entries(breakdown)) {
      expect(v.score).not.toBeNaN();
      expect(v.contribution).not.toBeNaN();
      expect(v.score).toBeDefined();
    }
  });

  it('returns no NaN in indicators', () => {
    const candles = syntheticCandles({ n: 200 });
    const { indicators } = computeSignal(candles);
    for (const [k, v] of Object.entries(indicators)) {
      if (v != null) expect(isNaN(v), `${k} is NaN`).toBe(false);
    }
  });

  it('renormalises weights when NLP is missing', () => {
    const candles = syntheticCandles({ n: 200 });
    // Without NLP or fundamentals — breakdown should NOT include 'sentiment'
    const { breakdown, basedOn } = computeSignal(candles, { nlpScore: null, fundamentalScore: null });
    expect(basedOn).not.toContain('sentiment');
    expect(basedOn).not.toContain('fundamental');
    // Weights should still cover ~100% (breakdown contributions sum near score)
    const total = Object.values(breakdown).reduce((s, v) => s + v.contribution, 0);
    const { score } = computeSignal(candles, { nlpScore: null, fundamentalScore: null });
    expect(Math.abs(total - score)).toBeLessThan(2); // rounding tolerance
  });

  it('Strong buy is reachable with all bullish inputs', () => {
    // A long strongly uptrending series should yield >= STRONG_BUY threshold
    const bullish = syntheticCandles({ n: 300, trend: 'up', startPrice: 100 });
    const { score } = computeSignal(bullish, { nlpScore: 1, fundamentalScore: 100 });
    expect(score).toBeGreaterThanOrEqual(THRESHOLDS.STRONG_BUY);
  });

  it('Strong sell is reachable with all bearish inputs', () => {
    const bearish = syntheticCandles({ n: 300, trend: 'down', startPrice: 1000 });
    const { score } = computeSignal(bearish, { nlpScore: -1, fundamentalScore: 0 });
    expect(score).toBeLessThanOrEqual(THRESHOLDS.STRONG_SELL);
  });

  it('includes a warning when NLP and fundamentals are missing', () => {
    const candles = syntheticCandles({ n: 200 });
    const { warning } = computeSignal(candles);
    expect(warning).not.toBeNull();
    expect(warning).toContain('missing');
  });

  it('has no warning when all inputs are present', () => {
    const candles = syntheticCandles({ n: 200 });
    const { warning } = computeSignal(candles, { nlpScore: 0, fundamentalScore: 50 });
    expect(warning).toBeNull();
  });
});

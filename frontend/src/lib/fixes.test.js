import { describe, it, expect } from 'vitest';
import { evaluateAlert } from '../hooks/useAlertMonitor';
import { chartTime } from './format.jsx';
import { sma } from './indicators';

describe('evaluateAlert', () => {
  const below = { metric: 'price', condition: 'below', value: 100 };
  it('does not fire when the price has not loaded (null <= 100 is true in JS)', () => {
    expect(evaluateAlert(below, { ltp: null })).toBe(null);
    expect(evaluateAlert(below, { ltp: undefined })).toBe(null);
    expect(evaluateAlert(below, undefined)).toBe(null);
  });
  it('fires on real crossings', () => {
    expect(evaluateAlert(below, { ltp: 99 })).toBe(true);
    expect(evaluateAlert(below, { ltp: 101 })).toBe(false);
    expect(evaluateAlert({ metric: 'rsi', condition: 'above', value: 70 }, { rsi: 71.2 })).toBe(true);
  });
  it('matches signal families', () => {
    expect(evaluateAlert({ metric: 'signal', value: 'BUY' }, { signal: 'STRONG BUY' })).toBe(true);
    expect(evaluateAlert({ metric: 'signal', value: 'SELL' }, { signal: 'BUY' })).toBe(false);
    expect(evaluateAlert({ metric: 'signal', value: 'BUY' }, { signal: null })).toBe(null);
  });
});

describe('chartTime', () => {
  it('keeps daily bars on their IST date', () => {
    expect(chartTime('2026-10-13T00:00:00+05:30')).toBe('2026-10-13');
    expect(chartTime(new Date('2026-10-13T00:00:00+05:30').toISOString())).toBe('2026-10-13');
  });
  it('shifts intraday bars so the axis reads IST', () => {
    const t = chartTime('2026-10-13T09:15:00+05:30', true);
    const d = new Date(t * 1000);
    expect([d.getUTCHours(), d.getUTCMinutes()]).toEqual([9, 15]);
  });
});

describe('sma', () => {
  it('terminates and computes with nulls in the window', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(() => sma([1, 2, null, 4, 5, 6], 2)).not.toThrow();
  });
});

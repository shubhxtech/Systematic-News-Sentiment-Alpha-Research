/**
 * store.js — Zustand global state
 */
import { create } from 'zustand';

const savedWatchlist = JSON.parse(localStorage.getItem('sc_watchlist') || '[]');
const savedAlerts    = JSON.parse(localStorage.getItem('sc_alerts')    || '[]');

export const useStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────────────────────
  apiToken: localStorage.getItem('upstox_token') || '',
  setApiToken: (token) => {
    localStorage.setItem('upstox_token', token);
    set({ apiToken: token });
  },

  // ── UI ────────────────────────────────────────────────────────────────────
  activeTab: 'screener',
  setActiveTab: (tab) => set({ activeTab: tab }),
  selectedTicker: null,
  setSelectedTicker: (t) => set({ selectedTicker: t }),
  chartModalTicker: null,
  setChartModalTicker: (t) => set({ chartModalTicker: t }),

  // ── State Flags ───────────────────────────────────────────────────────────
  loading: { screener: false, backtest: false },
  setLoading: (key, val) => set(s => ({ loading: { ...s.loading, [key]: val } })),
  error: null,
  setError: (e) => set({ error: e }),

  // ── Market ────────────────────────────────────────────────────────────────
  marketOpen: false,
  setMarketOpen: (v) => set({ marketOpen: v }),
  lastUpdated: null,
  setLastUpdated: (v) => set({ lastUpdated: v }),

  // ── Screener data ─────────────────────────────────────────────────────────
  screenerData: {},
  setScreenerData: (data) => set(s => ({ screenerData: typeof data === 'function' ? data(s.screenerData) : data })),
  updateTicker: (ticker, patch) => set(s => ({
    screenerData: { ...s.screenerData, [ticker]: { ...(s.screenerData[ticker] || {}), ...patch } }
  })),

  // ── Candle cache ──────────────────────────────────────────────────────────
  candleCache: {},
  setCandleCache: (ticker, candles) => set(s => ({
    candleCache: { ...s.candleCache, [ticker]: candles }
  })),

  // ── NLP sentiments ─────────────────────────────────────────────────────────
  nlpSentiments: {},
  setNLPSentiments: (data) => set({ nlpSentiments: data }),

  // ── Watchlist ─────────────────────────────────────────────────────────────
  watchlist: savedWatchlist,
  toggleWatchlist: (ticker) => set(s => {
    const next = s.watchlist.includes(ticker)
      ? s.watchlist.filter(t => t !== ticker)
      : [...s.watchlist, ticker];
    localStorage.setItem('sc_watchlist', JSON.stringify(next));
    return { watchlist: next };
  }),

  // ── Alerts ────────────────────────────────────────────────────────────────
  alerts: savedAlerts,
  addAlert: (alert) => set(s => {
    const next = [...s.alerts, alert];
    localStorage.setItem('sc_alerts', JSON.stringify(next));
    return { alerts: next };
  }),
  removeAlert: (id) => set(s => {
    const next = s.alerts.filter(a => a.id !== id);
    localStorage.setItem('sc_alerts', JSON.stringify(next));
    return { alerts: next };
  }),
  triggerAlert: (id) => set(s => ({
    alerts: s.alerts.map(a => a.id === id ? { ...a, triggered: true } : a)
  })),

  // ── Filters ───────────────────────────────────────────────────────────────
  filters: {
    search: '', sector: 'All', signal: 'All',
    minRSI: 0, maxRSI: 100, minScore: 0,
    showWatchlistOnly: false,
    sortBy: 'signalScore', sortDir: 'desc',
  },
  setFilter: (key, val) => set(s => ({ filters: { ...s.filters, [key]: val } })),

  // ── Backtest ──────────────────────────────────────────────────────────────
  backtestConfig: {
    ticker: 'RELIANCE', strategy: 'full_alpha',
    startDate: '2023-01-01',
    endDate: new Date().toISOString().split('T')[0],
    stopLoss: 5, takeProfit: 15, costs: 20, rebalance: 'monthly',
  },
  setBacktestConfig: (patch) => set(s => ({ backtestConfig: { ...s.backtestConfig, ...patch } })),
  backtestResult: null,
  setBacktestResult: (r) => set({ backtestResult: r }),
  backtestRunning: false,
  setBacktestRunning: (v) => set({ backtestRunning: v }),

  // ── Loading ───────────────────────────────────────────────────────────────
  loading: { screener: false, candles: false, backtest: false },
  setLoading: (key, val) => set(s => ({ loading: { ...s.loading, [key]: val } })),
  error: null,
  setError: (e) => set({ error: e }),
}));

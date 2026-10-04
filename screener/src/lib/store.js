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

  // ── Telegram Config ───────────────────────────────────────────────────────
  telegramBotToken: localStorage.getItem('tg_bot_token') || '',
  telegramChatId:   localStorage.getItem('tg_chat_id')   || '',
  setTelegramConfig: (botToken, chatId) => {
    localStorage.setItem('tg_bot_token', botToken);
    localStorage.setItem('tg_chat_id', chatId);
    set({ telegramBotToken: botToken, telegramChatId: chatId });
  },

  // ── UI ────────────────────────────────────────────────────────────────────
  theme: localStorage.getItem('sc_theme') || 'light',
  toggleTheme: () => set(s => {
    const next = s.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('sc_theme', next);
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    return { theme: next };
  }),
  activeTab: 'screener',
  setActiveTab: (tab) => set({ activeTab: tab }),
  selectedTicker: null,
  setSelectedTicker: (t) => set({ selectedTicker: t }),
  chartModalTicker: null,
  setChartModalTicker: (t) => set({ chartModalTicker: t }),

  // ── State Flags ───────────────────────────────────────────────────────────
  loading: { screener: false, candles: false },
  setLoading: (key, val) => set(s => ({ loading: { ...s.loading, [key]: val } })),
  error: null,
  setError: (e) => set({ error: e }),

  // Whether the app is waiting for an API token to be configured
  needsApiToken: !localStorage.getItem('upstox_token'),
  setNeedsApiToken: (v) => set({ needsApiToken: v }),

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
  addToWatchlist: (ticker) => set(s => {
    if (s.watchlist.includes(ticker)) return {};
    const next = [...s.watchlist, ticker.toUpperCase().trim()];
    localStorage.setItem('sc_watchlist', JSON.stringify(next));
    return { watchlist: next };
  }),
  removeFromWatchlist: (ticker) => set(s => {
    const next = s.watchlist.filter(t => t !== ticker);
    localStorage.setItem('sc_watchlist', JSON.stringify(next));
    return { watchlist: next };
  }),
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
    alerts: s.alerts.map(a => a.id === id ? { ...a, triggered: true, triggeredAt: new Date().toISOString() } : a)
  })),

  // ── Filters ───────────────────────────────────────────────────────────────
  filters: {
    search: '', sector: 'All', signal: 'All',
    minRSI: 0, maxRSI: 100, minScore: 0,
    showWatchlistOnly: false,
    sortBy: 'signalScore', sortDir: 'desc',
  },
  setFilter: (key, val) => set(s => ({ filters: { ...s.filters, [key]: val } })),
}));

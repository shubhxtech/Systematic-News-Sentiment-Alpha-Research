/**
 * store.js — Zustand global state
 */
import { create } from 'zustand';

// A corrupt or blocked localStorage entry must not crash the whole app on load.
function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* quota / private mode */ }
}
function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

const savedWatchlist = Array.isArray(load('sc_watchlist', [])) ? load('sc_watchlist', []) : [];
const savedAlerts    = Array.isArray(load('sc_alerts', [])) ? load('sc_alerts', []) : [];
const savedPortfolio = load('sc_portfolio', {});

// The real token lives only on the backend. The browser keeps a marker so the UI knows one is set.
// Older versions stored the JWT itself here; replace it with the marker.
const TOKEN_MARKER = 'backend';
if (read('upstox_token') && read('upstox_token') !== TOKEN_MARKER) save('upstox_token', TOKEN_MARKER);

export const useStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────────────────────
  apiToken: read('upstox_token') || '',
  /** Pass a truthy value when the backend has a token, '' when it does not. */
  setApiToken: (hasToken) => {
    const v = hasToken ? TOKEN_MARKER : '';
    save('upstox_token', v);
    set({ apiToken: v, needsApiToken: !v });
  },

  // ── Telegram Config ───────────────────────────────────────────────────────
  telegramBotToken: read('tg_bot_token') || '',
  telegramChatId:   read('tg_chat_id')   || '',
  setTelegramConfig: (botToken, chatId) => {
    save('tg_bot_token', botToken);
    save('tg_chat_id', chatId);
    set({ telegramBotToken: botToken, telegramChatId: chatId });
  },

  // ── UI ────────────────────────────────────────────────────────────────────
  theme: read('sc_theme') || 'light',
  toggleTheme: () => set(s => {
    const next = s.theme === 'light' ? 'dark' : 'light';
    save('sc_theme', next);
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
  needsApiToken: !read('upstox_token'),
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

  // ── Watchlist ─────────────────────────────────────────────────────────────
  watchlist: savedWatchlist,
  addToWatchlist: (ticker) => set(s => {
    const t = ticker.toUpperCase().trim();
    if (!t || s.watchlist.includes(t)) return {};
    const next = [...s.watchlist, t];
    save('sc_watchlist', next);
    return { watchlist: next };
  }),
  removeFromWatchlist: (ticker) => set(s => {
    const next = s.watchlist.filter(t => t !== ticker);
    save('sc_watchlist', next);
    return { watchlist: next };
  }),
  toggleWatchlist: (ticker) => set(s => {
    const next = s.watchlist.includes(ticker)
      ? s.watchlist.filter(t => t !== ticker)
      : [...s.watchlist, ticker];
    save('sc_watchlist', next);
    return { watchlist: next };
  }),

  // ── Alerts ────────────────────────────────────────────────────────────────
  alerts: savedAlerts,
  addAlert: (alert) => set(s => {
    const next = [...s.alerts, alert];
    save('sc_alerts', next);
    return { alerts: next };
  }),
  removeAlert: (id) => set(s => {
    const next = s.alerts.filter(a => a.id !== id);
    save('sc_alerts', next);
    return { alerts: next };
  }),
  triggerAlert: (id) => set(s => {
    // persisted, so a reload does not fire the same alert again
    const next = s.alerts.map(a => a.id === id ? { ...a, triggered: true, triggeredAt: new Date().toISOString() } : a);
    save('sc_alerts', next);
    return { alerts: next };
  }),

  // ── Portfolio ─────────────────────────────────────────────────────────────
  portfolio: savedPortfolio,
  updatePortfolio: (ticker, data) => set(s => {
    const next = { ...s.portfolio };
    if (!data || data.qty <= 0) {
      delete next[ticker];
    } else {
      next[ticker] = { qty: Number(data.qty), buyPrice: Number(data.buyPrice) };
    }
    save('sc_portfolio', next);
    return { portfolio: next };
  }),

  // ── Filters ───────────────────────────────────────────────────────────────
  filters: {
    search: '', sector: 'All', cap: 'All', signal: 'All', technical: 'All',
    minRSI: 0, maxRSI: 100, minScore: 0,
    showWatchlistOnly: false,
    sortBy: 'signalScore', sortDir: 'desc',
  },
  setFilter: (key, val) => set(s => ({ filters: { ...s.filters, [key]: val } })),
}));

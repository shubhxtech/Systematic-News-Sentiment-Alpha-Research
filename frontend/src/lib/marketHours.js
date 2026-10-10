/**
 * marketHours.js
 * Utilities for NSE trading hours (IST: 9:15 AM – 3:30 PM, Mon-Fri)
 * 
 * When market is closed, the screener should:
 *  - NOT re-fetch live quotes (prices won't change)
 *  - Poll much less frequently (or not at all until pre-open)
 *  - Show a "Market Closed" status with the last-known prices
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30

/** Return current time in IST */
function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/**
 * Returns true if NSE is currently in a live trading session.
 * Does NOT account for holidays — that would need a holiday calendar.
 */
export function isMarketOpen() {
  const now = nowIST();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false; // weekend

  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const totalMins = h * 60 + m;

  // 9:15 = 555 mins, 15:30 = 930 mins
  return totalMins >= 555 && totalMins < 930;
}

/**
 * Returns true if the current time is in pre-open (9:00–9:15 IST)
 */
export function isPreOpen() {
  const now = nowIST();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const totalMins = h * 60 + m;
  return totalMins >= 540 && totalMins < 555; // 9:00–9:15
}

/**
 * Returns true if today is a trading day (Mon–Fri)
 */
export function isTradingDay() {
  const day = nowIST().getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * Get a human-readable market status string.
 */
export function getMarketStatus() {
  if (!isTradingDay()) return 'closed'; // weekend
  if (isPreOpen()) return 'pre-open';
  if (isMarketOpen()) return 'open';

  const now = nowIST();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const totalMins = h * 60 + m;

  if (totalMins < 540) return 'before-open'; // before 9 AM
  return 'closed'; // after 3:30 PM
}

/**
 * How long to wait (ms) before the next live quotes poll.
 *
 * Rules:
 *  - Market open:   poll every 30 seconds (live ticks)
 *  - Pre-open:      poll every 60 seconds (orders being placed)
 *  - After close:   poll every 5 minutes (in case of late corrections)
 *  - Night/weekend: poll every 30 minutes (just to stay in sync; not really needed)
 */
export function getPollInterval() {
  const status = getMarketStatus();
  switch (status) {
    case 'open':         return 30_000;       // 30 sec
    case 'pre-open':     return 60_000;       // 1 min
    case 'closed':       return 5 * 60_000;   // 5 min (catches after-hours corrections)
    case 'before-open':  return 10 * 60_000;  // 10 min (no data yet)
    default:             return 30 * 60_000;  // 30 min (weekends/holidays)
  }
}

/**
 * Returns true when we should skip a live quotes fetch.
 * Quotes only change during trading hours; no need to hammer the API otherwise.
 */
export function shouldSkipLiveQuotes() {
  return !isMarketOpen() && !isPreOpen();
}

/**
 * Format time remaining to market open (IST).
 * Returns null if market is open or about to open within 5 minutes.
 */
export function timeUntilOpen() {
  if (isMarketOpen() || isPreOpen()) return null;

  const now = nowIST();
  const day = now.getUTCDay();

  // Calculate next open day
  let daysUntilOpen = 1;
  if (day === 5) daysUntilOpen = 3; // Fri → Mon
  if (day === 6) daysUntilOpen = 2; // Sat → Mon

  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const totalMins = h * 60 + m;

  if (daysUntilOpen === 1 && totalMins < 555) {
    // Today before 9:15 — open is today
    const minsLeft = 555 - totalMins;
    const hLeft = Math.floor(minsLeft / 60);
    const minLeft = minsLeft % 60;
    if (hLeft === 0) return `${minLeft}m`;
    return `${hLeft}h ${minLeft}m`;
  }

  return `${daysUntilOpen}d`;
}

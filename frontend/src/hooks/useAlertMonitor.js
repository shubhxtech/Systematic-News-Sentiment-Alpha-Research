/**
 * useAlertMonitor.js — evaluates alerts against live screener data from anywhere in the app.
 * Mount once (App). Previously this lived inside AlertsPanel, so alerts only fired while
 * that page was open.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';

export async function sendTelegram(botToken, chatId, message) {
  if (!botToken || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** True/false when the alert can be evaluated, null when the needed data is missing. */
export function evaluateAlert(alert, data) {
  if (!data) return null;
  if (alert.metric === 'price' || alert.metric === 'rsi') {
    const v = alert.metric === 'price' ? data.ltp : data.rsi;
    // `null <= 100` is true in JS, which used to fire "below" alerts before any price loaded
    if (!isNum(v) || !isNum(alert.value)) return null;
    return alert.condition === 'above' ? v >= alert.value : v <= alert.value;
  }
  if (alert.metric === 'signal') {
    if (!data.signal) return null;
    return data.signal === alert.value || (alert.value === 'BUY' && data.signal.includes('BUY'))
      || (alert.value === 'SELL' && data.signal.includes('SELL'));
  }
  return null;
}

export function useAlertMonitor() {
  const screenerData = useStore(s => s.screenerData);
  const alerts = useStore(s => s.alerts);
  const firing = useRef(new Set());

  useEffect(() => {
    const { triggerAlert, telegramBotToken, telegramChatId } = useStore.getState();
    for (const alert of alerts) {
      if (alert.triggered || firing.current.has(alert.id)) continue;
      const data = screenerData[alert.ticker];
      if (evaluateAlert(alert, data) !== true) continue;

      firing.current.add(alert.id);
      triggerAlert(alert.id);

      const cond = alert.condition === 'above' ? '≥' : alert.condition === 'below' ? '≤' : '=';
      const msg = `🔔 <b>Quant Alert Triggered!</b>\n\n` +
        `📈 <b>${alert.ticker}</b>\n` +
        `Condition: <code>${alert.metric.toUpperCase()} ${cond} ${alert.value}</code>\n` +
        `LTP: <b>₹${data.ltp?.toFixed?.(2) ?? 'N/A'}</b> | Signal: <b>${data.signal ?? 'N/A'}</b>\n` +
        `RSI: ${data.rsi?.toFixed?.(1) ?? 'N/A'} | Score: ${data.signalScore ?? 'N/A'}\n\n` +
        `⏰ ${new Date().toLocaleTimeString('en-IN')}`;

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('Quant Screener Alert', {
            body: `${alert.ticker} ${alert.metric} is ${alert.condition} ${alert.value}`,
          });
        } catch { /* some browsers only allow notifications from a service worker */ }
      }
      if (telegramBotToken && telegramChatId) sendTelegram(telegramBotToken, telegramChatId, msg);
    }
  }, [screenerData, alerts]);
}

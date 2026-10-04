import { getMarketQuotes, TICKERS } from './screener/src/lib/upstoxApi.js';
console.log("Tickers count:", TICKERS.length);
getMarketQuotes(TICKERS.slice(0, 500)).then(res => console.log("Quotes returned:", Object.keys(res).length)).catch(err => console.error("Error:", err.message, err.response?.data));

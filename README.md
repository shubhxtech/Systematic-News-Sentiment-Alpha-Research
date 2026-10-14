# India Quant Screener

A high-performance, rule-based quantitative screener for the **NIFTY 500** universe, featuring live Upstox integration, FinBERT NLP sentiment, ML-driven signals, and interactive TradingView charts.

## Features

- **Live Market Data** — Real-time quotes and OHLCV data via the Upstox API
- **Advanced Charting** — TradingView Lightweight Charts v5 (candlesticks, RSI, MACD, crosshair sync)
- **NLP News Sentiment** — FinBERT-scored headlines (30-day window) via local Python backend
- **Fundamental Quality** — P/E, ROE, Debt/Equity, Net Margin
- **Rule-Based Signals** — Combined Trend + Momentum + Volume + NLP + Fundamentals score
- **Alerts Engine** — Browser-based price crossover, RSI threshold, and signal-change alerts
- **Sector Heatmap** — Visual market breadth breakdown by sector
- **Pre-Results Momentum Scanner** — Ranks companies reporting in the next 14–45 days by *emerging* momentum:
  sessions to results, 5/10/20-day returns vs sector index and Nifty 500, acceleration, relative volume,
  NSE delivery trend, each stock's own drift and gap around past results, fundamentals, recent filings,
  liquidity and volatility. Already-extended stocks are penalised. Every row explains why it qualifies and what the risks are.
- **Catalyst Intelligence** — Filings and headlines are typed (order win/cancellation, earnings, guidance,
  capacity, regulatory action/approval, promoter buy/sell, pledges, fund raising, management change, M&A,
  partnerships, analyst ratings, price commentary). Order value, execution period, client and % of revenue
  are extracted. Each item gets novelty (repeat detection), materiality, pre-move in σ (priced in?) and
  source reliability (exchange filing > company > media > rumour).
- **Dark / Light Theme** — Fully supported

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 18, Vite, Tailwind CSS, Zustand, Lightweight Charts |
| Backend | Python 3.12, FinBERT (HuggingFace), scikit-learn, SHAP |
| Data | Upstox API (live), yfinance (historical fallback) |
| Caching | IndexedDB (quotes), LocalStorage (watchlist/alerts) |

## Project Structure

```
india-quant-screener/
├── backend/               ← Python HTTP server & ML/NLP pipelines
│   ├── live_server.py     ← Entry point (run this first)
│   ├── api.py             ← HTTP routes
│   ├── market_data.py     ← NSE/BSE/Upstox clients, trading calendar, delivery data, disk cache
│   ├── premomentum.py     ← Pre-results momentum scanner
│   ├── catalysts.py       ← Catalyst classification and scoring
│   ├── earnings.py        ← Board-meeting CSV screen
│   ├── news.py            ← Headline aggregation
│   ├── tests/             ← python3 -m unittest discover tests
│   ├── config.py          ← Tickers, sectors, pipeline config
│   ├── news_trading_pipeline.py
│   ├── ml_portfolio.py
│   ├── factor_engine.py
│   ├── regime_detector.py
│   ├── insider_scraper.py
│   ├── insider_signal_engine.py
│   ├── earnings_scraper.py
│   ├── tone_shift_detector.py
│   ├── build_universe.py
│   ├── requirements.txt
│   └── data/              ← Insider & transcript data
│
├── frontend/              ← React screener application
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/    ← UI panels (ScreenerTable, ChartModal, etc.)
│   │   ├── pages/         ← Screens.jsx, Company.jsx
│   │   ├── hooks/         ← useScreenerData.js
│   │   └── lib/           ← store, indicators, signals, upstoxApi
│   ├── scripts/dev/       ← Dev test scripts
│   ├── package.json
│   └── vite.config.js
│
└── docs/                  ← Notes, protocol files
    ├── NOTES.md
    ├── SCREENER_README.md
    └── MarketDataFeed.proto
```

## Getting Started

### ⚡ One-tap launch (recommended)

```bash
cd india-quant-screener
./start.sh
```

The script will:
1. Kill any stale processes on ports `8766` / `5175`
2. Auto-detect your conda `quant_env` or `.venv`
3. Start the Python backend and wait for it to be healthy
4. Install frontend npm deps if needed, then start Vite
5. Open `http://localhost:5175` in your browser automatically
6. Stream live backend logs — press **Ctrl+C** to stop everything cleanly

Logs are saved to `.logs/backend.log` and `.logs/frontend.log`.

---

### Manual startup (if needed)

**Backend:**
```bash
cd backend
conda activate quant_env        # or: source .venv/bin/activate
pip install -r requirements.txt # first time only
python live_server.py           # starts on http://localhost:8766
```

**Frontend:**
```bash
cd frontend
npm install                     # first time only
npm run dev                     # starts on http://localhost:5175
```

### Configure Upstox API Token

1. Open the app at `http://localhost:5175`
2. Click the **Settings** (⚙) icon in the top-right
3. Paste your Upstox JWT token
4. The token is securely proxied through the backend — never exposed in the browser

## Tests

```bash
cd backend && python3 -m unittest discover tests   # offline, no network
cd frontend && npm test
```

## Data Sources

| Source | Usage |
|--------|-------|
| Upstox API | Live quotes, OHLCV candles |
| FinBERT (local) | News headline sentiment scoring |
| HuggingFace `ProsusAI/finbert` | NLP model |
| yfinance | Historical price fallback (optional) |
| NSE (nseindia.com) | Upcoming/past results board meetings, corporate filings, holidays, delivery bhavcopy |
| BSE (bseindia.com) | Filings for BSE-only companies |

> **Disclaimer**: This is a research/educational tool. All signals are purely rule-based algorithmic scores and do **not** constitute financial or investment advice.

## License

MIT License. TradingView Lightweight Charts is licensed under Apache 2.0 — see [`docs/SCREENER_README.md`](docs/SCREENER_README.md) for third-party notices.

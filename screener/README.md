# India Quant Screener v2

A high-performance, rule-based quantitative screener for the Indian stock market (NIFTY 500), featuring live Upstox integration, AI-driven news sentiment, and interactive charts.

## Features

- **Live Market Data**: Real-time integration with Upstox API for live quotes and historical OHLCV data.
- **Advanced Charting**: Built on TradingView's Lightweight Charts (v5) for fluid pan/zoom, candlesticks, multi-pane technical indicators (RSI, MACD), and crosshair synchronization.
- **NLP News Sentiment**: Integrated with a Python backend that runs FinBERT to score news headlines on a 30-day window, combining technicals with fundamental sentiment.
- **Fundamental Quality**: Access to key ratios like P/E, ROE, Debt/Equity, and Net Margin.
- **Rule-Based Signals**: A combined quantitative signal engine (Trend, Momentum, Volume, NLP, Fundamentals).
- **Alerts Engine**: Browser-based alerts for price crossovers, RSI thresholds, and signal changes.
- **Sectors Heatmap**: Visual breakdown of market breadth by sector.
- **Dark Mode**: Fully supported dark/light themes.

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Zustand, Lightweight Charts.
- **Backend (Python)**: Provides NLP sentiment and fundamental proxies to avoid exposing Upstox tokens.
- **Caching**: LocalStorage for watchlists/alerts.

## Getting Started

1. **Start the Python Backend**:
   The backend provides the API token proxy, fundamental scores, and FinBERT NLP sentiment.
   ```bash
   conda activate quant_env
   python live_server.py
   ```
2. **Start the Frontend**:
   ```bash
   cd screener
   npm install
   npm run dev
   ```
3. **Configure Upstox**:
   - Open the app in your browser (default `http://localhost:5173`).
   - Go to **Settings** (⚙ icon) and paste your Upstox API JWT token.
   - The token will be securely sent to the backend.

## Data Sources and Limitations

- **Prices and Candles**: Pulled from the Upstox API. Delays depend on Upstox limits.
- **NLP Sentiment**: Uses HuggingFace `ProsusAI/finbert` via the local Python backend. Sentiments are scored offline and cached.
- **Fundamentals**: Sourced from the backend cache. Not all NIFTY 500 stocks may have complete data.
- **Disclaimer**: This is a research tool. The "Buy/Sell" signals are purely rule-based algorithmic scores and do not constitute financial or investment advice.

## License
MIT License. TradingView Lightweight Charts is licensed under Apache 2.0 (see THIRD_PARTY_NOTICES.md).

# India NLP Quant Research Terminal
### Team: Dhurandhar | IIT Mandi | MA546 Project | 2025

---

## Team Members

| Member | Roll No. | Role |
|---|---|---|
| Aditi Gupta | B23307 | Data & NLP Lead |
| Siddhi Pogakwar | B23415 | Machine Learning Lead |
| Anamika | B23428 | Quant Strategy Lead |
| Shubh Sahu | B23358 | Architecture & UI Lead |

---

## What This Project Does

An end-to-end algorithmic trading system that:
1. Reads Indian financial news (Economic Times, 2022–2025)
2. Scores each article using **FinBERT** (sentiment) + **DeBERTa-v3** (relevance filtering)
3. Converts scores to cross-sectional Z-scores (relative strength signals)
4. Predicts 21-day forward returns using Ridge Regression + Random Forest ensemble
5. Detects market regime (Bull / Bear / Sideways) using a Gaussian HMM
6. Optimises portfolio weights using Mean-Variance or Mean-Semivariance (SLSQP)
7. Displays everything in a live React/TypeScript dashboard at **http://localhost:5173**

---

## Quick Start

### The fastest way — one command

```bash
cd /Users/shubhsahu/Desktop/Quant/updated
./run.sh
```

This starts **both** the backend and frontend automatically. Open **http://localhost:5173** in your browser.

---

### Manual start (two terminals)

**Terminal 1 — Backend**
```bash
cd /Users/shubhsahu/Desktop/Quant/updated
conda activate quant_env
python live_server.py
# → Server ready on http://localhost:8766
```

**Terminal 2 — Frontend**
```bash
cd /Users/shubhsahu/Desktop/Quant/updated/frontend
npm install       # first time only
npm run dev
# → Dashboard at http://localhost:5173
```

---

### Other run modes

```bash
./run.sh backend    # backend only  (http://localhost:8766)
./run.sh frontend   # frontend only (http://localhost:5173)
./run.sh backtest   # run CLI walk-forward backtest (main.py)
```

---

## First-Time Setup

### Step 1 — Python environment

```bash
conda create -n quant_env python=3.10 -y
conda activate quant_env
pip install torch transformers scikit-learn scipy numpy pandas hmmlearn shap yfinance flask
```

> **Apple Silicon Mac:** PyTorch auto-uses MPS (Metal). No extra steps.
>
> **Linux + NVIDIA GPU:**
> ```bash
> pip install torch --index-url https://download.pytorch.org/whl/cu118
> pip install transformers scikit-learn scipy numpy pandas hmmlearn shap yfinance flask
> ```

### Step 2 — Node.js (frontend)

Install Node.js ≥ 18 from https://nodejs.org, then:

```bash
cd frontend
npm install
```

---

## Project Structure

```
updated/
├── run.sh                     ← START HERE: runs everything
├── live_server.py             ← Python backend REST API (port 8766)
├── main.py                    ← CLI walk-forward backtest
├── news_trading_pipeline.py   ← 8-stage NLP pipeline (FinBERT + DeBERTa)
├── ml_portfolio.py            ← ML models + portfolio optimiser
├── factor_engine.py           ← 5-factor fundamental scoring
├── regime_detector.py         ← HMM market regime detection
├── tone_shift_detector.py     ← earnings transcript tone-shift
├── earnings_scraper.py        ← transcript ingestion
├── insider_scraper.py         ← insider trading data
├── insider_signal_engine.py   ← insider signal processing
├── config.py                  ← stock universe, strategy config
├── regime_parameters.json     ← per-regime parameters (Bull/Bear/Sideways)
├── nlp_cache.json             ← 47 MB pre-scored NLP output ✅ INCLUDED
├── data/
│   └── transcripts/           ← earnings call JSON files
├── outputs/                   ← backtest results (CSV)
└── frontend/                  ← React 19 + TypeScript + Tailwind v4
    ├── vite.config.ts         ← proxies /api → localhost:8766
    ├── package.json
    └── src/
        ├── App.tsx            ← polls /api/live-state every 1.5s
        ├── utils.ts           ← keyboard shortcuts, helpers
        ├── index.css
        └── components/
            ├── Layout.tsx
            ├── ResearchTab.tsx      ← NLP signal research
            ├── ScreenerTab.tsx      ← live stock screener
            ├── BacktestTab.tsx      ← interactive backtester
            ├── PortfolioTab.tsx     ← current portfolio & weights
            ├── SignalMatrixTab.tsx  ← cross-sectional signal matrix
            ├── AnalyticsTab.tsx     ← performance analytics
            ├── JournalTab.tsx       ← trade journal
            └── SettingsTab.tsx      ← config & parameters
```

---

## Backend API Endpoints

The backend (`live_server.py`) runs on `http://localhost:8766`. All endpoints are proxied through the frontend at `/api/...`.

| Endpoint | Method | Description |
|---|---|---|
| `/api/live-state` | GET | Full system state (polled every 1.5s by dashboard) |
| `/api/backtest` | POST | Run a backtest with given parameters |
| `/api/screener` | GET | Live stock screener data |
| `/api/signal-matrix` | GET | Cross-sectional signal matrix |
| `/api/portfolio` | GET | Current portfolio weights |
| `/api/analytics` | GET | Performance metrics & PnL |
| `/api/journal` | GET/POST | Trade journal entries |
| `/api/regime` | GET | Current market regime (Bull/Bear/Sideways) |

---

## Run a CLI Backtest

No UI required:
```bash
./run.sh backtest
# or directly:
conda activate quant_env && python main.py
```

Outputs saved to `outputs/`:
- `portfolio_returns.csv`
- `portfolio_weights.csv`
- `performance_metrics.csv`
- `daily_scores.csv`

---

## NLP Cache (`nlp_cache.json`)

Pre-scored sentiment output for 100,000+ Economic Times headlines (2022–2025). Already included — **you do not need to re-run the NLP models**.

> Running FinBERT + DeBERTa on 100k articles takes ~4–6 hours on CPU, ~45 min on GPU.
> The cache loads in ~3 seconds on startup.

To regenerate (optional):
```bash
# WARNING: ~4–6 hours on CPU
python news_trading_pipeline.py --rebuild-cache
```

---

## Configuration

Key parameters in `config.py`:

| Parameter | Default | Effect |
|---|---|---|
| Signal half-life | 36 hours | Decay rate of news signal |
| Holding period | 21 days | How long each portfolio is held |
| Max stock weight | 15% | Concentration cap per stock |
| Max sector weight | 35% | Sector diversification cap |
| Min stocks | 8 | Minimum holdings |
| Rebalance | Month-end | When portfolio rebalances |

Live-editable without restart:
- `regime_parameters.json` — per-regime strategy params (Bull/Bear/Sideways)

---

## Keyboard Shortcuts (in Dashboard)

| Key | Tab |
|---|---|
| `1` | Research |
| `2` | Signal Matrix |
| `3` | Backtest |
| `4` | Portfolio |
| `5` | Journal |
| `6` | Analytics |
| `7` | Screener |
| `8` | Settings |

---

## Troubleshooting

| Error | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'torch'` | `pip install torch` in `quant_env` |
| `ModuleNotFoundError: No module named 'hmmlearn'` | `pip install hmmlearn` |
| `Port 8766 already in use` | `lsof -ti:8766 \| xargs kill` |
| Frontend shows blank / cannot connect | Make sure `python live_server.py` is running first |
| `yfinance` download fails | Yahoo Finance may throttle — retry after 30s |
| HMM error on first backtest | Need ≥ 100 trading days loaded — use start date ≥ 2022-06-01 |

---

## Dependencies

```
Python ≥ 3.10
torch ≥ 2.0
transformers ≥ 4.38
scikit-learn ≥ 1.4
scipy ≥ 1.11
numpy ≥ 1.24
pandas ≥ 2.0
hmmlearn ≥ 0.3
shap ≥ 0.44
yfinance ≥ 0.2
flask ≥ 3.0

Node.js ≥ 18.x  (frontend only)
```

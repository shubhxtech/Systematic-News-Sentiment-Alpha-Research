# India Quant Screener

A screener for Indian equities built around one question: **which stocks are setting up
ahead of their quarterly results, and is the news around them actually material?**

It covers the Nifty Total Market universe (Nifty 500 + Microcap 250, about 750 stocks), pulls
live quotes from Upstox, and reads results dates, filings and delivery data straight from NSE.
Every score is rule-based and comes with the reasons behind it, so you can check the logic
instead of trusting a number.

It is a research tool. Nothing here is a forecast or investment advice.

## What it does

**Screener.** Live price, change, volume against its 20-day average, RSI, 52-week range and a
composite technical signal (trend, MACD, Supertrend, volume) for every stock in the universe.
Filter by sector, size bucket or a query such as `RSI < 35 AND relvol > 2`.

**Pre-Results.** The main feature. It takes every company reporting in the next 2–6 weeks and
asks whether momentum is *starting* to build:

- sessions left until the results board meeting (NSE holidays excluded)
- 5-, 10- and 20-day returns relative to the stock's sector index and the Nifty 500
- acceleration (last 5 sessions vs the 5 before) and relative volume
- delivered quantity vs the prior 20 sessions, from NSE's daily delivery file
- how the stock behaved before its own past results (drift, hit rate) and the gap after them
- fundamentals, exchange filings from the last 30 days, liquidity and volatility

Stocks that have already run hard (20-day move above 1.5σ, or RSI above 70) are penalised, as
are names reporting within two sessions. Each row is labelled Early, Building, Neutral,
Extended, Weak or Too close, and expands to show why it qualifies and what the risks are.

**Catalysts** (on each company page, and in the News tab). Filings and headlines are typed as
order win or cancellation, earnings, guidance change, capacity expansion, regulatory action or
approval, promoter buying or selling, pledges, fund raising, management change, M&A,
partnership, analyst rating or plain price commentary. For each item the app works out:

- *materiality*: order value as a % of annual revenue, fund raise as a % of market cap, and so on
- *novelty*: the same story from three outlets and the exchange counts once
- *price reaction*: how far the stock moved in the five sessions before the item, in σ
- *source reliability*: exchange filing, then company statement, then established media, then unverified reports

The resulting impact score is direction × materiality × novelty × reliability, reduced when the
move already happened.

**Earnings.** Upload a board-meeting CSV exported from BSE and a fundamentals CSV in Screener.in's
format. The app resolves every company to its NSE symbol, attaches fundamentals and price data,
and ranks the list. The fundamentals you upload also feed the screener and the pre-results scan.

**Sectors.** Today's median move and breadth for each NSE sector, plus 5/20/60-day performance
against the Nifty 500, with a heatmap of every stock underneath.

Also: company pages with daily and intraday charts, a watchlist, and price/RSI/signal alerts
that fire as browser notifications on any page.

## Running it

You need Python 3.10+, Node 18+ and an Upstox access token for live quotes. Historical candles,
NSE data and the pre-results scan work without one.

```bash
./start.sh
```

That starts the backend on port 8766 and the frontend on 5175, and opens the browser. To run the
two halves yourself:

```bash
cd backend && pip install -r requirements.txt && python3 live_server.py
cd frontend && npm install && npm run dev
```

Paste the Upstox token under Settings. It is stored by the backend in `backend/.upstox_token`
(file mode 600) and never kept in the browser. Upstox tokens expire every morning, so you will
need a fresh one each trading day.

The stock universe lives in `frontend/src/lib/universe.json`. Rebuild it after NSE rebalances its
indices (March and September):

```bash
cd backend && python3 build_universe.py
```

## Tests

```bash
cd backend && python3 -m unittest discover tests   # offline, no network needed
cd frontend && npm test
```

## Layout

```
backend/
  live_server.py     HTTP server entry point
  api.py             routes, Upstox proxy
  market_data.py     NSE, BSE and Upstox clients, trading calendar, delivery data, disk cache
  premomentum.py     pre-results scanner
  catalysts.py       event classification and scoring
  earnings.py        board-meeting CSV pipeline, fundamentals scoring
  news.py            headline aggregation (ET, Moneycontrol, Google News, Yahoo)
  news_dedup.py      merges near-duplicate headlines
  build_universe.py  regenerates the stock universe from NSE index lists
  data/              fundamentals master, cached candles/filings, saved scan runs
frontend/src/
  pages/             Screener, Company, Pre-Results, Earnings, Sectors, News
  components/        tables, panels, chart modal
  hooks/             quote polling, alert monitoring
  lib/               API client, indicators, signal engine, store
```

## Data sources

| Source | Used for |
|---|---|
| Upstox API | live quotes (token), daily and intraday candles |
| NSE | upcoming and past results dates, corporate filings, holiday calendar, delivery data, index constituents |
| BSE | filings for companies listed only on BSE |
| ET, Moneycontrol, Google News, Yahoo Finance | headlines |
| Your CSVs | board-meeting calendar, fundamentals |

NSE throttles scrapers, so the backend spaces out its requests and caches everything on disk.
A first pre-results scan takes one to three minutes; repeat scans take seconds.

## Limitations

- Fundamentals only exist for companies in your uploaded CSV (or from yfinance, if installed).
  Without them, an order's value cannot be put in proportion to revenue.
- Filings are read from their exchange summaries, not the attached PDFs. If a penalty's amount
  is only in the PDF, it is marked medium materiality and flagged.
- Past results dates come without announcement times, so the post-result gap is measured from
  that day's close to the next session's open.
- The event classifier is a set of rules. It handles the common filing and headline patterns,
  but it will misread some unusual wording.
- Scores describe the setup and each stock's own history. They do not estimate the odds of an
  earnings beat.

## License

MIT. Charts use TradingView Lightweight Charts (Apache 2.0); see
[`frontend/THIRD_PARTY_NOTICES.md`](frontend/THIRD_PARTY_NOTICES.md).

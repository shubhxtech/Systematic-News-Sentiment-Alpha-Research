import copy
import pandas as pd
from datetime import datetime
import state

def push_exec_log(msg):
    """Pushes a backend execution message directly to the frontend console."""
    ts = datetime.now().strftime("%H:%M:%S")
    with state.state_lock:
        if "execution_logs" not in state.APP_STATE:
             state.APP_STATE["execution_logs"] = collections.deque(maxlen=60)
        state.APP_STATE["execution_logs"].append(f"[{ts}] {msg}")

def push_log(vt, lat, hl, tick, sent, sent_s, nli):
    log = {
        "time": vt.strftime("%b %d, %H:%M"),
        "headline": hl,
        "tickers": tick,
        "sentiment": sent,
        "sentiment_score": round(sent_s, 3),
        "nli_conf": round(nli, 3),
        "latency_ms": int(lat * 1000)
    }
    state.APP_STATE["logs"].appendleft(log)

def calculate_live_pnl():
    """
    Compute rolling PnL AND generate a full trade journal.
    Journal contains per-day: entry price, exit price, weights, stock-level
    P&L contribution and the cumulative portfolio return.
    """
    import yfinance as yf
    with state.state_lock:
        wh = copy.deepcopy(state.SIMULATION_PARAMS.get("daily_weights_history", {}))
        raw_price_global = state.SIMULATION_PARAMS.get("yfinance_cache", pd.DataFrame())
    if not wh:
        return "0.00%"

    dates = sorted(wh.keys())
    start_date = dates[0]
    end_date = (pd.to_datetime(dates[-1]) + pd.Timedelta(days=12)).strftime("%Y-%m-%d")

    try:
        # Collect tickers — skip non-tradeable __ prefix tickers and near-zero weights
        all_tix = set()
        for w in wh.values():
            for k, v in w.items():
                if abs(v) > 0.001 and not k.startswith("__"):
                    all_tix.add(k)
        tix_list = sorted(all_tix)
        if not tix_list:
            return "0.00%"

        raw_price = raw_price_global.copy()
        if raw_price.empty:
            print("[PnL] Global price cache is empty!")
            return "0.00%"
            
        # Scope dates to what we bounded
        mask = (raw_price.index >= start_date) & (raw_price.index <= end_date)
        raw_price = raw_price.loc[mask]

        if raw_price.empty:
            print("[PnL] No price records found in bound")
            return "0.00%"

        # Drop any columns that are all-NaN (delisted / bad tickers)
        raw_price = raw_price.dropna(axis=1, how='all')
        valid_tix = [t for t in tix_list if t in raw_price.columns]
        raw_price = raw_price[valid_tix]

        # Build weight_df; re-map weight dates to nearest actual trading day
        weight_df = pd.DataFrame.from_dict(wh, orient="index").fillna(0.0)
        # Drop __ prefix tickers and absent tickers from weights df
        weight_df = weight_df[[c for c in weight_df.columns if c in raw_price.columns]]
        # Shift weights to prevent lookahead bias (T news trades on T+1 return)
        # We re-align weight dates to nearest actual trading day
        weight_df.index = pd.to_datetime(weight_df.index).tz_localize(None)
        all_price_dates = raw_price.index
        if all_price_dates.tz is not None:
            all_price_dates = all_price_dates.tz_localize(None)
        mapped_idx = []
        for wd in weight_df.index:
            # Find the NEXT trading day after the news
            fut = all_price_dates[all_price_dates > wd]
            mapped_idx.append(fut[0] if len(fut) > 0 else all_price_dates[-1])
        weight_df.index = pd.DatetimeIndex(mapped_idx)
        weight_df = weight_df[~weight_df.index.duplicated(keep='last')]

        # Daily returns matrix
        return_df = (raw_price / raw_price.shift(1) - 1).fillna(0.0)

        # Forward-fill weights across all price dates (hold until next rebalance)
        common_cols = [c for c in weight_df.columns if c in return_df.columns]
        if not common_cols:
            print(f"[PnL] No overlapping tickers: weights={list(weight_df.columns)[:4]}")
            return "0.00%"

        active_w = weight_df[common_cols].reindex(return_df.index).ffill().fillna(0.0)
        # Normalise so gross leverage = 1 each day
        gross_w = active_w.abs().sum(axis=1).replace(0, 1)
        active_w = active_w.div(gross_w, axis=0)

        daily_ret = (active_w * return_df[common_cols]).sum(axis=1)
        daily_ret = daily_ret[active_w.abs().sum(axis=1) > 0]  # only days with positions

        if daily_ret.empty:
            return "0.00%"

        cum_ret = float((1 + daily_ret).prod() - 1)

        # ── Build Trade Journal ────────────────────────────────────────────────
        journal = []
        cum = 1.0
        price_idx = raw_price.index

        for date, dr in daily_ret.items():
            cum *= (1 + dr)
            loc = price_idx.get_loc(date) if date in price_idx else None
            if loc is None or loc == 0:
                continue

            prev_date = price_idx[loc - 1]
            day_weights = active_w.loc[date]          # weights in force this day

            positions = []
            for ticker in common_cols:
                w = float(day_weights.get(ticker, 0.0))
                if abs(w) < 0.001:
                    continue
                entry_p = raw_price.loc[prev_date, ticker] if not pd.isna(raw_price.loc[prev_date, ticker]) else None
                exit_p  = raw_price.loc[date,      ticker] if not pd.isna(raw_price.loc[date,      ticker])  else None
                stock_ret = float(return_df.loc[date, ticker]) if ticker in return_df.columns else 0.0
                contribution = round(w * stock_ret * 100, 4)
                positions.append({
                    "ticker":        ticker.replace(".NS", ""),
                    "direction":     "Long" if w > 0 else "Short",
                    "weight_pct":    round(w * 100, 2),
                    "entry_price":   round(float(entry_p), 2) if entry_p is not None else None,
                    "exit_price":    round(float(exit_p),  2) if exit_p  is not None else None,
                    "stock_ret_pct": round(stock_ret * 100, 3),
                    "contribution_pct": contribution,
                })

            positions.sort(key=lambda x: abs(x["contribution_pct"]), reverse=True)
            journal.append({
                "date":              str(date.date()),
                "daily_return_pct": round(float(dr) * 100, 4),
                "cumulative_pct":   round((cum - 1) * 100, 4),
                "positions":        positions,
                "n_long":           sum(1 for p in positions if p["direction"] == "Long"),
                "n_short":          sum(1 for p in positions if p["direction"] == "Short"),
            })

        with state.state_lock:
            state.APP_STATE["trade_journal"] = journal

        # --- Append rolling 21-day Sharpe to history ---
        if len(daily_ret) >= 21:
            roll_sharpe = (daily_ret.rolling(21).mean() / daily_ret.rolling(21).std() * np.sqrt(252)).dropna()
            with state.state_lock:
                state.APP_STATE["history"]["rolling_sharpe"] = [
                    round(float(v), 3) for v in roll_sharpe.values[-100:]
                ]

        print(f"[PnL] {len(daily_ret)} trading days  |  cum return: {cum_ret*100:+.2f}%")
        return f"{cum_ret * 100:+.2f}%"

    except Exception as e:
        print(f"[PnL] Error: {e}")
        import traceback; traceback.print_exc()
        return "N/A"

def calculate_final_pnl():
    from news_trading_pipeline import TICKER_ALIASES
    
    with state.state_lock:
        wh = copy.deepcopy(state.SIMULATION_PARAMS.get("daily_weights_history", {}))
        raw_price_global = state.SIMULATION_PARAMS.get("yfinance_cache", pd.DataFrame())
        
    if not wh:
        with state.state_lock:
             state.APP_STATE["metrics"]["final_pnl"] = "0.00%"
             state.APP_STATE["status"] = "TEST COMPLETED"
        return
        
    dates = sorted(wh.keys())
    start_date = dates[0]
    end_date = (pd.to_datetime(dates[-1]) + pd.Timedelta(days=5)).strftime("%Y-%m-%d")
    
    try:
        raw_price = raw_price_global.copy()
        if raw_price.empty:
            raise ValueError("Global cache is empty.")
            
        mask = (raw_price.index >= start_date) & (raw_price.index <= end_date)
        raw_price = raw_price.loc[mask]
        
        weight_df = pd.DataFrame.from_dict(wh, orient="index").fillna(0.0)
        weight_df.index = pd.to_datetime(weight_df.index)
        weight_df.columns = [c + ".NS" if not c.endswith(".NS") else c for c in weight_df.columns]
        
        # Align indexes identically so they match daily returns perfectly
        # Drop tickers that do not exist in the price cache
        valid_cols = [c for c in weight_df.columns if c in raw_price.columns]
        weight_df = weight_df[valid_cols]
        price_df = raw_price[valid_cols].reindex(weight_df.index).ffill()
        return_df = (price_df / price_df.shift(1) - 1).fillna(0.0)
        
        # Shift weights to prevent lookahead bias (Weights from today apply to tomorrow's market return)
        shifted_weights = weight_df.shift(1).fillna(0.0)
        
        # Enforce exactly 1.0 total gross leverage constraint 
        gross_w = shifted_weights.abs().sum(axis=1)
        shifted_weights = shifted_weights.div(gross_w.replace(0, 1), axis=0)
        
        aligned_w, aligned_r = shifted_weights.align(return_df, join='inner', axis=1)
        portfolio_daily_returns = (aligned_w * aligned_r).sum(axis=1)
        
        cum_ret = (1 + portfolio_daily_returns).prod() - 1
        final_str = f"{cum_ret * 100:+.2f}%"
        
        print(f"Final Return calculated: {final_str}")
        with state.state_lock:
             state.APP_STATE["metrics"]["final_pnl"] = final_str
             state.APP_STATE["status"] = "TEST COMPLETED"
             
    except Exception as e:
        print("P&L Calculation Error:", e)
        with state.state_lock:
             state.APP_STATE["metrics"]["final_pnl"] = "ERR"
             state.APP_STATE["status"] = "TEST COMPLETED"

def compute_tearsheet():
    """Compute full performance tear sheet including benchmark alpha/beta/IR/TE."""
    with state.state_lock:
        wh = copy.deepcopy(state.SIMULATION_PARAMS.get("daily_weights_history", {}))
        raw_price_global = state.SIMULATION_PARAMS.get("yfinance_cache", pd.DataFrame())
        bm_cache_global = state.SIMULATION_PARAMS.get("benchmark_cache", pd.Series(dtype=float))
    if not wh:
        return {}

    dates = sorted(wh.keys())
    all_tix = set()
    for w in wh.values(): all_tix.update(w.keys())
    tix_list = list(all_tix)
    if not tix_list: return {}

    start_date = dates[0]
    end_date = (pd.to_datetime(dates[-1]) + pd.Timedelta(days=5)).strftime("%Y-%m-%d")

    try:
        raw_price = raw_price_global.copy()
        mask = (raw_price.index >= start_date) & (raw_price.index <= end_date)
        raw_price = raw_price.loc[mask]

        avail_tix = [t for t in tix_list if t in raw_price.columns]
        if not avail_tix: return {}
        raw_price = raw_price[avail_tix]

        weight_df = pd.DataFrame.from_dict(wh, orient="index").fillna(0.0)
        weight_df = weight_df[[c for c in avail_tix if c in weight_df.columns]]
        weight_df.index = pd.to_datetime(weight_df.index)
        price_df = raw_price.reindex(weight_df.index, method='ffill')
        return_df = (price_df / price_df.shift(1) - 1).fillna(0.0)

        shifted_w = weight_df.shift(1).fillna(0.0)
        gross_w = shifted_w.abs().sum(axis=1).replace(0, 1)
        shifted_w = shifted_w.div(gross_w, axis=0)
        aligned_w, aligned_r = shifted_w.align(return_df, join='inner', axis=1)
        daily_ret = (aligned_w * aligned_r).sum(axis=1).dropna()

        if len(daily_ret) < 2:
            return {}

        cum_ret     = float((1 + daily_ret).prod() - 1)
        n_years     = len(daily_ret) / 252.0
        ann_ret     = float((1 + cum_ret) ** (1 / max(n_years, 0.01)) - 1) if n_years > 0 else 0.0
        sharpe      = float(daily_ret.mean() / daily_ret.std() * np.sqrt(252)) if daily_ret.std() > 0 else 0.0
        downside    = daily_ret[daily_ret < 0]
        sortino     = float(daily_ret.mean() / downside.std() * np.sqrt(252)) if len(downside) > 1 and downside.std() > 0 else 0.0
        running_max = (1 + daily_ret).cumprod().cummax()
        drawdown_series = ((1 + daily_ret).cumprod() - running_max) / running_max
        max_dd      = float(drawdown_series.min())
        win_rate    = float((daily_ret > 0).mean() * 100)
        equity      = (1 + daily_ret).cumprod()

        # --- Calmar & Omega ratios ---
        calmar = float(ann_ret / abs(max_dd)) if max_dd != 0 else 0.0
        threshold = 0.0
        gains  = daily_ret[daily_ret > threshold].sum()
        losses = abs(daily_ret[daily_ret < threshold].sum())
        omega  = float(gains / losses) if losses > 0 else float('inf')

        # Monthly returns — resample
        monthly = daily_ret.resample('ME').apply(lambda x: float((1 + x).prod() - 1))
        monthly_dict = {str(k.to_period('M').to_timestamp()): round(v * 100, 2) for k, v in monthly.items()}

        # Rolling 21-day Sharpe
        roll_sharpe_series = []
        if len(daily_ret) >= 21:
            rs = (daily_ret.rolling(21).mean() / daily_ret.rolling(21).std() * np.sqrt(252)).dropna()
            roll_sharpe_series = [round(float(v), 3) for v in rs.values]

        # ── Benchmark Alpha / Beta / IR / Tracking Error ────────────────────
        benchmark_cache = bm_cache_global.copy()
        benchmark_results = {}
        if not benchmark_cache.empty:
            try:
                bm = benchmark_cache.copy()
                bm.index = pd.to_datetime(bm.index)
                bm_ret = (bm / bm.shift(1) - 1).dropna()
                # Align to portfolio dates
                common_idx = daily_ret.index.intersection(bm_ret.index)
                if len(common_idx) >= 10:
                    pr  = daily_ret.loc[common_idx]
                    bmr = bm_ret.loc[common_idx]
                    # Beta via OLS
                    cov_mat = np.cov(pr.values, bmr.values)
                    beta = float(cov_mat[0, 1] / (cov_mat[1, 1] + 1e-12))
                    # CAPM Alpha (annualised)
                    risk_free_daily = 0.065 / 252   # ~6.5% Indian risk-free rate
                    alpha_daily = pr.mean() - (risk_free_daily + beta * (bmr.mean() - risk_free_daily))
                    alpha_ann   = float(alpha_daily * 252)
                    # Tracking Error (annualised std of active return)
                    active_ret  = pr - bmr
                    tracking_er = float(active_ret.std() * np.sqrt(252))
                    # Information Ratio
                    ir = float(active_ret.mean() / active_ret.std() * np.sqrt(252)) if active_ret.std() > 0 else 0.0
                    # Benchmark cumulative return
                    bm_cum = float((1 + bmr).prod() - 1)
                    bm_equity = (1 + bmr.reindex(equity.index).fillna(0)).cumprod()
                    benchmark_results = {
                        "beta":             round(beta, 3),
                        "alpha_ann":        round(alpha_ann * 100, 2),
                        "tracking_error":   round(tracking_er * 100, 2),
                        "info_ratio":       round(ir, 3),
                        "bm_total_return":  round(bm_cum * 100, 2),
                        "bm_equity_values": [round(float(v), 4) for v in bm_equity.values],
                    }
            except Exception as bm_e:
                print(f"[Tearsheet] Benchmark computation error: {bm_e}")

        result = {
            "total_return":      round(cum_ret * 100, 2),
            "ann_return":        round(ann_ret * 100, 2),
            "sharpe":            round(sharpe, 3),
            "sortino":           round(sortino, 3),
            "calmar":            round(calmar, 3),
            "omega":             round(min(omega, 99.0), 3),
            "max_drawdown":      round(max_dd * 100, 2),
            "win_rate":          round(win_rate, 1),
            "total_days":        len(daily_ret),
            "monthly":           monthly_dict,
            "equity_dates":      [str(d.date()) for d in equity.index],
            "equity_values":     [round(float(v), 4) for v in equity.values],
            "drawdown_values":   [round(float(v) * 100, 2) for v in drawdown_series.values],
            "rolling_sharpe":    roll_sharpe_series,
            "turnover_cost_bps": round(state.APP_STATE["metrics"].get("turnover_cost_bps", 0.0), 2),
        }
        result.update(benchmark_results)
        return result

    except Exception as e:
        print(f"Tearsheet error: {e}")
        import traceback; traceback.print_exc()
        return {}

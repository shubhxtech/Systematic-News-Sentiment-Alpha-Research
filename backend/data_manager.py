import pandas as pd
import state

try:
    import yfinance as yf
except ImportError:  # optional: the screener still runs, just without yfinance fundamentals
    yf = None
import numpy as np

TICKER_ALIASES = {
    # Banking
    "HDFCBANK":     ["HDFC Bank", "HDFC", "Housing Development Finance"],
    "ICICIBANK":    ["ICICI Bank", "ICICI"],
    "SBIN":         ["SBI", "State Bank of India", "State Bank"],
    "KOTAKBANK":    ["Kotak Mahindra", "Kotak Bank"],
    "AXISBANK":     ["Axis Bank"],
    "INDUSINDBK":   ["IndusInd Bank", "IndusInd"],
    "BANDHANBNK":   ["Bandhan Bank"],
    "FEDERALBNK":   ["Federal Bank"],
    # IT
    "TCS":          ["Tata Consultancy", "TCS"],
    "INFY":         ["Infosys"],
    "WIPRO":        ["Wipro"],
    "HCLTECH":      ["HCL Technologies", "HCL Tech"],
    "TECHM":        ["Tech Mahindra"],
    "LTIM":         ["LTIMindtree", "Larsen Toubro Infotech", "LTI"],
    "MPHASIS":      ["Mphasis"],
    "PERSISTENT":   ["Persistent Systems"],
    "COFORGE":      ["Coforge", "NIIT Technologies"],
    # Energy & Oil
    "RELIANCE":     ["Reliance Industries", "RIL", "Reliance Jio", "Reliance Retail", "Mukesh Ambani"],
    "ONGC":         ["ONGC", "Oil and Natural Gas"],
    "COALINDIA":    ["Coal India"],
    "NTPC":         ["NTPC"],
    "POWERGRID":    ["Power Grid"],
    "TATAPOWER":    ["Tata Power"],
    "ADANIGREEN":   ["Adani Green", "Adani Energy"],
    "ADANIPORTS":   ["Adani Ports", "Mundra Port"],
    # Auto
    "TATAMOTORS":   ["Tata Motors", "Jaguar Land Rover", "JLR"],
    "M&M":          ["Mahindra", "Mahindra & Mahindra"],
    "MARUTI":       ["Maruti Suzuki", "Maruti"],
    "BAJAJ-AUTO":   ["Bajaj Auto"],
    "EICHERMOT":    ["Eicher Motors", "Royal Enfield"],
    "HEROMOTOCO":   ["Hero MotoCorp"],
    "TVSMOTOR":     ["TVS Motor"],
    # FMCG & Consumer
    "ITC":          ["ITC"],
    "HUL":          ["Hindustan Unilever", "HUL"],
    "NESTLEIND":    ["Nestle India"],
    "BRITANNIA":    ["Britannia Industries"],
    "TITAN":        ["Titan Company", "Titan"],
    "ASIANPAINT":   ["Asian Paints"],
    "DABUR":        ["Dabur India"],
    "GODREJCP":     ["Godrej Consumer"],
    # Pharma
    "SUNPHARMA":    ["Sun Pharma", "Sun Pharmaceutical"],
    "CIPLA":        ["Cipla"],
    "DRREDDY":      ["Dr Reddy", "Dr Reddy's Laboratories"],
    "DIVISLAB":     ["Divi's Laboratories", "Divis Lab"],
    "LUPIN":        ["Lupin"],
    "AUROPHARMA":   ["Aurobindo Pharma"],
    # Metals & Mining
    "TATASTEEL":    ["Tata Steel", "Corus"],
    "JSWSTEEL":     ["JSW Steel"],
    "HINDALCO":     ["Hindalco Industries"],
    "VEDL":         ["Vedanta"],
    "NMDC":         ["NMDC"],
    # Telecom
    "BHARTIARTL":   ["Bharti Airtel", "Airtel"],
    "IDEA":         ["Vodafone Idea", "Vi"],
    "INDUSTOWER":   ["Indus Towers"],
    # Finance (Non-Bank)
    "BAJFINANCE":   ["Bajaj Finance"],
    "BAJAJFINSV":   ["Bajaj Finserv"],
    "CHOLAFIN":     ["Cholamandalam Investment"],
    "SHRIRAMFIN":   ["Shriram Finance", "Shriram Transport"],
    "MUTHOOTFIN":   ["Muthoot Finance"],
    # Capital Goods / Infrastructure
    "LT":           ["Larsen & Toubro", "L&T"],
    "HAL":          ["Hindustan Aeronautics", "HAL"],
    "BEL":          ["Bharat Electronics", "BEL"],
    "SIEMENS":      ["Siemens India"],
    "ABB":          ["ABB India"],
    # Cement
    "ULTRACEMCO":   ["UltraTech Cement", "UltraTech"],
    "GRASIM":       ["Grasim Industries"],
    "AMBUJACEM":    ["Ambuja Cements"],
    "SHREECEM":     ["Shree Cement"],
}

def _ok(v):
    try:
        return v is not None and not np.isnan(float(v))
    except (TypeError, ValueError):
        return False


def compute_quality_score(m: dict) -> float:
    score = 50.0
    roe = m.get("roe")
    if _ok(roe):
        score += min(20.0, float(roe) * 80.0)
    de = m.get("debt_equity")
    if _ok(de):
        de = float(de) / 100.0  # yfinance reports debt/equity in percent (45.2 = 0.452x)
        if de < 0.5:   score += 15.0
        elif de < 1.0: score += 8.0
        elif de < 2.0: score += 2.0
        elif de < 3.0: score -= 5.0
        else:          score -= 15.0
    margin = m.get("net_margin")
    if _ok(margin):
        score += min(15.0, float(margin) * 50.0)
    rev_g = m.get("rev_growth")
    if _ok(rev_g):
        score += min(10.0, float(rev_g) * 40.0)
    pe = m.get("pe")
    if _ok(pe):
        pe = float(pe)
        if pe < 0:     score -= 10.0
        elif pe > 80:  score -= 10.0
        elif pe > 50:  score -= 5.0
        elif 12 <= pe <= 30: score += 5.0
    return round(float(np.clip(score, 0.0, 100.0)), 1)

def fetch_fundamental_cache():
    if yf is None:
        print("[Fundamentals] yfinance not installed — skipping (pip install yfinance).")
        return
    tickers = [k for k in TICKER_ALIASES.keys() if not k.startswith("__")]
    print(f"[Fundamentals] Fetching data for {len(tickers)} tickers in background...")
    cache = {}
    for base in tickers:
        ticker_ns = base + ".NS"
        try:
            info = yf.Ticker(ticker_ns).info
            if not info or (info.get("regularMarketPrice") is None and info.get("currentPrice") is None):
                continue
            raw = {
                "name":        info.get("longName") or info.get("shortName") or base,
                "sector":      info.get("sector") or info.get("industry") or "Other",
                "pe":          info.get("trailingPE"),
                "pb":          info.get("priceToBook"),
                "roe":         info.get("returnOnEquity"),
                "roa":         info.get("returnOnAssets"),
                "debt_equity": info.get("debtToEquity"),
                "net_margin":  info.get("profitMargins"),
                "rev_growth":  info.get("revenueGrowth"),
                "eps":         info.get("trailingEps"),
                "market_cap":  info.get("marketCap"),
                "div_yield":   info.get("dividendYield"),
                "current_ratio": info.get("currentRatio"),
                "52w_high":    info.get("fiftyTwoWeekHigh"),
                "52w_low":     info.get("fiftyTwoWeekLow"),
                "analyst_target": info.get("targetMeanPrice"),
            }
            raw["score"] = compute_quality_score(raw)
            cache[ticker_ns] = raw
        except Exception as e:
            print(f"[Fundamentals] {ticker_ns}: {type(e).__name__}: {e}")
    if not cache:
        print("[Fundamentals] Fetched nothing — keeping the previous cache.")
        return
    with state.state_lock:
        state.APP_STATE["fundamental_cache"] = cache
    scores = [v["score"] for v in cache.values()]
    avg = round(np.mean(scores), 1) if scores else 0
    print(f"✅ [Fundamentals] Loaded {len(cache)} tickers. Avg quality score: {avg}/100")

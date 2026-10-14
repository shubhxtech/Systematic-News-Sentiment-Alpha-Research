"""Pre-results momentum scanner.

Find companies whose momentum is *starting* to build ahead of quarterly results, not ones that
have already run. Pipeline:

  1. Event calendar   NSE upcoming results ∪ latest uploaded board-meeting run (merged by ISIN)
  2. Stage 1 (all)    price/volume features vs. sector index and Nifty 500, delivery-% trend,
                      fundamentals from the master CSV
  3. Stage 2 (top K)  each stock's own history around past results (pre-results drift,
                      post-result gap) and recent exchange filings run through catalyst intelligence
  4. Score + explain  0-100 score, a stage label (Early / Building / Extended / Weak) and the
                      reasons and risks behind it

All numbers are descriptive. None of them is a forecast or an earnings-beat probability.
"""
import json
import math
import re
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

import catalysts
import earnings
import market_data as md

OUT_DIR = md.DATA_DIR / "premomentum"
KEEP_RUNS = 20
HISTORY_DAYS = 1100          # ~3 years of daily candles → up to ~12 past results
PRE_WINDOW = 10              # sessions before a result used for "pre-results drift"

JOBS, JOBS_LOCK, RUN_LOCK = {}, threading.Lock(), threading.Lock()

WEIGHTS = {
    "timing": 0.10, "rel_strength": 0.22, "acceleration": 0.12, "participation": 0.16,
    "history": 0.12, "fundamentals": 0.14, "catalysts": 0.08, "liquidity": 0.06,
}


# ── small utils ────────────────────────────────────────────────────────────
def _clip01(x):
    return float(min(max(x, 0.0), 1.0))


def _f(x):
    try:
        x = float(x)
        return None if math.isnan(x) or math.isinf(x) else x
    except (TypeError, ValueError):
        return None


def _pct(x, d=1):
    return "–" if x is None else f"{x * 100:+.{d}f}%"


def _ret(c, k, end=-1):
    """Return over k sessions ending at position `end` (negative index)."""
    n = len(c)
    i1, i0 = n + end, n + end - k
    if i0 < 0 or i1 >= n:
        return None
    return float(c.iloc[i1] / c.iloc[i0] - 1)


def _set(job_id, **kw):
    if job_id is None:
        return
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(kw)


# ── 1. event calendar ──────────────────────────────────────────────────────
def build_calendar(days_ahead=30, include_nse=True, include_upload=True):
    """Upcoming results, one row per ISIN (earliest future date). Each row notes its sources."""
    today = md.today_ist()
    horizon = today + timedelta(days=days_ahead)
    by_isin, notes = {}, []

    def add(isin, **row):
        if row.get("company"):
            row["company"] = re.sub(r"[\s-]*\$+\s*$", "", str(row["company"])).strip()  # BSE "Ltd-$" suffix
        d = date.fromisoformat(row["result_date"])
        if not isin or d < today or d > horizon:
            return
        cur = by_isin.get(isin)
        if cur is None:
            by_isin[isin] = {**row, "isin": isin, "calendar_sources": [row.pop("_src")]}
            return
        src = row.pop("_src")
        if src not in cur["calendar_sources"]:
            cur["calendar_sources"].append(src)
        if d < date.fromisoformat(cur["result_date"]):
            cur["result_date"] = row["result_date"]
        for k, v in row.items():  # fill gaps (industry, BSE code, symbol) from the other source
            if cur.get(k) in (None, "") and v not in (None, ""):
                cur[k] = v

    if include_upload:
        raw = earnings.read_run("latest", "json")
        if raw:
            try:
                for r in json.loads(raw)["rows"]:
                    add(r.get("isin"), _src="upload", symbol=r.get("nse_symbol"), company=r.get("company"),
                        bse_code=r.get("bse_code"), industry=r.get("board_meeting_industry"),
                        result_date=str(r.get("result_date"))[:10])
            except Exception as e:
                notes.append(f"uploaded calendar unreadable: {e}")
        else:
            notes.append("no uploaded board-meeting file (Earnings tab)")
    if include_nse:
        nse_rows = md.nse_upcoming_results(days_ahead=max(days_ahead, 45))
        if not nse_rows:
            notes.append("NSE board-meeting calendar unavailable — using uploaded file only")
        for r in nse_rows:
            add(r.get("isin"), _src="nse", symbol=r.get("symbol"), company=r.get("company"), bse_code=None,
                industry=r.get("industry"), result_date=r["result_date"])
    return list(by_isin.values()), notes


# ── 2. price / volume features ─────────────────────────────────────────────
def _rsi(c, n=14):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up.iloc[-1] / dn.iloc[-1] if dn.iloc[-1] else np.inf
    return float(100 - 100 / (1 + rs))


def price_features(df, mkt=None, sec=None):
    """Momentum, relative strength, participation and risk features from daily candles."""
    c, v = df["c"], df["v"]
    n = len(c)
    if n < 60:
        return {"history_days": n}
    sig_d = float(np.log(c).diff().tail(60).std()) or None
    f = {"history_days": n, "last_close": float(c.iloc[-1]), "last_candle_date": c.index[-1].strftime("%Y-%m-%d"),
         "sigma_daily": sig_d, "vol_ann": sig_d * math.sqrt(250) if sig_d else None}
    for k in (5, 10, 20, 60):
        f[f"ret_{k}d"] = _ret(c, k)
    f["ret_prev5d"] = _ret(c, 5, end=-6)              # the 5 sessions before the last 5
    f["accel"] = (f["ret_5d"] - f["ret_prev5d"]) if f["ret_prev5d"] is not None else None

    def rel(bench, tag):
        if bench is None or len(bench) < 30:
            return
        b = bench["c"].reindex(c.index).ffill()
        for k in (5, 10, 20):
            br = _ret(b.dropna(), k) if b.notna().sum() > k else None
            f[f"rel_{tag}_{k}d"] = (f[f"ret_{k}d"] - br) if (br is not None and f[f"ret_{k}d"] is not None) else None

    rel(mkt, "mkt")
    rel(sec, "sec")

    base_v = v.iloc[-55:-5].mean() if n >= 60 else None
    f["rvol_5d"] = float(v.tail(5).mean() / base_v) if base_v else None
    f["rvol_1d"] = float(v.iloc[-1] / v.iloc[-21:-1].mean()) if v.iloc[-21:-1].mean() else None
    up_days = (c.diff().tail(10) > 0)
    vol10 = v.tail(10)
    f["updown_vol_ratio"] = float(vol10[up_days].sum() / vol10[~up_days].sum()) if vol10[~up_days].sum() else None
    f["adv20_cr"] = float((c * v).tail(20).mean() / 1e7)
    f["atr_pct"] = float(((df["h"] - df["l"]) / c).tail(14).mean())
    f["pct_of_52w_high"] = float(c.iloc[-1] / df["h"].tail(250).max())
    f["rsi14"] = _rsi(c)
    f["above_20dma"] = bool(c.iloc[-1] > c.tail(20).mean())
    f["above_50dma"] = bool(c.iloc[-1] > c.tail(50).mean())
    if sig_d:
        f["z_20d"] = f["ret_20d"] / (sig_d * math.sqrt(20)) if f["ret_20d"] is not None else None
        f["z_5d"] = f["ret_5d"] / (sig_d * math.sqrt(5)) if f["ret_5d"] is not None else None
    return f


# ── 3. behaviour around past results ───────────────────────────────────────
def results_history(df, past_dates, mkt=None, window=PRE_WINDOW):
    """Per past result: drift in the `window` sessions before, the gap and 2-day reaction after.

    The result date is the board-meeting date. Companies report during or after market hours,
    so the gap is measured from that day's close to the next session's open, and the 2-day
    reaction from the close before the meeting to the close after it, which covers both cases.
    """
    if df is None or not past_dates:
        return {}
    c, o = df["c"], df["o"]
    idx = c.index
    mc = mkt["c"].reindex(idx).ffill() if mkt is not None else None
    events = []
    for d in past_dates:
        pos = idx.searchsorted(pd.Timestamp(d))      # first session on/after the meeting date
        if pos - window - 1 < 0 or pos + 1 >= len(idx):
            continue
        pre = c.iloc[pos - 1] / c.iloc[pos - 1 - window] - 1
        mk = (mc.iloc[pos - 1] / mc.iloc[pos - 1 - window] - 1) if mc is not None else None
        gap = o.iloc[pos + 1] / c.iloc[pos] - 1
        react = c.iloc[pos + 1] / c.iloc[pos - 1] - 1
        events.append({"date": d.isoformat(), "pre_ret": float(pre),
                       "pre_excess": float(pre - mk) if mk is not None and not pd.isna(mk) else None,
                       "gap": float(gap), "reaction_2d": float(react)})
    if not events:
        return {}
    ex = [e["pre_excess"] if e["pre_excess"] is not None else e["pre_ret"] for e in events]
    n = len(events)
    return {
        "hist_events": n,
        "hist_pre_excess_mean": float(np.mean(ex)),
        "hist_pre_excess_median": float(np.median(ex)),
        "hist_pre_hit_rate": float(np.mean([x > 0 for x in ex])),
        "hist_gap_mean": float(np.mean([e["gap"] for e in events])),
        "hist_gap_abs_mean": float(np.mean([abs(e["gap"]) for e in events])),
        "hist_reaction_mean": float(np.mean([e["reaction_2d"] for e in events])),
        "hist_reaction_abs_mean": float(np.mean([abs(e["reaction_2d"]) for e in events])),
        "hist_reaction_pos_rate": float(np.mean([e["reaction_2d"] > 0 for e in events])),
        "hist_detail": events[:8],
    }


# ── 4. scoring ─────────────────────────────────────────────────────────────
def _timing(td):
    if td is None:
        return None
    if td < 2:
        return 0.1
    if td < 5:
        return 0.5
    if td <= 15:
        return 1.0
    if td <= 25:
        return 0.7
    return 0.4


def score(r):
    """Fill r with component scores, extension penalty, final score, stage, reasons and risks."""
    sig = _f(r.get("sigma_daily"))
    comp = {}
    comp["timing"] = _timing(r.get("trading_days_left"))

    tag = "sec" if r.get("rel_sec_5d") is not None else "mkt"
    r5, r10, r20 = (_f(r.get(f"rel_{tag}_{k}d")) for k in (5, 10, 20))
    rs_z = None
    if sig and r5 is not None and r10 is not None:
        rs = 0.5 * r5 + 0.3 * r10 + 0.2 * (r20 if r20 is not None else r10)
        rs_z = rs / (sig * math.sqrt(10))
        comp["rel_strength"] = _clip01((rs_z + 0.25) / 1.5)
    r["rs_z"] = rs_z

    acc = _f(r.get("accel"))
    accel_z = acc / (sig * math.sqrt(10)) if (acc is not None and sig) else None
    if accel_z is not None:
        comp["acceleration"] = _clip01((accel_z + 0.5) / 2.0)
    r["accel_z"] = accel_z

    rv = _f(r.get("rvol_5d"))
    parts = []
    if rv is not None:
        vs = _clip01((rv - 0.9) / 0.8)
        if rv > 4:
            vs = 0.5  # climactic volume is more often an exhaustion than a start
        udr = _f(r.get("updown_vol_ratio"))
        if udr is not None:
            vs = 0.75 * vs + 0.25 * _clip01((udr - 0.8) / 1.2)
        parts.append((0.6, vs))
    dchg, dq = _f(r.get("deliv_pct_change")), _f(r.get("deliv_qty_ratio"))
    if dq is not None:
        # Delivered quantity captures accumulation; delivery % alone falls whenever volume spikes.
        ds = 0.7 * _clip01((dq - 0.9) / 0.8) + (0.3 * _clip01(0.5 + dchg / 20.0) if dchg is not None else 0.15)
        parts.append((0.4, ds))
    if parts:
        comp["participation"] = sum(w * x for w, x in parts) / sum(w for w, _ in parts)

    n = r.get("hist_events") or 0
    if n >= 2:
        shrink = n / (n + 4)                          # few events → pull toward neutral
        drift = _f(r.get("hist_pre_excess_mean")) or 0.0
        hit = ((r.get("hist_pre_hit_rate") or 0) * n + 2) / (n + 4)
        comp["history"] = 0.5 * _clip01(0.5 + shrink * drift / 0.06) + 0.5 * hit

    fs = _f(r.get("fund_score"))
    if fs is not None:
        comp["fundamentals"] = fs / 100
    cs = _f(r.get("catalyst_score"))
    if cs is not None:
        comp["catalysts"] = _clip01(0.5 + 0.5 * cs)
    adv = _f(r.get("adv20_cr"))
    if adv is not None:
        liq = _clip01((math.log10(max(adv, 0.1)) - 0.3) / 1.7)   # ₹2cr → 0, ₹100cr → 1
        va = _f(r.get("vol_ann"))
        if va is not None and va > 0.6:
            liq *= max(0.4, 1 - (va - 0.6))
        comp["liquidity"] = liq

    have = {k: v for k, v in comp.items() if v is not None}
    if not have or "rel_strength" not in have:
        r.update(components={k: (None if v is None else round(v, 3)) for k, v in comp.items()},
                 score=None, stage="No data", extension=None)
        r["reasons"], r["risks"] = [], ["not enough price history to score"]
        return r
    base = sum(WEIGHTS[k] * v for k, v in have.items()) / sum(WEIGHTS[k] for k in have)

    # "Already rallied" penalty: the whole point is to be early.
    z20, rsi = _f(r.get("z_20d")), _f(r.get("rsi14"))
    ext = 0.0
    if z20 is not None:
        ext = max(ext, _clip01((z20 - 1.5) / 1.5))
    if rsi is not None:
        ext = max(ext, _clip01((rsi - 70) / 15))
    gate = 1.0
    if adv is not None and adv < 2:
        gate = 0.6
    td = r.get("trading_days_left")
    if td is not None and td < 2:
        gate *= 0.5   # a setup that needs to happen tomorrow is not "early"
    elif td is not None and td < 4:
        gate *= 0.85
    final = 100 * base * (1 - 0.45 * ext) * gate
    r.update(components={k: (None if v is None else round(v, 3)) for k, v in comp.items()},
             extension=round(ext, 2), score=round(final, 1))

    if td is not None and td < 2:
        stage = "Too close"
    elif ext >= 0.5:
        stage = "Extended"
    elif rs_z is not None and rs_z < 0:
        stage = "Weak"
    elif rs_z is not None and rs_z > 1.0:
        stage = "Building"
    elif (accel_z or 0) > 0 or (rv or 0) >= 1.2 or (dq or 0) >= 1.2:
        stage = "Early"
    else:
        stage = "Neutral"
    r["stage"] = stage
    r["reasons"], r["risks"] = explain(r, tag)
    return r


def explain(r, tag):
    reasons, risks = [], []
    td, rd = r.get("trading_days_left"), r.get("result_date")
    bench = r.get("sector_index") if tag == "sec" else md.MARKET_INDEX
    if td is not None:
        when = f"Results on {rd} ({td} trading day{'s' if td != 1 else ''} away)"
        if 5 <= td <= 15:
            reasons.append(when + " — inside the 5–15 session pre-results window")
        elif td < 5:
            risks.append(when + " — little time left for a pre-results move")
        else:
            reasons.append(when)
    r5, r10 = r.get(f"rel_{tag}_5d"), r.get(f"rel_{tag}_10d")
    if r5 is not None and r10 is not None:
        if r5 > 0 and r10 > 0:
            reasons.append(f"Outperforming {bench}: {_pct(r5)} over 5 sessions, {_pct(r10)} over 10")
        elif r5 > 0 >= r10:
            reasons.append(f"Turning up vs {bench}: {_pct(r5)} over 5 sessions after lagging over 10 ({_pct(r10)})")
        elif r5 <= 0 and r10 <= 0:
            risks.append(f"Lagging {bench}: {_pct(r5)} over 5 sessions, {_pct(r10)} over 10")
    if tag == "mkt" and r.get("rel_mkt_5d") is not None:
        risks.append("No sector index mapped — relative strength is vs Nifty 500 only")
    acc, prev = r.get("accel"), r.get("ret_prev5d")
    if acc is not None and acc > 0.01:
        reasons.append(f"Momentum accelerating: last 5 sessions {_pct(r.get('ret_5d'))} vs {_pct(prev)} the 5 before")
    elif acc is not None and acc < -0.03:
        risks.append(f"Momentum fading: last 5 sessions {_pct(r.get('ret_5d'))} vs {_pct(prev)} the 5 before")
    rv = r.get("rvol_5d")
    if rv is not None and rv >= 1.2:
        s = f"Volume {rv:.1f}× its 50-day average"
        if r.get("updown_vol_ratio") and r["updown_vol_ratio"] > 1.2:
            s += f", heavier on up days ({r['updown_vol_ratio']:.1f}×)"
        (risks if rv > 4 else reasons).append(s + (" — climactic, could be exhaustion" if rv > 4 else ""))
    dp, db, dq = r.get("deliv_pct_5d"), r.get("deliv_pct_base"), r.get("deliv_qty_ratio")
    if dq is not None:
        pct_txt = f"; {dp:.0f}% of volume delivered vs {db:.0f}% before" if dp is not None and db is not None else ""
        if dq >= 1.2:
            reasons.append(f"Delivered shares {dq:.1f}× the prior 20 sessions{pct_txt}")
        elif dq < 0.85 and dp is not None and db is not None and dp < db - 3:
            risks.append(f"Delivery drying up: delivered shares {dq:.1f}× usual{pct_txt}")
    n = r.get("hist_events") or 0
    if n >= 2:
        m, hr = r.get("hist_pre_excess_mean"), r.get("hist_pre_hit_rate")
        s = (f"Past {n} results: avg {_pct(m)} vs market in the {PRE_WINDOW} sessions before, "
             f"positive {round(hr * n)}/{n} times")
        (reasons if m > 0.005 and hr >= 0.5 else risks if m < -0.01 else reasons).append(s)
        ga = r.get("hist_gap_abs_mean")
        if ga is not None:
            s = f"Post-result gap avg {_pct(r.get('hist_gap_mean'))} (typical size {ga * 100:.1f}%)"
            (risks if ga > 0.05 else reasons).append(s + (" — large binary event risk" if ga > 0.05 else ""))
    elif r.get("enriched"):
        risks.append("Fewer than 2 past results in price history — no pattern to lean on")
    fs = r.get("fund_score")
    if fs is not None:
        bits = []
        for k, lab in (("Return on capital employed", "ROCE"), ("YOY Quarterly profit growth", "profit YoY"),
                       ("YOY Quarterly sales growth", "sales YoY")):
            v = _f(r.get(k))
            if v is not None:
                bits.append(f"{lab} {v:.0f}%")
        s = f"Fundamentals score {fs:.0f}" + (f" ({', '.join(bits)})" if bits else "")
        (reasons if fs >= 55 else risks).append(s)
    elif r.get("fund_source") == "none":
        risks.append("No fundamentals on file — add a fundamentals CSV")
    for ev in (r.get("catalyst_top") or [])[:2]:
        s = f"Filing: {ev['event_label']}"
        if ev.get("order_value_cr"):
            s += f" ₹{ev['order_value_cr']:,.0f} cr"
            if ev.get("order_pct_revenue"):
                s += f" ({ev['order_pct_revenue']:.0f}% of revenue)"
        desc = (ev.get("text") or ev.get("title") or "").replace(f"{r.get('company') or ''} has informed the Exchange", "").strip()
        s += f" — {desc[:100]}"
        (reasons if ev["impact"] > 0 else risks).append(s)
    z20 = r.get("z_20d")
    if z20 is not None and z20 > 1.5:
        risks.append(f"Already up {_pct(r.get('ret_20d'))} in 20 sessions ({z20:.1f}σ) — may be priced in")
    if r.get("rsi14") and r["rsi14"] >= 72:
        risks.append(f"RSI {r['rsi14']:.0f}: overbought")
    adv = r.get("adv20_cr")
    if adv is not None and adv < 5:
        risks.append(f"Thin liquidity: ₹{adv:.1f} cr/day traded")
    va = r.get("vol_ann")
    if va is not None and va > 0.6:
        risks.append(f"High volatility: {va * 100:.0f}% annualised")
    return reasons, risks


# ── 5. pipeline ────────────────────────────────────────────────────────────
def _profile(master_by_isin, isin):
    f = master_by_isin.get(isin)
    if f is None:
        return {"fund_source": "none"}
    keep = earnings.FUND_COLS
    out = {k: earnings._clean(f.get(k)) for k in keep}
    out["fund_source"] = "master"
    sales_q = _f(f.get("Sales latest quarter"))
    out["annual_revenue_cr"] = sales_q * 4 if sales_q else None   # run-rate approximation
    out["market_cap_cr"] = _f(f.get("Market Capitalization"))
    return out


def scan(job_id=None, days_ahead=30, top_k=60, min_trading_days=1):
    t0 = time.time()
    _set(job_id, stage="building event calendar")
    cal, notes = build_calendar(days_ahead)
    today = md.today_ist()
    master = earnings.load_master()
    by_isin = {r["ISIN Code"]: r for _, r in master.iterrows() if pd.notna(r.get("ISIN Code"))}
    try:
        instr = md.load_instruments()
    except Exception:
        instr = {"nse": {}, "bse": {}}
        notes.append("instrument master unavailable — symbols may be missing")

    rows = []
    for e in cal:
        rd = date.fromisoformat(e["result_date"])
        td = md.trading_days_between(today, rd)
        if td < min_trading_days:
            continue
        sym = e.get("symbol") or instr["nse"].get(e["isin"])
        prof = _profile(by_isin, e["isin"])
        rows.append({**e, "symbol": sym, "trading_days_left": td, "days_left": (rd - today).days, **prof,
                     "sector_index": md.sector_index_for(e.get("industry"), prof.get("Industry Group"),
                                                          prof.get("Industry"))})
    if not rows:
        raise RuntimeError("No upcoming results found. Upload a board-meeting CSV on the Earnings tab "
                           "or check that nseindia.com is reachable. " + "; ".join(notes))

    _set(job_id, stage="benchmarks")
    mkt = md.index_candles(md.MARKET_INDEX, HISTORY_DAYS)
    if mkt is None:
        notes.append("Nifty 500 candles unavailable — market-relative fields are blank")
    sectors = {}
    for name in {r["sector_index"] for r in rows if r["sector_index"]}:
        sectors[name] = md.index_candles(name, HISTORY_DAYS)

    _set(job_id, stage="delivery data (NSE bhavcopy)", done=0, total=25)
    try:
        deliv = md.delivery_history(25, progress=lambda d, t: _set(job_id, done=d, total=t))
    except Exception as e:
        deliv = {}
        notes.append(f"delivery data unavailable: {e}")
    if len(deliv) < 10:
        notes.append(f"only {len(deliv)} sessions of delivery data — delivery trend skipped")
        deliv = {}

    # Stage 1: price features for everyone
    _set(job_id, stage="prices (Upstox)", done=0, total=len(rows))
    candles = {}

    def px(r):
        df, seg = md.equity_candles(r["isin"], days=HISTORY_DAYS)
        return r, df, seg

    with ThreadPoolExecutor(4) as ex:
        for k, (r, df, seg) in enumerate(ex.map(px, rows), 1):
            if df is not None and len(df) >= 60:
                candles[r["isin"]] = df
                r["price_segment"] = seg
                r.update(price_features(df, mkt, sectors.get(r["sector_index"])))
            else:
                r["history_days"] = 0 if df is None else len(df)
            if deliv and r.get("symbol"):
                r.update(md.delivery_features(r["symbol"], deliv))
            r["fund_score"] = earnings.fundamental_score({**r, "adv20_cr": None}, include_liquidity=False) \
                if r["fund_source"] != "none" else None
            score(r)
            _set(job_id, done=k)

    # Stage 2: enrich the most promising names (NSE calls are slow and rate-limited)
    cands = sorted((r for r in rows if r.get("score") is not None), key=lambda r: -r["score"])[:top_k]
    _set(job_id, stage="results history + filings", done=0, total=len(cands))
    for k, r in enumerate(cands, 1):
        df = candles.get(r["isin"])
        try:
            past = md.nse_past_result_dates(r["symbol"]) if r.get("symbol") else []
            r.update(results_history(df, past, mkt))
        except Exception as e:
            r.setdefault("enrich_errors", []).append(f"history: {e}")
        try:
            raw = md.nse_announcements(r["symbol"], days=30) if r.get("symbol") \
                else md.bse_announcements(r.get("bse_code"), days=30)
            items = catalysts.analyse(raw, r.get("company") or "", r.get("annual_revenue_cr"),
                                      r.get("market_cap_cr"), df)
            summ = catalysts.summarise(items)
            r["catalyst_score"] = summ["net_score"]
            r["catalyst_counts"] = summ["event_counts"]
            r["catalyst_top"] = summ["top_events"]
            r["filings_30d"] = sum(1 for i in items if i["event_type"] != "routine")
        except Exception as e:
            r.setdefault("enrich_errors", []).append(f"filings: {e}")
        r["enriched"] = True
        score(r)
        _set(job_id, done=k)

    rows.sort(key=lambda r: (r.get("score") is None, -(r.get("score") or 0)))
    for i, r in enumerate(rows, 1):
        r["rank"] = i if r.get("score") is not None else None

    clean = rows
    stages = {}
    for r in rows:
        stages[r.get("stage")] = stages.get(r.get("stage"), 0) + 1
    mf = price_features(mkt) if mkt is not None and len(mkt) >= 60 else {}
    summary = {
        "upcoming": len(rows), "scored": sum(r.get("score") is not None for r in rows),
        "enriched": len(cands), "with_fundamentals": sum(r["fund_source"] != "none" for r in rows),
        "with_delivery": sum(r.get("deliv_pct_5d") is not None for r in rows),
        "with_sector_index": sum(bool(r.get("sector_index")) for r in rows),
        "calendar_sources": sorted({s for r in rows for s in r.get("calendar_sources", [])}),
        "stages": stages, "market": {"index": md.MARKET_INDEX, "ret_5d": mf.get("ret_5d"), "ret_20d": mf.get("ret_20d"),
                                     "above_50dma": mf.get("above_50dma")},
        "notes": notes, "seconds": round(time.time() - t0, 1), "days_ahead": days_ahead,
    }
    return deep_clean({"generated_at": datetime.now(md.IST).isoformat(timespec="seconds"),
                       "summary": summary, "rows": clean})


def deep_clean(o):
    """Recursively make a structure strict-JSON safe (no NaN/inf, no numpy scalars)."""
    if isinstance(o, dict):
        return {str(k): deep_clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [deep_clean(v) for v in o]
    return earnings._clean(o)


def _run(job_id, **kw):
    try:
        payload = scan(job_id, **kw)
        with RUN_LOCK:
            run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
            while (OUT_DIR / run_id).exists():
                time.sleep(1)
                run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
            payload["run_id"] = run_id
            save(run_id, payload)
        _set(job_id, status="done", stage="done", run_id=run_id, summary=payload["summary"])
    except Exception as e:
        traceback.print_exc()
        _set(job_id, status="error", error=f"{type(e).__name__}: {e}")


def _atomic(path, text):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def save(run_id, payload):
    d = OUT_DIR / run_id
    d.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, default=str, allow_nan=False)
    flat = pd.DataFrame([{k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in r.items()}
                         for r in payload["rows"]])
    _atomic(d / "results.json", body)
    _atomic(d / "results.csv", flat.to_csv(index=False))
    _atomic(OUT_DIR / "latest.json", body)
    _atomic(OUT_DIR / "latest.csv", flat.to_csv(index=False))
    runs = sorted(p for p in OUT_DIR.iterdir() if p.is_dir() and re.fullmatch(r"\d{8}_\d{6}", p.name))
    for old in runs[:-KEEP_RUNS]:
        shutil.rmtree(old, ignore_errors=True)


def start(days_ahead=30, top_k=60):
    with JOBS_LOCK:
        running = [j for j in JOBS.values() if j["status"] == "running"]
        if running:
            return running[0]["id"]  # one scan at a time: NSE throttles parallel scrapers
        cutoff = time.time() - 3600
        for k in [k for k, j in JOBS.items() if j["started"] < cutoff]:
            JOBS.pop(k, None)
        job_id = uuid.uuid4().hex[:8]
        JOBS[job_id] = {"id": job_id, "status": "running", "stage": "queued", "done": 0, "total": 0,
                        "started": time.time()}
    threading.Thread(target=_run, args=(job_id,), kwargs={"days_ahead": days_ahead, "top_k": top_k},
                     daemon=True).start()
    return job_id


def get_job(job_id):
    with JOBS_LOCK:
        return dict(JOBS.get(job_id) or {})


def active_job():
    """The scan in progress, if any — lets a page reattach after navigation or reload."""
    with JOBS_LOCK:
        running = [j for j in JOBS.values() if j["status"] == "running"]
        return dict(running[0]) if running else None


def list_runs():
    if not OUT_DIR.exists():
        return []
    out = []
    for d in sorted((p for p in OUT_DIR.iterdir() if p.is_dir() and re.fullmatch(r"\d{8}_\d{6}", p.name)),
                    reverse=True):
        try:
            j = json.loads((d / "results.json").read_text())
            out.append({"run_id": d.name, "generated_at": j["generated_at"], "rows": len(j["rows"])})
        except Exception:
            pass
    return out


def read_run(run_id="latest", fmt="json"):
    if fmt not in ("json", "csv"):
        return None
    if run_id != "latest" and not re.fullmatch(r"\d{8}_\d{6}", run_id or ""):
        return None
    p = (OUT_DIR / f"latest.{fmt}") if run_id == "latest" else (OUT_DIR / run_id / f"results.{fmt}")
    return p.read_bytes() if p.exists() else None

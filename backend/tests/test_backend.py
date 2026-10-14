"""Offline tests for the backend (no network). Run from backend/:  python3 -m unittest discover tests"""
import json
import math
import sys
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import catalysts  # noqa: E402
import earnings  # noqa: E402
import market_data as md  # noqa: E402
import premomentum as pm  # noqa: E402
from market_data import IST  # noqa: E402


def candles(closes, vols=None, start="2025-01-01"):
    idx = pd.bdate_range(start, periods=len(closes))
    c = pd.Series(closes, index=idx, dtype=float)
    v = pd.Series(vols if vols is not None else [1e5] * len(closes), index=idx, dtype=float)
    return pd.DataFrame({"o": c.shift(1).fillna(c), "h": c * 1.01, "l": c * 0.99, "c": c, "v": v})


class MarketDataTests(unittest.TestCase):
    def test_candle_dates_stay_on_exchange_date(self):
        # Upstox stamps bars at IST midnight; converting via UTC used to shift them a day back.
        df = md._parse_candles([["2026-10-13T00:00:00+05:30", 1, 2, 0.5, 1.5, 100, 0],
                                ["2026-10-12T00:00:00+05:30", 1, 2, 0.5, 1.4, 100, 0]])
        self.assertEqual(list(df.index.strftime("%Y-%m-%d")), ["2026-10-12", "2026-10-13"])

    def test_trading_days_skip_holidays(self):
        with mock.patch.object(md, "_holidays", {date(2026, 10, 20)}):
            # 14,15,16,19,21 Oct: the Dussehra holiday on the 20th is not a session
            self.assertEqual(md.trading_days_between(date(2026, 10, 14), date(2026, 10, 22)), 5)
            self.assertEqual(md.trading_days_between(date(2026, 10, 22), date(2026, 10, 14)), 0)

    def test_sector_index_mapping(self):
        self.assertEqual(md.sector_index_for("Financial Services"), "Nifty Fin Service")
        self.assertEqual(md.sector_index_for("Oil  Gas & Consumable Fuels"), "Nifty Energy")
        self.assertEqual(md.sector_index_for(None, "Pharmaceuticals & Biotechnology"), "Nifty Pharma")
        self.assertIsNone(md.sector_index_for(None, ""))

    def test_delivery_features(self):
        days = [date(2026, 9, 1) + timedelta(days=i) for i in range(20)]
        hist = {d: {"ABC": [1000 if i < 15 else 2000, 2000, 50.0 if i < 15 else 60.0]} for i, d in enumerate(days)}
        f = md.delivery_features("ABC", hist)
        self.assertAlmostEqual(f["deliv_pct_change"], 10.0)
        self.assertAlmostEqual(f["deliv_qty_ratio"], 2.0)
        self.assertEqual(md.delivery_features("XYZ", hist), {})


class CatalystTests(unittest.TestCase):
    def test_classification(self):
        cases = {
            "L&T wins order worth ₹2,500 crore from NHAI": "order_win",
            "Termination of contract by MSRDC": "order_cancellation",
            "Infosys raises FY27 revenue guidance": "guidance_change",
            "TCS Q2 net profit rises 9%": "earnings",
            "Company receives USFDA warning letter": "regulatory_action",
            "Promoter sells 2% stake via block deal": "promoter_sell",
            "Creation of pledge on promoter shares": "pledge_created",
            "Release of pledge by promoter": "pledge_released",
            "Board approves QIP of up to Rs 500 crore": "fund_raising",
            "CFO resigns citing personal reasons": "management_change",
            "Closure of Trading Window": "routine",
            "Commissioning of new plant at Dahej": "capacity_expansion",
            "Navin Fluorine fine chemicals demand strong": "other",   # "fine" is not a penalty
        }
        for text, want in cases.items():
            self.assertEqual(catalysts.classify(text)[0], want, text)

    def test_real_world_headlines(self):
        cases = {
            "Dr Reddys Laboratories Ltd up for third straight session": "price_commentary",
            "Dr. Reddy's Laboratories Share Price Falls: Price, Valuation": "price_commentary",
            "Dr. Reddy's shares upgraded by Citi after three years, target raised; Stock gains": "analyst_rating",
            "Dr Reddy's shares rise 2% after exclusive Qdenga distribution deal with Takeda": "partnership",
            "Arrangements for strategic, technical, manufacturing, or marketing tie up": "partnership",
            "News Verification. The Exchange has sought clarification on news item X gets licence": "clarification",
            "ICRA upgrades credit rating of company to AA": "credit_rating",
            "Dr Reddy's Laboratories stock gains as Q1 profit falls": "earnings",
        }
        for text, want in cases.items():
            self.assertEqual(catalysts.classify(text)[0], want, text)

    def test_publisher_suffix_is_not_classified(self):
        # "- NDTV Profit" used to trigger the earnings rule
        out = catalysts.analyse([{"title": "Acme Stock Surges Over 2%; Outperforms Peers - NDTV Profit",
                                  "source": "NDTV Profit", "hours_ago": 3}])
        self.assertEqual(out[0]["event_type"], "price_commentary")
        self.assertEqual(out[0]["impact"], 0)

    def test_small_penalty_and_one_story_from_many_sources(self):
        now = datetime(2026, 10, 14, 12, tzinfo=IST)
        items = [
            {"title": "Action(s) taken or orders passed", "source": "NSE filing", "source_type": "exchange",
             "text": "Acme Ltd has informed the Exchange about imposition of penalty to Acme Inc, a subsidiary.",
             "time": (now - timedelta(days=3)).isoformat()},
            {"title": "Acme subsidiary receives $32,350 IRS penalty for tax error - scanx.trade", "source": "scanx.trade",
             "time": (now - timedelta(days=3, hours=-5)).isoformat()},
        ]
        out = sorted(catalysts.analyse(items, "Acme", now=now), key=lambda i: i["time"])
        self.assertTrue(all(i["event_type"] == "regulatory_action" for i in out))
        self.assertEqual(out[0]["novelty"], 1.0)
        self.assertLess(out[1]["novelty"], 0.5)           # same story as the filing
        self.assertEqual(out[1]["materiality_label"], "low")  # $32k is immaterial
        self.assertAlmostEqual(out[1]["amount_cr"], 32350 * catalysts.USDINR / 1e7, places=4)
        self.assertEqual(catalysts.extract_amounts_cr("shares at ₹1,215"), [])  # bare prices ignored by default
        filing = next(i for i in out if i.get("source_type") == "exchange")
        self.assertEqual(filing["materiality_label"], "low")  # size propagated from the linked article

    def test_order_value_ignores_running_totals(self):
        self.assertEqual(catalysts.order_value_cr(
            "KEC International wins Rs 1,030 crore orders, takes YTD intake beyond Rs 8,600 crore"), 1030.0)
        self.assertEqual(catalysts.order_value_cr("Order book at Rs 30,000 crore after new Rs 500 crore order"), 500.0)

    def test_tone_needs_whole_words(self):
        self.assertEqual(catalysts._tone("Updates on the company"), 0)  # "Up" inside "Updates"
        self.assertEqual(catalysts._tone("net profit rises 9%"), 1)
        self.assertEqual(catalysts._tone("profit falls on weak margins"), -1)

    def test_amounts(self):
        self.assertEqual(catalysts.extract_amounts_cr("order worth Rs 1,236 crore"), [1236.0])
        self.assertEqual(catalysts.extract_amounts_cr("₹1.2 lakh crore capex"), [120000.0])
        self.assertEqual(catalysts.extract_amounts_cr("₹50 lakh fine"), [0.5])
        self.assertAlmostEqual(catalysts.extract_amounts_cr("$120 million order")[0], 120 * catalysts.USDINR / 10)
        self.assertEqual(catalysts.extract_amounts_cr("bought 1.2 lakh shares"), [])
        self.assertEqual(catalysts.extract_amounts_cr("5 million tonnes capacity"), [])

    def test_order_details(self):
        d = catalysts.order_details(
            "Larsen & Toubro wins order from NHAI worth ₹2,500 crore to be executed over 30 months",
            annual_revenue_cr=10000, ref=datetime(2026, 10, 14, tzinfo=IST))
        self.assertEqual(d["order_value_cr"], 2500.0)
        self.assertEqual(d["execution_months"], 30.0)
        self.assertEqual(d["client"], "NHAI")
        self.assertEqual(d["order_pct_revenue"], 25.0)
        self.assertEqual(d["annualised_pct_revenue"], 10.0)

    def test_reliability(self):
        self.assertEqual(catalysts.source_reliability({"source_type": "exchange"})[1], "Exchange filing")
        self.assertEqual(catalysts.source_reliability({"source": "Reuters", "title": "X wins order"})[1], "Reputable media")
        self.assertEqual(catalysts.source_reliability({"source": "Reuters", "title": "X in talks to buy Y, sources said"})[1],
                         "Unverified report")
        self.assertEqual(catalysts.source_reliability({"source": "Some Blog", "title": "X wins order"})[1], "Media")

    def test_novelty_and_materiality(self):
        now = datetime(2026, 10, 14, 12, tzinfo=IST)
        items = [
            {"title": "KEC bags orders worth Rs 1,236 crore", "source": "Moneycontrol",
             "time": (now - timedelta(hours=30)).isoformat()},
            {"title": "KEC International bags new orders of ₹1,236 crore across businesses", "source": "Economic Times",
             "time": (now - timedelta(hours=5)).isoformat()},
            {"title": "Closure of Trading Window", "source_type": "exchange", "time": (now - timedelta(days=3)).isoformat()},
        ]
        out = catalysts.analyse(items, "KEC International", annual_revenue_cr=20000, now=now)
        orders = sorted([i for i in out if i["event_type"] == "order_win"], key=lambda i: i["time"])
        self.assertEqual(orders[0]["novelty"], 1.0)
        self.assertLess(orders[1]["novelty"], 0.5)          # repeat of yesterday's story
        self.assertAlmostEqual(orders[0]["order_pct_revenue"], 6.18, places=2)
        self.assertGreater(orders[0]["impact"], orders[1]["impact"])
        routine = [i for i in out if i["event_type"] == "routine"][0]
        self.assertEqual(routine["impact"], 0)
        s = catalysts.summarise(out, now=now)
        self.assertGreater(s["net_score"], 0)
        json.dumps(out, allow_nan=False)

    def test_price_reaction_flags_run_up(self):
        closes = [100.0] * 80 + [100 * 1.03 ** i for i in range(1, 7)]
        df = candles(closes)
        ts = datetime.combine(df.index[-1].date(), datetime.min.time(), IST).replace(hour=17)
        pr = catalysts.price_reaction(df, ts)
        self.assertGreater(pr["pre_move"], 0.1)


class ScannerTests(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        base = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 300)))
        self.mkt = candles(base)

    def test_price_features_relative(self):
        closes = list(self.mkt["c"].values * 1.0)
        closes[-5:] = [x * 1.08 for x in closes[-5:]]       # stock pops 8% vs market recently
        vols = [1e5] * 295 + [2.5e5] * 5
        f = pm.price_features(candles(closes, vols), self.mkt, None)
        self.assertAlmostEqual(f["rel_mkt_5d"], 0.08, places=2)   # same pop vs. the market over 5 and 10
        self.assertAlmostEqual(f["rel_mkt_10d"], 0.08, places=2)
        self.assertGreater(f["rvol_5d"], 2)
        self.assertIsNone(f.get("rel_sec_5d"))

    def test_score_prefers_early_over_extended(self):
        common = dict(trading_days_left=8, result_date="2026-10-27", sigma_daily=0.015, rvol_5d=1.5,
                      adv20_cr=50, vol_ann=0.3, rsi14=60, fund_source="none")
        early = pm.score({**common, "rel_mkt_5d": 0.03, "rel_mkt_10d": 0.02, "rel_mkt_20d": 0.01,
                          "accel": 0.03, "ret_5d": 0.03, "ret_prev5d": 0.0, "z_20d": 0.4})
        extended = pm.score({**common, "rel_mkt_5d": 0.06, "rel_mkt_10d": 0.12, "rel_mkt_20d": 0.25,
                             "accel": 0.0, "ret_5d": 0.06, "ret_prev5d": 0.06, "ret_20d": 0.28, "z_20d": 4.0,
                             "rsi14": 82})
        self.assertEqual(extended["stage"], "Extended")
        self.assertGreater(early["score"], extended["score"])
        self.assertTrue(any("priced in" in x for x in extended["risks"]))
        self.assertTrue(any("pre-results window" in x for x in early["reasons"]))

    def test_imminent_results_are_penalised(self):
        r = dict(result_date="2026-10-15", sigma_daily=0.015, rvol_5d=1.5, adv20_cr=50, rel_mkt_5d=0.03,
                 rel_mkt_10d=0.02, accel=0.02, ret_5d=0.03, ret_prev5d=0.01, fund_source="none")
        soon, later = pm.score({**r, "trading_days_left": 1}), pm.score({**r, "trading_days_left": 8})
        self.assertEqual(soon["stage"], "Too close")
        self.assertLess(soon["score"], later["score"] * 0.6)

    def test_score_without_prices(self):
        r = pm.score({"trading_days_left": 8, "fund_source": "none"})
        self.assertIsNone(r["score"])
        self.assertEqual(r["stage"], "No data")

    def test_results_history(self):
        df = candles(list(np.linspace(100, 200, 300)))
        past = [df.index[100].date(), df.index[200].date(), df.index[299].date()]  # last one has no T+1
        h = pm.results_history(df, past, None)
        self.assertEqual(h["hist_events"], 2)
        self.assertGreater(h["hist_pre_excess_mean"], 0)
        self.assertEqual(h["hist_pre_hit_rate"], 1.0)

    def test_deep_clean(self):
        out = pm.deep_clean({"a": float("nan"), "b": [np.float64(1.5), np.int64(2), np.bool_(True)], "c": {"d": math.inf}})
        self.assertEqual(json.loads(json.dumps(out, allow_nan=False)), {"a": None, "b": [1.5, 2, True], "c": {"d": None}})


class EarningsTests(unittest.TestCase):
    def test_parse_board_meetings_trailing_commas_and_formats(self):
        text = ("Security Code,Company name,Industry,Purpose,Meeting Date,Announcement Date\n"
                "500110,Chennai Petroleum,Oil,Quarterly Results,22 Oct 2026,09/10/2026,\n"
                "500670,GNFC,Chemicals,Quarterly Results,02/11/2026,09/10/2026,\n"
                "abc,Broken,,,,\n"
                "500110,Chennai Petroleum,Oil,Quarterly Results,22 Oct 2026,09/10/2026,\n")
        df, info = earnings.parse_board_meetings(text)
        self.assertEqual(sorted(df.bse_code.tolist()), [500110, 500670])
        self.assertEqual(df[df.bse_code == 500670].result_date.iloc[0], pd.Timestamp("2026-11-02"))
        self.assertEqual(info["rows_unparseable"], 1)
        self.assertEqual(info["duplicates_removed"], 1)

    def test_fundamental_score_handles_bad_values(self):
        self.assertIsNone(earnings.fundamental_score({"Price to Earning": "n/a"}))
        s = earnings.fundamental_score({"Return on capital employed": 30, "OPM": 20, "PEG Ratio": -1.2,
                                        "YOY Quarterly sales growth": 25})
        self.assertTrue(0 < s < 100)

    def test_clean(self):
        self.assertIsNone(earnings._clean(float("nan")))
        self.assertIs(earnings._clean(np.bool_(True)), True)
        self.assertIsNone(earnings._clean(pd.NA))


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import api
        cls.api = api
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), api.LiveAPIHandler)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def req(self, path, body=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        r = urllib.request.Request(self.base + path, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                return resp.status, json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def test_bad_json_is_400_not_crash(self):
        code, body = self.req("/api/earnings/upload", raw=b"{not json")
        self.assertEqual(code, 400)
        self.assertIn("invalid JSON", body["error"])

    def test_live_state_with_dataframe_cache(self):
        import state
        with state.state_lock:
            state.APP_STATE["yfinance_cache"] = pd.DataFrame({"a": [1.0, float("nan")]})
        code, body = self.req("/api/live-state")
        self.assertEqual(code, 200)
        self.assertNotIn("yfinance_cache", body)

    def test_unknown_routes_and_jobs(self):
        self.assertEqual(self.req("/api/nope")[0], 404)
        code, body = self.req("/api/premomentum/status?id=zzz")
        self.assertEqual((code, body["status"]), (404, "unknown"))
        self.assertEqual(self.req("/api/premomentum/results?run=../../etc")[0], 404)
        self.assertEqual(self.req("/api/premomentum/scan", {"days_ahead": "x"})[0], 400)

    def test_news_is_classified(self):
        fake = [{"title": "Acme bags ₹500 crore order from NTPC", "source": "Mint", "hours_ago": 2.0,
                 "link": "http://x", "category": "Last 24 Hours"}]
        with mock.patch.object(self.api, "fetch_news", return_value=fake):
            code, body = self.req("/api/news?q=Acme&ticker=ACME")
        self.assertEqual(code, 200)
        self.assertEqual(body[0]["event_type"], "order_win")
        self.assertEqual(body[0]["order_value_cr"], 500.0)
        self.assertEqual(body[0]["category"], "Last 24 Hours")

    def test_upstox_proxy_rejects_traversal(self):
        self.assertEqual(self.req("/upstox-api/../../secret")[0], 400)


if __name__ == "__main__":
    unittest.main()

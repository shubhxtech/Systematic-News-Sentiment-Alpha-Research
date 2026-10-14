"""Catalyst intelligence: turn filings and headlines into typed, scored events.

For each item we answer four questions instead of emitting a raw positive/negative score:
  * What happened?        event type + direction, with order details extracted where present
  * Is it new?            novelty — repeats of an earlier filing/article are discounted
  * Does it matter?       materiality — type prior scaled by size vs. revenue / market cap
  * Is it already priced? price reaction before and after the item, in volatility units
  * Can we trust it?      source reliability — exchange filing > company > media > rumour

Everything is rule-based and explainable: each scored item carries the reasons behind its numbers.
"""
import math
import re
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from market_data import IST

USDINR = 88.0  # approximate; only used to convert USD order values into ₹ crore

# ── event taxonomy ─────────────────────────────────────────────────────────
# (type, label, direction, base materiality, patterns). First match wins, so specific rules go first.
_R = lambda *p: [re.compile(x, re.I) for x in p]
RULES = [
    ("routine", "Routine filing", 0, 0.03, _R(
        r"trading window", r"newspaper (publication|advertisement)", r"certificate under (sebi|regulation)",
        r"loss of share certificate", r"duplicate share", r"transmission of shares", r"\bESOP\b|\bESOS\b",
        r"investor (meet|presentation|conference)|analysts?\s*/?\s*institutional investor meet|earnings call",
        r"record date", r"shareholders?\s*meeting|\bAGM\b|\bEGM\b|postal ballot|e-?voting",
        r"compliance certificate|reconciliation of share capital|statement of deviation",
        r"intimation of (board meeting|closure)", r"board meeting intimation")),
    ("clarification", "Exchange clarification", 0, 0.10, _R(
        r"news verification", r"clarification (sought|on|regarding)", r"spurt in (volume|price)", r"price movement")),
    ("analyst_rating", "Analyst rating change", 0, 0.30, _R(
        r"\b(upgrade[sd]?|downgrade[sd]?)\b(?![^.]{0,20}\bcredit)", r"initiates? coverage",
        r"(price )?target (price )?(raised|cut|hiked|lowered|revised)", r"\b(raises?|cuts?|hikes?|lowers?)\b[^.]{0,20}\btarget price",
        r"\b(buy|sell|hold|overweight|underweight|outperform|underperform|neutral) (rating|call)\b")),
    ("order_cancellation", "Order cancelled", -1, 0.60, _R(
        r"(order|contract|loa|letter of award|project)s?\b[^.]{0,60}\b(cancel\w*|terminat\w*|withdraw\w*|revok\w*|scrap\w*|foreclos\w*|short[- ]?clos\w*)",
        r"(cancel\w*|terminat\w*|revocation|foreclosure)\s+of\s+(the\s+)?(order|contract|loa|letter of award|project)")),
    ("order_win", "Order win", 1, 0.45, _R(
        r"\b(bag|bags|bagged|win|wins|won|secure[sd]?|securing|receive[sd]?|receipt of|award(ed|s)?|bags?)\b[^.]{0,80}\b(orders?|contracts?|projects?|loa|letter of (award|acceptance|intent)|purchase orders?|work orders?|mandates?)\b",
        r"\b(orders?|contracts?)\b[^.]{0,30}\b(worth|valued at|value of|aggregating|amounting)\b",
        r"\bL-?1\s+bidder\b", r"letter of (award|acceptance|intent)|\bLoA\b|\bLoI\b",
        r"new orders?\b", r"order (inflow|book)\b[^.]{0,40}\b(rise|rises|jump|grow|record|strong)")),
    ("guidance_change", "Guidance change", 0, 0.65, _R(
        r"\bguidance\b", r"\b(raises?|lifts?|ups|hikes?|cuts?|lowers?|trims?|revises?|reiterates?|maintains?)\b[^.]{0,30}\b(outlook|forecast|target|estimate)s?\b",
        r"\b(revenue|margin|growth|volume)\s+(outlook|target)\b")),
    ("partnership", "Partnership / licensing", 1, 0.35, _R(
        r"\btie[- ]?up\b", r"\bpartner(s|ship|ed|ing)?\b(?! (with|in) (the )?(us|our))", r"collaborat\w+", r"strategic alliance",
        r"\bMoU\b|memorandum of understanding", r"voluntary licen[cs]e|licen[cs]ing (deal|agreement|pact)|licen[cs]e agreement|in-licen[cs]",
        r"distribution (deal|agreement|pact|rights)|exclusive (deal|agreement|rights|distribution)")),
    ("earnings", "Earnings", 0, 0.55, _R(
        r"financial results?", r"\bresults? for the (quarter|half|year|period)", r"\bQ[1-4]\s*(FY)?\s*'?\d{0,4}\b",
        r"quarterly (results?|earnings|numbers)", r"\b(net )?profit\b|\bPAT\b|\bEBITDA\b|\bearnings\b",
        r"\brevenue\b[^.]{0,30}\b(rise|rises|jump|grow|fall|falls|decline|up|down)", r"outcome of board meeting")),
    ("capacity_expansion", "Capacity / capex", 1, 0.40, _R(
        r"capacity (expansion|addition|enhancement|increase)", r"\bcommission(ed|ing|s)?\b",
        r"(new|greenfield|brownfield) (plant|facility|unit|line|factory|capacity)",
        r"commercial (production|operations?)|\bCOD\b|start(s|ed)? (production|operations)",
        r"\bcapex\b", r"\bexpan(d|ds|sion)\b[^.]{0,40}\b(capacity|plant|facility|unit)")),
    ("regulatory_action", "Regulatory action", -1, 0.60, _R(
        r"show[- ]cause notice", r"\b(penalty|penalties|fined|penalised|penalized)\b", r"\b(raid|search|survey) (operation|by|at)\b",
        r"\b(income tax|GST|tax) (demand|notice|order)", r"\bdemand (order|notice)\b",
        r"warning letter|import alert|\bOAI\b|form 483|\b483 observations?|observations? from (the )?(us)?fda",
        r"\b(sebi|rbi|cci|nclt|ed|cbi)\b[^.]{0,40}\b(order|probe|investigat\w*|penalty|ban|bars?|restrain\w*|notice|action)",
        r"\b(debar\w*|suspend\w*|suspension|ban(s|ned)?)\b", r"insolvency|\bCIRP\b|winding up")),
    ("regulatory_approval", "Regulatory approval", 1, 0.45, _R(
        r"(us)?fda\b[^.]{0,40}\b(approval|nod|clearance|eir|no observations|zero observations|vai|nai)",
        r"\b(receives?|gets?|secures?|obtain(s|ed)?)\b[^.]{0,40}\b(approval|nod|licen[cs]e|clearance|registration)\b",
        r"establishment inspection report|\bEIR\b")),
    ("pledge_released", "Pledge released", 1, 0.40, _R(
        r"(release|revocation|revoke[sd]?)\s+of\s+(the\s+)?(pledge|encumbrance)", r"pledge(d)?\s+(shares\s+)?(released|revoked)")),
    ("pledge_created", "Pledge created / invoked", -1, 0.50, _R(
        r"(creation|invocation)\s+of\s+(the\s+)?(pledge|encumbrance)", r"pledge(s|d)?\b[^.]{0,30}\b(created|invoked|increase\w*)",
        r"\bencumbrance\b", r"\bpledg(e|es|ed|ing)\b")),
    ("promoter_buy", "Promoter buying", 1, 0.50, _R(
        r"promoters?\b[^.]{0,40}\b(buy|buys|bought|acquire[sd]?|purchase[sd]?|raise[sd]? stake|hike[sd]? stake|increase[sd]? stake|creeping)",
        r"(acquisition|purchase) of shares by (the )?promoter")),
    ("promoter_sell", "Promoter selling", -1, 0.50, _R(
        r"promoters?\b[^.]{0,40}\b(sell|sells|sold|offload\w*|divest\w*|trim\w*|cut[s]? stake|pare[sd]? stake|reduce[sd]? stake|block deal|offer for sale|\bOFS\b)",
        r"\bOFS\b|offer for sale")),
    ("fund_raising", "Fund raising", 0, 0.40, _R(
        r"\bQIP\b|qualified institutions? placement", r"preferential (issue|allotment)", r"rights issue",
        r"fund[- ]?rais\w*|rais(e|es|ed|ing) (up to )?(₹|rs\.?|inr|\$|funds|capital)", r"\bNCDs?\b|non-convertible debentures?",
        r"\bwarrants?\b", r"\bFCCBs?\b")),
    ("management_change", "Management change", 0, 0.30, _R(
        r"\bresign\w*\b", r"steps? down",
        r"\b(appoint\w*|cessation|re-?designat\w*|elevat\w*|names?|named)\b[^.]{0,50}\b(ceo|cfo|md|managing director|chairman|chief|director|kmp|auditor|company secretary)\b",
        r"\b(ceo|cfo|md|managing director|chairman|chief \w+ officer|director|kmp|auditor|company secretary)\b[^.]{0,30}\b(appoint\w*|cessation)\b")),
    ("mna", "M&A / restructuring", 0, 0.50, _R(
        r"\b(acquisition|acquires?|acquired|takeover|merger|amalgamation|demerger|scheme of arrangement|divestment|stake sale|joint venture|\bJV\b)\b")),
    ("buyback", "Buyback", 1, 0.50, _R(r"\bbuy-?back\b")),
    ("credit_rating", "Credit rating", 0, 0.30, _R(r"credit rating|\brating\b[^.]{0,30}\b(upgrade|downgrade|reaffirm|revis)", r"\b(upgrade|downgrade)[sd]?\b[^.]{0,20}\brating")),
    ("dividend", "Dividend / bonus / split", 1, 0.15, _R(r"\bdividend\b", r"\bbonus (issue|shares)\b", r"stock split|sub-?division")),
    # Market-colour pieces ("shares up for third straight session") report a move; they are not news.
    ("price_commentary", "Price commentary", 0, 0.02, _R(
        r"\b(shares?|stocks?|scrip|share price|stock price)\b[^.]{0,40}\b(rise|rises|rose|gain|gains|gained|jump|jumps|jumped|surge|surges|surged|soar|soars|soared|climb|climbs|climbed|rall(y|ies|ied)|fall|falls|fell|drop|drops|dropped|slip|slips|slipped|slide|slides|decline|declines|declined|tumble|tumbles|plunge|plunges|sink|sinks|trade|trades|trading|up|down|higher|lower|flat|hold|holds|consolidate\w*)\b",
        r"straight session|(fall|losing|winning|gaining) streak", r"top (gainers|losers)", r"52[- ]week (high|low)",
        r"double (top|bottom)|\bsupport\b|\bresistance\b|breakout|live levels|technical (view|outlook|chart|analysis)",
        r"stock (analysis|forecast|outlook)|share price (today|target|forecast|live)|price,? valuation|holds at \$|stocks? to (buy|watch)")),
]

POS_WORDS = re.compile(r"\b(rise|rises|rose|jump|jumps|jumped|surge|surges|surged|soar|soars|grow|grows|grew|growth|up|higher|beat|beats|record|strong|raise|raises|raised|upgrade[sd]?|improv\w*|expan\w*|profit(?! warning))\b", re.I)
NEG_WORDS = re.compile(r"\b(fall|falls|fell|drop|drops|dropped|decline|declines|declined|slump|slumps|plunge|plunges|down|lower|miss|misses|missed|weak|cut|cuts|lowered|downgrade[sd]?|loss|losses|contraction|warning|disappoint\w*)\b", re.I)
RUMOUR = re.compile(r"\b(sources? said|sources|reportedly|report says|rumou?r|buzz|speculat\w*|in talks|likely to|may|might|could|plans? to|considering|mulls?|eyes|set to|expected to)\b", re.I)
SEVERE_REG = re.compile(r"warning letter|import alert|\bOAI\b|insolvency|\bCIRP\b|debar|ban(ned)?|raid|search operation|winding up", re.I)
SENIOR_EXIT = re.compile(r"(resign\w*|steps? down|cessation)[^.]{0,60}\b(ceo|cfo|md|managing director|chief executive|chief financial|auditor)|\b(ceo|cfo|md|managing director|chief executive|chief financial|auditor)\b[^.]{0,60}(resign\w*|steps? down|cessation)", re.I)
AUDITOR_EXIT = re.compile(r"auditor[^.]{0,40}resign|resign\w*[^.]{0,40}auditor", re.I)

TIER1 = {"livemint", "mint", "the economic times", "economic times", "moneycontrol", "moneycontrol.com",
         "cnbc tv18", "cnbctv18", "cnbc", "business standard", "ndtv profit", "bloomberg", "reuters",
         "financial express", "the hindu businessline", "businessline", "business today", "pti"}
WIRE = {"pr newswire", "business wire", "globenewswire", "prnewswire"}


# ── classification ─────────────────────────────────────────────────────────
def classify(text):
    """Return (type, label, direction, base_materiality, matched_rule_text)."""
    t = " ".join((text or "").split())
    for typ, label, direction, base, pats in RULES:
        for p in pats:
            m = p.search(t)
            if m:
                return typ, label, direction, base, m.group(0)
    return "other", "Other news", 0, 0.15, ""


def _tone(text):
    """+1 / -1 / 0 from directional words (used for types whose sign depends on wording)."""
    p, n = len(POS_WORDS.findall(text)), len(NEG_WORDS.findall(text))
    return 0 if p == n else (1 if p > n else -1)


# ── order details ──────────────────────────────────────────────────────────
_AMT = re.compile(
    r"(?P<cur>₹|rs\.?|inr|usd|us\$|\$|eur|€)?\s*(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*"
    r"(?P<unit>lakh crore|lakh cr|crores?|cr\b|lakhs?|lacs?|billion|bn\b|million|mn\b|mln\b|thousand crore)?"
    r"(?!\s*(?:equity\s+)?(?:shares?|units?|tonnes?|tons?|tpa|mtpa|mt\b|sq|kg|litres?|customers?|users?|subscribers?|people|jobs|vehicles?|doses?|barrels?))",
    re.I)


def extract_amounts_cr(text, allow_bare=False):
    """All money amounts in text, converted to ₹ crore.

    Numbers need a unit (crore/lakh/million…). With allow_bare, a currency-prefixed number such as
    "$32,350" is read as an absolute amount; this is off by default because "₹1,215" in a headline
    is usually a share price, not a deal value.
    """
    out = []
    for m in _AMT.finditer(text or ""):
        cur = (m.group("cur") or "").lower()
        unit = (m.group("unit") or "").lower()
        if not unit and not cur:
            continue
        try:
            v = float(m.group("num").replace(",", ""))
        except ValueError:
            continue
        usd = cur in ("usd", "us$", "$")
        eur = cur in ("eur", "€")
        if not unit:
            if not allow_bare or v < 1000:
                continue  # "₹500" alone is ambiguous (price vs. value); skip
            cr = v / 1e7 * (USDINR if usd else USDINR * 1.08 if eur else 1)
            out.append(round(cr, 6))
            continue
        if unit in ("lakh crore", "lakh cr"):
            cr = v * 1e5
        elif unit == "thousand crore":
            cr = v * 1e3
        elif unit.startswith("cr"):
            cr = v
        elif unit.startswith("lakh") or unit.startswith("lac"):
            cr = v / 100
        elif unit in ("billion", "bn"):
            cr = v * 1e9 / 1e7
        elif unit in ("million", "mn", "mln"):
            cr = v * 1e6 / 1e7
        else:
            continue
        if usd:
            cr *= USDINR
        elif eur:
            cr *= USDINR * 1.08
        out.append(round(cr, 2))
    return out


_PERIOD = re.compile(
    r"(?:execut\w*|complet\w*|deliver\w*|suppl\w*|implement\w*|tenure|period|duration|span\w*|over|within)"
    r"[^.]{0,40}?(?:over|within|in|of)?\s*(?:a\s+(?:period|span)\s+of\s+)?(?P<n>\d+(?:\.\d+)?)\s*(?P<u>months?|years?|yrs?|days?|weeks?)",
    re.I)
_BY_FY = re.compile(r"\bby\s+(?:FY\s*'?(?P<fy>\d{2,4})|(?:march|mar)\s+(?P<yr>\d{4}))", re.I)
_CLIENT = re.compile(
    r"\b(?:from|by|with)\s+(?:the\s+)?(?P<c>(?:[A-Z][A-Za-z0-9&.\-]*|of|and|for)(?:\s+(?:[A-Z][A-Za-z0-9&.\-]*|of|and|for)){0,7})")
_CLIENT_STOP = {"The", "Company", "Board", "Exchange", "BSE", "NSE", "Ltd", "Limited", "Rs", "INR", "Q1", "Q2", "Q3", "Q4",
                "FY", "Its", "This", "Order", "Contract", "March", "April", "September", "October"}


def execution_months(text, ref=None):
    m = _PERIOD.search(text or "")
    if m:
        n, u = float(m.group("n")), m.group("u").lower()
        months = n * 12 if u.startswith("y") else n / 30 if u.startswith("d") else n / 4.3 if u.startswith("w") else n
        if 0.5 <= months <= 180:
            return round(months, 1)
    m = _BY_FY.search(text or "")
    if m:
        ref = ref or datetime.now(IST)
        y = m.group("fy") or m.group("yr")
        y = int(y) + (2000 if len(y) == 2 else 0)
        months = (y - ref.year) * 12 + (3 - ref.month)
        if 1 <= months <= 180:
            return float(months)
    return None


def extract_client(text):
    for m in _CLIENT.finditer(text or ""):
        c = m.group("c").strip(" .,-")
        words = [w for w in c.split() if w not in ("of", "and", "for")]
        if not words or words[0] in _CLIENT_STOP or len(c) < 3:
            continue
        # trim trailing connector words
        while c.split() and c.split()[-1] in ("of", "and", "for"):
            c = " ".join(c.split()[:-1])
        return c
    return None


_CUMULATIVE = re.compile(r"(ytd|year[- ]to[- ]date|order ?book|backlog|so far|cumulative|total|intake|beyond|"
                         r"till date|to date|for the year|in fy\d*|pipeline|bid pipeline)\W*(\w+\W+){0,3}$", re.I)


def order_value_cr(text):
    """The order's own value: the first amount that is not a running total ("YTD intake beyond ₹8,600 cr")."""
    found = []
    for m in _AMT.finditer(text or ""):
        v = extract_amounts_cr(m.group(0))
        if not v:
            continue
        cumulative = bool(_CUMULATIVE.search(text[max(0, m.start() - 45):m.start()]))
        found.append((cumulative, m.start(), v[0]))
    single = [v for cum, _, v in found if not cum]
    return single[0] if single else (found[0][2] if found else None)


def order_details(text, annual_revenue_cr=None, ref=None):
    value = order_value_cr(text)
    months = execution_months(text, ref)
    d = {"order_value_cr": value, "execution_months": months, "client": extract_client(text)}
    if value and annual_revenue_cr and annual_revenue_cr > 0:
        d["order_pct_revenue"] = round(100 * value / annual_revenue_cr, 2)
        if months:
            d["annualised_pct_revenue"] = round(100 * (value / max(months / 12, 1 / 12)) / annual_revenue_cr, 2) \
                if months >= 12 else d["order_pct_revenue"]
    return d


# ── reliability ────────────────────────────────────────────────────────────
def source_reliability(item, company_name=""):
    """(score 0..1, label). Exchange filings are ground truth; rumour language caps everything else."""
    if item.get("source_type") == "exchange":
        return 1.0, "Exchange filing"
    src = (item.get("source") or "").lower().strip()
    title = item.get("title") or ""
    rumour = bool(RUMOUR.search(title))
    first = (company_name or "").lower().split()[:1]
    if src in WIRE or (first and first[0] and len(first[0]) > 3 and first[0] in src) or "press release" in title.lower():
        score, label = 0.85, "Company statement"
    elif src in TIER1:
        score, label = 0.70, "Reputable media"
    else:
        score, label = 0.50, "Media"
    if rumour:
        return min(score, 0.30), "Unverified report"
    return score, label


# ── novelty ────────────────────────────────────────────────────────────────
_STOP = {"the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by", "as", "is", "are",
         "its", "from", "ltd", "limited", "company", "has", "informed", "exchange", "regarding", "shares", "stock"}


def _tokens(s):
    return set(re.findall(r"[a-z0-9]+", (s or "").lower())) - _STOP


def _jac(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def mark_novelty(items, window_days=10):
    """Items sorted oldest→newest get `novelty` (0..1) and `repeat_of` (index of the first report)."""
    for i, it in enumerate(items):
        it["novelty"], it["repeat_of"] = 1.0, None
        if it["event_type"] in ("routine", "price_commentary"):
            continue
        ti = _tokens(it["title"] + " " + it.get("text", ""))
        for j in range(i):
            prev = items[j]
            if (it["_ts"] - prev["_ts"]) > timedelta(days=window_days) or prev["event_type"] != it["event_type"]:
                continue
            va, vb = it.get("order_value_cr") or it.get("amount_cr"), prev.get("order_value_cr") or prev.get("amount_cr")
            same_value = bool(va and vb and abs(va - vb) <= 0.03 * vb)
            diff_value = bool(va and vb and not same_value)
            sim = _jac(ti, _tokens(prev["title"] + " " + prev.get("text", "")))
            gap = it["_ts"] - prev["_ts"]
            # Several outlets (or a filing plus articles) covering the same kind of event within ~2 days
            # are almost always one story, even when their wording shares few words.
            clustered = (it["event_type"] not in ("other", "price_commentary") and not diff_value
                         and (gap <= timedelta(days=2) or (it["event_type"] == "earnings" and gap <= timedelta(days=3))))
            if same_value or sim >= 0.45 or clustered:
                root = prev["repeat_of"] if prev["repeat_of"] is not None else j
                it["repeat_of"] = root
                days = (it["_ts"] - items[root]["_ts"]).total_seconds() / 86400
                it["novelty"] = round(0.15 if days < 2 else 0.1, 2)
                break
    return items


# ── price reaction ─────────────────────────────────────────────────────────
def price_reaction(candles, ts, lookback=5):
    """Move into the item (lookback sessions before it) and since it, plus the same in σ units."""
    if candles is None or len(candles) < lookback + 25:
        return {}
    c = candles["c"]
    d = pd.Timestamp(ts.astimezone(IST).date())
    # A filing after 15:30 IST is first tradable the next session, so "before" includes that day.
    after_close = ts.astimezone(IST).hour * 60 + ts.astimezone(IST).minute >= 15 * 60 + 30
    before = c[c.index <= d] if after_close else c[c.index < d]
    if len(before) < lookback + 20:
        return {}
    ref = before.iloc[-1]
    pre = float(ref / before.iloc[-1 - lookback] - 1)
    sig_d = float(np.log(before).diff().tail(60).std())
    out = {"pre_move": round(pre, 4), "pre_move_z": round(pre / (sig_d * math.sqrt(lookback)), 2) if sig_d else None}
    after = c[c.index > before.index[-1]]
    if len(after):
        post = float(after.iloc[-1] / ref - 1)
        out["post_move"] = round(post, 4)
        out["post_sessions"] = int(len(after))
        n = min(len(after), 20)
        out["post_move_z"] = round(post / (sig_d * math.sqrt(n)), 2) if sig_d else None
    return out


# ── main entry ─────────────────────────────────────────────────────────────
def _parse_ts(it, now):
    if it.get("time"):
        try:
            ts = datetime.fromisoformat(it["time"])
            return ts if ts.tzinfo else ts.replace(tzinfo=IST)
        except ValueError:
            pass
    return now - timedelta(hours=float(it.get("hours_ago") or 24))


def analyse(items, company_name="", annual_revenue_cr=None, market_cap_cr=None, candles=None, now=None):
    """Enrich raw filings/articles with type, details, novelty, materiality, reaction and reliability."""
    now = now or datetime.now(IST)
    out = []
    for raw in items:
        it = dict(raw)
        it["_ts"] = _parse_ts(it, now)
        it["time"] = it["_ts"].isoformat()
        title = it.get("title") or ""
        if it.get("source_type") != "exchange":
            # "... - NDTV Profit" made the earnings rule fire on the publisher's name
            src = (it.get("source") or "").strip()
            if src and title.endswith(f" - {src}"):
                title = title[: -len(src) - 3]
            else:
                title = re.sub(r"\s+[-|–—]\s+[^-|–—]{2,40}$", "", title)
        text = f"{title}. {it.get('text', '')}"
        typ, label, direction, base, matched = classify(text)
        # The exchange's own category is a strong hint for filings with terse text.
        cat = (it.get("category") or "").lower()
        if typ == "other" and "press release" in cat:
            typ, label, base = "company_update", "Company update", 0.25
        it.update(event_type=typ, event_label=label, matched=matched)
        reasons = []

        if typ in ("order_win", "order_cancellation"):
            it.update(order_details(text, annual_revenue_cr, it["_ts"]))
        else:
            amts = extract_amounts_cr(text, allow_bare=(typ == "regulatory_action"))
            it["amount_cr"] = max(amts) if amts else None

        if typ in ("earnings", "guidance_change", "credit_rating", "analyst_rating", "mna", "fund_raising", "other",
                   "company_update"):
            direction = _tone(text) if typ != "fund_raising" else (-1 if re.search(r"preferential|QIP|rights|warrants|FCCB", text, re.I) else 0)
        if typ == "management_change":
            direction = -1 if SENIOR_EXIT.search(text) else 0
        it["direction"] = direction

        # materiality
        m = base
        if typ == "regulatory_action" and SEVERE_REG.search(text):
            m = 0.85
            reasons.append("severe regulatory action")
        if typ == "management_change":
            if AUDITOR_EXIT.search(text):
                m = 0.80
                reasons.append("auditor resignation")
            elif SENIOR_EXIT.search(text):
                m = 0.60
                reasons.append("senior management exit")
            else:
                m = 0.15
        if typ in ("order_win", "order_cancellation"):
            pr = it.get("annualised_pct_revenue") or it.get("order_pct_revenue")
            if pr is not None:
                m = 0.2 + 0.8 * min(pr / 30.0, 1.0)  # 30% of annual revenue ≈ maximally material
                reasons.append(f"order ≈ {it.get('order_pct_revenue')}% of annual revenue")
            elif it.get("order_value_cr"):
                reasons.append("order value found but revenue unknown")
            else:
                m = 0.30
                reasons.append("no order value disclosed")
        if typ == "regulatory_action" and not it.get("amount_cr") and m < 0.85:
            m = 0.45  # size unknown: do not call it high until the amount is known
            reasons.append("amount not stated in the summary — check the attachment")
        if typ == "regulatory_action" and it.get("amount_cr") and m < 0.85:
            amt = it["amount_cr"]
            pct = 100 * amt / market_cap_cr if market_cap_cr else None
            if amt < 5 or (pct is not None and pct < 0.1):
                m = 0.15
                reasons.append(f"small amount (≈₹{amt:,.2f} cr" + (f", {pct:.3f}% of market cap)" if pct is not None else ")"))
        if typ == "fund_raising" and it.get("amount_cr") and market_cap_cr:
            dil = 100 * it["amount_cr"] / market_cap_cr
            it["pct_of_mcap"] = round(dil, 2)
            m = 0.2 + 0.8 * min(dil / 15.0, 1.0)
            reasons.append(f"raise ≈ {dil:.1f}% of market cap")
        if typ in ("promoter_buy", "promoter_sell", "mna", "buyback") and it.get("amount_cr") and market_cap_cr:
            pct = 100 * it["amount_cr"] / market_cap_cr
            it["pct_of_mcap"] = round(pct, 2)
            m = max(m, 0.2 + 0.8 * min(pct / 5.0, 1.0))
            reasons.append(f"size ≈ {pct:.1f}% of market cap")
        it["materiality"] = round(min(m, 1.0), 2)
        it["materiality_label"] = "high" if m >= 0.6 else "medium" if m >= 0.35 else "low"

        rel, rel_label = source_reliability(it, company_name)
        it["reliability"], it["reliability_label"] = rel, rel_label
        it.update(price_reaction(candles, it["_ts"]))
        it["_reasons"] = reasons
        out.append(it)

    out.sort(key=lambda x: x["_ts"])
    mark_novelty(out)

    # Reports of one story share its size: a terse exchange filing ("imposition of penalty") should
    # not stay "high" materiality when a linked article shows the amount is trivial.
    clusters = {}
    for i, it in enumerate(out):
        clusters.setdefault(it["repeat_of"] if it["repeat_of"] is not None else i, []).append(it)
    for members in clusters.values():
        sized = [m for m in members if m.get("order_value_cr") or m.get("amount_cr")]
        if not sized or len(members) < 2:
            continue
        ref = max(sized, key=lambda m: m["reliability"])
        for m in members:
            if m is ref or m.get("order_value_cr") or m.get("amount_cr"):
                continue
            for k in ("order_value_cr", "amount_cr", "order_pct_revenue", "annualised_pct_revenue",
                      "execution_months", "client", "pct_of_mcap"):
                if ref.get(k) is not None:
                    m[k] = ref[k]
            m["materiality"], m["materiality_label"] = ref["materiality"], ref["materiality_label"]
            m["_reasons"] = m["_reasons"] + [f"size taken from linked report ({ref.get('source')})"]

    for it in out:
        pre_z = it.get("pre_move_z")
        priced = 0.0
        if pre_z is not None and it["direction"] != 0 and np.sign(pre_z) == it["direction"] and abs(pre_z) > 1.0:
            priced = min((abs(pre_z) - 1.0) / 2.0, 1.0)  # 3σ run-up before the item ≈ fully priced in
            it["_reasons"].append(f"stock already moved {it['pre_move'] * 100:+.1f}% in the 5 sessions before")
        it["priced_in"] = round(priced, 2)
        if it["repeat_of"] is not None:
            it["_reasons"].append("repeats an earlier report")
        it["impact"] = round(it["direction"] * it["materiality"] * it["novelty"] * it["reliability"] * (1 - 0.6 * priced), 3)
        it["reasons"] = it.pop("_reasons")

    for it in out:
        it.pop("_ts", None)
    out.sort(key=lambda x: x["time"], reverse=True)
    return out


def summarise(items, half_life_days=10, now=None):
    """Time-decayed net catalyst score in [-1, 1] and the events that drive it."""
    now = now or datetime.now(IST)
    total, drivers = 0.0, []
    for it in items:
        age = (now - datetime.fromisoformat(it["time"])).total_seconds() / 86400
        w = 0.5 ** (max(age, 0) / half_life_days)
        total += it["impact"] * w
        if abs(it["impact"]) >= 0.1 and it["novelty"] > 0.5:
            drivers.append(it)
    counts = {}
    for it in items:
        if it["event_type"] != "routine":
            counts[it["event_type"]] = counts.get(it["event_type"], 0) + 1
    drivers.sort(key=lambda x: -abs(x["impact"]))
    return {"net_score": round(math.tanh(total), 3), "event_counts": counts,
            "top_events": [{k: d.get(k) for k in ("time", "title", "text", "event_type", "event_label", "direction", "impact",
                                                  "materiality_label", "reliability_label", "source", "url", "link",
                                                  "order_value_cr", "order_pct_revenue")} for d in drivers[:5]]}

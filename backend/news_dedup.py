"""
news_dedup.py — Semantic News Deduplication Engine

Uses fastembed (ONNX-runtime, all-MiniLM-L6-v2) with title hash caching,
union-find temporal clustering, and multi-tier rule-based guards:
1. Direction veto: prevents merging 'rises' vs 'falls'
2. Company/Entity veto: prevents merging 'TCS Q2 profit' vs 'Infosys Q2 profit'
3. Number consistency guard: requires matching figures in the gray similarity zone
4. Source reputation weighting: selects highest-tier primary publisher (Mint, ET, Moneycontrol)
5. Multi-source tracking: attaches 'related_sources' list for syndicated stories
"""

import re
import hashlib
import numpy as np

# Lazy fastembed model loader with TF-IDF fallback
_model = None
_cache = {}  # md5(title) -> unit-normalized vector

UP = {
    "rise", "rises", "rising", "jump", "jumps", "jumping",
    "surge", "surges", "surging", "gain", "gains", "rally", "rallies",
    "rebound", "rebounds", "up", "climb", "climbs"
}

DOWN = {
    "fall", "falls", "falling", "drop", "drops", "dropping",
    "plunge", "plunges", "plunging", "slump", "slumps", "tumble", "tumbles",
    "decline", "declines", "down", "slide", "slides"
}

TIER_PRIORITY = {
    "livemint": 10, "mint": 10,
    "the economic times": 10, "economic times": 10,
    "moneycontrol": 10, "moneycontrol.com": 10,
    "cnbc tv18": 9, "cnbc": 9,
    "business standard": 9, "ndtv profit": 9, "ndtv": 8,
    "bloomberg": 10, "reuters": 10,
    "financial express": 8, "business today": 8,
    "the hindu": 7, "the hindu business line": 8, "businessline": 8,
    "deccan herald": 7, "zee business": 7,
}

# Entity dictionary mapping keywords to canonical symbols
ENTITY_LOOKUP = {
    "nifty": "NIFTY", "nifty 50": "NIFTY", "bank nifty": "BANKNIFTY",
    "sensex": "SENSEX", "rbi": "RBI", "sebi": "SEBI",
}

try:
    from data_manager import TICKER_ALIASES
    for ticker, aliases in TICKER_ALIASES.items():
        ENTITY_LOOKUP[ticker.lower()] = ticker
        for a in aliases:
            if len(a) > 2:
                ENTITY_LOOKUP[a.lower()] = ticker
except Exception:
    pass


def get_model():
    global _model
    if _model is None:
        try:
            from fastembed import TextEmbedding
            _model = TextEmbedding("sentence-transformers/all-MiniLM-L6-v2")
        except Exception as e:
            print(f"[NewsDedup] Fastembed init failed ({e}), falling back to TF-IDF.")
            _model = "TFIDF"
    return _model


def clean_title(title, source=None):
    """Strip publisher suffix, whitespace, and HTML entities."""
    t = title or ""
    # Strip HTML escapes
    t = t.replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'")
    if source and t.endswith(f" - {source}"):
        t = t[: -len(source) - 3]
    else:
        t = re.sub(r"\s*[-|–—]\s*[^-|–—]+$", "", t)
    return t.strip()


def extract_numbers(text):
    """Extract float numbers from text, normalizing commas."""
    nums = []
    for x in re.findall(r"\d[\d,]*\.?\d*", text):
        try:
            nums.append(float(x.replace(",", "")))
        except ValueError:
            pass
    return nums


def direction_flags(text):
    """Return (has_up, has_down) flags."""
    words = set(re.findall(r"[a-z]+", text.lower()))
    return (bool(words & UP), bool(words & DOWN))


def extract_entities(text):
    """Extract known stock tickers / index entities."""
    t_low = text.lower()
    found = set()
    for kw, sym in ENTITY_LOOKUP.items():
        if re.search(r"\b" + re.escape(kw) + r"\b", t_low):
            found.add(sym)
    return found


def share_number(a, b, tol=0.03):
    """Check if headlines share at least one numerical value."""
    na = extract_numbers(a)
    nb = extract_numbers(b)
    if not na or not nb:
        return True  # No figures mentioned to conflict
    return any(abs(x - y) <= tol * max(abs(x), abs(y), 1) for x in na for y in nb)


def token_jaccard(a, b):
    """Compute word-level Jaccard similarity ignoring stop words."""
    stopwords = {
        "the", "a", "an", "and", "or", "in", "on", "at", "to", "for",
        "of", "with", "by", "as", "is", "are", "amid", "after", "its", "this",
        "that", "from", "be", "will", "has", "have", "can", "more", "over"
    }
    w_a = set(re.findall(r"[a-z0-9]+", a.lower())) - stopwords
    w_b = set(re.findall(r"[a-z0-9]+", b.lower())) - stopwords
    if not w_a or not w_b:
        return 0.0
    return len(w_a & w_b) / len(w_a | w_b)


def embed_titles(titles):
    """Embed list of titles using fastembed with in-memory hashing cache."""
    model = get_model()
    keys = [hashlib.md5(t.lower().encode("utf-8")).hexdigest() for t in titles]

    if model == "TFIDF":
        from sklearn.feature_extraction.text import TfidfVectorizer
        vec = TfidfVectorizer(ngram_range=(1, 2), stop_words="english")
        try:
            X = vec.fit_transform(titles).toarray()
            # Normalize rows
            norms = np.linalg.norm(X, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            return X / norms
        except Exception:
            return np.eye(len(titles))

    # Fastembed path
    todo = [(k, t) for k, t in zip(keys, titles) if k not in _cache]
    if todo:
        try:
            vecs = list(model.embed([t for _, t in todo]))
            for (k, _), v in zip(todo, vecs):
                norm = np.linalg.norm(v)
                _cache[k] = (v / norm) if norm > 0 else v
        except Exception as e:
            print(f"[NewsDedup] Fastembed embed error: {e}")

    return np.stack([_cache.get(k, np.zeros(384)) for k in keys])


def same_story(sim, a, b):
    """Determine whether two headlines describe the identical event."""
    # 1. Company entity veto (e.g. TCS vs Infosys)
    ea = extract_entities(a)
    eb = extract_entities(b)
    if ea and eb and not (ea & eb):
        return False

    # 2. Market direction veto (e.g. rally vs tumble)
    ua, da = direction_flags(a)
    ub, db = direction_flags(b)
    if (ua and not da and not ub and db) or (da and not ua and ub and not db):
        return False

    # 3. Very high semantic similarity
    if sim >= 0.85:
        return True

    # 4. Moderate similarity + numeric corroboration
    if sim >= 0.74 and share_number(a, b):
        return True

    # 5. Semantic overlap + high keyword Jaccard + numeric corroboration
    if sim >= 0.55 and token_jaccard(a, b) >= 0.40 and share_number(a, b):
        return True

    return False


def source_score(source):
    """Reputation score for primary publisher selection."""
    if not source:
        return 0
    return TIER_PRIORITY.get(source.lower().strip(), 1)


def dedupe_articles(articles, window_h=24):
    """
    Deduplicates a list of news article dicts using union-find clustering.
    Each article dict must have: 'title', 'source', 'hours_ago'.
    Returns deduplicated articles with 'related_sources' list added.
    """
    if not articles or len(articles) <= 1:
        return articles

    titles = [clean_title(a.get("title", ""), a.get("source")) for a in articles]
    E = embed_titles(titles)
    S = E @ E.T

    n = len(articles)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(n):
        h_i = articles[i].get("hours_ago", 24)
        for j in range(i + 1, n):
            h_j = articles[j].get("hours_ago", 24)
            # Only cluster stories within publication time window
            if abs(h_i - h_j) > window_h:
                continue
            if same_story(S[i, j], titles[i], titles[j]):
                parent[find(j)] = find(i)

    # Group by connected component root
    groups = {}
    for i, a in enumerate(articles):
        root = find(i)
        groups.setdefault(root, []).append(a)

    out = []
    for g in groups.values():
        # Select best representative: highest publisher tier first, then earliest
        g.sort(key=lambda a: (-source_score(a.get("source")), a.get("hours_ago", 24)))
        primary = dict(g[0])
        # Accumulate secondary sources
        other_sources = sorted({a.get("source") for a in g[1:] if a.get("source")} - {primary.get("source")})
        primary["related_sources"] = other_sources
        out.append(primary)

    # Retain recency sort order
    out.sort(key=lambda a: a.get("hours_ago", 24))
    return out

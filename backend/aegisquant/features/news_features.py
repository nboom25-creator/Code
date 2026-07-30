"""News and event features.

Two rules govern this module:

1. **Publication time is authoritative.** Only articles with
   ``published_at <= as_of`` are visible, so a backtest cannot read tomorrow's
   headline.
2. **Absent news is not bad news.** A thinly covered name returns ``None`` for
   sentiment, never ``0`` or a negative default. Small and micro-caps routinely
   have no coverage at all, and treating silence as bearish would systematically
   penalise exactly the part of the universe where fundamentals and volume carry
   the information.

When the upstream provider supplies no sentiment score (Alpaca and yfinance do
not), a transparent lexicon heuristic fills in. It is labelled as derived in the
snapshot metadata so nobody mistakes it for a licensed sentiment feed.
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np

from aegisquant.features.market_view import NewsRow, PointInTime

# Small, explicit financial-news lexicon. Deliberately conservative: it is a
# fallback, not a model, and its output is flagged as heuristic.
_POSITIVE = {
    "beats": 0.6,
    "beat": 0.6,
    "record": 0.5,
    "surge": 0.6,
    "soars": 0.7,
    "jumps": 0.5,
    "raises": 0.5,
    "raised": 0.5,
    "upgrade": 0.6,
    "upgraded": 0.6,
    "outperform": 0.5,
    "approval": 0.6,
    "approved": 0.6,
    "wins": 0.5,
    "win": 0.4,
    "awarded": 0.5,
    "expansion": 0.4,
    "expands": 0.4,
    "growth": 0.3,
    "accelerating": 0.5,
    "strong": 0.4,
    "profit": 0.3,
    "profitable": 0.5,
    "breakthrough": 0.6,
    "partnership": 0.35,
    "launch": 0.3,
    "launches": 0.3,
    "guidance": 0.1,
    "buyback": 0.4,
    "dividend": 0.2,
}
_NEGATIVE = {
    "miss": -0.6,
    "misses": -0.6,
    "missed": -0.6,
    "plunge": -0.7,
    "plunges": -0.7,
    "falls": -0.4,
    "slump": -0.6,
    "downgrade": -0.6,
    "downgraded": -0.6,
    "cuts": -0.5,
    "cut": -0.4,
    "lowered": -0.5,
    "warning": -0.5,
    "warns": -0.5,
    "probe": -0.6,
    "investigation": -0.65,
    "lawsuit": -0.5,
    "sued": -0.5,
    "recall": -0.6,
    "restatement": -0.85,
    "restate": -0.85,
    "fraud": -0.95,
    "delisting": -0.8,
    "bankruptcy": -0.95,
    "default": -0.7,
    "layoffs": -0.35,
    "resigns": -0.4,
    "departure": -0.3,
    "short seller": -0.6,
    "dilution": -0.45,
    "offering": -0.3,
    "subpoena": -0.7,
    "halt": -0.5,
    "halted": -0.5,
    "weak": -0.4,
    "decline": -0.35,
}
_UNCERTAIN = {
    "may",
    "could",
    "might",
    "uncertain",
    "unclear",
    "reportedly",
    "rumor",
    "rumour",
    "considering",
    "explores",
    "exploring",
    "potential",
    "possible",
    "weighs",
}

EVENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "earnings": ("earnings", "quarterly results", "q1", "q2", "q3", "q4", "eps", "revenue"),
    "regulatory": ("regulator", "sec ", "ftc", "doj", "antitrust", "probe", "investigation", "fda"),
    "management": ("chief executive", "ceo", "cfo", "resign", "appoints", "names new"),
    "accounting": ("restatement", "restate", "audit", "accounting", "material weakness", "fraud"),
    "corporate_action": (
        "merger",
        "acquisition",
        "acquires",
        "spin-off",
        "split",
        "buyback",
        "offering",
    ),
    "product": ("launch", "unveil", "next-generation", "product"),
    "customer_win": ("contract", "customer win", "order", "awarded"),
    "estimate_revision": ("estimate", "guidance", "target price", "revise"),
}


def _lexical_sentiment(headline: str) -> tuple[float, float]:
    """Return (sentiment, uncertainty) from a headline. Heuristic, not a model."""
    text = f" {headline.lower()} "
    score = 0.0
    hits = 0
    for word, weight in _POSITIVE.items():
        if f" {word} " in text or f" {word}." in text:
            score += weight
            hits += 1
    for word, weight in _NEGATIVE.items():
        if word in text:
            score += weight
            hits += 1
    sentiment = 0.0 if hits == 0 else float(np.clip(score / max(1, hits) * 1.2, -1.0, 1.0))
    uncertainty = min(1.0, sum(1 for w in _UNCERTAIN if f" {w}" in text) * 0.3)
    return sentiment, uncertainty


def _sentiment_of(row: NewsRow) -> float | None:
    if row.sentiment is not None:
        return row.sentiment
    s, _ = _lexical_sentiment(row.headline)
    return s


def _uncertainty_of(row: NewsRow) -> float | None:
    if row.uncertainty is not None:
        return row.uncertainty
    _, u = _lexical_sentiment(row.headline)
    return u


def _credibility_of(row: NewsRow) -> float:
    if row.credibility is not None:
        return max(0.05, row.credibility)
    # No credibility metadata: treat every source equally rather than guessing.
    return 0.5


def _tags_of(row: NewsRow) -> set[str]:
    tags = set(row.tags)
    if not tags:
        text = row.headline.lower()
        for tag, keywords in EVENT_KEYWORDS.items():
            if any(k in text for k in keywords):
                tags.add(tag)
    return tags


# ---------------------------------------------------------------------------
def news_count_7(pit: PointInTime, symbol: str) -> float | None:
    return float(len(pit.news(symbol, days=7)))


def news_count_30(pit: PointInTime, symbol: str) -> float | None:
    return float(len(pit.news(symbol, days=30)))


def _weighted_sentiment(rows: list[NewsRow]) -> float | None:
    pairs = [(_sentiment_of(r), _credibility_of(r)) for r in rows]
    pairs = [(s, c) for s, c in pairs if s is not None]
    if not pairs:
        return None  # no coverage -> unknown, not neutral-negative
    total_w = sum(c for _, c in pairs)
    if total_w <= 0:
        return None
    return float(np.clip(sum(s * c for s, c in pairs) / total_w, -1.0, 1.0))


def news_sentiment_7(pit: PointInTime, symbol: str) -> float | None:
    return _weighted_sentiment(pit.news(symbol, days=7))


def news_sentiment_30(pit: PointInTime, symbol: str) -> float | None:
    return _weighted_sentiment(pit.news(symbol, days=30))


def news_sentiment_trend(pit: PointInTime, symbol: str) -> float | None:
    s7, s30 = news_sentiment_7(pit, symbol), news_sentiment_30(pit, symbol)
    if s7 is None or s30 is None:
        return None
    return s7 - s30


def news_uncertainty_30(pit: PointInTime, symbol: str) -> float | None:
    vals = [u for u in (_uncertainty_of(r) for r in pit.news(symbol, days=30)) if u is not None]
    return None if not vals else float(np.mean(vals))


def news_novelty_max_7(pit: PointInTime, symbol: str) -> float | None:
    rows = pit.news(symbol, days=7)
    if not rows:
        return None
    explicit = [r.novelty for r in rows if r.novelty is not None]
    if explicit:
        return float(max(explicit))
    # Derive novelty: a tag not seen in the prior 90 days is novel.
    prior_tags: set[str] = set()
    for r in pit.news(symbol, days=90):
        if r.published_at < pit.as_of - timedelta(days=7):
            prior_tags |= _tags_of(r)
    best = 0.0
    for r in rows:
        tags = _tags_of(r)
        best = max(best, 0.9 if tags - prior_tags else 0.2)
    return best


def news_credibility_mean_30(pit: PointInTime, symbol: str) -> float | None:
    rows = pit.news(symbol, days=30)
    if not rows:
        return None
    return float(np.mean([_credibility_of(r) for r in rows]))


def _has_tag(pit: PointInTime, symbol: str, tag: str, days: int) -> float | None:
    rows = pit.news(symbol, days=days)
    if not rows:
        return None  # unknown, not "no"
    return 1.0 if any(tag in _tags_of(r) for r in rows) else 0.0


def has_earnings_event_7(pit: PointInTime, symbol: str) -> float | None:
    return _has_tag(pit, symbol, "earnings", 7)


def has_regulatory_event_30(pit: PointInTime, symbol: str) -> float | None:
    return _has_tag(pit, symbol, "regulatory", 30)


def has_management_change_30(pit: PointInTime, symbol: str) -> float | None:
    return _has_tag(pit, symbol, "management", 30)


def has_accounting_flag_90(pit: PointInTime, symbol: str) -> float | None:
    return _has_tag(pit, symbol, "accounting", 90)


def has_corporate_action_30(pit: PointInTime, symbol: str) -> float | None:
    """Corporate actions come from the actions table, which is authoritative."""
    actions = pit.corporate_actions(symbol, since_days=30)
    news_flag = _has_tag(pit, symbol, "corporate_action", 30)
    if actions:
        return 1.0
    return news_flag


# ---------------------------------------------------------------------------
# earnings-anchored features (publication date of the fundamental record)
# ---------------------------------------------------------------------------
def _last_earnings_publication(pit: PointInTime, symbol: str):
    rows = pit.fundamentals(symbol)
    return rows[-1].observed_at if rows else None


def days_since_earnings(pit: PointInTime, symbol: str) -> float | None:
    published = _last_earnings_publication(pit, symbol)
    if published is None:
        return None
    return float(max(0, (pit.as_of - published).days))


def pead_drift_20(pit: PointInTime, symbol: str) -> float | None:
    """Return since the last earnings publication (the PEAD window)."""
    published = _last_earnings_publication(pit, symbol)
    if published is None:
        return None
    ts = pit.timestamps(symbol)
    closes = pit.closes(symbol)
    if ts.size < 2:
        return None
    import numpy as _np

    idx = int(_np.searchsorted(ts, _np.datetime64(published.replace(tzinfo=None)), side="right"))
    if idx <= 0 or idx >= closes.size:
        return None
    base = float(closes[idx - 1])
    if base <= 0 or (pit.as_of - published).days > 90:
        return None
    return float(closes[-1]) / base - 1.0


def earnings_gap_pct(pit: PointInTime, symbol: str) -> float | None:
    """Overnight move on the session following the last earnings publication."""
    published = _last_earnings_publication(pit, symbol)
    if published is None:
        return None
    ts, opens, closes = pit.timestamps(symbol), pit.opens(symbol), pit.closes(symbol)
    if ts.size < 3:
        return None
    import numpy as _np

    idx = int(_np.searchsorted(ts, _np.datetime64(published.replace(tzinfo=None)), side="right"))
    if idx <= 0 or idx >= opens.size:
        return None
    prev_close = float(closes[idx - 1])
    if prev_close <= 0:
        return None
    return float(opens[idx]) / prev_close - 1.0


SYMBOL_FEATURES = {
    "news_count_7": news_count_7,
    "news_count_30": news_count_30,
    "news_sentiment_7": news_sentiment_7,
    "news_sentiment_30": news_sentiment_30,
    "news_sentiment_trend": news_sentiment_trend,
    "news_uncertainty_30": news_uncertainty_30,
    "news_novelty_max_7": news_novelty_max_7,
    "news_credibility_mean_30": news_credibility_mean_30,
    "has_earnings_event_7": has_earnings_event_7,
    "has_regulatory_event_30": has_regulatory_event_30,
    "has_management_change_30": has_management_change_30,
    "has_accounting_flag_90": has_accounting_flag_90,
    "has_corporate_action_30": has_corporate_action_30,
    "days_since_earnings": days_since_earnings,
    "pead_drift_20": pead_drift_20,
    "earnings_gap_pct": earnings_gap_pct,
}

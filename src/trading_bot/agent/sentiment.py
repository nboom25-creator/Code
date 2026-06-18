"""Lightweight local sentiment scoring for news headlines.

A dependency-free, finance-tuned lexicon scorer. It tags each headline as
positive / neutral / negative so the agent (and the audit log) have a cheap,
deterministic sentiment signal without an extra API call or model dependency.

This is intentionally simple — a bag-of-words lexicon, not a transformer. It's
good enough to surface obvious "beats earnings" vs "plunges on probe" signals
and to demonstrate the pipeline. Swap in a model-based scorer later behind the
same ``tag_news`` / ``aggregate`` interface.
"""

from __future__ import annotations

import re

POSITIVE_WORDS = {
    "beat", "beats", "surge", "surges", "soar", "soars", "rally", "rallies",
    "gain", "gains", "jump", "jumps", "record", "upgrade", "upgraded",
    "outperform", "strong", "growth", "profit", "profits", "bullish", "rise",
    "rises", "tops", "exceeds", "exceed", "raised", "boost", "boosts", "win",
    "wins", "positive", "optimistic", "breakthrough", "expansion", "dividend",
    "buyback", "approval", "approved", "rebound", "rebounds", "高",
}

NEGATIVE_WORDS = {
    "miss", "misses", "missed", "plunge", "plunges", "fall", "falls", "drop",
    "drops", "decline", "declines", "downgrade", "downgraded", "underperform",
    "weak", "loss", "losses", "bearish", "slump", "slumps", "cut", "cuts",
    "lawsuit", "probe", "investigation", "recall", "recalls", "warning",
    "warns", "warn", "layoffs", "bankruptcy", "fraud", "default", "slowdown",
    "fears", "concerns", "plummet", "plummets", "sink", "sinks", "tumble",
    "tumbles", "halt", "halts", "crash", "crashes", "sue", "sued",
}

_TOKEN_RE = re.compile(r"[a-zA-Z']+")


def score_text(text: str) -> tuple[str, float]:
    """Return (label, score) for a piece of text.

    ``label`` is "positive" / "neutral" / "negative". ``score`` is the net
    sentiment in [-1, 1]: (pos - neg) / (pos + neg), 0 when no lexicon hits.
    """
    if not text:
        return "neutral", 0.0
    tokens = _TOKEN_RE.findall(text.lower())
    pos = sum(1 for t in tokens if t in POSITIVE_WORDS)
    neg = sum(1 for t in tokens if t in NEGATIVE_WORDS)
    if pos == 0 and neg == 0:
        return "neutral", 0.0
    score = (pos - neg) / (pos + neg)
    if score > 0:
        return "positive", round(score, 3)
    if score < 0:
        return "negative", round(score, 3)
    return "neutral", 0.0


def tag_news(items: list[dict]) -> list[dict]:
    """Return a copy of each news item with ``sentiment`` and ``sentiment_score``."""
    tagged = []
    for item in items:
        text = f"{item.get('headline', '')} {item.get('summary', '')}".strip()
        label, score = score_text(text)
        tagged.append({**item, "sentiment": label, "sentiment_score": score})
    return tagged


def aggregate(items: list[dict]) -> dict:
    """Summarize the sentiment across tagged news items."""
    if not items:
        return {"positive": 0, "neutral": 0, "negative": 0, "net": 0.0, "count": 0}
    counts = {"positive": 0, "neutral": 0, "negative": 0}
    total = 0.0
    for item in items:
        label = item.get("sentiment", "neutral")
        counts[label] = counts.get(label, 0) + 1
        total += float(item.get("sentiment_score", 0.0))
    net = round(total / len(items), 3)
    return {**counts, "net": net, "count": len(items)}

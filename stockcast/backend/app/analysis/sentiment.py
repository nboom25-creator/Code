"""Lightweight lexicon news sentiment.

A dependency-free scorer so the app has a sensible sentiment signal even when
the provider does not return its own scores. Provider-supplied scores (e.g.
Alpha Vantage) always take precedence over this fallback.
"""
from __future__ import annotations

import re

from app.schemas import NewsItem

_POSITIVE = {
    "beat", "beats", "surge", "surged", "soar", "soars", "gain", "gains", "record",
    "growth", "grow", "strong", "upgrade", "upgraded", "outperform", "bullish",
    "profit", "rally", "rallies", "expansion", "raise", "raised", "buy", "boost",
    "positive", "wins", "win", "success", "breakthrough", "rebound", "jump",
}
_NEGATIVE = {
    "miss", "misses", "plunge", "plunges", "drop", "drops", "fall", "falls",
    "weak", "downgrade", "downgraded", "underperform", "bearish", "loss", "losses",
    "decline", "declines", "cut", "cuts", "lawsuit", "probe", "recall", "warning",
    "slump", "fraud", "bankruptcy", "layoff", "layoffs", "negative", "concern",
    "concerns", "risk", "risks", "sell", "slowdown",
}

_WORD = re.compile(r"[a-zA-Z']+")


def score_text(text: str) -> float:
    """Return a sentiment score in [-1, 1] from a headline/summary."""
    if not text:
        return 0.0
    words = [w.lower() for w in _WORD.findall(text)]
    pos = sum(1 for w in words if w in _POSITIVE)
    neg = sum(1 for w in words if w in _NEGATIVE)
    total = pos + neg
    if total == 0:
        return 0.0
    return (pos - neg) / total


def label_for(score: float) -> str:
    if score > 0.15:
        return "positive"
    if score < -0.15:
        return "negative"
    return "neutral"


def enrich_news(items: list[NewsItem]) -> tuple[list[NewsItem], float]:
    """Fill missing sentiment scores and return (items, average_score)."""
    scores: list[float] = []
    for item in items:
        if item.sentiment_score is None:
            text = f"{item.headline} {item.summary or ''}"
            item.sentiment_score = round(score_text(text), 3)
            item.sentiment_label = label_for(item.sentiment_score)
        elif item.sentiment_label is None:
            item.sentiment_label = label_for(item.sentiment_score)
        scores.append(item.sentiment_score)
    avg = round(sum(scores) / len(scores), 3) if scores else 0.0
    return items, avg

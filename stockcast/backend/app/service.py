"""Application service layer.

Orchestrates data retrieval (with caching and demo fallback) and the analysis
pipeline into the response objects the API returns. Keeps routers thin.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app import cache
from app.analysis import to_dataframe
from app.analysis.backtest import run_backtest
from app.analysis.forecasting import build_forecast
from app.analysis.rating import build_rating, forecast_last_price
from app.analysis.risk import build_risk
from app.analysis.sentiment import enrich_news
from app.analysis.technical import build_technical
from app.config import get_settings
from app.providers.base import (
    MarketDataProvider,
    ProviderError,
    ProviderNotConfigured,
    SymbolNotFound,
)
from app.providers.demo import BENCHMARK_TICKER, DemoProvider
from app.providers.factory import build_provider, demo_provider, get_history_provider
from app.schemas import (
    AnalysisResponse,
    BacktestRequest,
    BacktestResult,
    NewsItem,
    OHLCV,
    Quote,
    SearchResult,
)

DISCLAIMER = (
    "StockCast is a research and educational tool. It does not provide personalised "
    "financial advice, and nothing here is a recommendation to buy or sell any security. "
    "Forecasts are uncertain model outputs, not guarantees. Past performance does not "
    "guarantee future results. Do your own research and consult a licensed advisor."
)

DEMO_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "JNJ", "KO", "V", "WMT", "DIS", "NFLX"]


async def _get_history_cached(provider: MarketDataProvider, ticker: str) -> list[OHLCV]:
    settings = get_settings()
    key = f"hist:{provider.name}:{ticker.upper()}"
    cached = cache.get(key)
    if cached is not None:
        return [OHLCV(**b) for b in cached]
    bars = await provider.get_daily_history(ticker)
    cache.set(key, [b.model_dump(mode="json") for b in bars], settings.cache_ttl_history_seconds)
    return bars


async def analyze(ticker: str, provider_name: str | None = None) -> AnalysisResponse:
    """Full analysis for a ticker with graceful demo fallback."""
    settings = get_settings()
    ticker = _validate_ticker(ticker)

    demo_reason: str | None = None
    try:
        primary = build_provider(provider_name)
        hist_provider = get_history_provider(primary)
        history = await _get_history_cached(hist_provider, ticker)
        quote = await primary.get_quote(ticker) if not primary.is_demo else await primary.get_quote(ticker)
        try:
            profile = await primary.get_profile(ticker)
        except (ProviderError, NotImplementedError):
            profile = await hist_provider.get_profile(ticker) if hasattr(hist_provider, "get_profile") else None
        try:
            fundamentals = await primary.get_fundamentals(ticker)
        except (ProviderError, NotImplementedError):
            fundamentals = None
        try:
            news = await primary.get_news(ticker)
        except (ProviderError, NotImplementedError):
            news = []
        is_demo = primary.is_demo
    except ProviderNotConfigured as exc:
        if not settings.allow_demo_fallback:
            raise
        demo_reason = f"{exc.message} Showing clearly-labelled DEMO DATA instead."
        primary = demo_provider()
        is_demo = True
        history = await _get_history_cached(primary, ticker)
        quote = await primary.get_quote(ticker)
        profile = await primary.get_profile(ticker)
        fundamentals = await primary.get_fundamentals(ticker)
        news = await primary.get_news(ticker)
    except (ProviderError,) as exc:
        # Network / upstream failure: fall back to demo if allowed.
        if isinstance(exc, SymbolNotFound):
            raise
        if not settings.allow_demo_fallback:
            raise
        demo_reason = f"Live provider unavailable ({exc.message}). Showing DEMO DATA."
        primary = demo_provider()
        is_demo = True
        history = await _get_history_cached(primary, ticker)
        quote = await primary.get_quote(ticker)
        profile = await primary.get_profile(ticker)
        fundamentals = await primary.get_fundamentals(ticker)
        news = await primary.get_news(ticker)

    if len(history) < 60:
        raise ProviderError(
            f"Only {len(history)} days of history for {ticker}; need more to analyze.",
            code="insufficient_data",
        )

    # Benchmark (S&P 500). Use the same provider family; demo has ^GSPC.
    benchmark_bars: list[OHLCV] = []
    try:
        bench_provider = primary if primary.is_demo else get_history_provider(primary)
        benchmark_bars = await _get_history_cached(bench_provider, BENCHMARK_TICKER if primary.is_demo else "^SPX")
    except ProviderError:
        benchmark_bars = []

    df = to_dataframe(history)
    df.attrs["ticker"] = ticker
    bench_series = to_dataframe(benchmark_bars)["adj_close"] if benchmark_bars else None

    technical = build_technical(df)
    forecast, scenarios = build_forecast(df, bench_series, is_demo=is_demo)
    risk = build_risk(df, bench_series)
    news, avg_sentiment = enrich_news(news)
    rating = build_rating(ticker, df, fundamentals, forecast, risk, avg_sentiment if news else None)

    sources = sorted({quote.provenance.source})
    if profile:
        sources.append(profile.provenance.source)
    if fundamentals:
        sources.append(fundamentals.provenance.source)
    sources = sorted(set(sources))

    assumptions = [
        "Forecasts model log-returns and reconstruct prices; returns are assumed "
        "approximately stationary over the estimation window.",
        "Adjusted close prices are used so splits and dividends do not distort returns.",
        f"Prediction intervals target ~{int(forecast.interval_confidence*100)}% coverage "
        "based on walk-forward residuals.",
        "Trading calendar gaps (holidays/weekends) are handled by using available "
        "trading days only.",
    ]
    limitations = [
        "Short-horizon equity returns are close to a random walk; point forecasts are "
        "inherently noisy.",
        "News sentiment uses a simple lexicon unless the provider supplies scores.",
        "No intraday microstructure, options flow, or insider data is modelled.",
    ]
    if is_demo:
        limitations.insert(0, "DEMO DATA is synthetic and must not be used for real decisions.")
    if not fundamentals:
        limitations.append("Fundamental data was unavailable from the active provider; "
                           "fundamental rating components were neutralised.")

    return AnalysisResponse(
        ticker=ticker,
        generated_at=datetime.now(timezone.utc),
        is_demo=is_demo,
        demo_reason=demo_reason,
        quote=quote,
        profile=profile,
        fundamentals=fundamentals,
        history=history,
        benchmark_history=benchmark_bars,
        technical=technical,
        forecast=forecast,
        scenarios=scenarios,
        rating=rating,
        risk=risk,
        news=news,
        sources=sources,
        assumptions=assumptions,
        limitations=limitations,
        disclaimer=DISCLAIMER,
    )


async def search_symbols(query: str) -> list[SearchResult]:
    try:
        provider = build_provider()
        results = await provider.search(query)
        if results:
            return results
    except (ProviderError, ProviderNotConfigured):
        pass
    # Fall back to demo catalogue for autocomplete.
    return await demo_provider().search(query)


async def get_quote(ticker: str) -> Quote:
    try:
        provider = build_provider()
        return await provider.get_quote(ticker)
    except ProviderNotConfigured:
        if get_settings().allow_demo_fallback:
            return await demo_provider().get_quote(ticker)
        raise


def _validate_ticker(ticker: str) -> str:
    ticker = ticker.strip().upper()
    if not ticker or len(ticker) > 12 or not all(c.isalnum() or c in ".^-" for c in ticker):
        raise ProviderError(f"Invalid ticker '{ticker}'", code="invalid_ticker")
    return ticker


async def backtest(req: BacktestRequest) -> BacktestResult:
    ticker = _validate_ticker(req.ticker)
    if req.horizon_days < 1 or req.horizon_days > 252:
        raise ProviderError("Horizon must be between 1 and 252 days", code="invalid_request")
    if req.initial_investment <= 0:
        raise ProviderError("Initial investment must be positive", code="invalid_request")
    is_demo = False
    try:
        provider = build_provider()
        hist_provider = get_history_provider(provider)
        history = await _get_history_cached(hist_provider, ticker)
        is_demo = hist_provider.is_demo
    except (ProviderNotConfigured, ProviderError) as exc:
        if isinstance(exc, SymbolNotFound):
            raise
        if not get_settings().allow_demo_fallback:
            raise
        history = await _get_history_cached(demo_provider(), ticker)
        is_demo = True

    if len(history) < 300:
        raise ProviderError(
            f"Only {len(history)} days of history for {ticker}; need more to backtest.",
            code="insufficient_data",
        )
    df = to_dataframe(history)
    df.attrs["ticker"] = ticker
    benchmark_bars: list[OHLCV] = []
    try:
        benchmark_bars = await _get_history_cached(
            demo_provider() if is_demo else get_history_provider(build_provider()),
            BENCHMARK_TICKER if is_demo else "^SPX",
        )
    except ProviderError:
        benchmark_bars = []
    bench_series = to_dataframe(benchmark_bars)["adj_close"] if benchmark_bars else None

    return run_backtest(
        df,
        bench_series,
        model_name=req.model,
        horizon=req.horizon_days,
        initial_investment=req.initial_investment,
        transaction_cost_bps=req.transaction_cost_bps,
        is_demo=is_demo,
    )


def random_ticker() -> str:
    """Pick a valid, well-known ticker deterministically-ish per call.

    Uses the process clock indirectly via cache size to avoid importing random at
    module import; falls back to a rotating index.
    """
    import random as _random

    return _random.choice(DEMO_TICKERS)

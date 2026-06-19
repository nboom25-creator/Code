"""Alternative research pipelines for thinly-covered small/micro-cap names.

Mega-caps have dense news feeds; small-caps don't. This module provides the
high-density fallbacks the agent leans on when generic news is sparse:

* **Screener** — ``discover_small_caps`` via a stock-screener API (FMP / Finnhub).
* **Fundamentals** — market cap, debt/equity, current ratio, cash, growth.
* **SEC EDGAR** — recent 10-Q/10-K filings and Form 4 insider activity (free).
* **Web research** — a developer scraping API (Firecrawl) for niche blogs and
  regional outlets when nothing else has coverage.

Every client is network-optional: ``requests`` is imported lazily, credentials
come from the environment, and any failure degrades to empty rather than raising.
A parallel set of ``Sim*`` providers returns deterministic data so the pipeline
is fully testable and demonstrable offline (``build_research_bundle(sim=True)``).
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field


# --------------------------------------------------------------------------- #
# Data shapes
# --------------------------------------------------------------------------- #
@dataclass
class Fundamentals:
    ticker: str
    name: str = ""
    market_cap: float | None = None
    debt_to_equity: float | None = None
    current_ratio: float | None = None
    cash: float | None = None
    revenue_growth: float | None = None  # YoY, as a fraction (0.2 == +20%)
    free_cash_flow: float | None = None
    source: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Filing:
    form: str
    title: str
    date: str
    url: str


@dataclass
class InsiderTrade:
    insider: str
    relation: str
    transaction: str  # "buy" / "sell"
    shares: float
    date: str


@dataclass
class ScreenResult:
    ticker: str
    name: str
    market_cap: float
    volume: float
    sector: str


# --------------------------------------------------------------------------- #
# Real clients (network-optional, lazy requests, graceful degradation)
# --------------------------------------------------------------------------- #
def _get(url: str, *, params: dict | None = None, headers: dict | None = None,
         timeout: float = 10.0):
    import requests

    resp = requests.get(url, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


class FmpClient:
    """Financial Modeling Prep — screener + fundamentals. Needs FMP_API_KEY."""

    BASE = "https://financialmodelingprep.com/api/v3"

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.getenv("FMP_API_KEY")

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def screen_small_caps(self, sector: str, market_cap_max: float,
                          min_volume: float, limit: int = 25) -> list[ScreenResult]:
        if not self.available:
            return []
        try:
            rows = _get(f"{self.BASE}/stock-screener", params={
                "sector": sector,
                "marketCapLowerThan": int(market_cap_max),
                "volumeMoreThan": int(min_volume),
                "isActivelyTrading": "true",
                "exchange": "NASDAQ,NYSE,AMEX",
                "limit": limit,
                "apikey": self.api_key,
            })
        except Exception:  # noqa: BLE001 — degrade to empty
            return []
        out = []
        for r in rows or []:
            out.append(ScreenResult(
                ticker=r.get("symbol", ""), name=r.get("companyName", ""),
                market_cap=float(r.get("marketCap") or 0),
                volume=float(r.get("volume") or 0), sector=r.get("sector", sector),
            ))
        return out

    def fundamentals(self, ticker: str) -> Fundamentals | None:
        if not self.available:
            return None
        try:
            profile = _get(f"{self.BASE}/profile/{ticker}",
                           params={"apikey": self.api_key})
            ratios = _get(f"{self.BASE}/ratios-ttm/{ticker}",
                          params={"apikey": self.api_key})
        except Exception:  # noqa: BLE001
            return None
        p = (profile or [{}])[0]
        r = (ratios or [{}])[0]
        return Fundamentals(
            ticker=ticker, name=p.get("companyName", ""),
            market_cap=_f(p.get("mktCap")),
            debt_to_equity=_f(r.get("debtEquityRatioTTM")),
            current_ratio=_f(r.get("currentRatioTTM")),
            cash=_f(p.get("cash")),
            revenue_growth=_f(r.get("revenueGrowthTTM")),
            free_cash_flow=_f(r.get("freeCashFlowPerShareTTM")),
            source="fmp",
        )


class EdgarClient:
    """SEC EDGAR — recent filings + Form 4 insider activity. Free, no API key.

    SEC requires a descriptive User-Agent with contact info; set SEC_EDGAR_USER_AGENT
    (e.g. "yourname you@example.com"). Maps ticker→CIK via the public mapping file.
    """

    SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
    TICKERS = "https://www.sec.gov/files/company_tickers.json"

    def __init__(self, user_agent: str | None = None) -> None:
        self.user_agent = (user_agent or os.getenv("SEC_EDGAR_USER_AGENT")
                           or "autonomous-trading-bot research@example.com")
        self._cik_map: dict[str, int] | None = None

    @property
    def available(self) -> bool:
        return True  # free endpoint

    def _headers(self) -> dict:
        return {"User-Agent": self.user_agent, "Accept-Encoding": "gzip, deflate"}

    def _cik(self, ticker: str) -> int | None:
        if self._cik_map is None:
            try:
                data = _get(self.TICKERS, headers=self._headers())
                self._cik_map = {v["ticker"].upper(): int(v["cik_str"])
                                 for v in data.values()}
            except Exception:  # noqa: BLE001
                self._cik_map = {}
        return self._cik_map.get(ticker.upper())

    def recent_filings(self, ticker: str, *, forms: tuple[str, ...] = ("10-Q", "10-K"),
                       limit: int = 5) -> list[Filing]:
        cik = self._cik(ticker)
        if cik is None:
            return []
        try:
            data = _get(self.SUBMISSIONS.format(cik=cik), headers=self._headers())
        except Exception:  # noqa: BLE001
            return []
        recent = data.get("filings", {}).get("recent", {})
        forms_list = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accns = recent.get("accessionNumber", [])
        docs = recent.get("primaryDocument", [])
        out: list[Filing] = []
        for i, form in enumerate(forms_list):
            if form not in forms:
                continue
            accn = accns[i].replace("-", "") if i < len(accns) else ""
            doc = docs[i] if i < len(docs) else ""
            url = (f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn}/{doc}"
                   if accn else "")
            out.append(Filing(form=form, title=f"{ticker} {form}",
                              date=dates[i] if i < len(dates) else "", url=url))
            if len(out) >= limit:
                break
        return out

    def insider_activity(self, ticker: str, *, limit: int = 5) -> list[InsiderTrade]:
        # Form 4 filings flag insider transactions; we surface their existence.
        filings = self.recent_filings(ticker, forms=("4",), limit=limit)
        return [InsiderTrade(insider="(see Form 4)", relation="insider",
                             transaction="filed", shares=0.0, date=f.date)
                for f in filings]


class FirecrawlClient:
    """Firecrawl developer scraping API — targeted web search → markdown.

    Needs FIRECRAWL_API_KEY. Used to pull raw markdown from niche investor blogs
    and regional outlets that don't appear in a generic news feed.
    """

    SEARCH = "https://api.firecrawl.dev/v1/search"

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.getenv("FIRECRAWL_API_KEY")

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def search_markdown(self, query: str, *, limit: int = 5) -> list[dict]:
        if not self.available:
            return []
        try:
            import requests

            resp = requests.post(
                self.SEARCH,
                headers={"Authorization": f"Bearer {self.api_key}",
                         "Content-Type": "application/json"},
                json={"query": query, "limit": limit,
                      "scrapeOptions": {"formats": ["markdown"]}},
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception:  # noqa: BLE001
            return []
        out = []
        for item in data.get("data", []) or []:
            out.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": (item.get("markdown") or item.get("description") or "")[:600],
            })
        return out


def _f(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# Sim providers (deterministic, offline)
# --------------------------------------------------------------------------- #
class SimResearch:
    """Deterministic offline research data for demos and tests."""

    available = True

    def screen_small_caps(self, sector, market_cap_max, min_volume, limit=25):
        base = sector[:3].upper() if sector else "SML"
        return [
            ScreenResult(f"{base}{i}", f"{sector.title()} SmallCo {i}",
                         market_cap=300_000_000 + i * 5_000_000,
                         volume=150_000 + i * 1000, sector=sector)
            for i in range(1, 4)
        ]

    def fundamentals(self, ticker):
        # A plausible, reasonably healthy small-cap profile.
        return Fundamentals(
            ticker=ticker, name=f"{ticker} Inc", market_cap=420_000_000,
            debt_to_equity=0.6, current_ratio=2.1, cash=85_000_000,
            revenue_growth=0.18, free_cash_flow=1.2, source="sim",
        )

    def recent_filings(self, ticker, *, forms=("10-Q", "10-K"), limit=5):
        return [Filing("10-Q", f"{ticker} Quarterly Report", "2026-05-15",
                       "https://sec.gov/sim/10q"),
                Filing("10-K", f"{ticker} Annual Report", "2026-02-20",
                       "https://sec.gov/sim/10k")]

    def insider_activity(self, ticker, *, limit=5):
        return [InsiderTrade("Jane Founder", "CEO", "buy", 25_000, "2026-06-01")]

    def search_markdown(self, query, *, limit=5):
        return [{"title": "Deep dive on a small-cap", "url": "https://blog.example/x",
                 "snippet": ("Niche investor blog: improving margins, growing "
                             "backlog, and management guiding to positive FCF.")}]


# --------------------------------------------------------------------------- #
# Bundle — what the tools talk to
# --------------------------------------------------------------------------- #
@dataclass
class ResearchBundle:
    """Composite over the research sub-clients. Any may be None/unavailable; the
    bundle always returns a safe empty result instead of raising."""

    fundamentals_client: object | None = None
    sec_client: object | None = None
    web_client: object | None = None
    screener_client: object | None = None
    capabilities: list[str] = field(default_factory=list)

    def get_fundamentals(self, ticker: str) -> Fundamentals | None:
        if self.fundamentals_client and getattr(self.fundamentals_client, "available", True):
            return self.fundamentals_client.fundamentals(ticker)
        return None

    def get_sec_filings(self, ticker: str) -> list[Filing]:
        if self.sec_client:
            return self.sec_client.recent_filings(ticker)
        return []

    def get_insider_activity(self, ticker: str) -> list[InsiderTrade]:
        if self.sec_client:
            return self.sec_client.insider_activity(ticker)
        return []

    def web_research(self, query: str) -> list[dict]:
        if self.web_client and getattr(self.web_client, "available", True):
            return self.web_client.search_markdown(query)
        return []

    def discover_small_caps(self, sector: str, market_cap_max: float,
                            min_volume: float) -> list[ScreenResult]:
        if self.screener_client and getattr(self.screener_client, "available", True):
            return self.screener_client.screen_small_caps(sector, market_cap_max, min_volume)
        return []


def build_research_bundle(*, sim: bool = False) -> ResearchBundle:
    """Construct a research bundle, choosing sim or real clients per credential.

    Real selection (when ``sim`` is False):
      * Screener + fundamentals: FMP if FMP_API_KEY is set.
      * SEC EDGAR: always (free).
      * Web research: Firecrawl if FIRECRAWL_API_KEY is set.
    """
    if sim:
        sim_provider = SimResearch()
        return ResearchBundle(
            fundamentals_client=sim_provider, sec_client=sim_provider,
            web_client=sim_provider, screener_client=sim_provider,
            capabilities=["sim:fundamentals", "sim:sec", "sim:web", "sim:screener"],
        )

    caps: list[str] = []
    fmp = FmpClient()
    edgar = EdgarClient()
    firecrawl = FirecrawlClient()
    if fmp.available:
        caps += ["fmp:fundamentals", "fmp:screener"]
    caps.append("edgar:sec")
    if firecrawl.available:
        caps.append("firecrawl:web")
    return ResearchBundle(
        fundamentals_client=fmp if fmp.available else None,
        sec_client=edgar,
        web_client=firecrawl if firecrawl.available else None,
        screener_client=fmp if fmp.available else None,
        capabilities=caps,
    )

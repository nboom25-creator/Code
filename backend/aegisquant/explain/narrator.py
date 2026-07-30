"""Plain-language explanation of decisions.

The explanation is generated **deterministically from the recorded inputs**. It
is a rendering of the audit record, not a separate narrative, which is what makes
it impossible for the explanation to contradict what actually happened: every
number in the sentence is read out of the same dict that was persisted.

A language model may be used to *rephrase* an explanation for readability
(``polish=True`` with ``AEGIS_LLM_ENABLED``), but the deterministic text is always
what is stored, and the polished version is checked for numeric consistency
before being shown. If the check fails, the deterministic text is used.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from aegisquant.db import enums as E
from aegisquant.logging_setup import get_logger

log = get_logger(__name__)


def _pct(value: Any, digits: int = 1) -> str:
    if value is None:
        return "not available"
    try:
        return f"{float(value):.{digits}%}"
    except (TypeError, ValueError):
        return str(value)


def _num(value: Any, digits: int = 2) -> str:
    if value is None:
        return "not available"
    try:
        return f"{float(value):,.{digits}f}"
    except (TypeError, ValueError):
        return str(value)


def _money(value: Any) -> str:
    if value is None:
        return "not available"
    try:
        return f"${float(value):,.2f}"
    except (TypeError, ValueError):
        return str(value)


def _ordinal_decile(rank: float | None) -> str | None:
    """Turn a percentile in [0,1] into readable positioning."""
    if rank is None:
        return None
    if rank >= 0.9:
        return "top decile"
    if rank >= 0.8:
        return "top quintile"
    if rank >= 0.66:
        return "top third"
    if rank >= 0.5:
        return "upper half"
    if rank >= 0.33:
        return "lower half"
    return "bottom third"


# ---------------------------------------------------------------------------
def explain_decision(
    *,
    action: E.DecisionAction,
    symbol: str,
    quantity: Decimal | None,
    approved_quantity: Decimal | None,
    reference_price: Decimal | None,
    strategy_key: str | None,
    strategies: list[str] | None = None,
    confidence: Decimal | None = None,
    signal_inputs: dict[str, Any] | None = None,
    sizing_detail: dict[str, Any] | None = None,
    risk_verdict: dict[str, Any] | None = None,
    regime: E.Regime | None = None,
    sector: str | None = None,
    expected_return: Decimal | None = None,
    expected_holding_days: int | None = None,
    growth_score: Decimal | None = None,
    growth_components: dict[str, Any] | None = None,
    exit_criteria: dict[str, Any] | None = None,
    estimated_cost_bps: Decimal | None = None,
    weaknesses: list[str] | None = None,
    thesis: str | None = None,
) -> str:
    """Render a decision as plain English, using only the recorded values."""
    signal_inputs = signal_inputs or {}
    parts: list[str] = []

    # -- headline ---------------------------------------------------------
    qty = approved_quantity if approved_quantity is not None else quantity
    if action in (E.DecisionAction.BUY, E.DecisionAction.ADD):
        verb = "Purchased" if action is E.DecisionAction.BUY else "Added"
        headline = f"{verb} {_num(qty, 0) if qty else 'no'} shares of {symbol}"
        if reference_price:
            headline += f" at a reference price of {_money(reference_price)}"
    elif action in (E.DecisionAction.SELL, E.DecisionAction.EXIT):
        headline = f"Exited {_num(qty, 0) if qty else 'the'} shares of {symbol}"
    elif action is E.DecisionAction.TRIM:
        headline = f"Reduced the {symbol} position by {_num(qty, 0) if qty else 'part'} shares"
    else:
        headline = f"Held {symbol} without trading"

    # -- primary reasons, drawn from the actual signal values -------------
    reasons: list[str] = []
    rank = signal_inputs.get("rel_strength_126_rank") or signal_inputs.get("momentum_12_1_rank")
    positioning = _ordinal_decile(rank if isinstance(rank, (int, float)) else None)
    if positioning and signal_inputs.get("rel_strength_126") is not None:
        reasons.append(
            f"its six-month relative strength of {_pct(signal_inputs['rel_strength_126'])} "
            f"ranked in the {positioning} of the evaluated universe"
        )
    elif signal_inputs.get("rel_strength_126") is not None:
        reasons.append(f"it outperformed the benchmark by {_pct(signal_inputs['rel_strength_126'])} over 126 sessions")

    if signal_inputs.get("momentum_12_1") is not None and not positioning:
        reasons.append(f"twelve-month momentum was {_pct(signal_inputs['momentum_12_1'])}")
    if signal_inputs.get("revenue_growth_yoy") is not None:
        reasons.append(f"revenue grew {_pct(signal_inputs['revenue_growth_yoy'])} year over year")
    if signal_inputs.get("revenue_growth_accel") is not None:
        accel = float(signal_inputs["revenue_growth_accel"])
        reasons.append(
            f"the growth rate {'accelerated' if accel > 0 else 'decelerated'} by "
            f"{abs(accel):.1%} versus the prior comparison"
        )
    if signal_inputs.get("roic") is not None:
        reasons.append(f"return on invested capital was {_pct(signal_inputs['roic'])}")
    if signal_inputs.get("gross_margin") is not None and signal_inputs.get("roic") is None:
        reasons.append(f"gross margin was {_pct(signal_inputs['gross_margin'])}")
    if signal_inputs.get("accruals_ratio") is not None:
        reasons.append(
            f"the earnings-quality filter passed with an accruals ratio of {_num(signal_inputs['accruals_ratio'], 3)}"
        )
    if signal_inputs.get("breakout_55") is not None and signal_inputs.get("consolidation_days"):
        reasons.append(f"it broke out of a {_num(signal_inputs['consolidation_days'], 0)}-session base")
    if signal_inputs.get("volume_ratio_20") is not None:
        vr = float(signal_inputs["volume_ratio_20"])
        if vr > 1.2:
            reasons.append(f"volume ran at {vr:.2f} times its twenty-session average")
    if signal_inputs.get("earnings_gap_pct") is not None:
        reasons.append(f"the stock gapped {_pct(signal_inputs['earnings_gap_pct'])} on its most recent report")
    if signal_inputs.get("sector_composite_63") is not None:
        reasons.append(f"its sector led the market by {_pct(signal_inputs['sector_composite_63'])} over 63 sessions")
    if signal_inputs.get("risk_on_score") is not None:
        reasons.append(f"the composite risk-on score was {_num(signal_inputs['risk_on_score'])}")

    if growth_score is not None:
        reasons.append(f"the Growth Opportunity Score was {_num(growth_score, 0)} out of 100")

    if reasons:
        parts.append(f"{headline} because {_join(reasons)}.")
    elif thesis:
        parts.append(f"{headline}. {thesis}")
    else:
        parts.append(f"{headline}.")

    # -- portfolio context -------------------------------------------------
    context: list[str] = []
    if sector and risk_verdict:
        sector_check = _find_check(risk_verdict, "max_sector_exposure")
        if sector_check and sector_check.get("observed") is not None:
            context.append(
                f"the portfolio remained below its {sector} sector limit "
                f"({_pct(sector_check['observed'])} against a limit of {_pct(sector_check.get('limit'))})"
            )
    if risk_verdict:
        pos_check = _find_check(risk_verdict, "max_position_pct")
        if pos_check and pos_check.get("observed") is not None:
            context.append(
                f"the position represents {_pct(pos_check['observed'])} of equity against a "
                f"{_pct(pos_check.get('limit'))} single-name cap"
            )
    if context:
        parts.append(f"At the time of the order {_join(context)}.")

    # -- sizing explanation ------------------------------------------------
    if sizing_detail:
        sizing_bits: list[str] = []
        binding = sizing_detail.get("binding_constraint")
        conviction = sizing_detail.get("components", {}).get("conviction_multiplier")
        corr = sizing_detail.get("components", {}).get("correlation_multiplier")
        regime_scale = sizing_detail.get("components", {}).get("regime_scale")
        method = sizing_detail.get("method")
        if method:
            sizing_bits.append(f"sized using {method.replace('_', ' ')}")
        if conviction is not None and float(conviction) < 1:
            sizing_bits.append(f"scaled to {_pct(conviction, 0)} for conviction")
        if corr is not None and float(corr) < 1:
            sizing_bits.append(f"reduced to {_pct(corr, 0)} because it correlates with existing holdings")
        if regime_scale is not None and float(regime_scale) < 1:
            sizing_bits.append(f"halved for the {regime.value if regime else 'current'} market regime")
        if binding:
            sizing_bits.append(f"ultimately bounded by {binding.replace('_', ' ')}")
        if sizing_bits:
            parts.append(f"Position size was {_join(sizing_bits)}.")

    if risk_verdict and risk_verdict.get("resized_by"):
        parts.append(
            "The risk engine reduced the order from "
            f"{_num(quantity, 0)} to {_num(approved_quantity, 0)} shares because of "
            f"{_join([r.replace('_', ' ') for r in risk_verdict['resized_by']])}."
        )

    # -- volatility / risk note -------------------------------------------
    vol = signal_inputs.get("realized_vol_63") or signal_inputs.get("realized_vol_21")
    if vol is not None and float(vol) > 0.45:
        parts.append(f"Position size was reduced because current volatility is elevated at {_pct(vol)} annualised.")

    # -- expectations ------------------------------------------------------
    expectations: list[str] = []
    if expected_return is not None:
        expectations.append(f"an expected return of {_pct(expected_return)}")
    if expected_holding_days:
        expectations.append(f"an expected holding period of about {expected_holding_days} sessions")
    if estimated_cost_bps is not None:
        expectations.append(f"estimated round-trip costs of {_num(estimated_cost_bps, 0)} basis points")
    if expectations:
        parts.append(f"The trade was entered with {_join(expectations)}.")

    if confidence is not None:
        parts.append(
            f"Confidence was {_pct(confidence, 0)}"
            + (f", combining signals from {_join(strategies)}" if strategies and len(strategies) > 1 else "")
            + "."
        )

    # -- exit plan ---------------------------------------------------------
    if exit_criteria:
        exits = _describe_exits(exit_criteria)
        if exits:
            parts.append(f"The position will be exited if {_join(exits)}.")

    # -- honest weaknesses -------------------------------------------------
    if weaknesses:
        parts.append(f"Known weaknesses in this case: {'; '.join(weaknesses[:3])}.")

    if action is E.DecisionAction.HOLD and risk_verdict and risk_verdict.get("rejections"):
        parts.append("No order was placed because " + _join(list(risk_verdict["rejections"][:2])) + ".")

    return " ".join(parts)


def _describe_exits(criteria: dict[str, Any]) -> list[str]:
    out: list[str] = []
    mapping = {
        "trailing_stop_pct": lambda v: f"it falls {_pct(v, 0)} from its peak",
        "stop_loss_pct": lambda v: f"it falls {_pct(v, 0)} below the entry price",
        "close_below_sma": lambda v: f"it closes below its {int(v)}-session moving average",
        "momentum_rank_below": lambda v: f"its momentum rank drops below the {_pct(v, 0)} percentile",
        "revenue_growth_below": lambda v: f"revenue growth falls below {_pct(v)}",
        "gross_margin_delta_below": lambda v: f"gross margin contracts by more than {_pct(abs(float(v)))}",
        "roic_below": lambda v: f"return on invested capital falls below {_pct(v)}",
        "growth_adjusted_ps_above": lambda v: f"its growth-adjusted valuation exceeds {_num(v)}",
        "max_holding_days": lambda v: f"it has been held for {int(v)} sessions",
        "rsi_above": lambda v: f"RSI recovers above {int(v)}",
        "risk_on_below": lambda v: f"the risk-on score falls below {_num(v)}",
        "adv_usd_below": lambda v: f"daily dollar volume falls below {_money(v)}",
        "sector_rel_strength_below": lambda v: f"it lags its sector by more than {_pct(abs(float(v)))}",
        "realized_vol_above": lambda v: f"realised volatility exceeds {_pct(v)}",
        "max_days_since_earnings": lambda v: f"more than {int(v)} sessions have passed since the report",
    }
    for key, value in criteria.items():
        if value is None or value is False:
            continue
        renderer = mapping.get(key)
        if renderer:
            try:
                out.append(renderer(value))
            except (TypeError, ValueError):
                continue
    return out


def _find_check(risk_verdict: dict[str, Any], name: str) -> dict[str, Any] | None:
    for check in risk_verdict.get("checks", []) or []:
        if check.get("name") == name:
            return check
    return None


def _join(items: list[str]) -> str:
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"


# ---------------------------------------------------------------------------
def explain_review(
    *,
    symbol: str,
    action: str,
    thesis_status: str,
    reason: str,
    signal_inputs: dict[str, Any] | None = None,
    unrealized_pnl_pct: Decimal | None = None,
    holding_days: int | None = None,
) -> str:
    parts = []
    verb = {
        "hold": "Holding",
        "add": "Adding to",
        "trim": "Reducing",
        "exit": "Exiting",
    }.get(action, "Reviewing")
    opener = f"{verb} {symbol}"
    if unrealized_pnl_pct is not None:
        direction = "up" if float(unrealized_pnl_pct) >= 0 else "down"
        opener += f", currently {direction} {_pct(abs(float(unrealized_pnl_pct)))}"
    if holding_days is not None:
        opener += f" after {holding_days} sessions"
    parts.append(f"{opener}: {reason}.")

    if thesis_status != "intact":
        parts.append(f"The entry thesis is now assessed as {thesis_status}.")
    else:
        parts.append("The entry thesis remains intact.")

    inputs = signal_inputs or {}
    evidence = []
    for key, label in (
        ("trend_63", "price versus its 63-session average"),
        ("trend_126", "price versus its 126-session average"),
        ("trend_252", "price versus its 252-session average"),
        ("rel_strength_126", "relative strength over 126 sessions"),
        ("revenue_growth_yoy", "year-over-year revenue growth"),
        ("revenue_growth_accel", "change in the growth rate"),
        ("gross_margin_delta_yoy", "year-over-year margin change"),
        ("adv_usd_20", "twenty-session dollar volume"),
        ("risk_on_score", "composite risk-on score"),
    ):
        if inputs.get(key) is not None:
            formatter = _money if key == "adv_usd_20" else (_num if key == "risk_on_score" else _pct)
            evidence.append(f"{label} at {formatter(inputs[key])}")
    if evidence:
        parts.append(f"Reviewed against {_join(evidence)}.")
    return " ".join(parts)


def explain_risk_verdict(verdict: dict[str, Any], symbol: str) -> str:
    """Human-readable summary of what the risk engine did and why."""
    if not verdict.get("approved"):
        rejections = verdict.get("rejections") or ["no reason recorded"]
        return (
            f"The risk engine blocked this {symbol} order. "
            f"{len(rejections)} check(s) failed: {'; '.join(rejections[:3])}."
        )
    parts = [f"The risk engine approved {verdict.get('approved_quantity')} shares of {symbol}."]
    if verdict.get("was_resized"):
        parts.append(
            f"The requested {verdict.get('original_quantity')} shares were reduced by "
            f"{_join([r.replace('_', ' ') for r in verdict.get('resized_by', [])])}."
        )
    checks = verdict.get("checks") or []
    passed = sum(1 for c in checks if c.get("result") == "pass")
    parts.append(f"{passed} of {len(checks)} limits passed with headroom to spare.")
    if verdict.get("warnings"):
        parts.append(f"Warnings raised: {'; '.join(verdict['warnings'][:2])}.")
    return " ".join(parts)


# ---------------------------------------------------------------------------
_NUMBER_RE = re.compile(r"-?\d[\d,]*\.?\d*%?")


def numbers_in(text: str) -> set[str]:
    return {m.group(0).replace(",", "") for m in _NUMBER_RE.finditer(text)}


def polish_is_consistent(deterministic: str, polished: str) -> bool:
    """Reject an LLM rewrite that introduces or changes any number.

    This is the guard that stops a "nicer" explanation from being a different
    explanation. Only a rewrite whose numeric content is a subset of the
    deterministic text is allowed to be shown.
    """
    return numbers_in(polished).issubset(numbers_in(deterministic))

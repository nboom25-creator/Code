"""Decimal-safe money and quantity arithmetic.

Prices, notionals and cash are :class:`~decimal.Decimal` everywhere they are
persisted or compared against a limit. Floats are used only inside numerical
research code (feature maths, optimisation) where they never touch accounting.
"""

from __future__ import annotations

from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

CENT = Decimal("0.01")
PRICE_Q = Decimal("0.0001")
QTY_Q = Decimal("0.000001")  # fractional-share precision
ZERO = Decimal("0")


def D(value: Any) -> Decimal:
    """Coerce anything numeric to Decimal without float artefacts.

    Handles numpy scalars explicitly: ``repr(np.float64(1.5))`` is
    ``'np.float64(1.5)'`` under NumPy 2.x, which is not parseable as a Decimal.
    """
    if isinstance(value, Decimal):
        return value
    if value is None:
        return ZERO
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        try:  # numpy scalar -> python scalar
            value = value.item()
        except (AttributeError, ValueError):  # pragma: no cover
            pass
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError(f"cannot convert non-finite float {value!r} to Decimal")
        return Decimal(repr(value))
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"cannot convert {value!r} to Decimal") from exc


def money(value: Any) -> Decimal:
    return D(value).quantize(CENT, rounding=ROUND_HALF_UP)


def price(value: Any) -> Decimal:
    return D(value).quantize(PRICE_Q, rounding=ROUND_HALF_UP)


def qty(value: Any, allow_fractional: bool = True) -> Decimal:
    """Round a quantity *down* — never size up past a limit through rounding."""
    v = D(value)
    if not allow_fractional:
        return v.quantize(Decimal("1"), rounding=ROUND_DOWN)
    return v.quantize(QTY_Q, rounding=ROUND_DOWN)


def pct(value: Any) -> Decimal:
    return D(value).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def safe_div(num: Any, den: Any, default: Decimal = ZERO) -> Decimal:
    n, d = D(num), D(den)
    if d == 0:
        return default
    return n / d


def bps(fraction: Any) -> Decimal:
    """Fraction -> basis points."""
    return (D(fraction) * Decimal(10_000)).quantize(Decimal("0.01"))

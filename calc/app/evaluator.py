"""Safe, deterministic calculation engine for EngineerTutor.

Uses Pint for units / dimensional analysis and a *restricted* AST evaluator so
arbitrary user/AI code can never run. Only numeric literals, the named input
variables, a whitelist of math functions, and basic arithmetic operators are
allowed — anything else raises ``CalcError``.

This is the deterministic layer the spec requires: the AI proposes a
calculation, this service executes it, validates units, and returns a result
the app renders in student-friendly language.
"""

from __future__ import annotations

import ast
import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List

import pint
import sympy

ureg = pint.UnitRegistry()
Q_ = ureg.Quantity


class CalcError(Exception):
    """Raised for unsafe expressions, unknown units, or bad dimensions."""


# Whitelisted callables. Each accepts Pint quantities. Transcendental functions
# require dimensionless arguments (enforced by Pint / our wrappers).
def _dimensionless(x: Any) -> float:
    if isinstance(x, ureg.Quantity):
        if not x.dimensionless:
            raise CalcError(f"Argument to this function must be dimensionless, got {x.units}")
        return float(x.to_base_units().magnitude)
    return float(x)


def _sqrt(x: Any) -> Any:
    if isinstance(x, ureg.Quantity):
        return x ** 0.5
    return math.sqrt(x)


ALLOWED_FUNCS = {
    "sqrt": _sqrt,
    "abs": abs,
    "sin": lambda x: math.sin(_dimensionless(x)),
    "cos": lambda x: math.cos(_dimensionless(x)),
    "tan": lambda x: math.tan(_dimensionless(x)),
    "asin": lambda x: math.asin(_dimensionless(x)),
    "acos": lambda x: math.acos(_dimensionless(x)),
    "atan": lambda x: math.atan(_dimensionless(x)),
    "exp": lambda x: math.exp(_dimensionless(x)),
    "log": lambda x: math.log(_dimensionless(x)),
    "ln": lambda x: math.log(_dimensionless(x)),
    "log10": lambda x: math.log10(_dimensionless(x)),
}

ALLOWED_CONSTS = {"pi": math.pi, "e": math.e}

_ALLOWED_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Pow,
    ast.Mod,
    ast.USub,
    ast.UAdd,
    ast.Num,  # deprecated but kept for older pythons
    ast.Constant,
    ast.Name,
    ast.Load,
    ast.Call,
)


def _eval_node(node: ast.AST, env: Dict[str, Any]) -> Any:
    if not isinstance(node, _ALLOWED_NODES):
        raise CalcError(f"Disallowed expression element: {type(node).__name__}")

    if isinstance(node, ast.Expression):
        return _eval_node(node.body, env)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise CalcError("Only numeric constants are allowed")
    if isinstance(node, ast.Name):
        if node.id in env:
            return env[node.id]
        if node.id in ALLOWED_CONSTS:
            return ALLOWED_CONSTS[node.id]
        raise CalcError(f"Unknown symbol: {node.id}")
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, env)
        right = _eval_node(node.right, env)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.Pow):
            return left ** right
        if isinstance(node.op, ast.Mod):
            return left % right
    if isinstance(node, ast.UnaryOp):
        val = _eval_node(node.operand, env)
        return -val if isinstance(node.op, ast.USub) else +val
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCS:
            raise CalcError("Only whitelisted math functions may be called")
        if node.keywords:
            raise CalcError("Keyword arguments are not allowed")
        args = [_eval_node(a, env) for a in node.args]
        return ALLOWED_FUNCS[node.func.id](*args)
    raise CalcError(f"Disallowed expression element: {type(node).__name__}")


_NUM_UNIT = re.compile(r"^\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(.+?)\s*$")


def parse_quantity(spec: str) -> Any:
    """Parse a "value unit" string (e.g. "4186 J/(kg*K)", "25 degC") into a
    Pint quantity.

    We split the leading number from the unit and use the two-argument
    ``Q_(value, unit)`` form. This is REQUIRED for offset units like degC/degF —
    the one-argument string form (``Q_("25 degC")``) is ambiguous and raises.
    """
    spec = spec.strip()
    if not spec:
        raise CalcError("Empty quantity")
    m = _NUM_UNIT.match(spec)
    try:
        if m:
            return Q_(float(m.group(1)), m.group(2))
        # No explicit "<number> <unit>" split: a bare number or bare unit.
        return Q_(spec)
    except Exception as exc:  # pint.errors.*
        raise CalcError(f"Could not parse quantity '{spec}': {exc}") from exc


@dataclass
class CalcResult:
    ok: bool
    value: float | None = None
    unit: str | None = None
    latex: str | None = None
    dimensionallyConsistent: bool | None = None
    message: str = ""
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "value": self.value,
            "unit": self.unit,
            "latex": self.latex,
            "dimensionallyConsistent": self.dimensionallyConsistent,
            "message": self.message,
            "warnings": self.warnings,
        }


def latex_of(expression: str) -> str | None:
    try:
        return sympy.latex(sympy.sympify(expression, evaluate=False))
    except Exception:
        return None


def evaluate(expression: str, variables: Dict[str, str], expectedUnit: str = "") -> CalcResult:
    """Evaluate ``expression`` with unit-carrying ``variables``.

    Returns a CalcResult. Dimensional errors are reported, never hidden.
    """
    warnings: List[str] = []

    # Parse the variable quantities.
    env: Dict[str, Any] = {}
    for sym, spec in variables.items():
        if not sym.isidentifier():
            return CalcResult(ok=False, message=f"Invalid variable name: {sym}")
        try:
            env[sym] = parse_quantity(spec)
        except CalcError as exc:
            return CalcResult(ok=False, message=str(exc))

    # Flag common engineering unit pitfalls.
    joined_units = " ".join(variables.values()).lower()
    if "degc" in joined_units or "°c" in joined_units or "celsius" in joined_units:
        warnings.append(
            "Celsius detected: ensure you intend an absolute temperature, not a ΔT. "
            "Temperature differences should use kelvin (K) or delta_degC."
        )
    if "psi" in joined_units or "bar" in joined_units:
        warnings.append("Pressure detected: confirm whether values are gauge or absolute.")

    # Safely evaluate the expression.
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        return CalcResult(ok=False, message=f"Could not parse expression: {exc}")
    try:
        result = _eval_node(tree, env)
    except CalcError as exc:
        return CalcResult(ok=False, message=str(exc), warnings=warnings)
    except pint.errors.DimensionalityError as exc:
        return CalcResult(
            ok=False,
            dimensionallyConsistent=False,
            message=f"Dimensional inconsistency in expression: {exc}",
            warnings=warnings,
        )
    except Exception as exc:  # pragma: no cover - defensive
        return CalcResult(ok=False, message=f"Evaluation failed: {exc}", warnings=warnings)

    latex = latex_of(expression)

    # Coerce to a Pint quantity for uniform handling.
    if not isinstance(result, ureg.Quantity):
        result = Q_(result, "dimensionless")

    dimensionally_consistent: bool | None = None
    if expectedUnit:
        try:
            converted = result.to(expectedUnit)
            dimensionally_consistent = True
            return CalcResult(
                ok=True,
                value=float(converted.magnitude),
                unit=str(expectedUnit),
                latex=latex,
                dimensionallyConsistent=True,
                message="Evaluated and unit-checked with SymPy + Pint.",
                warnings=warnings,
            )
        except pint.errors.DimensionalityError as exc:
            return CalcResult(
                ok=True,
                value=float(result.magnitude),
                unit=str(result.units),
                latex=latex,
                dimensionallyConsistent=False,
                message=(
                    f"Result is {result.units}, which is NOT compatible with the expected "
                    f"unit {expectedUnit}: {exc}"
                ),
                warnings=warnings,
            )
        except Exception as exc:
            return CalcResult(ok=False, message=f"Unit conversion failed: {exc}", warnings=warnings)

    return CalcResult(
        ok=True,
        value=float(result.magnitude),
        unit=str(result.units),
        latex=latex,
        dimensionallyConsistent=dimensionally_consistent,
        message="Evaluated with SymPy + Pint.",
        warnings=warnings,
    )

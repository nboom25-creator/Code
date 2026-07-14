"""FastAPI entrypoint for the EngineerTutor calculation service."""

from __future__ import annotations

from typing import Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from .evaluator import evaluate, parse_quantity, CalcError, ureg

app = FastAPI(title="EngineerTutor Calc Service", version="0.1.0")

# The Next.js app calls this service server-to-server; CORS is permissive for
# local dev but the service holds no secrets and executes no arbitrary code.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class EvaluateRequest(BaseModel):
    expression: str = Field(..., max_length=2000)
    variables: Dict[str, str] = Field(default_factory=dict)
    expectedUnit: str = ""


class ConvertRequest(BaseModel):
    value: float
    from_unit: str = Field(..., alias="from")
    to_unit: str = Field(..., alias="to")
    is_delta: bool = False

    model_config = ConfigDict(populate_by_name=True)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "engine": "sympy+pint"}


@app.post("/evaluate")
def evaluate_endpoint(req: EvaluateRequest) -> Dict:
    result = evaluate(req.expression, req.variables, req.expectedUnit)
    return result.to_dict()


_OFFSET_TEMPS = {"degc", "degf", "celsius", "fahrenheit"}


def _delta_unit(unit: str) -> str:
    """Map an offset temperature unit to its Pint 'delta_' form; kelvin stays as
    kelvin (Pint has no delta_kelvin — kelvin is already an absolute-scale unit)."""
    u = unit.lower()
    if u in _OFFSET_TEMPS:
        return f"delta_{unit}"
    if u in {"k", "kelvin"}:
        return "kelvin"
    return unit


@app.post("/convert")
def convert_endpoint(req: ConvertRequest) -> Dict:
    """Unit conversion. Set ``is_delta`` for a temperature DIFFERENCE (ΔT) so a
    5 °F change converts as 5·(5/9) K rather than through the offset."""
    try:
        if req.is_delta:
            q = ureg.Quantity(req.value, _delta_unit(req.from_unit))
            out = q.to(_delta_unit(req.to_unit))
        else:
            q = ureg.Quantity(req.value, req.from_unit)
            out = q.to(req.to_unit)
        return {"ok": True, "value": float(out.magnitude), "unit": str(out.units)}
    except Exception as exc:  # noqa: BLE001 - report all errors to the caller
        return {"ok": False, "message": str(exc)}

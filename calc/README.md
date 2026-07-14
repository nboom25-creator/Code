# EngineerTutor — Calculation Service

Deterministic engineering calculations for EngineerTutor, using **SymPy**
(symbolic) and **Pint** (units / dimensional analysis). The AI proposes a
structured calculation; this service executes it in a **restricted AST
sandbox** (no arbitrary code), validates units, and returns a result the web
app renders in plain language.

## Endpoints

- `GET /health` → `{ "status": "ok", "engine": "sympy+pint" }`
- `POST /evaluate` → evaluate an expression with unit-carrying variables
  ```json
  {
    "expression": "m*Cp*(T2-T1)",
    "variables": { "m": "2 kg", "Cp": "4186 J/(kg*K)", "T1": "293.15 K", "T2": "353.15 K" },
    "expectedUnit": "J"
  }
  ```
- `POST /convert` → unit conversion with an explicit `is_delta` mode for
  temperature **differences** (the Δ°C/Δ°F gotcha).

## Safety

Only numeric literals, the named input variables, whitelisted math functions
(`sqrt, sin, cos, tan, exp, log, ln, …`), and arithmetic operators are allowed.
Attribute access, arbitrary function calls, imports, and comprehensions are
rejected before evaluation. The service holds no secrets.

## Run it

```bash
cd calc
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Test it

```bash
pytest -q
```

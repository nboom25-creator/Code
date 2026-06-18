"""HTML dashboard / report generation for backtests.

Renders a self-contained HTML page with the headline metrics, a trades table,
and an inline SVG equity curve. Inline SVG keeps it dependency-free — no
matplotlib, no JS libraries, just a file you can open in any browser.
"""

from __future__ import annotations

import html
from pathlib import Path

from .backtest import BacktestResult


def _equity_svg(result: BacktestResult, width: int = 900, height: int = 320) -> str:
    curve = result.equity_curve
    values = curve.to_list()
    if len(values) < 2:
        return "<p>Not enough data to plot.</p>"
    pad = 40
    lo, hi = min(values), max(values)
    span = (hi - lo) or 1.0
    n = len(values)

    def x(i: int) -> float:
        return pad + (width - 2 * pad) * i / (n - 1)

    def y(v: float) -> float:
        return height - pad - (height - 2 * pad) * (v - lo) / span

    points = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(values))
    start_v = values[0]
    color = "#16a34a" if values[-1] >= start_v else "#dc2626"
    baseline = y(start_v)
    return f"""<svg viewBox="0 0 {width} {height}" width="100%" role="img"
     style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px">
  <line x1="{pad}" y1="{baseline:.1f}" x2="{width - pad}" y2="{baseline:.1f}"
        stroke="#9ca3af" stroke-dasharray="4 4"/>
  <polyline fill="none" stroke="{color}" stroke-width="2" points="{points}"/>
  <text x="{pad}" y="{pad - 12}" font-size="12" fill="#6b7280">
    equity: ${lo:,.0f}–${hi:,.0f}</text>
</svg>"""


def _metric_cards(result: BacktestResult) -> str:
    m = result.metrics
    items = [
        ("Total return", f"{m['total_return']:.2%}",
         m["total_return"] >= 0),
        ("Final equity", f"${m['final_equity']:,.0f}", m["final_equity"] >= 0),
        ("Max drawdown", f"{m['max_drawdown']:.2%}", False),
        ("Sharpe", f"{m['sharpe']:.2f}", m["sharpe"] >= 0),
        ("Trades", f"{int(m['num_trades'])}", True),
        ("Win rate", f"{m['win_rate']:.0%}", m["win_rate"] >= 0.5),
    ]
    cards = []
    for label, value, good in items:
        color = "#16a34a" if good else "#dc2626"
        cards.append(
            f'<div class="card"><div class="label">{html.escape(label)}</div>'
            f'<div class="value" style="color:{color}">{html.escape(value)}</div></div>'
        )
    return '<div class="cards">' + "".join(cards) + "</div>"


def _trades_table(result: BacktestResult, limit: int = 100) -> str:
    rows = []
    for t in result.trades[:limit]:
        pnl = f"${t.pnl:+,.2f}" if t.side == "sell" else "—"
        ts = html.escape(str(t.timestamp))
        rows.append(
            f"<tr><td>{ts}</td><td>{html.escape(t.side)}</td>"
            f"<td>{t.quantity}</td><td>${t.price:.2f}</td><td>{pnl}</td></tr>"
        )
    body = "".join(rows) or '<tr><td colspan="5">No trades</td></tr>'
    return (
        "<table><thead><tr><th>Time</th><th>Side</th><th>Qty</th>"
        f"<th>Price</th><th>Realized P&L</th></tr></thead><tbody>{body}</tbody></table>"
    )


def render_html(result: BacktestResult) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Backtest — {html.escape(result.symbol)}</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 2rem; color: #111827;
         max-width: 980px; }}
  h1 {{ margin-bottom: 0.25rem; }}
  .sub {{ color: #6b7280; margin-top: 0; }}
  .cards {{ display: flex; flex-wrap: wrap; gap: 1rem; margin: 1.5rem 0; }}
  .card {{ flex: 1 1 130px; padding: 1rem; border: 1px solid #e5e7eb;
          border-radius: 8px; background: #fff; }}
  .label {{ font-size: 0.8rem; color: #6b7280; }}
  .value {{ font-size: 1.4rem; font-weight: 600; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 1.5rem;
          font-size: 0.9rem; }}
  th, td {{ text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; }}
  th {{ color: #6b7280; }}
</style></head>
<body>
  <h1>Backtest report — {html.escape(result.symbol)}</h1>
  <p class="sub">Autonomous trading bot · equity curve and trade log</p>
  {_metric_cards(result)}
  {_equity_svg(result)}
  <h2>Trades</h2>
  {_trades_table(result)}
</body></html>"""


def write_report(result: BacktestResult, path: str | Path) -> Path:
    path = Path(path)
    path.write_text(render_html(result), encoding="utf-8")
    return path

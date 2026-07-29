"""AegisQuant — autonomous, auditable equities research and execution platform.

Three operating modes, selected by ``AEGIS_MODE``:

``BACKTEST``
    Historical simulation only. No broker connection is opened.
``PAPER``
    Live decision loop against a paper broker (Alpaca paper or the built-in
    mock broker). Identical signals, risk engine, sizing, execution logic and
    audit process as LIVE.
``LIVE``
    Real money. Disabled by default and gated behind a multi-step human
    authorization workflow (see ``aegisquant.live_gate``).

Nothing in this package may bypass :mod:`aegisquant.risk.engine`, which holds
final authority over every order.
"""

__version__ = "1.0.0"

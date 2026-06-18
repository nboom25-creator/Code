#!/usr/bin/env python3
"""Standalone dry-run: trigger the full autonomous research loop exactly once.

SAFE BY DESIGN — in dry-run mode the final ``execute_order`` call is intercepted.
No trade is ever sent to the broker. Instead, the proposed trade is written,
alongside the agent's Bull vs. Bear reasoning, to ``logs/YYYY-MM-DD.md``.

Runs with zero credentials out of the box (free yfinance data, a local sentiment
scorer, a simulated paper account, and an offline heuristic analyst). It upgrades
automatically when keys are present in ``.env``:

    ANTHROPIC_API_KEY  -> uses Claude for the reasoning loop (else HeuristicLLM)
    ALPACA_API_KEY/SECRET -> reads portfolio from the Alpaca paper account
                             (else a simulated $100k account)

Usage:
    python run_dry_run.py                      # auto-select providers
    python run_dry_run.py --symbols AAPL,MSFT  # override the watchlist
    python run_dry_run.py --offline            # force the heuristic brain
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Make the src/ layout importable when run as a plain script.
sys.path.insert(0, str(Path(__file__).parent / "src"))

from dotenv import load_dotenv  # noqa: E402

from trading_bot.agent.runner import build_dry_run_runner  # noqa: E402
from trading_bot.config import load_config  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the agent research loop once (dry-run).")
    parser.add_argument("--symbols", help="comma-separated tickers (default: config.yaml)")
    parser.add_argument("--offline", action="store_true",
                        help="force the offline HeuristicLLM even if a Claude key is set")
    parser.add_argument("--sim-data", action="store_true",
                        help="use synthetic market data/news (no network egress needed)")
    parser.add_argument("--equity", type=float, default=100_000.0,
                        help="starting equity for the simulated paper account")
    parser.add_argument("-c", "--config", default="config.yaml")
    args = parser.parse_args(argv)

    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        datefmt="%H:%M:%S")

    config = load_config(args.config)
    watchlist = ([s.strip().upper() for s in args.symbols.split(",")]
                 if args.symbols else None)

    runner, selections = build_dry_run_runner(
        config, offline=args.offline, sim_data=args.sim_data,
        watchlist=watchlist, sim_equity=args.equity,
    )

    print("=" * 64)
    print("DRY RUN — no orders will be sent to any broker.")
    print(f"  Market data : {selections['data']}")
    print(f"  Broker      : {selections['broker']}")
    print(f"  Brain       : {selections['brain']}")
    print(f"  Watchlist   : {', '.join(selections['watchlist'])}")
    print("=" * 64)

    result = runner.run_day()

    if result["halted"]:
        print(f"\n🛑 Trading halted before any cycle: {result['reason']}")
    else:
        print(f"\nCompleted {len(result['results'])} research cycle(s):")
        for r in result["results"]:
            note = ("degraded→HOLD" if r.degraded
                    else f"proposed {r.final_action} qty={r.quantity}")
            print(f"  • {r.ticker}: {note}")

    import datetime as dt
    audit = Path("logs") / f"{dt.date.today().isoformat()}.md"
    print(f"\n📝 Full Bull/Bear reasoning + proposed trades written to: {audit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

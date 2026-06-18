"""Command-line interface.

    python -m trading_bot backtest --synthetic --strategy sma_crossover
    python -m trading_bot backtest --symbols AAPL,MSFT --start 2022-01-01
    python -m trading_bot run
    python -m trading_bot status
"""

from __future__ import annotations

import argparse
import logging
import sys

from .backtest import Backtester, generate_synthetic_bars
from .config import load_config
from .strategy import build_strategy


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def _cmd_backtest(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    strategy_name = args.strategy or config.strategy.name
    strategy = build_strategy(strategy_name, config.strategy.params)

    symbols = (
        [s.strip().upper() for s in args.symbols.split(",")]
        if args.symbols
        else config.symbols
    )

    if args.synthetic:
        print(f"Backtesting {strategy_name} on synthetic data...\n")
        bars = generate_synthetic_bars(n=args.bars)
        bt = Backtester(strategy, config.risk, config.backtest)
        result = bt.run("SYNTH", bars)
        print(result.summary())
        return 0

    # Real data path — requires Alpaca credentials.
    from .data import DataProvider

    provider = DataProvider(config.credentials)
    overall = []
    for symbol in symbols:
        print(f"Fetching bars for {symbol}...")
        bars = provider.get_bars(
            symbol, timeframe=config.timeframe, start=args.start, end=args.end
        )
        if bars.empty:
            print(f"  no data for {symbol}, skipping")
            continue
        bt = Backtester(strategy, config.risk, config.backtest)
        result = bt.run(symbol, bars)
        print(result.summary())
        print()
        overall.append(result.metrics["total_return"])
    if overall:
        print(f"Average total return across {len(overall)} symbols: "
              f"{sum(overall) / len(overall):.2%}")
    return 0


def _cmd_run(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    try:
        config.validate()
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    from .engine import TradingEngine

    engine = TradingEngine(config)
    if args.once:
        engine.run_once()
    else:
        engine.run_forever()
    return 0


def _cmd_status(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    try:
        config.validate()
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    from .broker import AlpacaBroker

    broker = AlpacaBroker(config)
    account = broker.get_account()
    mode = "PAPER" if broker.is_paper else "LIVE"
    print(f"Account [{mode}]")
    print(f"  Equity:       ${account.equity:,.2f}")
    print(f"  Cash:         ${account.cash:,.2f}")
    print(f"  Buying power: ${account.buying_power:,.2f}")
    positions = broker.get_positions()
    if positions:
        print("Open positions:")
        for p in positions:
            print(f"  {p.symbol:<6} qty={p.quantity:<8} "
                  f"avg=${p.avg_price:.2f} mv=${p.market_value:,.2f}")
    else:
        print("No open positions.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="trading_bot", description=__doc__)
    parser.add_argument("-c", "--config", default="config.yaml", help="config file path")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    bt = sub.add_parser("backtest", help="run a backtest")
    bt.add_argument("--strategy", help="override strategy name")
    bt.add_argument("--symbols", help="comma-separated tickers (default: config)")
    bt.add_argument("--start", help="start date YYYY-MM-DD")
    bt.add_argument("--end", help="end date YYYY-MM-DD")
    bt.add_argument("--synthetic", action="store_true",
                    help="use generated data (no network/credentials)")
    bt.add_argument("--bars", type=int, default=500, help="synthetic bar count")
    bt.set_defaults(func=_cmd_backtest)

    run = sub.add_parser("run", help="run the live (paper/live) engine")
    run.add_argument("--once", action="store_true", help="run a single cycle and exit")
    run.set_defaults(func=_cmd_run)

    status = sub.add_parser("status", help="show account + positions")
    status.set_defaults(func=_cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

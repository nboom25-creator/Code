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

    def maybe_report(result, *, suffix=""):
        if not args.report:
            return
        from .report import write_report

        path = args.report
        if suffix:  # only set for real-data multi-symbol runs
            stem, _, ext = path.rpartition(".")
            path = f"{stem}_{suffix}.{ext}" if stem else f"{path}_{suffix}"
        out = write_report(result, path)
        print(f"  report written to {out}")

    if args.synthetic:
        print(f"Backtesting {strategy_name} on synthetic data...\n")
        bars = generate_synthetic_bars(n=args.bars)
        bt = Backtester(strategy, config.risk, config.backtest)
        result = bt.run("SYNTH", bars)
        print(result.summary())
        maybe_report(result)
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
        maybe_report(result, suffix=symbol if len(symbols) > 1 else "")
        print()
        overall.append(result.metrics["total_return"])
    if overall:
        print(f"Average total return across {len(overall)} symbols: "
              f"{sum(overall) / len(overall):.2%}")
    return 0


def _load_bars_for_opt(args, config, symbols):
    """Return (label, bars) for optimize/walkforward, synthetic or real."""
    if args.synthetic:
        return "SYNTH", generate_synthetic_bars(n=args.bars)
    from .data import DataProvider

    symbol = symbols[0]
    provider = DataProvider(config.credentials)
    bars = provider.get_bars(
        symbol, timeframe=config.timeframe, start=args.start, end=args.end
    )
    return symbol, bars


def _cmd_optimize(args: argparse.Namespace) -> int:
    from .optimize import default_grid, grid_search

    config = load_config(args.config)
    strategy_name = args.strategy or config.strategy.name
    symbols = ([s.strip().upper() for s in args.symbols.split(",")]
               if args.symbols else config.symbols)
    label, bars = _load_bars_for_opt(args, config, symbols)
    if bars.empty:
        print("no data to optimize on", file=sys.stderr)
        return 1
    grid = default_grid(strategy_name)
    print(f"Grid-searching {strategy_name} on {label} "
          f"({len(bars)} bars), ranking by {args.metric}...\n")
    results = grid_search(strategy_name, grid, bars,
                          risk_config=config.risk, backtest_config=config.backtest,
                          metric=args.metric, symbol=label)
    for r in results[: args.top]:
        m = r.metrics
        print(f"  score={r.score:+.3f}  return={m['total_return']:+.2%}  "
              f"sharpe={m['sharpe']:+.2f}  dd={m['max_drawdown']:.2%}  {r.params}")
    if results:
        print(f"\nBest params: {results[0].params}")
    return 0


def _cmd_walkforward(args: argparse.Namespace) -> int:
    from .optimize import default_grid, walk_forward

    config = load_config(args.config)
    strategy_name = args.strategy or config.strategy.name
    symbols = ([s.strip().upper() for s in args.symbols.split(",")]
               if args.symbols else config.symbols)
    label, bars = _load_bars_for_opt(args, config, symbols)
    if bars.empty:
        print("no data for walk-forward", file=sys.stderr)
        return 1
    grid = default_grid(strategy_name)
    wf = walk_forward(strategy_name, grid, bars, n_splits=args.splits,
                      risk_config=config.risk, backtest_config=config.backtest,
                      metric=args.metric, symbol=label)
    print(wf.summary())
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


def _cmd_agent(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    try:
        config.validate()
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    if not __import__("os").getenv("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set — the agent needs it to call Claude.",
              file=sys.stderr)
        return 2
    from .agent.runner import build_runner

    runner = build_runner(config)
    result = runner.run_day()
    if result["halted"]:
        print(f"Trading halted: {result['reason']}")
    else:
        print(f"Completed {len(result['results'])} cognitive cycles. "
              f"See logs/ for the full audit trail.")
        for r in result["results"]:
            tag = "executed" if r.executed else ("HOLD/degraded" if r.degraded else "no order")
            print(f"  {r.ticker}: {r.final_action} qty={r.quantity} ({tag})")
    return 0


def _cmd_discover(args: argparse.Namespace) -> int:
    from .agent.research import build_research_bundle

    research = build_research_bundle(sim=args.sim)
    candidates = research.discover_small_caps(
        args.sector, args.max_cap, args.min_volume)
    if not candidates:
        print("No candidates (set FMP_API_KEY for live screening, or pass --sim).")
        return 0
    print(f"Small/micro-cap candidates in '{args.sector}' "
          f"(cap < ${args.max_cap:,.0f}, vol > {args.min_volume:,.0f}):")
    for c in candidates:
        print(f"  {c.ticker:<8} {c.name[:36]:<36} "
              f"cap=${c.market_cap/1e6:,.0f}M vol={c.volume:,.0f}")
    return 0


def _cmd_regime(args: argparse.Namespace) -> int:
    config = load_config(args.config)
    if args.sim:
        from .data import SyntheticDataProvider

        data = SyntheticDataProvider()
    else:
        from .data import YFinanceDataProvider

        data = YFinanceDataProvider()
    from .agent.regime import assess_regime

    r = assess_regime(data, benchmark=args.benchmark or config.benchmark)
    print(f"Regime: {r.regime}  (exposure x{r.exposure_scale:.2f})")
    print(f"  {r.reason}")
    for k, v in r.details.items():
        print(f"  {k}: {v}")
    return 0


def _cmd_performance(args: argparse.Namespace) -> int:
    from .agent.ledger import TradeLedger
    from .agent.performance import format_report

    ledger = TradeLedger(args.ledger)
    print(format_report(ledger, mode=args.mode))
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
    bt.add_argument("--report", help="write an HTML dashboard to this path")
    bt.set_defaults(func=_cmd_backtest)

    opt = sub.add_parser("optimize", help="grid-search strategy parameters")
    opt.add_argument("--strategy", help="strategy name (default: config)")
    opt.add_argument("--symbols", help="comma-separated tickers (first is used)")
    opt.add_argument("--start", help="start date YYYY-MM-DD")
    opt.add_argument("--end", help="end date YYYY-MM-DD")
    opt.add_argument("--synthetic", action="store_true", help="use generated data")
    opt.add_argument("--bars", type=int, default=500, help="synthetic bar count")
    opt.add_argument("--metric", default="sharpe",
                     help="ranking metric: sharpe|total_return|win_rate")
    opt.add_argument("--top", type=int, default=10, help="rows to display")
    opt.set_defaults(func=_cmd_optimize)

    wf = sub.add_parser("walkforward",
                        help="walk-forward (out-of-sample) validation")
    wf.add_argument("--strategy", help="strategy name (default: config)")
    wf.add_argument("--symbols", help="comma-separated tickers (first is used)")
    wf.add_argument("--start", help="start date YYYY-MM-DD")
    wf.add_argument("--end", help="end date YYYY-MM-DD")
    wf.add_argument("--synthetic", action="store_true", help="use generated data")
    wf.add_argument("--bars", type=int, default=1000, help="synthetic bar count")
    wf.add_argument("--metric", default="sharpe", help="optimization metric")
    wf.add_argument("--splits", type=int, default=4, help="number of folds")
    wf.set_defaults(func=_cmd_walkforward)

    run = sub.add_parser("run", help="run the live (paper/live) engine")
    run.add_argument("--once", action="store_true", help="run a single cycle and exit")
    run.set_defaults(func=_cmd_run)

    agent = sub.add_parser(
        "agent", help="run the autonomous LLM agent (Research-then-Decide loop)")
    agent.set_defaults(func=_cmd_agent)

    disc = sub.add_parser("discover", help="screen for small/micro-cap candidates")
    disc.add_argument("--sector", required=True, help="e.g. Technology, Healthcare")
    disc.add_argument("--max-cap", type=float, default=2_000_000_000,
                      help="max market cap (default $2B)")
    disc.add_argument("--min-volume", type=float, default=100_000,
                      help="min average volume (default 100k)")
    disc.add_argument("--sim", action="store_true",
                      help="use offline simulated screener (no API key)")
    disc.set_defaults(func=_cmd_discover)

    reg = sub.add_parser("regime", help="show the current market regime (entry gate)")
    reg.add_argument("--benchmark", help="benchmark symbol (default: config / SPY)")
    reg.add_argument("--sim", action="store_true", help="use synthetic data (offline)")
    reg.set_defaults(func=_cmd_regime)

    perf = sub.add_parser("performance",
                          help="performance + attribution from the trade ledger")
    perf.add_argument("--ledger", default="logs/ledger.jsonl", help="ledger path")
    perf.add_argument("--mode", help="filter by mode: live | paper | dry_run")
    perf.set_defaults(func=_cmd_performance)

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

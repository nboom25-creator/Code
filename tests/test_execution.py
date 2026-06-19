"""Tests for execution quality: limit orders, cost model, PDT and wash-sale rules."""

import datetime as dt

import pandas as pd

from trading_bot.agent import account_rules as ar
from trading_bot.agent.audit import AuditLog
from trading_bot.agent.cognition import CognitiveLoop
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.ledger import Fill, TradeLedger
from trading_bot.agent.llm import HeuristicLLM
from trading_bot.agent.paper_sim import SimPaperBroker, _SimPosition
from trading_bot.agent.research import ResearchBundle, SimResearch
from trading_bot.agent.tools import AgentTools
from trading_bot.config import ExecutionConfig


def _today_ts(hour=10):
    return dt.datetime.combine(dt.date.today(), dt.time(hour, 0)).isoformat()


def _bundle():
    sim = SimResearch()
    return ResearchBundle(fundamentals_client=sim, sec_client=sim,
                          web_client=sim, screener_client=sim, capabilities=["sim"])


# --------------------------------------------------------------------------- #
# Cost model
# --------------------------------------------------------------------------- #
def test_estimated_fill_price_moves_against_you():
    assert ar.estimated_fill_price(100, "buy", 0.01) == 101.0
    assert ar.estimated_fill_price(100, "sell", 0.01) == 99.0
    assert ar.estimated_fill_price(100, "buy", 0.0) == 100


# --------------------------------------------------------------------------- #
# Limit-order routing
# --------------------------------------------------------------------------- #
class _Data:
    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        close = pd.Series([100 + i for i in range(30)], index=idx, dtype=float)
        return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                             "close": close, "volume": 1_000_000})

    def get_news(self, symbol, *, limit=10):
        return [{"headline": f"{symbol} up", "summary": "x"} for _ in range(4)]


def test_limit_sell_routes_to_limit_order():
    broker = SimPaperBroker()
    tools = AgentTools(broker, _Data())
    tools.execute_order("AAPL", 5, "sell", "limit", limit_price=99.5)
    assert broker.limit_orders and broker.limit_orders[0]["limit_price"] == 99.5
    assert broker.limit_orders[0]["side"] == "sell"


def test_limit_buy_bracket_carries_limit_price():
    broker = SimPaperBroker()
    tools = AgentTools(broker, _Data())
    tools.execute_order("AAPL", 5, "buy", "limit",
                        stop_loss_price=95, take_profit_price=110, limit_price=100.5)
    assert broker.bracket_orders[0]["limit_price"] == 100.5


# --------------------------------------------------------------------------- #
# PDT day-trade rule
# --------------------------------------------------------------------------- #
def test_pdt_counts_same_day_round_trips(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    for i, t in enumerate(["A", "B", "C"]):
        led.record(Fill(t, "buy", 1, 100, mode="paper", timestamp=_today_ts(9)))
        led.record(Fill(t, "sell", 1, 101, mode="paper", timestamp=_today_ts(10)))
    assert ar.recent_day_trades(led, "paper") == 3


def test_pdt_blocks_fourth_day_trade_small_account(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    for t in ["A", "B", "C"]:
        led.record(Fill(t, "buy", 1, 100, mode="paper", timestamp=_today_ts(9)))
        led.record(Fill(t, "sell", 1, 101, mode="paper", timestamp=_today_ts(10)))
    # Hold a name opened today; selling it now would be the 4th day trade.
    led.record(Fill("D", "buy", 1, 100, mode="paper", timestamp=_today_ts(11)))
    assert ar.pdt_would_block("D", led, equity=10_000, mode="paper")      # <$25k
    assert not ar.pdt_would_block("D", led, equity=30_000, mode="paper")  # big acct ok
    assert not ar.pdt_would_block("Z", led, equity=10_000, mode="paper")  # not held today


# --------------------------------------------------------------------------- #
# Wash-sale rule
# --------------------------------------------------------------------------- #
def test_wash_sale_detects_recent_loss(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    led.record(Fill("LOSS", "buy", 10, 100, mode="paper", timestamp=_today_ts(9)))
    led.record(Fill("LOSS", "sell", 10, 90, mode="paper", timestamp=_today_ts(10)))
    assert ar.wash_sale_blocked("LOSS", led, "paper", days=30)
    assert not ar.wash_sale_blocked("OTHER", led, "paper", days=30)


def test_loop_blocks_buy_after_recent_loss(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    led.record(Fill("ABCD", "buy", 10, 100, mode="dry_run", timestamp=_today_ts(9)))
    led.record(Fill("ABCD", "sell", 10, 90, mode="dry_run", timestamp=_today_ts(10)))
    loop = CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(SimPaperBroker(equity=100_000, cash=100_000), _Data(),
                         research=_bundle()),
        guardrails=Guardrails(), audit=AuditLog(log_dir=tmp_path),
        system_prompt="M", dry_run=True, ledger=led,
        execution=ExecutionConfig(avoid_wash_sales=True),
    )
    result = loop.run_for_ticker("ABCD", equity=100_000)
    # The model wanted to buy, but the wash-sale guard blocked it.
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "wash sale" in md.lower()
    # No new buy fill was recorded (still just the 2 seeded fills).
    assert sum(1 for f in led.fills() if f.side == "buy") == 1


# --------------------------------------------------------------------------- #
# Cost-adjusted dry-run fills
# --------------------------------------------------------------------------- #
def test_dry_run_records_cost_adjusted_buy_fill(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    loop = CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(SimPaperBroker(equity=100_000, cash=100_000), _Data(),
                         research=_bundle()),
        guardrails=Guardrails(), audit=AuditLog(log_dir=tmp_path),
        system_prompt="M", dry_run=True, ledger=led,
        execution=ExecutionConfig(est_slippage_pct=0.01, order_type="limit"),
    )
    loop.run_for_ticker("XYZ", equity=100_000)
    buys = [f for f in led.fills() if f.side == "buy"]
    assert buys, "expected a recorded buy fill"
    # Recorded fill is above the latest close (~129) by the slippage assumption.
    assert buys[0].price > 129

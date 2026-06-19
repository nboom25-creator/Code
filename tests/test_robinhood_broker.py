"""Tests for the broker selector and the Robinhood MCP adapter scaffold.

The adapter is deliberately not wired to live orders yet (Robinhood's MCP spec
is unknown), so these tests pin the *safety* behavior: the right broker is
selected, credentials are required, and no order path can run against a guessed
endpoint — it must raise a clear, loud error until the spec is filled in.
"""

import pytest

from trading_bot.broker import AlpacaBroker, build_broker
from trading_bot.config import Config, Credentials
from trading_bot.robinhood import RobinhoodMCPBroker


def _rh_config():
    return Config(broker="robinhood", symbols=["AAPL"], credentials=Credentials())


def test_factory_defaults_to_alpaca():
    cfg = Config(broker="alpaca", symbols=["AAPL"],
                 credentials=Credentials(api_key="k", api_secret="s"))
    assert isinstance(build_broker(cfg), AlpacaBroker)


def test_factory_selects_robinhood():
    assert isinstance(build_broker(_rh_config()), RobinhoodMCPBroker)


def test_robinhood_defaults_to_published_url():
    from trading_bot.robinhood import DEFAULT_MCP_URL

    broker = RobinhoodMCPBroker(Config(broker="robinhood", symbols=["AAPL"],
                                       credentials=Credentials()))
    assert broker._url == DEFAULT_MCP_URL == "https://agent.robinhood.com/mcp/trading"


def test_robinhood_not_reported_as_paper():
    # Real-money account with no sandbox -> must never look like practice money.
    assert RobinhoodMCPBroker(_rh_config()).is_paper is False


@pytest.mark.parametrize("call", [
    lambda b: b.get_account(),
    lambda b: b.get_positions(),
    lambda b: b.submit_market_order("AAPL", 1, "buy"),
    lambda b: b.submit_limit_order("AAPL", 1, "buy", 100.0),
    lambda b: b.submit_bracket_order("AAPL", 1, stop_loss_price=90.0),
    lambda b: b.close_position("AAPL"),
])
def test_unconfigured_tools_refuse_to_run(call):
    broker = RobinhoodMCPBroker(_rh_config())
    with pytest.raises(NotImplementedError, match="not configured yet"):
        call(broker)


def test_broker_config_validation_rejects_unknown():
    cfg = Config(broker="etrade", symbols=["AAPL"])
    with pytest.raises(ValueError, match="broker must be"):
        cfg.validate()

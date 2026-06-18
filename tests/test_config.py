import pytest

from trading_bot.config import (
    LIVE_CONFIRM_VALUE,
    Config,
    Credentials,
    RiskConfig,
    load_config,
)


def test_load_config_defaults_to_paper(tmp_path):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text("symbols: [AAPL]\n")
    cfg = load_config(cfg_file, load_env=False)
    assert cfg.mode == "paper"
    assert cfg.symbols == ["AAPL"]
    assert not cfg.is_live


def test_validate_requires_symbols():
    cfg = Config(symbols=[])
    with pytest.raises(ValueError):
        cfg.validate()


def test_live_mode_requires_confirmation():
    cfg = Config(
        mode="live",
        symbols=["AAPL"],
        credentials=Credentials(api_key="k", api_secret="s", live_confirm=None),
    )
    with pytest.raises(ValueError, match="LIVE_TRADING_CONFIRM"):
        cfg.validate()


def test_live_mode_passes_with_confirmation():
    cfg = Config(
        mode="live",
        symbols=["AAPL"],
        credentials=Credentials(api_key="k", api_secret="s",
                                live_confirm=LIVE_CONFIRM_VALUE),
    )
    cfg.validate()  # should not raise


def test_validate_rejects_bad_risk():
    cfg = Config(symbols=["AAPL"], risk=RiskConfig(max_position_pct=1.5))
    with pytest.raises(ValueError):
        cfg.validate()

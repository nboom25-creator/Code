# Deploying the trading agent on an always-on host

This runs the autonomous agent **once per US-market weekday** on a machine that
never sleeps — a small cloud VM (DigitalOcean / Linode / Hetzner / AWS
Lightsail, ~$5–6/mo) or a Raspberry Pi at home. Any Ubuntu/Debian box works.

Everything stays on **paper** until you deliberately switch to live, so this is
safe to leave running while the track record builds.

---

## 1. Provision a host

- **Cloud VM (recommended):** the smallest Ubuntu 22.04+ instance is plenty.
  1 vCPU / 1 GB RAM is enough — the work is API calls, not local compute.
- **Raspberry Pi:** a Pi 4/5 on Raspberry Pi OS (64-bit) works the same way.

SSH in, then update and install Python:

```bash
sudo apt update && sudo apt install -y python3 python3-venv python3-pip git
```

## 2. Clone the repo and install

```bash
git clone https://github.com/nboom25-creator/Code.git ~/Code
cd ~/Code
git checkout claude/autonomous-ai-trading-bot-voeohd
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## 3. Create the `.env` (secrets live only on the host)

`.env` is git-ignored — it never gets committed. Create it on the host:

```bash
cp .env.example .env
nano .env
```

Fill in (uncomment by removing the leading `# `):

```
ANTHROPIC_API_KEY=sk-ant-...        # the agent's brain
ALPACA_API_KEY=...                  # paper trading key
ALPACA_API_SECRET=...               # paper trading secret
ALPACA_API_BASE_URL=https://paper-api.alpaca.markets
FMP_API_KEY=...                     # small-cap screener + fundamentals (free tier)
SEC_EDGAR_USER_AGENT=Your Name your@email.com   # required by SEC, free
# FIRECRAWL_API_KEY=fc-...          # optional: niche-blog web research
```

Verify the keys are seen:

```bash
python -m trading_bot agent --help   # sanity check the CLI runs
```

## 4. Smoke-test one run by hand

```bash
chmod +x deploy/run_daily.sh
./deploy/run_daily.sh
tail -n 40 logs/cron-$(date +%F).log
```

You should see the regime line, one cognitive cycle per name (including any
discovered small-caps), and the BUY/HOLD/SELL decisions.

## 5. Schedule it

Edit `deploy/trading-bot.cron` and replace `/home/USER/Code` with the real path
(`echo $HOME` shows your home dir), then install it:

```bash
crontab deploy/trading-bot.cron
crontab -l        # confirm it's registered
```

It now runs at **10:00 America/New_York, Monday–Friday**. Daily output lands in
`logs/cron-YYYY-MM-DD.log`, the full audit trail in `logs/YYYY-MM-DD.md`, and
every fill in `logs/ledger.jsonl`.

## 6. Keep an eye on it

```bash
python -m trading_bot status                 # cash + open positions
python -m trading_bot performance --mode paper   # realized track record
python -m trading_bot readiness              # progress toward go-live gate
```

The repo on the host can pull updates anytime with `git pull` (it won't touch
your `.env`).

---

### Cost & runtime notes

- With small-cap discovery on, a run analyzes the 4 watchlist names **plus** up
  to `max_candidates × sectors` screened names — each a full Claude cognitive
  cycle. That multiplies both **runtime** (tens of minutes) and **API cost**.
  Start smaller (fewer sectors / lower `max_candidates` in `config.yaml`) and
  scale up once you've seen real per-run cost.
- FMP's free tier is rate-limited; one run/day stays well within it, but heavy
  experimentation can exhaust the daily quota.

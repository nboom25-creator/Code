# Running EngineerTutor on Termux (Android)

You can run the whole app **directly on your Android phone** with
[Termux](https://termux.dev). No cloud, no deploy — the app runs locally and you
open it in your phone's browser.

> **Install Termux from [F-Droid](https://f-droid.org/en/packages/com.termux/)
> (or GitHub releases), NOT the Google Play Store.** The Play Store build is
> outdated and broken for this.

There are two paths. **Path A (web app only) is the recommended one** — it's the
simplest and gives you the full tutor. Path B adds the Python calculation
service and is optional.

---

## Path A — Web app only (recommended)

The web app already includes a built-in JavaScript unit checker, so you get
working lessons, problem solving, quizzes, and video search without Python.

### 1. Install the basics

```bash
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git
```

### 2. Get the code

```bash
git clone https://github.com/nboom25-creator/Code
cd Code/web
```

> If the repo is **private**, git will ask you to authenticate. Use a GitHub
> [Personal Access Token](https://github.com/settings/tokens) as the password,
> or run `pkg install gh && gh auth login` first.

### 3. Install dependencies

```bash
npm install
```

(You may see a warning that the optional `sharp` package was skipped — that's
fine, the app doesn't need it.)

### 4. Add your API key

```bash
cp .env.example .env.local
nano .env.local      # set ANTHROPIC_API_KEY=... (and YOUTUBE_API_KEY=... if you have one)
```

Save in nano with **Ctrl+O, Enter, Ctrl+X**. See the main README for how to get
the keys.

### 5. Run it

```bash
npm run dev
```

The first page compile takes a minute or two on a phone — be patient. When you
see `Ready`, open **`http://localhost:3000`** in your phone's browser (Chrome).

To make it feel like an app: in Chrome, open the ⋮ menu → **Add to Home Screen**
(the app ships a PWA manifest, so it installs with an icon and runs full-screen).

### Keeping it running

Android may pause Termux when the screen turns off. To prevent that:

```bash
termux-wake-lock        # hold a wake lock while the server runs
```

Also disable battery optimization for Termux in Android Settings → Apps →
Termux → Battery → Unrestricted. To stop the server, press **Ctrl+C**.

---

## Path B — Add the Python calc service (optional)

This enables full symbolic evaluation (SymPy + Pint) instead of the JS fallback.
It's slimmed to pure-Python packages, but **`pydantic` compiles a small Rust
component**, so you need Rust — the build takes several minutes on a phone.

```bash
pkg install -y python rust binutils
cd ~/Code/calc
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt      # builds pydantic-core with Rust (slow, ~5-10 min)
uvicorn app.main:app --port 8000
```

Then, in a **second Termux session** (swipe from the left edge → New session),
point the web app at it:

```bash
cd ~/Code/web
echo "CALC_SERVICE_URL=http://localhost:8000" >> .env.local
npm run dev
```

Verify: `curl http://localhost:8000/health` should return
`{"status":"ok","engine":"sympy+pint"}`.

> **If the pydantic build fails or is too slow, just skip Path B.** The web app
> works fine on its JS unit checker and clearly labels which engine ran. You are
> not missing lessons, quizzes, or videos — only offline numeric evaluation.
>
> NumPy/SciPy are **not** required and are intentionally left out of
> `requirements.txt`. (They're listed in `requirements-optional.txt` for future
> features; on Termux install those via `pkg install python-numpy python-scipy`,
> never pip.)

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm install` is very slow | Normal on a phone; let it finish. Ensure you're on Wi-Fi. |
| Page says "Configuration needed" | `ANTHROPIC_API_KEY` isn't set in `web/.env.local`. Edit it and restart `npm run dev`. |
| Videos say "not configured" | Add `YOUTUBE_API_KEY` (optional). |
| Server stops when screen locks | Run `termux-wake-lock` and set Termux battery to Unrestricted. |
| `pip install` fails on pydantic | Ensure `rust` and `binutils` are installed, or skip Path B (use JS fallback). |
| Out of memory during `npm run build` | Use `npm run dev` instead — it compiles lazily and uses less memory. |

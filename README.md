# EngineerTutor

An interactive AI tutor for **any engineering subject** — structured lessons,
step-by-step problem solving with hint-by-hint reveal, quizzes, deterministic
unit-checked calculations, and **real** instructional-video search.

> Built as a working application, not a mockup. It runs, it's tested, and every
> external integration is either wired up or shows an explicit "configure this"
> state — it never fabricates lessons, calculations, videos, or citations.

---

## What it does

| Mode | What you get |
| --- | --- |
| **Learn** | A 14-section lesson: overview, prerequisites, objectives, definitions, principles, equations (LaTeX), variables + SI units, assumptions, worked example, common mistakes, physical interpretation, knowledge check, related concepts, and real videos. |
| **Solve** | The full engineering method: restate → knowns/unknowns → unit conversion → governing principles → assumptions → diagram → equations → symbolic solution → numeric substitution → **deterministic unit check (SymPy + Pint)** → answer with sig-figs → sanity check → physical meaning → practice problem. Includes **Hints-only / Guided** step-by-step reveal. |
| **Quiz** | Configurable question types (conceptual MC, numerical, equation-selection, unit-analysis, error-identification, short-response, multi-step), auto-graded with worked solutions, feeding a per-topic **mastery tracker**. |
| **Study plan** | An editable, checkable plan toward an exam date, balancing lessons/practice/videos/review with time estimates. |

Everywhere: LaTeX rendering (KaTeX), deterministic diagrams (Mermaid/SVG),
contextual follow-up Q&A ("why this equation?", "show the free-body diagram",
"solve another way"), light/dark themes, mobile layout, save/resume, and export.

---

## Architecture

A monorepo with a TypeScript web app and a Python calculation service.

```
Code/
├── web/                  Next.js 15 (App Router, TS, Tailwind) — UI + API routes
│   ├── src/app/          pages (/, /learn, /solve, /quiz, /study-plan) + /api/*
│   ├── src/lib/          AI client, Zod schemas, prompts, YouTube, units, calc client,
│   │                     sanitize (prompt-injection defense), storage, rate limiting
│   ├── src/components/   React components (views, math, diagrams, video panel, chat)
│   ├── src/tests/        Vitest unit tests
│   ├── e2e/              Playwright smoke tests (desktop + mobile)
│   └── prisma/           optional Postgres/SQLite schema for synced accounts
├── calc/                 FastAPI + SymPy + Pint deterministic calculation service
│   ├── app/              evaluator (restricted AST sandbox) + API
│   └── tests/            pytest suite
└── legacy-snake/         preserved unrelated prior project (a Snake game)
```

**Key design choices**

- **Structured AI outputs, always validated.** Every AI call forces a single
  tool (`emit_lesson`, `emit_solution`, …) so the model returns JSON, which is
  parsed by a **Zod schema** before anything renders. See `web/src/lib/schemas.ts`
  and `web/src/lib/toolSchemas.ts`. AI calls live in API routes, never in UI
  components.
- **Deterministic math.** The AI proposes a calculation; the **Python service**
  executes it with SymPy + Pint in a restricted AST sandbox (no arbitrary code),
  validates dimensions, and returns a result. If the service is down, the app
  falls back to an in-process JS dimensional checker and **labels** which engine
  ran. See `calc/app/evaluator.py` and `web/src/lib/calc.ts`.
- **Real videos or an honest empty state.** `web/src/lib/youtube.ts` calls the
  YouTube Data API v3 (`search.list` + `videos.list`), normalizes every field
  from the API, and ranks by relevance/captions/duration/recency — **not** view
  count. With no key or exhausted quota, it returns a typed state and shows the
  AI-generated queries instead of fake results.
- **Prompt-injection defense.** All untrusted text (student input, uploads,
  video titles, retrieved pages) is neutralized and wrapped in labeled
  `<untrusted_data>` blocks; the system prompt forbids following instructions
  found inside them. See `web/src/lib/sanitize.ts`.
- **Guest-first persistence.** Save/resume works with zero backend via
  `localStorage`. Prisma + SQLite/Postgres is the optional upgrade for accounts.

---

## Quick start

Prerequisites: **Node ≥ 18** and **Python ≥ 3.10**.

### 1. Web app

```bash
cd web
npm install
cp .env.example .env.local        # then edit .env.local (see "Configuration")
npm run dev                        # http://localhost:3000
```

The app runs immediately in **guest mode**. To generate content you need an
Anthropic key; for real videos, a YouTube key. Missing keys produce clear
in-app "configure this" banners — nothing is faked.

### 2. Calculation service (recommended, for rigorous unit checking)

```bash
cd calc
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt                      # pure-Python core (SymPy, Pint, FastAPI)
uvicorn app.main:app --reload --port 8000            # http://localhost:8000
```

> The core requirements are intentionally lean (no NumPy/SciPy — they aren't
> used yet), so they install cleanly everywhere including Termux/Android. Future
> numerical features live in `calc/requirements-optional.txt`.

Point the web app at it by setting `CALC_SERVICE_URL=http://localhost:8000` in
`web/.env.local` (already the default). Without it, the JS fallback runs and is
labeled as such.

---

## Configuration

Copy `web/.env.example` → `web/.env.local` and fill in:

| Variable | Required? | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | For all AI generation | Server-side Anthropic key. Get one at console.anthropic.com. |
| `ANTHROPIC_MODEL` | Optional | Defaults to `claude-sonnet-5`. |
| `YOUTUBE_API_KEY` | For real video search | YouTube Data API v3 key. Enable the API + create a key in Google Cloud Console. |
| `CALC_SERVICE_URL` | Optional | URL of the Python calc service (default `http://localhost:8000`). |
| `DATABASE_URL` | Optional | Only for the account/Prisma upgrade path. Guest mode needs none. |
| `RATE_LIMIT_PER_MINUTE` | Optional | Per-IP request cap per route (default 30). |

**All keys are read only on the server** (API routes) and are never sent to the
browser. `.env.example` contains names only — no secrets.

### YouTube Data API setup

1. In Google Cloud Console, enable **YouTube Data API v3**.
2. Create an **API key** credential.
3. Put it in `web/.env.local` as `YOUTUBE_API_KEY`.
4. Note the default quota is 10,000 units/day; each search costs ~100 units.
   The app detects and reports quota exhaustion gracefully.

---

## Commands

From `web/`:

```bash
npm run dev          # start dev server (http://localhost:3000)
npm run build        # production build
npm run start        # run the production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright e2e (desktop + mobile); builds/starts the app
```

Optional database (accounts) from `web/`:

```bash
npm run prisma:generate
npm run db:push          # or: npm run prisma:migrate
```

From `calc/`:

```bash
pip install -r requirements-dev.txt   # runtime deps + pytest/httpx
pytest -q                             # run the calc test suite
uvicorn app.main:app --port 8000      # run the service
```

---

## Testing

- **Web unit tests (Vitest)** — unit conversion, ΔT vs absolute temperature,
  dimensional analysis, significant figures, AI-output schema validation,
  YouTube normalization/ranking/dedupe, prompt-injection defense, upload
  validation, quiz grading. `cd web && npm test`
- **Web e2e (Playwright)** — app shell, empty/error states, mobile layout,
  theme toggle, and the missing-API-key path. Runs on desktop + a mobile
  device profile. `cd web && npm run test:e2e`
- **Calc tests (pytest)** — energy balance, Bernoulli √, dimensional
  inconsistency detection, expected-unit mismatch, sandbox rejection of
  attribute access / `eval`, Celsius & pressure warnings, ΔT conversion.
  `cd calc && pytest -q`

Current status: **37 Vitest**, **16 pytest**, and **8 Playwright specs**
(run on desktop + mobile = 16 checks) passing; `typecheck`, `lint`, and
production `build` all clean.

---

## Manual test examples

Once `ANTHROPIC_API_KEY` is set, try these across disciplines:

- **Thermodynamics** — Solve: *"2 kg of water at 20 °C heated to 80 °C, c = 4186 J/(kg·K); find Q."* (calc service verifies Q = 502,320 J).
- **Statics** — Learn: *"Free-body diagrams"*; Solve a pin-support reaction problem.
- **Fluids** — Solve a Bernoulli problem: *"water exits a tank 5 m below the surface; find v."*
- **Circuits** — Solve: *"12 V across a 4 Ω resistor; find current and power."*
- **Controls** — Learn: *"Bode plots"* or *"PID controller tuning."*
- **Statistics** — Quiz on *"probability and statistics."*

---

## Security & privacy

- Secrets stay server-side; `.env*` is gitignored.
- Uploads are type/size-validated (≤ 8 MB; text, image, PDF) and sanitized;
  private upload content is not logged.
- The calc service **never** executes arbitrary code — a restricted AST allows
  only numbers, named variables, whitelisted math functions, and arithmetic.
- Untrusted content (input, uploads, video metadata, retrieved pages) is treated
  as data, never instructions.
- Per-IP rate limiting on AI/video routes.
- Guest data lives in your browser; the dashboard has **"Delete all my data."**
- AI-generated content is clearly labeled; a footer reminds students to follow
  their course's academic-integrity policy. Hint-first and "check my work"
  modes support learning over answer-copying.

---

## Deployment

**See [`DEPLOY.md`](./DEPLOY.md) for a step-by-step Vercel guide** (≈5 minutes,
makes it phone-installable).

- **Web** — deploys to any Node host or Vercel (`npm run build` / `npm start`).
  On Vercel, set the project **Root Directory to `web`** and add your API keys as
  environment variables. For multi-instance deploys, replace the in-memory rate
  limiter (`web/src/lib/rateLimit.ts`) with Redis.
- **Installable (PWA)** — the app ships a web manifest + generated icons, so on a
  phone you can **Add to Home Screen** (iOS Safari) or **Install app** (Android
  Chrome) and it runs full-screen like a native app.
- **Run it on your Android phone (Termux)** — see [`TERMUX.md`](./TERMUX.md) to
  run the whole thing locally on-device, no cloud needed.
- **Calc service** — containerize `calc/` (`uvicorn app.main:app`) and set
  `CALC_SERVICE_URL` to its internal URL. It holds no secrets.
- **Database (optional)** — switch the Prisma datasource to `postgresql`, set
  `DATABASE_URL`, and run migrations.

---

## Known limitations

- **Real AI/video output requires your keys.** This session verified every code
  path, graceful-degradation state, schema, and calculation, but live lesson/
  quiz generation and live video results need `ANTHROPIC_API_KEY` / `YOUTUBE_API_KEY`.
- Accounts/sync are scaffolded (Prisma schema) but the MVP ships **guest mode**
  (localStorage); there is no auth server yet.
- File extraction for images/PDF uses the model's vision/document reading and
  asks you to confirm the transcription — it is not OCR-perfect.
- The JS calc fallback validates **units/dimensions** but does not compute
  numeric results offline (the Python service does the full evaluation).
- Rate limiting and video caching are in-memory (single instance).
- No external web-retrieval/citation pipeline yet; the citation *schema and
  rules* exist, but source-grounded retrieval is a future item.

## Future improvements

- Authenticated accounts with server-synced progress (wire up the Prisma layer).
- Source-grounded retrieval with real citations (university/gov/standards).
- Transcript-aware video timestamping where officially available.
- Richer diagram library (circuits, beams, mechanisms) beyond Mermaid/SVG.
- Spaced-repetition scheduling driven by the mastery model.
- Server-side quiz grading to avoid sending answers to the client.
- Redis-backed rate limiting and a video-result cache.

---

## License / attribution

Educational sample project. AI-generated instructional content should be
verified against authoritative course materials. Standards (ASME, ASTM, IEEE,
ISO, NEC, building codes) are copyrighted and edition-dependent — the app warns
about this and does not reproduce standard text that was not retrieved.

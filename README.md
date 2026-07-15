# ProjectPath

**Every project is easier with a clear path.**

ProjectPath is a beginner-friendly, mobile-first web app that guides people
through home-improvement and DIY projects safely — even with little or no
experience. Pick a project and get a plain-language overview, cost/time/difficulty
estimates, tools and materials, clear safety warnings, a visual step-by-step
checklist with progress tracking, troubleshooting help, and honest guidance on
when to stop and call a professional.

The app runs **fully in demo mode with zero configuration**: 10 detailed seed
projects load from local data and all of your progress, shopping lists, and notes
persist to the browser. Add Supabase credentials to enable real accounts and
cloud sync.

---

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000
```

No environment variables are required for demo mode. Copy `.env.example` to
`.env.local` only if you want to connect Supabase.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (http://localhost:3000) |
| `npm run build` | Production build (also type-checks and lints) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end test (Playwright) |

---

## Feature tour

- **Landing page** — hero, search with suggestions, categories, featured &
  beginner projects, how-it-works, safety messaging, and a recently-viewed strip.
- **Project library** (`/projects`) — search and filter by category, difficulty,
  time, cost, indoor/outdoor, required tools, renter-friendly, and pro/permit
  needs; sort by recommended / quickest / cheapest / easiest.
- **Project details** (`/projects/[slug]`) — scope, risks, tools & materials,
  preparation, safety gear, common mistakes, "don't attempt if…" and "call a pro
  if…" sections. Check off what you own to generate a **missing-items shopping
  list**.
- **Guided mode** (`/projects/[slug]/guide`) — distraction-free, one step at a
  time, with per-step tools/materials, always-visible safety warnings, beginner
  tips, "why this matters", troubleshooting, a progress bar, and pause/resume.
  High-risk warnings must be explicitly acknowledged before you can proceed.
- **Troubleshooting** — describe a problem in your own words; v1 matches keywords
  to predefined guidance and presents ranked **possibilities, never confirmed
  diagnoses**. The matcher is isolated so an AI service can replace it later.
- **Project planner** (`/planner`) — answer a few questions and get recommended
  projects with plain-language reasons for each match.
- **Dashboard** (`/dashboard`) — in-progress (resume from the exact step),
  completed, saved projects, stats (projects completed, estimated saved, skills
  learned), recent activity, and notes.
- **Shopping list** (`/shopping-list`) — combined across projects, grouped by
  department or project, with quantities, owned/purchased flags, custom items,
  estimated totals, and copy/print. Prices are always labeled estimates.
- **Settings** (`/settings`) — light/dark/system theme, text size, reduced
  motion, US/metric units, notification preferences, and a data reset.

---

## Architecture overview

Business logic is kept separate from presentation. Pure, framework-free modules
under `src/lib` are unit-tested in isolation; React components render them.

```
src/
  app/                     # Next.js App Router pages (thin server wrappers)
    page.tsx               #   landing
    projects/…             #   library, details, guide, completion
    planner|dashboard|shopping-list|settings/
    layout.tsx, providers.tsx, globals.css
  components/
    ui/                    # shadcn-style primitives (button, card, dialog, …)
    *.tsx                  # app components (ProjectCard, StepViewer, …)
  lib/
    types.ts               # all domain types
    seed/                  # categories, tool/material catalog, 10 projects
    repository/            # storage-agnostic interface + local + supabase impls
    store/                 # hydration-safe client store (React context)
    supabase/              # browser + server clients (public anon key only)
    filters|format|planner|progress|shopping|troubleshooting|validation.ts
    settings.ts, config.ts, utils.ts
supabase/migrations/       # schema + row-level security policies
tests/
  unit/                    # Vitest — logic, formatting, filtering, planner, …
  e2e/                     # Playwright — the critical persist-on-refresh flow
```

### State & persistence

- Public project content comes from **seed data** and is read-only.
- The app depends only on a `UserDataRepository` interface. Guests use a
  `LocalUserDataRepository` (localStorage); signed-in users use a
  `SupabaseUserDataRepository` backed by RLS-protected tables. Swapping storage
  requires no UI changes.
- The store hydrates **after mount**, so server and first client render match and
  there are no hydration errors from reading localStorage. Writes are debounced.

### Data model

Typed models and matching SQL exist for: User/Profile, Project, ProjectCategory,
Tool, Material, ProjectTool, ProjectMaterial, ProjectStep, StepTool, StepMaterial,
SafetyWarning, TroubleshootingEntry, UserProject, StepProgress, SavedProject,
ShoppingList, ShoppingListItem, UserNote, and UserToolInventory — with IDs,
timestamps, relationships, indexes, and authorization policies.

---

## Enabling Supabase (optional)

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations in `supabase/migrations` (in order) with the Supabase SQL
   editor or CLI:
   ```bash
   supabase db push        # or paste the SQL files in the dashboard
   ```
3. Copy `.env.example` to `.env.local` and fill in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=…
   NEXT_PUBLIC_SUPABASE_ANON_KEY=…
   ```
4. Restart the dev server. Sessions now sync to Supabase; row-level security
   ensures each user can only read/write their own progress, notes, inventory,
   and shopping lists.

**Security notes**

- Only the two `NEXT_PUBLIC_*` values reach the browser. The service-role key is
  never referenced in application code and must stay server-only.
- All user input is validated with Zod (`src/lib/validation.ts`).
- Notes are stored and rendered as plain text — React escapes them, so user input
  cannot inject markup.
- Public content tables are readable by everyone but writable by no standard user.

---

## Testing

```bash
npm test          # 69 unit tests: filtering, formatting, shopping-list
                  # generation, progress, planner logic, validation,
                  # seed integrity, and high-risk warning acknowledgment
npm run test:e2e  # Playwright: open a project → start → complete a step →
                  # refresh → progress is still saved
```

---

## Deployment

Deploy anywhere that runs Next.js 15 (e.g. Vercel):

```bash
npm run build
npm run start
```

Set the `NEXT_PUBLIC_SUPABASE_*` environment variables in your host if you want
cloud sync; otherwise the app ships and runs in demo mode.

---

## Safety & accuracy

ProjectPath is educational. Costs, times, and money-saved figures are clearly
labeled estimates, not live pricing or guarantees. The seed library intentionally
avoids elevated-risk regulated work (electrical, gas, structural, roofs, asbestos,
mold, and major plumbing) and consistently points beginners to a licensed
professional when a job is beyond a safe DIY scope.

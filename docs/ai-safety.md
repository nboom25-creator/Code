# AI usage and numerical integrity

## Principle

**Every number in PartForge comes from deterministic code.** Mesh measurements, health counts,
thickness estimates, FEA results, safety factors, scores — all computed by trimesh/NumPy/Gmsh/
CalculiX pipelines that are unit-tested, some against analytical solutions. The AI layer cannot
create, alter, or "improve" any numeric result.

## What the AI layer may do

Providers implement exactly two capabilities (`backend/app/services/ai/`):

1. `explain_recommendations` — re-present already-computed findings in prose. The prompt forbids
   inventing values; the numbers passed in are the only numbers available to it, and the output is
   displayed as explanation text, never stored as data.
2. `propose_load_case` — translate the user's free-text description into a **draft** structured
   load case. The draft is schema-validated (`LoadCaseProposal`); magnitudes may only be values the
   user wrote (missing values stay null and become `open_questions`); each entry carries only a
   textual `region_hint` — the user must map it to a real selected region and save it explicitly.
   Nothing is applied automatically.

Any operation document a client (AI or human) submits for variant generation passes the same
Pydantic schema validation, protected-region checks, and post-operation geometry validation as the
built-in rules. An LLM can never emit mesh vertices directly.

## Providers

- `rules` (default): fully deterministic and local — template text and keyword extraction. The
  application is complete without any external AI service.
- `mock`: fixed strings for tests.
- `openai` / `anthropic`: optional, enabled only by API keys in the environment; requests contain
  project context and computed findings; responses are parsed, schema-validated, and labeled with
  the provider name in the UI. Provider failures surface as errors, never as fabricated content.

## Honesty rules elsewhere in the product

- Units are never guessed silently; the suggestion is labeled an estimate and requires confirmation.
- Factors of safety carry `fos_valid` gates; singular peaks are flagged; invalid FoS is shown as
  reference-only with the failed gates named.
- Variants only claim improvement backed by re-run analysis or an explicit geometry rule; the
  comparison score's formula is displayed with the score.
- Mock demo results (only possible outside production mode, only if explicitly seeded) are labeled
  `is_mock` end-to-end and excluded from rule evaluation and comparisons.
- STEP export is refused because no true B-rep solid exists; exports are STL/3MF + operation
  recipe JSON.

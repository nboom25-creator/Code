# 🍽️ Weekly Dinner Meal Planner

An interactive, seafood-free, onion-family-free weekly dinner planner with a randomize/swap button, a live serving-size scale, and an auto-scaling shopping list. **50 recipes** in the pool.

## Run it
Open **`index.html`** in any browser — no install, works offline.

```
# optional local server
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Features
- **🎚️ Serving-size scale** — drag the slider (1–12). Every ingredient quantity and the shopping list recalculate live from a baseline of 2 (`qty × servings / 2`). Discrete items (eggs, cans, tortillas) round to whole units.
- **🎲 Swap / randomize** — each night has a swap button that pulls in a meal **you haven't been served before**. Meals never repeat until the entire 50-recipe pool is exhausted, and the week always stays unique (no two nights share a meal). "🎲 Randomize week" reshuffles all seven nights.
- **🛒 Consolidated shopping list** — combines every ingredient across the 7 nights (merging duplicates), grouped by Produce / Proteins / Pantry, scaled to your serving size.

## Dietary constraints (enforced on every recipe in the pool)
- **No fish or seafood** — including fish sauce, shrimp paste, and oyster sauce (Thai dishes use soy sauce / coconut aminos / oyster-free stir-fry sauce).
- **No onion family** — no onion, scallion, shallot, leek, or chive. **Garlic is allowed** and used for savory depth, alongside ginger, lemongrass, fennel, and spices.
- Cuisines: Italian-American (13), traditional American (12), Tex-Mex/Mexican (13), Thai (12).

A build-time check in `build-static.js` fails if any recipe contains a banned ingredient.

## Files
| File | Purpose |
|------|---------|
| `index.html` | The app UI (open this). |
| `app.js` | Scaling, non-repeating swap logic, shopping-list aggregation. |
| `meals.js` | The 50-recipe dataset (ingredients + steps) — the single source of truth. |
| `build-static.js` | Regenerates the static docs from `meals.js` and runs the dietary check. |
| `MEAL_PLAN.md` | Generated human-readable starter 7-night plan. |
| `meal-plan.json` | Generated machine-readable starter plan + scaling rule. |

## Regenerating the static docs
`MEAL_PLAN.md` and `meal-plan.json` are generated — don't edit them by hand:

```
node build-static.js
```

## Data shape (`meals.js`)
```js
{
  id, name, cuisine, minutes,
  ingredients: [{ name, qty, unit, category, discrete }],  // qty = baseline for 2 servings
  steps: [ "..." ]
}
```
Scale any quantity with `qty × (servings / 2)`; round when `discrete: true`.

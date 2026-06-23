# 🍽️ Weekly Dinner Meal Planner

An interactive, allium-free, seafood-free weekly dinner planner with a randomize/swap button, a live serving-size scale, and an auto-scaling shopping list.

## Run it
Open **`index.html`** in any browser — no install, no build step, works offline.

```
# optional local server
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Features
- **🎚️ Serving-size scale** — drag the slider (1–12). Every ingredient quantity and the shopping list recalculate live from a baseline of 2 (`qty × servings / 2`). Discrete items (eggs, cans, tortillas) round to whole units.
- **🎲 Swap / randomize** — each night has a swap button that pulls in a meal **you haven't been served before**. Meals never repeat until the entire 16-recipe pool is exhausted, and the week always stays unique (no two nights share a meal). "🎲 Randomize week" reshuffles all seven nights.
- **🛒 Consolidated shopping list** — combines every ingredient across the 7 nights (merging duplicates), grouped by Produce / Proteins / Pantry, scaled to your serving size.

## Dietary constraints (enforced on every recipe in the pool)
- **No fish or seafood** — including fish sauce and shrimp paste.
- **No alliums** — onion, scallion, chive, shallot, leek, **and garlic**.
- Flavor built with allium-free aromatics: ginger, lemongrass, fennel seed, smoked paprika, cumin, celery, carrot, fresh herbs.
- Cuisines: Italian-American, traditional American, Tex-Mex/Mexican, Thai.

> Garlic was excluded to honor the literal "all alliums" rule. If it's actually fine, it can be reintroduced.

## Files
| File | Purpose |
|------|---------|
| `index.html` | The app UI (open this). |
| `app.js` | Scaling, non-repeating swap logic, shopping-list aggregation. |
| `meals.js` | The 16-recipe dataset (ingredients + steps), the app's source of truth. |
| `MEAL_PLAN.md` | Human-readable static version of the starter 7-night plan. |
| `meal-plan.json` | Machine-readable static plan + scaling rule. |

## Data shape (`meals.js`)
```js
{
  id, name, cuisine, minutes,
  ingredients: [{ name, qty, unit, category, discrete }],  // qty = baseline for 2 servings
  steps: [ "..." ]
}
```
Scale any quantity with `qty × (servings / 2)`; round when `discrete: true`.

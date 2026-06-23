# Weekly Dinner Meal Planner

An allium-free, seafood-free weekly dinner plan with full recipes and a programmatic scaling matrix.

## Files
- **[`MEAL_PLAN.md`](./MEAL_PLAN.md)** — the human-readable 7-night plan: categorized ingredient lists (with explicit quantities), step-by-step instructions, and a scaling guide.
- **[`meal-plan.json`](./meal-plan.json)** — the machine-readable data structure powering serving-size scaling and shopping lists.

## Dietary constraints (enforced across every recipe)
- **No fish or seafood** — including fish sauce and shrimp paste.
- **No alliums** — onion, scallion, chive, shallot, leek, **and garlic**.
- Flavor is built with allium-free aromatics: ginger, lemongrass, fennel seed, smoked paprika, cumin, celery, carrot, and fresh herbs.
- Cuisines: Italian-American, traditional American, Tex-Mex/Mexican, and Thai.

> If garlic is actually acceptable, it can be reintroduced — it was excluded to honor the literal "all alliums" rule.

## Scaling

Baseline is **2 servings**. To scale any ingredient:

```
adjusted_qty = baseline_qty * (desired_servings / 2)
```

Example (4 servings, multiplier ×2.0):

```python
import json

desired = 4
plan = json.load(open("meal-plan.json"))
mult = desired / plan["meta"]["baseline_servings"]

for day in plan["days"]:
    print(f"\n{day['day']}: {day['meal']}")
    for ing in day["ingredients"]:
        qty = ing["baseline_qty"] * mult
        if ing["discrete"]:
            qty = round(qty)
        print(f"  {qty:g} {ing['unit']} {ing['name']}")
```

Discrete items (eggs, cans, tortillas) round to whole units; salt and hot spices scale slightly sub-linearly — start at ~0.8× and adjust to taste.

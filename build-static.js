#!/usr/bin/env node
// Generates the static MEAL_PLAN.md and meal-plan.json from meals.js so they
// never drift from the app's data. The first 7 meals become the starter week.
// Also validates dietary constraints (no seafood / no banned alliums).

const fs = require("fs");
const path = require("path");
const { MEALS } = require("./meals.js");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const BASELINE = 2;
const CATS = ["Produce", "Proteins", "Pantry"];

// --- Dietary safety check --------------------------------------------------
const BANNED = [
  /\bonion\b/i, /\bscallion/i, /\bshallot/i, /\bleek/i, /\bchive/i,           // onion family (garlic allowed)
  /\bfish\b/i, /\bsalmon|tuna|cod|shrimp|prawn|crab|lobster|anchov|squid|clam|mussel|scallop\b/i,
  /fish sauce/i, /shrimp paste/i, /oyster sauce/i
];
const ALLOW = [/garlic/i, /anchovy-free/i, /oyster-free/i, /shrimp-free/i];

let violations = [];
for (const m of MEALS) {
  for (const ing of m.ingredients) {
    if (ALLOW.some((r) => r.test(ing.name))) continue;
    for (const bad of BANNED) {
      if (bad.test(ing.name)) violations.push(`${m.id}: "${ing.name}" matches ${bad}`);
    }
  }
}
if (violations.length) {
  console.error("DIETARY CHECK FAILED:\n" + violations.join("\n"));
  process.exit(1);
}
console.log(`Dietary check passed for ${MEALS.length} meals.`);

// --- Helpers ---------------------------------------------------------------
const FRAC = [[0.125,"⅛"],[0.25,"¼"],[0.333,"⅓"],[0.375,"⅜"],[0.5,"½"],[0.625,"⅝"],[0.667,"⅔"],[0.75,"¾"],[0.875,"⅞"]];
function fmt(v) {
  if (Number.isInteger(v)) return String(v);
  const whole = Math.floor(v), frac = v - whole;
  let best = null, bestD = 0.04;
  for (const [f, s] of FRAC) { const d = Math.abs(frac - f); if (d < bestD) { bestD = d; best = s; } }
  return best ? (whole ? whole + " " : "") + best : (+v.toFixed(2)).toString();
}

// --- MEAL_PLAN.md ----------------------------------------------------------
// Curated, cuisine-varied starter week (the app randomizes its own).
const STARTER = [
  "rigatoni-herb-chicken", "fajita-bowls", "pad-krapow", "meatloaf",
  "enchiladas", "eggplant-parm", "coconut-curry"
];
const week = STARTER.map((id) => {
  const m = MEALS.find((x) => x.id === id);
  if (!m) throw new Error(`Starter id not found: ${id}`);
  return m;
});
let md = `# 🍽️ Weekly Dinner Plan

> 💡 **There's an interactive app** — open [\`index.html\`](./index.html) for a live serving-size slider, a 🎲 swap button (meals never repeat), and an auto-scaling shopping list. This file is the static starter plan, generated from \`meals.js\`.

**Baseline servings:** 2 (every recipe scales — see the [Scaling Matrix](#-scaling-matrix)).

### Dietary rules applied to every recipe
- 🚫 **No fish or seafood** — including **fish sauce, shrimp paste, and oyster sauce**; Thai dishes use **soy sauce / coconut aminos** and oyster-free stir-fry sauce.
- 🚫 **No onion family** — no onions, scallions, shallots, leeks, or chives. ✅ **Garlic is used** for savory depth, alongside ginger, lemongrass, fennel, and spices.
- ✅ Cuisines lean **Italian-American, traditional American, Tex-Mex/Mexican, and Thai**.

---

## Week at a Glance

| Night | Meal | Cuisine |
|-------|------|---------|
`;
week.forEach((m, i) => { md += `| **${DAYS[i]}** | ${m.name} | ${m.cuisine} |\n`; });
md += `\n> This is one of **${MEALS.length}** recipes in the pool. Use the app's 🎲 swap to rotate in any of the others.\n\n---\n`;

week.forEach((m, i) => {
  md += `\n## ${DAYS[i]}\n### ${m.name}\n*${m.cuisine} • ~${m.minutes} min • Baseline: 2 servings*\n\n**Ingredients**\n`;
  for (const cat of CATS) {
    const items = m.ingredients.filter((x) => x.category === cat);
    if (!items.length) continue;
    md += `\n*${cat}*\n`;
    for (const ing of items) md += `- ${fmt(ing.qty)} ${ing.unit} ${ing.name}\n`;
  }
  md += `\n**Instructions**\n`;
  m.steps.forEach((s, n) => { md += `${n + 1}. ${s}\n`; });
  md += `\n---\n`;
});

md += `
## 📊 Scaling Matrix

Every quantity is the **baseline for 2 servings**. To scale, multiply by:

\`\`\`
multiplier = desired_servings / 2
\`\`\`

| Desired servings | Multiplier |
|------------------|------------|
| 2 (baseline) | × 1.0 |
| 3 | × 1.5 |
| 4 | × 2.0 |
| 6 | × 3.0 |
| 8 | × 4.0 |

**Notes**
- Discrete items (eggs, cans, tortillas) round to whole units.
- Salt and hot spices scale slightly sub-linearly — start at ~0.8× the math and adjust.
- Cooking times stay roughly constant; scale pan/sheet count to avoid steaming.

The full machine-readable dataset for all ${MEALS.length} recipes lives in [\`meals.js\`](./meals.js); the starter week is mirrored in [\`meal-plan.json\`](./meal-plan.json).
`;

fs.writeFileSync(path.join(__dirname, "MEAL_PLAN.md"), md);

// --- meal-plan.json --------------------------------------------------------
const json = {
  meta: {
    title: "Weekly Dinner Plan",
    baseline_servings: BASELINE,
    pool_size: MEALS.length,
    scaling_rule: "adjusted_qty = baseline_qty * (desired_servings / baseline_servings)",
    dietary_constraints: {
      no_fish_or_seafood: true,
      no_fish_sauce_shrimp_paste_oyster_sauce: true,
      garlic_allowed: true,
      excluded_alliums: ["onion", "scallion", "shallot", "leek", "chive"],
      preferred_cuisines: ["Italian-American", "American", "Tex-Mex", "Mexican", "Thai"]
    },
    scaling_notes: [
      "Discrete items (eggs, cans, tortillas) round to whole units.",
      "Salt and hot spices scale slightly sub-linearly (~0.8x).",
      "Cooking times stay roughly constant; scale pan/sheet count."
    ]
  },
  days: week.map((m, i) => ({
    day: DAYS[i],
    meal: m.name,
    cuisine: m.cuisine,
    active_minutes: m.minutes,
    ingredients: m.ingredients.map((x) => ({
      name: x.name, baseline_qty: x.qty, unit: x.unit, category: x.category, discrete: x.discrete
    }))
  }))
};
fs.writeFileSync(path.join(__dirname, "meal-plan.json"), JSON.stringify(json, null, 2) + "\n");

console.log(`Wrote MEAL_PLAN.md and meal-plan.json (${MEALS.length} recipes, ${week.length}-day starter week).`);

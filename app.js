/* Weekly Meal Planner — interactive logic
   - Serving-size scale rescales every quantity live.
   - Per-card 🎲 swap pulls a new meal that is NOT on the board and that you
     have NOT been served before (history), so meals never repeat until the
     entire pool is exhausted (then history resets but the board stays unique).
*/

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const BASELINE = 2;

const byId = (id) => MEALS.find((m) => m.id === id);

// --- State -----------------------------------------------------------------
let servings = 2;
let week = [];        // array of 7 meal ids, one per day
let seen = new Set(); // ids the user has already been served (history)

// Pick `n` distinct random meals for the initial week, recording them as seen.
function seedWeek() {
  const pool = [...MEALS];
  shuffle(pool);
  week = pool.slice(0, 7).map((m) => m.id);
  seen = new Set(week);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Swap the meal in `dayIndex` for one not currently on the board and not yet seen.
function swapMeal(dayIndex) {
  const onBoard = new Set(week);
  let candidates = MEALS.filter((m) => !onBoard.has(m.id) && !seen.has(m.id));

  // Whole pool seen? Reset history (keep current board unique) and try again.
  if (candidates.length === 0) {
    seen = new Set(week);
    candidates = MEALS.filter((m) => !onBoard.has(m.id));
  }
  if (candidates.length === 0) return; // pool smaller than 7 — nothing to swap

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  week[dayIndex] = pick.id;
  seen.add(pick.id);
  render();
}

function randomizeAll() {
  seedWeek(); // reseeds the week and resets history to the new board
  render();
}

// --- Scaling ---------------------------------------------------------------
function scaledQty(ing) {
  let v = ing.qty * (servings / BASELINE);
  if (ing.discrete) v = Math.max(1, Math.round(v));
  return v;
}

// Render numbers as tidy fractions where it reads naturally.
function fmt(v) {
  if (Number.isInteger(v)) return String(v);
  const whole = Math.floor(v);
  const frac = v - whole;
  const map = [
    [0.125, "⅛"], [0.25, "¼"], [0.333, "⅓"], [0.375, "⅜"], [0.5, "½"],
    [0.625, "⅝"], [0.667, "⅔"], [0.75, "¾"], [0.875, "⅞"]
  ];
  let best = null, bestD = 0.04;
  for (const [f, s] of map) {
    const d = Math.abs(frac - f);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (best) return (whole ? whole + " " : "") + best;
  return v.toFixed(2).replace(/\.?0+$/, "");
}

// --- Rendering -------------------------------------------------------------
const CATEGORY_ORDER = ["Produce", "Proteins", "Pantry"];

function ingredientList(meal) {
  const groups = {};
  for (const ing of meal.ingredients) (groups[ing.category] ||= []).push(ing);
  return CATEGORY_ORDER.filter((c) => groups[c]).map((cat) => `
    <div class="cat">
      <h5>${cat}</h5>
      <ul>${groups[cat].map((ing) =>
        `<li><span class="qty">${fmt(scaledQty(ing))} ${ing.unit}</span> ${ing.name}</li>`
      ).join("")}</ul>
    </div>`).join("");
}

function render() {
  document.getElementById("servingsVal").textContent = servings;
  document.getElementById("mult").textContent = "×" + (servings / BASELINE).toFixed(2).replace(/\.?0+$/, "");

  const grid = document.getElementById("week");
  grid.innerHTML = week.map((id, i) => {
    const m = byId(id);
    return `
      <article class="card" data-cuisine="${m.cuisine}">
        <header>
          <div>
            <span class="day">${DAYS[i]}</span>
            <span class="badge">${m.cuisine} · ${m.minutes} min</span>
          </div>
          <button class="swap" data-day="${i}" title="Swap for a new meal">🎲 Swap</button>
        </header>
        <h3>${m.name}</h3>
        ${ingredientList(m)}
        <details>
          <summary>Cooking instructions</summary>
          <ol>${m.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        </details>
      </article>`;
  }).join("");

  grid.querySelectorAll(".swap").forEach((b) =>
    b.addEventListener("click", () => swapMeal(+b.dataset.day)));

  renderShoppingList();
}

function renderShoppingList() {
  const agg = {}; // key: name|unit|category -> qty
  for (const id of week) {
    for (const ing of byId(id).ingredients) {
      const key = `${ing.name}|${ing.unit}|${ing.category}`;
      agg[key] = (agg[key] || 0) + (ing.discrete
        ? Math.max(1, Math.round(ing.qty * (servings / BASELINE)))
        : ing.qty * (servings / BASELINE));
    }
  }
  const groups = {};
  for (const key in agg) {
    const [name, unit, category] = key.split("|");
    (groups[category] ||= []).push({ name, unit, qty: agg[key] });
  }
  const el = document.getElementById("shopping");
  el.innerHTML = CATEGORY_ORDER.filter((c) => groups[c]).map((cat) => `
    <div class="cat">
      <h5>${cat}</h5>
      <ul>${groups[cat].sort((a, b) => a.name.localeCompare(b.name)).map((it) =>
        `<li><span class="qty">${fmt(it.qty)} ${it.unit}</span> ${it.name}</li>`
      ).join("")}</ul>
    </div>`).join("");
}

// --- Wire up ---------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  const slider = document.getElementById("servings");
  slider.addEventListener("input", () => { servings = +slider.value; render(); });
  document.getElementById("randomizeAll").addEventListener("click", randomizeAll);
  document.getElementById("toggleShopping").addEventListener("click", () => {
    document.body.classList.toggle("show-shopping");
  });
  seedWeek();
  render();
});

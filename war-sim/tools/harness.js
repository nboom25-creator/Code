/* =============================================================================
 * tools/harness.js — load the model outside a browser.
 *
 * The app is three IIFEs that hang themselves off `window`, because it is a
 * page with no build step and that is the simplest thing that works. The
 * consequence is that every offline tool — the backtest runner, the coefficient
 * fitter — used to need a real browser to get at `simulate()`, which meant a
 * playwright dependency and a page load per evaluation.
 *
 * None of data.js, model.js or backtest.js touches the DOM. They only need the
 * `window` object to exist, so this hands them one. charts.js and app.js are
 * the parts that draw things and are not loaded here.
 *
 * Everything runs in-process, which also makes the fitter roughly an order of
 * magnitude faster: no round trip per candidate coefficient.
 * ========================================================================== */

const path = require("path");

function load() {
  if (!global.window) global.window = {};
  const js = (f) => path.resolve(__dirname, "..", "js", f);
  require(js("data.js"));
  require(js("model.js"));
  require(js("backtest.js"));
  return {
    WarData: global.window.WarData,
    WarModel: global.window.WarModel,
    WarBacktest: global.window.WarBacktest,
  };
}

/* The same outcome mapping the backtest and the fitter both need. Defined here
 * so the two cannot drift apart. */
const OUTCOME_CLASS = {
  attackerObjective: "attacker", defenderCollapse: "attacker", pyrrhic: "attacker",
  defenderCapitulates: "attacker",
  attackerCollapse: "defender", attackerWithdraws: "defender",
  // The model has no negotiated draw: `unresolved` means it reached its
  // horizon with the war still running. Scored against a historical
  // "stalemate" because that is the closest real category, but the two
  // are not the same claim and a case that leans on it is a weak pass.
  unresolved: "stalemate", nuclear: "nuclear",
};

/* Probability mass the model put on what actually happened. */
function massOn(breakdown, actualOutcome) {
  let mass = 0;
  for (const [k, v] of Object.entries(breakdown)) {
    if ((OUTCOME_CLASS[k] || "stalemate") === actualOutcome) mass += v;
  }
  return mass;
}

/* One case, one simulation. Seed is fixed so a coefficient change shows up as
 * a real difference rather than Monte Carlo noise. */
function runCase(M, WarData, c, iterations) {
  const A = c.useLive ? WarData.BY_ID[c.useLive[0]] : c.a;
  const B = c.useLive ? WarData.BY_ID[c.useLive[1]] : c.b;
  return M.simulate(A, B, { ...c.opts, iterations, seed: 424242 });
}

module.exports = { load, OUTCOME_CLASS, massOn, runCase };

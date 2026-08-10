/* =============================================================================
 * model.js — the war model
 *
 * Design notes, because the numbers are only as good as the assumptions:
 *
 *  1. Nothing is decided by a single "power score". Wars are resolved as a
 *     month-by-month campaign in which air control, ground combat, sea control,
 *     industrial replacement, oil, and political will all feed back into each
 *     other. A side can win every battle and still lose the war.
 *
 *  2. Distance is a first-class combatant. Almost every country is formidable
 *     at home and helpless 5,000 km away. Force is discounted by a projection
 *     curve derived from carriers, tankers, sealift and overseas basing.
 *
 *  3. Defence is cheaper than offence. Terrain, prepared positions, short
 *     interior lines and the fact that people fight harder for their own
 *     ground are all modelled explicitly.
 *
 *  4. Taking ground is not the same as holding it. Occupation is checked
 *     against the classic counter-insurgency force ratio (~20 troops per 1,000
 *     inhabitants). Plenty of "victories" end in an insurgency the winner
 *     cannot afford.
 *
 *  5. Nuclear weapons are not a bigger tank. A nuclear state facing regime
 *     collapse may escalate, and if it does there is no winner. Doctrine
 *     thresholds differ per state.
 *
 *  6. One run is an anecdote. Every parameter that a planner would be
 *     uncertain about — leadership, surprise, intelligence, alliance entry,
 *     friction — is sampled, and the model reports a distribution over a few
 *     thousand runs rather than a single answer.
 * ========================================================================== */

(function () {
  const { BY_ID, PLATFORM_VALUES: PV, sharedAlliance, ALLIANCES } = window.WarData;

  // ── Deterministic RNG (mulberry32) so a given seed replays exactly ─────────
  function rngFactory(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* The campaign runs on a WEEKLY tick. A monthly one could not resolve the
   * Six-Day War, the 100-hour ground phase of Desert Storm, or the 44 days of
   * Nagorno-Karabakh — three of the four duration failures in the backtest were
   * the same failure. Every per-month rate below is multiplied by DT at the
   * point of use, so the coefficients stay readable as monthly quantities. */
  const WEEKS_PER_MONTH = 4.345;
  const DT = 1 / WEEKS_PER_MONTH;

  /* ── Free coefficients ────────────────────────────────────────────────────
   * The dozen numbers in this model that are genuinely arbitrary — not derived
   * from anything, not measurable, just set until the results looked right.
   * Collected here so they can be FITTED against the historical backtest by
   * search rather than by my judgement, and so that anyone reading the model
   * can see exactly how much of it is calibration.
   *
   * `tools/fit.js` searches this object. The values below are whatever that
   * search last produced. Everything else in the model is either sourced data
   * or a documented physical assumption.
   */
  const K = {
    advBase:    0.030,   // floor on monthly advance rate when a line is solid
    advMano:    0.340,   // extra advance available when the front has gaps
    lossBase:   0.045,   // monthly materiel attrition at full contact
    casBase:    0.030,   // monthly casualties as a share of engaged troops
    defBase:    1.300,   // defender multiplier before terrain
    tolScale:   0.052,   // casualty tolerance, share of fit-for-service pool
    tolExp:     1.600,   // how sharply tolerance rises with morale
    transBase:  0.160,   // floor on how much societal exhaustion reaches a regime
    stallW:     0.090,   // impatience per year of no progress
    cohBase:    0.300,   // force loss a unit absorbs before cohesion goes
    qualExch:   0.750,   // how far a technology gap widens the exchange ratio
    biteExp:    0.450,   // how slowly casualties fall off as a fight gets lopsided
    envRatio:   2.200,   // local ratio at which a porous front starts to be cut
    envRate:    0.000,   // monthly odds of envelopment — OFF, see section 7b
    envPocket:  0.220,   // share of fielded force lost when a pocket closes
    capHorizon: 7.000,   // months ahead a leadership discounts a defeat over
    capRate:    2.000,   // monthly odds a defender concedes a lost position
    wdrRate:    0.000,   // attacker abandonment — OFF, see section 11b
    capStake:   0.800,   // how far an existential aim suppresses capitulation
  };
  // Symmetric multiplicative noise: 1 ± spread, triangular-ish.
  const jitter = (rng, spread) => 1 + (rng() + rng() - 1) * spread;

  const EARTH_R = 6371;
  function greatCircle(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h))));
  }

  /* ── Force quality ────────────────────────────────────────────────────────
   * Four multipliers separate a modern brigade from a paper one. They compound,
   * which is deliberate: a badly trained army with obsolete kit and no ISR is
   * not 30% worse than a good one, it is several times worse.
   */
  const qualityMult = (c) => Math.pow(c.tech / 60, 1.25);
  const trainingMult = (c) => 0.45 + 0.55 * (c.trn / 100);
  const experienceMult = (c) => 0.85 + 0.3 * (c.exp / 100);
  const c4Mult = (c) => 0.6 + 0.8 * Math.pow(c.c4 / 100, 1.1);

  function rawDomainScores(c) {
    const q = qualityMult(c), t = trainingMult(c), e = experienceMult(c), n = c4Mult(c);

    let landKit = 0;
    for (const k in PV.land) landKit += PV.land[k] * c[k];
    // Boots still matter. Reserves and paramilitaries count for less because
    // they arrive late, less equipped, and less trained.
    const manpower = (c.act * 1.2 + c.res * 0.25 + c.par * 0.15) * 8;
    // ISR helps ground forces, but less than it helps air forces.
    const land = (landKit + manpower) * q * t * e * Math.pow(n, 0.7);

    let airKit = 0;
    for (const k in PV.air) airKit += PV.air[k] * c[k];
    const air = airKit * q * t * e * n;

    let seaKit = 0;
    for (const k in PV.sea) seaKit += PV.sea[k] * c[k];
    const sea = seaKit * q * t * e * n;

    // Long-range strike: inventory breadth × how much of it a budget sustains.
    // The budget term is logarithmic — the difference between a $10bn and a
    // $60bn magazine is large; between $600bn and $950bn, not so much.
    const strike = (c.crm * 1.0 + c.brm * 0.9 + c.hyp * 0.7) *
      (0.4 + 0.6 * Math.log10(1 + c.budPpp / 10)) * Math.pow(q, 0.5);

    // Air defence thins out over a big country; depth partly compensates.
    const coverage = clamp(1.2 - 0.16 * Math.log10(Math.max(1, c.area) / 40), 0.55, 1.2);
    const airDefense = c.ad * (0.5 + 0.5 * (c.tech / 100)) * coverage * t * 45;

    return { land, air, sea, strike, airDefense };
  }

  /* Raw scores span five orders of magnitude between domains, which makes
   * every cross-domain coefficient meaningless and silently zeroed out air
   * defence and long-range strike in an earlier version of this model.
   * Everything is therefore normalised to a 0–100 scale against the strongest
   * country in the dataset for that domain, once, at load. After this, a "10"
   * means the same thing in every domain and the campaign coefficients below
   * are interpretable. */
  const DOMAINS = ["land", "air", "sea", "strike", "airDefense"];
  const RAW = {};
  window.WarData.COUNTRIES.forEach((c) => (RAW[c.id] = rawDomainScores(c)));
  const MAX = {};
  DOMAINS.forEach((d) => (MAX[d] = Math.max(...Object.values(RAW).map((r) => r[d])) || 1));

  // Ground-based air defence is denominated in air-power-equivalent and
  // normalised against the air maximum, NOT against its own. Normalising it
  // against the densest IADS in the dataset makes a small, well-defended
  // country out-score the largest air force in the world — which is how an
  // earlier version of this model had Taiwan's air defences out-massing the
  // entire PLAAF and no invasion ever getting off the beach.
  const AD_TO_AIR = 120;

  function domainScores(c) {
    const raw = RAW[c.id] || rawDomainScores(c);
    return {
      land: (raw.land / MAX.land) * 100,
      air: (raw.air / MAX.air) * 100,
      sea: (raw.sea / MAX.sea) * 100,
      strike: (raw.strike / MAX.strike) * 100,
      airDefense: ((raw.airDefense * AD_TO_AIR) / MAX.air) * 100,
    };
  }

  /* ── Power projection ─────────────────────────────────────────────────────
   * `reach` is the distance at which a country can still bring half its
   * deployable force to bear. It is the single biggest reason most rivalries
   * are regional.
   */
  function projection(c) {
    const index =
      c.cv * 7 + c.lhd * 2.5 + c.tkr * 0.06 + c.tpt * 0.012 +
      c.bases * 0.10 + c.mm * 0.0015 + c.ton * 0.004 + c.log * 0.15;
    const reach = 350 + 55 * Math.pow(Math.max(index, 0.5), 0.95);
    return { index, reach };
  }

  function deployFraction(c, distanceKm, adjacent) {
    const { reach } = projection(c);
    const f = 1 / (1 + Math.pow(distanceKm / reach, 2));
    return adjacent ? Math.max(f, 0.92) : Math.max(f, 0.02);
  }

  // Troops that can be put ashore and sustained per month, in thousands.
  // Sea control gates it hard — unescorted sealift into a contested strait is
  // a target list, not a landing.
  function amphibiousLift(c) {
    // Purpose-built amphibious shipping first; requisitioned civilian ro-ro
    // counts, but far less than its raw tonnage suggests — it needs a working
    // port or a benign beach, and it burns in contested water.
    return c.lhd * 1.2 + c.cv * 0.3 + c.mm * 0.0035 + c.tpt * 0.02;
  }

  /* ── Sustainment ──────────────────────────────────────────────────────────
   * How long can this country actually keep an army in the field? Fuel,
   * factories, and the ability to move both.
   */
  function sustainment(c) {
    const fuel = clamp(c.oilSelfSufficiency, 0.05, 1.6);
    const refining = c.oilc > 0 ? clamp(c.ref / c.oilc, 0.1, 1.5) : 1;
    const transport = clamp(
      Math.log10(1 + c.rail * 3 + c.road / 4) / 3.2, 0.15, 1.35);
    const industry = clamp(Math.pow(c.arms / 60, 0.9), 0.05, 1.9);
    const steel = clamp(Math.log10(1 + c.steel) / 1.9, 0.08, 1.6);
    const money = clamp(Math.pow(c.budPpp / 60, 0.4), 0.12, 2.4);
    // Replacement rate: fraction of committed force regenerated per month.
    const replacement = 0.006 + 0.028 * (industry * 0.45 + steel * 0.25 + money * 0.30);
    return { fuel, refining, transport, industry, steel, money, replacement,
             index: (fuel * 0.9 + refining * 0.5 + transport + industry * 1.2 + steel * 0.6 + money) / 5.2 };
  }

  /* ── Political will ───────────────────────────────────────────────────────
   * Casualty tolerance, expressed as the share of the fit-for-service pool a
   * society will spend before the war becomes politically unsurvivable.
   * Defending your own soil roughly doubles it.
   */
  /* A society's capacity to absorb loss and a regime's willingness to keep
   * spending it are different variables, and conflating them was the model's
   * one diagnosed structural failure: any single setting that let the
   * Iran-Iraq War run eight years also made every short decisive war too long.
   *
   * Society exhausts on casualties. The regime decides. How much the first
   * forces the second is `transmission`, set by how far the government depends
   * on consent — near-total for an accountable state, close to nil for a
   * coercive one. A regime facing its own destruction fights on regardless.
   */
  function willProfile(c, isDefendingHome, warAim) {
    let base = (c.mor * 0.6 + c.stab * 0.4) / 100;
    if (isDefendingHome) base = clamp(base + 0.28, 0, 1.15);
    // A war of choice a long way from home is the easiest kind to abandon.
    if (!isDefendingHome && (warAim === "conquest" || warAim === "regime")) base *= 0.82;
    // Total casualties, as a share of the fit-for-service pool, that this
    // society will absorb before the war becomes politically unsurvivable.
    // The constants are FITTED against the historical backtest, not derived:
    // raising them threefold on the theory that they should scale with total
    // casualties rather than deaths made every short war too long and every
    // casualty count too high. Treat them as a calibration, not a measurement.
    const tolerance = 0.004 + K.tolScale * Math.pow(base, K.tolExp);
    // Share of societal exhaustion that reaches the decision to continue.
    const transmission = clamp(K.transBase + (1 - K.transBase) * Math.pow(c.openness / 100, 0.85), 0.10, 1);
    return { base, tolerance, transmission };
  }

  /* `months` is the horizon — the point at which the model stops and reports the
   * war as unresolved. It is not a prediction and it is not a constraint on the
   * war; it is where the simulation gives up.
   *
   * These were 60/48/30/12/36 and were doing far more work than anything called
   * a display limit should. At a 30-month horizon the model called Russia-Poland
   * a 77% stalemate; at 120 months the same matchup is a 97% Russian win taking
   * around four years. Nothing about the war changed — the clock stopped in the
   * middle of a slow advance and the leftover runs were labelled a draw. Every
   * "stalemate" this model has ever reported was that: there is exactly one line
   * that assigns the outcome, and it fires when the loop runs out.
   *
   * Raised so that truncation is the exception rather than the headline. Where
   * it still happens the report says "unresolved after N months" and names N,
   * which is the honest version of the same fact.
   */
  const WAR_AIMS = {
    conquest:  { label: "Total conquest",        territory: 0.85, commit: 0.70, occupy: true,  months: 120 },
    regime:    { label: "Regime change",         territory: 0.45, commit: 0.65, occupy: true,  months: 96 },
    limited:   { label: "Seize border region",   territory: 0.12, commit: 0.45, occupy: false, months: 90 },
    punitive:  { label: "Punitive air campaign", territory: 0.00, commit: 0.22, occupy: false, months: 36 },
    blockade:  { label: "Blockade / strangle",   territory: 0.00, commit: 0.30, occupy: false, months: 72 },
  };

  const MOBILIZATION = {
    peacetime: { label: "Peacetime posture", reserveCall: 0.10, econ: 1.0, delay: 3 },
    partial:   { label: "Partial mobilisation", reserveCall: 0.45, econ: 1.6, delay: 2 },
    full:      { label: "Full mobilisation",  reserveCall: 0.90, econ: 2.6, delay: 1 },
  };

  /* ── Theatre geometry ─────────────────────────────────────────────────────
   * The width of the contact line is one of the most important numbers in a
   * land war and one of the most commonly ignored. The same force ratio
   * produces breakthrough on a 200 km front and trench deadlock on a
   * 1,200 km one — or the reverse, depending on who has enough troops to fill
   * it. Approximated from the defender's area for a land border, and from its
   * usable coastline for an opposed landing.
   */
  function frontWidth(B, adjacent, amphibious) {
    if (amphibious) return clamp(0.28 * B.coast, 50, 1100);
    return clamp(1.2 * Math.sqrt(B.area * 1000), 80, 2200);
  }

  /* Seasonal tempo of ground operations, by calendar month (0 = January).
   * The spring and autumn thaw has stopped more offensives in eastern Europe
   * than any army has; the monsoon does the same job in Asia; desert summer
   * heat blunts everything. The theatre takes the defender's climate. */
  const SEASON = {
    continental: [0.78, 0.80, 0.58, 0.55, 0.92, 1.05, 1.08, 1.08, 1.02, 0.66, 0.60, 0.82],
    temperate:   [0.88, 0.90, 0.98, 1.02, 1.05, 1.05, 1.02, 1.00, 1.02, 0.98, 0.92, 0.88],
    arid:        [1.00, 1.02, 1.05, 1.00, 0.92, 0.82, 0.78, 0.78, 0.88, 1.00, 1.05, 1.02],
    monsoon:     [1.02, 1.05, 1.02, 0.95, 0.80, 0.62, 0.58, 0.60, 0.72, 0.95, 1.02, 1.05],
    tropical:    [0.95, 0.95, 0.90, 0.85, 0.80, 0.78, 0.78, 0.80, 0.82, 0.85, 0.90, 0.95],
  };
  const seasonTempo = (climate, calendarMonth) =>
    (SEASON[climate] || SEASON.temperate)[((calendarMonth % 12) + 12) % 12];

  /* Every hostile border you are *not* fighting on still has to be covered.
   * Russia has fourteen neighbours; Poland has seven but four of them are
   * allies. This is why large states with many frontiers cannot commit the
   * force their raw totals suggest. */
  function multiFrontTax(c, foeId) {
    const friends = new Set(window.WarData.alliesOf(c.id));
    const own = Math.max(domainScores(c).land, 1e-6);
    let load = 0;
    c.borders.forEach((b) => {
      if (b === foeId || friends.has(b) || !BY_ID[b]) return;
      // A frontier costs what the neighbour on it could actually do to you.
      load += Math.min(1, domainScores(BY_ID[b]).land / own);
    });
    return clamp(0.09 * load, 0, 0.34);
  }

  /* ── Pre-computed, scenario-independent side profile ────────────────────── */
  function profile(c) {
    return {
      c,
      scores: domainScores(c),
      proj: projection(c),
      sust: sustainment(c),
      lift: amphibiousLift(c),
    };
  }

  /* =========================================================================
   * One run of the war.
   * ====================================================================== */
  function runOnce(A, B, opts, rng) {
    const pa = opts._pa, pb = opts._pb;
    const aim = WAR_AIMS[opts.warAim];
    const mobA = MOBILIZATION[opts.mobilizationA];
    const mobB = MOBILIZATION[opts.mobilizationB];

    const adjacent = A.borders.includes(B.id) || B.borders.includes(A.id);
    const distance = opts._distance;
    const startMonth = opts.startMonth ?? 2; // March, unless told otherwise

    // Coalition entry is a coin weighted by treaty reliability, resolved once.
    const coalition = { a: [], b: [] };
    if (opts.allies) {
      for (const [side, self, foe] of [["a", A, B], ["b", B, A]]) {
        window.WarData.alliancesOf(self.id).forEach((al) => {
          if (al.members.includes(foe.id)) return; // same bloc — no help
          al.members.forEach((m) => {
            if (m === self.id || !BY_ID[m]) return;
            if (coalition[side].includes(m)) return;
            if (rng() < al.reliability * (side === "b" ? 1.0 : 0.85)) coalition[side].push(m);
          });
        });
      }
    }

    // Allied contribution: partners send a slice, discounted by their own
    // distance from the theatre. Nobody sends everything.
    function coalitionBonus(ids, theaterCountry) {
      let land = 0, air = 0, sea = 0, strike = 0, ad = 0, replacement = 0,
          shells = 0, interceptors = 0;
      ids.forEach((id) => {
        const ally = BY_ID[id];
        const s = domainScores(ally);
        const d = greatCircle(ally, theaterCountry);
        const adj = ally.borders.includes(theaterCountry.id);
        const f = deployFraction(ally, d, adj) * 0.35; // partners hold back
        land += s.land * f; air += s.air * f; sea += s.sea * f;
        strike += s.strike * f; ad += s.airDefense * f * 0.5;
        replacement += sustainment(ally).replacement * 0.25;
        shells += ally.shellProd * 0.30;
        interceptors += ally.intProd * 0.25;
      });
      return { land, air, sea, strike, ad, replacement, shells, interceptors };
    }

    const cbA = coalitionBonus(coalition.a, B);
    const cbB = coalitionBonus(coalition.b, B);

    // Foreign materiel support short of belligerency: shells, vehicles,
    // interceptors and intelligence from a patron who does not send troops.
    // Modern wars are shaped by this more than by formal alliances, and a
    // model without it cannot reproduce a Ukraine or a Vietnam.
    const SUPPORT = 0.022; // added to monthly replacement rate
    const supA = (opts.support === "a" || opts.support === "both") ? SUPPORT : 0;
    const supB = (opts.support === "b" || opts.support === "both") ? SUPPORT : 0;
    // A patron also ships ammunition, which is usually the binding constraint.
    const supShellA = supA ? Math.max(25, A.shellProd * 1.4) : 0;
    const supShellB = supB ? Math.max(25, B.shellProd * 1.4) : 0;
    const supIntA = supA ? 0.030 : 0, supIntB = supB ? 0.030 : 0;

    // ── Theatre access ────────────────────────────────────────────────────
    // Every border you are not fighting on still needs covering.
    const taxA = multiFrontTax(A, B.id), taxB = multiFrontTax(B, A.id);

    // A defender who controls a strait the attacker's shipping must transit
    // can throttle the approach before a shot is fired.
    const chokeOnA = window.WarData.chokeAgainst(B.id, A.id).length +
      coalition.b.reduce((n, id) => n + window.WarData.chokeAgainst(id, A.id).length, 0);
    const chokeOnB = window.WarData.chokeAgainst(A.id, B.id).length +
      coalition.a.reduce((n, id) => n + window.WarData.chokeAgainst(id, B.id).length, 0);
    const chokePenaltyA = adjacent ? 1 : clamp(1 - 0.22 * chokeOnA, 0.5, 1);

    const targetFracA = deployFraction(A, distance, adjacent) * aim.commit *
      (1 - taxA) * chokePenaltyA * jitter(rng, 0.10);
    const targetFracB = 0.94 * (1 - taxB) * jitter(rng, 0.06);

    // Force does not appear in theatre — it closes. Desert Shield took six
    // months before Desert Storm; an instantaneous deployment flatters
    // expeditionary powers enormously and denies the defender the window it
    // historically gets to prepare.
    const closureA = adjacent ? 0.50 : clamp(0.05 + 0.40 * (pa.proj.index / 150), 0.04, 0.45);
    const closureB = 0.62;
    let arrivedA = adjacent ? 0.45 : 0.10, arrivedB = 0.55;

    const surprise = opts.surprise ? clamp(0.55 + rng() * 0.5, 0, 1.15) : 0;
    // 0 = every villager is an insurgent, 1 = they are handing out flowers.
    const localSupport = clamp(opts.localSupport ?? 0.15, 0, 1);
    if (surprise) { arrivedA = Math.min(1, arrivedA + 0.30); arrivedB = 0.32; }

    // ── Mobilisation ──────────────────────────────────────────────────────
    // Reserves do not appear on day one. They are called up, trained and —
    // the binding constraint almost everywhere — equipped from whatever is in
    // storage. A country with three million reservists and no stored rifles
    // fields an army the size of its equipment park, not its manpower.
    const reservePoolA = A.res * mobA.reserveCall, reservePoolB = B.res * mobB.reserveCall;
    // You can field as many soldiers as you have equipment sets for. Stored
    // kit scales with the active establishment, and a reserve system carries
    // its own - that is what makes it a reserve rather than a phone list.
    const equipCap = (c) => c.act * (1 + c.store) + c.res * 0.25;
    const equipCapA = equipCap(A), equipCapB = equipCap(B);
    let mobilisedA = Math.min(A.act + A.par * 0.30, equipCapA);
    let mobilisedB = Math.min(B.act + B.par * 0.50, equipCapB);

    const willA = willProfile(A, false, opts.warAim);
    const willB = willProfile(B, true, opts.warAim);

    // Competence of the war's leadership — the least predictable variable there
    // is, and historically among the most decisive. The spread is wide on
    // purpose: a model that returns 100% for a multi-year attritional war is
    // reporting its own rigidity, not a fact about the world.
    const compA = jitter(rng, 0.30), compB = jitter(rng, 0.30);
    /* The 0-100 indices — technology, training, experience, ISR, morale — are
     * point estimates of things nobody measures, assigned by judgement. Feeding
     * them in as exact numbers was the largest unstated source of false
     * precision in this model: the report showed a spread over luck and
     * leadership while silently asserting that Russian training is 66 and not
     * 60 or 72. Each side's quality is therefore resampled per run, so the
     * reported distribution includes uncertainty about the inputs and not only
     * about the war. */
    const idxA = jitter(rng, 0.14), idxB = jitter(rng, 0.14);
    const morA = jitter(rng, 0.16), morB = jitter(rng, 0.16);
    // Industrial output and how much a society will bear are both uncertain.
    const indA = jitter(rng, 0.25), indB = jitter(rng, 0.25);
    const tolA = jitter(rng, 0.22), tolB = jitter(rng, 0.22);

    const S = {
      a: {
        land: (pa.scores.land + cbA.land) * compA * idxA,
        air: (pa.scores.air + cbA.air) * compA * idxA,
        sea: (pa.scores.sea + cbA.sea) * compA * idxA,
        strike: (pa.scores.strike + cbA.strike) * compA * idxA,
        ad: pa.scores.airDefense + cbA.ad,
        shells: A.shellStock, pgm: A.pgmStock, interceptors: A.intStock,
        casualties: 0, killed: 0, wounded: 0, captured: 0, civ: 0,
        will: 1, econ: 0,
        industry: (pa.sust.replacement + cbA.replacement + supA) * indA,
        fuel: pa.sust.fuel, territory: 1,
      },
      b: {
        land: (pb.scores.land + cbB.land) * compB * idxB,
        air: (pb.scores.air + cbB.air) * compB * idxB,
        sea: (pb.scores.sea + cbB.sea) * compB * idxB,
        strike: (pb.scores.strike + cbB.strike) * compB * idxB,
        ad: pb.scores.airDefense + cbB.ad,
        shells: B.shellStock, pgm: B.pgmStock, interceptors: B.intStock,
        casualties: 0, killed: 0, wounded: 0, captured: 0, civ: 0,
        will: 1, econ: 0,
        industry: (pb.sust.replacement + cbB.replacement + supB) * indB,
        fuel: pb.sust.fuel, territory: 1,
      },
    };
    const start = { a: { ...S.a }, b: { ...S.b } };

    // Terrain, prepared defence and the fact that cities have to be taken one
    // building at a time. The classic 1.5:1 attacker requirement is a local
    // tactical ratio, not a theatre-wide one, so the base is set below it and
    // terrain and urbanisation carry the rest.
    const terrainMult = 1 + 0.55 * (B.terrain / 100);
    const defenderEdge = K.defBase * terrainMult * (opts.warAim === "conquest" ? 1.08 : 1.0);

    // Amphibious ceiling: an island (or a defender with no shared border and
    // no land route) can only be invaded as fast as you can land people.
    const needsAmphib = !adjacent && (B.island === 1 || B.borders.length === 0);
    const liftPerMonth = pa.lift * jitter(rng, 0.15);
    const frontKm = frontWidth(B, adjacent, needsAmphib);

    // Counter-drone competence: electronic warfare, networks and enough
    // industrial attention to take the problem seriously.
    const cdA = clamp(0.20 + 0.55 * (A.cyb / 100) * (0.5 + 0.5 * (A.tech / 100)), 0, 0.85);
    const cdB = clamp(0.20 + 0.55 * (B.cyb / 100) * (0.5 + 0.5 * (B.tech / 100)), 0, 0.85);

    // Unit cohesion: the share of its fielded strength a force can lose before
    // it stops functioning as an army rather than merely being smaller. Morale
    // and training carry it; a well-trained motivated force fights on at a
    // fraction of its establishment, a demoralised conscript one does not.
    const cohesion = (c) => clamp(K.cohBase + 0.55 * (c.mor / 100) * (0.4 + 0.6 * (c.trn / 100)), 0.20, 0.92);
    const cohesionA = clamp(cohesion(A) * morA, 0.18, 0.95);
    const cohesionB = clamp(cohesion(B) * morB, 0.18, 0.95);

    const timeline = [];
    let tick = 0, outcome = null, nuclear = null;
    // Smoothed rate of progress toward the attacker's war aim, and last tick's
    // level. Both feed the forward-looking termination test in section 11b.
    let aimRate = 0, prevAimProgress = 0;
    let seaControlA = 0.5, airControlA = 0.5;
    let landedA = 0;              // thousands of troops ashore, amphibious ops
    const woundedQueue = { a: [], b: [] };   // wounded returning to duty, by week
    const RETURN_LAG = Math.round(3 * WEEKS_PER_MONTH);

    const maxMonths = opts.maxMonths != null ? opts.maxMonths : aim.months;
    const maxTicks = Math.max(1, Math.round(maxMonths * WEEKS_PER_MONTH));

    while (tick < maxTicks) {
      tick++;
      const month = tick * DT;                       // elapsed months, fractional
      const calendar = Math.floor(startMonth + month) % 12;
      const tempo = seasonTempo(B.climate, calendar);

      // ── 1. Closure and mobilisation ───────────────────────────────────────
      arrivedA = Math.min(1, arrivedA + closureA * DT);
      arrivedB = Math.min(1, arrivedB + closureB * DT);
      mobilisedA = Math.min(equipCapA, mobilisedA + reservePoolA * A.mobRate * DT);
      mobilisedB = Math.min(equipCapB, mobilisedB + reservePoolB * B.mobRate * DT);
      // Wounded coming back to the line, about three months behind.
      mobilisedA += woundedQueue.a.shift() || 0;
      mobilisedB += woundedQueue.b.shift() || 0;

      const poolA = mobilisedA, poolB = mobilisedB;
      const fracA = targetFracA * arrivedA, fracB = targetFracB * arrivedB;

      // ── 2. Cyber / EW opening ─────────────────────────────────────────────
      const cyberEdge = Math.tanh((A.cyb - B.cyb) / 45) * (month <= 2 ? 0.14 : 0.05);
      const netA = 1 + Math.max(0, cyberEdge) * 0.5 - Math.max(0, -cyberEdge);
      const netB = 1 - Math.max(0, cyberEdge) + Math.max(0, -cyberEdge) * 0.5;

      // ── 3. Magazines ──────────────────────────────────────────────────────
      // Precision munitions are the first thing to run out in a modern air
      // campaign, and the slowest to replace. When the magazine empties the
      // air force falls back on unguided weapons: less effective per sortie,
      // more losses, and far more civilian deaths.
      const pgmDemandA = 3.2 * DT * (0.4 + 0.6 * airControlA) *
        (opts.warAim === "punitive" ? 1.5 : 1);
      const pgmDemandB = 2.4 * DT * (0.4 + 0.6 * (1 - airControlA));
      const pgmA = clamp(S.a.pgm / Math.max(pgmDemandA, 1e-6), 0, 1);
      const pgmB = clamp(S.b.pgm / Math.max(pgmDemandB, 1e-6), 0, 1);
      const strikeEffA = 0.42 + 0.58 * Math.min(1, pgmA);
      const strikeEffB = 0.42 + 0.58 * Math.min(1, pgmB);
      S.a.pgm = clamp(S.a.pgm - Math.min(S.a.pgm, pgmDemandA) + start.a.pgm * A.pgmProd * DT, 0, start.a.pgm);
      S.b.pgm = clamp(S.b.pgm - Math.min(S.b.pgm, pgmDemandB) + start.b.pgm * B.pgmProd * DT, 0, start.b.pgm);

      // Interceptors. An integrated air defence with an empty magazine is
      // scrap metal, and cheap drones are very good at emptying it.
      const intDemandB = (S.a.strike * 0.055 + A.droneProd * 0.030) * DT * (1 - cdB * 0.4);
      const intDemandA = (S.b.strike * 0.055 + B.droneProd * 0.030) * DT * (1 - cdA * 0.4);
      const intB = clamp(S.b.interceptors / Math.max(intDemandB, 1e-6), 0, 1);
      const intA = clamp(S.a.interceptors / Math.max(intDemandA, 1e-6), 0, 1);
      const adAmmoB = 0.22 + 0.78 * Math.min(1, intB);
      const adAmmoA = 0.22 + 0.78 * Math.min(1, intA);
      S.b.interceptors = clamp(S.b.interceptors - Math.min(S.b.interceptors, intDemandB)
        + start.b.interceptors * (B.intProd + supIntB) * DT, 0, start.b.interceptors);
      S.a.interceptors = clamp(S.a.interceptors - Math.min(S.a.interceptors, intDemandA)
        + start.a.interceptors * (A.intProd + supIntA) * DT, 0, start.a.interceptors);

      // ── 4. Air superiority ────────────────────────────────────────────────
      // Airfields are the air force's real vulnerability: a force flying from
      // a handful of known bases can be shut down by a missile salvo.
      const suppA = clamp((S.b.strike / 100) * 0.42 * strikeEffB / A.airbaseResilience, 0, 0.55);
      const suppB = clamp((S.a.strike / 100) * 0.42 * strikeEffA / B.airbaseResilience, 0, 0.55);
      const sortieA = (1 - suppA) * (0.85 + 0.15 * tempo);
      const sortieB = (1 - suppB) * (0.85 + 0.15 * tempo);

      // Air and naval forces close on a theatre faster and from further than
      // armies do — tankers and hulls move without a road network — so they
      // are less discounted than ground forces, but not undiscounted.
      const airFracA = clamp(fracA * 1.7, 0.12, 1), airFracB = clamp(fracB * 1.1, 0.30, 1);
      const seaFracA = clamp(fracA * 1.5, 0.15, 1), seaFracB = clamp(fracB * 1.1, 0.30, 1);

      if (tick === 1 && surprise) {
        // A surprise attack on airfields destroys aircraft on the ground -
        // Operation Focus took out most of the Egyptian air force in three
        // hours. A month-one multiplier on sortie rate cannot express that.
        const wipe = clamp(0.30 * surprise * (1 - B.airbaseResilience * 0.4), 0, 0.45);
        S.b.air *= 1 - wipe;
      }
      // Uncountered drones buy air superiority cheaply.
      const droneAirA = (A.droneProd / 100) * (1 - cdB) * 22 * adAmmoB;
      const droneAirB = (B.droneProd / 100) * (1 - cdA) * 22 * adAmmoA;
      const offA = (S.a.air * airFracA * sortieA + S.a.strike * 0.15 * strikeEffA
        + droneAirA) * netA * (1 + surprise * (tick === 1 ? 0.35 : 0));
      const offB = (S.b.air * airFracB * sortieB + S.b.strike * 0.15 * strikeEffB
        + droneAirB) * netB;
      const defB = S.b.air * airFracB * 0.35 * sortieB + S.b.ad * adAmmoB;
      const airRatio = (offA + 1) / (offB * 0.35 + defB + 1);
      airControlA = clamp(Math.pow(airRatio, 1.5) / (1 + Math.pow(airRatio, 1.5)), 0.02, 0.98);

      // ── 5. Sea control ────────────────────────────────────────────────────
      const maritime = needsAmphib || B.coast > 400 || opts.warAim === "blockade";
      if (maritime) {
        const seaRatio = (S.a.sea * seaFracA * (0.6 + 0.4 * airControlA) + 1) /
          (S.b.sea * seaFracB * (0.6 + 0.4 * (1 - airControlA)) + S.b.strike * 0.25 * strikeEffB + 1);
        seaControlA = clamp(Math.pow(seaRatio, 1.3) / (1 + Math.pow(seaRatio, 1.3)), 0.02, 0.98);
      }

      // ── 6. Ground combat ──────────────────────────────────────────────────
      const airMultA = 0.55 + 0.95 * airControlA;
      const airMultB = 0.55 + 0.95 * (1 - airControlA);

      const depth = 1 - S.b.territory;
      // Covering a small country really is much easier than covering a large
      // one, and an exponent of 0.22 barely distinguished Bangladesh from
      // Ukraine. Raising it to 0.45 is defensible on its own terms but was
      // measured against the backtest and changed nothing, so do not credit it
      // with fixing the short-war duration error — that cause is still open.
      const theatreScale = Math.pow(Math.max(B.area, 20) / 800, 0.45);
      const reachDepth = clamp(
        (0.10 + 0.42 * pa.sust.transport * clamp(pa.sust.fuel, 0.2, 1.2) * (A.log / 70)) / theatreScale,
        0.06, 1.2);
      const supplyStrain = 1 / (1 + Math.pow(depth / reachDepth, 1.7));
      /* How much of the army the ground you have taken ties down depends
       * entirely on whether the people living on it are shooting at you. India
       * did not garrison East Pakistan in 1971 — it handed the territory to a
       * Bangladeshi government the population had just voted for. The coalition
       * did not garrison Kuwait in 1991, and NATO did not garrison Kosovo.
       * Treating every population as hostile made all three of those wars come
       * out an order of magnitude too long, because the attacker's own advance
       * consumed its army. */
      const garrisonNeed = depth * B.pop * 20 * (1 - 0.90 * localSupport);
      const garrisonDrag = clamp(garrisonNeed / Math.max(poolA * aim.commit, 1), 0, 0.85);

      // Artillery ammunition. Roughly 600 rounds per thousand engaged troops
      // per month at full intensity, which reproduces the ~10,000 rounds a day
      // both sides have sustained in Ukraine. Fires are where most casualties
      // come from, so a shell shortage is close to disarmament.
      const engagedA = poolA * (needsAmphib ? clamp(landedA / Math.max(poolA, 1), 0, 1) : fracA);
      const engagedB = poolB * fracB;
      // 0.30 thousand rounds per thousand engaged troops per month at full
      // intensity — only a fraction of a mobilised army is ever in contact.
      // At the scales here that reproduces the ~10,000 rounds a day both sides
      // have sustained in Ukraine.
      const shellNeedA = engagedA * 0.30 * DT, shellNeedB = engagedB * 0.22 * DT;
      // Drone superiority suppresses the other side's guns as well as killing
      // its vehicles - counter-battery by loitering munition.
      const dSupA = clamp(1 - 0.30 * (B.droneProd / 100) * (1 - cdA), 0.6, 1);
      const dSupB = clamp(1 - 0.30 * (A.droneProd / 100) * (1 - cdB), 0.6, 1);
      const fireA = (0.45 + 0.55 * clamp(S.a.shells / Math.max(shellNeedA, 1e-6), 0, 1)) * dSupA;
      const fireB = (0.55 + 0.45 * clamp(S.b.shells / Math.max(shellNeedB, 1e-6), 0, 1)) * dSupB;
      S.a.shells = Math.max(0, S.a.shells - Math.min(S.a.shells, shellNeedA))
        + (A.shellProd + cbA.shells + supShellA) * DT;
      S.b.shells = Math.max(0, S.b.shells - Math.min(S.b.shells, shellNeedB))
        + (B.shellProd + cbB.shells + supShellB) * DT;

      // Cities have to be taken one building at a time, and they are where
      // the population — and therefore the objectives — are.
      const urbanDrag = 1 + 0.9 * (B.urban / 100) * Math.min(1, depth * 2.5);

      if (needsAmphib) {
        const interdiction = clamp(
          1 - (S.b.strike * 0.010 * strikeEffB + S.b.sea * 0.006 + (1 - airControlA) * 0.35), 0.03, 1);
        landedA += liftPerMonth * DT * Math.pow(seaControlA, 1.6) * interdiction * tempo;
      }
      // Ashore, the fighting force is what got ashore — not that share of a
      // force already discounted for distance.
      const groundFracA = needsAmphib ? clamp(landedA / Math.max(poolA, 1), 0, 1) : fracA;
      let groundA = S.a.land * groundFracA * airMultA * supplyStrain * (1 - garrisonDrag) * fireA;
      const groundB = S.b.land * fracB * airMultB * defenderEdge * urbanDrag * fireB;
      const forceRatio = groundA / Math.max(groundB, 1e-6);

      // Force-to-space. A defender with enough troops per kilometre holds a
      // continuous, mutually supporting line and the war becomes a grinding
      // push; one spread too thin has gaps, and gaps are what turn a force
      // ratio into a breakthrough. This is the difference between 1916 and
      // 1940 at similar odds.
      const density = engagedB / frontKm;                 // thousands per km
      const lineIntegrity = clamp((density - 0.12) / 0.55, 0, 1);
      const manoeuvre = 1 - 0.78 * lineIntegrity;
      const spaceFactor = 0.70 + 0.45 * manoeuvre;

      const fr = Math.pow(forceRatio, 1.7);
      const maxAdvance = K.advBase + K.advMano * Math.pow(manoeuvre, 2);
      const advance = maxAdvance * DT * ((fr - 1) / (1 + fr)) * (0.6 + 0.8 * airControlA)
        * spaceFactor * tempo;
      S.b.territory = clamp(S.b.territory - advance * jitter(rng, 0.35), 0, 1);

      // ── 7. Attrition ──────────────────────────────────────────────────────
      const contact = clamp(2 / (forceRatio + 1 / forceRatio), 0.02, 1);
      const biteOf = (c) => Math.pow(c, K.biteExp);
      // Casualties, not deaths. Killed is roughly a quarter of the total in a
      // modern army with functioning casualty evacuation; most of the wounded
      // come back. Reporting only the dead understates losses about fourfold
      // and overstates how fast an army is actually destroyed.
      const rateA = K.casBase * DT * (1 - 0.30 * (A.tech / 100));
      const rateB = K.casBase * DT * (1 - 0.30 * (B.tech / 100));
      // Exchange ratio. A total mismatch is not 2:1, it is closer to 50:1 —
      // Desert Storm and the 2003 invasion both ran at roughly that. The
      // clamp has to be wide enough to express it.
      const qualEdge = (qualityMult(A) * c4Mult(A)) / (qualityMult(B) * c4Mult(B));
      const exchange = Math.pow(clamp(forceRatio, 0.05, 40), 0.5) *
        Math.pow(clamp(qualEdge, 0.2, 5), K.qualExch);
      const urbanBlood = 1 + 0.8 * (B.urban / 100) * Math.min(1, depth * 2.5);
      // Casualties fall off with mismatch, but far more slowly than `contact`
      // itself: a one-sided war is short, not bloodless. Left linear, this
      // term had the 2003 invasion of Iraq killing fewer than a thousand
      // Iraqi soldiers.
      const bite = biteOf(contact);

      const assaultCost = (0.55 + 0.45 * defenderEdge) * (1 + 0.6 * lineIntegrity);
      const casA = engagedA * rateA * bite * (1 / exchange) * urbanBlood * assaultCost * jitter(rng, 0.4);
      const casB = engagedB * rateB * bite * exchange * jitter(rng, 0.4);
      // Prisoners scale with how badly a side is being beaten. A force that is
      // merely losing takes casualties; a force that is collapsing surrenders —
      // 86,000 prisoners in Kuwait in 1991, 90,000 in East Pakistan in 1971.
      const powShare = (adverse) => clamp(0.05 + 0.30 * (adverse - 1) / (adverse + 1), 0.04, 0.34);
      const split = (c, tech, adverse) => {
        const kia = c * (0.30 - 0.09 * (tech / 100));
        const pow = c * powShare(adverse);
        return { kia, pow, wia: Math.max(0, c - kia - pow) };
      };
      const sa = split(casA, A.tech, 1 / Math.max(forceRatio, 1e-6));
      const sb = split(casB, B.tech, Math.max(forceRatio, 1e-6));
      S.a.casualties += casA; S.a.killed += sa.kia; S.a.wounded += sa.wia; S.a.captured += sa.pow;
      S.b.casualties += casB; S.b.killed += sb.kia; S.b.wounded += sb.wia; S.b.captured += sb.pow;
      mobilisedA = Math.max(0, mobilisedA - casA);
      mobilisedB = Math.max(0, mobilisedB - casB);
      // About 55% of the wounded return to duty, roughly three months later.
      // About 55% of the wounded return to duty, roughly thirteen weeks later.
      woundedQueue.a[RETURN_LAG] = (woundedQueue.a[RETURN_LAG] || 0) + sa.wia * 0.55;
      woundedQueue.b[RETURN_LAG] = (woundedQueue.b[RETURN_LAG] || 0) + sb.wia * 0.55;

      /* ── 7b. Envelopment ──────────────────────────────────────────────────
       * Armies are not usually destroyed by being worn down. They are destroyed
       * by being cut off. A front with gaps in it plus a decisive local ratio
       * lets the attacker get behind a formation, and in the week that takes, a
       * fighting division becomes a column of prisoners. Sinai in 1967, Kuwait
       * in 1991 and East Pakistan in 1971 all ended that way, and not one of
       * them ended because a casualty counter reached a threshold.
       *
       * This is deliberately a RATE rather than an accumulated stock. Every
       * other way a war can end in this model — will, cohesion, territory —
       * requires grinding an integral down to a floor, and integrals take time
       * no matter what the battlefield looks like.
       *
       * IT IS OFF BY DEFAULT (`envRate: 0`), because on the backtest it does
       * not pay for itself. It behaves correctly where it can be checked — the
       * dense Korean front suppresses it exactly as force-to-space says it
       * should (manoeuvre 0.22, nothing fires) and the open ones let it run —
       * but the aggregate score does not improve, and it takes the Iran-Iraq
       * War from 24.5 months to 8.1 against an actual 96. That case has the
       * defender committing seven times the attacker's ground power in the
       * model, so a mechanism that converts a lopsided ratio into a fast
       * collapse is doing its job on an input that is itself wrong. Fixing the
       * input is the honest repair; suppressing the mechanism to hide it is
       * not, and neither is shipping it on and calling the result an
       * improvement. Set `envRate` to 0.42 and re-run tools/backtest.js to see
       * the whole result.
       */
      const envelopOdds = (ratio, mobility) => {
        if (ratio <= K.envRatio) return 0;
        const decisive = clamp((ratio - K.envRatio) / K.envRatio, 0, 1);
        // No gaps, no envelopment: a continuous line has no flanks to turn.
        // This is why the same odds produce Sinai on an open front and nothing
        // at all on a full one.
        return K.envRate * DT * decisive * Math.pow(manoeuvre, 1.4) * mobility * tempo;
      };
      let pocketA = 0, pocketB = 0;
      if (K.envRate > 0) {
        /* Getting behind an army takes fuel and, above all, air superiority:
         * the columns doing the encircling are strung out on roads with open
         * flanks, which is survivable only if nothing is flying overhead.
         * Sinai, Kuwait and the road to Baghdad were all conducted under
         * near-total air control. Two armies contesting the air do not envelop
         * each other — without this term the mechanism cut Iraq's army apart in
         * the Iran-Iraq war, where neither side could do anything of the kind. */
        const airborne = (control) => Math.pow(clamp(0.12 + 0.88 * control, 0, 1), 1.3);
        const mobilityA = clamp(S.a.fuel, 0.25, 1) * airborne(airControlA);
        const mobilityB = clamp(S.b.fuel, 0.25, 1) * airborne(1 - airControlA);
        if (rng() < envelopOdds(forceRatio, mobilityA)) pocketB = K.envPocket * jitter(rng, 0.45);
        if (rng() < envelopOdds(1 / Math.max(forceRatio, 1e-6), mobilityB)) pocketA = K.envPocket * jitter(rng, 0.45);
      }

      // Encircled troops are overwhelmingly captured rather than killed, and
      // their equipment is not damaged, it is abandoned where it stands. The
      // wounded in a pocket go into captivity with it, so none of them are
      // queued to return to duty.
      const closePocket = (share, side, engaged, tech) => {
        const caught = engaged * share;
        const kia = caught * (0.16 - 0.05 * (tech / 100));
        const pow = caught * 0.70;
        side.casualties += caught; side.killed += kia; side.captured += pow;
        side.wounded += Math.max(0, caught - kia - pow);
        side.land *= 1 - share;
        return caught;
      };
      if (pocketB > 0) mobilisedB = Math.max(0, mobilisedB - closePocket(pocketB, S.b, engagedB, B.tech));
      if (pocketA > 0) mobilisedA = Math.max(0, mobilisedA - closePocket(pocketA, S.a, engagedA, A.tech));

      // Civilian deaths from strategic strike, in millions per month. An empty
      // precision magazine drives this up sharply — unguided weapons hit far
      // more of what was not aimed at.
      const dumbA = 1 + 1.4 * (1 - Math.min(1, pgmA));
      const dumbB = 1 + 1.4 * (1 - Math.min(1, pgmB));
      S.b.civ += S.a.strike * 0.00008 * DT * airControlA * dumbA *
        (opts.warAim === "punitive" ? 1.6 : 1) * jitter(rng, 0.5);
      S.a.civ += S.b.strike * 0.00008 * DT * (1 - airControlA) * dumbB * jitter(rng, 0.5);

      // ── 8. Materiel losses and replacement ────────────────────────────────
      // Cheap attritable drones now do a large share of the killing of
      // vehicles, and they are produced by an industry the big defence
      // budgets mostly did not build.
      const droneA = clamp(0.016 * (A.droneProd / 100) * (1 - cdB), 0, 0.035) * DT;
      const droneB = clamp(0.016 * (B.droneProd / 100) * (1 - cdA), 0, 0.035) * DT;

      const frLoss = Math.pow(clamp(forceRatio, 0.3, 3), 0.45);
      // Materiel attrition uses `bite`, not raw `contact`, for the same reason
      // casualties do: an army being routed does not lose its equipment slowly.
      // It abandons it, and the other side drives past it. Left on raw contact,
      // this term made lopsided wars grind on for months while the loser's
      // order of battle stayed almost intact — which is most of why the 1971
      // Indo-Pakistani war and Kargil came out an order of magnitude too long.
      const lossRateA = (K.lossBase * DT * bite) / frLoss + droneB;
      const lossRateB = (K.lossBase * DT * bite * frLoss) / Math.sqrt(defenderEdge) + droneA;

      const fuelFactorA = clamp(S.a.fuel, 0.25, 1.0);
      const fuelFactorB = clamp(
        S.b.fuel - (maritime ? seaControlA * 0.55 * (1 - clamp(B.oilSelfSufficiency, 0, 1)) : 0),
        0.15, 1.0);

      // Replacement makes good losses; it does not conjure an army. Stored
      // equipment is drawn down to do it, which is why a country with deep
      // Soviet-era parks can absorb losses that would finish a Western army
      // with none — until the parks are empty.
      const storeA = clamp(0.5 + 0.5 * (A.store / 1.5), 0.4, 1.5);
      const storeB = clamp(0.5 + 0.5 * (B.store / 1.5), 0.4, 1.5);
      const regen = (industry, loss, fuel, cap) => Math.min(industry * fuel, loss * cap);
      const ceilA = start.a.land * 1.8, ceilB = start.b.land * 1.8;

      S.a.land = Math.min(ceilA, S.a.land * (1 - lossRateA + regen(S.a.industry * storeA * DT, lossRateA, fuelFactorA, 1.25)));
      S.b.land = Math.min(ceilB, S.b.land * (1 - lossRateB + regen(S.b.industry * storeB * DT, lossRateB, fuelFactorB, 1.25)));
      // Flying against an air defence that has run out of missiles is much
      // safer, and that is exactly when an air force starts operating freely.
      const sanctuaryA = adAmmoB < 0.45 ? 0.7 : 1;
      const airLossA = lossRateA * 0.55 * sanctuaryA;
      S.a.air = Math.min(start.a.air * 1.4, S.a.air * (1 - airLossA + regen(S.a.industry * 0.5 * DT, airLossA, fuelFactorA, 1.1)));
      S.b.air = Math.min(start.b.air * 1.4, S.b.air * (1 - lossRateB * 0.75 + regen(S.b.industry * 0.5 * DT, lossRateB * 0.75, fuelFactorB, 1.1)));
      S.a.sea *= 1 - (maritime ? 0.02 * (1 - seaControlA) : 0.002) * DT;
      S.b.sea *= 1 - (maritime ? 0.02 * seaControlA : 0.002) * DT;
      // Launcher inventory, distinct from the magazine tracked above.
      S.a.strike = Math.min(start.a.strike, S.a.strike * (1 - (0.06 - Math.min(S.a.industry * 1.6, 0.06)) * DT));
      S.b.strike = Math.min(start.b.strike, S.b.strike * (1 - (0.06 - Math.min(S.b.industry * 1.6, 0.06)) * DT));
      S.a.ad = Math.max(S.a.ad * (1 - 0.015 * DT), start.a.ad * 0.30);
      S.b.ad = Math.max(S.b.ad * (1 - 0.05 * airControlA * DT), start.b.ad * 0.30);

      // A blockade bites harder when the blockading side also holds the strait
      // the defender's imports have to transit.
      if (maritime && B.oilSelfSufficiency < 1) {
        S.b.fuel = clamp(S.b.fuel - seaControlA * 0.05 * DT * (1 + 0.5 * chokeOnB), 0.1, 2);
      }

      // ── 9. Economic cost, USD billions (incremental over peacetime) ───────
      S.a.econ += (A.bud / 12) * DT * (mobA.econ - 1 + 1.1 * contact * fracA);
      S.b.econ += (B.bud / 12) * DT * ((mobB.econ - 1 + 1.1 * contact * fracB)
        + (B.gdp / B.bud) * 0.012 * (1 - S.b.territory) * 12);

      // ── 10. Political will ────────────────────────────────────────────────
      // Linear in casualties against the tolerance threshold. A saturating
      // form was tried, on the reasonable theory that a society which has
      // already absorbed heavy losses has shown it will keep going. It length-
      // ened every war: the Iran-Iraq case improved from 7 months to 10 against
      // an actual 96, while the 2003 invasion went from 3.5 months to 14 and
      // backtest casualty accuracy fell from 4/9 to 1/9. The model cannot
      // produce a multi-year attritional war without breaking short decisive
      // ones, and that is a real limitation of having one will mechanism
      // rather than a reason to keep tuning this line.
      // Societal exhaustion: how much of what this society can bear has been spent.
      const societyA = clamp(1 - S.a.casualties / (A.fit * 1000 * willA.tolerance * tolA), 0, 1);
      const societyB = clamp(1 - S.b.casualties / (B.fit * 1000 * willB.tolerance * tolB), 0, 1);
      // Only the part of it that reaches the government counts against its will.
      const burnA = (1 - societyA) * willA.transmission;
      const burnB = (1 - societyB) * willB.transmission;
      const progress = clamp(depth / Math.max(aim.territory, 0.05), 0, 1);
      const stall = (Math.min(month, 36) / 12) * (1 - progress) * K.stallW;
      S.a.will = clamp(1 - burnA - stall * willA.transmission
        - Math.max(0, 1 - S.a.land / start.a.land) * 0.25, 0, 1);
      // Losing ground hardens a defender until the loss is deep enough that the
      // government itself is going under — at which point no amount of coercive
      // capacity helps, because there is nothing left to coerce with.
      S.b.will = clamp(1 - burnB * (1 - 0.25 * depth)
        - Math.max(0, depth - 0.6) * 0.9, 0, 1);
      if (B.stab < 40 && S.b.territory < 0.7) S.b.will *= 1 - 0.03 * DT * 4;
      S.a.society = societyA; S.b.society = societyB;

      timeline.push({
        week: tick, month, calendar, tempo, airControlA,
        // The chain, in the order it is applied. Sum of parts, not a summary.
        chain: {
          landA: S.a.land, fracA, airMultA, supplyStrain,
          garrison: 1 - garrisonDrag, fireA, groundFracA, groundA,
          landB: S.b.land, fracB, airMultB, defenderEdge, urbanDrag, fireB, groundB,
        },
        wiaA: S.a.wounded, wiaB: S.b.wounded,
        powA: S.a.captured, powB: S.b.captured,
        seaControlA: maritime ? seaControlA : null,
        forceRatio, territoryB: S.b.territory,
        casA: S.a.casualties, casB: S.b.casualties,
        kiaA: S.a.killed, kiaB: S.b.killed,
        willA: S.a.will, willB: S.b.will,
        societyA: S.a.society, societyB: S.b.society,
        landA: S.a.land / start.a.land, landB: S.b.land / start.b.land,
        shellsA: S.a.shells / Math.max(start.a.shells, 1),
        shellsB: S.b.shells / Math.max(start.b.shells, 1),
        pgmA: S.a.pgm / Math.max(start.a.pgm, 1),
        pgmB: S.b.pgm / Math.max(start.b.pgm, 1),
        intA: S.a.interceptors / Math.max(start.a.interceptors, 1),
        intB: S.b.interceptors / Math.max(start.b.interceptors, 1),
        fireA, fireB, density, lineIntegrity, manoeuvre,
        mobA: mobilisedA, mobB: mobilisedB, arrivedA, arrivedB,
      });

      // ── 11. Nuclear escalation ────────────────────────────────────────────
      if (opts.nuclearAllowed) {
        const check = (X, st, foeHasNukes) => {
          if (!X.nuke || !X.doctrine) return 0;
          const pressure = X === B
            ? clamp((1 - st.territory) * 1.1 + (1 - st.will) * 0.6, 0, 2)
            : clamp((1 - st.will) * 0.9, 0, 2);
          const over = pressure - X.doctrine.threshold;
          if (over <= 0) return 0;
          const restraint = foeHasNukes ? 0.35 : 1.0;
          return clamp(over * 0.16 * restraint * DT, 0, 0.5);
        };
        const pB = check(B, S.b, A.nuke > 0);
        const pA = check(A, S.a, B.nuke > 0);
        if (rng() < pB) nuclear = { by: B.id, month: Math.max(1, Math.round(month)), first: true };
        else if (rng() < pA) nuclear = { by: A.id, month: Math.max(1, Math.round(month)), first: true };
        if (nuclear) {
          const retaliates = (nuclear.by === B.id ? A : B).nuke > 0;
          nuclear.exchange = retaliates;
          const wA = Math.min(A.dep || A.nuke * 0.35, 900);
          const wB = Math.min(B.dep || B.nuke * 0.35, 900);
          nuclear.deathsA = retaliates || nuclear.by === B.id ? Math.min(A.pop * 0.45, wB * 0.55) : 0;
          nuclear.deathsB = Math.min(B.pop * 0.45, wA * 0.55);
          outcome = "nuclear";
          break;
        }
      }

      /* ── 11b. Termination by decision ─────────────────────────────────────
       * Every other way this war can end is a stock crossing a floor: will
       * ground down by cumulative casualties, cohesion by cumulative losses,
       * the objective reached by cumulative advance. All three are integrals
       * over elapsed time, so by construction none of them can fire early.
       *
       * What was missing is the decision to quit. Wars mostly end because
       * someone works out that the coming months look worse than terms do — a
       * forecast, not an accumulator. Egypt and Jordan still had armies in
       * June 1967. So did Iraq in February 1991. They stopped because
       * continuing had no path, and a model that can only end a war by
       * exhaustion has to spend months producing the exhaustion instead.
       *
       * Both branches below read only rates and current state. Nothing here
       * depends on how long the war has already lasted, which is what lets a
       * war end in its third week when the third week is when it was decided.
       */
      const horizonWeeks = K.capHorizon * WEEKS_PER_MONTH;
      /* Where the attacker's aim stands, 0 = untouched, 1 = achieved. Each war
       * aim is judged by the thing it is actually trying to move, which is the
       * same quantity its own termination test below reads. Keying this to
       * territory alone left the two coercive aims unable to end by decision at
       * all — and a punitive air campaign is a pure coercion play whose entire
       * theory is that the other side decides to stop. Kosovo ran the full
       * twelve months to a stalemate for that reason. */
      const aimProgress =
        aim.territory > 0 ? clamp(depth / aim.territory, 0, 1)
        : opts.warAim === "punitive" ? clamp((1 - S.b.air / Math.max(start.b.air, 1e-6)) / 0.45, 0, 1)
        : opts.warAim === "blockade" ? clamp((1 - S.b.fuel) / 0.70, 0, 1)
        : 0;
      // Smoothed so a single noisy week does not read as a collapse or a halt.
      aimRate = 0.70 * aimRate + 0.30 * Math.max(0, aimProgress - prevAimProgress);
      prevAimProgress = aimProgress;
      // Weeks until the attacker gets there at the rate it is actually going.
      // Infinite if it is not going anywhere, which is itself a finding.
      const weeksToObjective = aimRate > 1e-6 ? (1 - aimProgress) / aimRate : Infinity;

      // What capitulation costs decides whether it is available at all.
      // Conceding a border province is a bad afternoon. Conceding to a war of
      // conquest or regime change is the end of the state and of the people
      // deciding, so those wars get fought well past the point where quitting
      // was the rational move. This is the difference between Georgia in 2008
      // and Germany in 1945.
      const survivable = clamp(1 - K.capStake * aim.territory, 0.05, 1);

      if (Number.isFinite(weeksToObjective)) {
        // How close the defeat is, on the leadership's own horizon.
        const doom = clamp(1 - weeksToObjective / horizonWeeks, 0, 1);
        /* Anything that could still turn it around. A government holding any
         * of these does not sue for peace on a bad month: a reserve not yet
         * called, an industry replacing more than the front is losing, a patron
         * still shipping, or a population that will keep fighting whatever the
         * state signs. The last two are why the first version had North Vietnam
         * suing for terms in 41% of runs and Ukraine in 37%. */
        const reserveLeft = clamp(1 - mobilisedB / Math.max(equipCapB, 1e-6), 0, 1);
        const patron = supB > 0 ? 1 : 0;
        const resistance = clamp(1 - localSupport, 0, 1);
        const relief = clamp(0.40 * reserveLeft + 0.25 * clamp(S.b.industry * 5, 0, 1)
                             + 0.35 * Math.max(patron, resistance), 0, 1);
        /* An air-supremacy gate was tried here, on the argument that a position
         * has to be legibly hopeless before anyone concedes it and that losing
         * the sky is the most legible form of that. It is a good argument and
         * air control does separate these fifteen wars cleanly — Gulf 0.85,
         * Korea 0.03 — but it changed nothing at low capitulation rates and
         * cost two outcomes at high ones, because the long wars it was meant to
         * protect are shortened by the attacker-withdrawal branch below, which
         * it does not touch. It is left out rather than kept as a term that
         * sounds right and does nothing. */
        const hazard = K.capRate * DT * Math.pow(doom * (1 - 0.7 * relief), 1.5) * survivable;
        if (rng() < hazard) { outcome = "defenderCapitulates"; break; }
      }

      /* The attacker's version is not surrender, it is going home. An army that
       * has lost no battles can still be withdrawn, and the calculation behind
       * it is a projection too: not "what has this cost" but "what will it cost
       * at the current burn rate to get where we said we were going". Vietnam
       * and Afghanistan both ended with the expeditionary force undefeated in
       * the field. A war on your own border is not optional in the same way.
       *
       * THIS IS OFF BY DEFAULT (`wdrRate: 0`), and unlike the defender branch
       * above it is off because it is measurably wrong. Every long war in the
       * backtest is a stalled war, and a stalled war is exactly what this reads
       * as futile: at any rate above zero it ends Korea at 17 months instead of
       * 37 and the Iran-Iraq War at 5 instead of 96, while never once improving
       * a duration. Gating it on `transmission` — the regime's exposure to what
       * the war costs, which is the right variable and does separate the United
       * States in Vietnam from Iraq in 1982 — softened that without fixing it.
       *
       * The reason is visible in the cases rather than the coefficient. Both
       * wars continued because a third party made them continue: China entered
       * Korea, and Iran refused the terms Iraq offered in 1982. Withdrawal is
       * not a decision one side takes, it is an offer the other side has to
       * accept, and this model has no representation of the second half of
       * that. Set `wdrRate` to 0.8 and re-run tools/backtest.js to see it. */
      if (K.wdrRate > 0 && month >= 2) {
        // Unreachable rather than merely slow: the objective sits beyond the
        // horizon at the rate the war is actually moving.
        const futile = Number.isFinite(weeksToObjective)
          ? clamp((weeksToObjective / horizonWeeks - 1) / 2, 0, 1)
          : 1;
        // Casualty burn projected forward against what this society will bear,
        // rather than what it has already spent.
        const burn = casA / Math.max(A.fit * 1000 * willA.tolerance * tolA, 1e-6);
        const projected = clamp(burn * Math.min(weeksToObjective, horizonWeeks * 3) / 1.5, 0, 1);
        const optional = adjacent ? 0.55 : 1;
        /* Whether a projected bill actually stops a war depends on who has to
         * pay attention to it. This is the same `transmission` the will
         * mechanism uses — how far the government depends on consent — and
         * without it the branch cuts every long attritional war short: the
         * first version withdrew Iraq from Iran in five months and North Korea
         * from the South in twelve, because both were plainly stalled and
         * bleeding. Both regimes were also almost perfectly insulated from
         * caring. It is the reason the United States left Vietnam and Iraq did
         * not leave Iran. */
        const hazard = K.wdrRate * DT * futile * projected * optional * willA.transmission;
        if (rng() < hazard) { outcome = "attackerWithdraws"; break; }
      }

      // ── 12. Termination ───────────────────────────────────────────────────
      if (S.b.territory <= 1 - aim.territory && aim.territory > 0) { outcome = "attackerObjective"; break; }
      if (opts.warAim === "punitive" && month >= 3 && S.b.air / start.b.air < 0.55) { outcome = "attackerObjective"; break; }
      if (opts.warAim === "blockade" && S.b.fuel < 0.3 && month >= 6) { outcome = "attackerObjective"; break; }
      if (S.a.will <= 0.12) { outcome = "attackerCollapse"; break; }
      if (S.b.will <= 0.12) { outcome = "defenderCollapse"; break; }
      if (S.b.land / start.b.land < 1 - cohesionB) { outcome = "defenderCollapse"; break; }
      if (S.a.land / start.a.land < 1 - cohesionA) { outcome = "attackerCollapse"; break; }
    }
    if (!outcome) outcome = "unresolved";

    // ── Occupation feasibility ─────────────────────────────────────────────
    let occupation = null;
    // A capitulation that hands you the country still leaves you holding it.
    if (aim.occupy && (outcome === "attackerObjective" || outcome === "defenderCollapse"
                       || outcome === "defenderCapitulates")) {
      const held = (1 - S.b.territory);
      const needed = B.pop * held * 20 * (0.75 + 0.5 * (B.urban / 100))
        * (1 - 0.85 * localSupport);
      const rotation = adjacent ? 1 : 1 / (1.6 + 1.4 * clamp(distance / 8000, 0, 1));
      const available = (mobilisedA * 0.6) * rotation;
      const ratio = available / Math.max(needed, 1);
      occupation = {
        needed, available, ratio,
        sustainable: ratio >= 1,
        intensity: clamp((1 - ratio) * (0.4 + 0.6 * (B.mor / 100)) * (1 - localSupport), 0, 1),
      };
      if (!occupation.sustainable) outcome = "pyrrhic";
    }

    const last = timeline[timeline.length - 1] || {};
    return {
      outcome, months: tick * DT, weeks: tick, timeline, nuclear, occupation,
      /* The unknowns this run was handed. Every one of these is resampled per
       * run precisely because it is not knowable, and until now they were drawn,
       * used and thrown away — which meant the report could show the width of
       * the distribution but never say which assumption the width came from.
       * Keeping them costs ten floats a run and buys the attribution below. */
      draws: { compA, compB, idxA, idxB, morA, morB, indA, indB, tolA, tolB },
      coalition, distance, adjacent, needsAmphib, frontKm,
      startMonth, chokeOnA, chokeOnB, taxA, taxB,
      airControlA, seaControlA: (needsAmphib || B.coast > 400) ? seaControlA : null,
      final: S, start,
      casualtiesA: S.a.casualties * 1000, casualtiesB: S.b.casualties * 1000,
      killedA: S.a.killed * 1000, killedB: S.b.killed * 1000,
      capturedA: S.a.captured * 1000, capturedB: S.b.captured * 1000,
      civA: S.a.civ * 1e6, civB: S.b.civ * 1e6,
      econA: S.a.econ, econB: S.b.econ,
      territoryLostB: 1 - S.b.territory,
      density: last.density ?? 0, manoeuvre: last.manoeuvre ?? 1,
      shellsLeftA: last.shellsA ?? 1, shellsLeftB: last.shellsB ?? 1,
      pgmLeftA: last.pgmA ?? 1, pgmLeftB: last.pgmB ?? 1,
      intLeftA: last.intA ?? 1, intLeftB: last.intB ?? 1,
      peakMobA: Math.max(...timeline.map((t) => t.mobA), 0),
      peakMobB: Math.max(...timeline.map((t) => t.mobB), 0),
    };
  }

  /* ── Reading a distribution ───────────────────────────────────────────────
   * `quantile` is linear-interpolated on a sorted array. `pit` is the
   * probability integral transform: the share of the distribution lying below
   * an observed value. If a forecast is well calibrated, PIT values across many
   * cases are uniform on [0,1]; if they pile up near zero the model is
   * systematically over-predicting, and near one, under. It is the single most
   * informative number you can get out of a probabilistic forecast, and it
   * costs a binary search.
   */
  function quantile(sorted, q) {
    const n = sorted.length;
    if (!n) return NaN;
    const i = clamp(q, 0, 1) * (n - 1);
    const lo = Math.floor(i), hi = Math.ceil(i);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  function pit(sorted, value) {
    const n = sorted.length;
    if (!n) return NaN;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < value) lo = m + 1; else hi = m; }
    let up = lo;
    while (up < n && sorted[up] === value) up++;
    // Midpoint of the tied range, so an exact hit lands mid-interval rather
    // than being charged to one side.
    return ((lo + up) / 2) / n;
  }

  /* =========================================================================
   * Monte Carlo wrapper.
   * ====================================================================== */
  const OUTCOME_SIDE = {
    attackerObjective: "a", defenderCollapse: "a", defenderCapitulates: "a",
    attackerCollapse: "b", attackerWithdraws: "b",
    unresolved: "draw", pyrrhic: "pyrrhic", nuclear: "none",
  };

  /* ── When wars end, and how ───────────────────────────────────────────────
   * Grouped by who prevailed and, within that, by whether the war was ended by
   * force or by a decision. That second split is the one worth drawing: a war
   * lost on the battlefield and a war conceded with an army still in the field
   * look identical in a win probability and completely different on a
   * timeline.
   */
  const ENDING_BAND = {
    attackerObjective: "force", defenderCollapse: "force",
    defenderCapitulates: "concede",
    pyrrhic: "pyrrhic",
    attackerCollapse: "defender", attackerWithdraws: "defender",
    unresolved: "unresolved", nuclear: "nuclear",
  };
  const ENDING_ORDER = ["force", "concede", "pyrrhic", "unresolved", "defender", "nuclear"];

  /* Share of all runs finished by week w, per band, as running totals. The top
   * of the stack at any week is the share decided by then; what is left above
   * it is the share still fighting. */
  function endingCurves(rows, iterations) {
    const maxWeeks = Math.max(1, ...rows.map((r) => r.weeks));
    const counts = {};
    ENDING_ORDER.forEach((k) => (counts[k] = new Array(maxWeeks + 1).fill(0)));
    rows.forEach((r) => {
      counts[ENDING_BAND[r.outcome] || "unresolved"][Math.min(r.weeks, maxWeeks)]++;
    });
    const cumulative = {};
    ENDING_ORDER.forEach((k) => {
      let run = 0;
      cumulative[k] = counts[k].map((v) => { run += v; return (run / iterations) * 100; });
    });
    return { weeks: maxWeeks, cumulative };
  }

  /* ── Which unknown the answer rests on ────────────────────────────────────
   * Each run independently draws leadership competence, force quality, morale,
   * industrial output and casualty tolerance for both sides. Because they are
   * drawn independently, sorting the runs by one of them and comparing the win
   * rate in the bottom third against the top third is an unbiased estimate of
   * that factor's own effect — no extra simulation required, just the draws
   * that were already being discarded.
   *
   * This is a main-effects reading, not a full variance decomposition: it will
   * not show an interaction where two assumptions only matter together. It
   * answers the question a reader actually has, which is what they would need
   * to pin down to narrow the answer.
   */
  const FACTORS = [
    { key: "compA", side: "a", label: "leadership" },
    { key: "compB", side: "b", label: "leadership" },
    { key: "idxA",  side: "a", label: "force quality" },
    { key: "idxB",  side: "b", label: "force quality" },
    { key: "morA",  side: "a", label: "morale and cohesion" },
    { key: "morB",  side: "b", label: "morale and cohesion" },
    { key: "indA",  side: "a", label: "industrial output" },
    { key: "indB",  side: "b", label: "industrial output" },
    { key: "tolA",  side: "a", label: "casualty tolerance" },
    { key: "tolB",  side: "b", label: "casualty tolerance" },
  ];

  function attribution(rows) {
    const n = rows.length;
    const cut = Math.floor(n / 3);
    // Terciles of fewer than ~60 runs put a sampling error of several points on
    // every bar, which would be drawing noise as a finding.
    if (cut < 60) return null;
    const rate = (arr) => (arr.reduce((s, r) => s + (r.win ? 1 : 0), 0) / arr.length) * 100;
    const baseline = rate(rows);
    const out = FACTORS.map((f) => {
      const sorted = rows.slice().sort((x, y) => x[f.key] - y[f.key]);
      const low = rate(sorted.slice(0, cut));
      const high = rate(sorted.slice(n - cut));
      return { ...f, low, high, swing: Math.abs(high - low) };
    }).sort((a, b) => b.swing - a.swing);
    /* How big a swing this many runs could produce from luck alone: the 95%
     * band on the DIFFERENCE between two independent tercile proportions,
     * variance taken at its p=0.5 maximum so the band is conservative. Drawn on
     * the chart, because without it a three-point bar reads as a finding. */
    const noise = 1.96 * Math.sqrt(2 * 0.25 / cut) * 100;
    return { baseline, rows: out, tercile: cut, noise };
  }

  // Accepts either country ids or fully-built country objects, so the
  // historical backtest can feed period force structures through the same
  // model the live app uses — no parallel implementation to drift out of sync.
  function simulate(attacker, defender, userOpts = {}) {
    const A = typeof attacker === "string" ? BY_ID[attacker] : attacker;
    const B = typeof defender === "string" ? BY_ID[defender] : defender;
    if (!A || !B) throw new Error("Unknown country");

    const opts = {
      warAim: "limited", allies: true, nuclearAllowed: true, surprise: false, support: "none",
      localSupport: 0.15,
      startMonth: 2,
      mobilizationA: "partial", mobilizationB: "partial",
      iterations: 2000, seed: 20260809, maxMonths: null, ...userOpts,
    };
    opts._pa = profile(A);
    opts._pb = profile(B);
    opts._distance = greatCircle(A, B);

    const rng = rngFactory(opts.seed);
    const tally = { a: 0, b: 0, draw: 0, none: 0, pyrrhic: 0 };
    const byOutcome = {};
    const runs = [];
    /* The three quantities the backtest judges, kept for every run rather than
     * collapsed to a mean. A mean duration cannot be scored honestly against a
     * war that actually happened: "within 3x of the mean" throws away the
     * distribution the model exists to produce, and turns a graded forecast
     * into a coin toss at the threshold. */
    const distMonths = [], distKiaA = [], distKiaB = [];
    // Every run, not just the 400 the scatter draws: the attribution below
    // splits into terciles and wants the samples.
    const draws = [];
    let nuclearRuns = 0, sumMonths = 0, sumCasA = 0, sumCasB = 0,
        sumCivA = 0, sumCivB = 0, sumEconA = 0, sumEconB = 0, sumTerr = 0,
        sumKiaA = 0, sumKiaB = 0, sumPowA = 0, sumPowB = 0,
        dryShellA = 0, dryShellB = 0, dryPgmA = 0, dryIntB = 0;

    for (let i = 0; i < opts.iterations; i++) {
      const r = runOnce(A, B, opts, rng);
      tally[OUTCOME_SIDE[r.outcome]]++;
      byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
      if (r.nuclear) nuclearRuns++;
      sumMonths += r.months;
      sumCasA += r.casualtiesA; sumCasB += r.casualtiesB;
      sumCivA += r.civA; sumCivB += r.civB;
      sumEconA += r.econA; sumEconB += r.econB;
      sumTerr += r.territoryLostB;
      sumKiaA += r.killedA; sumKiaB += r.killedB;
      distMonths.push(r.months); distKiaA.push(r.killedA); distKiaB.push(r.killedB);
      sumPowA += r.capturedA; sumPowB += r.capturedB;
      // How often each magazine actually ran dry — the answer is usually
      // "more than anyone plans for".
      if (r.shellsLeftA < 0.05) dryShellA++;
      if (r.shellsLeftB < 0.05) dryShellB++;
      if (r.pgmLeftA < 0.10) dryPgmA++;
      if (r.intLeftB < 0.10) dryIntB++;
      if (i < 400) runs.push({ months: r.months, casA: r.casualtiesA, casB: r.casualtiesB, outcome: r.outcome });
      const side = OUTCOME_SIDE[r.outcome];
      draws.push({ ...r.draws, weeks: r.weeks, outcome: r.outcome,
                   win: side === "a" || side === "pyrrhic" });
    }

    // A representative run for the narrative and the charts: median seed, no
    // extreme luck. Re-run deterministically so the timeline shown matches a
    // real trajectory rather than an average of incompatible ones.
    const medianRun = runOnce(A, B, opts, rngFactory(opts.seed + 7));

    const n = opts.iterations;
    const pct = (x) => (x / n) * 100;

    return {
      attacker: A, defender: B, opts,
      // Where the simulation stops. Reported because the share of runs that
      // reach it is meaningless without it — "23% stalemate" is a different
      // claim at 30 months and at 120.
      horizonMonths: opts.maxMonths != null ? opts.maxMonths : WAR_AIMS[opts.warAim].months,
      distance: opts._distance,
      adjacent: A.borders.includes(B.id) || B.borders.includes(A.id),
      probability: {
        attacker: pct(tally.a), defender: pct(tally.b),
        unresolved: pct(tally.draw), pyrrhic: pct(tally.pyrrhic),
        nuclear: pct(tally.none),
      },
      outcomeBreakdown: Object.fromEntries(
        Object.entries(byOutcome).map(([k, v]) => [k, pct(v)])),
      // When the wars ended and by which mechanism, and which of the sampled
      // unknowns the answer actually rests on.
      endings: endingCurves(draws, n),
      uncertainty: attribution(draws),
      nuclearRisk: pct(nuclearRuns),
      expected: {
        months: sumMonths / n,
        casualtiesA: sumCasA / n, casualtiesB: sumCasB / n,
        killedA: sumKiaA / n, killedB: sumKiaB / n,
        capturedA: sumPowA / n, capturedB: sumPowB / n,
        civA: sumCivA / n, civB: sumCivB / n,
        econA: sumEconA / n, econB: sumEconB / n,
        territoryLostB: sumTerr / n,
      },
      /* Sorted, so a quantile or a CDF lookup is a binary search. This is what
       * lets the backtest ask the only question worth asking of a probabilistic
       * forecast: not "was the average close" but "where in the predicted
       * distribution did reality actually land". */
      dist: {
        months: distMonths.sort((a, b) => a - b),
        killedA: distKiaA.sort((a, b) => a - b),
        killedB: distKiaB.sort((a, b) => a - b),
      },
      magazines: {
        shellsDryA: pct(dryShellA), shellsDryB: pct(dryShellB),
        pgmDryA: pct(dryPgmA), interceptorsDryB: pct(dryIntB),
      },
      runs, medianRun,
      profiles: { a: opts._pa, b: opts._pb },
      derived: buildDerived(A, B, opts),
    };
  }

  /* ── Everything the "show your work" panel needs ───────────────────────── */
  function buildDerived(A, B, opts) {
    const pa = opts._pa, pb = opts._pb;
    const d = opts._distance;
    const adjacent = A.borders.includes(B.id) || B.borders.includes(A.id);
    const aim = WAR_AIMS[opts.warAim];
    const side = (c, p, isDef) => ({
      quality: qualityMult(c), training: trainingMult(c),
      experience: experienceMult(c), c4: c4Mult(c),
      scores: p.scores, projection: p.proj, sustainment: p.sust,
      lift: p.lift,
      deployFraction: isDef ? 0.90 : deployFraction(c, d, adjacent) * aim.commit,
      will: willProfile(c, isDef, opts.warAim),
      openness: c.openness,
      alliance: window.WarData.alliancesOf(c.id),
    });
    const needsAmphib = !adjacent && (B.island === 1 || B.borders.length === 0);
    const front = frontWidth(B, adjacent, needsAmphib);
    return {
      a: side(A, pa, false), b: side(B, pb, true),
      distance: d, adjacent,
      terrainMult: 1 + 0.55 * (B.terrain / 100),
      defenderEdge: 1.30 * (1 + 0.55 * (B.terrain / 100)) * (opts.warAim === "conquest" ? 1.08 : 1.0),
      urbanDragMax: 1 + 0.9 * (B.urban / 100),
      needsAmphib,
      frontKm: front,
      occupationNeed: B.pop * 20 * (0.75 + 0.5 * (B.urban / 100))
        * (1 - 0.85 * clamp(opts.localSupport ?? 0.15, 0, 1)),
      localSupport: clamp(opts.localSupport ?? 0.15, 0, 1),
      sharedAlliance: sharedAlliance(A.id, B.id),
      multiFront: { a: multiFrontTax(A, B.id), b: multiFrontTax(B, A.id) },
      chokepoints: {
        onA: window.WarData.chokeAgainst(B.id, A.id),
        onB: window.WarData.chokeAgainst(A.id, B.id),
      },
      closure: {
        a: adjacent ? 0.50 : clamp(0.05 + 0.40 * (pa.proj.index / 150), 0.04, 0.45),
        b: 0.62,
      },
      mobilisation: {
        a: { rate: A.mobRate, pool: A.res * MOBILIZATION[opts.mobilizationA].reserveCall,
             equipCap: A.act * (1 + A.store) + A.res * 0.25, store: A.store },
        b: { rate: B.mobRate, pool: B.res * MOBILIZATION[opts.mobilizationB].reserveCall,
             equipCap: B.act * (1 + B.store) + B.res * 0.25, store: B.store },
      },
      season: { climate: B.climate, start: opts.startMonth ?? 2,
                profile: SEASON[B.climate] || SEASON.temperate },
      aim,
    };
  }

  window.WarModel = {
    simulate, domainScores, projection, sustainment, frontWidth,
    seasonTempo, multiFrontTax, SEASON,
    greatCircle, deployFraction, amphibiousLift, qualityMult, trainingMult,
    experienceMult, c4Mult, willProfile,
    WAR_AIMS, MOBILIZATION, rngFactory, WEEKS_PER_MONTH, DT, K,
    quantile, pit,
  };
})();

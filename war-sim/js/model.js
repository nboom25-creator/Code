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
    const tolerance = 0.004 + 0.052 * Math.pow(base, 1.6);
    return { base, tolerance };
  }

  const WAR_AIMS = {
    conquest:  { label: "Total conquest",        territory: 0.85, commit: 0.70, occupy: true,  months: 60 },
    regime:    { label: "Regime change",         territory: 0.45, commit: 0.65, occupy: true,  months: 48 },
    limited:   { label: "Seize border region",   territory: 0.12, commit: 0.45, occupy: false, months: 30 },
    punitive:  { label: "Punitive air campaign", territory: 0.00, commit: 0.22, occupy: false, months: 12 },
    blockade:  { label: "Blockade / strangle",   territory: 0.00, commit: 0.30, occupy: false, months: 36 },
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
    // Industrial output and how much a society will bear are both uncertain.
    const indA = jitter(rng, 0.25), indB = jitter(rng, 0.25);
    const tolA = jitter(rng, 0.22), tolB = jitter(rng, 0.22);

    const S = {
      a: {
        land: (pa.scores.land + cbA.land) * compA,
        air: (pa.scores.air + cbA.air) * compA,
        sea: (pa.scores.sea + cbA.sea) * compA,
        strike: (pa.scores.strike + cbA.strike) * compA,
        ad: pa.scores.airDefense + cbA.ad,
        shells: A.shellStock, pgm: A.pgmStock, interceptors: A.intStock,
        casualties: 0, killed: 0, wounded: 0, captured: 0, civ: 0,
        will: 1, econ: 0,
        industry: (pa.sust.replacement + cbA.replacement + supA) * indA,
        fuel: pa.sust.fuel, territory: 1,
      },
      b: {
        land: (pb.scores.land + cbB.land) * compB,
        air: (pb.scores.air + cbB.air) * compB,
        sea: (pb.scores.sea + cbB.sea) * compB,
        strike: (pb.scores.strike + cbB.strike) * compB,
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
    const defenderEdge = 1.30 * terrainMult * (opts.warAim === "conquest" ? 1.08 : 1.0);

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
    const cohesion = (c) => clamp(0.30 + 0.55 * (c.mor / 100) * (0.4 + 0.6 * (c.trn / 100)), 0.28, 0.90);
    const cohesionA = cohesion(A), cohesionB = cohesion(B);

    const timeline = [];
    let month = 0, outcome = null, nuclear = null;
    let seaControlA = 0.5, airControlA = 0.5;
    let landedA = 0;              // thousands of troops ashore, amphibious ops
    const woundedQueue = { a: [], b: [] }; // wounded returning to duty, by month

    const maxMonths = opts.maxMonths != null ? opts.maxMonths : aim.months;

    while (month < maxMonths) {
      month++;
      const calendar = (startMonth + month - 1) % 12;
      const tempo = seasonTempo(B.climate, calendar);

      // ── 1. Closure and mobilisation ───────────────────────────────────────
      arrivedA = Math.min(1, arrivedA + closureA);
      arrivedB = Math.min(1, arrivedB + closureB);
      mobilisedA = Math.min(equipCapA, mobilisedA + reservePoolA * A.mobRate);
      mobilisedB = Math.min(equipCapB, mobilisedB + reservePoolB * B.mobRate);
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
      const pgmDemandA = 3.2 * (0.4 + 0.6 * airControlA) *
        (opts.warAim === "punitive" ? 1.5 : 1);
      const pgmDemandB = 2.4 * (0.4 + 0.6 * (1 - airControlA));
      const pgmA = clamp(S.a.pgm / Math.max(pgmDemandA, 1e-6), 0, 1);
      const pgmB = clamp(S.b.pgm / Math.max(pgmDemandB, 1e-6), 0, 1);
      const strikeEffA = 0.42 + 0.58 * Math.min(1, pgmA);
      const strikeEffB = 0.42 + 0.58 * Math.min(1, pgmB);
      S.a.pgm = clamp(S.a.pgm - Math.min(S.a.pgm, pgmDemandA) + start.a.pgm * A.pgmProd, 0, start.a.pgm);
      S.b.pgm = clamp(S.b.pgm - Math.min(S.b.pgm, pgmDemandB) + start.b.pgm * B.pgmProd, 0, start.b.pgm);

      // Interceptors. An integrated air defence with an empty magazine is
      // scrap metal, and cheap drones are very good at emptying it.
      const intDemandB = (S.a.strike * 0.055 + A.droneProd * 0.030) * (1 - cdB * 0.4);
      const intDemandA = (S.b.strike * 0.055 + B.droneProd * 0.030) * (1 - cdA * 0.4);
      const intB = clamp(S.b.interceptors / Math.max(intDemandB, 1e-6), 0, 1);
      const intA = clamp(S.a.interceptors / Math.max(intDemandA, 1e-6), 0, 1);
      const adAmmoB = 0.22 + 0.78 * Math.min(1, intB);
      const adAmmoA = 0.22 + 0.78 * Math.min(1, intA);
      S.b.interceptors = clamp(S.b.interceptors - Math.min(S.b.interceptors, intDemandB)
        + start.b.interceptors * (B.intProd + supIntB), 0, start.b.interceptors);
      S.a.interceptors = clamp(S.a.interceptors - Math.min(S.a.interceptors, intDemandA)
        + start.a.interceptors * (A.intProd + supIntA), 0, start.a.interceptors);

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

      if (month === 1 && surprise) {
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
        + droneAirA) * netA * (1 + surprise * (month === 1 ? 0.35 : 0));
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
      const theatreScale = Math.pow(Math.max(B.area, 20) / 800, 0.22);
      const reachDepth = clamp(
        (0.10 + 0.42 * pa.sust.transport * clamp(pa.sust.fuel, 0.2, 1.2) * (A.log / 70)) / theatreScale,
        0.06, 1.2);
      const supplyStrain = 1 / (1 + Math.pow(depth / reachDepth, 1.7));
      const garrisonNeed = depth * B.pop * 20;
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
      const shellNeedA = engagedA * 0.30, shellNeedB = engagedB * 0.22;
      // Drone superiority suppresses the other side's guns as well as killing
      // its vehicles - counter-battery by loitering munition.
      const dSupA = clamp(1 - 0.30 * (B.droneProd / 100) * (1 - cdA), 0.6, 1);
      const dSupB = clamp(1 - 0.30 * (A.droneProd / 100) * (1 - cdB), 0.6, 1);
      const fireA = (0.45 + 0.55 * clamp(S.a.shells / Math.max(shellNeedA, 1e-6), 0, 1)) * dSupA;
      const fireB = (0.55 + 0.45 * clamp(S.b.shells / Math.max(shellNeedB, 1e-6), 0, 1)) * dSupB;
      S.a.shells = Math.max(0, S.a.shells - Math.min(S.a.shells, shellNeedA)) + A.shellProd + cbA.shells + supShellA;
      S.b.shells = Math.max(0, S.b.shells - Math.min(S.b.shells, shellNeedB)) + B.shellProd + cbB.shells + supShellB;

      // Cities have to be taken one building at a time, and they are where
      // the population — and therefore the objectives — are.
      const urbanDrag = 1 + 0.9 * (B.urban / 100) * Math.min(1, depth * 2.5);

      if (needsAmphib) {
        const interdiction = clamp(
          1 - (S.b.strike * 0.010 * strikeEffB + S.b.sea * 0.006 + (1 - airControlA) * 0.35), 0.03, 1);
        landedA += liftPerMonth * Math.pow(seaControlA, 1.6) * interdiction * tempo;
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
      const maxAdvance = 0.030 + 0.34 * Math.pow(manoeuvre, 2);
      const advance = maxAdvance * ((fr - 1) / (1 + fr)) * (0.6 + 0.8 * airControlA)
        * spaceFactor * tempo;
      S.b.territory = clamp(S.b.territory - advance * jitter(rng, 0.35), 0, 1);

      // ── 7. Attrition ──────────────────────────────────────────────────────
      const contact = clamp(2 / (forceRatio + 1 / forceRatio), 0.02, 1);
      // Casualties, not deaths. Killed is roughly a quarter of the total in a
      // modern army with functioning casualty evacuation; most of the wounded
      // come back. Reporting only the dead understates losses about fourfold
      // and overstates how fast an army is actually destroyed.
      const rateA = 0.030 * (1 - 0.30 * (A.tech / 100));
      const rateB = 0.030 * (1 - 0.30 * (B.tech / 100));
      // Exchange ratio. A total mismatch is not 2:1, it is closer to 50:1 —
      // Desert Storm and the 2003 invasion both ran at roughly that. The
      // clamp has to be wide enough to express it.
      const qualEdge = (qualityMult(A) * c4Mult(A)) / (qualityMult(B) * c4Mult(B));
      const exchange = Math.pow(clamp(forceRatio, 0.05, 40), 0.5) *
        Math.pow(clamp(qualEdge, 0.2, 5), 0.75);
      const urbanBlood = 1 + 0.8 * (B.urban / 100) * Math.min(1, depth * 2.5);
      // Casualties fall off with mismatch, but far more slowly than `contact`
      // itself: a one-sided war is short, not bloodless. Left linear, this
      // term had the 2003 invasion of Iraq killing fewer than a thousand
      // Iraqi soldiers.
      const bite = Math.pow(contact, 0.45);

      const assaultCost = (0.55 + 0.45 * defenderEdge) * (1 + 0.6 * lineIntegrity);
      const casA = engagedA * rateA * bite * (1 / exchange) * urbanBlood * assaultCost * jitter(rng, 0.4);
      const casB = engagedB * rateB * bite * exchange * jitter(rng, 0.4);
      const split = (c, tech) => {
        const kia = c * (0.30 - 0.09 * (tech / 100));
        const pow = c * 0.06;
        return { kia, pow, wia: c - kia - pow };
      };
      const sa = split(casA, A.tech), sb = split(casB, B.tech);
      S.a.casualties += casA; S.a.killed += sa.kia; S.a.wounded += sa.wia; S.a.captured += sa.pow;
      S.b.casualties += casB; S.b.killed += sb.kia; S.b.wounded += sb.wia; S.b.captured += sb.pow;
      mobilisedA = Math.max(0, mobilisedA - casA);
      mobilisedB = Math.max(0, mobilisedB - casB);
      // About 55% of the wounded return to duty, roughly three months later.
      woundedQueue.a[2] = (woundedQueue.a[2] || 0) + sa.wia * 0.55;
      woundedQueue.b[2] = (woundedQueue.b[2] || 0) + sb.wia * 0.55;

      // Civilian deaths from strategic strike, in millions per month. An empty
      // precision magazine drives this up sharply — unguided weapons hit far
      // more of what was not aimed at.
      const dumbA = 1 + 1.4 * (1 - Math.min(1, pgmA));
      const dumbB = 1 + 1.4 * (1 - Math.min(1, pgmB));
      S.b.civ += S.a.strike * 0.00008 * airControlA * dumbA *
        (opts.warAim === "punitive" ? 1.6 : 1) * jitter(rng, 0.5);
      S.a.civ += S.b.strike * 0.00008 * (1 - airControlA) * dumbB * jitter(rng, 0.5);

      // ── 8. Materiel losses and replacement ────────────────────────────────
      // Cheap attritable drones now do a large share of the killing of
      // vehicles, and they are produced by an industry the big defence
      // budgets mostly did not build.
      const droneA = clamp(0.016 * (A.droneProd / 100) * (1 - cdB), 0, 0.035);
      const droneB = clamp(0.016 * (B.droneProd / 100) * (1 - cdA), 0, 0.035);

      const frLoss = Math.pow(clamp(forceRatio, 0.3, 3), 0.45);
      const lossRateA = (0.045 * contact) / frLoss + droneB;
      const lossRateB = (0.045 * contact * frLoss) / Math.sqrt(defenderEdge) + droneA;

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

      S.a.land = Math.min(ceilA, S.a.land * (1 - lossRateA + regen(S.a.industry * storeA, lossRateA, fuelFactorA, 1.25)));
      S.b.land = Math.min(ceilB, S.b.land * (1 - lossRateB + regen(S.b.industry * storeB, lossRateB, fuelFactorB, 1.25)));
      // Flying against an air defence that has run out of missiles is much
      // safer, and that is exactly when an air force starts operating freely.
      const sanctuaryA = adAmmoB < 0.45 ? 0.7 : 1;
      const airLossA = lossRateA * 0.55 * sanctuaryA;
      S.a.air = Math.min(start.a.air * 1.4, S.a.air * (1 - airLossA + regen(S.a.industry * 0.5, airLossA, fuelFactorA, 1.1)));
      S.b.air = Math.min(start.b.air * 1.4, S.b.air * (1 - lossRateB * 0.75 + regen(S.b.industry * 0.5, lossRateB * 0.75, fuelFactorB, 1.1)));
      S.a.sea *= 1 - (maritime ? 0.02 * (1 - seaControlA) : 0.002);
      S.b.sea *= 1 - (maritime ? 0.02 * seaControlA : 0.002);
      // Launcher inventory, distinct from the magazine tracked above.
      S.a.strike = Math.min(start.a.strike, S.a.strike * (0.94 + Math.min(S.a.industry * 1.6, 0.06)));
      S.b.strike = Math.min(start.b.strike, S.b.strike * (0.94 + Math.min(S.b.industry * 1.6, 0.06)));
      S.a.ad = Math.max(S.a.ad * 0.985, start.a.ad * 0.30);
      S.b.ad = Math.max(S.b.ad * (1 - 0.05 * airControlA), start.b.ad * 0.30);

      // A blockade bites harder when the blockading side also holds the strait
      // the defender's imports have to transit.
      if (maritime && B.oilSelfSufficiency < 1) {
        S.b.fuel = clamp(S.b.fuel - seaControlA * 0.05 * (1 + 0.5 * chokeOnB), 0.1, 2);
      }

      // ── 9. Economic cost, USD billions (incremental over peacetime) ───────
      S.a.econ += (A.bud / 12) * (mobA.econ - 1 + 1.1 * contact * fracA);
      S.b.econ += (B.bud / 12) * (mobB.econ - 1 + 1.1 * contact * fracB)
        + B.gdp * 0.012 * (1 - S.b.territory);

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
      const burnA = S.a.casualties / (A.fit * 1000 * willA.tolerance * tolA);
      const burnB = S.b.casualties / (B.fit * 1000 * willB.tolerance * tolB);
      const progress = clamp(depth / Math.max(aim.territory, 0.05), 0, 1);
      const stall = (Math.min(month, 36) / 12) * (1 - progress) * 0.09;
      S.a.will = clamp(1 - burnA - stall - Math.max(0, 1 - S.a.land / start.a.land) * 0.25, 0, 1);
      S.b.will = clamp(1 - burnB * (1 - 0.25 * depth) - Math.max(0, depth - 0.6) * 0.9, 0, 1);
      if (B.stability < 40 && S.b.territory < 0.7) S.b.will *= 0.97;

      timeline.push({
        month, calendar, tempo, airControlA,
        seaControlA: maritime ? seaControlA : null,
        forceRatio, territoryB: S.b.territory,
        casA: S.a.casualties, casB: S.b.casualties,
        kiaA: S.a.killed, kiaB: S.b.killed,
        willA: S.a.will, willB: S.b.will,
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
          return clamp(over * 0.16 * restraint, 0, 0.5);
        };
        const pB = check(B, S.b, A.nuke > 0);
        const pA = check(A, S.a, B.nuke > 0);
        if (rng() < pB) nuclear = { by: B.id, month, first: true };
        else if (rng() < pA) nuclear = { by: A.id, month, first: true };
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

      // ── 12. Termination ───────────────────────────────────────────────────
      if (S.b.territory <= 1 - aim.territory && aim.territory > 0) { outcome = "attackerObjective"; break; }
      if (opts.warAim === "punitive" && month >= 3 && S.b.air / start.b.air < 0.55) { outcome = "attackerObjective"; break; }
      if (opts.warAim === "blockade" && S.b.fuel < 0.3 && month >= 6) { outcome = "attackerObjective"; break; }
      if (S.a.will <= 0.12) { outcome = "attackerCollapse"; break; }
      if (S.b.will <= 0.12) { outcome = "defenderCollapse"; break; }
      if (S.b.land / start.b.land < 1 - cohesionB) { outcome = "defenderCollapse"; break; }
      if (S.a.land / start.a.land < 1 - cohesionA) { outcome = "attackerCollapse"; break; }
    }
    if (!outcome) outcome = "stalemate";

    // ── Occupation feasibility ─────────────────────────────────────────────
    let occupation = null;
    if (aim.occupy && (outcome === "attackerObjective" || outcome === "defenderCollapse")) {
      const held = (1 - S.b.territory);
      const needed = B.pop * held * 20 * (0.75 + 0.5 * (B.urban / 100));
      const rotation = adjacent ? 1 : 1 / (1.6 + 1.4 * clamp(distance / 8000, 0, 1));
      const available = (mobilisedA * 0.6) * rotation;
      const ratio = available / Math.max(needed, 1);
      occupation = {
        needed, available, ratio,
        sustainable: ratio >= 1,
        intensity: clamp((1 - ratio) * (0.4 + 0.6 * (B.mor / 100)), 0, 1),
      };
      if (!occupation.sustainable) outcome = "pyrrhic";
    }

    const last = timeline[timeline.length - 1] || {};
    return {
      outcome, months: month, timeline, nuclear, occupation,
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

  /* =========================================================================
   * Monte Carlo wrapper.
   * ====================================================================== */
  const OUTCOME_SIDE = {
    attackerObjective: "a", defenderCollapse: "a",
    attackerCollapse: "b", stalemate: "draw", pyrrhic: "pyrrhic", nuclear: "none",
  };

  // Accepts either country ids or fully-built country objects, so the
  // historical backtest can feed period force structures through the same
  // model the live app uses — no parallel implementation to drift out of sync.
  function simulate(attacker, defender, userOpts = {}) {
    const A = typeof attacker === "string" ? BY_ID[attacker] : attacker;
    const B = typeof defender === "string" ? BY_ID[defender] : defender;
    if (!A || !B) throw new Error("Unknown country");

    const opts = {
      warAim: "limited", allies: true, nuclearAllowed: true, surprise: false, support: "none",
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
      sumPowA += r.capturedA; sumPowB += r.capturedB;
      // How often each magazine actually ran dry — the answer is usually
      // "more than anyone plans for".
      if (r.shellsLeftA < 0.05) dryShellA++;
      if (r.shellsLeftB < 0.05) dryShellB++;
      if (r.pgmLeftA < 0.10) dryPgmA++;
      if (r.intLeftB < 0.10) dryIntB++;
      if (i < 400) runs.push({ months: r.months, casA: r.casualtiesA, casB: r.casualtiesB, outcome: r.outcome });
    }

    // A representative run for the narrative and the charts: median seed, no
    // extreme luck. Re-run deterministically so the timeline shown matches a
    // real trajectory rather than an average of incompatible ones.
    const medianRun = runOnce(A, B, opts, rngFactory(opts.seed + 7));

    const n = opts.iterations;
    const pct = (x) => (x / n) * 100;

    return {
      attacker: A, defender: B, opts,
      distance: opts._distance,
      adjacent: A.borders.includes(B.id) || B.borders.includes(A.id),
      probability: {
        attacker: pct(tally.a), defender: pct(tally.b),
        stalemate: pct(tally.draw), pyrrhic: pct(tally.pyrrhic),
        nuclear: pct(tally.none),
      },
      outcomeBreakdown: Object.fromEntries(
        Object.entries(byOutcome).map(([k, v]) => [k, pct(v)])),
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
      occupationNeed: B.pop * 20 * (0.75 + 0.5 * (B.urban / 100)),
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
    WAR_AIMS, MOBILIZATION, rngFactory,
  };
})();

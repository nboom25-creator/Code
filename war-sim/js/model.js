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
    const tolerance = 0.004 + 0.052 * Math.pow(base, 1.6); // share of `fit` pool
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
      let land = 0, air = 0, sea = 0, strike = 0, ad = 0, replacement = 0, gdp = 0;
      ids.forEach((id) => {
        const ally = BY_ID[id];
        const s = domainScores(ally);
        const d = greatCircle(ally, theaterCountry);
        const adj = ally.borders.includes(theaterCountry.id);
        const f = deployFraction(ally, d, adj) * 0.35; // partners hold back
        land += s.land * f; air += s.air * f; sea += s.sea * f;
        strike += s.strike * f; ad += s.airDefense * f * 0.5;
        replacement += sustainment(ally).replacement * 0.25;
        gdp += ally.gdp;
      });
      return { land, air, sea, strike, ad, replacement, gdp };
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

    // ── Theatre access ────────────────────────────────────────────────────
    // The defender is at home; the attacker has to get there.
    const fracA = deployFraction(A, distance, adjacent) * aim.commit * jitter(rng, 0.10);
    const fracB = 0.90 * jitter(rng, 0.06); // home garrison + other borders

    const surprise = opts.surprise ? clamp(0.55 + rng() * 0.5, 0, 1.15) : 0;

    // Mobilised manpower pools, in thousands.
    const poolA = A.act + A.res * mobA.reserveCall + A.par * 0.3;
    const poolB = B.act + B.res * mobB.reserveCall + B.par * 0.5;

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
        land: (pa.scores.land + cbA.land) * fracA * compA,
        air: (pa.scores.air + cbA.air) * Math.max(fracA, 0.25) * compA,
        sea: (pa.scores.sea + cbA.sea) * Math.max(fracA, 0.30) * compA,
        strike: (pa.scores.strike + cbA.strike) * compA,
        ad: pa.scores.airDefense + cbA.ad,
        pool: poolA, spent: 0, casualties: 0, civ: 0,
        will: 1, econ: 0, industry: (pa.sust.replacement + cbA.replacement + supA) * indA,
        fuel: pa.sust.fuel, territory: 1,
      },
      b: {
        land: (pb.scores.land + cbB.land) * fracB * compB,
        air: (pb.scores.air + cbB.air) * compB,
        sea: (pb.scores.sea + cbB.sea) * compB,
        strike: (pb.scores.strike + cbB.strike) * compB,
        ad: pb.scores.airDefense + cbB.ad,
        pool: poolB, spent: 0, casualties: 0, civ: 0,
        will: 1, econ: 0, industry: (pb.sust.replacement + cbB.replacement + supB) * indB,
        fuel: pb.sust.fuel, territory: 1,
      },
    };
    const start = { a: { ...S.a }, b: { ...S.b } };

    // Terrain and prepared defence. The classic 1.5:1 attacker requirement,
    // scaled by how bad the ground is.
    const terrainMult = 1 + 0.55 * (B.terrain / 100);
    const defenderEdge = 1.30 * terrainMult * (opts.warAim === "conquest" ? 1.08 : 1.0);

    // Amphibious ceiling: an island (or a defender with no shared border and
    // no land route) can only be invaded as fast as you can land people.
    const needsAmphib = !adjacent && (B.island === 1 || distance > 900);
    const liftPerMonth = pa.lift * jitter(rng, 0.15);

    const timeline = [];
    let month = 0, outcome = null, nuclear = null;
    let seaControlA = 0.5, airControlA = 0.5;
    let landedA = 0; // thousands of troops ashore, for amphibious operations

    const maxMonths = Math.min(opts.maxMonths ?? aim.months, aim.months);

    while (month < maxMonths) {
      month++;

      // ── 1. Cyber / EW opening. Degrades the other side's networked
      //        effectiveness, hardest in the first weeks.
      const cyberEdge = Math.tanh((A.cyb - B.cyb) / 45) * (month <= 2 ? 0.14 : 0.05);
      const netA = 1 + Math.max(0, cyberEdge) * 0.5 - Math.max(0, -cyberEdge);
      const netB = 1 - Math.max(0, cyberEdge) + Math.max(0, -cyberEdge) * 0.5;

      // ── 2. Air superiority. Missiles suppress air defences; they do not win
      //        air superiority, so long-range strike is weighted lightly here.
      //        Ground-based air defence is attrited statefully further down —
      //        it is not decayed again here.
      const offA = (S.a.air + S.a.strike * 0.15) * netA * (1 + surprise * (month === 1 ? 0.35 : 0));
      const offB = (S.b.air + S.b.strike * 0.15) * netB;
      const defB = S.b.air * 0.35 + S.b.ad;
      const airRatio = (offA + 1) / (offB * 0.35 + defB + 1);
      airControlA = clamp(Math.pow(airRatio, 1.5) / (1 + Math.pow(airRatio, 1.5)), 0.02, 0.98);

      // ── 3. Sea control, when the sea matters at all.
      const maritime = needsAmphib || B.coast > 400 || opts.warAim === "blockade";
      if (maritime) {
        const seaRatio = (S.a.sea * (0.6 + 0.4 * airControlA) + 1) /
          (S.b.sea * (0.6 + 0.4 * (1 - airControlA)) + S.b.strike * 0.25 + 1);
        seaControlA = clamp(Math.pow(seaRatio, 1.3) / (1 + Math.pow(seaRatio, 1.3)), 0.02, 0.98);
      }

      // ── 4. Ground combat. Air control is the biggest single modifier on
      //        modern ground operations, worth roughly a 2:1 swing.
      const airMultA = 0.55 + 0.95 * airControlA;
      const airMultB = 0.55 + 0.95 * (1 - airControlA);

      // Depth of penetration is what actually stops most invasions — not the
      // enemy's remaining divisions but the attacker's own supply lines
      // stretching past what its logistics can carry, while an ever-larger
      // share of the army is tied down holding what it already took.
      const depth = 1 - S.b.territory;
      // How deep an advance this attacker's logistics can support before it
      // culminates, scaled against the size of the country being invaded —
      // 40% of Belgium is a different problem from 40% of Russia.
      const theatreScale = Math.pow(Math.max(B.area, 20) / 800, 0.22);
      const reachDepth = clamp(
        (0.10 + 0.42 * pa.sust.transport * clamp(pa.sust.fuel, 0.2, 1.2) * (A.log / 70)) / theatreScale,
        0.06, 1.2);
      const supplyStrain = 1 / (1 + Math.pow(depth / reachDepth, 1.7));
      const garrisonNeed = depth * B.pop * 20;                        // thousands
      const garrisonDrag = clamp(garrisonNeed / Math.max(poolA * aim.commit, 1), 0, 0.85);

      let groundA = S.a.land * airMultA * supplyStrain * (1 - garrisonDrag);
      if (needsAmphib) {
        // Sealift into a contested strait is a target list, not a landing.
        // Surviving throughput is gated by sea control, by the defender's
        // anti-ship and coastal-strike inventory, and by who owns the sky.
        const interdiction = clamp(
          1 - (S.b.strike * 0.010 + S.b.sea * 0.006 + (1 - airControlA) * 0.35), 0.03, 1);
        landedA += liftPerMonth * Math.pow(seaControlA, 1.6) * interdiction;
        // Ashore forces cap how much of the army is actually in the fight.
        const ashoreCap = clamp(landedA / Math.max(poolA * aim.commit, 1), 0, 1);
        groundA *= ashoreCap;
      }
      const groundB = S.b.land * airMultB * defenderEdge;

      const forceRatio = groundA / Math.max(groundB, 1e-6);

      // Territory changes hands as a function of how far the ratio exceeds
      // parity. Below parity the term goes negative and the defender takes
      // ground back — the model produces counter-offensives rather than only
      // ever grinding one way.
      const fr = Math.pow(forceRatio, 1.7);
      const advance = 0.040 * ((fr - 1) / (1 + fr)) * (0.6 + 0.8 * airControlA);
      S.b.territory = clamp(S.b.territory - advance * jitter(rng, 0.35), 0, 1);

      // ── 5. Attrition. Casualties peak when the two sides are evenly matched
      //        — lopsided fights are short and, for the stronger side, cheap.
      //        `contact` collapses toward zero when one side cannot reach the
      //        other at all, which is why an attacker with no way to get there
      //        inflicts nothing.
      const contact = clamp(2 / (forceRatio + 1 / forceRatio), 0.02, 1);
      const lethalA = 0.009 * (1 - 0.35 * (A.tech / 100));
      const lethalB = 0.009 * (1 - 0.35 * (B.tech / 100));
      // fracA already carries the war aim's commitment cap — do not apply it
      // a second time here.
      const engagedA = poolA * (needsAmphib ? clamp(landedA / poolA, 0, 1) : fracA);
      const engagedB = poolB * fracB;

      // Exchange ratio. Being outmatched costs you more, but not linearly —
      // a stalled attacker digs in rather than feeding men into a meat grinder
      // at ten times the defender's rate.
      const exchange = Math.pow(clamp(forceRatio, 0.15, 5), 0.5);
      const casA = engagedA * lethalA * contact * (1 / exchange) * jitter(rng, 0.4);
      const casB = engagedB * lethalB * contact * exchange * jitter(rng, 0.4);
      S.a.casualties += casA; S.b.casualties += casB;

      // Civilian deaths from strategic strike, in millions per month. Calibrated
      // against the direct civilian toll of recent air campaigns rather than
      // against total excess mortality — it counts people killed by ordnance,
      // not the much larger number who die of everything a war causes.
      S.b.civ += S.a.strike * 0.00008 * airControlA * (opts.warAim === "punitive" ? 1.6 : 1) * jitter(rng, 0.5);
      S.a.civ += S.b.strike * 0.00008 * (1 - airControlA) * jitter(rng, 0.5);

      // Materiel losses, partly replaced by industry. This is the phase where
      // wars are actually decided: whoever can regenerate faster wins the long
      // one regardless of who won the opening battles.
      // Materiel attrition. The force-ratio term is deliberately damped: a
      // linear one is a runaway feedback loop in which whoever pulls ahead
      // compounds their lead until the model can only ever produce total
      // victory or total stalemate. Real defenders trade space for time and
      // shorten their lines as they fall back. Being dug in also costs the
      // defender less equipment per unit of fighting.
      const frLoss = Math.pow(clamp(forceRatio, 0.3, 3), 0.45);
      const lossRateA = (0.045 * contact) / frLoss;
      const lossRateB = (0.045 * contact * frLoss) / Math.sqrt(defenderEdge);
      // Fuel gates how much of the industrial base can actually be turned into
      // fielded equipment. It can only ever throttle regeneration, never
      // amplify it — an oil surplus does not build extra tanks.
      const fuelFactorA = clamp(S.a.fuel, 0.25, 1.0);
      const fuelFactorB = clamp(
        S.b.fuel - (maritime ? seaControlA * 0.55 * (1 - clamp(B.oilSelfSufficiency, 0, 1)) : 0),
        0.15, 1.0);

      // Replacement makes good losses; it does not conjure an army. Regeneration
      // is capped just above the loss rate, so a strong industrial base means a
      // force that holds its strength (and grows slowly under mobilisation),
      // not one that quintuples over a long war — which is what an earlier,
      // uncapped version of this line produced.
      const regen = (industry, loss, fuel, cap) => Math.min(industry * fuel, loss * cap);
      const ceilA = start.a.land * 1.8, ceilB = start.b.land * 1.8;

      S.a.land = Math.min(ceilA, S.a.land * (1 - lossRateA + regen(S.a.industry, lossRateA, fuelFactorA, 1.25)));
      S.b.land = Math.min(ceilB, S.b.land * (1 - lossRateB + regen(S.b.industry, lossRateB, fuelFactorB, 1.25)));
      S.a.air = Math.min(start.a.air * 1.4, S.a.air * (1 - lossRateA * 0.55 + regen(S.a.industry * 0.5, lossRateA * 0.55, fuelFactorA, 1.1)));
      S.b.air = Math.min(start.b.air * 1.4, S.b.air * (1 - lossRateB * 0.75 + regen(S.b.industry * 0.5, lossRateB * 0.75, fuelFactorB, 1.1)));
      S.a.sea *= 1 - (maritime ? 0.02 * (1 - seaControlA) : 0.002);
      S.b.sea *= 1 - (maritime ? 0.02 * seaControlA : 0.002);
      // Magazines deplete far faster than they refill — the defining
      // constraint on modern long-range strike.
      S.a.strike = Math.min(start.a.strike, S.a.strike * (0.88 + Math.min(S.a.industry * 1.6, 0.11)));
      S.b.strike = Math.min(start.b.strike, S.b.strike * (0.88 + Math.min(S.b.industry * 1.6, 0.11)));
      // Ground-based air defence is worn down by SEAD, but never to zero:
      // mobile launchers and shoulder-fired systems survive campaigns that
      // destroy every fixed site.
      S.a.ad = Math.max(S.a.ad * 0.985, start.a.ad * 0.30);
      S.b.ad = Math.max(S.b.ad * (1 - 0.05 * airControlA), start.b.ad * 0.30);

      // Blockade bites the import-dependent side over time.
      if (maritime && B.oilSelfSufficiency < 1) {
        S.b.fuel = clamp(S.b.fuel - seaControlA * 0.05, 0.1, 2);
      }

      // ── 6. Economic cost, in USD billions. This is the *incremental* cost of
      //        fighting — mobilisation and combat spending above the peacetime
      //        budget, which would have been spent anyway. Charging the whole
      //        defence budget to the war overstates it several-fold.
      S.a.econ += (A.bud / 12) * (mobA.econ - 1 + 1.1 * contact * fracA);
      S.b.econ += (B.bud / 12) * (mobB.econ - 1 + 1.1 * contact * fracB)
        + B.gdp * 0.012 * (1 - S.b.territory);

      // ── 7. Political will. Casualties measured against what each society
      //        can bear, plus impatience on the attacker's side and the
      //        rallying effect of losing ground on the defender's.
      const burnA = S.a.casualties / (A.fit * 1000 * willA.tolerance * tolA);
      const burnB = S.b.casualties / (B.fit * 1000 * willB.tolerance * tolB);
      // A war that is going nowhere is the one an attacking public stops
      // supporting. Impatience is scaled by how little progress there is
      // toward the stated objective, not by elapsed time alone.
      const progress = clamp(depth / Math.max(aim.territory, 0.05), 0, 1);
      const stall = (Math.min(month, 48) / 12) * (1 - progress) * 0.13;
      S.a.will = clamp(1 - burnA - stall - Math.max(0, 1 - S.a.land / start.a.land) * 0.25, 0, 1);
      // Losing ground hardens a defender — until the loss is deep enough that
      // the government itself is going under.
      S.b.will = clamp(1 - burnB * (1 - 0.25 * depth) - Math.max(0, depth - 0.6) * 0.9, 0, 1);
      if (B.stability < 40 && S.b.territory < 0.7) S.b.will *= 0.97; // fragile states crack

      timeline.push({
        month, airControlA, seaControlA: maritime ? seaControlA : null,
        forceRatio, territoryB: S.b.territory,
        casA: S.a.casualties, casB: S.b.casualties,
        willA: S.a.will, willB: S.b.will,
        landA: S.a.land / start.a.land, landB: S.b.land / start.b.land,
      });

      // ── 8. Nuclear escalation check ───────────────────────────────────────
      if (opts.nuclearAllowed) {
        const check = (X, st, foeHasNukes) => {
          if (!X.nuke || !X.doctrine) return 0;
          // Existential pressure: ground lost + will collapsing + army destroyed.
          const pressure = X === B
            ? clamp((1 - st.territory) * 1.1 + (1 - st.will) * 0.6, 0, 2)
            : clamp((1 - st.will) * 0.9, 0, 2);
          const over = pressure - X.doctrine.threshold;
          if (over <= 0) return 0;
          // Mutual deterrence: the more the other side can retaliate with, the
          // more the decision is delayed, not avoided.
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
          // Deliberately coarse: prompt fatalities from a counter-value
          // exchange, scaled by deployed warheads and urban population.
          const wA = Math.min(A.dep || A.nuke * 0.35, 900);
          const wB = Math.min(B.dep || B.nuke * 0.35, 900);
          nuclear.deathsA = retaliates || nuclear.by === B.id ? Math.min(A.pop * 0.45, wB * 0.55) : 0;
          nuclear.deathsB = Math.min(B.pop * 0.45, wA * 0.55);
          outcome = "nuclear";
          break;
        }
      }

      // ── 9. Termination ────────────────────────────────────────────────────
      if (S.b.territory <= 1 - aim.territory && aim.territory > 0) { outcome = "attackerObjective"; break; }
      if (opts.warAim === "punitive" && month >= 3 && S.b.air / start.b.air < 0.55) { outcome = "attackerObjective"; break; }
      if (opts.warAim === "blockade" && S.b.fuel < 0.3 && month >= 6) { outcome = "attackerObjective"; break; }
      if (S.a.will <= 0.12) { outcome = "attackerCollapse"; break; }
      if (S.b.will <= 0.12) { outcome = "defenderCollapse"; break; }
      if (S.b.land / start.b.land < 0.08 && S.b.territory < 0.5) { outcome = "defenderCollapse"; break; }
      if (S.a.land / start.a.land < 0.08) { outcome = "attackerCollapse"; break; }
    }
    if (!outcome) outcome = "stalemate";

    // ── Occupation feasibility ─────────────────────────────────────────────
    // Winning the war and holding the country are different problems. The
    // ~20-per-1,000 counter-insurgency ratio is a blunt instrument but it is
    // the one that keeps being right.
    let occupation = null;
    if (aim.occupy && (outcome === "attackerObjective" || outcome === "defenderCollapse")) {
      const held = (1 - S.b.territory);
      const needed = B.pop * held * 20;                      // thousands of troops
      // No state garrisons a conquest with its entire army — home defence,
      // other borders and rotation take the rest. An expeditionary occupation
      // costs roughly three troops in the rotation base for every one standing
      // in the country, which is why distant occupations fail at force levels
      // that would be comfortable next door.
      const rotation = adjacent ? 1 : 1 / (1.6 + 1.4 * clamp(distance / 8000, 0, 1));
      const available = (poolA * 0.6 - S.a.casualties) * rotation;
      const ratio = available / Math.max(needed, 1);
      occupation = {
        needed, available, ratio,
        sustainable: ratio >= 1,
        // Insurgency intensity scales with the shortfall and the population's
        // cohesion and willingness to keep fighting after the army is gone.
        intensity: clamp((1 - ratio) * (0.4 + 0.6 * (B.mor / 100)), 0, 1),
      };
      if (!occupation.sustainable) outcome = "pyrrhic";
    }

    return {
      outcome, months: month, timeline, nuclear, occupation,
      coalition, distance, adjacent, needsAmphib,
      airControlA, seaControlA: (needsAmphib || B.coast > 400) ? seaControlA : null,
      final: S, start,
      casualtiesA: S.a.casualties * 1000, casualtiesB: S.b.casualties * 1000,
      civA: S.a.civ * 1e6, civB: S.b.civ * 1e6,
      econA: S.a.econ, econB: S.b.econ,
      territoryLostB: 1 - S.b.territory,
    };
  }

  /* =========================================================================
   * Monte Carlo wrapper.
   * ====================================================================== */
  const OUTCOME_SIDE = {
    attackerObjective: "a", defenderCollapse: "a",
    attackerCollapse: "b", stalemate: "draw", pyrrhic: "pyrrhic", nuclear: "none",
  };

  function simulate(attackerId, defenderId, userOpts = {}) {
    const A = BY_ID[attackerId], B = BY_ID[defenderId];
    if (!A || !B) throw new Error("Unknown country");

    const opts = {
      warAim: "limited", allies: true, nuclearAllowed: true, surprise: false, support: "none",
      mobilizationA: "partial", mobilizationB: "partial",
      iterations: 2000, seed: 20260809, maxMonths: 60, ...userOpts,
    };
    opts._pa = profile(A);
    opts._pb = profile(B);
    opts._distance = greatCircle(A, B);

    const rng = rngFactory(opts.seed);
    const tally = { a: 0, b: 0, draw: 0, none: 0, pyrrhic: 0 };
    const byOutcome = {};
    const runs = [];
    let nuclearRuns = 0, sumMonths = 0, sumCasA = 0, sumCasB = 0,
        sumCivA = 0, sumCivB = 0, sumEconA = 0, sumEconB = 0, sumTerr = 0;

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
        civA: sumCivA / n, civB: sumCivB / n,
        econA: sumEconA / n, econB: sumEconB / n,
        territoryLostB: sumTerr / n,
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
    return {
      a: side(A, pa, false), b: side(B, pb, true),
      distance: d, adjacent,
      terrainMult: 1 + 0.55 * (B.terrain / 100),
      defenderEdge: 1.30 * (1 + 0.55 * (B.terrain / 100)) * (opts.warAim === "conquest" ? 1.08 : 1.0),
      needsAmphib: !adjacent && (B.island === 1 || d > 900),
      occupationNeed: B.pop * 20,
      sharedAlliance: sharedAlliance(A.id, B.id),
      aim,
    };
  }

  window.WarModel = {
    simulate, domainScores, projection, sustainment,
    greatCircle, deployFraction, amphibiousLift, qualityMult, trainingMult,
    experienceMult, c4Mult, willProfile,
    WAR_AIMS, MOBILIZATION, rngFactory,
  };
})();

/* =============================================================================
 * backtest.js — run the model against wars whose outcomes we already know.
 *
 * Every parameter in this model is a judgement call until something checks it.
 * This file is that check: nine conflicts with period-accurate force data and
 * documented outcomes, fed through exactly the same `simulate()` the live app
 * uses. Where the model is wrong, it says so and by how much.
 *
 * TWO MODELLING CONVENTIONS, both of which matter for reading the results:
 *
 *  1. Expeditionary forces are placed at their staging base, not their capital.
 *     The 1991 coalition is modelled as the force assembled in Saudi Arabia,
 *     not as the United States 10,000 km away, because that is what actually
 *     fought. The months of build-up that made it possible are outside the
 *     model's window; where that matters it is noted on the case.
 *
 *  2. The model's time resolution is one month. The Six-Day War and the 100-hour
 *     ground phase of Desert Storm are below its floor, and it cannot be right
 *     about them. They are included anyway — a backtest that quietly drops the
 *     cases a model handles badly is not a backtest.
 *
 * Sources for outcomes and casualties: official histories, Correlates of War,
 * IISS, and the standard scholarly ranges. Casualty figures for several of
 * these are disputed by wide margins; the bands below reflect that.
 * ========================================================================== */

(function () {
  const { makeCountry } = window.WarData;

  // Sensible period defaults so each snapshot only states what distinguishes it.
  const H = (raw) => makeCountry(Object.assign({
    region: "historical", res: 0, par: 0, nuke: 0, dep: 0, triad: 0,
    brm: 0, crm: 0, hyp: 0, bases: 0, uav: 0, cyb: 5, droneProd: 0,
  }, raw));

  const CASES = [
    /* ── 1990-91 Gulf War ────────────────────────────────────────────────── */
    {
      id: "gulf91",
      name: "Gulf War",
      when: "1991",
      blurb: "Coalition ejects Iraq from Kuwait. Six weeks of air, 100 hours of ground.",
      note: "Coalition modelled as the force assembled in Saudi Arabia. The six-month build-up that made it possible is outside the model's window.",
      opts: { warAim: "limited", mobilizationA: "full", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 0 },
      actual: { outcome: "attacker", months: 1.5, killedA: 380, killedB: 25000,
                casualtyNote: "Iraqi military dead disputed: 20,000–35,000" },
      a: H({ id: "coalition91", name: "Coalition", flag: "🤝", lat: 24.7, lon: 46.7,
        pop: 400, fit: 150, gdp: 8000, ppp: 8000, bud: 420, budPpp: 420,
        act: 950, tank: 3600, afv: 4000, spg: 1500, tow: 500, mlrs: 250,
        ftr: 1400, atk: 400, tpt: 400, tkr: 300, awacs: 20, heli: 1700, ahel: 280,
        cv: 6, lhd: 4, dd: 20, ff: 20, ss: 6, pat: 20, ton: 1200,
        area: 2150, coast: 2640, terrain: 25, borders: ["iraq91"], urban: 80,
        tech: 92, trn: 92, exp: 55, c4: 92, ad: 70, cyb: 20, log: 95, mor: 62, stab: 75,
        arms: 95, steel: 90, oilp: 12000, oilc: 18000, ref: 16000,
        rail: 240, road: 6000, air: 14000, port: 25, mm: 3000,
        shellProd: 40, shellStock: 900, pgmStock: 42, pgmProd: 0.03, intStock: 60,
        mobRate: 0.20, store: 1.4, climate: "arid" }),
      b: H({ id: "iraq91", name: "Iraq", flag: "🇮🇶", lat: 33.3, lon: 44.4,
        pop: 18, fit: 4.5, gdp: 45, ppp: 95, bud: 13, budPpp: 32,
        act: 1000, res: 480, par: 100,
        tank: 4500, afv: 4000, spg: 500, tow: 3000, mlrs: 200,
        ftr: 550, atk: 130, tpt: 60, heli: 480, ahel: 160,
        ff: 5, fs: 8, pat: 40, ton: 20,
        area: 438, coast: 58, terrain: 38, borders: ["coalition91"], urban: 70,
        tech: 40, trn: 38, exp: 78, c4: 25, ad: 52, cyb: 3, log: 30, mor: 45, stab: 45,
        arms: 20, steel: 0.5, oilp: 2000, oilc: 400, ref: 500,
        rail: 2, road: 45, air: 100, port: 2, mm: 40,
        shellProd: 8, shellStock: 950, pgmStock: 4, intStock: 22,
        mobRate: 0.10, store: 0.9, climate: "arid" }),
    },

    /* ── 2003 invasion of Iraq ───────────────────────────────────────────── */
    {
      id: "iraq03",
      name: "Invasion of Iraq",
      when: "2003",
      blurb: "Three weeks to Baghdad, then an occupation that could not be held.",
      note: "The interesting test is not the invasion but whether the model flags the occupation as unsustainable.",
      opts: { warAim: "regime", mobilizationA: "partial", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 2 },
      actual: { outcome: "attacker", months: 1.5, killedA: 172, killedB: 15000,
                occupationFails: true,
                casualtyNote: "Iraqi military dead in the invasion phase: 7,600–30,000" },
      a: H({ id: "coalition03", name: "US / UK", flag: "🤝", lat: 29.4, lon: 47.9,
        pop: 350, fit: 120, gdp: 13000, ppp: 13000, bud: 460, budPpp: 460,
        act: 380, tank: 1100, afv: 2000, spg: 300, tow: 150, mlrs: 100,
        ftr: 700, atk: 200, tpt: 250, tkr: 200, awacs: 15, heli: 900, ahel: 200, uav: 60,
        cv: 5, lhd: 4, dd: 18, ff: 12, ss: 8, pat: 12, ton: 1000,
        area: 18, coast: 499, terrain: 22, borders: ["iraq03"], urban: 90,
        tech: 96, trn: 94, exp: 70, c4: 97, ad: 72, cyb: 55, log: 98, mor: 60, stab: 72,
        arms: 98, steel: 95, oilp: 8000, oilc: 20000, ref: 17000,
        rail: 250, road: 6400, air: 14500, port: 25, mm: 3200,
        shellProd: 35, shellStock: 600, pgmStock: 85, pgmProd: 0.04, intStock: 70,
        mobRate: 0.14, store: 1.5, droneProd: 12, climate: "arid" }),
      b: H({ id: "iraq03", name: "Iraq", flag: "🇮🇶", lat: 33.3, lon: 44.4,
        pop: 25, fit: 6, gdp: 20, ppp: 60, bud: 1.4, budPpp: 4,
        act: 375, res: 650, par: 44,
        tank: 2200, afv: 2400, spg: 150, tow: 1900, mlrs: 200,
        ftr: 60, atk: 20, tpt: 10, heli: 300, ahel: 40,
        pat: 10, ton: 3,
        area: 438, coast: 58, terrain: 38, borders: ["coalition03"], urban: 68,
        tech: 28, trn: 30, exp: 45, c4: 15, ad: 25, cyb: 3, log: 18, mor: 35, stab: 30,
        arms: 10, steel: 0.2, oilp: 1300, oilc: 400, ref: 400,
        rail: 2, road: 45, air: 100, port: 2, mm: 20,
        shellProd: 2, shellStock: 400, pgmStock: 1, intStock: 8,
        mobRate: 0.06, store: 0.4, climate: "arid" }),
    },

    /* ── 1982 Falklands ──────────────────────────────────────────────────── */
    {
      id: "falklands82",
      name: "Falklands War",
      when: "1982",
      blurb: "Britain retakes the islands across 12,700 km of ocean.",
      note: "Defender is the Argentine garrison on the islands, not Argentina. Tests opposed landing and power projection at extreme range.",
      opts: { warAim: "conquest", mobilizationA: "partial", mobilizationB: "partial",
              allies: false, nuclearAllowed: false, startMonth: 3 },
      actual: { outcome: "attacker", months: 2.5, killedA: 255, killedB: 649 },
      a: H({ id: "uk82", name: "United Kingdom", flag: "🇬🇧", lat: 51.5, lon: -0.13,
        pop: 56, fit: 14, gdp: 520, ppp: 560, bud: 28, budPpp: 28,
        act: 330, res: 250, tank: 0, afv: 300, spg: 20, tow: 30,
        ftr: 42, atk: 0, tpt: 60, tkr: 25, awacs: 0, heli: 200, ahel: 0,
        cv: 2, lhd: 2, dd: 8, ff: 15, ss: 4, pat: 10, ton: 400,
        area: 244, coast: 12429, island: 1, terrain: 42, borders: [], urban: 78,
        tech: 78, trn: 90, exp: 55, c4: 70, ad: 55, cyb: 5, log: 78, mor: 70, stab: 70,
        arms: 80, steel: 14, oilp: 2000, oilc: 1600, ref: 1800,
        rail: 17, road: 350, air: 400, port: 14, mm: 1300, bases: 25,
        shellProd: 5, shellStock: 60, pgmStock: 22, intStock: 40,
        mobRate: 0.10, store: 0.8, climate: "temperate" }),
      b: H({ id: "arg82", name: "Argentine garrison", flag: "🇦🇷", lat: -51.7, lon: -59.2,
        pop: 0.5, fit: 0.15, gdp: 3, ppp: 6, bud: 0.4, budPpp: 1,
        act: 13, res: 0, tank: 0, afv: 40, spg: 0, tow: 40,
        ftr: 20, atk: 10, tpt: 6, heli: 25,
        pat: 4, ton: 5,
        area: 12, coast: 1288, island: 1, terrain: 55, borders: [], urban: 40,
        tech: 45, trn: 40, exp: 10, c4: 25, ad: 35, cyb: 2, log: 20, mor: 45, stab: 40,
        arms: 12, steel: 0.1, oilp: 0, oilc: 10, ref: 0,
        rail: 0, road: 0.2, air: 3, port: 1, mm: 5,
        shellProd: 0.2, shellStock: 12, pgmStock: 2, intStock: 6,
        mobRate: 0.02, store: 0.2, climate: "temperate" }),
    },

    /* ── 1973 Yom Kippur ─────────────────────────────────────────────────── */
    {
      id: "yomkippur73",
      name: "Yom Kippur War",
      when: "1973",
      blurb: "Egypt and Syria attack across the Canal and onto the Golan; Israel recovers.",
      note: "Tests strategic surprise, fast mobilisation, and a dense SAM belt against a superior air force.",
      opts: { warAim: "limited", mobilizationA: "full", mobilizationB: "full",
              allies: false, nuclearAllowed: false, surprise: true, startMonth: 9 },
      actual: { outcome: "defender", months: 0.7, killedA: 12000, killedB: 2700,
                casualtyNote: "Arab dead 8,000–18,000; Israeli 2,521–2,800" },
      a: H({ id: "arab73", name: "Egypt & Syria", flag: "🤝", lat: 30.0, lon: 31.2,
        pop: 43, fit: 12, gdp: 20, ppp: 60, bud: 4.5, budPpp: 14,
        act: 1000, res: 500, tank: 4500, afv: 4000, spg: 300, tow: 2000, mlrs: 100,
        ftr: 900, atk: 200, tpt: 80, heli: 300, ahel: 0,
        dd: 6, fs: 20, ss: 12, pat: 40, ton: 60,
        area: 1186, coast: 2643, terrain: 34, borders: ["isr73"], urban: 45,
        tech: 48, trn: 52, exp: 45, c4: 32, ad: 78, cyb: 2, log: 38, mor: 72, stab: 55,
        arms: 15, steel: 1.5, oilp: 200, oilc: 250, ref: 200,
        rail: 6, road: 40, air: 90, port: 5, mm: 200,
        shellProd: 5, shellStock: 700, pgmStock: 6, intStock: 55, intProd: 0.02,
        mobRate: 0.25, store: 1.1, climate: "arid" }),
      b: H({ id: "isr73", name: "Israel", flag: "🇮🇱", lat: 31.8, lon: 35.2,
        pop: 3.3, fit: 1.0, gdp: 11, ppp: 16, bud: 3.3, budPpp: 5,
        act: 75, res: 300, tank: 2000, afv: 3000, spg: 400, tow: 200, mlrs: 20,
        ftr: 350, atk: 0, tpt: 30, tkr: 4, heli: 80, ahel: 0,
        fs: 14, ss: 2, pat: 20, ton: 12,
        area: 22, coast: 273, terrain: 46, borders: ["arab73"], urban: 85,
        tech: 66, trn: 88, exp: 82, c4: 58, ad: 45, cyb: 3, log: 55, mor: 88, stab: 75,
        arms: 45, steel: 0.2, oilp: 0, oilc: 100, ref: 120,
        rail: 0.8, road: 11, air: 40, port: 3, mm: 40,
        shellProd: 3, shellStock: 90, pgmStock: 10, intStock: 25,
        mobRate: 0.60, store: 2.6, climate: "arid" }),
    },

    /* ── 1967 Six-Day War ────────────────────────────────────────────────── */
    {
      id: "sixday67",
      name: "Six-Day War",
      when: "1967",
      blurb: "Israel destroys the Egyptian air force on the ground and takes Sinai in six days.",
      note: "Below the model's one-month resolution. Included to show the floor, not because the model can be right about it.",
      opts: { warAim: "limited", mobilizationA: "full", mobilizationB: "partial",
              allies: false, nuclearAllowed: false, surprise: true, startMonth: 5 },
      actual: { outcome: "attacker", months: 0.2, killedA: 800, killedB: 11500,
                casualtyNote: "Egyptian dead 10,000–15,000" },
      a: H({ id: "isr67", name: "Israel", flag: "🇮🇱", lat: 31.8, lon: 35.2,
        pop: 2.7, fit: 0.8, gdp: 4, ppp: 7, bud: 1.0, budPpp: 1.8,
        act: 50, res: 214, tank: 1100, afv: 1500, spg: 150, tow: 200,
        ftr: 200, atk: 0, tpt: 20, heli: 40,
        fs: 8, ss: 3, pat: 12, ton: 8,
        area: 21, coast: 273, terrain: 40, borders: ["egy67"], urban: 82,
        tech: 60, trn: 88, exp: 60, c4: 52, ad: 35, cyb: 1, log: 50, mor: 90, stab: 78,
        arms: 30, steel: 0.1, oilp: 0, oilc: 50, ref: 60,
        rail: 0.8, road: 9, air: 30, port: 3, mm: 30,
        shellProd: 1.5, shellStock: 55, pgmStock: 3, intStock: 12,
        mobRate: 0.65, store: 2.6, climate: "arid" }),
      b: H({ id: "egy67", name: "Egypt", flag: "🇪🇬", lat: 30.0, lon: 31.2,
        pop: 31, fit: 8, gdp: 6, ppp: 20, bud: 1.4, budPpp: 4,
        act: 240, res: 100, tank: 1300, afv: 1100, spg: 100, tow: 900,
        ftr: 450, atk: 60, tpt: 60, heli: 100,
        dd: 6, fs: 12, ss: 10, pat: 30, ton: 40,
        area: 1001, coast: 2450, terrain: 30, borders: ["isr67"], urban: 40,
        tech: 42, trn: 40, exp: 30, c4: 22, ad: 42, cyb: 1, log: 30, mor: 55, stab: 50,
        arms: 12, steel: 0.3, oilp: 100, oilc: 120, ref: 100,
        rail: 5, road: 25, air: 70, port: 4, mm: 100,
        shellProd: 2, shellStock: 220, pgmStock: 1, intStock: 20,
        mobRate: 0.10, store: 0.8, climate: "arid" }),
    },

    /* ── 1980-88 Iran–Iraq ───────────────────────────────────────────────── */
    {
      id: "iraniraq80",
      name: "Iran–Iraq War",
      when: "1980–88",
      blurb: "Eight years of attrition between two roughly matched, badly led armies.",
      note: "The archetypal stalemate: an attacker that culminates almost immediately and cannot be dislodged either.",
      opts: { warAim: "limited", mobilizationA: "full", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 8, maxMonths: 96 },
      actual: { outcome: "stalemate", months: 96, killedA: 250000, killedB: 500000,
                casualtyNote: "Both figures disputed by a factor of two or more" },
      a: H({ id: "iraq80", name: "Iraq", flag: "🇮🇶", lat: 33.3, lon: 44.4,
        pop: 13, fit: 3.2, gdp: 38, ppp: 70, bud: 5, budPpp: 14,
        act: 240, res: 250, par: 75,
        tank: 2700, afv: 2500, spg: 200, tow: 1000, mlrs: 100,
        ftr: 330, atk: 60, tpt: 40, heli: 300, ahel: 40,
        ff: 4, fs: 8, pat: 30, ton: 15,
        area: 438, coast: 58, terrain: 38, borders: ["iran80"], urban: 66,
        tech: 42, trn: 40, exp: 20, c4: 22, ad: 40, cyb: 1, log: 30, mor: 55, stab: 55,
        arms: 15, steel: 0.3, oilp: 2500, oilc: 300, ref: 400,
        rail: 2, road: 25, air: 90, port: 2, mm: 40,
        shellProd: 6, shellStock: 400, pgmStock: 2, intStock: 18,
        mobRate: 0.10, store: 1.0, climate: "arid" }),
      b: H({ id: "iran80", name: "Iran", flag: "🇮🇷", lat: 35.7, lon: 51.4,
        pop: 39, fit: 10, gdp: 90, ppp: 180, bud: 4, budPpp: 12,
        act: 240, res: 400, par: 300,
        tank: 1740, afv: 1500, spg: 200, tow: 1000, mlrs: 50,
        ftr: 150, atk: 40, tpt: 60, heli: 400, ahel: 200,
        dd: 3, ff: 4, fs: 6, pat: 40, ton: 30,
        area: 1648, coast: 2440, terrain: 84, borders: ["iraq80"], urban: 50,
        tech: 45, trn: 32, exp: 15, c4: 18, ad: 35, cyb: 1, log: 28, mor: 82, stab: 45,
        arms: 12, steel: 0.5, oilp: 1500, oilc: 600, ref: 600,
        rail: 4, road: 60, air: 150, port: 5, mm: 100,
        shellProd: 4, shellStock: 300, pgmStock: 2, intStock: 14,
        mobRate: 0.16, store: 0.7, climate: "arid" }),
    },

    /* ── 2020 Nagorno-Karabakh ───────────────────────────────────────────── */
    {
      id: "karabakh20",
      name: "Nagorno-Karabakh",
      when: "2020",
      blurb: "Azerbaijani drones dismantle a dug-in Armenian defence in 44 days.",
      note: "The case the drone layer exists for: a modest force with air-breathing precision beats a larger one without counter-drone.",
      opts: { warAim: "limited", mobilizationA: "full", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 8 },
      actual: { outcome: "attacker", months: 1.5, killedA: 2900, killedB: 3800 },
      a: H({ id: "aze20", name: "Azerbaijan", flag: "🇦🇿", lat: 40.4, lon: 49.9,
        pop: 10, fit: 3.6, gdp: 42, ppp: 140, bud: 2.2, budPpp: 6,
        act: 67, res: 300, par: 15,
        tank: 570, afv: 1400, spg: 250, tow: 300, mlrs: 300,
        ftr: 20, atk: 20, tpt: 10, heli: 60, ahel: 20, uav: 200,
        fs: 1, pat: 15, ton: 4,
        area: 87, coast: 0, terrain: 76, borders: ["arm20"], urban: 56,
        tech: 56, trn: 62, exp: 40, c4: 52, ad: 40, cyb: 34, log: 42, mor: 78, stab: 62,
        arms: 20, steel: 0.3, oilp: 750, oilc: 110, ref: 160,
        rail: 3, road: 25, air: 30, port: 1, mm: 300,
        shellProd: 2, shellStock: 90, pgmStock: 18, intStock: 12,
        mobRate: 0.20, store: 0.8, droneProd: 58, climate: "temperate" }),
      b: H({ id: "arm20", name: "Armenia", flag: "🇦🇲", lat: 40.2, lon: 44.5,
        pop: 3.0, fit: 1.1, gdp: 13, ppp: 40, bud: 0.65, budPpp: 1.8,
        act: 45, res: 210, par: 5,
        tank: 130, afv: 450, spg: 70, tow: 180, mlrs: 70,
        ftr: 4, atk: 8, tpt: 4, heli: 20, ahel: 6, uav: 20,
        area: 30, coast: 0, terrain: 90, borders: ["aze20"], urban: 63,
        tech: 42, trn: 48, exp: 45, c4: 30, ad: 40, cyb: 28, log: 26, mor: 76, stab: 50,
        arms: 10, steel: 0.05, oilp: 0, oilc: 55, ref: 0,
        rail: 0.8, road: 7.7, air: 11, port: 0, mm: 0,
        shellProd: 0.6, shellStock: 60, pgmStock: 4, intStock: 9,
        mobRate: 0.22, store: 0.6, droneProd: 8, climate: "temperate" }),
    },

    /* ── 1939-40 Winter War ──────────────────────────────────────────────── */
    {
      id: "winter39",
      name: "Winter War",
      when: "1939–40",
      blurb: "The USSR takes a slice of Karelia and pays about six Soviet lives for every Finnish one.",
      note: "Tests terrain, winter, morale and the cost of a badly led offensive against a small, motivated defender.",
      opts: { warAim: "limited", mobilizationA: "full", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 11 },
      actual: { outcome: "attacker", months: 3.5, killedA: 145000, killedB: 25000,
                casualtyNote: "Soviet dead 126,000–168,000; Finnish ~25,900" },
      a: H({ id: "ussr39", name: "Soviet Union", flag: "☭", lat: 55.8, lon: 37.6,
        pop: 170, fit: 45, gdp: 360, ppp: 420, bud: 30, budPpp: 45,
        act: 1000, res: 3000, tank: 3000, afv: 2000, spg: 100, tow: 3000, mlrs: 0,
        ftr: 1200, atk: 300, tpt: 100, heli: 0,
        dd: 15, ss: 50, pat: 40, ton: 200,
        area: 22400, coast: 37000, terrain: 55, borders: ["fin39"], urban: 33,
        tech: 40, trn: 28, exp: 20, c4: 15, ad: 25, cyb: 0, log: 35, mor: 60, stab: 65,
        arms: 62, steel: 18, oilp: 600, oilc: 500, ref: 500,
        rail: 85, road: 900, air: 400, port: 8, mm: 400,
        shellProd: 55, shellStock: 700, pgmStock: 0, intStock: 8,
        mobRate: 0.14, store: 1.3, climate: "continental" }),
      b: H({ id: "fin39", name: "Finland", flag: "🇫🇮", lat: 60.2, lon: 24.9,
        pop: 3.7, fit: 1.0, gdp: 12, ppp: 15, bud: 0.4, budPpp: 0.6,
        act: 30, res: 300, tank: 30, afv: 50, spg: 0, tow: 500, mlrs: 0,
        ftr: 110, atk: 0, tpt: 10, heli: 0,
        fs: 4, ss: 5, pat: 10, ton: 6,
        area: 385, coast: 1250, terrain: 82, borders: ["ussr39"], urban: 25,
        tech: 34, trn: 78, exp: 25, c4: 25, ad: 22, cyb: 0, log: 30, mor: 96, stab: 88,
        arms: 22, steel: 0.2, oilp: 0, oilc: 20, ref: 10,
        rail: 5, road: 40, air: 40, port: 5, mm: 250,
        shellProd: 0.8, shellStock: 40, pgmStock: 0, intStock: 5,
        mobRate: 0.45, store: 3.5, climate: "continental" }),
    },

    /* ── 2022– Russia–Ukraine ────────────────────────────────────────────── */
    {
      id: "ukraine22",
      name: "Russia–Ukraine",
      when: "2022–",
      blurb: "A limited-aim war of attrition sustained on one side by foreign materiel.",
      note: "Run at Russia's stated February 2022 aim, regime change, with materiel support to Ukraine. The test is whether the model correctly fails to reach it. Aims that shifted mid-war are outside what the model can express.",
      opts: { warAim: "regime", mobilizationA: "partial", mobilizationB: "full",
              allies: true, nuclearAllowed: true, support: "b", startMonth: 1, maxMonths: 48 },
      actual: { outcome: "stalemate", months: 48, killedA: 200000, killedB: 80000,
                territoryLost: 0.19,
                casualtyNote: "Russian dead 150,000–250,000; Ukrainian 60,000–100,000. Both contested." },
      useLive: ["rus", "ukr"],
    },
  ];

  /* ── Scoring ──────────────────────────────────────────────────────────────
   * Three tests per case, all deliberately loose. Historical casualty figures
   * for half of these are disputed by a factor of two, and a model working in
   * whole months cannot be graded to the week. A tight scoring rule here would
   * be false precision, not rigour.
   */
  const OUTCOME_CLASS = {
    attackerObjective: "attacker", defenderCollapse: "attacker", pyrrhic: "attacker",
    attackerCollapse: "defender", stalemate: "stalemate", nuclear: "nuclear",
  };

  function scoreCase(c, result) {
    const modal = Object.entries(result.outcomeBreakdown)
      .reduce((best, kv) => (kv[1] > best[1] ? kv : best), ["stalemate", -1]);
    const predicted = OUTCOME_CLASS[modal[0]] || "stalemate";
    const actual = c.actual;

    // How much probability mass the model put on what actually happened.
    let mass = 0;
    Object.entries(result.outcomeBreakdown).forEach(([k, v]) => {
      if ((OUTCOME_CLASS[k] || "stalemate") === actual.outcome) mass += v;
    });

    const months = result.expected.months;
    // The model cannot resolve below one month; a war that really lasted six
    // days is scored as passing if the model finishes in its first two.
    const durationOk = actual.months < 1
      ? months <= 2.5
      : months >= actual.months / 3 && months <= actual.months * 3;

    const ratio = (pred, act) => (act > 0 ? Math.max(pred / act, act / Math.max(pred, 1)) : 1);
    const rA = ratio(result.expected.killedA, actual.killedA);
    const rB = ratio(result.expected.killedB, actual.killedB);
    const casualtiesOk = rA <= 4 && rB <= 4;

    const occupationOk = actual.occupationFails === undefined ? null
      : actual.occupationFails === ((result.outcomeBreakdown.pyrrhic || 0) > 40);

    return {
      predicted, actualOutcome: actual.outcome,
      outcomeOk: predicted === actual.outcome,
      mass, months, durationOk,
      killedA: result.expected.killedA, killedB: result.expected.killedB,
      ratioA: rA, ratioB: rB, casualtiesOk, occupationOk,
      territoryLost: result.expected.territoryLostB,
      passes: [predicted === actual.outcome, durationOk, casualtiesOk]
        .filter(Boolean).length,
    };
  }

  function run(iterations = 800) {
    return CASES.map((c) => {
      const A = c.useLive ? window.WarData.BY_ID[c.useLive[0]] : c.a;
      const B = c.useLive ? window.WarData.BY_ID[c.useLive[1]] : c.b;
      const result = window.WarModel.simulate(A, B, { ...c.opts, iterations, seed: 424242 });
      return { case: c, result, score: scoreCase(c, result) };
    });
  }

  function summary(rows) {
    const n = rows.length;
    const outcomes = rows.filter((r) => r.score.outcomeOk).length;
    const durations = rows.filter((r) => r.score.durationOk).length;
    const casualties = rows.filter((r) => r.score.casualtiesOk).length;
    const meanMass = rows.reduce((s, r) => s + r.score.mass, 0) / n;
    return { n, outcomes, durations, casualties, meanMass };
  }

  window.WarBacktest = { CASES, run, summary, scoreCase };
})();

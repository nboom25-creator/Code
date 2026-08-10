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
              allies: false, nuclearAllowed: false, startMonth: 0 , localSupport: 0.85 },
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


    /* ── 1965-73 Vietnam ─────────────────────────────────────────────────── */
    {
      id: "vietnam65",
      name: "Vietnam War",
      when: "1965–73",
      blurb: "The United States wins almost every engagement and leaves anyway.",
      note: "The case the split between societal exhaustion and regime decision exists for. An accountable government cannot outlast a coercive one in a war its population has stopped supporting, however favourably the fighting goes.",
      opts: { warAim: "limited", mobilizationA: "peacetime", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 2, maxMonths: 96 },
      actual: { outcome: "defender", months: 96, killedA: 58000, killedB: 900000,
                casualtyNote: "North Vietnamese and NLF dead estimated 600,000-1,100,000" },
      a: H({ id: "usa65", name: "United States", flag: "🇺🇸", lat: 10.8, lon: 106.6,
        pop: 195, fit: 45, gdp: 850, ppp: 850, bud: 60, budPpp: 60, openness: 84,
        act: 540, res: 400, tank: 600, afv: 2500, spg: 400, tow: 800, mlrs: 0,
        ftr: 900, atk: 500, tpt: 400, tkr: 150, awacs: 4, heli: 3500, ahel: 500,
        cv: 5, lhd: 4, dd: 30, ff: 20, ss: 10, pat: 40, ton: 1400,
        area: 331, coast: 3444, terrain: 80, borders: ["nvn65"], urban: 20,
        tech: 78, trn: 82, exp: 55, c4: 62, ad: 60, cyb: 2, log: 88, mor: 48, stab: 62,
        arms: 92, steel: 120, oilp: 9000, oilc: 11000, ref: 11000,
        rail: 350, road: 5500, air: 12000, port: 25, mm: 3000, bases: 100,
        shellProd: 45, shellStock: 700, pgmStock: 10, intStock: 45,
        mobRate: 0.08, store: 1.6, climate: "monsoon" }),
      b: H({ id: "nvn65", name: "North Vietnam", flag: "🇻🇳", lat: 21.0, lon: 105.8,
        pop: 19, fit: 5, gdp: 6, ppp: 18, bud: 1.2, budPpp: 4, openness: 5,
        act: 480, res: 500, par: 300,
        tank: 250, afv: 400, spg: 40, tow: 800, mlrs: 100,
        ftr: 120, atk: 0, tpt: 20, heli: 20,
        pat: 30, ton: 6,
        area: 158, coast: 1200, terrain: 86, borders: ["usa65"], urban: 18,
        tech: 34, trn: 58, exp: 85, c4: 20, ad: 62, cyb: 0, log: 30, mor: 96, stab: 88,
        arms: 14, steel: 0.2, oilp: 0, oilc: 30, ref: 0,
        rail: 1.5, road: 20, air: 30, port: 2, mm: 30,
        shellProd: 3, shellStock: 260, pgmStock: 0, intStock: 34, intProd: 0.05,
        mobRate: 0.20, store: 1.0, climate: "monsoon" }),
    },

    /* ── 1950-53 Korea ───────────────────────────────────────────────────── */
    {
      id: "korea50",
      name: "Korean War",
      when: "1950–53",
      blurb: "Two near-total victories in opposite directions, ending where it started.",
      note: "Modelled from the northern invasion. The model has no way to express a war that reverses twice, so treat a stalemate verdict as the best it can do.",
      opts: { warAim: "conquest", mobilizationA: "full", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 5, maxMonths: 37 },
      actual: { outcome: "stalemate", months: 37, killedA: 400000, killedB: 180000,
                casualtyNote: "Chinese and North Korean dead 400,000-750,000; UN and ROK ~180,000" },
      a: H({ id: "prk50", name: "North Korea & China", flag: "🤝", lat: 39.0, lon: 125.7,
        pop: 560, fit: 140, gdp: 90, ppp: 200, bud: 8, budPpp: 22, openness: 4,
        act: 1200, res: 1500, par: 200,
        tank: 800, afv: 900, spg: 200, tow: 3000, mlrs: 200,
        ftr: 450, atk: 100, tpt: 40, heli: 0,
        pat: 30, ton: 10,
        area: 121, coast: 2495, terrain: 84, borders: ["kor50"], urban: 18,
        tech: 38, trn: 52, exp: 70, c4: 16, ad: 40, cyb: 0, log: 26, mor: 88, stab: 82,
        arms: 30, steel: 2, oilp: 30, oilc: 80, ref: 60,
        rail: 25, road: 120, air: 80, port: 4, mm: 80,
        shellProd: 14, shellStock: 500, pgmStock: 0, intStock: 12,
        mobRate: 0.14, store: 1.1, climate: "continental" }),
      b: H({ id: "kor50", name: "South Korea & UN", flag: "🤝", lat: 37.6, lon: 127.0,
        pop: 180, fit: 45, gdp: 420, ppp: 440, bud: 30, budPpp: 32, openness: 62,
        act: 600, res: 500, par: 50,
        tank: 900, afv: 2000, spg: 500, tow: 1200, mlrs: 50,
        ftr: 900, atk: 300, tpt: 250, tkr: 20, heli: 200, ahel: 0,
        cv: 6, lhd: 3, dd: 25, ff: 20, ss: 8, pat: 40, ton: 1100,
        area: 100, coast: 2413, terrain: 74, borders: ["prk50"], urban: 25,
        tech: 70, trn: 74, exp: 62, c4: 52, ad: 50, cyb: 0, log: 78, mor: 62, stab: 60,
        arms: 88, steel: 90, oilp: 8000, oilc: 9000, ref: 9000,
        rail: 300, road: 5000, air: 10000, port: 20, mm: 2600, bases: 60,
        shellProd: 40, shellStock: 600, pgmStock: 2, intStock: 40,
        mobRate: 0.16, store: 1.5, climate: "continental" }),
    },

    /* ── 1971 Indo-Pakistani ─────────────────────────────────────────────── */
    {
      id: "indopak71",
      name: "Indo-Pakistani War",
      when: "1971",
      blurb: "India takes East Pakistan in thirteen days and 90,000 prisoners.",
      note: "A decisive short war against a garrison with no line of retreat and no resupply.",
      opts: { warAim: "conquest", mobilizationA: "full", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 11 , localSupport: 0.9 },
      actual: { outcome: "attacker", months: 0.45, killedA: 3800, killedB: 8000 },
      a: H({ id: "ind71", name: "India", flag: "🇮🇳", lat: 22.6, lon: 88.4,
        pop: 560, fit: 130, gdp: 68, ppp: 250, bud: 2.0, budPpp: 7, openness: 60,
        act: 960, res: 500, par: 200,
        tank: 1450, afv: 900, spg: 100, tow: 1800, mlrs: 0,
        ftr: 625, atk: 100, tpt: 100, heli: 100, ahel: 0,
        cv: 1, dd: 4, ff: 12, ss: 4, pat: 30, ton: 60,
        area: 3287, coast: 7000, terrain: 60, borders: ["pak71"], urban: 20,
        tech: 48, trn: 64, exp: 55, c4: 32, ad: 42, cyb: 0, log: 44, mor: 80, stab: 62,
        arms: 30, steel: 6, oilp: 130, oilc: 250, ref: 250,
        rail: 60, road: 900, air: 200, port: 10, mm: 400,
        shellProd: 5, shellStock: 200, pgmStock: 1, intStock: 16,
        mobRate: 0.16, store: 0.9, climate: "monsoon" }),
      b: H({ id: "pak71", name: "Pakistan (East)", flag: "🇵🇰", lat: 23.8, lon: 90.4,
        pop: 65, fit: 14, gdp: 10, ppp: 34, bud: 0.8, budPpp: 2.6, openness: 20,
        act: 90, res: 40, par: 50,
        tank: 90, afv: 150, spg: 20, tow: 200, mlrs: 0,
        ftr: 20, atk: 0, tpt: 6, heli: 10,
        pat: 10, ton: 3,
        area: 148, coast: 580, terrain: 52, borders: ["ind71"], urban: 8,
        tech: 44, trn: 56, exp: 40, c4: 22, ad: 26, cyb: 0, log: 18, mor: 40, stab: 24,
        arms: 18, steel: 0.3, oilp: 0, oilc: 30, ref: 20,
        rail: 3, road: 30, air: 15, port: 2, mm: 30,
        shellProd: 0.5, shellStock: 25, pgmStock: 0, intStock: 4,
        mobRate: 0.05, store: 0.3, climate: "monsoon" }),
    },

    /* ── 1999 Kosovo ─────────────────────────────────────────────────────── */
    {
      id: "kosovo99",
      name: "Kosovo air campaign",
      when: "1999",
      blurb: "Seventy-eight days of NATO bombing, no ground invasion, and Yugoslavia concedes.",
      note: "Tests the punitive war aim: coercion by air alone, against an intact army that was never really defeated in the field.",
      opts: { warAim: "punitive", mobilizationA: "peacetime", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 2, maxMonths: 12 , localSupport: 0.8 },
      actual: { outcome: "attacker", months: 2.6, killedA: 2, killedB: 1200,
                casualtyNote: "Yugoslav military dead disputed: 600-5,000" },
      a: H({ id: "nato99", name: "NATO", flag: "🤝", lat: 41.3, lon: 19.8,
        pop: 700, fit: 200, gdp: 18000, ppp: 18000, bud: 420, budPpp: 420, openness: 86,
        act: 200, tank: 100, afv: 400, spg: 60, tow: 40, mlrs: 20,
        ftr: 700, atk: 200, tpt: 250, tkr: 180, awacs: 20, heli: 300, ahel: 60, uav: 40,
        cv: 3, lhd: 2, dd: 12, ff: 14, ss: 8, pat: 10, ton: 700,
        area: 29, coast: 362, terrain: 70, borders: ["yug99"], urban: 78,
        tech: 92, trn: 90, exp: 55, c4: 92, ad: 74, cyb: 40, log: 92, mor: 44, stab: 74,
        arms: 96, steel: 90, oilp: 7000, oilc: 20000, ref: 18000,
        rail: 240, road: 6000, air: 13000, port: 24, mm: 3000, bases: 90,
        shellProd: 30, shellStock: 400, pgmStock: 62, pgmProd: 0.035, intStock: 62,
        mobRate: 0.10, store: 1.4, climate: "temperate" }),
      b: H({ id: "yug99", name: "Yugoslavia", flag: "🇷🇸", lat: 44.8, lon: 20.5,
        pop: 10.6, fit: 2.6, gdp: 20, ppp: 45, bud: 1.5, budPpp: 4, openness: 22,
        act: 110, res: 400, par: 30,
        tank: 1200, afv: 900, spg: 200, tow: 1500, mlrs: 200,
        ftr: 120, atk: 40, tpt: 20, heli: 60, ahel: 20,
        pat: 20, ton: 8,
        area: 102, coast: 200, terrain: 72, borders: ["nato99"], urban: 52,
        tech: 46, trn: 58, exp: 62, c4: 30, ad: 58, cyb: 5, log: 34, mor: 66, stab: 52,
        arms: 42, steel: 1.2, oilp: 20, oilc: 90, ref: 100,
        rail: 4, road: 45, air: 40, port: 1, mm: 20,
        shellProd: 2, shellStock: 150, pgmStock: 2, intStock: 20,
        mobRate: 0.16, store: 1.2, climate: "temperate" }),
    },

    /* ── 2008 Russo-Georgian ─────────────────────────────────────────────── */
    {
      id: "georgia08",
      name: "Russo-Georgian War",
      when: "2008",
      blurb: "Five days. Russia takes what it came for and stops.",
      note: "Another sub-monthly war, and a test of whether a large neighbour with a limited aim is correctly called quickly rather than grinding.",
      opts: { warAim: "limited", mobilizationA: "peacetime", mobilizationB: "full",
              allies: false, nuclearAllowed: false, startMonth: 7, maxMonths: 12 , localSupport: 0.75 },
      actual: { outcome: "attacker", months: 0.17, killedA: 67, killedB: 170 },
      a: H({ id: "rus08", name: "Russia", flag: "🇷🇺", lat: 43.0, lon: 44.7,
        pop: 143, fit: 46, gdp: 1660, ppp: 2900, bud: 58, budPpp: 150, openness: 20,
        act: 1027, res: 2000, par: 450,
        tank: 3000, afv: 12000, spg: 1800, tow: 3000, mlrs: 2000,
        ftr: 700, atk: 300, tpt: 300, tkr: 20, awacs: 15, heli: 900, ahel: 250,
        cv: 1, dd: 15, ff: 10, fs: 60, ss: 40, pat: 50, ton: 900,
        area: 17098, coast: 37653, terrain: 58, borders: ["geo08"], urban: 73,
        tech: 58, trn: 52, exp: 50, c4: 40, ad: 80, cyb: 62, log: 48, mor: 66, stab: 62,
        arms: 82, steel: 68, oilp: 9800, oilc: 2900, ref: 5500,
        rail: 87, road: 950, air: 1200, port: 12, mm: 2500,
        shellProd: 60, shellStock: 2200, pgmStock: 18, intStock: 55,
        mobRate: 0.06, store: 2.4, droneProd: 6, climate: "temperate" }),
      b: H({ id: "geo08", name: "Georgia", flag: "🇬🇪", lat: 41.7, lon: 44.8,
        pop: 4.4, fit: 1.5, gdp: 13, ppp: 26, bud: 1.1, budPpp: 2.6, openness: 48,
        act: 32, res: 100, par: 12,
        tank: 190, afv: 200, spg: 60, tow: 100, mlrs: 40,
        ftr: 8, atk: 10, tpt: 4, heli: 30, ahel: 6,
        pat: 10, ton: 2,
        area: 70, coast: 310, terrain: 88, borders: ["rus08"], urban: 53,
        tech: 46, trn: 58, exp: 30, c4: 34, ad: 34, cyb: 20, log: 28, mor: 62, stab: 48,
        arms: 10, steel: 0.1, oilp: 0, oilc: 20, ref: 0,
        rail: 1.6, road: 20, air: 22, port: 2, mm: 60,
        shellProd: 0.3, shellStock: 25, pgmStock: 1, intStock: 6,
        mobRate: 0.12, store: 0.5, climate: "temperate" }),
    },

    /* ── 1999 Kargil ─────────────────────────────────────────────────────── */
    {
      id: "kargil99",
      name: "Kargil conflict",
      when: "1999",
      blurb: "Pakistan seizes high ground across the line of control and is pushed back off it.",
      note: "A limited attack that fails, between two nuclear states that did not escalate. Tests terrain at its most extreme.",
      opts: { warAim: "limited", mobilizationA: "partial", mobilizationB: "partial",
              allies: false, nuclearAllowed: true, startMonth: 4, maxMonths: 12 },
      actual: { outcome: "defender", months: 2.5, killedA: 700, killedB: 527 },
      a: H({ id: "pak99", name: "Pakistan", flag: "🇵🇰", lat: 35.3, lon: 76.0,
        pop: 138, fit: 40, gdp: 63, ppp: 220, bud: 3.3, budPpp: 11, openness: 24,
        act: 587, res: 500, par: 290, nuke: 15, triad: 1,
        tank: 2300, afv: 1100, spg: 240, tow: 1500, mlrs: 45,
        ftr: 350, atk: 60, tpt: 40, heli: 200, ahel: 20,
        ff: 8, ss: 10, pat: 20, ton: 50,
        area: 796, coast: 1046, terrain: 94, borders: ["ind99"], urban: 33,
        tech: 48, trn: 60, exp: 48, c4: 30, ad: 40, cyb: 8, log: 34, mor: 66, stab: 40,
        arms: 30, steel: 1.5, oilp: 60, oilc: 350, ref: 220,
        rail: 8, road: 250, air: 100, port: 2, mm: 40,
        shellProd: 6, shellStock: 140, pgmStock: 4, intStock: 12,
        mobRate: 0.08, store: 0.7, climate: "continental" }),
      b: H({ id: "ind99", name: "India", flag: "🇮🇳", lat: 34.6, lon: 76.6,
        pop: 1010, fit: 250, gdp: 460, ppp: 1600, bud: 13, budPpp: 42, openness: 60,
        act: 1173, res: 528, par: 1090, nuke: 15, triad: 1,
        tank: 3400, afv: 1500, spg: 180, tow: 4000, mlrs: 100,
        ftr: 700, atk: 100, tpt: 200, tkr: 4, heli: 300, ahel: 30,
        cv: 1, dd: 8, ff: 12, ss: 16, pat: 40, ton: 250,
        area: 3287, coast: 7000, terrain: 94, borders: ["pak99"], urban: 28,
        tech: 52, trn: 64, exp: 52, c4: 38, ad: 50, cyb: 14, log: 44, mor: 78, stab: 64,
        arms: 42, steel: 24, oilp: 700, oilc: 1900, ref: 1800,
        rail: 63, road: 3300, air: 340, port: 12, mm: 900,
        shellProd: 12, shellStock: 240, pgmStock: 8, intStock: 22,
        mobRate: 0.07, store: 0.8, climate: "continental" }),
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
    defenderCapitulates: "attacker",
    attackerCollapse: "defender", attackerWithdraws: "defender",
    stalemate: "stalemate", nuclear: "nuclear",
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

  /* Cases the fitter never sees. With fifteen wars and roughly a dozen free
   * coefficients, fitting on all of them would produce a model that is
   * excellent at these fifteen and worthless elsewhere. Six are held back so
   * that overfitting shows up as a gap between the two scores.
   *
   * The split is STRATIFIED BY DURATION, which matters more than it sounds. A
   * first attempt picked six cases that felt representative and happened to be
   * almost every short war in the set, leaving all four multi-year conflicts in
   * the fitting half. Fitting on long wars and testing on short ones produced a
   * large apparent overfitting gap that was really an artefact of the split.
   * These six span 0.17 months to 96, as do the nine that remain. */
  const HOLDOUT = new Set(["georgia08", "yomkippur73", "karabakh20",
                           "falklands82", "korea50", "vietnam65"]);
  const isHoldout = (id) => HOLDOUT.has(id);

  window.WarBacktest = { CASES, run, summary, scoreCase, HOLDOUT, isHoldout };
})();

/* =============================================================================
 * app.js — controls, and the report the model's output turns into.
 * ========================================================================== */

(function () {
  const { COUNTRIES, BY_ID, PLATFORM_LABELS } = window.WarData;
  const M = window.WarModel;
  const { tugBars, lineChart, waterfall, scatter, rangeBearing,
          frontStrip, stackedArea, sparkRows } = window.WarCharts;

  // Ordered parts of one whole take steps of a single hue, not categorical
  // colours. These are the blue ramp's ordinal-safe steps on a dark surface.
  const RAMP = ["#86b6ef", "#5598e7", "#2a78d6", "#184f95"];

  const $ = (id) => document.getElementById(id);
  const out = $("out");

  const C = {
    a: "var(--attacker)", b: "var(--defender)",
    neutral: "var(--neutral)", crit: "var(--critical)",
  };

  /* ── Formatting ─────────────────────────────────────────────────────────── */
  function people(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + "M";
    if (n >= 1e3) return Math.round(n / 1e3) + "k";
    return Math.round(n).toLocaleString();
  }
  function money(bn) {
    if (bn >= 1000) return "$" + (bn / 1000).toFixed(bn < 10000 ? 2 : 1) + "tn";
    if (bn >= 1) return "$" + bn.toFixed(bn < 10 ? 1 : 0) + "bn";
    return "$" + (bn * 1000).toFixed(0) + "m";
  }
  const pct = (v, d = 0) => v.toFixed(d) + "%";
  const num = (v, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d });
  function duration(months) {
    if (months < 1.5) return "under a month";
    if (months < 24) return months.toFixed(months < 6 ? 1 : 0) + " months";
    return (months / 12).toFixed(1) + " years";
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  /* ── Populate controls ──────────────────────────────────────────────────── */
  const sorted = [...COUNTRIES].sort((x, y) => x.name.localeCompare(y.name));
  function fillCountries(sel, selectedId) {
    const groups = {};
    sorted.forEach((c) => (groups[c.region] ||= []).push(c));
    sel.innerHTML = Object.keys(groups).sort().map((g) =>
      `<optgroup label="${esc(g)}">` +
      groups[g].map((c) =>
        `<option value="${c.id}"${c.id === selectedId ? " selected" : ""}>${c.flag} ${esc(c.name)}</option>`
      ).join("") + "</optgroup>").join("");
  }
  fillCountries($("atk"), "rus");
  fillCountries($("def"), "pol");

  $("aim").innerHTML = Object.entries(M.WAR_AIMS)
    .map(([k, v]) => `<option value="${k}"${k === "limited" ? " selected" : ""}>${v.label}</option>`).join("");
  ["mobA", "mobB"].forEach((id) => {
    $(id).innerHTML = Object.entries(M.MOBILIZATION)
      .map(([k, v]) => `<option value="${k}"${k === "partial" ? " selected" : ""}>${v.label}</option>`).join("");
  });

  $("season").innerHTML = MONTH_NAMES
    .map((m, i) => `<option value="${i}"${i === 2 ? " selected" : ""}>${m}</option>`).join("");

  $("swap").addEventListener("click", () => {
    const a = $("atk").value;
    $("atk").value = $("def").value;
    $("def").value = a;
  });

  function readOpts(overrides = {}) {
    return {
      warAim: $("aim").value,
      mobilizationA: $("mobA").value,
      mobilizationB: $("mobB").value,
      support: $("support").value,
      startMonth: +$("season").value,
      localSupport: +$("local").value,
      allies: $("allies").checked,
      nuclearAllowed: $("nukes").checked,
      surprise: $("surprise").checked,
      iterations: +$("iter").value,
      ...overrides,
    };
  }

  $("run").addEventListener("click", () => {
    const A = $("atk").value, B = $("def").value;
    if (A === B) {
      out.innerHTML = `<section class="panel"><p class="panel-note">Pick two different countries.</p></section>`;
      return;
    }
    $("run").disabled = true;
    $("run").textContent = "Simulating…";
    out.innerHTML = `<div class="spinner">Fighting the war ${(+$("iter").value).toLocaleString()} times…</div>`;
    // Yield a frame so the button state paints before the loop blocks.
    setTimeout(() => {
      try {
        render(M.simulate(A, B, readOpts()));
      } catch (e) {
        out.innerHTML = `<section class="panel"><p class="panel-note">Simulation failed: ${esc(e.message)}</p></section>`;
        console.error(e);
      }
      $("run").disabled = false;
      $("run").textContent = "Simulate the war";
    }, 30);
  });

  /* =========================================================================
   * Report
   * ====================================================================== */
  function render(R) {
    const A = R.attacker, B = R.defender, P = R.probability, D = R.derived;
    const aN = A.flag + " " + A.name, bN = B.flag + " " + B.name;

    out.innerHTML = "";
    out.appendChild(verdict(R, aN, bN));
    out.appendChild(tiles(R));
    out.appendChild(balance(R, aN, bN));
    out.appendChild(theatre(R, aN, bN));
    out.appendChild(whyPanel(R, aN, bN));
    out.appendChild(spread(R, aN, bN));
    out.appendChild(campaign(R, aN, bN));
    out.appendChild(narrative(R, aN, bN));
    if (A.nuke || B.nuke) out.appendChild(nuclearPanel(R, aN, bN));
    out.appendChild(sensitivity(R));
    out.appendChild(showWork(R, aN, bN));
    out.appendChild(comparison(R, aN, bN));
    out.appendChild(caveats());
    out.appendChild(backtestPanel());
    wrapTables(out);
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Tables are the one thing here that genuinely cannot reflow — squashing the
  // columns makes them unreadable. Give every one its own scroll container so
  // a narrow screen scrolls the table rather than the whole page. Done as a
  // single pass over the finished report because several tables are built as
  // innerHTML inside the disclosure panels.
  function wrapTables(root) {
    root.querySelectorAll("table").forEach((t) => {
      if (t.parentElement && t.parentElement.classList.contains("chart-scroll")) return;
      const box = document.createElement("div");
      box.className = "chart-scroll";
      t.replaceWith(box);
      box.appendChild(t);
    });
  }

  function panel(title, note) {
    const s = document.createElement("section");
    s.className = "panel";
    if (title) s.innerHTML = `<h2>${title}</h2>` + (note ? `<p class="panel-note">${note}</p>` : "");
    return s;
  }

  /* ── Verdict ────────────────────────────────────────────────────────────── */
  function verdict(R, aN, bN) {
    const P = R.probability, s = panel();
    s.classList.add("verdict");

    const opts = [
      { k: "attacker", v: P.attacker, txt: `${aN} achieves its war aims` },
      { k: "defender", v: P.defender, txt: `${bN} holds — the attack fails` },
      { k: "stalemate", v: P.stalemate, txt: "Stalemate or negotiated settlement" },
      { k: "pyrrhic", v: P.pyrrhic, txt: `${aN} wins the war but cannot hold the ground` },
      { k: "nuclear", v: P.nuclear, txt: "Nuclear exchange — no victor" },
    ].sort((x, y) => y.v - x.v);
    const top = opts[0];

    let headline, detail;
    if (R.nuclearRisk >= 20) {
      headline = `☢ Escalation dominates: ${pct(R.nuclearRisk)} chance of nuclear use`;
      detail = `In ${pct(R.nuclearRisk)} of runs this war goes nuclear before it is decided. ` +
        `The conventional question — “${top.txt}”, in ${pct(top.v)} of runs — is close to academic ` +
        `next to that number.`;
    } else if (top.v >= 70) {
      headline = top.txt;
      detail = `${pct(top.v)} of ${R.opts.iterations.toLocaleString()} runs. The result is not seriously in doubt across the range of luck, leadership and alliance behaviour the model samples.`;
    } else if (top.v >= 45) {
      headline = top.txt + " — probably";
      detail = `${pct(top.v)} of runs, against ${pct(opts[1].v)} for “${opts[1].txt}”. A real contest: leadership and alliance decisions swing it.`;
    } else {
      headline = "Genuinely indeterminate";
      detail = `No outcome clears 45%. Most likely is “${top.txt}” at ${pct(top.v)}, but this matchup is decided by things the model can only sample, not predict.`;
    }

    const colors = {
      attacker: C.a, pyrrhic: C.a, defender: C.b,
      stalemate: C.neutral, nuclear: C.crit,
    };
    const bar = [
      { k: "attacker", label: `${R.attacker.flag} wins outright`, v: P.attacker },
      { k: "pyrrhic", label: `${R.attacker.flag} wins, cannot hold`, v: P.pyrrhic, striped: true },
      { k: "stalemate", label: "Stalemate", v: P.stalemate },
      { k: "defender", label: `${R.defender.flag} holds`, v: P.defender },
      { k: "nuclear", label: "☢ Nuclear exchange", v: P.nuclear },
    ];

    s.innerHTML =
      `<p class="headline">${headline}</p>
       <p class="detail">${detail}</p>
       <div class="probbar">` +
      bar.filter((x) => x.v > 0.05).map((x) =>
        `<div class="${x.striped ? "striped" : ""}" style="width:${x.v}%;background:${colors[x.k]}" title="${x.label}: ${pct(x.v, 1)}">${x.v >= 9 ? pct(x.v) : ""}</div>`
      ).join("") +
      `</div>
       <div class="problegend">` +
      bar.map((x) =>
        `<span><i class="swatch ${x.striped ? "striped" : ""}" style="background:${colors[x.k]}"></i>${x.label} — <b>${pct(x.v, 1)}</b></span>`
      ).join("") +
      `</div>`;
    return s;
  }

  /* ── Stat tiles ─────────────────────────────────────────────────────────── */
  function tiles(R) {
    const e = R.expected, s = panel("Expected cost", null);
    const occ = R.medianRun.occupation;
    const items = [
      { k: "Duration", v: duration(e.months), s: `median run: ${duration(R.medianRun.months)}` },
      { k: `${R.attacker.flag} military dead`, v: people(e.killedA),
        s: `${people(e.casualtiesA)} total casualties · ${pct((e.casualtiesA / (R.attacker.fit * 1e6)) * 100, 2)} of pool` },
      { k: `${R.defender.flag} military dead`, v: people(e.killedB),
        s: `${people(e.casualtiesB)} total casualties · ${pct((e.casualtiesB / (R.defender.fit * 1e6)) * 100, 2)} of pool` },
      { k: "Civilian dead", v: people(e.civA + e.civB), s: `${people(e.civB)} in ${R.defender.name}` },
      { k: "Direct cost", v: money(e.econA + e.econB), s: `${money(e.econA)} attacker / ${money(e.econB)} defender` },
      { k: `${R.defender.flag} territory lost`, v: pct(e.territoryLostB * 100), s: R.derived.aim.label + " requires " + pct(R.derived.aim.territory * 100) },
      { k: "Front width", v: num(R.derived.frontKm) + " km",
        s: R.medianRun.density > 0
          ? num(R.medianRun.density, 2) + "k defenders/km — " +
            (R.medianRun.manoeuvre > 0.6 ? "open, manoeuvre possible"
              : R.medianRun.manoeuvre > 0.35 ? "thin but continuous" : "solid line, no flanks")
          : "no continuous land front" },
    ];
    const mg = R.magazines;
    if (mg.shellsDryB > 5 || mg.shellsDryA > 5) {
      items.push({ crit: mg.shellsDryB > 50 || mg.shellsDryA > 50,
        k: "Artillery ammunition", v: pct(Math.max(mg.shellsDryA, mg.shellsDryB)),
        s: `of runs end with ${mg.shellsDryA >= mg.shellsDryB ? R.attacker.name : R.defender.name} out of shells` });
    }
    if (mg.interceptorsDryB > 5) {
      items.push({ crit: mg.interceptorsDryB > 50, k: "Interceptor magazine",
        v: pct(mg.interceptorsDryB),
        s: `of runs leave ${R.defender.name}'s air defences dry` });
    }
    if (R.nuclearRisk > 0.5) {
      items.push({ crit: true, k: "☢ Nuclear use", v: pct(R.nuclearRisk, 1), s: "probability across all runs" });
    }
    if (occ) {
      items.push({
        crit: !occ.sustainable, k: "Occupation force",
        v: num(occ.needed / 1000, 1) + "M",
        s: occ.sustainable ? "within attacker's manpower" : `only ${num(occ.available / 1000, 1)}M available — insurgency`,
      });
    }
    const g = document.createElement("div");
    g.className = "tiles";
    g.innerHTML = items.map((i) =>
      `<div class="tile${i.crit ? " crit" : ""}"><div class="k">${i.k}</div><div class="v">${i.v}</div><div class="s">${i.s}</div></div>`
    ).join("");
    s.appendChild(g);
    return s;
  }

  /* ── Balance of forces ──────────────────────────────────────────────────── */
  function balance(R, aN, bN) {
    const s = panel("Balance of forces in this theatre",
      `Raw strength adjusted for technology, training, combat experience and ISR — and then for how much of it ` +
      `can actually reach the fight. ${R.attacker.name} is ${R.adjacent ? "on the defender's border" : num(R.distance) + " km away"}.`);

    const a = R.derived.a, b = R.derived.b;
    const fa = a.deployFraction, fb = b.deployFraction;

    const head = document.createElement("div");
    head.className = "chart-head";
    head.innerHTML =
      `<div class="chart-title">Committed combat power by domain</div>
       <div class="legend">
         <span><i class="swatch" style="background:${C.a}"></i>${esc(aN)}</span>
         <span><i class="swatch" style="background:${C.b}"></i>${esc(bN)}</span>
       </div>`;
    s.appendChild(head);

    const rows = [
      { label: "Ground forces", a: a.scores.land * fa, b: b.scores.land * fb,
        note: `deployable: ${pct(fa * 100)} vs ${pct(fb * 100)} of force` },
      { label: "Air power", a: a.scores.air * Math.max(fa, 0.25), b: b.scores.air * fb,
        note: `${num(R.attacker.ftr + R.attacker.atk)} vs ${num(R.defender.ftr + R.defender.atk)} combat aircraft` },
      { label: "Naval power", a: a.scores.sea * Math.max(fa, 0.3), b: b.scores.sea * fb,
        note: `${R.attacker.totalNaval} vs ${R.defender.totalNaval} hulls` },
      { label: "Long-range strike", a: a.scores.strike, b: b.scores.strike,
        note: "cruise, ballistic and hypersonic inventory" },
      { label: "Air defence", a: a.scores.airDefense, b: b.scores.airDefense,
        note: "integrated homeland air defence" },
      { label: "Power projection", a: a.projection.index, b: b.projection.index,
        note: `reach ${num(a.projection.reach)} km vs ${num(b.projection.reach)} km`, fmt: (v) => v.toFixed(1) },
      { label: "War sustainment", a: a.sustainment.index, b: b.sustainment.index,
        note: "fuel, industry, steel, transport, money", fmt: (v) => v.toFixed(2) },
      { label: "Manpower pool", a: R.attacker.fit, b: R.defender.fit,
        note: "millions fit for military service", fmt: (v) => v.toFixed(1) + "M" },
    ];

    const box = document.createElement("div");
    box.className = "chart-scroll";
    s.appendChild(box);
    tugBars(box, rows, { aName: R.attacker.name, bName: R.defender.name });

    s.appendChild(tableToggle(
      ["Domain", R.attacker.name, R.defender.name, "Ratio"],
      rows.map((r) => {
        const f = r.fmt || ((v) => num(v));
        const hi = r.a >= r.b;
        return [r.label, f(r.a), f(r.b),
          (hi ? r.a / (r.b || 1e-9) : r.b / (r.a || 1e-9)).toFixed(1) + " : 1 " + (hi ? "▲ " + R.attacker.flag : "▲ " + R.defender.flag)];
      })));
    return s;
  }

  function chartBlock(section, title, legend, build, table) {
    const head = document.createElement("div");
    head.className = "chart-head";
    head.innerHTML = `<div class="chart-title">${title}</div><div class="legend">${legend || ""}</div>`;
    section.appendChild(head);
    const box = document.createElement("div");
    box.className = "chart-scroll";
    box.style.marginBottom = table ? "6px" : "20px";
    section.appendChild(box);
    build(box);
    if (table) section.appendChild(tableToggle(table[0], table[1]));
    return box;
  }

  /* ── Range and bearing ──────────────────────────────────────────────────── */
  function theatre(R, aN, bN) {
    const D = R.derived, A = R.attacker, B = R.defender;
    const s = panel("Distance, reach and the approach",
      `Not a map — the model has no coastlines and drawing some would imply knowledge it does not have. ` +
      `This is what it actually uses: true distance as radius, true bearing as angle, and each side's ` +
      `<em>reach</em> — the range at which half its deployable force still arrives — as a circle.`);

    chartBlock(s, "Theatre geometry",
      `<span><i class="swatch" style="background:${C.a}"></i>${esc(aN)} reach</span>
       <span><i class="swatch" style="background:${C.b}"></i>${esc(bN)} reach</span>` +
      (D.chokepoints.onA.length ? `<span><i class="swatch" style="background:${C.crit}"></i>Strait held against the attacker</span>` : ""),
      (box) => rangeBearing(box, {
        attacker: A, defender: B, distance: R.distance,
        reachA: D.a.projection.reach, reachB: D.b.projection.reach,
        chokepoints: D.chokepoints.onA,
      }));

    const note = document.createElement("p");
    note.className = "note";
    note.style.maxWidth = "80ch";
    note.innerHTML = R.adjacent
      ? `The two share a border, so the projection curve is largely bypassed — <strong>${pct(D.a.deployFraction * 100, 1)}</strong> of ${esc(A.name)}'s force reaches the theatre, limited by the war aim and by the other frontiers it still has to cover, not by distance.`
      : `At <strong>${num(R.distance)} km</strong> against a reach of ${num(D.a.projection.reach)} km, the projection curve leaves ${esc(A.name)} committing <strong>${pct(D.a.deployFraction * 100, 1)}</strong> of its force. ` +
        (D.chokepoints.onA.length
          ? `It also has to transit ${D.chokepoints.onA.map((k) => k.name).join(" and ")}, held by the defender.`
          : `No strait held by the defender gates the approach.`);
    s.appendChild(note);
    return s;
  }

  /* ── Why the ground battle came out as it did ───────────────────────────── */
  function whyPanel(R, aN, bN) {
    const t = R.medianRun.timeline;
    // The month the ground war was hottest is the one worth explaining.
    const pick = t.reduce((best, x) =>
      (x.chain && x.chain.groundA > (best.chain ? best.chain.groundA : -1)) ? x : best, t[0]);
    const ch = pick && pick.chain;
    const s = panel("Where the force ratio came from", null);
    if (!ch) { s.innerHTML += `<p class="note">No ground engagement in this scenario.</p>`; return s; }

    s.innerHTML += `<p class="panel-note">Every multiplier the model applies to ${esc(R.attacker.name)}'s ground forces, in the order it applies them, at the height of the ground campaign (month ${Math.ceil(pick.month)}). The long bars are the ones that decided it.</p>`;

    const steps = [];
    let v = ch.landA;
    steps.push({ label: "Committed ground power", from: 0, to: v, base: true,
      note: "quality-adjusted, after coalition contributions" });
    const add = (label, mult, note) => {
      const from = v; v = v * mult;
      steps.push({ label, from, to: v, mult, note });
    };
    add(R.derived.needsAmphib ? "Put ashore" : "Reaches the theatre", ch.groundFracA,
      R.derived.needsAmphib ? "share of the army landed so far"
        : `distance × war aim × other frontiers × closure`);
    add("Air support", ch.airMultA, `${pct(pick.airControlA * 100)} of the air`);
    add("Supply culmination", ch.supplyStrain, "how far the logistics reach");
    add("Garrisoning ground taken", ch.garrison, "troops tied down behind the line");
    add("Artillery ammunition", ch.fireA, "firepower available");

    chartBlock(s, "Attacker's ground power, step by step",
      `<span><i class="swatch" style="background:${C.a}"></i>${esc(aN)}</span>
       <span><i class="swatch" style="background:${C.b}"></i>${esc(bN)} committed strength</span>`,
      (box) => waterfall(box, {
        steps, threshold: ch.groundB,
        thresholdLabel: R.defender.flag + " " + num(ch.groundB, 1),
        fmt: (x) => x.toFixed(1),
      }),
      [["Step", "Multiplier", "Running value"],
       steps.map((x) => [x.label, x.mult != null ? "×" + x.mult.toFixed(3) : "—", num(x.to, 2)])]);

    const worst = steps.filter((x) => x.mult != null)
      .reduce((a, b) => (b.mult < a.mult ? b : a), { mult: 2, label: "—" });
    const note = document.createElement("p");
    note.className = "note";
    note.style.maxWidth = "80ch";
    note.innerHTML =
      `Against ${esc(R.defender.name)}'s committed <strong>${num(ch.groundB, 1)}</strong> — already multiplied by ${R.derived.defenderEdge.toFixed(2)}× for terrain and prepared positions — that is a force ratio of <strong>${(ch.groundA / Math.max(ch.groundB, 1e-9)).toFixed(2)} : 1</strong>. ` +
      `The single largest reduction is <strong>${esc(worst.label.toLowerCase())}</strong> at ×${worst.mult.toFixed(2)}.`;
    s.appendChild(note);
    return s;
  }

  /* ── The distribution, with shape ───────────────────────────────────────── */
  function spread(R, aN, bN) {
    const s = panel("Every war the model fought",
      `One mark per simulated war. The bar at the top of this report says how <em>often</em> each side ` +
      `prevails; this says what that actually looks like — whether a 60% chance means reliably in four ` +
      `months, or a coin flip between a rout and a five-year grind.`);

    const colorFor = (o) =>
      o === "attackerObjective" || o === "defenderCollapse" ? C.a
      : o === "pyrrhic" ? C.a
      : o === "attackerCollapse" ? C.b
      : o === "nuclear" ? C.crit : C.neutral;
    const labelFor = (o) => ({
      attackerObjective: R.attacker.name + " achieves its aims",
      defenderCollapse: R.defender.name + "'s defence collapses",
      pyrrhic: R.attacker.name + " wins but cannot hold",
      attackerCollapse: R.defender.name + " holds",
      stalemate: "Stalemate", nuclear: "☢ Nuclear exchange",
    }[o] || o);

    const points = R.runs.map((r) => ({
      x: r.months, y: r.casA + r.casB,
      color: colorFor(r.outcome), label: labelFor(r.outcome),
    }));

    chartBlock(s, `${R.runs.length.toLocaleString()} of the ${R.opts.iterations.toLocaleString()} runs`,
      `<span><i class="swatch" style="background:${C.a}"></i>${R.attacker.flag} prevails</span>
       <span><i class="swatch" style="background:${C.b}"></i>${R.defender.flag} holds</span>
       <span><i class="swatch" style="background:${C.neutral}"></i>Stalemate</span>` +
      (R.nuclearRisk > 0.2 ? `<span><i class="swatch" style="background:${C.crit}"></i>☢ Nuclear</span>` : ""),
      (box) => scatter(box, {
        points, xLabel: "Duration (months)", yLabel: "Military dead, both sides",
        yFmt: (v) => people(v),
        ariaLabel: "Each simulated war plotted by how long it lasted and how many it killed",
      }));

    const months = R.runs.map((r) => r.months).sort((a, b) => a - b);
    const q = (f) => months[Math.floor(months.length * f)] || 0;
    const note = document.createElement("p");
    note.className = "note";
    note.style.maxWidth = "80ch";
    note.innerHTML =
      `Half of these wars finish between <strong>${duration(q(0.25))}</strong> and <strong>${duration(q(0.75))}</strong>; ` +
      `a tenth run past <strong>${duration(q(0.9))}</strong>. A tight cloud means the matchup is decided by the force ` +
      `structures; a smeared one means it is decided by things the model can only sample.`;
    s.appendChild(note);
    return s;
  }

  /* ── Campaign timeline ──────────────────────────────────────────────────── */
  // Last tick of each elapsed month. The model runs weekly; a 96-month war is
  // 417 points, which is neither readable as a line nor useful as a table.
  function monthly(timeline) {
    const out = [];
    let seen = -1;
    timeline.forEach((x) => {
      const m = Math.ceil(x.month);
      if (m !== seen) { out.push(x); seen = m; }
      else out[out.length - 1] = x;
    });
    return out;
  }

  function campaign(R, aN, bN) {
    const t = monthly(R.medianRun.timeline);
    const n = t.length;
    const s = panel("How the campaign runs",
      `A single representative run — not an average of incompatible trajectories. ` +
      `It ends after ${duration(R.medianRun.months)} with ${outcomeLabel(R.medianRun.outcome, R)}.`);

    /* Six indicators on one shared timeline rather than three separate charts.
     * The point is the chain read downward: the magazine empties, firepower
     * falls, the front stops moving, and only then does will start to go. Three
     * charts with three x-axes made that sequence something you had to
     * reconstruct by eye. */
    chartBlock(s, "The campaign, read top to bottom",
      `<span><i class="swatch" style="background:${C.a}"></i>${esc(aN)}</span>
       <span><i class="swatch" style="background:${C.b}"></i>${esc(bN)}</span>`,
      (box) => sparkRows(box, {
        n,
        rows: [
          { label: "Air control", color: C.a, yMax: 1,
            values: t.map((x) => x.airControlA), fmt: (v) => Math.round(v * 100) + "%" },
          { label: "Artillery ammunition", color: C.a, yMax: 1,
            values: t.map((x) => Math.min(1, x.shellsA)), fmt: (v) => Math.round(v * 100) + "%" },
          { label: "…and the defender's", color: C.b, yMax: 1,
            values: t.map((x) => Math.min(1, x.shellsB)), fmt: (v) => Math.round(v * 100) + "%" },
          { label: "Defender interceptors", color: C.b, yMax: 1,
            values: t.map((x) => Math.min(1, x.intB)), fmt: (v) => Math.round(v * 100) + "%" },
          { label: "Ground held by defender", color: C.b, yMax: 1,
            values: t.map((x) => x.territoryB), fmt: (v) => Math.round(v * 100) + "%" },
          { label: "Attacker's will", color: C.a, yMax: 1,
            values: t.map((x) => x.willA), fmt: (v) => Math.round(v * 100) + "%" },
          { label: "Defender's will", color: C.b, yMax: 1,
            values: t.map((x) => x.willB), fmt: (v) => Math.round(v * 100) + "%" },
        ],
      }),
      [["Month", "Air control", `${R.attacker.name} shells`, `${R.defender.name} shells`,
        "Defender SAMs", "Territory", `${R.attacker.name} will`, `${R.defender.name} will`],
       t.map((x) => [Math.ceil(x.month), pct(x.airControlA * 100), pct(Math.min(1, x.shellsA) * 100),
         pct(Math.min(1, x.shellsB) * 100), pct(Math.min(1, x.intB) * 100),
         pct(x.territoryB * 100), pct(x.willA * 100), pct(x.willB * 100)])]);

    // The front line as a Hovmoller diagram: a grind reads as a slow diagonal,
    // a rout as a cliff, and a counter-offensive as the boundary moving back.
    if (R.medianRun.territoryLostB > 0.01) {
      chartBlock(s, "The front line, week by week",
        `<span><i class="swatch" style="background:${C.a}"></i>Taken by ${esc(aN)}</span>
         <span><i class="swatch" style="background:${C.b}"></i>Still held by ${esc(bN)}</span>`,
        (box) => frontStrip(box, {
          rows: sampleRows(R.medianRun.timeline, 60),
          aName: R.attacker.name, bName: R.defender.name,
        }));
    }

    // Where an army went. Ordered parts of one whole, so a single-hue ramp.
    const side = (pfx, name) => ({
      title: `Where ${name}'s army went`,
      bands: [
        { name: "Still fighting", color: RAMP[0], values: t.map((x) => x["mob" + pfx] * 1000) },
        // 55% of the wounded return to duty and are already inside "still
        // fighting"; only the rest are permanently out of the war.
        { name: "Wounded, out", color: RAMP[1], values: t.map((x) => x["wia" + pfx] * 0.45 * 1000) },
        { name: "Captured", color: RAMP[2], values: t.map((x) => x["pow" + pfx] * 1000) },
        { name: "Killed", color: RAMP[3], values: t.map((x) => x["kia" + pfx] * 1000) },
      ],
    });
    [side("A", R.attacker.name), side("B", R.defender.name)].forEach((cfg) => {
      chartBlock(s, cfg.title,
        cfg.bands.map((b) => `<span><i class="swatch" style="background:${b.color}"></i>${b.name}</span>`).join(""),
        (box) => stackedArea(box, {
          bands: cfg.bands, n, height: 230, yFmt: (v) => people(v),
          ariaLabel: cfg.title,
        }));
    });

    return s;
  }

  // Even sampling of a weekly timeline down to at most `max` rows.
  function sampleRows(timeline, max) {
    if (timeline.length <= max) return timeline;
    const step = timeline.length / max;
    const out = [];
    for (let i = 0; i < max; i++) out.push(timeline[Math.floor(i * step)]);
    out.push(timeline[timeline.length - 1]);
    return out;
  }

  /* ── Narrative ──────────────────────────────────────────────────────────── */
  function outcomeLabel(o, R) {
    return {
      attackerObjective: `${R.attacker.name} achieving its objective`,
      defenderCollapse: `the collapse of ${R.defender.name}'s defence`,
      attackerCollapse: `${R.attacker.name} abandoning the war`,
      stalemate: "an unresolved stalemate",
      pyrrhic: "a military victory the attacker cannot hold",
      nuclear: "nuclear use",
    }[o] || o;
  }

  function narrative(R, aN, bN) {
    const t = R.medianRun.timeline, run = R.medianRun, D = R.derived;
    const s = panel("What actually happens", null);
    const ph = [];
    // By elapsed month, not by array position — the timeline is weekly now.
    const at = (m) => t.find((x) => x.month >= m) || t[t.length - 1];

    const m1 = at(1);
    ph.push(["Days 1–30",
      `${R.opts.surprise ? "<b>Strategic surprise achieved.</b> " : ""}Opening strikes and the fight for the sky. ` +
      `${R.attacker.name} holds <b>${pct(m1.airControlA * 100)}</b> of the air. ` +
      (R.attacker.cyb > R.defender.cyb + 10 ? `Cyber and electronic attack degrade ${R.defender.name}'s networks in the first weeks. ` : "") +
      (D.needsAmphib ? `The theatre is across water: ${R.attacker.name} must fight its way in with a lift capacity of about <b>${num(R.profiles.a.lift, 0)}k troops per month</b>, and only in proportion to the sea control it wins. ` : "") +
      `Ground forces engage at a force ratio of <b>${m1.forceRatio.toFixed(2)} : 1</b> against a defender multiplier of ${D.defenderEdge.toFixed(2)}× from terrain and prepared positions.`]);

    if (run.months >= 2) {
      const m3 = at(Math.min(4, run.months));
      ph.push([`Months 2–${Math.min(6, Math.ceil(run.months))}`,
        `Air control ${m3.airControlA > m1.airControlA ? "consolidates" : "slips"} to <b>${pct(m3.airControlA * 100)}</b>. ` +
        `${R.defender.name} holds <b>${pct(m3.territoryB * 100)}</b> of its territory. ` +
        `Combined military dead pass <b>${people((m3.casA + m3.casB) * 1000)}</b>. ` +
        (run.coalition.a.length || run.coalition.b.length
          ? `Alliance entry in this run: ${allyText(run.coalition, R)}. `
          : "Neither side's partners enter. ")]);
    }

    if (run.months >= 8) {
      const mid = at(run.months / 2);
      ph.push([`Month ${Math.ceil(mid.month)}`,
        `The war has become a contest of replacement rates. ${R.attacker.name} regenerates <b>${pct(R.profiles.a.sust.replacement * 100, 1)}</b> of committed force per month against ${R.defender.name}'s <b>${pct(R.profiles.b.sust.replacement * 100, 1)}</b>. ` +
        `Political will stands at <b>${pct(mid.willA * 100)}</b> and <b>${pct(mid.willB * 100)}</b>. ` +
        (R.defender.oilSelfSufficiency < 0.8 && R.defender.coast > 400
          ? `${R.defender.name} imports most of its fuel, and the blockade is starting to tell. ` : "")]);
    }

    const last = t[t.length - 1];
    let end = `<b>${cap(outcomeLabel(run.outcome, R))}.</b> ` +
      `${R.defender.name} ends holding <b>${pct(last.territoryB * 100)}</b> of its territory. ` +
      `Military dead: <b>${people(run.casualtiesA)}</b> and <b>${people(run.casualtiesB)}</b>. `;
    if (run.occupation) {
      end += run.occupation.sustainable
        ? `Occupation is feasible: <b>${num(run.occupation.needed / 1000, 1)}M</b> troops needed, ${num(run.occupation.available / 1000, 1)}M available. `
        : `<b>The occupation fails.</b> Holding the ground needs <b>${num(run.occupation.needed / 1000, 1)}M</b> troops; ${R.attacker.name} has ${num(run.occupation.available / 1000, 1)}M left. An insurgency of intensity ${pct(run.occupation.intensity * 100)} follows the conventional victory. `;
    }
    if (run.nuclear) {
      const by = BY_ID[run.nuclear.by];
      end = `<b>☢ ${by.name} uses nuclear weapons in month ${run.nuclear.month}.</b> ` +
        `Doctrine: ${by.doctrine.label}. ` +
        (run.nuclear.exchange ? "The other side retaliates. " : "There is no retaliation in kind. ") +
        `Prompt fatalities on the order of <b>${people(run.nuclear.deathsA * 1e6)}</b> and <b>${people(run.nuclear.deathsB * 1e6)}</b>. There is no winner.`;
    }
    ph.push([`Month ${Math.ceil(last.month)} — end`, end]);

    const ul = document.createElement("ul");
    ul.className = "phases";
    ul.innerHTML = ph.map(([w, t]) => `<li><div class="when">${w}</div><div class="what">${t}</div></li>`).join("");
    s.appendChild(ul);
    return s;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function allyText(co, R) {
    const f = (ids) => ids.map((i) => BY_ID[i].flag).join(" ");
    const parts = [];
    if (co.a.length) parts.push(`${co.a.length} join ${R.attacker.name} (${f(co.a)})`);
    if (co.b.length) parts.push(`${co.b.length} join ${R.defender.name} (${f(co.b)})`);
    return parts.join("; ");
  }

  /* ── Nuclear ────────────────────────────────────────────────────────────── */
  function nuclearPanel(R, aN, bN) {
    const s = panel("Nuclear assessment",
      R.opts.nuclearAllowed
        ? "Escalation is checked every month against each nuclear state's doctrinal threshold, driven by how close that state is to losing its territory, its army, or its government."
        : "Escalation is switched off in this scenario. The conventional result below is therefore a fiction wherever a nuclear state faces defeat.");

    const rows = [R.attacker, R.defender].filter((c) => c.nuke > 0).map((c) => [
      c.flag + " " + c.name,
      num(c.nuke), num(c.dep || 0),
      ["—", "single leg", "dyad", "full triad"][c.triad],
      c.doctrine ? c.doctrine.label : "—",
    ]);

    const t = document.createElement("table");
    t.innerHTML =
      `<thead><tr><th>State</th><th>Stockpile</th><th>Deployed</th><th>Delivery</th><th>Declared doctrine</th></tr></thead>
       <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
    s.appendChild(t);

    const g = document.createElement("div");
    g.className = "tiles";
    g.style.marginTop = "18px";
    const risk = R.nuclearRisk;
    g.innerHTML =
      `<div class="tile${risk >= 5 ? " crit" : ""}">
         <div class="k">☢ Probability of nuclear use</div>
         <div class="v">${pct(risk, 1)}</div>
         <div class="s">${risk < 1 ? "negligible in this scenario" : risk < 10 ? "present but not dominant" : risk < 35 ? "a first-order consideration" : "the defining feature of this war"}</div>
       </div>` +
      (R.medianRun.nuclear
        ? `<div class="tile crit"><div class="k">First use in median run</div><div class="v">${BY_ID[R.medianRun.nuclear.by].flag} m${R.medianRun.nuclear.month}</div><div class="s">${R.medianRun.nuclear.exchange ? "retaliation follows" : "no retaliation in kind"}</div></div>`
        : `<div class="tile"><div class="k">Median run</div><div class="v">Conventional</div><div class="s">no nuclear use in the representative run</div></div>`);
    s.appendChild(g);
    return s;
  }

  /* ── Sensitivity ────────────────────────────────────────────────────────── */
  function sensitivity(R) {
    const s = panel("What would change the answer",
      "The same matchup re-fought with one assumption altered at a time (500 runs each). Large swings mark the assumptions worth arguing about.");

    const base = R.probability.attacker;
    const variants = [
      { label: "No alliances enter", o: { allies: false } },
      { label: "Attacker achieves surprise", o: { surprise: !R.opts.surprise } },
      { label: "Defender fully mobilised", o: { mobilizationB: "full" } },
      { label: "Attacker fully mobilised", o: { mobilizationA: "full" } },
      { label: "Population welcomes the attacker", o: { localSupport: 0.85 } },
      { label: "Population resists the attacker", o: { localSupport: 0.05 } },
      { label: "Foreign materiel support to defender", o: { support: "b" } },
      { label: "Foreign materiel support to attacker", o: { support: "a" } },
      { label: "War of total conquest", o: { warAim: "conquest" } },
      { label: "Punitive air campaign only", o: { warAim: "punitive" } },
    ];

    const rows = variants.map((v) => {
      const r = M.simulate(R.attacker.id, R.defender.id,
        { ...R.opts, ...v.o, iterations: 500, seed: 991 });
      const d = r.probability.attacker - base;
      return [
        v.label,
        pct(r.probability.attacker, 1),
        (d >= 0 ? "+" : "") + d.toFixed(1) + " pts",
        pct(r.nuclearRisk, 1),
        duration(r.expected.months),
      ];
    });

    const t = document.createElement("table");
    t.innerHTML =
      `<thead><tr><th>Assumption changed</th><th>${R.attacker.flag} win probability</th><th>Δ vs baseline</th><th>☢ risk</th><th>Duration</th></tr></thead>
       <tbody><tr><td><b>Baseline as configured</b></td><td class="a">${pct(base, 1)}</td><td>—</td><td>${pct(R.nuclearRisk, 1)}</td><td>${duration(R.expected.months)}</td></tr>` +
      rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") + `</tbody>`;
    s.appendChild(t);
    return s;
  }

  /* ── Show your work ─────────────────────────────────────────────────────── */
  function showWork(R, aN, bN) {
    const s = panel("Show your work",
      "Every intermediate the model computed for this matchup. If a number below looks wrong, the verdict above is wrong too.");
    const a = R.derived.a, b = R.derived.b, D = R.derived;

    const block = (title, body) => {
      const d = document.createElement("details");
      d.innerHTML = `<summary>${title}</summary><div class="body">${body}</div>`;
      return d;
    };

    const qualTable = (side, c, name) => `
      <table><thead><tr><th>Multiplier</th><th>Input</th><th>Value</th></tr></thead><tbody>
        <tr><td>Technology (tech/60)^1.25</td><td>${c.tech}</td><td>${side.quality.toFixed(3)}×</td></tr>
        <tr><td>Training 0.45+0.55·(trn/100)</td><td>${c.trn}</td><td>${side.training.toFixed(3)}×</td></tr>
        <tr><td>Combat experience</td><td>${c.exp}</td><td>${side.experience.toFixed(3)}×</td></tr>
        <tr><td>ISR / networking (C4ISR)</td><td>${c.c4}</td><td>${side.c4.toFixed(3)}×</td></tr>
        <tr><td><b>Compounded</b></td><td>—</td><td><b>${(side.quality * side.training * side.experience * side.c4).toFixed(3)}×</b></td></tr>
      </tbody></table>`;

    s.appendChild(block("Force quality multipliers", `
      <p class="note">These compound. A poorly trained army with obsolete equipment and no ISR is not marginally worse than a modern one — it is several times worse, which is why raw platform counts mislead so badly.</p>
      <h4 style="color:var(--attacker);font-size:13px;margin:16px 0 6px">${esc(aN)}</h4>${qualTable(a, R.attacker)}
      <h4 style="color:var(--defender);font-size:13px;margin:20px 0 6px">${esc(bN)}</h4>${qualTable(b, R.defender)}`));

    s.appendChild(block("Distance, projection and how much force arrives", `
      <div class="formula">distance          = <b>${num(D.distance)} km</b> (great circle)
shared border     = <b>${D.adjacent ? "yes" : "no"}</b>
reach(c)          = 350 + 55 · projectionIndex^0.95
deployFraction(d) = 1 / (1 + (d / reach)²)</div>
      <table><thead><tr><th></th><th>${esc(aN)}</th><th>${esc(bN)}</th></tr></thead><tbody>
        <tr><td>Projection index</td><td class="a">${a.projection.index.toFixed(1)}</td><td class="b">${b.projection.index.toFixed(1)}</td></tr>
        <tr><td>Reach (50% of force)</td><td class="a">${num(a.projection.reach)} km</td><td class="b">${num(b.projection.reach)} km</td></tr>
        <tr><td>War aim commitment cap</td><td class="a">${pct(D.aim.commit * 100)}</td><td class="b">—</td></tr>
        <tr><td><b>Force actually committed</b></td><td class="a"><b>${pct(a.deployFraction * 100, 1)}</b></td><td class="b"><b>${pct(b.deployFraction * 100, 1)}</b></td></tr>
      </tbody></table>
      <p class="note">The defender is already there, so its fraction is a garrison discount rather than a projection problem. ${D.needsAmphib ? `<strong>This is an opposed crossing.</strong> The attacker's ground force is additionally capped by amphibious lift of about ${num(R.profiles.a.lift, 0)}k troops per month, multiplied by sea control raised to the power 1.6 — contested seas collapse it fast.` : ""}</p>`));

    s.appendChild(block("Defensive advantage", `
      <div class="formula">terrainMultiplier = 1 + 0.7 · (terrain / 100)   → <b>${D.terrainMult.toFixed(3)}×</b>
defenderEdge      = 1.45 · terrainMultiplier${R.opts.warAim === "conquest" ? " · 1.08" : ""}  → <b>${D.defenderEdge.toFixed(3)}×</b></div>
      <p class="note">${R.defender.name}'s terrain index is <strong>${R.defender.terrain}/100</strong>. The 1.45 base is the conventional planning assumption that an attacker needs roughly half again the defender's strength at the point of contact; terrain, prepared positions and interior lines push it up from there.</p>`));

    s.appendChild(block("Sustainment and replacement", `
      <table><thead><tr><th>Component</th><th>${esc(aN)}</th><th>${esc(bN)}</th></tr></thead><tbody>
        <tr><td>Fuel self-sufficiency</td><td class="a">${a.sustainment.fuel.toFixed(2)}</td><td class="b">${b.sustainment.fuel.toFixed(2)}</td></tr>
        <tr><td>Refining vs consumption</td><td class="a">${a.sustainment.refining.toFixed(2)}</td><td class="b">${b.sustainment.refining.toFixed(2)}</td></tr>
        <tr><td>Internal transport</td><td class="a">${a.sustainment.transport.toFixed(2)}</td><td class="b">${b.sustainment.transport.toFixed(2)}</td></tr>
        <tr><td>Arms industry</td><td class="a">${a.sustainment.industry.toFixed(2)}</td><td class="b">${b.sustainment.industry.toFixed(2)}</td></tr>
        <tr><td>Steel output</td><td class="a">${a.sustainment.steel.toFixed(2)}</td><td class="b">${b.sustainment.steel.toFixed(2)}</td></tr>
        <tr><td>Budget (PPP-adjusted)</td><td class="a">${a.sustainment.money.toFixed(2)}</td><td class="b">${b.sustainment.money.toFixed(2)}</td></tr>
        <tr><td><b>Monthly replacement rate</b></td><td class="a"><b>${pct(a.sustainment.replacement * 100, 2)}</b></td><td class="b"><b>${pct(b.sustainment.replacement * 100, 2)}</b></td></tr>
      </tbody></table>
      <p class="note">Replacement rate is the share of committed force regenerated each month. In a long war it matters more than the starting inventory — this is the term that decides attritional conflicts. Military budgets are PPP-adjusted because a dollar of Russian or Chinese defence spending buys considerably more domestic output than a dollar of American.</p>`));

    s.appendChild(block("Political will and casualty tolerance", `
      <div class="formula">base       = (morale·0.6 + stability·0.4) / 100 ${"  "}(+0.28 defending home soil)
tolerance  = 0.004 + 0.052 · base^1.6   → share of fit-for-service pool</div>
      <table><thead><tr><th></th><th>${esc(aN)}</th><th>${esc(bN)}</th></tr></thead><tbody>
        <tr><td>Will base</td><td class="a">${a.will.base.toFixed(3)}</td><td class="b">${b.will.base.toFixed(3)}</td></tr>
        <tr><td>Casualty tolerance</td><td class="a">${pct(a.will.tolerance * 100, 2)}</td><td class="b">${pct(b.will.tolerance * 100, 2)}</td></tr>
        <tr><td>Fit-for-service pool</td><td class="a">${R.attacker.fit.toFixed(1)}M</td><td class="b">${R.defender.fit.toFixed(1)}M</td></tr>
        <tr><td><b>Dead before will collapses</b></td><td class="a"><b>${people(R.attacker.fit * 1e6 * a.will.tolerance)}</b></td><td class="b"><b>${people(R.defender.fit * 1e6 * b.will.tolerance)}</b></td></tr>
      </tbody></table>
      <p class="note">Defending your own territory adds 0.28 to the will base — the single largest intangible in the model, and the one with the strongest historical support. A war of conquest fought far from home is additionally discounted by 18%: it is the easiest kind of war for a society to walk away from.</p>`));

    s.appendChild(block("Magazines: shells, precision munitions and interceptors", `
      <p class="note">The constraint that decides most modern wars and appears in none of the headline force comparisons. Artillery consumes roughly 0.30 thousand rounds per thousand engaged troops per month at full intensity; precision munitions are the first thing an air campaign exhausts and the slowest to replace; and an integrated air defence with an empty magazine is scrap metal, which is exactly what cheap drones are for.</p>
      <table><thead><tr><th>Magazine</th><th>${esc(aN)}</th><th>${esc(bN)}</th></tr></thead><tbody>
        <tr><td>Artillery stock at outbreak</td><td class="a">${num(R.attacker.shellStock)}k rounds</td><td class="b">${num(R.defender.shellStock)}k rounds</td></tr>
        <tr><td>Artillery production</td><td class="a">${num(R.attacker.shellProd)}k / month</td><td class="b">${num(R.defender.shellProd)}k / month</td></tr>
        <tr><td>Precision munitions (0–100)</td><td class="a">${num(R.attacker.pgmStock)}</td><td class="b">${num(R.defender.pgmStock)}</td></tr>
        <tr><td>…replaced per month</td><td class="a">${pct(R.attacker.pgmProd * 100, 1)}</td><td class="b">${pct(R.defender.pgmProd * 100, 1)}</td></tr>
        <tr><td>Interceptors (0–100)</td><td class="a">${num(R.attacker.intStock)}</td><td class="b">${num(R.defender.intStock)}</td></tr>
        <tr><td>Attritable drone output (0–100)</td><td class="a">${num(R.attacker.droneProd)}</td><td class="b">${num(R.defender.droneProd)}</td></tr>
        <tr><td><b>Runs ending with shells dry</b></td><td class="a"><b>${pct(R.magazines.shellsDryA, 1)}</b></td><td class="b"><b>${pct(R.magazines.shellsDryB, 1)}</b></td></tr>
        <tr><td><b>Runs ending with SAMs dry</b></td><td class="a">—</td><td class="b"><b>${pct(R.magazines.interceptorsDryB, 1)}</b></td></tr>
      </tbody></table>`));

    s.appendChild(block("Theatre geometry and force-to-space", `
      <div class="formula">front width   ≈ <b>${num(D.frontKm)} km</b>
density       = engaged defenders / front width
lineIntegrity = (density − 0.12) / 0.55        → <b>${num(R.medianRun.timeline.length ? R.medianRun.timeline[R.medianRun.timeline.length - 1].lineIntegrity : 0, 2)}</b>
maxAdvance    = 0.030 + 0.34 · manoeuvre²      → <b>${pct((0.030 + 0.34 * Math.pow(R.medianRun.manoeuvre, 2)) * 100, 1)} of the country per month</b></div>
      <p class="note">The same force ratio produces breakthrough on an empty front and deadlock on a full one. Above roughly <strong>0.7 thousand defenders per kilometre</strong> a continuous, mutually supporting line exists and there are no flanks to turn; below about <strong>0.12</strong> the front is a screen with holes in it and armies move at the speed of their fuel trucks. This is the difference between 1916 and 1940 at similar odds, and it is why the flat advance ceiling an earlier version of this model used compressed every campaign into the same duration.</p>
      <p class="note">Defensive terrain is <strong>${R.defender.terrain}/100</strong> and urbanisation <strong>${R.defender.urban}%</strong>, giving a maximum urban drag of ${D.urbanDragMax.toFixed(2)}× as the attacker pushes into the built-up areas where the population — and therefore the objectives — are.</p>`));

    s.appendChild(block("Mobilisation, equipment and closure", `
      <p class="note">Reserves do not appear on day one. They are called up, trained, and — the binding constraint almost everywhere — equipped from whatever is in storage. A country with three million reservists and equipment for four hundred thousand fields an army the size of its equipment park.</p>
      <table><thead><tr><th></th><th>${esc(aN)}</th><th>${esc(bN)}</th></tr></thead><tbody>
        <tr><td>Active</td><td class="a">${num(R.attacker.act * 1000)}</td><td class="b">${num(R.defender.act * 1000)}</td></tr>
        <tr><td>Reserve pool called</td><td class="a">${num(D.mobilisation.a.pool * 1000)}</td><td class="b">${num(D.mobilisation.b.pool * 1000)}</td></tr>
        <tr><td>Call-up rate</td><td class="a">${pct(D.mobilisation.a.rate * 100, 1)} / month</td><td class="b">${pct(D.mobilisation.b.rate * 100, 1)} / month</td></tr>
        <tr><td>Stored equipment (× active)</td><td class="a">${D.mobilisation.a.store.toFixed(2)}</td><td class="b">${D.mobilisation.b.store.toFixed(2)}</td></tr>
        <tr><td><b>Ceiling on troops that can be armed</b></td><td class="a"><b>${num(D.mobilisation.a.equipCap * 1000)}</b></td><td class="b"><b>${num(D.mobilisation.b.equipCap * 1000)}</b></td></tr>
        <tr><td>Peak force actually fielded</td><td class="a">${num(R.medianRun.peakMobA * 1000)}</td><td class="b">${num(R.medianRun.peakMobB * 1000)}</td></tr>
        <tr><td>Theatre closure rate</td><td class="a">${pct(D.closure.a * 100)} / month</td><td class="b">${pct(D.closure.b * 100)} / month</td></tr>
        <tr><td>Other frontiers to cover</td><td class="a">−${pct(D.multiFront.a * 100, 1)}</td><td class="b">−${pct(D.multiFront.b * 100, 1)}</td></tr>
      </tbody></table>
      <p class="note">Force closes on a theatre over months rather than appearing in it: Desert Shield took six before Desert Storm. Every frontier a country is <em>not</em> fighting on still has to be covered, weighted by what the neighbour on it could actually do — a border with Moldova costs nothing, a border with China costs a great deal.</p>`));

    s.appendChild(block("Season and weather", `
      <p class="note">The theatre takes the defender's climate: <strong>${D.season.climate}</strong>. The war begins in <strong>${MONTH_NAMES[D.season.start]}</strong>. Tempo multipliers by calendar month:</p>
      <div class="formula">${MONTH_NAMES.map((m, i) =>
        (i === D.season.start ? "▸" : " ") + m.slice(0, 3) + " " +
        D.season.profile[i].toFixed(2)).join("   ")}</div>
      <p class="note">The spring and autumn thaw has stopped more offensives in eastern Europe than any army has; the monsoon does the same job in South and Southeast Asia; desert summer blunts everything. Tempo scales the rate of advance, amphibious throughput and sortie generation.</p>`));

    if (D.chokepoints.onA.length || D.chokepoints.onB.length) {
      s.appendChild(block("Maritime chokepoints", `
        <p class="note">A handful of straits gate most naval movement and seaborne trade. A defender holding one can throttle an approach before a shot is fired; an attacker holding one can strangle the defender's imports.</p>
        <table><thead><tr><th>Strait</th><th>Held by</th><th>Effect</th></tr></thead><tbody>
          ${D.chokepoints.onA.map((k) => `<tr><td>${k.name}</td><td class="b">${esc(R.defender.name)}</td><td>throttles ${esc(R.attacker.name)}'s approach</td></tr>`).join("")}
          ${D.chokepoints.onB.map((k) => `<tr><td>${k.name}</td><td class="a">${esc(R.attacker.name)}</td><td>tightens the blockade on ${esc(R.defender.name)}</td></tr>`).join("")}
        </tbody></table>`));
    }

    s.appendChild(block("Two wills: society and regime", `
      <p class="note">A society's capacity to absorb loss and a regime's willingness to keep spending it are different things, and conflating them was this model's one diagnosed structural failure — any single setting that let the Iran–Iraq War run eight years also made every short decisive war too long. Society exhausts on casualties; the regime decides; how much of the first reaches the second is set by how far the government depends on consent.</p>
      <div class="formula">transmission = 0.16 + 0.84 · (openness / 100)^0.85</div>
      <table><thead><tr><th></th><th>${esc(aN)}</th><th>${esc(bN)}</th></tr></thead><tbody>
        <tr><td>Openness (dependence on consent)</td><td class="a">${num(a.openness)}</td><td class="b">${num(b.openness)}</td></tr>
        <tr><td>Exhaustion reaching the decision</td><td class="a">${pct(a.will.transmission * 100)}</td><td class="b">${pct(b.will.transmission * 100)}</td></tr>
        <tr><td>Casualty tolerance</td><td class="a">${pct(a.will.tolerance * 100, 2)}</td><td class="b">${pct(b.will.tolerance * 100, 2)}</td></tr>
        <tr><td><b>Casualties before society is spent</b></td><td class="a"><b>${people(R.attacker.fit * 1e6 * a.will.tolerance)}</b></td><td class="b"><b>${people(R.defender.fit * 1e6 * b.will.tolerance)}</b></td></tr>
      </tbody></table>
      <p class="note">An accountable government has to stop when its population has had enough. A coercive one does not, which is why Iran and Iraq could spend eight years and something over a million casualties on a war neither population chose. Local support of <strong>${pct(D.localSupport * 100)}</strong> also cuts the garrison the attacker must leave behind by ${pct(D.localSupport * 90)} — India did not have to occupy East Pakistan in 1971, it handed the territory to a government the population had just voted for.</p>`));

    s.appendChild(block("Occupation arithmetic", `
      <div class="formula">troops needed = population × 20 per 1,000 inhabitants
              = ${R.defender.pop.toFixed(0)}M × 20  →  <b>${num(D.occupationNeed / 1000, 2)}M troops</b></div>
      <p class="note">The counter-insurgency force ratio that keeps being rediscovered — Malaya, Northern Ireland, Bosnia, Iraq. ${R.attacker.name}'s total mobilisable pool is roughly ${num((R.attacker.act + R.attacker.res) / 1000, 2)}M. A war aim of ${D.aim.label.toLowerCase()} ${D.aim.occupy ? "requires holding the ground afterwards, so this test applies." : "does not require holding ground, so this test is skipped."}</p>`));

    return s;
  }

  /* ── Raw comparison ─────────────────────────────────────────────────────── */
  function comparison(R, aN, bN) {
    const A = R.attacker, B = R.defender;
    const s = panel("The two countries, side by side",
      "The underlying data, unweighted. Everything above is derived from these numbers.");

    const sec = (t) => ({ section: t });
    const row = (label, key, fmt = (v) => num(v)) => ({ label, a: fmt(A[key]), b: fmt(B[key]), raw: [A[key], B[key]] });

    const rows = [
      sec("Economy & population"),
      row("Population", "pop", (v) => v.toFixed(1) + "M"),
      row("Fit for military service", "fit", (v) => v.toFixed(1) + "M"),
      row("GDP (nominal)", "gdp", (v) => money(v)),
      row("GDP (PPP)", "ppp", (v) => money(v)),
      row("Military spending", "bud", (v) => money(v)),
      row("Military spending (PPP)", "budPpp", (v) => money(v)),
      { label: "Spending as % of GDP", a: pct(A.burden, 1), b: pct(B.burden, 1), raw: [A.burden, B.burden] },
      sec("Manpower"),
      row("Active personnel", "act", (v) => num(v * 1000)),
      row("Reserves", "res", (v) => num(v * 1000)),
      row("Paramilitary", "par", (v) => num(v * 1000)),
      sec("Land forces"),
      ...["tank", "afv", "spg", "tow", "mlrs"].map((k) => row(PLATFORM_LABELS[k], k)),
      sec("Air forces"),
      ...["ftr", "atk", "tkr", "awacs", "tpt", "heli", "ahel", "uav"].map((k) => row(PLATFORM_LABELS[k], k)),
      sec("Naval forces"),
      ...["cv", "lhd", "dd", "ff", "fs", "ss", "pat"].map((k) => row(PLATFORM_LABELS[k], k)),
      row("Fleet tonnage", "ton", (v) => num(v * 1000) + " t"),
      sec("Strategic"),
      row("Nuclear warheads", "nuke"),
      row("Deployed warheads", "dep"),
      { label: "Delivery legs", a: ["—", "1", "2", "3 (triad)"][A.triad], b: ["—", "1", "2", "3 (triad)"][B.triad], raw: [A.triad, B.triad] },
      sec("Logistics & industry"),
      row("Oil production", "oilp", (v) => num(v * 1000) + " bbl/d"),
      row("Oil consumption", "oilc", (v) => num(v * 1000) + " bbl/d"),
      { label: "Oil self-sufficiency", a: pct(A.oilSelfSufficiency * 100), b: pct(B.oilSelfSufficiency * 100), raw: [A.oilSelfSufficiency, B.oilSelfSufficiency] },
      row("Crude steel output", "steel", (v) => v.toFixed(1) + " Mt/yr"),
      row("Merchant vessels", "mm"),
      row("Railway", "rail", (v) => num(v * 1000) + " km"),
      row("Overseas bases", "bases"),
      sec("Qualitative indices (0–100, analyst estimates)"),
      row("Technology level", "tech"),
      row("Training & readiness", "trn"),
      row("Recent combat experience", "exp"),
      row("C4ISR", "c4"),
      row("Air defence", "ad"),
      row("Cyber capability", "cyb"),
      row("Expeditionary logistics", "log"),
      row("Morale / political will", "mor"),
      row("Government stability", "stab"),
      row("Defensive terrain", "terrain"),
    ];

    const t = document.createElement("table");
    t.innerHTML =
      `<thead><tr><th>Metric</th><th style="color:var(--attacker)">${esc(aN)}</th><th style="color:var(--defender)">${esc(bN)}</th></tr></thead><tbody>` +
      rows.map((r) => r.section
        ? `<tr class="section-row"><td colspan="3">${r.section}</td></tr>`
        : `<tr><td>${r.label}</td><td class="${r.raw[0] > r.raw[1] ? "a" : ""}">${r.a}</td><td class="${r.raw[1] > r.raw[0] ? "b" : ""}">${r.b}</td></tr>`
      ).join("") + "</tbody>";

    const box = document.createElement("div");
    box.className = "chart-scroll";
    box.appendChild(t);
    s.appendChild(box);
    return s;
  }

  /* ── Table toggle for a chart ───────────────────────────────────────────── */
  function tableToggle(headers, rows) {
    const wrap = document.createElement("div");
    const btn = document.createElement("button");
    btn.className = "btn-sm";
    btn.type = "button";
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = "Show as table";
    const box = document.createElement("div");
    box.className = "chart-scroll hidden";
    box.style.marginTop = "12px";
    box.appendChild(window.WarCharts.tableView(headers, rows));
    btn.addEventListener("click", () => {
      const on = box.classList.toggle("hidden");
      btn.setAttribute("aria-pressed", String(!on));
      btn.textContent = on ? "Show as table" : "Hide table";
    });
    wrap.append(btn, box);
    wrap.style.marginBottom = "20px";
    return wrap;
  }


  /* ── Backtest ─────────────────────────────────────────────────────────────
   * The model's own scorecard. Runs on demand because nine wars at several
   * hundred iterations each takes a few seconds.
   */
  function backtestPanel() {
    const s = panel("Does this model actually work?",
      "Nine conflicts with known outcomes, period-accurate force data, and exactly the same simulation the report above uses. Where the model is wrong, this says so.");

    const btn = document.createElement("button");
    btn.className = "run";
    btn.type = "button";
    btn.style.marginTop = "0";
    btn.textContent = "Run the historical backtest";
    const box = document.createElement("div");
    s.append(btn, box);

    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Re-fighting nine wars…";
      setTimeout(() => {
        const rows = window.WarBacktest.run(500);
        const sum = window.WarBacktest.summary(rows);
        const tick = (ok) => ok
          ? '<span style="color:var(--good)">✓</span>'
          : '<span style="color:var(--critical)">✗</span>';

        const tiles = document.createElement("div");
        tiles.className = "tiles";
        tiles.style.margin = "18px 0";
        tiles.innerHTML = [
          { k: "Outcome called correctly", v: `${sum.outcomes} / ${sum.n}`, s: "attacker wins, defender holds, or stalemate" },
          { k: "Duration within 3×", v: `${sum.durations} / ${sum.n}`, s: "the model works in whole months" },
          { k: "Casualties within 4×", v: `${sum.casualties} / ${sum.n}`, s: "several of these are disputed by a factor of two" },
          { k: "Probability on the truth", v: pct(sum.meanMass), s: "mean mass the model put on what happened" },
        ].map((i) => `<div class="tile"><div class="k">${i.k}</div><div class="v">${i.v}</div><div class="s">${i.s}</div></div>`).join("");

        const t = document.createElement("table");
        t.innerHTML =
          `<thead><tr><th>War</th><th>Model says</th><th>Actually</th><th>Prob.</th>
            <th>Months</th><th>Attacker dead</th><th>Defender dead</th><th>✓</th></tr></thead><tbody>` +
          rows.map((r) => {
            const c = r.case, k = r.score;
            return `<tr>
              <td>${esc(c.name)} <span style="color:var(--text-muted)">${esc(c.when)}</span></td>
              <td>${k.predicted}</td><td>${k.actualOutcome}</td>
              <td>${pct(k.mass)}</td>
              <td>${k.months.toFixed(1)} <span style="color:var(--text-muted)">(${c.actual.months})</span></td>
              <td>${people(k.killedA)} <span style="color:var(--text-muted)">(${people(c.actual.killedA)})</span></td>
              <td>${people(k.killedB)} <span style="color:var(--text-muted)">(${people(c.actual.killedB)})</span></td>
              <td>${tick(k.outcomeOk)}${tick(k.durationOk)}${tick(k.casualtiesOk)}</td>
            </tr>` +
            `<tr><td colspan="8" style="border-bottom-color:var(--axis);color:var(--text-muted);font-size:12.5px;padding-top:0">
              ${esc(c.blurb)} ${c.note ? "<em>" + esc(c.note) + "</em>" : ""}</td></tr>`;
          }).join("") + "</tbody>";

        const note = document.createElement("p");
        note.className = "note";
        note.style.maxWidth = "80ch";
        note.innerHTML =
          "<strong>What the failures are telling you.</strong> The model calls the <em>outcome</em> of most of these wars and is poor at how long they take and how many they kill. The error is systematic and in one direction: short decisive campaigns run far too long, and because casualties accumulate per week, the casualty counts inherit that error. The mechanism has not been identified — supply culmination and garrison drag were both investigated and neither was the cause. " +
          "<br><br>Six of these fifteen are held back from the coefficient fitter and scored separately, and the split is stratified by duration after a first attempt accidentally put almost every short war on one side. " +
          "<strong>Fitting the twelve free coefficients does not help.</strong> Bounded to physically defensible ranges and regularised toward their priors, the search reliably improves the fitting score by 12–17% and makes the held-out score 6–12% <em>worse</em>, across four different configurations. The remaining error is structural, not a matter of the constants, so the hand-set values are what ships. That negative result is the most useful thing this backtest has produced.";

        box.innerHTML = "";
        box.append(tiles, t, note);
        wrapTables(box);
        btn.textContent = "Re-run the backtest";
        btn.disabled = false;
      }, 30);
    });

    return s;
  }

  /* ── Caveats ────────────────────────────────────────────────────────────── */
  function caveats() {
    const s = panel("What this model cannot do", null);
    s.innerHTML += `
      <p class="note" style="max-width:80ch">
        <strong>It is a model, and wars are not.</strong> Every armed conflict of the last century turned on
        things no spreadsheet holds: a decision taken badly at 3am, an alliance that held when nobody expected
        it to, a population that would not stop fighting after its army was gone. The Monte Carlo spread here is
        an admission of that, not a measurement of it.
      </p>
      <p class="note" style="max-width:80ch">
        <strong>The inputs are estimates.</strong> Platform counts drift constantly and several states publish
        nothing reliable. The 0–100 indices — technology, training, experience, C4ISR, morale, stability — are
        analyst judgement calls, not measurements, and they carry a lot of weight in the result. Munitions
        stocks, mobilisation rates and equipment storage are derived from sourced figures with overrides where
        the derivation is known to be wrong. Change any of them and the answer changes.
      </p>
      <p class="note" style="max-width:80ch">
        <strong>Several constants are fitted, not derived.</strong> Casualty tolerance in particular is
        calibrated against the historical backtest below rather than measured from anything. The code says so
        where that is true.
      </p>
      <p class="note" style="max-width:80ch">
        <strong>Long attritional wars are the weakest ground.</strong> The model has one political-will
        mechanism, and any setting of it that sustains an eight-year war also makes every short decisive war
        too long. It gets the Iran–Iraq War badly wrong for exactly this reason. Run the backtest below and
        read the failures before trusting a multi-year result.
      </p>
      <p class="note" style="max-width:80ch">
        <strong>The nuclear module is deliberately crude.</strong> It exists so that the model refuses to report a
        tidy conventional victory over a nuclear-armed state facing collapse — which is the single most misleading
        thing a simulator like this can do. It is not an estimate of what a nuclear war would be like.
      </p>`;
    return s;
  }

  // Give the page something to look at on load.
  $("run").click();
})();

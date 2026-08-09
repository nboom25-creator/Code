/* =============================================================================
 * app.js — controls, and the report the model's output turns into.
 * ========================================================================== */

(function () {
  const { COUNTRIES, BY_ID, PLATFORM_LABELS } = window.WarData;
  const M = window.WarModel;
  const { tugBars, lineChart } = window.WarCharts;

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
    out.appendChild(campaign(R, aN, bN));
    out.appendChild(narrative(R, aN, bN));
    if (A.nuke || B.nuke) out.appendChild(nuclearPanel(R, aN, bN));
    out.appendChild(sensitivity(R));
    out.appendChild(showWork(R, aN, bN));
    out.appendChild(comparison(R, aN, bN));
    out.appendChild(caveats());
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
      { k: `${R.attacker.flag} military dead`, v: people(e.casualtiesA), s: `${pct((e.casualtiesA / (R.attacker.fit * 1e6)) * 100, 2)} of fit-for-service pool` },
      { k: `${R.defender.flag} military dead`, v: people(e.casualtiesB), s: `${pct((e.casualtiesB / (R.defender.fit * 1e6)) * 100, 2)} of fit-for-service pool` },
      { k: "Civilian dead", v: people(e.civA + e.civB), s: `${people(e.civB)} in ${R.defender.name}` },
      { k: "Direct cost", v: money(e.econA + e.econB), s: `${money(e.econA)} attacker / ${money(e.econB)} defender` },
      { k: `${R.defender.flag} territory lost`, v: pct(e.territoryLostB * 100), s: R.derived.aim.label + " requires " + pct(R.derived.aim.territory * 100) },
    ];
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

  /* ── Campaign timeline ──────────────────────────────────────────────────── */
  function campaign(R, aN, bN) {
    const t = R.medianRun.timeline;
    const s = panel("How the campaign runs",
      `A single representative run, month by month — not an average of incompatible trajectories. ` +
      `It ends in ${R.medianRun.months} month${R.medianRun.months === 1 ? "" : "s"} with ${outcomeLabel(R.medianRun.outcome, R)}.`);

    const mk = (title, legend, cfg, tableHead, tableRows) => {
      const head = document.createElement("div");
      head.className = "chart-head";
      head.innerHTML = `<div class="chart-title">${title}</div><div class="legend">${legend}</div>`;
      s.appendChild(head);
      const box = document.createElement("div");
      box.className = "chart-scroll";
      box.style.marginBottom = "22px";
      s.appendChild(box);
      lineChart(box, cfg);
      s.appendChild(tableToggle(tableHead, tableRows));
    };

    mk("Ground held and air control",
      `<span><i class="swatch" style="background:${C.b}"></i>${esc(bN)} territory held</span>
       <span><i class="swatch" style="background:${C.a}"></i>${esc(aN)} air control</span>`,
      {
        yMax: 1, yFmt: (v) => Math.round(v * 100) + "%",
        ariaLabel: "Defender territory held and attacker air control by month",
        series: [
          { name: R.defender.name + " territory", color: C.b, points: t.map((x) => x.territoryB) },
          { name: R.attacker.name + " air control", color: C.a, points: t.map((x) => x.airControlA) },
        ],
      },
      ["Month", R.defender.name + " territory", R.attacker.name + " air control", "Force ratio"],
      t.map((x) => [x.month, pct(x.territoryB * 100), pct(x.airControlA * 100), x.forceRatio.toFixed(2) + " : 1"]));

    mk("Political will",
      `<span><i class="swatch" style="background:${C.a}"></i>${esc(aN)}</span>
       <span><i class="swatch" style="background:${C.b}"></i>${esc(bN)}</span>`,
      {
        yMax: 1, yFmt: (v) => Math.round(v * 100) + "%", height: 200,
        ariaLabel: "Political will of each side by month",
        series: [
          { name: R.attacker.name, color: C.a, points: t.map((x) => x.willA) },
          { name: R.defender.name, color: C.b, points: t.map((x) => x.willB) },
        ],
      },
      ["Month", R.attacker.name + " will", R.defender.name + " will", R.attacker.name + " dead", R.defender.name + " dead"],
      t.map((x) => [x.month, pct(x.willA * 100), pct(x.willB * 100), people(x.casA * 1000), people(x.casB * 1000)]));

    return s;
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
    const at = (i) => t[Math.min(i, t.length - 1)];

    const m1 = at(0);
    ph.push(["Days 1–30",
      `${R.opts.surprise ? "<b>Strategic surprise achieved.</b> " : ""}Opening strikes and the fight for the sky. ` +
      `${R.attacker.name} holds <b>${pct(m1.airControlA * 100)}</b> of the air. ` +
      (R.attacker.cyb > R.defender.cyb + 10 ? `Cyber and electronic attack degrade ${R.defender.name}'s networks in the first weeks. ` : "") +
      (D.needsAmphib ? `The theatre is across water: ${R.attacker.name} must fight its way in with a lift capacity of about <b>${num(R.profiles.a.lift, 0)}k troops per month</b>, and only in proportion to the sea control it wins. ` : "") +
      `Ground forces engage at a force ratio of <b>${m1.forceRatio.toFixed(2)} : 1</b> against a defender multiplier of ${D.defenderEdge.toFixed(2)}× from terrain and prepared positions.`]);

    if (t.length >= 3) {
      const m3 = at(2);
      ph.push([`Months 2–${Math.min(6, t.length)}`,
        `Air control ${m3.airControlA > m1.airControlA ? "consolidates" : "slips"} to <b>${pct(m3.airControlA * 100)}</b>. ` +
        `${R.defender.name} holds <b>${pct(m3.territoryB * 100)}</b> of its territory. ` +
        `Combined military dead pass <b>${people((m3.casA + m3.casB) * 1000)}</b>. ` +
        (run.coalition.a.length || run.coalition.b.length
          ? `Alliance entry in this run: ${allyText(run.coalition, R)}. `
          : "Neither side's partners enter. ")]);
    }

    if (t.length >= 8) {
      const mid = at(Math.floor(t.length / 2));
      ph.push([`Month ${mid.month}`,
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
    ph.push([`Month ${last.month} — end`, end]);

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
        analyst judgement calls, not measurements, and they carry a lot of weight in the result. Change them and
        the answer changes.
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

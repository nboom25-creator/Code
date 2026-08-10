/* =============================================================================
 * charts.js — small SVG chart set. No dependencies, no CDN.
 *
 *   tugBars()      — share-of-combined-power comparisons (two sides)
 *   lineChart()    — how a quantity moved over the campaign
 *   waterfall()    — where a number came from, one multiplier per row
 *   scatter()      — one mark per simulated war, so the distribution has shape
 *   rangeBearing() — distance, reach and the straits that gate an approach
 *   frontStrip()   — Hovmoller diagram of who holds what, week by week
 *   stackedArea()  — ordered parts of one whole over time
 *   sparkRows()    — small multiples on a shared timeline
 *   endingBands()  — when the wars ended, stacked by how
 *   tornado()      — which uncertain assumption the answer rests on
 *
 * Every one ships a hover layer, and the ones carrying numbers a reader might
 * want exactly can render themselves as a table.
 *
 * On colour: the palette is validated for two series plus a critical red. Marks
 * here stay inside that. Where a chart needs more than two bands they are
 * ordered parts of a single whole and take steps of one hue, which is the
 * correct encoding for that anyway.
 * ========================================================================== */

(function () {
  const SVG = "http://www.w3.org/2000/svg";
  const el = (n, attrs = {}) => {
    const e = document.createElementNS(SVG, n);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  // One tooltip element, reused by every chart on the page.
  let tip;
  function tooltip() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tt";
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(html, x, y) {
    const t = tooltip();
    t.innerHTML = html;
    t.classList.add("on");
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 12;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top < 8) top = y + 18;
    t.style.left = left + "px";
    t.style.top = top + "px";
  }
  const hideTip = () => tooltip().classList.remove("on");

  const fmtPct = (v) => (v * 100).toFixed(0) + "%";

  /* ── Tug-of-war bars ──────────────────────────────────────────────────────
   * Each row is one domain, drawn as the two sides' share of their combined
   * strength. The ratio is direct-labelled on every row, so the reader never
   * has to estimate a length or trust the colour alone.
   */
  function tugBars(container, rows, opts = {}) {
    const {
      aName = "Attacker", bName = "Defender",
      aColor = "var(--attacker)", bColor = "var(--defender)",
    } = opts;

    const rowH = 40, labelW = 168, padR = 8, top = 8;
    const w = 760, h = top + rows.length * rowH + 4;
    const barW = w - labelW - padR;

    const svg = el("svg", {
      class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": `${aName} versus ${bName} by domain`,
    });

    // Centre reference line — parity.
    const midX = labelW + barW / 2;
    svg.appendChild(el("line", { class: "grid", x1: midX, y1: top - 4, x2: midX, y2: h - 6 }));

    rows.forEach((r, i) => {
      const y = top + i * rowH;
      const total = r.a + r.b || 1;
      const aShare = r.a / total;
      const g = el("g");

      const lbl = el("text", { class: "lbl", x: 0, y: y + 17 });
      lbl.textContent = r.label;
      g.appendChild(lbl);

      if (r.note) {
        const nt = el("text", { class: "tick", x: 0, y: y + 31 });
        nt.textContent = r.note;
        g.appendChild(nt);
      }

      const bh = 15, by = y + 5;
      // 2px surface gap between the two fills so they never touch.
      const aw = Math.max(0, aShare * barW - 1);
      const bw = Math.max(0, (1 - aShare) * barW - 1);
      g.appendChild(el("rect", { x: labelW, y: by, width: aw, height: bh, rx: 3, fill: aColor }));
      g.appendChild(el("rect", { x: labelW + aw + 2, y: by, width: bw, height: bh, rx: 3, fill: bColor }));

      // Direct label: the ratio, on the stronger side.
      const ratio = r.a >= r.b ? r.a / (r.b || 1e-9) : r.b / (r.a || 1e-9);
      const txt = el("text", {
        class: "val", y: by + 12,
        x: aShare >= 0.5 ? labelW + 8 : w - padR - 8,
        "text-anchor": aShare >= 0.5 ? "start" : "end",
        fill: "#fff", style: "font-weight:650",
      });
      txt.textContent = (ratio >= 100 ? "≥100" : ratio.toFixed(ratio < 10 ? 1 : 0)) + " : 1";
      g.appendChild(txt);

      // Hover target spans the whole row.
      const hit = el("rect", {
        x: labelW, y, width: barW, height: rowH - 6, fill: "transparent",
        style: "cursor:crosshair",
      });
      const fmt = r.fmt || ((v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }));
      hit.addEventListener("mousemove", (e) =>
        showTip(
          `<div class="tt-h">${r.label}</div>` +
          `<div class="tt-r"><span>${aName}</span><b>${fmt(r.a)}</b></div>` +
          `<div class="tt-r"><span>${bName}</span><b>${fmt(r.b)}</b></div>` +
          `<div class="tt-r"><span>Share</span><b>${fmtPct(aShare)} / ${fmtPct(1 - aShare)}</b></div>` +
          (r.note ? `<div class="tt-r" style="margin-top:5px">${r.note}</div>` : ""),
          e.clientX, e.clientY));
      hit.addEventListener("mouseleave", hideTip);
      g.appendChild(hit);

      svg.appendChild(g);
    });

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  /* ── Line chart with crosshair ────────────────────────────────────────── */
  function lineChart(container, cfg) {
    const {
      series, yMax = 1, yFmt = fmtPct, xLabel = "Month",
      yTicks = 5, height = 230,
    } = cfg;

    const padL = 46, padR = 16, padT = 12, padB = 44;
    const w = 760, h = height;
    const iw = w - padL - padR, ih = h - padT - padB;
    const n = Math.max(...series.map((s) => s.points.length));
    const xMax = Math.max(1, n);

    const X = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = (v) => padT + ih - (Math.min(v, yMax) / yMax) * ih;

    const svg = el("svg", {
      class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": cfg.ariaLabel || "Campaign timeline",
    });

    for (let t = 0; t <= yTicks; t++) {
      const v = (yMax / yTicks) * t, y = Y(v);
      svg.appendChild(el("line", { class: "grid", x1: padL, y1: y, x2: w - padR, y2: y }));
      const tx = el("text", { class: "tick", x: padL - 8, y: y + 4, "text-anchor": "end" });
      tx.textContent = yFmt(v);
      svg.appendChild(tx);
    }
    svg.appendChild(el("line", { class: "axis", x1: padL, y1: padT + ih, x2: w - padR, y2: padT + ih }));

    // X ticks — at most 8, always whole months.
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) {
      const tx = el("text", { class: "tick", x: X(i), y: padT + ih + 18, "text-anchor": "middle" });
      tx.textContent = i + 1;
      svg.appendChild(tx);
    }
    // Axis label sits on its own line below the ticks — right-aligning it on
    // the tick row collides with the final tick on short campaigns.
    const xl = el("text", { class: "tick", x: padL + iw / 2, y: h - 6, "text-anchor": "middle" });
    xl.textContent = xLabel;
    svg.appendChild(xl);

    series.forEach((s) => {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p)}`).join(" ");
      svg.appendChild(el("path", {
        d, fill: "none", stroke: s.color, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round",
      }));
      // End-of-line direct label so identity survives without the legend.
      if (s.points.length) {
        const last = s.points.length - 1;
        const t = el("text", {
          class: "val", x: Math.min(X(last) + 6, w - padR), y: Y(s.points[last]) + 4,
          "text-anchor": X(last) > w - padR - 60 ? "end" : "start", fill: s.color,
          style: "font-weight:600",
        });
        t.textContent = yFmt(s.points[last]);
        svg.appendChild(t);
      }
    });

    // Crosshair layer.
    const cross = el("line", { class: "axis", y1: padT, y2: padT + ih, stroke: "var(--text-muted)", opacity: 0 });
    svg.appendChild(cross);
    const dots = series.map((s) => {
      const c = el("circle", { r: 4, fill: s.color, stroke: "var(--surface-1)", "stroke-width": 2, opacity: 0 });
      svg.appendChild(c);
      return c;
    });

    const hit = el("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" });
    hit.addEventListener("mousemove", (e) => {
      const box = svg.getBoundingClientRect();
      const rel = ((e.clientX - box.left) / box.width) * w;
      const i = Math.max(0, Math.min(n - 1, Math.round(((rel - padL) / iw) * (n - 1))));
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 0.6);
      let rows = "";
      series.forEach((s, k) => {
        const p = s.points[i];
        if (p == null) { dots[k].setAttribute("opacity", 0); return; }
        dots[k].setAttribute("cx", X(i)); dots[k].setAttribute("cy", Y(p)); dots[k].setAttribute("opacity", 1);
        rows += `<div class="tt-r"><span>${s.name}</span><b>${yFmt(p)}</b></div>`;
      });
      showTip(`<div class="tt-h">Month ${i + 1}</div>${rows}`, e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("opacity", 0);
      dots.forEach((d) => d.setAttribute("opacity", 0));
      hideTip();
    });
    svg.appendChild(hit);

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }


  /* ── Waterfall ────────────────────────────────────────────────────────────
   * Where the force ratio actually came from. Each row is one multiplier in
   * the order the model applies it, drawn as a floating bar from the running
   * value to the new one, so the step that killed an offensive is the long bar
   * rather than a number in the fifth row of the fourth table.
   *
   * Horizontal rather than the classic vertical waterfall because the labels
   * are sentences, and rotated axis text is a tax on the reader.
   */
  function waterfall(container, cfg) {
    const { steps, threshold, thresholdLabel, aColor = "var(--attacker)",
            bColor = "var(--defender)", fmt = (v) => v.toFixed(1) } = cfg;

    const rowH = 34, labelW = 200, padR = 60, top = 10;
    const w = 760, h = top + steps.length * rowH + 34;
    const plotW = w - labelW - padR;
    const peak = Math.max(threshold || 0, ...steps.map((s) => Math.max(s.from, s.to)));
    const X = (v) => labelW + (v / (peak || 1)) * plotW;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": cfg.ariaLabel || "How the force ratio was arrived at" });

    // The defender's committed strength, as the line the attacker has to clear.
    if (threshold != null) {
      const tx = X(threshold);
      svg.appendChild(el("line", { x1: tx, y1: top - 4, x2: tx, y2: h - 30,
        stroke: bColor, "stroke-width": 2, "stroke-dasharray": "5 4" }));
      const lb = el("text", { class: "val", x: tx + 6, y: h - 18, fill: bColor,
        style: "font-weight:650" });
      lb.textContent = thresholdLabel || "defender";
      svg.appendChild(lb);
    }

    steps.forEach((s, i) => {
      const y = top + i * rowH;
      const g = el("g");
      const lbl = el("text", { class: "lbl", x: 0, y: y + 15 });
      lbl.textContent = s.label;
      g.appendChild(lbl);
      if (s.note) {
        const nt = el("text", { class: "tick", x: 0, y: y + 28 });
        nt.textContent = s.note;
        g.appendChild(nt);
      }

      const x0 = X(Math.min(s.from, s.to)), x1 = X(Math.max(s.from, s.to));
      const grew = s.to >= s.from;
      // A step that costs the attacker strength is drawn in neutral ink: it is
      // not the defender's colour, because it is not the defender doing it.
      const fill = s.base ? aColor : grew ? aColor : "var(--neutral)";
      g.appendChild(el("rect", { x: x0, y: y + 4, width: Math.max(1.5, x1 - x0),
        height: 14, rx: 3, fill, opacity: s.base ? 1 : grew ? 0.9 : 0.75 }));

      const val = el("text", { class: "val", x: Math.min(x1 + 7, w - 4), y: y + 15,
        "text-anchor": x1 > w - padR ? "end" : "start" });
      val.textContent = (s.mult != null ? "×" + s.mult.toFixed(2) + " → " : "") + fmt(s.to);
      g.appendChild(val);

      const hit = el("rect", { x: 0, y, width: w, height: rowH - 4, fill: "transparent",
        style: "cursor:crosshair" });
      hit.addEventListener("mousemove", (e) => showTip(
        `<div class="tt-h">${s.label}</div>` +
        (s.mult != null ? `<div class="tt-r"><span>Multiplier</span><b>×${s.mult.toFixed(3)}</b></div>` : "") +
        `<div class="tt-r"><span>Before</span><b>${fmt(s.from)}</b></div>` +
        `<div class="tt-r"><span>After</span><b>${fmt(s.to)}</b></div>` +
        (s.note ? `<div class="tt-r" style="margin-top:5px">${s.note}</div>` : ""),
        e.clientX, e.clientY));
      hit.addEventListener("mouseleave", hideTip);
      g.appendChild(hit);
      svg.appendChild(g);
    });

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  /* ── Monte Carlo scatter ──────────────────────────────────────────────────
   * One dot per simulated war. The stacked probability bar answers "how often
   * does the attacker win"; this answers the question underneath it — whether
   * that means reliably in four months or a coin flip between a rout and a
   * five-year grind. Small semi-transparent marks are correct for several
   * hundred overplotted points; the usual minimum mark size is a rule for
   * sparse charts.
   */
  function scatter(container, cfg) {
    const { points, xLabel = "Duration (months)", yLabel = "Military dead",
            height = 300, series } = cfg;

    const padL = 62, padR = 18, padT = 12, padB = 42;
    const w = 760, h = height, iw = w - padL - padR, ih = h - padT - padB;
    const xMax = Math.max(1, ...points.map((p) => p.x)) * 1.05;
    const yMax = Math.max(1, ...points.map((p) => p.y)) * 1.05;
    const X = (v) => padL + (v / xMax) * iw;
    const Y = (v) => padT + ih - (v / yMax) * ih;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": cfg.ariaLabel || "Every simulated war, by duration and cost" });

    for (let t = 0; t <= 4; t++) {
      const v = (yMax / 4) * t, y = Y(v);
      svg.appendChild(el("line", { class: "grid", x1: padL, y1: y, x2: w - padR, y2: y }));
      const tx = el("text", { class: "tick", x: padL - 8, y: y + 4, "text-anchor": "end" });
      tx.textContent = cfg.yFmt ? cfg.yFmt(v) : Math.round(v).toLocaleString();
      svg.appendChild(tx);
    }
    svg.appendChild(el("line", { class: "axis", x1: padL, y1: padT + ih, x2: w - padR, y2: padT + ih }));
    for (let t = 0; t <= 5; t++) {
      const v = (xMax / 5) * t;
      const tx = el("text", { class: "tick", x: X(v), y: padT + ih + 18, "text-anchor": "middle" });
      tx.textContent = v < 10 ? v.toFixed(1) : Math.round(v);
      svg.appendChild(tx);
    }
    const xl = el("text", { class: "tick", x: padL + iw / 2, y: h - 6, "text-anchor": "middle" });
    xl.textContent = xLabel;
    svg.appendChild(xl);
    const yl = el("text", { class: "tick", x: 12, y: padT + ih / 2, "text-anchor": "middle",
      transform: `rotate(-90 12 ${padT + ih / 2})` });
    yl.textContent = yLabel;
    svg.appendChild(yl);

    points.forEach((p) => {
      svg.appendChild(el("circle", { cx: X(p.x), cy: Y(p.y), r: 3.4,
        fill: p.color, opacity: 0.5 }));
    });

    // Median cross-hairs: the middle of the distribution, which the eye does
    // not reliably find in a cloud.
    const med = (arr) => {
      const a = [...arr].sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : 0;
    };
    const mx = med(points.map((p) => p.x)), my = med(points.map((p) => p.y));
    svg.appendChild(el("line", { x1: X(mx), y1: padT, x2: X(mx), y2: padT + ih,
      stroke: "var(--text-muted)", "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.7 }));
    svg.appendChild(el("line", { x1: padL, y1: Y(my), x2: w - padR, y2: Y(my),
      stroke: "var(--text-muted)", "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.7 }));
    const mlab = el("text", { class: "tick", x: X(mx) + 6, y: padT + 12 });
    mlab.textContent = "median";
    svg.appendChild(mlab);

    const dot = el("circle", { r: 6, fill: "none", stroke: "var(--text-primary)",
      "stroke-width": 2, opacity: 0 });
    svg.appendChild(dot);
    const hit = el("rect", { x: padL, y: padT, width: iw, height: ih,
      fill: "transparent", style: "cursor:crosshair" });
    hit.addEventListener("mousemove", (e) => {
      const box = svg.getBoundingClientRect();
      const rx = ((e.clientX - box.left) / box.width) * w;
      const ry = ((e.clientY - box.top) / box.height) * h;
      let best = null, bestD = 1e9;
      points.forEach((p) => {
        const d = (X(p.x) - rx) ** 2 + (Y(p.y) - ry) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      });
      if (!best || bestD > 900) { dot.setAttribute("opacity", 0); hideTip(); return; }
      dot.setAttribute("cx", X(best.x)); dot.setAttribute("cy", Y(best.y));
      dot.setAttribute("opacity", 1);
      showTip(`<div class="tt-h">${best.label}</div>` +
        `<div class="tt-r"><span>Duration</span><b>${best.x.toFixed(1)} months</b></div>` +
        `<div class="tt-r"><span>Military dead</span><b>${Math.round(best.y).toLocaleString()}</b></div>`,
        e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => { dot.setAttribute("opacity", 0); hideTip(); });
    svg.appendChild(hit);

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  /* ── Range and bearing ────────────────────────────────────────────────────
   * Deliberately not a map. The model knows two points, a great-circle
   * distance, each side's reach, and which straits gate the approach — it has
   * no coastlines and drawing some would imply knowledge it does not have.
   * An azimuthal-equidistant plot centred on the attacker shows exactly what
   * the model actually uses: true distance as radius, true bearing as angle,
   * and reach as a circle.
   */
  function rangeBearing(container, cfg) {
    const { attacker, defender, distance, reachA, reachB, chokepoints = [],
            aColor = "var(--attacker)", bColor = "var(--defender)" } = cfg;

    const w = 760, h = 420, cx = w / 2, cy = h / 2 + 6;
    const maxR = Math.min(cx, cy) - 42;
    // Scale so the further of (theatre, attacker reach) sits comfortably inside.
    const span = Math.max(distance * 1.25, reachA * 1.1, 800);
    const R = (km) => (km / span) * maxR;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label":
        `${attacker.name} to ${defender.name}: ${Math.round(distance)} km, with each side's operational reach` });

    // Range rings at readable round numbers.
    const ringStep = span > 12000 ? 4000 : span > 6000 ? 2000 : span > 2500 ? 1000 : 400;
    for (let km = ringStep; km <= span; km += ringStep) {
      svg.appendChild(el("circle", { cx, cy, r: R(km), fill: "none", class: "grid" }));
      const t = el("text", { class: "tick", x: cx + 4, y: cy - R(km) + 12 });
      t.textContent = km >= 1000 ? km / 1000 + "k km" : km + " km";
      svg.appendChild(t);
    }

    // The attacker's reach: the distance at which half its force still arrives.
    svg.appendChild(el("circle", { cx, cy, r: R(reachA), fill: aColor,
      "fill-opacity": 0.10, stroke: aColor, "stroke-width": 2, "stroke-dasharray": "6 5" }));
    // The defender's, drawn around the defender.
    const dx = cx + R(distance), dy = cy;
    svg.appendChild(el("circle", { cx: dx, cy: dy, r: R(reachB), fill: bColor,
      "fill-opacity": 0.10, stroke: bColor, "stroke-width": 2, "stroke-dasharray": "6 5" }));

    // The approach itself.
    svg.appendChild(el("line", { x1: cx, y1: cy, x2: dx, y2: dy,
      stroke: "var(--text-secondary)", "stroke-width": 2 }));
    const dlab = el("text", { class: "val", x: (cx + dx) / 2, y: cy + 44,
      "text-anchor": "middle", style: "font-weight:650" });
    dlab.textContent = Math.round(distance).toLocaleString() + " km";
    svg.appendChild(dlab);

    // Straits that gate the approach, placed along it.
    chokepoints.forEach((k, i) => {
      const f = (i + 1) / (chokepoints.length + 1);
      const kx = cx + (dx - cx) * f, ky = cy;
      svg.appendChild(el("circle", { cx: kx, cy: ky, r: 6, fill: "var(--critical)",
        stroke: "var(--surface-1)", "stroke-width": 2 }));
      const t = el("text", { class: "tick", x: kx, y: ky + 26, "text-anchor": "middle",
        fill: "var(--critical)" });
      t.textContent = k.name;
      svg.appendChild(t);
    });

    const pin = (x, y, color, label, sub) => {
      svg.appendChild(el("circle", { cx: x, cy: y, r: 8, fill: color,
        stroke: "var(--surface-1)", "stroke-width": 2.5 }));
      const t = el("text", { class: "lbl", x, y: y - 16, "text-anchor": "middle",
        fill: color, style: "font-weight:650" });
      t.textContent = label;
      svg.appendChild(t);
      const s2 = el("text", { class: "tick", x, y: y + 26, "text-anchor": "middle" });
      s2.textContent = sub;
      svg.appendChild(s2);
    };
    pin(cx, cy, aColor, attacker.flag + " " + attacker.name,
        "reach " + Math.round(reachA).toLocaleString() + " km");
    pin(dx, dy, bColor, defender.flag + " " + defender.name,
        "reach " + Math.round(reachB).toLocaleString() + " km");

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  /* ── Front-line strip ─────────────────────────────────────────────────────
   * A Hovmöller diagram: one thin row per week, the defender's territory split
   * between the two sides. Time runs downward, so a grinding war reads as a
   * slow diagonal and a rout as a cliff.
   */
  function frontStrip(container, cfg) {
    const { rows, aColor = "var(--attacker)", bColor = "var(--defender)",
            aName = "Attacker", bName = "Defender" } = cfg;
    const padL = 46, padR = 14, top = 22;
    const rowH = Math.max(3, Math.min(8, Math.round(300 / Math.max(rows.length, 1))));
    const w = 760, h = top + rows.length * rowH + 26;
    const barW = w - padL - padR;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": "Share of the defender's territory held, week by week" });

    const head = el("text", { class: "tick", x: padL, y: 12 });
    head.textContent = "held by " + aName + "  ◀";
    svg.appendChild(head);
    const head2 = el("text", { class: "tick", x: w - padR, y: 12, "text-anchor": "end" });
    head2.textContent = "▶  held by " + bName;
    svg.appendChild(head2);

    rows.forEach((r, i) => {
      const y = Math.round(top + i * rowH);
      const aw = Math.max(0, (1 - r.territoryB) * barW);
      if (aw > 0.4) svg.appendChild(el("rect", { x: padL, y, width: aw, height: rowH, fill: aColor }));
      svg.appendChild(el("rect", { x: padL + aw, y, width: barW - aw, height: rowH, fill: bColor }));
      if (i % Math.ceil(rows.length / 6) === 0) {
        const t = el("text", { class: "tick", x: padL - 8, y: y + rowH, "text-anchor": "end" });
        t.textContent = "m" + Math.ceil(r.month);
        svg.appendChild(t);
      }
    });

    const hit = el("rect", { x: padL, y: top, width: barW, height: rows.length * rowH,
      fill: "transparent", style: "cursor:crosshair" });
    hit.addEventListener("mousemove", (e) => {
      const box = svg.getBoundingClientRect();
      const ry = ((e.clientY - box.top) / box.height) * h;
      const i = clampIdx(Math.floor((ry - top) / rowH), rows.length);
      const r = rows[i];
      showTip(`<div class="tt-h">Month ${Math.ceil(r.month)}</div>` +
        `<div class="tt-r"><span>${bName} holds</span><b>${(r.territoryB * 100).toFixed(0)}%</b></div>` +
        `<div class="tt-r"><span>${aName} holds</span><b>${((1 - r.territoryB) * 100).toFixed(0)}%</b></div>`,
        e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", hideTip);
    svg.appendChild(hit);

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }
  const clampIdx = (i, n) => Math.max(0, Math.min(n - 1, i));

  /* ── Stacked area ─────────────────────────────────────────────────────────
   * Where an army went. These are ordered parts of one whole, not separate
   * entities, so they take steps of a single hue rather than categorical
   * colours — the encoding rule for parts-of-a-whole, and it keeps the chart
   * inside a palette validated for two series.
   */
  function stackedArea(container, cfg) {
    const { bands, n, height = 250, yFmt = (v) => Math.round(v).toLocaleString() } = cfg;
    const padL = 62, padR = 110, padT = 12, padB = 40;
    const w = 760, h = height, iw = w - padL - padR, ih = h - padT - padB;

    const totals = [];
    for (let i = 0; i < n; i++) {
      totals.push(bands.reduce((s, b) => s + (b.values[i] || 0), 0));
    }
    const yMax = Math.max(1, ...totals) * 1.04;
    const X = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = (v) => padT + ih - (v / yMax) * ih;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": cfg.ariaLabel || "Composition of the force over time" });

    for (let t = 0; t <= 4; t++) {
      const v = (yMax / 4) * t, y = Y(v);
      svg.appendChild(el("line", { class: "grid", x1: padL, y1: y, x2: w - padR, y2: y }));
      const tx = el("text", { class: "tick", x: padL - 8, y: y + 4, "text-anchor": "end" });
      tx.textContent = yFmt(v);
      svg.appendChild(tx);
    }

    let base = new Array(n).fill(0);
    bands.forEach((b) => {
      const upper = base.map((v, i) => v + (b.values[i] || 0));
      let d = "M" + X(0) + "," + Y(base[0]);
      for (let i = 0; i < n; i++) d += "L" + X(i) + "," + Y(upper[i]);
      for (let i = n - 1; i >= 0; i--) d += "L" + X(i) + "," + Y(base[i]);
      d += "Z";
      // 2px surface gap between segments so the bands never touch.
      svg.appendChild(el("path", { d, fill: b.color, stroke: "var(--surface-1)",
        "stroke-width": 1.5 }));
      const midY = Y((base[n - 1] + upper[n - 1]) / 2);
      if (upper[n - 1] - base[n - 1] > yMax * 0.05) {
        const t = el("text", { class: "val", x: w - padR + 8, y: midY + 4 });
        t.textContent = b.name;
        svg.appendChild(t);
      }
      base = upper;
    });

    svg.appendChild(el("line", { class: "axis", x1: padL, y1: padT + ih, x2: w - padR, y2: padT + ih }));
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) {
      const tx = el("text", { class: "tick", x: X(i), y: padT + ih + 18, "text-anchor": "middle" });
      tx.textContent = i + 1;
      svg.appendChild(tx);
    }
    const xl = el("text", { class: "tick", x: padL + iw / 2, y: h - 6, "text-anchor": "middle" });
    xl.textContent = "Month";
    svg.appendChild(xl);

    const cross = el("line", { y1: padT, y2: padT + ih, stroke: "var(--text-muted)", opacity: 0 });
    svg.appendChild(cross);
    const hit = el("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent",
      style: "cursor:crosshair" });
    hit.addEventListener("mousemove", (e) => {
      const box = svg.getBoundingClientRect();
      const rel = ((e.clientX - box.left) / box.width) * w;
      const i = clampIdx(Math.round(((rel - padL) / iw) * (n - 1)), n);
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      cross.setAttribute("opacity", 0.6);
      showTip(`<div class="tt-h">Month ${i + 1}</div>` +
        bands.map((b) => `<div class="tt-r"><span>${b.name}</span><b>${yFmt(b.values[i] || 0)}</b></div>`).join("") +
        `<div class="tt-r" style="margin-top:4px"><span>Total</span><b>${yFmt(totals[i])}</b></div>`,
        e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
    svg.appendChild(hit);

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  /* ── Small multiples ──────────────────────────────────────────────────────
   * Six tiny charts on a shared x-axis. The point is the causal chain read
   * vertically: shells run dry, firepower drops, the front stalls, will erodes.
   */
  function sparkRows(container, cfg) {
    const { rows, n } = cfg;
    const padL = 150, padR = 56, rowH = 42, top = 8;
    const w = 760, h = top + rows.length * rowH + 26;
    const iw = w - padL - padR;
    const X = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": "Campaign indicators over time, on a shared timeline" });

    rows.forEach((r, k) => {
      const y0 = top + k * rowH, plotH = rowH - 10;
      const yMax = r.yMax ?? Math.max(1e-9, ...r.values);
      const Y = (v) => y0 + plotH - (Math.min(v, yMax) / yMax) * plotH;

      // Each band gets an enclosing surface. Without it a value near 100% draws
      // hard against the top of its own row and reads as belonging to the row
      // above — the labels are unambiguous only once the bands are.
      svg.appendChild(el("rect", { x: padL, y: y0, width: w - padR - padL, height: plotH,
        fill: "var(--surface-2)", rx: 3 }));
      svg.appendChild(el("line", { class: "grid", x1: padL, y1: y0 + plotH, x2: w - padR, y2: y0 + plotH }));
      const lbl = el("text", { class: "lbl", x: 0, y: y0 + plotH / 2 + 4 });
      lbl.textContent = r.label;
      svg.appendChild(lbl);

      const d = r.values.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(" ");
      svg.appendChild(el("path", { d, fill: "none", stroke: r.color, "stroke-width": 2,
        "stroke-linejoin": "round" }));
      const last = r.values[r.values.length - 1];
      const t = el("text", { class: "val", x: w - padR + 8, y: Y(last) + 4, fill: r.color,
        style: "font-weight:600" });
      t.textContent = r.fmt ? r.fmt(last) : Math.round(last).toLocaleString();
      svg.appendChild(t);
    });

    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) {
      const tx = el("text", { class: "tick", x: X(i), y: h - 10, "text-anchor": "middle" });
      tx.textContent = i + 1;
      svg.appendChild(tx);
    }
    const xl = el("text", { class: "tick", x: w - padR, y: h - 10, "text-anchor": "start" });
    xl.textContent = "month";
    svg.appendChild(xl);

    const cross = el("line", { y1: top, y2: top + rows.length * rowH - 14,
      stroke: "var(--text-muted)", opacity: 0 });
    svg.appendChild(cross);
    const hit = el("rect", { x: padL, y: top, width: iw, height: rows.length * rowH - 14,
      fill: "transparent", style: "cursor:crosshair" });
    hit.addEventListener("mousemove", (e) => {
      const box = svg.getBoundingClientRect();
      const rel = ((e.clientX - box.left) / box.width) * w;
      const i = clampIdx(Math.round(((rel - padL) / iw) * (n - 1)), n);
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      cross.setAttribute("opacity", 0.6);
      showTip(`<div class="tt-h">Month ${i + 1}</div>` +
        rows.map((r) => `<div class="tt-r"><span>${r.label}</span><b>${
          r.fmt ? r.fmt(r.values[i]) : Math.round(r.values[i]).toLocaleString()}</b></div>`).join(""),
        e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
    svg.appendChild(hit);

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  /* ── When the war ended, and how ──────────────────────────────────────────
   * Cumulative share of runs finished by week, stacked by termination. The top
   * edge is the share decided by then, so the empty space above it is the
   * survival curve read the other way up — and it is the shape that matters:
   * a cliff in the first weeks is a rout, a long shallow ramp is a grind, and
   * a stack that never reaches the top is a war the model could not finish.
   *
   * Bands are grouped by who prevailed and take steps of that side's hue,
   * because "attacker won by force" and "attacker won by concession" are parts
   * of one whole rather than separate identities. Adjacent-pair separation was
   * checked against the dark surface rather than eyeballed.
   */
  function endingBands(container, cfg) {
    const { bands, weeks, weeksPerMonth = 4.345, height = 260 } = cfg;
    const padL = 52, padR = 132, padT = 12, padB = 40;
    const w = 760, h = height, iw = w - padL - padR, ih = h - padT - padB;
    const n = weeks + 1;

    const X = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = (v) => padT + ih - (v / 100) * ih;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": cfg.ariaLabel || "Share of simulated wars finished, by week and by how they ended" });

    for (let t = 0; t <= 4; t++) {
      const v = t * 25, y = Y(v);
      svg.appendChild(el("line", { class: "grid", x1: padL, y1: y, x2: w - padR, y2: y }));
      const tx = el("text", { class: "tick", x: padL - 8, y: y + 4, "text-anchor": "end" });
      tx.textContent = v + "%";
      svg.appendChild(tx);
    }

    // Hatch for "won but cannot hold" — the report's existing convention, and
    // the reason that band does not need a hue of its own.
    const defs = el("defs");
    const pat = el("pattern", { id: "hatch-end", width: 8, height: 8,
      patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pat.appendChild(el("rect", { width: 8, height: 8, fill: "var(--attacker)" }));
    pat.appendChild(el("rect", { width: 4, height: 8, fill: "#1c5cab" }));
    defs.appendChild(pat);
    svg.appendChild(defs);

    const drawn = bands.filter((b) => b.values[n - 1] > 0.05);
    let base = new Array(n).fill(0);
    const stacked = [];
    drawn.forEach((b) => {
      const upper = base.map((v, i) => v + (b.values[i] || 0));
      let d = "M" + X(0) + "," + Y(base[0]);
      for (let i = 0; i < n; i++) d += "L" + X(i) + "," + Y(upper[i]);
      for (let i = n - 1; i >= 0; i--) d += "L" + X(i) + "," + Y(base[i]);
      d += "Z";
      svg.appendChild(el("path", { d,
        fill: b.hatch ? "url(#hatch-end)" : b.color,
        // 1.5px surface gap so bands never touch.
        stroke: "var(--surface-1)", "stroke-width": 1.5 }));
      stacked.push({ band: b, base: base.slice(), upper });
      base = upper;
    });

    // Direct labels for bands with enough final height to carry one.
    stacked.forEach(({ band, base: lo, upper }) => {
      const share = upper[n - 1] - lo[n - 1];
      if (share < 6) return;
      const t = el("text", { class: "val", x: w - padR + 8, y: Y((lo[n - 1] + upper[n - 1]) / 2) + 4 });
      t.textContent = band.name;
      svg.appendChild(t);
    });

    /* What never resolved. This is deliberately the empty region rather than a
     * band: runs that hit the model's horizon all "end" on the same week, so
     * stacking them draws a vertical wall at the right edge that reads as a
     * sudden collapse when it is really the clock running out. Left empty, the
     * top edge of the stack stays a survival curve and the gap above it is the
     * honest statement — this share was still being fought. */
    const unfinished = 100 - base[n - 1];
    if (unfinished > 6) {
      const t = el("text", { class: "val", x: w - padR + 8, y: Y((100 + base[n - 1]) / 2) + 4 });
      t.textContent = cfg.unresolvedLabel || "still fighting";
      svg.appendChild(t);
    }

    svg.appendChild(el("line", { class: "axis", x1: padL, y1: padT + ih, x2: w - padR, y2: padT + ih }));
    const months = Math.max(1, Math.floor(weeks / weeksPerMonth));
    const mStep = Math.max(1, Math.ceil(months / 8));
    for (let m = 0; m <= months; m += mStep) {
      const i = Math.min(n - 1, Math.round(m * weeksPerMonth));
      const tx = el("text", { class: "tick", x: X(i), y: padT + ih + 18, "text-anchor": "middle" });
      tx.textContent = m;
      svg.appendChild(tx);
    }
    const xl = el("text", { class: "tick", x: padL + iw / 2, y: h - 6, "text-anchor": "middle" });
    xl.textContent = "Months elapsed";
    svg.appendChild(xl);

    const cross = el("line", { y1: padT, y2: padT + ih, stroke: "var(--text-muted)", opacity: 0 });
    svg.appendChild(cross);
    const hit = el("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent",
      style: "cursor:crosshair" });
    hit.addEventListener("mousemove", (e) => {
      const box = svg.getBoundingClientRect();
      const rel = ((e.clientX - box.left) / box.width) * w;
      const i = clampIdx(Math.round(((rel - padL) / iw) * (n - 1)), n);
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      cross.setAttribute("opacity", 0.6);
      const done = drawn.reduce((s, b) => s + (b.values[i] || 0), 0);
      showTip(
        `<div class="tt-h">Month ${(i / weeksPerMonth).toFixed(1)} · week ${i}</div>` +
        `<div class="tt-r"><span>Still fighting</span><b>${(100 - done).toFixed(0)}%</b></div>` +
        drawn.filter((b) => (b.values[i] || 0) >= 0.5).map((b) =>
          `<div class="tt-r"><span>${b.name}</span><b>${b.values[i].toFixed(0)}%</b></div>`).join(""),
        e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
    svg.appendChild(hit);

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  /* ── What the answer rests on ─────────────────────────────────────────────
   * One row per resampled unknown, drawn from the win rate in the bottom third
   * of that factor's draws to the win rate in the top third, against the
   * overall rate as the centre line. Sorted by swing, so the assumption the
   * result depends on is the top bar rather than something to be found by
   * reading a table.
   *
   * The shaded strip through the middle is what this many runs could produce
   * from sampling noise alone. Bars inside it are not results, and saying so on
   * the chart is cheaper than explaining it afterwards.
   */
  function tornado(container, cfg) {
    const { rows, baseline, noise = 0, aColor = "var(--attacker)", bColor = "var(--defender)" } = cfg;
    const rowH = 32, padL = 210, padR = 64, padT = 30, padB = 34;
    const w = 760, h = padT + rows.length * rowH + padB;
    const iw = w - padL - padR;

    // Symmetric around the baseline so bar length is comparable across rows.
    const reach = Math.max(12, ...rows.map((r) =>
      Math.max(Math.abs(r.low - baseline), Math.abs(r.high - baseline)))) * 1.15;
    const lo = Math.max(0, baseline - reach), hi = Math.min(100, baseline + reach);
    const X = (v) => padL + ((v - lo) / (hi - lo)) * iw;

    const svg = el("svg", { class: "chart", viewBox: `0 0 ${w} ${h}`,
      role: "img", "aria-label": cfg.ariaLabel || "Effect of each uncertain assumption on the attacker's chances" });

    // Noise band first, so the bars sit on top of it.
    if (noise > 0) {
      svg.appendChild(el("rect", {
        x: X(baseline - noise / 2), y: padT - 6,
        width: Math.max(1, X(baseline + noise / 2) - X(baseline - noise / 2)),
        height: rows.length * rowH + 8,
        fill: "var(--text-muted)", opacity: 0.10 }));
    }

    for (const v of [lo, baseline, hi]) {
      const isBase = v === baseline;
      svg.appendChild(el("line", { class: isBase ? "axis" : "grid",
        x1: X(v), y1: padT - 6, x2: X(v), y2: padT + rows.length * rowH + 2 }));
      const t = el("text", { class: "tick", x: X(v), y: padT - 12, "text-anchor": "middle" });
      t.textContent = v.toFixed(0) + "%";
      svg.appendChild(t);
    }

    rows.forEach((r, i) => {
      const y = padT + i * rowH, cy = y + rowH / 2;
      const label = el("text", { class: "tick", x: padL - 12, y: cy + 4, "text-anchor": "end" });
      label.textContent = r.label;
      svg.appendChild(label);

      // One bar per direction, so a factor that pushes both ways reads as two
      // arms rather than one bar that has silently swallowed the baseline.
      [["low", r.low], ["high", r.high]].forEach(([which, v]) => {
        const x0 = X(Math.min(baseline, v)), x1 = X(Math.max(baseline, v));
        const width = Math.max(1.5, x1 - x0);
        const favoursAttacker = v > baseline;
        const bar = el("rect", { x: x0, y: cy - 8, width, height: 16, rx: 4,
          fill: favoursAttacker ? aColor : bColor,
          stroke: "var(--surface-1)", "stroke-width": 1.5 });
        bar.addEventListener("mouseenter", (e) => showTip(
          `<div class="tt-h">${r.label}</div>` +
          `<div class="tt-r"><span>${which === "low" ? "Lowest third of draws" : "Highest third of draws"}</span>` +
          `<b>${v.toFixed(0)}%</b></div>` +
          `<div class="tt-r"><span>Baseline</span><b>${baseline.toFixed(0)}%</b></div>` +
          `<div class="tt-r"><span>Full swing</span><b>${r.swing.toFixed(1)} pts</b></div>`,
          e.clientX, e.clientY));
        bar.addEventListener("mouseleave", hideTip);
        svg.appendChild(bar);
      });

      const sw = el("text", { class: "val", x: w - padR + 8, y: cy + 4 });
      sw.textContent = r.swing.toFixed(0) + " pts";
      svg.appendChild(sw);
    });

    const xl = el("text", { class: "tick", x: padL + iw / 2, y: h - 8, "text-anchor": "middle" });
    xl.textContent = cfg.xLabel || "Attacker prevails (% of runs)";
    svg.appendChild(xl);

    container.innerHTML = "";
    container.appendChild(svg);
    return svg;
  }

  /* ── Table fallback for any chart ─────────────────────────────────────── */
  function tableView(headers, rows) {
    const t = document.createElement("table");
    t.innerHTML =
      "<thead><tr>" + headers.map((h) => `<th>${h}</th>`).join("") + "</tr></thead>" +
      "<tbody>" + rows.map((r) => "<tr>" + r.map((c, i) =>
        `<td${i === 0 ? "" : ""}>${c}</td>`).join("") + "</tr>").join("") + "</tbody>";
    return t;
  }

  window.WarCharts = {
    tugBars, lineChart, waterfall, scatter, rangeBearing, frontStrip,
    stackedArea, sparkRows, endingBands, tornado, tableView, showTip, hideTip,
  };
})();

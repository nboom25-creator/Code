/* =============================================================================
 * charts.js — small SVG chart set. No dependencies, no CDN.
 *
 * Two forms only, because the report only has two jobs:
 *   tugBars()   — share-of-combined-power comparisons (magnitude, two sides)
 *   lineChart() — how a quantity moved over the months of the campaign
 *
 * Both ship a hover layer and both can render themselves as a table for
 * screen readers, printing, and anyone who would rather read the numbers.
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

  /* ── Table fallback for any chart ─────────────────────────────────────── */
  function tableView(headers, rows) {
    const t = document.createElement("table");
    t.innerHTML =
      "<thead><tr>" + headers.map((h) => `<th>${h}</th>`).join("") + "</tr></thead>" +
      "<tbody>" + rows.map((r) => "<tr>" + r.map((c, i) =>
        `<td${i === 0 ? "" : ""}>${c}</td>`).join("") + "</tr>").join("") + "</tbody>";
    return t;
  }

  window.WarCharts = { tugBars, lineChart, tableView, showTip, hideTip };
})();

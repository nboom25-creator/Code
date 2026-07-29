import { formatQty } from "@/lib/units";
import type { ProjectSnapshot } from "@/lib/project/snapshot";
import { rankNextActions } from "@/lib/assistant/nextActions";
import type { CalcResult } from "@/lib/calc/types";
import type { Quantity } from "@/lib/units";

/**
 * Report generation.
 *
 * Reports are produced as Markdown, which the app renders as printable HTML
 * (print to PDF from the browser) and offers as a download. Every report
 * carries the same header block: project, revision, date, units, and an
 * explicit statement of what has and has not been verified.
 *
 * DEVIATION NOTE: PDF is produced via the browser's print pipeline rather than
 * a server-side PDF library. This keeps the styling identical to what the user
 * sees, avoids a heavy dependency, and produces selectable text.
 */

export type ReportKind =
  | "project-summary"
  | "requirements"
  | "traceability"
  | "mass-budget"
  | "buoyancy-budget"
  | "syringe-sizing"
  | "stability"
  | "hydrodynamics"
  | "power-budget"
  | "mission"
  | "risk-register"
  | "test-plans"
  | "test-report"
  | "design-review"
  | "advisor-brief"
  | "weekly-progress"
  | "bom"
  | "notebook"
  | "decisions"
  | "final-report-outline"
  | "presentation-outline";

export const REPORT_CATALOG: { kind: ReportKind; title: string; description: string }[] = [
  { kind: "project-summary", title: "Project summary", description: "One-page state of the project: vehicle, budgets, verification status and warnings." },
  { kind: "requirements", title: "Requirements document", description: "Every requirement with target, tolerance, priority, source, rationale and verification method." },
  { kind: "traceability", title: "Requirements traceability matrix", description: "Requirement to test, calculation, component and evidence, with gaps called out." },
  { kind: "mass-budget", title: "Mass budget", description: "Component-by-component mass with fractions, provenance and missing data." },
  { kind: "buoyancy-budget", title: "Buoyancy budget", description: "Displacement, buoyant force, weight, net buoyancy and ballast to neutral." },
  { kind: "syringe-sizing", title: "Buoyancy-engine sizing report", description: "Architecture, geometry, forces, torque, timing, energy and margins with all working shown." },
  { kind: "stability", title: "Stability and trim report", description: "CG, CB, separations, equilibrium attitude and righting moment." },
  { kind: "hydrodynamics", title: "Hydrodynamic analysis", description: "Drag buildup, coefficients with their basis, and steady glide performance." },
  { kind: "power-budget", title: "Power and energy budget", description: "Load list, duty cycles, average and peak power, battery endurance." },
  { kind: "mission", title: "Mission simulation report", description: "Simulated dive-and-climb cycles with the state machine, energy and limits." },
  { kind: "risk-register", title: "Risk register", description: "All risks with likelihood, severity, detectability, priority score and mitigations." },
  { kind: "test-plans", title: "Test plans", description: "Full procedure, safety, raw-data fields and pass criteria for every planned test." },
  { kind: "test-report", title: "Test report", description: "Recorded runs, results, conclusions and comparison with prediction." },
  { kind: "design-review", title: "Design review package", description: "Combined summary, requirements, budgets, risks and open issues." },
  { kind: "advisor-brief", title: "Advisor meeting brief", description: "Short brief: state, top issues, decisions needed and questions to ask." },
  { kind: "weekly-progress", title: "Weekly progress report", description: "What changed in the last seven days and what is next." },
  { kind: "bom", title: "Bill of materials", description: "Parts, quantities, suppliers and cost against budget." },
  { kind: "notebook", title: "Engineering notebook export", description: "Chronological notebook entries with tags and subsystems." },
  { kind: "decisions", title: "Decision log", description: "Design decision records with alternatives, criteria and evidence." },
  { kind: "final-report-outline", title: "Final design report outline", description: "Section-by-section outline populated with what you already have and what is still missing." },
  { kind: "presentation-outline", title: "Presentation outline", description: "Slide-by-slide outline for the final presentation." },
];

const q = (x: Quantity | undefined, digits = 4) => formatQty(x, digits);
const pct = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)}%` : "—");

function header(snap: ProjectSnapshot, title: string): string {
  const settings = snap.settings;
  return `# ${title}

**Project:** ${snap.project.name}${snap.project.is_sample ? "  \n**⚠ DEMONSTRATION PROJECT — all data is synthetic example data, not a real design**" : ""}
**Revision:** ${settings.project.revision}
**Generated:** ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC
**Phase:** ${snap.project.phase}
**Units:** SI base units internally; values below are shown with explicit units.
**Environment:** ${settings.environment.kind}, ${settings.environment.temperatureC} °C, salinity ${settings.environment.salinityPSU} PSU
**Water density used:** ${q({ value: snap.water.densitySI, unit: "kg/m^3" }, 6)} — ${snap.water.source}
**Gravity:** ${settings.environment.gravitySI} m/s²

---
`;
}

function verificationFooter(snap: ProjectSnapshot): string {
  const errs = snap.warnings.filter((w) => w.warning.severity === "error");
  const warns = snap.warnings.filter((w) => w.warning.severity === "warning");
  return `

---

## Verification status and limitations

- Requirements verified: **${snap.completion.requirementsVerified} of ${snap.completion.requirementsTotal}**
- Test runs recorded: **${snap.testRuns.length}**
- Open assumptions: **${snap.completion.openAssumptions}**
- Open risks: **${snap.completion.openRisks}**${snap.completion.unreviewedStarterRisks > 0 ? ` (including ${snap.completion.unreviewedStarterRisks} starter risks not yet reviewed by the team)` : ""}

**Model warnings at generation time:** ${errs.length} error(s), ${warns.length} warning(s).

${errs.length > 0 ? `### Errors\n${errs.map((e) => `- **[${e.module}]** ${e.warning.message}`).join("\n")}\n` : ""}${warns.length > 0 ? `### Warnings\n${warns.map((e) => `- *[${e.module}]* ${e.warning.message}`).join("\n")}\n` : ""}

> **All results in this document are preliminary engineering estimates produced by closed-form models.** They are not proof of performance or safety. No value here has been validated against a physical experiment unless a test run in this project says so explicitly. Structural, sealing and pressure results in particular require a physical proof test before the vehicle carries anything of value.
`;
}

function calcSection(result: CalcResult<Record<string, Quantity | undefined>>, includeSteps = true): string {
  const lines: string[] = [];
  if (includeSteps && result.steps.length > 0) {
    lines.push("#### Working\n");
    for (const s of result.steps) {
      lines.push(`**${s.label}**`);
      if (s.equation) lines.push("```\n" + s.equation + "\n```");
      if (s.substitution) lines.push(`Substituting: \`${s.substitution}\``);
      if (s.result) lines.push(`→ **${s.result}**`);
      if (s.note) lines.push(`> ${s.note}`);
      lines.push("");
    }
  }
  if (result.assumptions.length > 0) {
    lines.push("#### Assumptions\n");
    for (const a of result.assumptions) lines.push(`- **${a.text}** — *${a.basis}*`);
    lines.push("");
  }
  if (result.warnings.length > 0) {
    lines.push("#### Warnings\n");
    for (const w of result.warnings) lines.push(`- **[${w.severity}]** ${w.message}`);
    lines.push("");
  }
  if (result.limitations && result.limitations.length > 0) {
    lines.push("#### Limitations\n");
    for (const l of result.limitations) lines.push(`- ${l}`);
    lines.push("");
  }
  lines.push(`*Model confidence: ${result.confidence}.*\n`);
  return lines.join("\n");
}

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

/* ------------------------------------------------------------------ */

export function generateReport(kind: ReportKind, snap: ProjectSnapshot): { title: string; markdown: string } {
  const meta = REPORT_CATALOG.find((r) => r.kind === kind);
  const title = meta?.title ?? kind;
  const body = BUILDERS[kind](snap);
  return { title, markdown: header(snap, title) + body + verificationFooter(snap) };
}

const BUILDERS: Record<ReportKind, (s: ProjectSnapshot) => string> = {
  "project-summary": (s) => {
    const actions = rankNextActions(s).slice(0, 5);
    return `## Vehicle state

${table(
  ["Quantity", "Value", "Source"],
  [
    ["Total mass", q(s.massProps.values.totalMass), `Sum of ${s.components.length} components`],
    ["Displaced volume", q({ value: s.massProps.values.totalDisplacedVolume.value * 1e6, unit: "cm^3" }), "Water-exposed component volumes"],
    ["Buoyant force", q(s.buoyancy.values.buoyantForce), "F_B = ρgV"],
    ["Weight", q(s.buoyancy.values.weight), "W = mg"],
    ["**Net buoyancy**", `**${q(s.buoyancy.values.netBuoyantForce)}**`, "F_net = F_B − W"],
    ["Ballast to neutral", `${(s.neutral.massChangeSI * 1000).toFixed(1)} g ${s.neutral.massChangeSI >= 0 ? "to add" : "to remove"}`, "Calculated"],
    ["Average vehicle density", q(s.buoyancy.values.averageDensity), "m / V"],
    ["CG (x, y, z)", `(${(s.massProps.cg.x * 1000).toFixed(1)}, ${(s.massProps.cg.y * 1000).toFixed(1)}, ${(s.massProps.cg.z * 1000).toFixed(1)}) mm`, "Mass-weighted centroid"],
    ["CB (x, y, z)", `(${(s.massProps.cb.x * 1000).toFixed(1)}, ${(s.massProps.cb.y * 1000).toFixed(1)}, ${(s.massProps.cb.z * 1000).toFixed(1)}) mm`, "Volume centroid"],
    ["CB−CG vertical", q({ value: s.stability.values.verticalSeparation.value * 1000, unit: "mm" }), "Stability module"],
    ["Equilibrium pitch", `${((s.stability.values.equilibriumPitch.value * 180) / Math.PI).toFixed(2)} ° (nose-up positive)`, "atan2(dx, dz)"],
    ["Buoyancy engine authority", q(s.syringe.values.buoyancyForceChange), `${s.settings.syringe.config}`],
    ["Available syringe volume", q({ value: s.syringe.values.usableVolumeChange.value * 1e6, unit: "cm^3" }), "A_p × usable stroke"],
    ["Predicted dive speed", q(s.diveGlide.values.speed), `Coefficients: ${s.settings.hydro.coefficientSource}`],
    ["Predicted glide ratio", q(s.diveGlide.values.glideRatio), "C_L / C_D"],
    ["Average electrical power", q(s.power.values.averagePower), `${s.electronics.length} loads`],
    ["Battery endurance", `${(s.power.values.enduranceTime.value / 3600).toFixed(2)} h`, "Usable energy / average power"],
  ],
)}

## Completion

Overall: **${pct(s.completion.percent)}**

${table(["Area", "Status", "Detail"], s.completion.sections.map((x) => [x.label, x.done ? "done" : "outstanding", x.detail]))}

## Highest-priority recommended actions

${actions.map((a, i) => `${i + 1}. **${a.title}** *(score ${a.score}, ${a.category})*\n   - Why: ${a.why}\n   - Evidence that closes it: ${a.evidence}`).join("\n\n") || "_No outstanding actions identified._"}
`;
  },

  requirements: (s) =>
    `## Requirements (${s.requirements.length})

${
  s.requirements.length === 0
    ? "_No requirements recorded._"
    : s.requirements
        .map(
          (r) => `### ${r.key} — ${r.title}

${r.description ?? ""}

${table(
  ["Field", "Value"],
  [
    ["Category", String(r.category)],
    ["Target", r.target_value !== null && r.target_value !== undefined ? `${r.comparator ?? ""} ${r.target_value} ${r.target_unit ?? ""}` : "—"],
    ["Tolerance", String(r.tolerance ?? "—")],
    ["Priority", String(r.priority)],
    ["Source", String(r.source ?? "—")],
    ["Rationale", String(r.rationale ?? "—")],
    ["Verification method", String(r.verification_method)],
    ["Verification status", String(r.verification_status)],
  ],
)}
`,
        )
        .join("\n")
}`,

  traceability: (s) => {
    const rows = s.requirements.map((r) => {
      let links: { tests?: string[]; components?: string[]; calculations?: string[] } = {};
      try {
        links = JSON.parse(String(r.links_json ?? "{}"));
      } catch {
        /* malformed link data is reported as empty rather than guessed at */
      }
      const tests = (links.tests ?? [])
        .map((id) => s.tests.find((t) => t.id === id))
        .filter(Boolean)
        .map((t) => String(t!.key));
      const evidence = (() => {
        try {
          return (JSON.parse(String(r.evidence_json ?? "[]")) as unknown[]).length;
        } catch {
          return 0;
        }
      })();
      return [
        String(r.key),
        String(r.title),
        String(r.priority),
        String(r.verification_method),
        tests.length > 0 ? tests.join(", ") : "**none**",
        String(evidence),
        String(r.verification_status),
      ];
    });
    const gaps = rows.filter((r) => r[4] === "**none**" || r[6] !== "verified");
    return `## Traceability matrix

${
  rows.length === 0
    ? "_No requirements to trace._"
    : table(["ID", "Requirement", "Priority", "Method", "Verifying tests", "Evidence items", "Status"], rows)
}

## Gaps

${
  gaps.length === 0
    ? "No gaps: every requirement is linked to a test and marked verified."
    : `${gaps.length} requirement(s) are not fully traced:\n\n${gaps.map((g) => `- **${g[0]}** ${g[1]} — ${g[4] === "**none**" ? "no verifying test linked" : ""}${g[6] !== "verified" ? `${g[4] === "**none**" ? "; " : ""}status is *${g[6]}*` : ""}`).join("\n")}`
}
`;
  },

  "mass-budget": (s) => {
    const rows = s.massProps.contributions.map((c) => [
      c.name,
      c.category,
      c.massKnown ? (c.massSI * 1000).toFixed(1) : "**missing**",
      pct(c.massFraction * 100),
      c.displacementMode,
      c.volumeKnown ? (c.volumeSI * 1e6).toFixed(1) : "**missing**",
    ]);
    return `## Component mass and displacement

${table(["Component", "Category", "Mass (g)", "Share", "Displacement mode", "Displaced volume (cm³)"], rows)}

**Total mass:** ${q(s.massProps.values.totalMass)}
**Total displaced volume:** ${q({ value: s.massProps.values.totalDisplacedVolume.value * 1e6, unit: "cm^3" })}

${s.massProps.missingMass.length > 0 ? `> **Missing masses (counted as zero):** ${s.massProps.missingMass.join(", ")}\n` : ""}${s.massProps.missingVolume.length > 0 ? `> **Missing displaced volumes (counted as zero):** ${s.massProps.missingVolume.join(", ")}\n` : ""}

${calcSection(s.massProps)}`;
  },

  "buoyancy-budget": (s) => `## Buoyancy

${table(
  ["Quantity", "Value"],
  [
    ["Displaced volume", q({ value: s.massProps.values.totalDisplacedVolume.value * 1e6, unit: "cm^3" })],
    ["Displaced water mass", q(s.buoyancy.values.displacedMass)],
    ["Buoyant force", q(s.buoyancy.values.buoyantForce)],
    ["Vehicle mass", q(s.massProps.values.totalMass)],
    ["Weight", q(s.buoyancy.values.weight)],
    ["Net buoyant force", q(s.buoyancy.values.netBuoyantForce)],
    ["Net buoyancy as mass", q(s.buoyancy.values.netBuoyantMass)],
    ["Buoyancy margin", q(s.buoyancy.values.buoyancyMarginPercent)],
    ["Average vehicle density", q(s.buoyancy.values.averageDensity)],
  ],
)}

**Route to neutral:** add **${(s.neutral.massChangeSI * 1000).toFixed(1)} g** of ballast, *or* change displacement by **${(s.neutral.volumeChangeSI * 1e6).toFixed(1)} cm³**. These are alternatives, not both.

${calcSection(s.buoyancy)}`,

  "syringe-sizing": (s) => {
    const v = s.syringe.values;
    return `## Buoyancy engine — ${s.settings.syringe.config}

${table(
  ["Input", "Value"],
  [
    ["Architecture", s.settings.syringe.config],
    ["Bore diameter", `${(s.settings.syringe.boreDiameterSI * 1000).toFixed(2)} mm`],
    ["Mechanical stroke", `${(s.settings.syringe.maxStrokeSI * 1000).toFixed(1)} mm`],
    ["Usable stroke", `${(s.settings.syringe.usableStrokeSI * 1000).toFixed(1)} mm`],
    ["Syringes in parallel", String(s.settings.syringe.syringeCount)],
    ["Operating depth", `${s.settings.mission.targetDepthSI} m`],
    ["Plunger friction", s.settings.syringe.frictionForceSI !== undefined ? `${s.settings.syringe.frictionForceSI} N` : "**not entered — taken as 0 N**"],
    ["Lead screw lead", s.settings.syringe.leadSI !== undefined ? `${(s.settings.syringe.leadSI * 1000).toFixed(2)} mm/rev` : "**not entered**"],
    ["Screw efficiency", s.settings.syringe.screwEfficiency !== undefined ? String(s.settings.syringe.screwEfficiency) : "**assumed 0.30**"],
    ["Safety factor", String(s.settings.syringe.safetyFactor)],
  ],
)}

${table(
  ["Result", "Value"],
  [
    ["Piston area", q({ value: v.pistonArea.value * 1e6, unit: "mm^2" })],
    ["Usable volume change", q({ value: v.usableVolumeChange.value * 1e6, unit: "cm^3" })],
    ["Buoyancy force change", q(v.buoyancyForceChange)],
    ["Equivalent ballast", q({ value: v.buoyancyMassChange.value * 1000, unit: "g" })],
    ["Hydrostatic pressure at depth", q({ value: v.hydrostaticPressure.value / 1000, unit: "kPa" })],
    ["Pressure force on plunger", q(v.pressureForce)],
    ["Friction force", q(v.frictionForce)],
    ["Required actuator force", q(v.requiredActuatorForce)],
    ["Design actuator force (with SF)", q(v.designActuatorForce)],
    ["Ideal screw torque", v.idealScrewTorque ? q({ value: v.idealScrewTorque.value * 1000, unit: "mN*m" }) : "—"],
    ["Design screw torque", v.designScrewTorque ? q({ value: v.designScrewTorque.value * 1000, unit: "mN*m" }) : "—"],
    ["Required motor torque", v.requiredMotorTorque ? q({ value: v.requiredMotorTorque.value * 1000, unit: "mN*m" }) : "—"],
    ["Actuation time", v.actuationTime ? q(v.actuationTime) : "—"],
    ["Mechanical work per stroke", q(v.mechanicalWorkPerStroke)],
    ["Electrical energy per stroke", v.electricalEnergyPerStroke ? q(v.electricalEnergyPerStroke) : "—"],
    ["Energy per full cycle", v.energyPerCycle ? q(v.energyPerCycle) : "—"],
    ["Stall margin", v.stallMargin ? q(v.stallMargin) : "—"],
    ["Maximum feasible depth", v.maxFeasibleDepth ? q(v.maxFeasibleDepth) : "—"],
  ],
)}

${calcSection(s.syringe)}`;
  },

  stability: (s) => `## Stability and trim

${table(
  ["Quantity", "Value"],
  [
    ["CG", `(${(s.massProps.cg.x * 1000).toFixed(2)}, ${(s.massProps.cg.y * 1000).toFixed(2)}, ${(s.massProps.cg.z * 1000).toFixed(2)}) mm`],
    ["CB", `(${(s.massProps.cb.x * 1000).toFixed(2)}, ${(s.massProps.cb.y * 1000).toFixed(2)}, ${(s.massProps.cb.z * 1000).toFixed(2)}) mm`],
    ["Longitudinal separation (CB−CG)", q({ value: s.stability.values.longitudinalSeparation.value * 1000, unit: "mm" })],
    ["Vertical separation (CB−CG)", q({ value: s.stability.values.verticalSeparation.value * 1000, unit: "mm" })],
    ["Lateral separation (CB−CG)", q({ value: s.stability.values.lateralSeparation.value * 1000, unit: "mm" })],
    ["|BG|", q({ value: s.stability.values.bgDistance.value * 1000, unit: "mm" })],
    ["Equilibrium pitch", `${((s.stability.values.equilibriumPitch.value * 180) / Math.PI).toFixed(2)} ° (nose-up positive)`],
    ["Equilibrium roll", `${((s.stability.values.equilibriumRoll.value * 180) / Math.PI).toFixed(2)} ° (port-up positive)`],
    ["Righting moment at 10°", q(s.stability.values.rightingMomentAtAngle)],
    ["Small-angle stiffness", `${q(s.stability.values.pitchStiffness)} per radian`],
  ],
)}

${calcSection(s.stability)}`,

  hydrodynamics: (s) => `## Coefficients in use

${table(
  ["Coefficient", "Value", "Basis"],
  [
    ["C_L", String(s.settings.hydro.liftCoefficient), s.settings.hydro.coefficientSource],
    ["C_D", String(s.settings.hydro.dragCoefficient), s.settings.hydro.coefficientSource],
    ["Reference area", `${(s.settings.hydro.referenceAreaSI * 1e4).toFixed(1)} cm²`, s.settings.hydro.referenceAreaBasis],
    ["Calibration factor", String(s.settings.hydro.calibrationFactor), s.settings.hydro.calibrationFactor === 1 ? "not calibrated" : "fitted to test data"],
  ],
)}

${s.settings.hydro.coefficientSource === "assumed" ? `> **${s.settings.hydro.coefficientNote}**\n` : ""}

## Drag buildup

${table(
  ["Component", "Value"],
  [
    ["Reynolds number", q(s.drag.values.reynolds)],
    ["Skin friction coefficient (ITTC-57)", q(s.drag.values.frictionCoefficient)],
    ["Hull form factor (Hoerner)", q(s.drag.values.formFactor)],
    ["Hull wetted area", q({ value: s.drag.values.hullWettedArea.value * 1e4, unit: "cm^2" })],
    ["Hull drag", q(s.drag.values.hullDrag)],
    ["Wing + tail profile drag", q(s.drag.values.wingProfileDrag)],
    ["Induced drag", q(s.drag.values.inducedDrag)],
    ["Appendage allowance", q(s.drag.values.appendageDrag)],
    ["**Total drag**", `**${q(s.drag.values.totalDrag)}**`],
  ],
)}

## Steady glide

${table(
  ["Quantity", "Dive", "Climb"],
  [
    ["Speed", q(s.diveGlide.values.speed), q(s.climbGlide.values.speed)],
    ["Glide path angle", `${((s.diveGlide.values.glidePathAngle.value * 180) / Math.PI).toFixed(2)} °`, `${((s.climbGlide.values.glidePathAngle.value * 180) / Math.PI).toFixed(2)} °`],
    ["Glide ratio", q(s.diveGlide.values.glideRatio), q(s.climbGlide.values.glideRatio)],
    ["Horizontal speed", q(s.diveGlide.values.horizontalSpeed), q(s.climbGlide.values.horizontalSpeed)],
    ["Vertical speed", q(s.diveGlide.values.verticalSpeed), q(s.climbGlide.values.verticalSpeed)],
  ],
)}

${calcSection(s.drag)}
${calcSection(s.diveGlide, false)}`,

  "power-budget": (s) => `## Electrical loads

${
  s.power.breakdown.length === 0
    ? "_No electrical loads recorded._"
    : table(
        ["Load", "Subsystem", "Active power (W)", "Average power (W)", "Share", "Provenance"],
        s.power.breakdown.map((b) => [b.name, b.subsystem, b.activePowerW.toFixed(3), b.averagePowerW.toFixed(4), pct(b.shareOfAverage * 100), b.provenance]),
      )
}

${table(
  ["Quantity", "Value"],
  [
    ["Average power", q(s.power.values.averagePower)],
    ["Peak power (all loads at once)", q(s.power.values.peakPower)],
    ["Hotel (non-actuator) power", q(s.power.values.hotelPower)],
    ["Actuator power", q(s.power.values.actuatorPower)],
    ["Battery chemistry", s.settings.battery.chemistry],
    ["Usable energy", `${(s.power.values.usableEnergy.value / 3600).toFixed(2)} Wh`],
    ["Endurance", `${(s.power.values.enduranceTime.value / 3600).toFixed(2)} h`],
  ],
)}

${calcSection(s.power)}`,

  mission: (s) => `## Mission configuration

${table(
  ["Parameter", "Value"],
  [
    ["Target depth", `${s.settings.mission.targetDepthSI} m`],
    ["Depth limit", `${s.settings.mission.depthLimitSI} m`],
    ["Surface threshold", `${s.settings.mission.surfaceThresholdSI} m`],
    ["Cycles requested", String(s.settings.mission.cycles)],
    ["Actuation time", `${s.syringe.values.actuationTime?.value.toFixed(1) ?? "—"} s`],
    ["Bottom dwell", `${s.settings.mission.bottomDwellSI} s`],
    ["Surface dwell", `${s.settings.mission.surfaceDwellSI} s`],
    ["Current", `${s.settings.mission.currentVelocitySI} m/s`],
    ["Velocity time constant", `${s.settings.mission.velocityTimeConstantSI} s`],
  ],
)}

Run the simulation from the Mission Simulator page to attach a specific run's results and export its time history. The predicted steady-state behaviour from the current model is:

${table(
  ["Quantity", "Dive", "Climb"],
  [
    ["Speed", q(s.diveGlide.values.speed), q(s.climbGlide.values.speed)],
    ["Vertical speed", q(s.diveGlide.values.verticalSpeed), q(s.climbGlide.values.verticalSpeed)],
    ["Glide angle", `${((s.diveGlide.values.glidePathAngle.value * 180) / Math.PI).toFixed(2)} °`, `${((s.climbGlide.values.glidePathAngle.value * 180) / Math.PI).toFixed(2)} °`],
  ],
)}
`,

  "risk-register": (s) => {
    const rows = s.risks.map((r) => [
      String(r.key),
      String(r.description),
      String(r.likelihood),
      String(r.severity),
      String(r.detectability),
      String(Number(r.likelihood) * Number(r.severity) * Number(r.detectability)),
      String(r.status),
      Number(r.is_starter) === 1 && Number(r.reviewed) === 0 ? "**NOT REVIEWED**" : "reviewed",
    ]);
    rows.sort((a, b) => Number(b[5]) - Number(a[5]));
    return `## Risk register (${s.risks.length})

Risk priority number = likelihood × severity × detectability, each scored 1–5 (higher detectability score = harder to detect).

${rows.length === 0 ? "_No risks recorded._" : table(["ID", "Risk", "L", "S", "D", "RPN", "Status", "Team review"], rows)}

## Detail

${s.risks
  .map(
    (r) => `### ${r.key} — ${r.description}
${Number(r.is_starter) === 1 && Number(r.reviewed) === 0 ? "\n> ⚠ **This is a starter risk that the team has not yet reviewed. It must not be presented as an assessment of this vehicle.**\n" : ""}
- **Cause:** ${r.cause ?? "—"}
- **Consequence:** ${r.consequence ?? "—"}
- **Mitigation:** ${r.mitigation ?? "—"}
- **Contingency:** ${r.contingency ?? "—"}
- **Owner:** ${r.owner || "*unassigned*"}
- **Status:** ${r.status}
`,
  )
  .join("\n")}`;
  },

  "test-plans": (s) =>
    s.tests.length === 0
      ? "_No test plans recorded._"
      : s.tests
          .map((t) => {
            let vars: { name: string; role: string; unit: string }[] = [];
            let raw: { name: string; unit: string }[] = [];
            try {
              vars = JSON.parse(String(t.variables_json ?? "[]"));
            } catch { /* omitted rather than guessed */ }
            try {
              raw = JSON.parse(String(t.raw_fields_json ?? "[]"));
            } catch { /* omitted rather than guessed */ }
            return `## ${t.key} — ${t.title}

**Objective:** ${t.objective ?? "—"}
**Category:** ${t.category}
**Status:** ${t.status}

### Equipment
${t.equipment ?? "—"}

### Setup
${t.setup ?? "—"}

### Variables
${vars.length ? table(["Variable", "Role", "Unit"], vars.map((v) => [v.name, v.role, v.unit])) : "_none recorded_"}

### Procedure
${t.procedure ?? "—"}

### Safety
> ${String(t.safety ?? "Not recorded — a test plan without a safety section is not ready to run.").replace(/\n/g, "\n> ")}

### Raw data fields
${raw.length ? table(["Field", "Unit"], raw.map((f) => [f.name, f.unit])) : "_none recorded_"}

### Expected result
${t.expected_result ?? "—"}

### Pass criterion
${t.pass_criteria ?? "—"}

### Uncertainty sources
${t.uncertainty_sources ?? "—"}
`;
          })
          .join("\n---\n"),

  "test-report": (s) =>
    s.testRuns.length === 0
      ? "_No test runs recorded. Nothing has been measured yet, so no result in this project has been validated experimentally._"
      : s.testRuns
          .map((run) => {
            const test = s.tests.find((t) => t.id === run.test_id);
            let transforms: { description: string; reason: string }[] = [];
            try {
              transforms = JSON.parse(String(run.transformations_json ?? "[]"));
            } catch { /* omitted rather than guessed */ }
            return `## ${test?.key ?? "?"} — ${test?.title ?? "Unknown test"} — run ${run.run_label}

- **Performed:** ${run.performed_on ?? "—"}
- **Operator:** ${run.operator ?? "—"}
- **Result:** ${run.pass_fail ?? "not judged"}

### Summary
${run.result_summary ?? "—"}

### Conclusion
${run.conclusion ?? "—"}

### Data transformations applied
${
  transforms.length === 0
    ? "_None. The raw data is used exactly as recorded._"
    : transforms.map((t) => `- **${t.description}** — reason: ${t.reason}`).join("\n")
}

### Follow-up
${run.follow_up ?? "—"}
`;
          })
          .join("\n---\n"),

  "design-review": (s) =>
    `${BUILDERS["project-summary"](s)}\n\n---\n\n${BUILDERS.traceability(s)}\n\n---\n\n${BUILDERS["buoyancy-budget"](s)}\n\n---\n\n${BUILDERS["syringe-sizing"](s)}\n\n---\n\n${BUILDERS.stability(s)}\n\n---\n\n${BUILDERS["risk-register"](s)}`,

  "advisor-brief": (s) => {
    const actions = rankNextActions(s).slice(0, 4);
    const errs = s.warnings.filter((w) => w.warning.severity === "error").slice(0, 6);
    return `## Where we are

- Phase **${s.project.phase}**, overall completion **${pct(s.completion.percent)}**
- Vehicle: ${q(s.massProps.values.totalMass)}, displacing ${q({ value: s.massProps.values.totalDisplacedVolume.value * 1e6, unit: "cm^3" })}
- Net buoyancy ${q(s.buoyancy.values.netBuoyantForce)} (${(s.neutral.massChangeSI * 1000).toFixed(1)} g from neutral)
- Buoyancy engine: **${s.settings.syringe.config}**, ${q({ value: s.syringe.values.usableVolumeChange.value * 1e6, unit: "cm^3" })} swept, ${q(s.syringe.values.buoyancyForceChange)} of authority
- Requirements verified: **${s.completion.requirementsVerified} / ${s.completion.requirementsTotal}**

## What we want to discuss

${actions.map((a, i) => `${i + 1}. **${a.title}** — ${a.why}`).join("\n\n")}

## Open issues the model is flagging

${errs.length === 0 ? "- None at error severity." : errs.map((e) => `- **[${e.module}]** ${e.warning.message}`).join("\n")}

## Decisions we need from you

${s.decisions.filter((d) => String(d.status) === "proposed").map((d) => `- ${d.statement}`).join("\n") || "- None outstanding; all recorded decisions are accepted."}

## Assumptions we are carrying

${
  s.assumptions
    .filter((a) => String(a.status) === "open")
    .slice(0, 8)
    .map((a) => `- **${a.text}** — *${a.basis}*`)
    .join("\n") || "- None open."
}
`;
  },

  "weekly-progress": (s) => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const recent = <T extends { created_at?: unknown }>(rows: T[]) =>
      rows.filter((r) => {
        const t = Date.parse(String(r.created_at ?? ""));
        return Number.isFinite(t) && t >= weekAgo;
      });
    const notes = recent(s.notebook);
    const actions = rankNextActions(s).slice(0, 3);
    return `## Activity in the last 7 days

${table(
  ["Item", "Count"],
  [
    ["Components added", String(recent(s.components).length)],
    ["Requirements added", String(recent(s.requirements).length)],
    ["Calculation snapshots", String(recent(s.calculations).length)],
    ["Test runs recorded", String(recent(s.testRuns).length)],
    ["Notebook entries", String(notes.length)],
    ["Decisions recorded", String(recent(s.decisions).length)],
  ],
)}

## Notebook entries this week

${notes.map((n) => `### ${n.title}\n*${String(n.created_at).slice(0, 10)} — ${n.subsystem ?? "general"}*\n\n${String(n.body ?? "").slice(0, 600)}`).join("\n\n") || "_None._"}

## Next week

${actions.map((a, i) => `${i + 1}. **${a.title}** — ${a.evidence}`).join("\n") || "_No outstanding actions identified._"}
`;
  },

  bom: (s) => {
    const rows = s.components.map((c) => {
      const qty = Number(c.quantity ?? 1);
      const unitCost = c.cost === null || c.cost === undefined ? null : Number(c.cost);
      return [
        String(c.part_number ?? "—"),
        String(c.name),
        String(c.category),
        String(qty),
        String(c.material_name ?? "—"),
        String(c.supplier ?? "—"),
        unitCost === null ? "—" : unitCost.toFixed(2),
        unitCost === null ? "—" : (unitCost * qty).toFixed(2),
      ];
    });
    const total = s.components.reduce(
      (sum, c) => sum + (c.cost === null || c.cost === undefined ? 0 : Number(c.cost) * Number(c.quantity ?? 1)),
      0,
    );
    const missing = s.components.filter((c) => c.cost === null || c.cost === undefined).length;
    const budget = s.settings.project.budgetUSD;
    return `## Bill of materials

${rows.length === 0 ? "_No components recorded._" : table(["Part number", "Description", "Category", "Qty", "Material", "Supplier", "Unit cost (USD)", "Extended (USD)"], rows)}

**Total of costed lines:** ${total.toFixed(2)} USD
${missing > 0 ? `\n> **${missing} component(s) have no cost recorded**, so this total is a lower bound, not the project cost.\n` : ""}
${budget !== undefined ? `**Budget:** ${budget.toFixed(2)} USD — ${total <= budget ? `${(budget - total).toFixed(2)} USD remaining on costed lines` : `**over budget by ${(total - budget).toFixed(2)} USD**`}` : "_No budget set in project settings._"}
`;
  },

  notebook: (s) =>
    s.notebook.length === 0
      ? "_The notebook is empty._"
      : s.notebook
          .slice()
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
          .map(
            (n) => `## ${String(n.created_at).slice(0, 16).replace("T", " ")} — ${n.title}

*Kind:* ${n.kind} | *Subsystem:* ${n.subsystem ?? "—"} | *Tags:* ${n.tags ?? "—"} | *Author:* ${n.author ?? "—"}

${n.body ?? ""}
`,
          )
          .join("\n---\n"),

  decisions: (s) =>
    s.decisions.length === 0
      ? "_No decisions recorded._"
      : s.decisions
          .map((d) => {
            let alts: { name: string; note?: string }[] = [];
            let crit: { name: string; weight: number }[] = [];
            let scores: Record<string, number[]> = {};
            try {
              alts = JSON.parse(String(d.alternatives_json ?? "[]"));
              crit = JSON.parse(String(d.criteria_json ?? "[]"));
              scores = JSON.parse(String(d.scores_json ?? "{}"));
            } catch { /* omitted rather than guessed */ }
            const totals = alts.map((a) => {
              const s2 = scores[a.name] ?? [];
              const total = crit.reduce((sum, c, i) => sum + c.weight * (s2[i] ?? 0), 0);
              return { name: a.name, total };
            });
            totals.sort((a, b) => b.total - a.total);
            return `## ${d.key} — ${d.statement}

**Status:** ${d.status}${d.decided_on ? ` | **Decided:** ${d.decided_on}` : ""}

### Context
${d.context ?? "—"}

### Alternatives considered
${alts.map((a) => `- **${a.name}**${a.note ? ` — ${a.note}` : ""}`).join("\n") || "_none recorded_"}

### Weighted decision matrix
${
  crit.length > 0 && alts.length > 0
    ? table(
        ["Alternative", ...crit.map((c) => `${c.name} (w=${c.weight})`), "Weighted total"],
        alts.map((a) => [a.name, ...(scores[a.name] ?? crit.map(() => 0)).map(String), String(crit.reduce((sum, c, i) => sum + c.weight * ((scores[a.name] ?? [])[i] ?? 0), 0))]),
      )
    : "_no matrix recorded_"
}

${totals.length > 1 ? `Ranking: ${totals.map((t) => `${t.name} (${t.total})`).join(" > ")}. Margin over runner-up: **${totals[0].total - totals[1].total}** points.` : ""}

### Chosen
**${d.chosen ?? "—"}**

- **Advantages:** ${d.advantages ?? "—"}
- **Disadvantages:** ${d.disadvantages ?? "—"}
- **Risks:** ${d.risks ?? "—"}
${d.revision_reason ? `- **Reason for revision:** ${d.revision_reason}` : ""}
`;
          })
          .join("\n---\n"),

  "final-report-outline": (s) => {
    const have = (cond: boolean, what: string) => (cond ? `✅ ${what}` : `⬜ **${what} — not yet available**`);
    return `## Suggested outline, annotated with what you already have

### 1. Introduction and problem statement
- ${have(Boolean(s.project.description), "Project description")}
- Motivation for buoyancy-driven gliding at laboratory scale

### 2. Requirements
- ${have(s.requirements.length > 0, `Requirements table (${s.requirements.length} recorded)`)}
- ${have(s.requirements.some((r) => r.rationale), "Rationale and source for each requirement")}

### 3. Concept selection
- ${have(s.decisions.length > 0, `Decision records (${s.decisions.length} recorded)`)}
- ${have(s.decisions.some((d) => String(d.criteria_json ?? "[]").length > 5), "Weighted decision matrix")}
- Buoyancy engine architecture comparison and why the chosen one is not equivalent to the others

### 4. Vehicle design
- ${have(s.components.length > 0, `Component inventory (${s.components.length} components)`)}
- ${have(s.geometryFiles.length > 0, `CAD figures (${s.geometryFiles.length} geometry files uploaded)`)}
- ${have(s.settings.structure.housingOuterDiameterSI !== undefined, "Pressure housing sizing")}

### 5. Mass, volume and buoyancy budget
- ${have(s.massProps.missingMass.length === 0, "Complete mass budget with no missing masses")}
- ${have(s.massProps.missingVolume.length === 0, "Complete displacement budget")}
- Net buoyancy and ballast strategy

### 6. Buoyancy engine sizing
- ${have(s.settings.syringe.frictionForceSI !== undefined, "Measured plunger friction")}
- ${have(s.settings.syringe.motorTorqueSI !== undefined, "Motor torque and stall margin")}
- Parameter sweeps showing the bore/stroke trade

### 7. Stability and trim
- ${have(Number.isFinite(s.stability.values.verticalSeparation.value), "CG/CB calculation")}
- ${have(s.stability.values.verticalSeparation.value > 0.002, "Adequate CB−CG separation")}
- Trim strategy

### 8. Hydrodynamics and predicted performance
- ${have(s.settings.hydro.coefficientSource !== "assumed", "Coefficients from measurement rather than assumption")}
- Drag buildup with cited correlations
- Predicted glide performance

### 9. Electronics and control
- ${have(s.electronics.length > 0, `Load list (${s.electronics.length} items)`)}
- ${have(s.power.values.averagePower.value > 0, "Power budget and endurance")}
- State machine description

### 10. Verification and testing
- ${have(s.tests.length > 0, `Test plans (${s.tests.length})`)}
- ${have(s.testRuns.length > 0, `Test results (${s.testRuns.length} runs)`)}
- ${have(s.testRuns.length > 0, "Predicted versus measured comparison")}

### 11. Risk management
- ${have(s.risks.length > 0, `Risk register (${s.risks.length} risks)`)}
- ${have(s.completion.unreviewedStarterRisks === 0, "All risks reviewed by the team")}

### 12. Results, discussion and limitations
- What the models predicted, what was measured, and why they differ
- Honest statement of what remains unvalidated

### 13. Conclusions and future work

### Appendices
- ${have(s.requirements.length > 0, "Requirements traceability matrix")}
- ${have(s.components.length > 0, "Bill of materials")}
- ${have(s.notebook.length > 0, `Engineering notebook (${s.notebook.length} entries)`)}
- ${have(s.calculations.length > 0, `Calculation snapshots (${s.calculations.length} runs)`)}
- Raw test data
`;
  },

  "presentation-outline": (s) => `## Suggested slide sequence

1. **Title** — ${s.project.name}, team, advisor, date
2. **The problem** — what an underwater glider is and why buoyancy-driven propulsion is interesting
3. **Requirements** — the three or four that actually drove the design (from ${s.requirements.length} recorded)
4. **Concept selection** — the buoyancy engine architectures compared, and why they are NOT equivalent
5. **The vehicle** — CAD render, key dimensions, ${q(s.massProps.values.totalMass)} and ${q({ value: s.massProps.values.totalDisplacedVolume.value * 1e6, unit: "cm^3" })}
6. **Buoyancy budget** — the small difference between two large numbers, and what that means for build tolerance
7. **Buoyancy engine** — ${(s.settings.syringe.boreDiameterSI * 1000).toFixed(1)} mm bore × ${(s.settings.syringe.usableStrokeSI * 1000).toFixed(0)} mm stroke → ${q(s.syringe.values.buoyancyForceChange)}; the bore-versus-torque trade
8. **Stability** — CG/CB diagram, why the CB must sit above the CG
9. **Predicted performance** — glide ratio ${q(s.diveGlide.values.glideRatio)}, dive speed ${q(s.diveGlide.values.speed)} ${s.settings.hydro.coefficientSource === "assumed" ? "*(from assumed coefficients — say so on the slide)*" : ""}
10. **Mission simulation** — depth-versus-time sawtooth
11. **Test programme** — ${s.tests.length} planned tests, ${s.testRuns.length} run so far
12. **Results** — predicted versus measured ${s.testRuns.length === 0 ? "*(no data yet — this slide is your biggest gap)*" : ""}
13. **Risks and how we handled them** — lead with the safety-critical ones
14. **What we would do differently**
15. **Conclusions**

> Presentation advice: the slide that earns the most credit in a senior-design review is usually the one where you show a prediction, the measurement that disagreed with it, and your explanation of why. Do not hide the disagreement.
`,
};

/* ------------------------------------------------------------------ */

/** CSV export helpers for the tabular reports. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

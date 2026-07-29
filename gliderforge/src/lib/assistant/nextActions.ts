import type { ProjectSnapshot } from "@/lib/project/snapshot";

/**
 * "What should I work on next?"
 *
 * Deterministic ranking over the project's own data. Each suggestion states
 * WHY it matters and WHAT EVIDENCE would close it out, so the list is
 * actionable rather than a nag. Nothing here invents data — every item is
 * triggered by a specific absence or a specific computed warning.
 */

export interface NextAction {
  id: string;
  title: string;
  why: string;
  evidence: string;
  module: string;
  href: string;
  score: number;
  factors: { label: string; points: number }[];
  category: "blocking" | "risk" | "data" | "verification" | "schedule" | "progress";
}

const clampScore = (n: number) => Math.max(0, Math.min(100, n));

export function rankNextActions(snap: ProjectSnapshot, today = new Date()): NextAction[] {
  const actions: NextAction[] = [];
  const add = (
    a: Omit<NextAction, "score" | "factors"> & { factors: { label: string; points: number }[] },
  ) => {
    const score = clampScore(a.factors.reduce((s, f) => s + f.points, 0));
    actions.push({ ...a, score, factors: a.factors });
  };

  const s = snap.settings;

  // --- Blocking data gaps -------------------------------------------------
  if (snap.components.length === 0) {
    add({
      id: "add-components",
      title: "Add the first components to the vehicle inventory",
      why: "Nothing downstream works without components: mass, displacement, CG, CB, stability, glide performance and the mission simulation all read from the component list. This is the single blocking dependency for most of the project.",
      evidence: "At least the hull, battery, controller, syringe and ballast entered with a mass and a displacement mode.",
      module: "Components",
      href: "/components",
      category: "blocking",
      factors: [
        { label: "Blocks every downstream calculation", points: 60 },
        { label: "No components exist yet", points: 35 },
      ],
    });
  }
  if (snap.massProps.missingMass.length > 0) {
    add({
      id: "missing-mass",
      title: `Weigh or estimate ${snap.massProps.missingMass.length} component(s) with no mass`,
      why: `Components with no mass are silently counted as ZERO, which biases the total mass, the CG and therefore every stability and buoyancy conclusion. Missing: ${snap.massProps.missingMass.slice(0, 4).join(", ")}${snap.massProps.missingMass.length > 4 ? ", …" : ""}.`,
      evidence: "A mass in the components table for each item, ideally 'measured' from a scale rather than 'estimated'.",
      module: "Components",
      href: "/components",
      category: "data",
      factors: [
        { label: "Biases mass, CG and buoyancy", points: 45 },
        { label: `${snap.massProps.missingMass.length} components affected`, points: Math.min(25, snap.massProps.missingMass.length * 5) },
      ],
    });
  }
  if (snap.massProps.missingVolume.length > 0) {
    add({
      id: "missing-volume",
      title: `Determine displaced volume for ${snap.massProps.missingVolume.length} water-exposed component(s)`,
      why: "Water-exposed components without a volume make the total displacement and the centre of buoyancy too small. The CB drives the whole stability result.",
      evidence: "A displacement volume per component, from CAD, from a water-displacement measurement, or from the geometry file.",
      module: "Mass & Buoyancy",
      href: "/mass",
      category: "data",
      factors: [
        { label: "Centre of buoyancy unreliable", points: 40 },
        { label: `${snap.massProps.missingVolume.length} components affected`, points: Math.min(20, snap.massProps.missingVolume.length * 5) },
      ],
    });
  }

  // --- Syringe engine -----------------------------------------------------
  if (s.syringe.frictionForceSI === undefined) {
    add({
      id: "measure-friction",
      title: "Measure the syringe plunger and seal friction",
      why: "Friction is currently taken as zero. On a rubber-tipped syringe the breakaway force can be several newtons, which at shallow depth is comparable to or larger than the hydrostatic load. Every motor-torque and stall-margin number is unreliable until this is measured.",
      evidence: "A spring-scale or load-cell pull test of the plunger, both breakaway and sliding, recorded as a test run.",
      module: "Syringe Engine",
      href: "/syringe",
      category: "risk",
      factors: [
        { label: "Dominates actuator sizing at shallow depth", points: 45 },
        { label: "Cheap to measure, high information value", points: 20 },
      ],
    });
  }
  if (s.syringe.leadSI === undefined || s.syringe.motorTorqueSI === undefined) {
    add({
      id: "drivetrain-spec",
      title: "Enter the lead-screw lead and the motor's available torque",
      why: "Without them the tool cannot compute required torque, stall margin, actuation time or maximum feasible depth — the four numbers that decide whether the buoyancy engine works at all.",
      evidence: "Lead screw pitch/lead from the part you bought, and motor torque from its datasheet or a stall test.",
      module: "Syringe Engine",
      href: "/syringe",
      category: "blocking",
      factors: [
        { label: "Blocks actuator feasibility check", points: 40 },
        { label: "Needed before ordering parts", points: 15 },
      ],
    });
  }
  const stall = snap.syringe.values.stallMargin?.value;
  if (stall !== undefined && stall < 1.5) {
    add({
      id: "stall-margin",
      title: `Resolve the low actuator stall margin (${stall.toFixed(2)})`,
      why: `The drivetrain has ${stall < 1 ? "less torque than required — it will stall" : "very little torque headroom"}. Battery sag, cold water and seal ageing all erode this further.`,
      evidence: "A revised bore, lead, gear ratio or motor, re-run through the sizing page with a margin of at least 1.5-2.0, plus a bench test driving the full stroke against the design pressure.",
      module: "Syringe Engine",
      href: "/syringe",
      category: "risk",
      factors: [
        { label: stall < 1 ? "Actuator predicted to stall" : "Insufficient torque margin", points: stall < 1 ? 55 : 35 },
        { label: "Affects the vehicle's core function", points: 20 },
      ],
    });
  }

  // --- Buoyancy authority sanity -----------------------------------------
  const authority = snap.syringe.values.buoyancyForceChange.value;
  const weight = snap.buoyancy.values.weight.value;
  if (Number.isFinite(authority) && Number.isFinite(weight) && weight > 0) {
    const ratio = authority / weight;
    if (ratio < 0.01) {
      add({
        id: "authority-low",
        title: "Check whether the buoyancy engine has enough authority",
        why: `The engine changes buoyancy by ${authority.toFixed(3)} N, only ${(ratio * 100).toFixed(2)}% of the vehicle's ${weight.toFixed(2)} N weight. Small gliders typically need roughly 1-3% of weight to dive and climb briskly; below that the vehicle drifts rather than glides and any trim error swamps the control authority.`,
        evidence: "Either a larger bore/stroke or more syringes, checked against the required actuator force, plus a static tank test showing the vehicle actually changes depth.",
        module: "Syringe Engine",
        href: "/syringe",
        category: "risk",
        factors: [
          { label: "Vehicle may not dive or climb", points: 50 },
          { label: "Fundamental sizing issue, cheap to fix now", points: 20 },
        ],
      });
    }
  }

  // --- Stability ----------------------------------------------------------
  const dz = snap.stability.values.verticalSeparation.value;
  if (Number.isFinite(dz) && dz <= 0.002) {
    add({
      id: "stability-bg",
      title: dz <= 0 ? "Fix the unstable CB/CG arrangement" : "Increase the vertical CB-CG separation",
      why:
        dz <= 0
          ? "The centre of buoyancy is at or below the centre of gravity. A fully submerged vehicle in this condition has no righting moment and will roll to an arbitrary attitude."
          : `The vertical CB-CG separation is only ${(dz * 1000).toFixed(1)} mm, inside typical build tolerance, so its sign is not reliably known.`,
      evidence: "Move dense items (battery, ballast) low in the hull and buoyant volume high; then confirm with a tank test that the vehicle self-rights promptly when disturbed.",
      module: "Stability & Trim",
      href: "/stability",
      category: "risk",
      factors: [
        { label: dz <= 0 ? "Vehicle predicted to be unstable" : "Marginal stability", points: dz <= 0 ? 55 : 30 },
        { label: "Affects every in-water test", points: 15 },
      ],
    });
  }

  // --- Hydrodynamics ------------------------------------------------------
  if (s.hydro.coefficientSource === "assumed") {
    add({
      id: "hydro-coeffs",
      title: "Replace the assumed lift and drag coefficients with measured values",
      why: "Glide speed, glide ratio, range, mission duration and energy per cycle all scale directly with these two numbers, and they are currently placeholders. Any performance figure quoted in a report inherits that assumption.",
      evidence: "A tow test or a timed free-glide test in the pool giving speed and glide angle at known net buoyancy; enter the fitted coefficients and set the source to 'experimental'.",
      module: "Hydrodynamics",
      href: "/hydro",
      category: "verification",
      factors: [
        { label: "All performance claims depend on it", points: 35 },
        { label: "Currently assumed, not measured", points: 20 },
      ],
    });
  }

  // --- Requirements and verification -------------------------------------
  if (snap.requirements.length < 5) {
    add({
      id: "requirements",
      title: "Write the core engineering requirements",
      why: "Requirements are what the final report and the design review are judged against. Without them there is nothing to verify tests against and no way to show the design is adequate.",
      evidence: "At minimum: operating depth, vehicle envelope, mass limit, buoyancy authority, endurance, cycle count and factor of safety, each with a verification method.",
      module: "Requirements",
      href: "/requirements",
      category: "blocking",
      factors: [
        { label: "Needed for traceability and the design review", points: 35 },
        { label: `Only ${snap.requirements.length} recorded`, points: 20 },
      ],
    });
  }
  const unverified = snap.requirements.filter((r) => String(r.verification_status) !== "verified");
  const unlinked = snap.requirements.filter((r) => {
    try {
      const links = JSON.parse(String(r.links_json ?? "{}"));
      return !Array.isArray(links.tests) || links.tests.length === 0;
    } catch {
      return true;
    }
  });
  if (unlinked.length > 0 && snap.requirements.length > 0) {
    add({
      id: "link-tests",
      title: `Link ${unlinked.length} requirement(s) to a verification test`,
      why: "A requirement with no test attached cannot be shown to be met. The traceability matrix in your report will show these as gaps.",
      evidence: "A test plan referenced from each requirement, and eventually a test run with a pass/fail result.",
      module: "Requirements",
      href: "/requirements",
      category: "verification",
      factors: [
        { label: "Traceability gap", points: 25 },
        { label: `${unlinked.length} requirement(s) unlinked`, points: Math.min(20, unlinked.length * 4) },
      ],
    });
  }
  if (snap.tests.length > 0 && snap.testRuns.length === 0) {
    add({
      id: "run-tests",
      title: "Run the first planned test and record the data",
      why: "Every model in this workspace is currently unvalidated. The first real measurement — even a bucket displacement test — converts a pile of estimates into evidence.",
      evidence: "A test run with raw data attached, a conclusion, and a pass/fail against the stated criterion.",
      module: "Tests & Data",
      href: "/tests",
      category: "verification",
      factors: [
        { label: "No measurements exist yet", points: 40 },
        { label: "Unblocks model calibration", points: 15 },
      ],
    });
  }

  // --- Risks and assumptions ---------------------------------------------
  if (snap.completion.unreviewedStarterRisks > 0) {
    add({
      id: "review-risks",
      title: `Review the ${snap.completion.unreviewedStarterRisks} starter risk(s)`,
      why: "The starter risk register was pre-populated from common underwater-glider failure modes. Until you review each one it is a template, not an assessment of YOUR vehicle, and it should not appear in a design review as if it were.",
      evidence: "Each risk edited for your vehicle, scored for likelihood/severity/detectability, given a mitigation and an owner, and marked reviewed.",
      module: "Risks",
      href: "/risks",
      category: "risk",
      factors: [
        { label: "Register not yet owned by the team", points: 25 },
        { label: `${snap.completion.unreviewedStarterRisks} unreviewed`, points: Math.min(15, snap.completion.unreviewedStarterRisks * 2) },
      ],
    });
  }
  const criticalAssumptions = snap.assumptions.filter(
    (a) => String(a.status) === "open" && String(a.criticality) === "high",
  );
  if (criticalAssumptions.length > 0) {
    add({
      id: "critical-assumptions",
      title: `Resolve ${criticalAssumptions.length} high-criticality open assumption(s)`,
      why: `An unconfirmed high-criticality assumption is the most likely reason a design conclusion turns out wrong. Top of the list: "${String(criticalAssumptions[0].text).slice(0, 120)}".`,
      evidence: "Either a measurement, a datasheet, or an explicit confirmation recorded against the assumption.",
      module: "Dashboard",
      href: "/assumptions",
      category: "risk",
      factors: [
        { label: "Highest-leverage source of technical error", points: 35 },
        { label: `${criticalAssumptions.length} open`, points: Math.min(15, criticalAssumptions.length * 5) },
      ],
    });
  }

  // --- Schedule -----------------------------------------------------------
  for (const m of snap.milestones) {
    if (String(m.status) === "complete" || !m.due_date) continue;
    const due = new Date(String(m.due_date));
    if (Number.isNaN(due.getTime())) continue;
    const days = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
    if (days <= 21) {
      add({
        id: `milestone-${m.id}`,
        title: `Prepare for milestone: ${String(m.title)}`,
        why:
          days < 0
            ? `This milestone was due ${Math.abs(days)} day(s) ago and is still open. Overdue milestones compress everything behind them, and in a senior-design schedule the compression usually lands on the test programme — the part that generates the evidence your report needs.`
            : `Due in ${days} day(s). Work backwards from the deliverable now: anything needing a test, a purchase or an advisor signature has a lead time that a ${days}-day window may not absorb.`,
        evidence: String(
          m.notes ||
            "The deliverable the milestone calls for, completed and recorded in the workspace, with the milestone marked complete.",
        ),
        module: "Dashboard",
        href: "/",
        category: "schedule",
        factors: [
          { label: days < 0 ? "Overdue" : "Deadline approaching", points: days < 0 ? 45 : Math.max(10, 35 - days) },
        ],
      });
    }
  }

  // --- Pending AI recommendations ----------------------------------------
  if (snap.completion.pendingRecommendations > 0) {
    add({
      id: "pending-recs",
      title: `Decide on ${snap.completion.pendingRecommendations} pending assistant recommendation(s)`,
      why: "Recommendations sit in a pending state until you accept, edit, reject or defer them with a reason. Nothing is applied to your project data automatically.",
      evidence: "Each recommendation resolved with a recorded reason.",
      module: "Assistant",
      href: "/assistant",
      category: "progress",
      factors: [{ label: "Open decisions awaiting you", points: 15 }],
    });
  }

  // --- Reporting ----------------------------------------------------------
  if (snap.testRuns.length > 0 && snap.decisions.length === 0) {
    add({
      id: "record-decision",
      title: "Record the design decisions you have already made",
      why: "You have test data but no decision records. Design reviews ask why you chose this syringe, this hull, this control strategy — and the answer is much easier to write down now than to reconstruct later.",
      evidence: "A decision record with alternatives, criteria, the evidence used, and the final choice.",
      module: "Decisions",
      href: "/decisions",
      category: "progress",
      factors: [{ label: "Report and review readiness", points: 20 }],
    });
  }

  return actions.sort((a, b) => b.score - a.score);
}

import { formatQty, convert } from "@/lib/units";
import { computeBuoyancy } from "@/lib/calc/buoyancy";
import { computeSyringeEngine, sweepSyringe } from "@/lib/calc/syringe";
import { comparePredictionToMeasurement } from "@/lib/analysis/stats";
import type { ProjectSnapshot } from "@/lib/project/snapshot";
import { rankNextActions } from "./nextActions";
import type { AssistantAnswer, AssistantProvider, Citation } from "./types";

/**
 * Deterministic, rules-based project assistant.
 *
 * This is the default provider and needs no API key. It answers from the
 * project's own stored data, cites the exact values it used, and states what
 * it could not find. It never writes to the project: any change it proposes
 * is returned as a `proposedChange` for the user to accept, edit, reject or
 * defer.
 *
 * It is a calculator and a librarian, not an oracle. Where a question needs
 * judgement rather than arithmetic, the answer says so.
 */

interface Intent {
  id: string;
  patterns: RegExp[];
  handler: (q: string, snap: ProjectSnapshot) => AssistantAnswer;
}

const fmt = (v: number | undefined, unit: string, digits = 4): string =>
  v === undefined || !Number.isFinite(v) ? "not available" : formatQty({ value: v, unit }, digits);

function base(intent: string): AssistantAnswer {
  return {
    answer: "",
    calculations: [],
    advice: [],
    citations: [],
    missingData: [],
    safetyFlag: false,
    provider: "local-rules",
    intent,
  };
}

function coreCitations(snap: ProjectSnapshot): Citation[] {
  return [
    {
      label: "Total vehicle mass",
      value: fmt(snap.massProps.values.totalMass.value, "kg"),
      source: `Sum over ${snap.components.length} components in the inventory`,
      href: "/components",
    },
    {
      label: "Total displaced volume",
      value: fmt(snap.massProps.values.totalDisplacedVolume.value * 1e6, "cm^3"),
      source: "Water-exposed component volumes",
      href: "/mass",
    },
    {
      label: "Water density",
      value: fmt(snap.water.densitySI, "kg/m^3", 6),
      source: snap.water.source,
      href: "/settings",
    },
  ];
}

/* ------------------------------------------------------------------ */

const INTENTS: Intent[] = [
  {
    id: "missing-data",
    patterns: [/what.*missing/i, /what.*(don't|do not|dont).*(have|know)/i, /gaps?/i, /incomplete/i],
    handler: (_q, snap) => {
      const a = base("missing-data");
      const missing: string[] = [];
      if (snap.components.length === 0) missing.push("No components have been entered at all.");
      if (snap.massProps.missingMass.length > 0)
        missing.push(`Mass for: ${snap.massProps.missingMass.join(", ")}.`);
      if (snap.massProps.missingVolume.length > 0)
        missing.push(`Displaced volume for: ${snap.massProps.missingVolume.join(", ")}.`);
      if (snap.settings.syringe.frictionForceSI === undefined)
        missing.push("Plunger/seal friction of the syringe (currently taken as zero).");
      if (snap.settings.syringe.leadSI === undefined) missing.push("Lead-screw lead (travel per revolution).");
      if (snap.settings.syringe.motorTorqueSI === undefined) missing.push("Motor available torque.");
      if (snap.settings.syringe.screwEfficiency === undefined)
        missing.push("Lead-screw efficiency (0.30 is being assumed, which can be wrong by a factor of three).");
      if (snap.settings.hydro.coefficientSource === "assumed")
        missing.push("Measured lift and drag coefficients — the current values are placeholders.");
      if (snap.electronics.length === 0) missing.push("Electrical loads for the power budget.");
      if (snap.testRuns.length === 0) missing.push("Any experimental data at all.");
      const openAssm = snap.assumptions.filter((x) => String(x.status) === "open");
      if (openAssm.length > 0) missing.push(`${openAssm.length} unresolved assumption(s).`);
      const unverified = snap.requirements.filter((r) => String(r.verification_status) !== "verified");
      if (unverified.length > 0) missing.push(`${unverified.length} unverified requirement(s).`);

      a.missingData = missing;
      a.answer =
        missing.length === 0
          ? "I could not find any gaps in the data I check: masses, volumes, syringe drivetrain, hydrodynamic coefficients, electrical loads, assumptions and requirement verification are all populated. That does not mean the design is right — only that the workspace is complete."
          : `I found **${missing.length}** gap(s) in the project data. They are listed below, ordered roughly by how much downstream work they block.`;
      a.citations = coreCitations(snap);
      a.advice = [
        "Missing data is not the same as an estimate. A component with no mass is counted as zero, which quietly biases the CG — an estimate at least carries a plausible number and a provenance tag.",
      ];
      return a;
    },
  },

  {
    id: "syringe-adequate",
    patterns: [/syringe.*(big|large|enough|adequate|sufficient)/i, /enough buoyancy/i, /buoyancy authority/i],
    handler: (_q, snap) => {
      const a = base("syringe-adequate");
      const authority = snap.syringe.values.buoyancyForceChange.value;
      const authorityMass = snap.syringe.values.buoyancyMassChange.value;
      const weight = snap.buoyancy.values.weight.value;
      const vol = snap.syringe.values.usableVolumeChange.value;
      const arch = snap.settings.syringe.config;

      a.calculations = [
        {
          label: "Usable swept volume",
          value: fmt(vol * 1e6, "cm^3"),
          equation: "dV = A_p * x_usable",
        },
        {
          label: "Buoyancy change",
          value: fmt(authority, "N"),
          equation: "dF = rho * g * dV",
          note: `equivalent to ${fmt(authorityMass * 1000, "g")} of ballast`,
        },
        {
          label: "Buoyancy change as a fraction of vehicle weight",
          value: weight > 0 ? `${((authority / weight) * 100).toFixed(2)} %` : "not available (vehicle weight unknown)",
        },
      ];
      a.citations = [
        ...coreCitations(snap),
        {
          label: "Engine architecture",
          value: arch,
          source: "Project settings, syringe engine",
          href: "/syringe",
        },
        {
          label: "Bore x usable stroke",
          value: `${(snap.settings.syringe.boreDiameterSI * 1000).toFixed(1)} mm x ${(snap.settings.syringe.usableStrokeSI * 1000).toFixed(1)} mm`,
          source: "Project settings, syringe engine",
          href: "/syringe",
        },
      ];

      if (!(weight > 0)) {
        a.missingData.push("Vehicle weight — enter component masses so the authority can be compared with something.");
        a.answer = `The engine delivers **${fmt(authority, "N")}** of buoyancy change (${fmt(vol * 1e6, "cm^3")} swept). I cannot say whether that is enough, because the vehicle has no mass entered to compare it against.`;
        return a;
      }
      const pct = (authority / weight) * 100;
      let verdict: string;
      if (pct < 0.5)
        verdict = `**Probably not.** ${pct.toFixed(2)}% of vehicle weight is very little. Below roughly 1% the vehicle drifts rather than glides, and any trim or build error swamps the control authority.`;
      else if (pct < 1)
        verdict = `**Marginal.** ${pct.toFixed(2)}% of vehicle weight will move the vehicle, but slowly, and leaves almost no margin for a mis-estimated mass or a wet foam.`;
      else if (pct <= 4)
        verdict = `**Plausible.** ${pct.toFixed(2)}% of vehicle weight is in the range small gliders commonly use. This is a scoping judgement, not a verified result.`;
      else
        verdict = `**More than typical.** ${pct.toFixed(2)}% of vehicle weight is a lot of authority. That is not wrong — it buys brisk cycles — but it costs actuator force, energy and stroke.`;

      a.answer = `${verdict}\n\nThe comparison band (roughly 1-3% of weight) is a rule of thumb from small-glider practice, not a requirement. Set your own requirement for vertical speed and check against that instead.`;
      a.advice = [
        "Judge the engine against a requirement you have written down (target vertical speed, or time to reach depth), not against a rule of thumb.",
        "Whatever the number says, the authority is only real if the actuator can complete the stroke at depth — check the stall margin on the syringe page.",
      ];
      a.safetyFlag = false;
      if (snap.settings.syringe.frictionForceSI === undefined) {
        a.missingData.push("Measured plunger friction — without it the actuator feasibility side of this answer is unreliable.");
      }
      return a;
    },
  },

  {
    id: "riskiest-assumption",
    patterns: [/(which|what).*(assumption|risk).*(most|biggest|greatest|highest)/i, /riskiest/i, /technical risk/i],
    handler: (_q, snap) => {
      const a = base("riskiest-assumption");
      const candidates: { text: string; why: string; points: number }[] = [];

      if (snap.settings.syringe.frictionForceSI === undefined) {
        candidates.push({
          text: "Plunger and seal friction is zero",
          why: "It is currently assumed to be zero. On a rubber-tipped syringe, breakaway friction of several newtons is common — at shallow depth that can exceed the hydrostatic load entirely, so the motor sizing could be wrong by a large factor.",
          points: 95,
        });
      }
      if (snap.settings.syringe.screwEfficiency === undefined) {
        candidates.push({
          text: "Lead-screw efficiency of 0.30",
          why: "Sliding-contact screws run anywhere from 0.2 to 0.4, ball screws from 0.85 to 0.95. Required motor torque scales inversely with this number, so the assumption alone spans a factor of three.",
          points: 80,
        });
      }
      if (snap.settings.hydro.coefficientSource === "assumed") {
        candidates.push({
          text: "Lift and drag coefficients are placeholders",
          why: "Glide speed, glide ratio, range and mission duration all follow from these. A component drag buildup on a student-built vehicle is routinely 30-50% off measurement.",
          points: 75,
        });
      }
      if (snap.massProps.missingVolume.length > 0) {
        candidates.push({
          text: `Displacement volume missing for ${snap.massProps.missingVolume.length} component(s)`,
          why: "Missing volumes are counted as zero, so the centre of buoyancy — and therefore the entire stability conclusion — is built on incomplete geometry.",
          points: 85,
        });
      }
      if (snap.massProps.missingMass.length > 0) {
        candidates.push({
          text: `Mass missing for ${snap.massProps.missingMass.length} component(s)`,
          why: "Zero-mass components bias both the total mass and the CG, and buoyancy is a small difference between two large numbers — a few percent of mass error can flip the sign of net buoyancy.",
          points: 90,
        });
      }
      if (snap.settings.battery.provenance === "estimated") {
        candidates.push({
          text: "Battery capacity is an estimate",
          why: "Endurance scales linearly with it, and nameplate capacity on inexpensive cells is frequently optimistic.",
          points: 45,
        });
      }
      if (snap.settings.structure.materialProvenance !== "user") {
        candidates.push({
          text: "Structural material properties are unverified library values",
          why: "Any pressure-housing pass/fail conclusion rests on them. This is a safety-relevant assumption.",
          points: 70,
        });
      }
      for (const asm of snap.assumptions.filter((x) => String(x.status) === "open")) {
        candidates.push({
          text: String(asm.text),
          why: String(asm.basis || "Recorded in the assumptions register and not yet resolved."),
          points: String(asm.criticality) === "high" ? 88 : String(asm.criticality) === "low" ? 30 : 55,
        });
      }

      candidates.sort((x, y) => y.points - x.points);
      if (candidates.length === 0) {
        a.answer = "I could not identify an unresolved assumption in the data I track. That is unusual — check the assumptions register directly, because an empty register more often means nothing has been recorded than that nothing is uncertain.";
        return a;
      }
      a.answer =
        `The assumption creating the most technical risk right now is:\n\n**${candidates[0].text}**\n\n${candidates[0].why}\n\n` +
        (candidates.length > 1
          ? `Next in line:\n${candidates.slice(1, 4).map((c, i) => `${i + 2}. **${c.text}** — ${c.why}`).join("\n")}`
          : "");
      a.advice = [
        "This ranking is a heuristic over the data in the workspace, not a formal sensitivity analysis. If you want a defensible answer, use the uncertainty tool to propagate each candidate through the calculation it feeds and compare the resulting spread.",
      ];
      a.citations = coreCitations(snap);
      a.safetyFlag = candidates[0].text.toLowerCase().includes("material") || candidates[0].text.toLowerCase().includes("pressure");
      return a;
    },
  },

  {
    id: "ballast",
    patterns: [/(how much|what).*(ballast|weight).*(add|need|remove)/i, /neutral(ly)? buoyan/i, /trim weight/i],
    handler: (_q, snap) => {
      const a = base("ballast");
      const mNet = snap.buoyancy.values.netBuoyantMass.value;
      const fNet = snap.buoyancy.values.netBuoyantForce.value;

      if (!Number.isFinite(mNet)) {
        a.missingData.push("Component masses and displacement volumes — the buoyancy budget cannot be evaluated.");
        a.answer = "I cannot compute the ballast requirement: the mass or displacement budget is incomplete.";
        return a;
      }
      const grams = mNet * 1000;
      a.calculations = [
        { label: "Net buoyant force", value: fmt(fNet, "N"), equation: "F_net = rho*g*V - m*g" },
        {
          label: "Ballast to reach neutral",
          value: `${Math.abs(grams).toFixed(1)} g to ${grams > 0 ? "ADD" : "REMOVE"}`,
          equation: "m_net = rho_water * V_displaced - m_vehicle",
        },
        {
          label: "Alternative: change displacement instead",
          value: `${Math.abs(snap.neutral.volumeChangeSI * 1e6).toFixed(1)} cm^3 to ${snap.neutral.volumeChangeSI > 0 ? "ADD" : "REMOVE"}`,
          note: "Adding foam instead of removing mass increases drag and the buoyancy authority you need.",
        },
      ];
      a.answer =
        grams > 0
          ? `By the current budget the vehicle is **${Math.abs(grams).toFixed(1)} g light** — add that much ballast to reach neutral. Equivalently, remove ${Math.abs(snap.neutral.volumeChangeSI * 1e6).toFixed(1)} cm^3 of displacement.`
          : `By the current budget the vehicle is **${Math.abs(grams).toFixed(1)} g heavy** — remove that much mass, or add ${Math.abs(snap.neutral.volumeChangeSI * 1e6).toFixed(1)} cm^3 of displacement (foam).`;
      a.advice = [
        "Trim ballast against a measurement, not against this budget. Float the assembled vehicle in the tank it will be tested in, at the temperature it will be tested at, and add shot until it hovers. A budget built from estimates is rarely accurate to better than a few percent, and a few percent of vehicle mass is a lot of ballast.",
        "Leave the buoyancy engine at mid-stroke while trimming, so you keep authority in both directions.",
        "Ballast position matters as much as its mass — putting it low raises the CB-CG separation and improves roll stability.",
      ];
      a.citations = coreCitations(snap);
      return a;
    },
  },

  {
    id: "what-if-mass",
    patterns: [/what happens if.*(mass|weight)/i, /(increase|add|heavier).*(\d+)\s*(g|gram|kg)/i, /sensitivit/i],
    handler: (q, snap) => {
      const a = base("what-if-mass");
      const m = q.match(/(-?\d+(?:\.\d+)?)\s*(mg|g|grams?|kg|kilograms?|lb|oz)/i);
      let deltaKg = 0.2;
      let label = "200 g";
      if (m) {
        const unitRaw = m[2].toLowerCase();
        const unit = unitRaw.startsWith("kg") || unitRaw.startsWith("kilo") ? "kg" : unitRaw.startsWith("lb") ? "lb" : unitRaw.startsWith("oz") ? "oz" : unitRaw === "mg" ? "mg" : "g";
        deltaKg = convert(parseFloat(m[1]), unit, "kg");
        label = `${m[1]} ${unit}`;
      }
      const decrease = /decrease|reduce|lighter|remove|lose/i.test(q);
      if (decrease) deltaKg = -Math.abs(deltaKg);

      const V = snap.massProps.values.totalDisplacedVolume.value;
      const rho = snap.water.densitySI;
      const m0 = snap.massProps.values.totalMass.value;
      const before = snap.buoyancy;
      const after = computeBuoyancy({
        displacedVolumeSI: V,
        waterDensitySI: rho,
        massSI: m0 + deltaKg,
        gravitySI: snap.settings.environment.gravitySI,
      });

      const authority = snap.syringe.values.buoyancyForceChange.value;
      const deltaF = after.values.netBuoyantForce.value - before.values.netBuoyantForce.value;

      a.calculations = [
        { label: "Vehicle mass before", value: fmt(m0, "kg") },
        { label: "Vehicle mass after", value: fmt(m0 + deltaKg, "kg") },
        { label: "Net buoyant force before", value: fmt(before.values.netBuoyantForce.value, "N") },
        { label: "Net buoyant force after", value: fmt(after.values.netBuoyantForce.value, "N") },
        { label: "Change in net buoyancy", value: fmt(deltaF, "N"), equation: "dF = -dm * g" },
        {
          label: "Change as a fraction of the engine's authority",
          value: authority > 0 ? `${((Math.abs(deltaF) / authority) * 100).toFixed(0)} % of the full stroke` : "not available",
        },
      ];
      a.answer =
        `Adding ${label} changes net buoyancy by **${fmt(deltaF, "N")}**, from ${fmt(before.values.netBuoyantForce.value, "N")} to ${fmt(after.values.netBuoyantForce.value, "N")}.` +
        (authority > 0
          ? ` That consumes **${((Math.abs(deltaF) / authority) * 100).toFixed(0)}%** of the buoyancy engine's total authority (${fmt(authority, "N")}), so ${Math.abs(deltaF) > authority ? "the engine could NOT compensate for it — the vehicle would be stuck negative." : "the engine could still compensate, with the remainder available for gliding."}`
          : "");
      a.advice = [
        "Mass added late in a build (potting compound, extra fasteners, a thicker cable) is a classic reason a glider ends up unable to surface. Keep a mass margin explicitly in the budget rather than discovering it at the pool.",
        "The CG also moves when you add mass, which changes the trim. Add the item as a component and re-run the stability page rather than reasoning about mass alone.",
      ];
      a.citations = coreCitations(snap);
      return a;
    },
  },

  {
    id: "diameter-torque",
    patterns: [/(diameter|bore).*(torque|force)/i, /torque.*(diameter|bore)/i, /how does.*affect/i],
    handler: (_q, snap) => {
      const a = base("diameter-torque");
      const s = snap.settings.syringe;
      const base0 = {
        config: s.config,
        boreDiameterSI: s.boreDiameterSI,
        maxStrokeSI: s.maxStrokeSI,
        usableStrokeSI: s.usableStrokeSI,
        waterDensitySI: snap.water.densitySI,
        depthSI: snap.settings.mission.targetDepthSI,
        gravitySI: snap.settings.environment.gravitySI,
        surfacePressureSI: snap.settings.environment.surfacePressureSI,
        frictionForceSI: s.frictionForceSI,
        mechanismEfficiency: s.mechanismEfficiency,
        leadSI: s.leadSI,
        screwEfficiency: s.screwEfficiency,
        gearRatio: s.gearRatio,
        gearEfficiency: s.gearEfficiency,
        motorTorqueSI: s.motorTorqueSI,
        safetyFactor: s.safetyFactor,
        syringeCount: s.syringeCount,
      };
      const diameters = [0.5, 0.75, 1, 1.25, 1.5].map((k) => s.boreDiameterSI * k);
      const sweep = sweepSyringe(base0, "boreDiameterSI", diameters);

      a.calculations = sweep.map((p) => ({
        label: `Bore ${(p.variable * 1000).toFixed(1)} mm`,
        value: `dV ${p.usableVolumeCm3.toFixed(1)} cm^3, dF ${p.buoyancyForceN.toFixed(3)} N, F_req ${p.requiredForceN.toFixed(2)} N${p.motorTorqueMNm !== undefined ? `, T_motor ${p.motorTorqueMNm.toFixed(2)} mN*m` : ""}`,
      }));
      a.answer = `Bore diameter enters twice, and that is the whole story:

- **Swept volume scales with D²** — doubling the bore quadruples the buoyancy change for the same stroke.
- **Pressure force also scales with D²**, because \`F = ΔP · A_p\` and \`A_p = πD²/4\`.

So required force, and therefore required screw torque, grow with the **square** of bore diameter while buoyancy authority grows at exactly the same rate. A bigger syringe never gets you authority for free: it buys volume at a proportional cost in force.

What genuinely changes the trade is **stroke** (linear in volume, no effect on pressure force at all) and **lead-screw lead** (linear in torque, inverse in speed). If you are torque-limited, shorten the lead or lengthen the stroke before you widen the bore.`;
      a.advice = [
        "Because force and volume both scale as D², the cheapest way out of a torque problem is usually a finer lead screw or a gearbox, not a different syringe.",
        "A longer stroke costs you actuation time and packaging length instead of torque, which is often the easier constraint on a small vehicle.",
      ];
      a.citations = [
        {
          label: "Current bore",
          value: `${(s.boreDiameterSI * 1000).toFixed(2)} mm`,
          source: "Project settings, syringe engine",
          href: "/syringe",
        },
        {
          label: "Operating depth used for the pressure force",
          value: `${snap.settings.mission.targetDepthSI} m`,
          source: "Project settings, mission",
          href: "/settings",
        },
      ];
      return a;
    },
  },

  {
    id: "move-battery",
    patterns: [/where.*(move|put|place).*(battery|mass|ballast)/i, /improve trim/i, /pitch trim/i],
    handler: (_q, snap) => {
      const a = base("move-battery");
      const dz = snap.stability.values.verticalSeparation.value;
      const dx = snap.stability.values.longitudinalSeparation.value;
      const pitch = (snap.stability.values.equilibriumPitch.value * 180) / Math.PI;
      const total = snap.massProps.values.totalMass.value;

      const heavy = [...snap.massProps.contributions].sort((x, y) => y.massSI - x.massSI).slice(0, 3);

      a.calculations = [
        { label: "Current equilibrium pitch", value: `${pitch.toFixed(2)} deg (nose-up positive)` },
        { label: "Longitudinal CB-CG offset", value: fmt(dx * 1000, "mm") },
        { label: "Vertical CB-CG offset", value: fmt(dz * 1000, "mm") },
        { label: "Total vehicle mass", value: fmt(total, "kg") },
      ];
      if (heavy.length > 0 && total > 0) {
        for (const h of heavy) {
          const perMm = (h.massSI * 0.001) / total; // CG shift per mm of component travel
          a.calculations.push({
            label: `Sensitivity: moving "${h.name}" (${(h.massSI * 1000).toFixed(0)} g)`,
            value: `${(perMm * 1000).toFixed(3)} mm of CG shift per 1 mm of component travel`,
            equation: "d(x_CG) = m_component * delta / M_total",
          });
        }
      }
      a.answer = `Right now the vehicle settles at **${pitch.toFixed(1)}°** (nose-${pitch >= 0 ? "up" : "down"}), because the CB sits ${Math.abs(dx * 1000).toFixed(1)} mm ${dx >= 0 ? "forward of" : "aft of"} the CG.

To change pitch you move the **CG longitudinally**: moving mass aft pitches the nose up, moving it forward pitches the nose down. The heaviest items give the most authority per millimetre of travel, which is why the battery is the usual trim mass.

I have not proposed a specific move here because there is no unique answer — use the **trim solver** on the Stability page, which takes your target pitch and each component's allowed travel and reports what each one would have to do.`;
      a.advice = [
        "Do not move mass vertically to fix pitch. Vertical position sets the CB-CG separation, which is what keeps the vehicle upright at all; trading it away for trim is a bad exchange.",
        "Check that whatever you move does not also change the displaced volume — if the item is water-exposed, moving it moves the CB too and partly cancels the effect.",
      ];
      a.citations = coreCitations(snap);
      return a;
    },
  },

  {
    id: "unverified-requirements",
    patterns: [/(which|what).*requirement.*(not|un).*verif/i, /verification status/i, /traceab/i],
    handler: (_q, snap) => {
      const a = base("unverified-requirements");
      const unverified = snap.requirements.filter((r) => String(r.verification_status) !== "verified");
      a.answer =
        snap.requirements.length === 0
          ? "There are no requirements recorded yet, so nothing can be verified. Start on the Requirements page."
          : unverified.length === 0
            ? `All ${snap.requirements.length} requirements are marked verified. Check that each has evidence attached — a status without evidence will not survive a design review.`
            : `**${unverified.length} of ${snap.requirements.length}** requirements are not yet verified:\n\n${unverified
                .slice(0, 15)
                .map((r) => `- **${r.key}** ${r.title} — status: *${r.verification_status}*, method: ${r.verification_method}`)
                .join("\n")}${unverified.length > 15 ? `\n- …and ${unverified.length - 15} more` : ""}`;
      a.citations = unverified.slice(0, 5).map((r) => ({
        label: String(r.key),
        value: String(r.title),
        source: `Verification method: ${r.verification_method}, status: ${r.verification_status}`,
        href: "/requirements",
      }));
      a.advice = ["A requirement is only verified when there is evidence attached — a test run, a calculation snapshot, an inspection record or a demonstration. Status alone is a claim, not proof."];
      return a;
    },
  },

  {
    id: "what-to-test",
    patterns: [/what.*(should|do).*(test|try|work on|do next)/i, /next step/i, /priorit/i],
    handler: (_q, snap) => {
      const a = base("what-to-test");
      const actions = rankNextActions(snap).slice(0, 5);
      a.answer =
        actions.length === 0
          ? "I have no ranked suggestions — the checks I run all pass. Look at the requirement verification status for what remains."
          : `Ranked by technical risk, dependencies and missing information:\n\n${actions
              .map((x, i) => `${i + 1}. **${x.title}** *(score ${x.score})*\n   - Why: ${x.why}\n   - Evidence that closes it: ${x.evidence}`)
              .join("\n\n")}`;
      a.advice = ["The ranking is deterministic — it comes from the same rules the dashboard uses, so it will not change unless your project data changes."];
      a.citations = coreCitations(snap);
      return a;
    },
  },

  {
    id: "measured-vs-predicted",
    patterns: [/(why|how).*(measured|actual).*(differ|different|slower|faster|off)/i, /predict.*(vs|versus|against).*measur/i, /discrepanc/i],
    handler: (_q, snap) => {
      const a = base("measured-vs-predicted");
      if (snap.testRuns.length === 0) {
        a.missingData.push("Any test data — no runs have been recorded.");
        a.answer =
          "There is no measured data in the project yet, so I cannot compare anything. Record a test run with raw data first; the Tests & Data page will then compute bias, RMSE and a calibration factor against the prediction.";
        return a;
      }
      a.answer = `I can compare predictions with measurements once you tell the Tests & Data page which prediction pairs with which measured column — that comparison lives there, with residual and predicted-versus-measured plots.

For glide speed specifically, the usual reasons a measurement comes in **slower** than the buildup predicts are, roughly in order of how often they turn out to be the culprit:

1. **Appendage and roughness drag** that the buildup omits — brackets, screw heads, tape seams, a wet antenna, an attached tether. This alone is commonly 10-40% of total drag on a student-built vehicle and is zero in the model unless you enter an allowance.
2. **The vehicle never reached steady glide.** In a shallow pool the dive is over in seconds; if the acceleration transient is a large fraction of the run, the average speed is well below the equilibrium speed the model reports.
3. **Net buoyancy is not what you think.** Buoyancy is a small difference between two large numbers, so a few grams of trapped air or wet foam changes the driving force by a large percentage.
4. **The vehicle is not trimmed to the assumed angle of attack**, so the real C_L and C_D are not the ones in the model.
5. **Wall and free-surface effects** in a small tank.

Work down that list before you touch the drag coefficient — tuning a coefficient to absorb a missing physical effect makes the model fit today's data and mispredict tomorrow's.`;
      a.advice = [
        "Set the velocity time constant in the mission simulator to a few seconds and re-run. If the predicted distance changes a lot, the transient is a real part of your discrepancy, not a modelling detail.",
        "When you do calibrate, hold back some runs from the fit so you still have an independent check.",
      ];
      a.citations = [
        { label: "Test runs recorded", value: String(snap.testRuns.length), source: "Tests & Data", href: "/tests" },
        {
          label: "Current coefficient source",
          value: snap.settings.hydro.coefficientSource,
          source: "Project settings, hydrodynamics",
          href: "/hydro",
        },
        {
          label: "Appendage drag allowance",
          value: fmt(snap.settings.vehicle.appendageDragAreaSI * 1e4, "cm^2"),
          source: "Project settings, vehicle",
          href: "/settings",
        },
      ];
      return a;
    },
  },

  {
    id: "weekly-summary",
    patterns: [/summar/i, /progress this week/i, /what have (i|we) done/i],
    handler: (_q, snap) => {
      const a = base("weekly-summary");
      const weekAgo = Date.now() - 7 * 86_400_000;
      const recent = (rows: { created_at?: unknown }[]) =>
        rows.filter((r) => {
          const t = Date.parse(String(r.created_at ?? ""));
          return Number.isFinite(t) && t >= weekAgo;
        }).length;

      const lines = [
        `- Components added: ${recent(snap.components)}`,
        `- Requirements added: ${recent(snap.requirements)}`,
        `- Calculations run: ${recent(snap.calculations)}`,
        `- Test runs recorded: ${recent(snap.testRuns)}`,
        `- Notebook entries: ${recent(snap.notebook)}`,
        `- Decisions recorded: ${recent(snap.decisions)}`,
      ];
      a.answer = `**Project:** ${snap.project.name}  \n**Phase:** ${snap.project.phase}  \n**Overall completion:** ${snap.completion.percent.toFixed(0)}%

**Activity in the last 7 days**
${lines.join("\n")}

**Current engineering state**
- Vehicle mass: ${fmt(snap.massProps.values.totalMass.value, "kg")}
- Displaced volume: ${fmt(snap.massProps.values.totalDisplacedVolume.value * 1e6, "cm^3")}
- Net buoyancy: ${fmt(snap.buoyancy.values.netBuoyantForce.value, "N")}
- Buoyancy engine authority: ${fmt(snap.syringe.values.buoyancyForceChange.value, "N")}
- Requirements verified: ${snap.completion.requirementsVerified} of ${snap.completion.requirementsTotal}
- Open risks: ${snap.completion.openRisks}, open assumptions: ${snap.completion.openAssumptions}

**Warnings raised by the current model:** ${snap.warnings.filter((w) => w.warning.severity === "error").length} error(s), ${snap.warnings.filter((w) => w.warning.severity === "warning").length} warning(s).`;
      a.citations = coreCitations(snap);
      return a;
    },
  },

  {
    id: "advisor-meeting",
    patterns: [/advisor/i, /meeting/i, /design review/i, /prepare me/i],
    handler: (_q, snap) => {
      const a = base("advisor-meeting");
      const actions = rankNextActions(snap).slice(0, 3);
      const errs = snap.warnings.filter((w) => w.warning.severity === "error").slice(0, 5);
      a.answer = `**Advisor meeting brief — ${snap.project.name}**

**Where the project stands**
- Phase: ${snap.project.phase}; overall completion ${snap.completion.percent.toFixed(0)}%
- Vehicle: ${fmt(snap.massProps.values.totalMass.value, "kg")}, displacing ${fmt(snap.massProps.values.totalDisplacedVolume.value * 1e6, "cm^3")}, net buoyancy ${fmt(snap.buoyancy.values.netBuoyantForce.value, "N")}
- Buoyancy engine: ${snap.settings.syringe.config}, ${fmt(snap.syringe.values.usableVolumeChange.value * 1e6, "cm^3")} swept, ${fmt(snap.syringe.values.buoyancyForceChange.value, "N")} of authority
- Static equilibrium pitch ${((snap.stability.values.equilibriumPitch.value * 180) / Math.PI).toFixed(1)}°, CB-CG vertical separation ${fmt(snap.stability.values.verticalSeparation.value * 1000, "mm")}
- Requirements verified: ${snap.completion.requirementsVerified} of ${snap.completion.requirementsTotal}

**What I would raise first**
${actions.map((x, i) => `${i + 1}. ${x.title} — ${x.why}`).join("\n")}

**Open technical issues the model is flagging**
${errs.length === 0 ? "- None at error severity." : errs.map((e) => `- [${e.module}] ${e.warning.message}`).join("\n")}

**Questions worth asking your advisor**
- Is the buoyancy authority target (currently ${snap.buoyancy.values.weight.value > 0 ? ((snap.syringe.values.buoyancyForceChange.value / snap.buoyancy.values.weight.value) * 100).toFixed(1) + "% of weight" : "not yet comparable"}) appropriate for the test facility available?
- What depth of validation does the course expect — bench tests, tank tests, or a full pool mission?
- Which of the unverified assumptions would they consider acceptable to carry into the final report?

Every number above comes from your entered data; none of it has been validated against a physical test unless a test run says so.`;
      a.citations = coreCitations(snap);
      a.advice = ["Bring the raw data, not just the summary. Advisors ask where a number came from, and 'the tool computed it' is only an answer if you can show the inputs."];
      return a;
    },
  },

  {
    id: "draft-report",
    patterns: [/draft/i, /write.*(section|report|paragraph)/i, /report section/i],
    handler: (_q, snap) => {
      const a = base("draft-report");
      const b = snap.buoyancy;
      const mp = snap.massProps;
      a.answer = `Here is a draft **Buoyancy Budget** section built only from values in this project. Every number is traceable; nothing has been invented. Edit the wording, and check every claim before submitting it.

---

### Buoyancy budget

The vehicle mass was established by summing ${snap.components.length} catalogued components, giving a total dry mass of ${fmt(mp.values.totalMass.value, "kg")}. Water-exposed components contribute a total displaced volume of ${fmt(mp.values.totalDisplacedVolume.value * 1e6, "cm^3")}.

Water density was taken as ${fmt(snap.water.densitySI, "kg/m^3", 6)}, obtained from ${snap.water.source}.

Applying Archimedes' principle, F_B = ρ g V:

- Buoyant force: ${fmt(b.values.buoyantForce.value, "N")}
- Weight: ${fmt(b.values.weight.value, "N")}
- **Net buoyant force: ${fmt(b.values.netBuoyantForce.value, "N")}**, equivalent to ${fmt(Math.abs(b.values.netBuoyantMass.value) * 1000, "g")} of ballast ${b.values.netBuoyantMass.value >= 0 ? "to be added" : "to be removed"}.

The average vehicle density is ${fmt(b.values.averageDensity.value, "kg/m^3")}, against a water density of ${fmt(snap.water.densitySI, "kg/m^3", 6)}.

${mp.missingMass.length > 0 || mp.missingVolume.length > 0 ? `**Limitation.** ${mp.missingMass.length} component(s) have no recorded mass and ${mp.missingVolume.length} have no recorded displaced volume; these are counted as zero, so the budget above is a lower bound and the stated net buoyancy is not yet reliable.` : "All catalogued components have a recorded mass and, where water-exposed, a recorded displaced volume."}

**Assumptions.** The vehicle is treated as fully submerged; water density is uniform and independent of depth; hull compression and foam water absorption are not modelled.

---

Sections I can draft the same way from your data: mass properties and CG/CB, buoyancy-engine sizing, stability and trim, power and energy budget, mission simulation, requirements traceability. Ask for one by name, or generate the full document from the Reports page.`;
      a.advice = [
        "Do not paste this into a report without checking it. It is assembled from your inputs and inherits every one of their errors.",
        "A report section that states its limitations reads as more competent, not less. Keep the limitation paragraph.",
      ];
      a.citations = coreCitations(snap);
      return a;
    },
  },
];

/* ------------------------------------------------------------------ */

function fallback(question: string, snap: ProjectSnapshot): AssistantAnswer {
  const a = base("fallback");
  a.answer = `I could not match that to one of the questions I answer deterministically from project data.

Without an external AI provider configured, I answer from a fixed set of engineering questions rather than from open-ended language understanding. Try one of these, or rephrase towards one:

- What information is still missing?
- Is the current syringe large enough?
- Which assumption creates the most technical risk?
- How much ballast should I add?
- What happens if vehicle mass increases by 200 grams?
- How does syringe diameter affect required motor torque?
- Where should I move the battery to improve trim?
- Which requirements have not been verified?
- What should I test next?
- Why did the measured glide speed differ from the prediction?
- Summarise the project's progress this week.
- Prepare me for my advisor meeting.
- Draft a section of my design report.

To get free-form answers, set \`ASSISTANT_PROVIDER=anthropic\` and \`ANTHROPIC_API_KEY\` in \`.env.local\`. The key stays server-side and the same project data shown below is what would be passed as context.`;
  a.citations = coreCitations(snap);
  a.missingData = [`No handler matched: "${question.slice(0, 120)}"`];
  return a;
}

export class LocalAssistant implements AssistantProvider {
  readonly name = "local-rules";
  readonly available = true;

  async answer(
    question: string,
    snap: ProjectSnapshot,
    _history: { role: string; content: string }[] = [],
  ): Promise<AssistantAnswer> {
    // History is accepted for interface compatibility but deliberately unused:
    // this provider is stateless, so the same question on the same data always
    // produces the same answer.
    let best: { intent: Intent; score: number } | null = null;
    for (const intent of INTENTS) {
      let score = 0;
      for (const p of intent.patterns) if (p.test(question)) score++;
      if (score > 0 && (!best || score > best.score)) best = { intent, score };
    }
    const result = best ? best.intent.handler(question, snap) : fallback(question, snap);
    // Every answer carries the standing caveat about what this tool is.
    result.advice = [
      ...result.advice,
      "This answer is generated from your project data by a deterministic rules engine. It is engineering support, not a verified engineering result, and it is not a substitute for your own judgement or your advisor's review.",
    ];
    return result;
  }
}

/** Exposed for the comparison tooling and tests. */
export { comparePredictionToMeasurement };

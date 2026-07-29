"use client";

import React from "react";
import Link from "next/link";
import { Card, Grid, Stat, Tabs, Badge, WarningList, AssumptionList, StepList, Limitations } from "../ui";
import { LinePlot } from "../Charts";
import { SaveCalculationButton } from "./SaveCalculationButton";
import { UncertaintyPanel } from "./UncertaintyPanel";
import { EngineSchematic } from "./EngineSchematic";
import { formatQty, type Quantity } from "@/lib/units";
import type { CalcStep, CalcWarning, CalcAssumption } from "@/lib/calc/types";
import type { EngineArchitecture, SweepPoint } from "@/lib/calc/syringe";

interface ScrewDetail {
  raiseTorqueSI: number;
  lowerTorqueSI: number;
  efficiency: number;
  selfLocking: boolean;
  warnings: CalcWarning[];
  steps: { label: string; equation: string; result: string }[];
}

export function SyringeWorkspace({
  projectId,
  architecture,
  result,
  sweeps,
  screwDetail,
  settings,
  vehicleWeightN,
  waterDensity,
  gravity,
}: {
  projectId: string;
  architecture: EngineArchitecture;
  result: {
    values: Record<string, Quantity | undefined>;
    steps: CalcStep[];
    assumptions: CalcAssumption[];
    warnings: CalcWarning[];
    limitations: string[];
    confidence: string;
    inputs: unknown;
  };
  sweeps: { bore: SweepPoint[]; stroke: SweepPoint[]; depth: SweepPoint[] };
  screwDetail: ScrewDetail | null;
  settings: {
    boreMm: number;
    strokeMm: number;
    maxStrokeMm: number;
    depthM: number;
    frictionEntered: boolean;
    screwEfficiencyEntered: boolean;
    syringeCount: number;
  };
  vehicleWeightN: number;
  waterDensity: number;
  gravity: number;
}) {
  const [tab, setTab] = React.useState("sizing");
  const v = result.values;
  const q = (x: Quantity | undefined, d = 4) => formatQty(x, d);
  const authority = v.buoyancyForceChange?.value ?? NaN;
  const authorityPct = vehicleWeightN > 0 ? (authority / vehicleWeightN) * 100 : NaN;
  const stall = v.stallMargin?.value;

  const boreData = sweeps.bore.map((p) => ({
    bore_mm: Number((p.variable * 1000).toFixed(2)),
    volume_cm3: Number(p.usableVolumeCm3.toFixed(2)),
    buoyancy_N: Number(p.buoyancyForceN.toFixed(4)),
    required_force_N: Number(p.requiredForceN.toFixed(3)),
    motor_torque_mNm: p.motorTorqueMNm !== undefined ? Number(p.motorTorqueMNm.toFixed(3)) : 0,
    max_depth_m: p.maxDepthM !== undefined ? Number(p.maxDepthM.toFixed(2)) : 0,
  }));
  const strokeData = sweeps.stroke.map((p) => ({
    stroke_mm: Number((p.variable * 1000).toFixed(1)),
    volume_cm3: Number(p.usableVolumeCm3.toFixed(2)),
    buoyancy_N: Number(p.buoyancyForceN.toFixed(4)),
    required_force_N: Number(p.requiredForceN.toFixed(3)),
    actuation_time_s: p.actuationTimeS !== undefined ? Number(p.actuationTimeS.toFixed(2)) : 0,
    energy_J: p.energyPerStrokeJ !== undefined ? Number(p.energyPerStrokeJ.toFixed(2)) : 0,
  }));
  const depthData = sweeps.depth.map((p) => ({
    depth_m: Number(p.variable.toFixed(2)),
    required_force_N: Number(p.requiredForceN.toFixed(3)),
    motor_torque_mNm: p.motorTorqueMNm !== undefined ? Number(p.motorTorqueMNm.toFixed(3)) : 0,
    energy_J: p.energyPerStrokeJ !== undefined ? Number(p.energyPerStrokeJ.toFixed(2)) : 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          tabs={[
            { id: "sizing", label: "Sizing" },
            { id: "schematic", label: "Schematic" },
            { id: "sweeps", label: "Parameter sweeps" },
            { id: "screw", label: "Lead screw detail" },
            { id: "selection", label: "Component selection" },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="flex gap-2">
          <SaveCalculationButton
            projectId={projectId}
            calcId="syringe.sizing"
            title={`Syringe engine — ${architecture.label}`}
            inputs={result.inputs}
            results={result.values}
            warnings={result.warnings}
            assumptions={result.assumptions}
            steps={result.steps}
            confidence={result.confidence}
          />
          <Link href="/settings" className="gf-btn">
            Edit inputs
          </Link>
        </div>
      </div>

      {tab === "sizing" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Piston area" value={q({ value: (v.pistonArea?.value ?? 0) * 1e6, unit: "mm^2" })} hint={settings.syringeCount > 1 ? `${settings.syringeCount} syringes combined` : "π/4 × D²"} />
            <Stat label="Usable volume change" value={q({ value: (v.usableVolumeChange?.value ?? 0) * 1e6, unit: "cm^3" })} hint={`${settings.strokeMm.toFixed(1)} mm of usable stroke`} />
            <Stat
              label="Buoyancy authority"
              value={q(v.buoyancyForceChange)}
              hint={
                Number.isFinite(authorityPct)
                  ? `${authorityPct.toFixed(2)}% of the ${vehicleWeightN.toFixed(1)} N vehicle weight — small gliders commonly use 1–3%`
                  : "Enter component masses to compare with vehicle weight"
              }
              tone={Number.isFinite(authorityPct) ? (authorityPct < 0.5 ? "critical" : authorityPct < 1 ? "warning" : "good") : undefined}
            />
            <Stat label="Equivalent ballast" value={q({ value: (v.buoyancyMassChange?.value ?? 0) * 1000, unit: "g" })} hint="Mass of ballast this stroke replaces" />
            <Stat label="Hydrostatic pressure at depth" value={q({ value: (v.hydrostaticPressure?.value ?? 0) / 1000, unit: "kPa" })} hint={`At ${settings.depthM} m`} />
            <Stat label="Pressure force on the plunger" value={q(v.pressureForce)} hint={`The ${architecture.pressureOpposedStroke} stroke works against this`} />
            <Stat
              label="Friction force"
              value={q(v.frictionForce)}
              hint={settings.frictionEntered ? "Entered" : "NOT ENTERED — taken as zero"}
              provenance={settings.frictionEntered ? "measured" : "unknown"}
              tone={settings.frictionEntered ? undefined : "critical"}
            />
            <Stat label="Design actuator force" value={q(v.designActuatorForce)} hint="Required force × safety factor" />
            <Stat label="Ideal screw torque" value={v.idealScrewTorque ? q({ value: v.idealScrewTorque.value * 1000, unit: "mN*m" }) : "—"} hint="Frictionless lower bound only" />
            <Stat
              label="Design screw torque"
              value={v.designScrewTorque ? q({ value: v.designScrewTorque.value * 1000, unit: "mN*m" }) : "—"}
              hint={settings.screwEfficiencyEntered ? "Using your screw efficiency" : "Assuming 0.30 screw efficiency"}
              provenance={settings.screwEfficiencyEntered ? "user" : "assumed"}
            />
            <Stat label="Required motor torque" value={v.requiredMotorTorque ? q({ value: v.requiredMotorTorque.value * 1000, unit: "mN*m" }) : "—"} hint="After the gearbox" />
            <Stat
              label="Stall margin"
              value={stall !== undefined ? stall.toFixed(2) : "—"}
              hint={stall === undefined ? "Enter motor torque to evaluate" : stall < 1 ? "Will stall" : stall < 1.5 ? "Too little headroom" : "Adequate headroom"}
              tone={stall === undefined ? undefined : stall < 1 ? "critical" : stall < 1.5 ? "warning" : "good"}
            />
            <Stat label="Actuation time" value={v.actuationTime ? q(v.actuationTime) : "—"} hint="Full usable stroke" />
            <Stat label="Mechanical work per stroke" value={q(v.mechanicalWorkPerStroke)} hint="F_design × stroke" />
            <Stat label="Electrical energy per stroke" value={v.electricalEnergyPerStroke ? q(v.electricalEnergyPerStroke) : "—"} hint="Two strokes per dive-and-climb cycle" />
            <Stat
              label="Maximum feasible depth"
              value={v.maxFeasibleDepth ? q(v.maxFeasibleDepth) : "—"}
              hint="Depth at which the drivetrain runs out of force"
              tone={v.maxFeasibleDepth !== undefined && v.maxFeasibleDepth.value < settings.depthM ? "critical" : undefined}
            />
          </div>

          {v.requiredStrokeForTarget && (
            <Card title="Stroke required for your target buoyancy change">
              <p className="text-sm">
                To deliver the target buoyancy change this bore needs{" "}
                <strong>{(v.requiredStrokeForTarget.value * 1000).toFixed(1)} mm</strong> of stroke. You have{" "}
                <strong>{settings.strokeMm.toFixed(1)} mm</strong> usable.
              </p>
              <p className="mt-1 text-xs text-muted">
                {v.requiredStrokeForTarget.value <= settings.strokeMm / 1000
                  ? "The target is achievable with the current geometry."
                  : "The target is not achievable — increase the bore, the stroke, or the number of syringes."}
              </p>
            </Card>
          )}

          <Grid cols={2}>
            <Card title="Working">
              <StepList steps={result.steps} defaultOpen />
            </Card>
            <Card title="Assumptions, warnings and limits">
              <div className="space-y-3">
                <AssumptionList assumptions={result.assumptions} />
                <WarningList warnings={result.warnings} />
                <Limitations items={result.limitations} />
              </div>
            </Card>
          </Grid>

          <UncertaintyPanel
            title="How uncertain is the buoyancy authority?"
            description="The swept volume is geometry, so it is usually well known. Water density is well known too. The uncertainty that matters for authority is whether the delivered volume equals the swept volume — bladder compliance, trapped air and barrel expansion all reduce it."
            inputs={[
              { name: "waterDensity", label: "Water density", value: waterDensity, unit: "kg/m^3", defaultUncertainty: 0.5 },
              { name: "bore", label: "Bore diameter", value: settings.boreMm / 1000, unit: "m", defaultUncertainty: 0.0002 },
              { name: "stroke", label: "Usable stroke", value: settings.strokeMm / 1000, unit: "m", defaultUncertainty: 0.001 },
            ]}
            expression="buoyancyChange"
            resultUnit="N"
            gravity={gravity}
          />
        </div>
      )}

      {tab === "schematic" && (
        <Grid cols={2}>
          <Card title={`Schematic — ${architecture.label}`}>
            <EngineSchematic config={architecture.config} />
          </Card>
          <Card title="What this architecture means">
            <p className="text-xs leading-relaxed">{architecture.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone={architecture.changesMass ? "warning" : "neutral"}>{architecture.changesMass ? "vehicle mass CHANGES" : "vehicle mass constant"}</Badge>
              <Badge tone={architecture.changesDisplacedVolume ? "accent" : "neutral"}>
                {architecture.changesDisplacedVolume ? "displaced volume CHANGES" : "displaced volume constant"}
              </Badge>
              <Badge tone="neutral">{architecture.pressureOpposedStroke} stroke fights ambient pressure</Badge>
              <Badge tone="neutral">extend sign {architecture.extendSign > 0 ? "+ (more buoyant)" : "− (heavier)"}</Badge>
            </div>
            <ul className="ml-4 mt-3 list-disc space-y-1.5 text-xs leading-snug text-muted">
              {architecture.schematicNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted">
              Change the architecture in <Link href="/settings" className="underline">Settings → Buoyancy engine</Link>. The sizing above is
              recomputed with the correct sign and pressure case for whichever you pick — these arrangements are not interchangeable.
            </p>
          </Card>
        </Grid>
      )}

      {tab === "sweeps" && (
        <div className="space-y-4">
          <Card title="Reading these sweeps">
            <p className="text-xs leading-relaxed text-muted">
              Each sweep varies one parameter and holds everything else at your current settings. The pairing that matters most is the first
              two charts: <strong className="text-ink">volume and required force both grow with the square of bore diameter</strong>, so a
              wider syringe buys authority at a proportional cost in force. Stroke is the parameter that buys volume without touching the
              pressure force — it costs packaging length and actuation time instead.
            </p>
          </Card>

          <Grid cols={2}>
            <LinePlot
              title="Swept volume versus bore diameter"
              subtitle={`At ${settings.strokeMm.toFixed(0)} mm usable stroke`}
              data={boreData}
              xKey="bore_mm"
              xLabel="Bore diameter (mm)"
              yLabel="Usable volume (cm³)"
              series={[{ key: "volume_cm3", label: "Usable volume", unit: "cm³" }]}
              filename="sweep-bore-volume"
              referenceLines={[{ x: settings.boreMm, label: "current" }]}
              note="Quadratic in diameter: doubling the bore quadruples the swept volume."
            />
            <LinePlot
              title="Required actuator force versus bore diameter"
              subtitle={`At ${settings.depthM} m depth`}
              data={boreData}
              xKey="bore_mm"
              xLabel="Bore diameter (mm)"
              yLabel="Design actuator force (N)"
              series={[{ key: "required_force_N", label: "Design force", unit: "N" }]}
              filename="sweep-bore-force"
              referenceLines={[{ x: settings.boreMm, label: "current" }]}
              note="Also quadratic — F = ΔP × A, and A goes as D². This is why widening the bore does not improve the authority-per-newton trade."
            />
            <LinePlot
              title="Required motor torque versus bore diameter"
              data={boreData}
              xKey="bore_mm"
              xLabel="Bore diameter (mm)"
              yLabel="Motor torque (mN·m)"
              series={[{ key: "motor_torque_mNm", label: "Required motor torque", unit: "mN·m" }]}
              filename="sweep-bore-torque"
              referenceLines={[{ x: settings.boreMm, label: "current" }]}
              note="Zero if no lead screw is defined. Enter the screw lead in Settings to populate this."
            />
            <LinePlot
              title="Maximum feasible depth versus bore diameter"
              data={boreData}
              xKey="bore_mm"
              xLabel="Bore diameter (mm)"
              yLabel="Maximum depth (m)"
              series={[{ key: "max_depth_m", label: "Depth the drivetrain can reach", unit: "m" }]}
              filename="sweep-bore-depth"
              referenceLines={[{ y: settings.depthM, label: "target depth" }]}
              note="Where the drivetrain runs out of force against hydrostatic pressure. Zero if motor torque is not entered."
            />
            <LinePlot
              title="Swept volume versus stroke"
              subtitle={`At ${settings.boreMm.toFixed(1)} mm bore`}
              data={strokeData}
              xKey="stroke_mm"
              xLabel="Stroke (mm)"
              yLabel="Usable volume (cm³)"
              series={[{ key: "volume_cm3", label: "Usable volume", unit: "cm³" }]}
              filename="sweep-stroke-volume"
              referenceLines={[{ x: settings.maxStrokeMm, label: "current" }]}
              note="Linear in stroke, and — unlike bore — it does not change the pressure force at all."
            />
            <LinePlot
              title="Actuation time versus stroke"
              data={strokeData}
              xKey="stroke_mm"
              xLabel="Stroke (mm)"
              yLabel="Actuation time (s)"
              series={[{ key: "actuation_time_s", label: "Time for a full stroke", unit: "s" }]}
              filename="sweep-stroke-time"
              referenceLines={[{ x: settings.maxStrokeMm, label: "current" }]}
              note="This is what a long stroke costs you: a slow buoyancy change means a long, shallow transition at each end of a cycle."
            />
            <LinePlot
              title="Required force versus depth"
              data={depthData}
              xKey="depth_m"
              xLabel="Depth (m)"
              yLabel="Design actuator force (N)"
              series={[{ key: "required_force_N", label: "Design force", unit: "N" }]}
              filename="sweep-depth-force"
              referenceLines={[{ x: settings.depthM, label: "target depth" }]}
              note="Linear in depth. At shallow depth the intercept is friction — which is why an unmeasured friction number ruins the sizing."
            />
            <LinePlot
              title="Energy per stroke versus depth"
              data={depthData}
              xKey="depth_m"
              xLabel="Depth (m)"
              yLabel="Energy per stroke (J)"
              series={[{ key: "energy_J", label: "Electrical energy", unit: "J" }]}
              filename="sweep-depth-energy"
              referenceLines={[{ x: settings.depthM, label: "target depth" }]}
              note="Deeper cycles cost more energy per cycle, which directly reduces cycle count on one charge."
            />
          </Grid>
        </div>
      )}

      {tab === "screw" && (
        <Grid cols={2}>
          <Card title="Classical power-screw torque" subtitle="Shigley's power-screw relation, as a cross-check on the efficiency-based estimate.">
            {screwDetail ? (
              <div className="space-y-3">
                <p className="text-[11px] leading-snug text-muted">
                  Computed with an assumed 8 mm mean thread diameter, 0.15 friction coefficient and a 15° thread half-angle (metric
                  trapezoidal). Those three numbers are <strong className="text-ink">assumptions</strong>, not your screw — change them by
                  measuring your actual thread if the answer matters.
                </p>
                <table className="gf-table">
                  <tbody>
                    {screwDetail.steps.map((s, i) => (
                      <tr key={i}>
                        <td>
                          <span className="font-medium">{s.label}</span>
                          <span className="block font-mono text-[10px] text-muted">{s.equation}</span>
                        </td>
                        <td className="whitespace-nowrap font-semibold">{s.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>
                  <Badge tone={screwDetail.selfLocking ? "good" : "warning"}>
                    {screwDetail.selfLocking ? "self-locking" : "NOT self-locking"}
                  </Badge>
                </div>
                <WarningList warnings={screwDetail.warnings} />
              </div>
            ) : (
              <p className="text-xs text-muted">
                Enter a lead-screw lead in <Link href="/settings" className="underline">Settings</Link> to compute this.
              </p>
            )}
          </Card>
          <Card title="Why self-locking matters here">
            <p className="text-xs leading-relaxed text-muted">
              A buoyancy engine holds a load continuously. If the screw can back-drive, hydrostatic pressure will push the plunger back
              whenever power is removed — including after a fault, which is exactly when you want the vehicle to keep whatever buoyancy it
              has.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              A self-locking screw holds position for free but is inefficient (usually below 50%), so it needs more torque and more energy per
              stroke. A ball screw is efficient but back-drives, so it needs a brake or continuous holding current. That trade is worth
              recording as a design decision.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              The efficiency-based estimate on the Sizing tab and this classical relation should broadly agree. If they do not, the assumed
              efficiency is wrong — trust the classical relation once you have measured the thread geometry and friction.
            </p>
          </Card>
        </Grid>
      )}

      {tab === "selection" && (
        <Card title="Component selection assistance">
          <p className="text-xs leading-relaxed text-muted">
            This tool will not name a motor, screw, driver, syringe, seal or sensor for you, and it does not carry a catalogue of commercial
            parts. Inventing part numbers and specifications is exactly the failure mode this application is built to avoid.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">What it can do is tell you the requirement a part has to meet:</p>
          <div className="gf-scroll-x mt-3">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Requirement derived from your project</th>
                  <th>What to check on the datasheet</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium">Motor</td>
                  <td>
                    At least {v.requiredMotorTorque ? `${(v.requiredMotorTorque.value * 1000).toFixed(1)} mN·m` : "— (enter the screw lead)"} at the
                    output shaft, with a stall margin of 1.5–2.0 on top
                  </td>
                  <td>Torque at the operating VOLTAGE you will actually run, not at nominal; stall current against your driver rating; duty rating for a stroke lasting {v.actuationTime ? `${v.actuationTime.value.toFixed(0)} s` : "—"}</td>
                </tr>
                <tr>
                  <td className="font-medium">Lead screw</td>
                  <td>Travel of at least {settings.maxStrokeMm.toFixed(0)} mm; lead chosen to trade torque against speed</td>
                  <td>Whether the quoted figure is lead or pitch (they differ on a multi-start screw); nut material and its efficiency; axial play</td>
                </tr>
                <tr>
                  <td className="font-medium">Motor driver</td>
                  <td>Continuous current above the motor&apos;s running current; peak above its STALL current</td>
                  <td>Continuous versus peak ratings; thermal behaviour inside a sealed hull with no airflow</td>
                </tr>
                <tr>
                  <td className="font-medium">Syringe</td>
                  <td>{settings.boreMm.toFixed(1)} mm bore, {settings.maxStrokeMm.toFixed(0)} mm stroke, {settings.syringeCount} off</td>
                  <td>Actual measured bore (nominal capacity is not a reliable guide to bore); plunger tip material; whether it survives repeated cycling</td>
                </tr>
                <tr>
                  <td className="font-medium">Seal</td>
                  <td>Dynamic rod seal at {v.pressureDifferential ? `${(v.pressureDifferential.value / 1000).toFixed(1)} kPa` : "—"} differential</td>
                  <td>Squeeze band for a DYNAMIC application (lower than static); compound compatibility with water; surface finish required on the rod</td>
                </tr>
                <tr>
                  <td className="font-medium">Limit switches</td>
                  <td>Two, one per end of travel, rated for the cycle count of your mission</td>
                  <td>Actuation force and travel; whether the contacts bounce; sealing if they sit in a wet bay</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-snug text-muted">
            When you have chosen a part, enter its real specifications in Settings and on the Components page and re-run this page. Recording
            the datasheet as an attachment makes the number traceable in your report.
          </p>
        </Card>
      )}
    </div>
  );
}

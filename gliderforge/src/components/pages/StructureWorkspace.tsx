"use client";

import React from "react";
import Link from "next/link";
import { Card, Grid, Stat, Tabs, Badge, WarningList, AssumptionList, StepList, Limitations, EmptyState } from "../ui";
import { LinePlot } from "../Charts";
import { SaveCalculationButton } from "./SaveCalculationButton";
import { formatQty, type Quantity } from "@/lib/units";
import type { CalcStep, CalcWarning, CalcAssumption } from "@/lib/calc/types";

interface Block {
  values: Record<string, Quantity | undefined>;
  steps: CalcStep[];
  warnings: CalcWarning[];
  assumptions?: CalcAssumption[];
  limitations?: string[];
  inputs?: unknown;
  confidence?: string;
}

export function StructureWorkspace({
  projectId,
  depthM,
  notFeaNotice,
  hydro,
  cylinder,
  endCap,
  plunger,
  gland,
  materialProvenance,
  safetyFactor,
  depthSweep,
  hasHousing,
}: {
  projectId: string;
  depthM: number;
  notFeaNotice: string;
  hydro: Block;
  cylinder: Block | null;
  endCap: Block | null;
  plunger: Block;
  gland: Block;
  materialProvenance: string;
  safetyFactor: number;
  depthSweep: Record<string, number>[];
  hasHousing: boolean;
}) {
  const [tab, setTab] = React.useState("pressure");
  const q = (x: Quantity | undefined, d = 4) => formatQty(x, d);

  return (
    <div className="space-y-4">
      <Card title="What these checks are, and are not">
        <p className="text-xs leading-relaxed text-muted">{notFeaNotice}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={materialProvenance === "user" ? "good" : "critical"}>material properties: {materialProvenance}</Badge>
          <Badge tone="neutral">required factor of safety: {safetyFactor}</Badge>
          <Badge tone="neutral">evaluated at the depth limit, {depthM} m</Badge>
        </div>
        {materialProvenance !== "user" && (
          <p className="mt-2 rounded border border-[#d03b3b] p-2 text-[11px] leading-snug text-muted">
            <strong className="text-[#d03b3b]">The material properties are not from a datasheet. </strong>
            A structural pass/fail conclusion must not rest on unverified library values. Enter the properties for the stock you actually
            bought in{" "}
            <Link href="/settings" className="underline">
              Settings → Structure
            </Link>
            .
          </p>
        )}
      </Card>

      <Tabs
        tabs={[
          { id: "pressure", label: "Hydrostatic pressure" },
          { id: "housing", label: "Pressure housing" },
          { id: "endcap", label: "End cap" },
          { id: "penetration", label: "Penetrations & seals" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "pressure" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Gauge pressure at the depth limit" value={q({ value: (hydro.values.gauge?.value ?? 0) / 1000, unit: "kPa" })} hint={`${((hydro.values.gauge?.value ?? 0) / 1e5).toFixed(3)} bar`} />
            <Stat label="Absolute pressure" value={q({ value: (hydro.values.absolute?.value ?? 0) / 1000, unit: "kPa" })} />
            <Stat label="Depth" value={depthM.toFixed(2)} unit="m" hint="From the mission depth limit, not the target depth — the structure has to survive the worst case" />
            <Stat label="Rule of thumb" value={((hydro.values.gauge?.value ?? 0) / 1e5).toFixed(2)} unit="bar" hint="Roughly 1 bar per 10 m of fresh water" />
          </div>

          <Grid cols={2}>
            <LinePlot
              title="Pressure and plunger thrust versus depth"
              data={depthSweep}
              xKey="depth_m"
              xLabel="Depth (m)"
              yLabel="Gauge pressure (kPa)"
              series={[{ key: "gauge_pressure_kPa", label: "Gauge pressure", unit: "kPa" }]}
              filename="pressure-vs-depth"
              referenceLines={[{ x: depthM, label: "depth limit" }]}
              note="Linear in depth. The important consequence is that everything downstream — plunger force, hoop stress, seal load — is also linear in depth."
            />
            <LinePlot
              title="Thrust on the plunger versus depth"
              data={depthSweep}
              xKey="depth_m"
              xLabel="Depth (m)"
              yLabel="Thrust (N)"
              series={[{ key: "plunger_thrust_N", label: "Pressure thrust on the plunger face", unit: "N" }]}
              filename="plunger-thrust-vs-depth"
              referenceLines={[{ x: depthM, label: "depth limit" }]}
              note="This is the load the buoyancy engine's actuator must overcome on its pressure-opposed stroke."
            />
          </Grid>

          <Card
            title="Working"
            actions={
              <SaveCalculationButton
                projectId={projectId}
                calcId="pressure.hydrostatic"
                title="Hydrostatic pressure"
                inputs={hydro.inputs}
                results={hydro.values}
                warnings={hydro.warnings}
                assumptions={hydro.assumptions}
                steps={hydro.steps}
                confidence={hydro.confidence}
              />
            }
          >
            <div className="space-y-3">
              <StepList steps={hydro.steps} defaultOpen />
              <AssumptionList assumptions={hydro.assumptions ?? []} />
              <WarningList warnings={hydro.warnings} />
            </div>
          </Card>
        </div>
      )}

      {tab === "housing" && (
        <>
          {!hasHousing || !cylinder ? (
            <EmptyState
              title="Housing geometry and material not defined"
              body="Enter the housing outer diameter, wall thickness, unsupported length and the material properties in Settings → Structure to run this check."
              action={
                <Link href="/settings" className="gf-btn gf-btn-primary">
                  Go to structure settings
                </Link>
              }
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Membrane hoop stress" value={q({ value: (cylinder.values.hoopStress?.value ?? 0) / 1e6, unit: "MPa" })} hint="Compressive" />
                <Stat
                  label="Yield margin"
                  value={q(cylinder.values.yieldMargin, 3)}
                  tone={(cylinder.values.yieldMargin?.value ?? 0) < safetyFactor ? "critical" : "good"}
                  hint={`Required ${safetyFactor}`}
                />
                <Stat label="Long-tube collapse pressure" value={q({ value: (cylinder.values.bucklingPressureLong?.value ?? 0) / 1e5, unit: "bar" })} hint="Timoshenko, 2E/(1−ν²)(t/D)³" />
                <Stat
                  label="Finite-length collapse pressure"
                  value={cylinder.values.bucklingPressureFiniteLength ? q({ value: cylinder.values.bucklingPressureFiniteLength.value / 1e5, unit: "bar" }) : "—"}
                  hint="Windenburg–Trilling, 1934"
                />
                <Stat label="Governing collapse pressure" value={q({ value: (cylinder.values.governingCollapsePressure?.value ?? 0) / 1e5, unit: "bar" })} hint="The lower of the two" />
                <Stat
                  label="Buckling margin"
                  value={q(cylinder.values.bucklingMargin, 3)}
                  tone={(cylinder.values.bucklingMargin?.value ?? 0) < safetyFactor ? "critical" : "good"}
                  hint={`Required ${safetyFactor}`}
                />
                <Stat label="t / D" value={q(cylinder.values.thicknessRatio, 4)} hint="Thin-wall theory needs this below about 0.1" />
                <Stat
                  label="Governing mode"
                  value={(cylinder.values.bucklingMargin?.value ?? Infinity) < (cylinder.values.yieldMargin?.value ?? Infinity) ? "buckling" : "yielding"}
                  hint="For a thin tube under external pressure, buckling almost always governs — a stronger material will not help, a thicker wall or a shorter span will"
                />
              </div>

              <Grid cols={2}>
                <Card
                  title="Working"
                  actions={
                    <SaveCalculationButton
                      projectId={projectId}
                      calcId="pressure.cylinder"
                      title="Cylindrical housing under external pressure"
                      inputs={cylinder.inputs}
                      results={cylinder.values}
                      warnings={cylinder.warnings}
                      assumptions={cylinder.assumptions}
                      steps={cylinder.steps}
                      confidence={cylinder.confidence}
                    />
                  }
                >
                  <StepList steps={cylinder.steps} defaultOpen />
                </Card>
                <Card title="Assumptions, warnings and limits">
                  <div className="space-y-3">
                    <AssumptionList assumptions={cylinder.assumptions ?? []} />
                    <WarningList warnings={cylinder.warnings} />
                    <Limitations items={cylinder.limitations} />
                  </div>
                </Card>
              </Grid>

              <LinePlot
                title="Hoop stress versus depth"
                data={depthSweep}
                xKey="depth_m"
                xLabel="Depth (m)"
                yLabel="Hoop stress (MPa)"
                series={[{ key: "hoop_stress_MPa", label: "Membrane hoop stress", unit: "MPa" }]}
                filename="hoop-stress-vs-depth"
                referenceLines={[{ x: depthM, label: "depth limit" }]}
                note="Membrane stress only. It does not capture buckling, which is what actually fails a thin tube under external pressure and does not appear on a stress plot at all."
              />

              <Card title="Before you trust this">
                <ul className="ml-4 list-disc space-y-2 text-xs leading-relaxed text-muted">
                  <li>
                    <strong className="text-ink">Apply a knockdown factor.</strong> The buckling formulas assume a perfect circular cylinder.
                    Real tubes are out-of-round, and shell buckling is famously imperfection-sensitive — measured collapse pressures of 50–70%
                    of theory are common.
                  </li>
                  <li>
                    <strong className="text-ink">Polymers creep.</strong> If the housing is acrylic, PVC or a printed part, a load it survives
                    for a minute may fail it after an hour. These formulas are elastic and short-duration.
                  </li>
                  <li>
                    <strong className="text-ink">Penetrations are stress raisers.</strong> Every hole for a cable gland, shaft or vent is
                    invisible to this calculation and lowers the real collapse pressure.
                  </li>
                  <li>
                    <strong className="text-ink">Proof-test the empty housing.</strong> Pressurise it, in a shielded vessel or under water,
                    above the maximum operating pressure, with a dummy mass instead of electronics — before it carries anything you care
                    about. Test plan TST-005 in the sample project covers this, and it is the most hazardous test in the programme.
                  </li>
                </ul>
              </Card>
            </div>
          )}
        </>
      )}

      {tab === "endcap" && (
        <>
          {!endCap ? (
            <EmptyState title="End-cap geometry not available" body="Define the housing geometry and material in Settings → Structure first." />
          ) : (
            <div className="space-y-4">
              <Card title="What is being checked">
                <p className="text-xs leading-relaxed text-muted">
                  A flat circular plate spanning the housing bore, with a thickness taken as twice the housing wall as a starting point, loaded
                  by the external pressure at the depth limit, modelled as <strong className="text-ink">simply supported</strong> at its edge.
                  A bolted cap is somewhere between simply supported and clamped: simply supported is conservative on stress, clamped is
                  conservative on deflection, so check both before committing.
                </p>
              </Card>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Maximum bending stress" value={q({ value: (endCap.values.maxStress?.value ?? 0) / 1e6, unit: "MPa" })} />
                <Stat label="Maximum deflection" value={q({ value: (endCap.values.maxDeflection?.value ?? 0) * 1000, unit: "mm" })} />
                <Stat
                  label="Deflection / thickness"
                  value={q(endCap.values.deflectionRatio, 3)}
                  tone={(endCap.values.deflectionRatio?.value ?? 0) > 0.5 ? "warning" : "good"}
                  hint="Small-deflection plate theory is valid below about 0.5"
                />
                <Stat
                  label="Yield margin"
                  value={q(endCap.values.yieldMargin, 3)}
                  tone={(endCap.values.yieldMargin?.value ?? 0) < safetyFactor ? "critical" : "good"}
                />
              </div>
              <Grid cols={2}>
                <Card title="Working">
                  <StepList steps={endCap.steps} defaultOpen />
                </Card>
                <Card title="Assumptions, warnings and limits">
                  <div className="space-y-3">
                    <AssumptionList assumptions={endCap.assumptions ?? []} />
                    <WarningList warnings={endCap.warnings} />
                    <Limitations items={endCap.limitations} />
                  </div>
                </Card>
              </Grid>
            </div>
          )}
        </>
      )}

      {tab === "penetration" && (
        <div className="space-y-4">
          <Grid cols={2}>
            <Card title="Plunger penetration thrust" subtitle="The pressure load the plunger retention and drivetrain must react.">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Projected area" value={q({ value: (plunger.values.area?.value ?? 0) * 1e6, unit: "mm^2" })} />
                <Stat label="Inward thrust" value={q(plunger.values.thrust)} />
              </div>
              <div className="mt-3 space-y-3">
                <StepList steps={plunger.steps} />
                <WarningList warnings={plunger.warnings} />
              </div>
            </Card>

            <Card title="O-ring gland check" subtitle="Example geometry: 3 mm cord in a 2.2 mm deep, 4 mm wide gland, dynamic radial seal.">
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="Squeeze"
                  value={((gland.values.squeezeFraction?.value ?? 0) * 100).toFixed(1)}
                  unit="%"
                  hint="Dynamic radial seals normally run 10–20%"
                />
                <Stat
                  label="Gland fill"
                  value={((gland.values.glandFillFraction?.value ?? 0) * 100).toFixed(0)}
                  unit="%"
                  hint="Typical practice is 60–85%"
                />
              </div>
              <div className="mt-3 space-y-3">
                <StepList steps={gland.steps} />
                <WarningList warnings={gland.warnings} />
              </div>
              <p className="mt-3 text-[11px] leading-snug text-muted">
                Change the cord and gland dimensions to your own by editing them into a component record and re-running the check against your
                seal supplier&apos;s handbook. This example exists to show what the check does, not to specify your seal.
              </p>
            </Card>
          </Grid>

          <Card title="Sealing guidance for this class of vehicle">
            <ul className="ml-4 list-disc space-y-2 text-xs leading-relaxed text-muted">
              <li>
                <strong className="text-ink">A dynamic rod seal is the weakest link.</strong> It has to slide, which means it wears, and it
                sees the full depth differential. Static face seals on end caps are far more reliable — prefer an architecture that needs fewer
                dynamic seals if you can.
              </li>
              <li>
                <strong className="text-ink">Dynamic squeeze bands are lower than static ones.</strong> Over-squeezing a moving seal raises
                friction sharply — which lands directly on the buoyancy engine&apos;s torque requirement — and accelerates compression set.
              </li>
              <li>
                <strong className="text-ink">Surface finish on the rod matters as much as the gland.</strong> A rod that looks smooth can
                still shred a seal; check the finish specification in the seal handbook.
              </li>
              <li>
                <strong className="text-ink">Pressure pushes penetrations inward.</strong> A connector held only by friction or by a thread
                engaged in thin plastic is a common failure. Give it a shoulder, a circlip or bolts that react the thrust computed above.
              </li>
              <li>
                <strong className="text-ink">Test the seal, do not calculate it.</strong> A 30-minute static immersion at the depth limit with
                a witness paper inside tells you more than any of these numbers.
              </li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

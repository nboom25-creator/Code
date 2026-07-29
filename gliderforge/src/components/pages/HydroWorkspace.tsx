"use client";

import React from "react";
import Link from "next/link";
import { Card, Grid, Stat, Tabs, Badge, WarningList, AssumptionList, StepList, Limitations } from "../ui";
import { LinePlot } from "../Charts";
import { SaveCalculationButton } from "./SaveCalculationButton";
import { formatQty, type Quantity } from "@/lib/units";
import { COEFFICIENT_DEFAULTS } from "@/lib/calc/hydro";
import type { CalcStep, CalcWarning, CalcAssumption } from "@/lib/calc/types";

export function HydroWorkspace({
  projectId,
  drag,
  dive,
  climb,
  settings,
  charts,
  authorityN,
}: {
  projectId: string;
  drag: {
    values: Record<string, Quantity | undefined>;
    steps: CalcStep[];
    assumptions: CalcAssumption[];
    warnings: CalcWarning[];
    limitations: string[];
    confidence: string;
    inputs: unknown;
  };
  dive: { values: Record<string, Quantity | undefined>; warnings: CalcWarning[]; steps: CalcStep[]; assumptions: CalcAssumption[]; limitations: string[] };
  climb: { values: Record<string, Quantity | undefined> };
  settings: {
    modelLevel: string;
    coefficientSource: string;
    coefficientNote: string;
    CL: number;
    CD: number;
    referenceAreaSI: number;
    referenceAreaBasis: string;
    calibrationFactor: number;
    aspectRatio: number;
    oswald: number;
    cd0: number;
    liftSlopePerRad: number;
    liftSlopeEquation: string;
    liftSlopeNote: string;
  };
  charts: {
    dragVsSpeed: Record<string, number>[];
    alphaSweep: Record<string, number>[];
    buoySweep: Record<string, number>[];
  };
  authorityN: number;
}) {
  const [tab, setTab] = React.useState("coefficients");
  const q = (x: Quantity | undefined, d = 4) => formatQty(x, d);

  const LEVELS: Record<string, string> = {
    coefficient: "1 — Simple coefficient estimate: you supply C_L and C_D directly.",
    buildup: "2 — Component buildup: flat-plate friction (ITTC-57) × form factor, plus wing profile and induced drag.",
    experimental: "3 — Coefficients measured in a tow or glide test.",
    calibrated: "4 — Buildup scaled by a factor fitted to test data, with the original prediction preserved.",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          tabs={[
            { id: "coefficients", label: "Coefficients" },
            { id: "drag", label: "Drag buildup" },
            { id: "glide", label: "Glide performance" },
            { id: "sweeps", label: "Sweeps and plots" },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="flex gap-2">
          <SaveCalculationButton
            projectId={projectId}
            calcId="hydro.drag_buildup"
            title="Drag buildup"
            inputs={drag.inputs}
            results={drag.values}
            warnings={drag.warnings}
            assumptions={drag.assumptions}
            steps={drag.steps}
            confidence={drag.confidence}
          />
          <Link href="/settings" className="gf-btn">
            Edit inputs
          </Link>
        </div>
      </div>

      {tab === "coefficients" && (
        <div className="space-y-4">
          <Card
            title="Which coefficients are in use, and where they came from"
            subtitle="Every speed, glide ratio, range and endurance figure in this project follows from these two numbers."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Lift coefficient C_L" value={settings.CL.toFixed(3)} provenance={settings.coefficientSource === "assumed" ? "assumed" : settings.coefficientSource === "experimental" ? "measured" : "user"} hint={settings.referenceAreaBasis} />
              <Stat label="Drag coefficient C_D" value={settings.CD.toFixed(4)} provenance={settings.coefficientSource === "assumed" ? "assumed" : settings.coefficientSource === "experimental" ? "measured" : "user"} />
              <Stat label="Reference area" value={(settings.referenceAreaSI * 1e4).toFixed(1)} unit="cm²" hint={settings.referenceAreaBasis} />
              <Stat label="Glide ratio C_L / C_D" value={(settings.CD > 0 ? settings.CL / settings.CD : 0).toFixed(2)} hint="Horizontal distance per unit depth in a steady glide" />
            </div>

            <div className="mt-4 rounded border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold">Modelling level</span>
                <Badge tone={settings.coefficientSource === "assumed" ? "warning" : "accent"}>{settings.modelLevel}</Badge>
                <Badge tone={settings.coefficientSource === "experimental" ? "good" : "warning"}>source: {settings.coefficientSource}</Badge>
                {settings.calibrationFactor !== 1 && <Badge tone="accent">calibration ×{settings.calibrationFactor.toFixed(3)}</Badge>}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-muted">{LEVELS[settings.modelLevel]}</p>
              {settings.coefficientSource === "assumed" && (
                <p className="mt-2 rounded border border-[#fab219] p-2 text-[11px] leading-snug text-muted">
                  <strong className="text-[#fab219]">These coefficients are placeholders. </strong>
                  {settings.coefficientNote}
                </p>
              )}
            </div>
          </Card>

          <Grid cols={2}>
            <Card title="Correlations used, and their basis" subtitle="No coefficient is chosen silently.">
              <dl className="space-y-3 text-xs">
                <div>
                  <dt className="font-semibold">Skin friction — ITTC-1957 correlation line</dt>
                  <dd className="mt-0.5 text-muted">{COEFFICIENT_DEFAULTS.frictionLineNote}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Hull form factor — Hoerner body of revolution</dt>
                  <dd className="mt-0.5 text-muted">{COEFFICIENT_DEFAULTS.hullFormFactorNote}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Low-Reynolds fallback — Blasius laminar plate</dt>
                  <dd className="mt-0.5 text-muted">{COEFFICIENT_DEFAULTS.laminarNote}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Lift-curve slope — Helmbold low-aspect-ratio form</dt>
                  <dd className="mt-0.5 text-muted">
                    <code className="rounded bg-surface px-1">{settings.liftSlopeEquation}</code> giving {settings.liftSlopePerRad.toFixed(3)} per
                    radian ({(settings.liftSlopePerRad * Math.PI / 180).toFixed(4)} per degree) at AR = {settings.aspectRatio}.{" "}
                    {settings.liftSlopeNote}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Induced drag</dt>
                  <dd className="mt-0.5 text-muted">
                    C_Di = C_L² / (π · AR · e), with Oswald efficiency e = {settings.oswald}. Implied zero-lift drag coefficient from your
                    polar: C_D0 = {settings.cd0.toFixed(5)}.
                  </dd>
                </div>
              </dl>
            </Card>

            <Card title="How to replace these with measurements">
              <ol className="ml-4 list-decimal space-y-2 text-xs leading-relaxed text-muted">
                <li>
                  Trim the vehicle neutral first, and confirm it with a static float test. Everything below depends on knowing the net
                  buoyancy driving the glide.
                </li>
                <li>
                  Set a known buoyancy offset, release the vehicle with zero initial velocity and record a video against a marked grid, plus
                  the depth log.
                </li>
                <li>
                  Extract only the <strong className="text-ink">steady</strong> portion of the glide. The first seconds are an acceleration
                  transient and will drag your fitted speed down if you include them.
                </li>
                <li>
                  From the measured speed V and glide angle γ at known net buoyancy F: C_L = 2F·cos γ / (ρ V² S) and C_D = 2F·sin γ / (ρ V² S).
                </li>
                <li>
                  Enter those on the Settings page, set the coefficient source to <strong className="text-ink">experimental</strong>, and
                  repeat at two or three buoyancy settings so you can see whether the coefficients are actually constant.
                </li>
              </ol>
              <p className="mt-2 text-[11px] text-muted">
                Test plan TST-008 in the sample project is written for exactly this.
              </p>
            </Card>
          </Grid>
        </div>
      )}

      {tab === "drag" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Reynolds number" value={q(drag.values.reynolds, 3)} hint="On hull length, at the nominal speed" />
            <Stat label="Skin friction coefficient" value={q(drag.values.frictionCoefficient, 4)} hint="ITTC-1957 line" />
            <Stat label="Hull form factor (1+k)" value={q(drag.values.formFactor, 4)} hint="Hoerner correlation" />
            <Stat label="Hull wetted area" value={q({ value: (drag.values.hullWettedArea?.value ?? 0) * 1e4, unit: "cm^2" })} provenance={drag.values.hullWettedArea?.provenance === "assumed" ? "assumed" : "user"} />
            <Stat label="Hull drag" value={q(drag.values.hullDrag)} />
            <Stat label="Wing + tail profile drag" value={q(drag.values.wingProfileDrag)} />
            <Stat label="Induced drag" value={q(drag.values.inducedDrag)} hint="From producing lift" />
            <Stat
              label="Appendage allowance"
              value={q(drag.values.appendageDrag)}
              hint={(drag.values.appendageDrag?.value ?? 0) === 0 ? "ZERO — the prediction will be optimistic" : "Entered allowance"}
              tone={(drag.values.appendageDrag?.value ?? 0) === 0 ? "warning" : undefined}
            />
          </div>

          <Grid cols={2}>
            <Card title="Working">
              <StepList steps={drag.steps} defaultOpen />
            </Card>
            <Card title="Assumptions, warnings and limits">
              <div className="space-y-3">
                <AssumptionList assumptions={drag.assumptions} />
                <WarningList warnings={drag.warnings} />
                <Limitations items={drag.limitations} />
              </div>
            </Card>
          </Grid>
        </div>
      )}

      {tab === "glide" && (
        <div className="space-y-4">
          <Card title="Driving force" subtitle="A glider is driven by its net buoyancy. Half the engine's total authority in each direction from neutral is used here.">
            <p className="text-xs text-muted">
              Net buoyancy used: <strong className="text-ink">{q({ value: authorityN, unit: "N" })}</strong> — half of the engine&apos;s{" "}
              {(authorityN * 2).toFixed(3)} N total swing. Change the engine geometry on the{" "}
              <Link href="/syringe" className="underline">
                Syringe page
              </Link>
              , or override the dive and climb buoyancy directly in the{" "}
              <Link href="/mission" className="underline">
                mission simulator
              </Link>
              .
            </p>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Dive speed" value={q(dive.values.speed)} hint="Along the glide path" />
            <Stat label="Dive glide angle" value={(((dive.values.glidePathAngle?.value ?? 0) * 180) / Math.PI).toFixed(2)} unit="° below horizontal" />
            <Stat label="Dive vertical speed" value={q({ value: Math.abs(dive.values.verticalSpeed?.value ?? 0), unit: "m/s" })} hint="Sink rate" />
            <Stat label="Dive horizontal speed" value={q(dive.values.horizontalSpeed)} />
            <Stat label="Climb speed" value={q(climb.values.speed)} />
            <Stat label="Climb vertical speed" value={q({ value: Math.abs(climb.values.verticalSpeed?.value ?? 0), unit: "m/s" })} />
            <Stat label="Glide ratio" value={q(dive.values.glideRatio, 3)} hint="Horizontal distance per unit depth" />
            <Stat label="Lift / drag at that condition" value={`${q(dive.values.lift, 3)} / ${q(dive.values.drag, 3)}`} />
          </div>

          <Grid cols={2}>
            <Card title="Working">
              <StepList steps={dive.steps} defaultOpen />
            </Card>
            <Card title="Assumptions, warnings and limits">
              <div className="space-y-3">
                <AssumptionList assumptions={dive.assumptions} />
                <WarningList warnings={dive.warnings} />
                <Limitations items={dive.limitations} />
              </div>
            </Card>
          </Grid>
        </div>
      )}

      {tab === "sweeps" && (
        <Grid cols={2}>
          <LinePlot
            title="Drag and lift versus speed"
            subtitle="From the component buildup at each speed"
            data={charts.dragVsSpeed}
            xKey="speed_m_s"
            xLabel="Speed (m/s)"
            yLabel="Force (N)"
            series={[
              { key: "total_drag_N", label: "Total drag", unit: "N" },
              { key: "lift_N", label: "Lift at the operating C_L", unit: "N" },
            ]}
            filename="drag-lift-vs-speed"
            note="Both scale roughly with V², but drag less than exactly so because the friction coefficient falls as Reynolds number rises."
          />
          <LinePlot
            title="Drag breakdown versus speed"
            data={charts.dragVsSpeed}
            xKey="speed_m_s"
            xLabel="Speed (m/s)"
            yLabel="Drag (N)"
            series={[
              { key: "hull_drag_N", label: "Hull", unit: "N" },
              { key: "wing_drag_N", label: "Wing + tail", unit: "N" },
              { key: "induced_drag_N", label: "Induced", unit: "N" },
            ]}
            filename="drag-breakdown"
            note="Induced drag falls as speed rises (the vehicle needs less lift coefficient); friction drag rises. Their sum has a minimum, which is the speed a glider wants to fly at."
          />
          <LinePlot
            title="Glide ratio versus angle of attack"
            subtitle={`Using the Helmbold lift slope at AR = ${settings.aspectRatio} and C_D0 = ${settings.cd0.toFixed(4)}`}
            data={charts.alphaSweep}
            xKey="alpha_deg"
            xLabel="Angle of attack (°)"
            yLabel="Glide ratio C_L / C_D"
            series={[{ key: "glide_ratio", label: "Glide ratio" }]}
            filename="glide-ratio-vs-alpha"
            note="The peak is the best-glide angle of attack. It is a MODEL result from an assumed drag polar, not a measurement — the real peak depends on where the wing stalls, which this model cannot see."
          />
          <LinePlot
            title="Lift and drag coefficients versus angle of attack"
            data={charts.alphaSweep}
            xKey="alpha_deg"
            xLabel="Angle of attack (°)"
            yLabel="Coefficient"
            series={[
              { key: "lift_coefficient", label: "C_L" },
              { key: "drag_coefficient", label: "C_D" },
            ]}
            filename="polar-vs-alpha"
            note="Linear lift and parabolic drag — the classical polar. Stall is not modelled, so do not trust the high-alpha end."
          />
          <LinePlot
            title="Speed versus net buoyancy"
            data={charts.buoySweep}
            xKey="net_buoyancy_N"
            xLabel="Net buoyancy (N)"
            yLabel="Speed (m/s)"
            series={[
              { key: "speed_m_s", label: "Along the glide path", unit: "m/s" },
              { key: "vertical_speed_m_s", label: "Vertical", unit: "m/s" },
              { key: "horizontal_speed_m_s", label: "Horizontal", unit: "m/s" },
            ]}
            filename="speed-vs-buoyancy"
            referenceLines={[{ x: authorityN, label: "current" }]}
            note="Speed goes as the square root of net buoyancy, so doubling the buoyancy authority only increases speed by about 41%. The glide angle does not change at all."
          />
          <Card title="What these sweeps are for">
            <ul className="ml-4 list-disc space-y-2 text-xs leading-relaxed text-muted">
              <li>
                <strong className="text-ink">Sizing the engine against a speed requirement.</strong> The square-root relationship means a
                vertical-speed target that is twice as fast needs four times the buoyancy authority — and four times the swept volume.
              </li>
              <li>
                <strong className="text-ink">Choosing a design speed.</strong> The drag breakdown chart shows where friction and induced drag
                trade; near that minimum the vehicle covers the most horizontal distance per joule.
              </li>
              <li>
                <strong className="text-ink">Deciding what to measure.</strong> The chart that most needs replacing by data is the glide-ratio
                curve — it rests entirely on an assumed polar.
              </li>
            </ul>
          </Card>
        </Grid>
      )}
    </div>
  );
}

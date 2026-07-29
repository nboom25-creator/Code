"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../client";
import { Card, Grid, Stat, Tabs, Badge, WarningList, AssumptionList, StepList, Limitations, Field, Spinner, ErrorNotice } from "../ui";
import { LinePlot } from "../Charts";
import { SaveCalculationButton } from "./SaveCalculationButton";
import { formatQty, type Quantity } from "@/lib/units";
import { solveTrim, computeStability } from "@/lib/calc/stability";
import { computeMassProperties, type CalcComponent } from "@/lib/calc/massprops";
import type { CalcStep, CalcWarning, CalcAssumption } from "@/lib/calc/types";

interface Comp {
  id: string;
  name: string;
  massSI: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  movable: boolean;
  minX: number | null;
  maxX: number | null;
  displacementMode: string;
  includeInBudget: boolean;
}

export function StabilityWorkspace({
  projectId,
  cg,
  cb,
  totalMassSI,
  displacedVolumeSI,
  waterDensitySI,
  gravitySI,
  stability,
  components,
  syringe,
}: {
  projectId: string;
  cg: { x: number; y: number; z: number };
  cb: { x: number; y: number; z: number };
  totalMassSI: number;
  displacedVolumeSI: number;
  waterDensitySI: number;
  gravitySI: number;
  stability: {
    values: Record<string, Quantity | undefined>;
    steps: CalcStep[];
    assumptions: CalcAssumption[];
    warnings: CalcWarning[];
    limitations: string[];
    confidence: string;
    inputs: unknown;
  };
  components: Comp[];
  syringe: { config: string; volumeChangeSI: number; changesMass: boolean };
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState("state");
  const [targetPitchDeg, setTargetPitchDeg] = React.useState(-20);
  const [moves, setMoves] = React.useState<Record<string, number>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const v = stability.values;
  const q = (x: Quantity | undefined, d = 4) => formatQty(x, d);
  const dz = v.verticalSeparation?.value ?? NaN;
  const dx = v.longitudinalSeparation?.value ?? NaN;
  const dy = v.lateralSeparation?.value ?? NaN;
  const pitchDeg = ((v.equilibriumPitch?.value ?? NaN) * 180) / Math.PI;
  const rollDeg = ((v.equilibriumRoll?.value ?? NaN) * 180) / Math.PI;

  const movable = components.filter((c) => c.movable && c.massSI > 0);

  const trim = React.useMemo(
    () =>
      solveTrim(
        (targetPitchDeg * Math.PI) / 180,
        { cgX: cg.x, cbX: cb.x, verticalSeparationSI: dz, totalMassSI },
        movable.map((c) => ({
          id: c.id,
          name: c.name,
          massSI: c.massSI,
          positionX: c.positionX,
          minX: c.minX ?? c.positionX - 0.2,
          maxX: c.maxX ?? c.positionX + 0.2,
        })),
      ),
    [targetPitchDeg, cg.x, cb.x, dz, totalMassSI, movable],
  );

  // "What if I move this component?" — recompute mass properties live without
  // touching the stored data.
  const previewComponents: CalcComponent[] = components
    .filter((c) => c.includeInBudget)
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: "preview",
      quantity: 1,
      massSI: c.massSI,
      displacedVolumeSI: undefined,
      displacementMode: c.displacementMode as CalcComponent["displacementMode"],
      position: { x: c.positionX + (moves[c.id] ?? 0), y: c.positionY, z: c.positionZ },
      includeInBudget: true,
    }));
  const previewMass = computeMassProperties(previewComponents);
  const previewCg = previewMass.cg;
  const previewStability = computeStability({
    cg: previewCg,
    cb,
    displacedVolumeSI,
    waterDensitySI,
    massSI: totalMassSI,
    gravitySI,
  });
  const previewPitchDeg = ((previewStability.values.equilibriumPitch.value ?? NaN) * 180) / Math.PI;
  const anyMoves = Object.values(moves).some((m) => Math.abs(m) > 1e-9);

  // Righting-moment curve.
  const buoyantForce = waterDensitySI * gravitySI * displacedVolumeSI;
  const bg = v.bgDistance?.value ?? 0;
  const curve = Array.from({ length: 37 }, (_, i) => {
    const deg = i * 5;
    return {
      angle_deg: deg,
      righting_moment_mNm: Number((buoyantForce * bg * Math.sin((deg * Math.PI) / 180) * 1000).toFixed(3)),
    };
  });

  const applyMoves = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const [id, delta] of Object.entries(moves)) {
        if (Math.abs(delta) < 1e-9) continue;
        const comp = components.find((c) => c.id === id);
        if (!comp) continue;
        await api.update(projectId, "components", id, { pos_x: comp.positionX + delta });
      }
      setMoves({});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          tabs={[
            { id: "state", label: "Current state" },
            { id: "move", label: "Move components" },
            { id: "trim", label: "Trim solver" },
            { id: "curve", label: "Righting moment" },
          ]}
          active={tab}
          onChange={setTab}
        />
        <SaveCalculationButton
          projectId={projectId}
          calcId="stability.static"
          title="Static stability and trim"
          inputs={stability.inputs}
          results={stability.values}
          warnings={stability.warnings}
          assumptions={stability.assumptions}
          steps={stability.steps}
          confidence={stability.confidence}
        />
      </div>

      {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}

      {tab === "state" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Vertical CB − CG"
              value={Number.isFinite(dz) ? (dz * 1000).toFixed(2) : "—"}
              unit="mm"
              hint={dz <= 0 ? "CB is NOT above CG — no righting moment" : dz < 0.005 ? "Inside typical build tolerance" : "Positive: the vehicle self-rights"}
              tone={!Number.isFinite(dz) ? "critical" : dz <= 0 ? "critical" : dz < 0.005 ? "warning" : "good"}
            />
            <Stat label="Longitudinal CB − CG" value={Number.isFinite(dx) ? (dx * 1000).toFixed(2) : "—"} unit="mm" hint="Sets the equilibrium pitch" />
            <Stat
              label="Lateral CB − CG"
              value={Number.isFinite(dy) ? (dy * 1000).toFixed(2) : "—"}
              unit="mm"
              hint={Math.abs(dy) > 0.002 ? "The vehicle will hang with a permanent roll" : "Laterally balanced"}
              tone={Math.abs(dy) > 0.002 ? "warning" : "good"}
            />
            <Stat label="|BG|" value={Number.isFinite(bg) ? (bg * 1000).toFixed(2) : "—"} unit="mm" hint="Total CB–CG separation" />
            <Stat label="Equilibrium pitch" value={Number.isFinite(pitchDeg) ? pitchDeg.toFixed(2) : "—"} unit="° nose-up" hint="Attitude the vehicle hangs at when still" />
            <Stat label="Equilibrium roll" value={Number.isFinite(rollDeg) ? rollDeg.toFixed(2) : "—"} unit="° port-up" hint="Should be zero for a straight glide" />
            <Stat label="Righting moment at 10°" value={q(v.rightingMomentAtAngle)} hint="ρ g V · BG · sin θ" />
            <Stat label="Small-angle stiffness" value={q(v.pitchStiffness)} unit="per rad" hint="How hard the vehicle resists being tipped" />
          </div>

          <Grid cols={2}>
            <Card title="CG and CB positions">
              <table className="gf-table">
                <thead>
                  <tr>
                    <th />
                    <th>x — forward (mm)</th>
                    <th>y — port (mm)</th>
                    <th>z — up (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-medium">Centre of gravity</td>
                    <td>{Number.isFinite(cg.x) ? (cg.x * 1000).toFixed(2) : "—"}</td>
                    <td>{Number.isFinite(cg.y) ? (cg.y * 1000).toFixed(2) : "—"}</td>
                    <td>{Number.isFinite(cg.z) ? (cg.z * 1000).toFixed(2) : "—"}</td>
                  </tr>
                  <tr>
                    <td className="font-medium">Centre of buoyancy</td>
                    <td>{Number.isFinite(cb.x) ? (cb.x * 1000).toFixed(2) : "—"}</td>
                    <td>{Number.isFinite(cb.y) ? (cb.y * 1000).toFixed(2) : "—"}</td>
                    <td>{Number.isFinite(cb.z) ? (cb.z * 1000).toFixed(2) : "—"}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-[11px] leading-snug text-muted">
                Frame: +x forward, +y to port, +z up, origin at your chosen datum. See the arrangement in 3D on the{" "}
                <Link href="/viewer" className="underline">
                  CAD viewer
                </Link>
                .
              </p>
            </Card>

            <Card title="Effect of the buoyancy engine on trim">
              <p className="text-xs leading-relaxed text-muted">
                Architecture: <strong className="text-ink">{syringe.config}</strong>.
              </p>
              {syringe.changesMass ? (
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  This architecture takes water <strong className="text-ink">inside</strong> the vehicle, so actuating it adds up to{" "}
                  <strong className="text-ink">{(syringe.volumeChangeSI * waterDensitySI * 1000).toFixed(0)} g</strong> at the tank location.
                  That mass shift moves the CG and changes the trim between the dive and climb states — the two states do not have the same
                  equilibrium pitch. Add the ballast tank as a component with its real position so this appears in the numbers above.
                </p>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  This architecture keeps vehicle mass constant, so the CG does not move when the engine actuates. The{" "}
                  <strong className="text-ink">CB</strong> does move, towards the end where the volume changes — by roughly{" "}
                  {(syringe.volumeChangeSI * 1e6).toFixed(1)} cm³ of displacement appearing at the plunger. On a vehicle displacing{" "}
                  {(displacedVolumeSI * 1e6).toFixed(0)} cm³ that is a small but not always negligible shift; if your trim is marginal, model
                  the extended and retracted states as two separate component configurations.
                </p>
              )}
            </Card>
          </Grid>

          <Grid cols={2}>
            <Card title="Working">
              <StepList steps={stability.steps} defaultOpen />
            </Card>
            <Card title="Assumptions, warnings and limits">
              <div className="space-y-3">
                <AssumptionList assumptions={stability.assumptions} />
                <WarningList warnings={stability.warnings} />
                <Limitations items={stability.limitations} />
              </div>
            </Card>
          </Grid>
        </div>
      )}

      {tab === "move" && (
        <div className="space-y-4">
          <Card title="Move components along the vehicle axis" subtitle="Drag a slider to see the CG and equilibrium pitch update immediately. Nothing is saved until you apply.">
            <div className="space-y-3">
              {components
                .filter((c) => c.includeInBudget && c.massSI > 0)
                .sort((a, b) => b.massSI - a.massSI)
                .slice(0, 12)
                .map((c) => {
                  const delta = moves[c.id] ?? 0;
                  const lo = (c.minX ?? c.positionX - 0.15) - c.positionX;
                  const hi = (c.maxX ?? c.positionX + 0.15) - c.positionX;
                  return (
                    <div key={c.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <div>
                        <span className="text-xs font-medium">{c.name}</span>
                        <span className="ml-2 text-[11px] text-muted">
                          {(c.massSI * 1000).toFixed(0)} g at x = {((c.positionX + delta) * 1000).toFixed(1)} mm
                        </span>
                        {c.movable && <Badge tone="accent">movable</Badge>}
                      </div>
                      <input
                        type="range"
                        className="w-full accent-[color:rgb(var(--accent))] sm:w-64"
                        min={lo}
                        max={hi}
                        step={0.001}
                        value={delta}
                        aria-label={`Move ${c.name} along x`}
                        onChange={(e) => setMoves((m) => ({ ...m, [c.id]: Number(e.target.value) }))}
                      />
                      <span className="gf-num w-20 text-right text-xs">{(delta * 1000).toFixed(1)} mm</span>
                    </div>
                  );
                })}
            </div>
          </Card>

          <Grid cols={2}>
            <Card title="Preview">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="CG x (now)" value={(cg.x * 1000).toFixed(2)} unit="mm" />
                <Stat label="CG x (preview)" value={Number.isFinite(previewCg.x) ? (previewCg.x * 1000).toFixed(2) : "—"} unit="mm" tone={anyMoves ? "warning" : undefined} />
                <Stat label="Equilibrium pitch (now)" value={Number.isFinite(pitchDeg) ? pitchDeg.toFixed(2) : "—"} unit="°" />
                <Stat label="Equilibrium pitch (preview)" value={Number.isFinite(previewPitchDeg) ? previewPitchDeg.toFixed(2) : "—"} unit="°" tone={anyMoves ? "warning" : undefined} />
              </div>
              <div className="mt-3 flex gap-2">
                <button className="gf-btn gf-btn-primary" onClick={applyMoves} disabled={!anyMoves || busy}>
                  {busy ? <Spinner label="Applying…" /> : "Apply these moves to the components"}
                </button>
                <button className="gf-btn" onClick={() => setMoves({})} disabled={!anyMoves}>
                  Reset
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted">
                Applying writes the new positions to the component records, which is undoable from the header. The preview holds the CB fixed;
                if you move a water-exposed component the CB moves too, so re-check this page after applying.
              </p>
            </Card>
            <Card title="Warnings from the preview">
              <WarningList warnings={previewStability.warnings} title="" />
            </Card>
          </Grid>
        </div>
      )}

      {tab === "trim" && (
        <div className="space-y-4">
          <Card title="Trim solver">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Target pitch: ${targetPitchDeg.toFixed(1)}° (${targetPitchDeg < 0 ? "nose-down, a dive" : targetPitchDeg > 0 ? "nose-up, a climb" : "level"})`} hint="Nose-up positive. A glider dives nose-down and climbs nose-up, so you will normally trim for one and rely on the buoyancy engine plus the movable mass for the other.">
                <input
                  type="range"
                  className="w-full accent-[color:rgb(var(--accent))]"
                  min={-45}
                  max={45}
                  step={0.5}
                  value={targetPitchDeg}
                  onChange={(e) => setTargetPitchDeg(Number(e.target.value))}
                  aria-label="Target pitch angle"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Required CG x" value={Number.isFinite(trim.requiredCgX) ? (trim.requiredCgX * 1000).toFixed(2) : "—"} unit="mm" />
                <Stat label="CG shift needed" value={Number.isFinite(trim.requiredCgShiftSI) ? (trim.requiredCgShiftSI * 1000).toFixed(2) : "—"} unit="mm" hint={trim.requiredCgShiftSI >= 0 ? "forward" : "aft"} />
              </div>
            </div>

            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Single-component solutions</h3>
              {trim.solutions.length === 0 ? (
                <p className="text-xs text-muted">
                  No components are marked movable. Mark the battery or a ballast mass as movable on the{" "}
                  <Link href="/components" className="underline">
                    Components page
                  </Link>{" "}
                  and give it a travel range.
                </p>
              ) : (
                <table className="gf-table">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Current x</th>
                      <th>Required x</th>
                      <th>Movement</th>
                      <th>Within travel?</th>
                      <th>Achievable pitch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trim.solutions.map((s) => (
                      <tr key={s.componentId}>
                        <td className="font-medium">{s.componentName}</td>
                        <td>{(s.currentX * 1000).toFixed(1)} mm</td>
                        <td>{(s.requiredX * 1000).toFixed(1)} mm</td>
                        <td>
                          {(s.travelSI * 1000).toFixed(1)} mm {s.travelSI >= 0 ? "forward" : "aft"}
                        </td>
                        <td>{s.withinLimits ? <Badge tone="good">yes</Badge> : <Badge tone="critical">no</Badge>}</td>
                        <td>{s.achievablePitchDeg.toFixed(1)}°</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-3 rounded border border-[#fab219] p-2.5 text-[11px] leading-snug text-muted">
              <strong className="text-[#fab219]">This is not a unique answer. </strong>
              {trim.nonUniqueness}
            </div>

            <WarningList warnings={trim.warnings} />

            <div className="mt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Constraints applied</h4>
              <ul className="ml-4 mt-1 list-disc space-y-0.5 text-[11px] text-muted">
                <li>Each component is confined to its recorded travel range; where none is set, ±150 mm is assumed and flagged.</li>
                <li>The centre of buoyancy is held fixed — valid only for components that are inside a sealed hull.</li>
                <li>Only longitudinal (x) movement is considered. Moving mass vertically would change the CB–CG separation, which is what keeps the vehicle upright.</li>
                <li>No check is made for physical interference between components; the viewer and your CAD are the place for that.</li>
              </ul>
            </div>
          </Card>
        </div>
      )}

      {tab === "curve" && (
        <Grid cols={2}>
          <LinePlot
            title="Righting moment versus disturbance angle"
            subtitle="M = ρ g V · BG · sin θ"
            data={curve}
            xKey="angle_deg"
            xLabel="Disturbance angle (°)"
            yLabel="Righting moment (mN·m)"
            series={[{ key: "righting_moment_mNm", label: "Righting moment", unit: "mN·m" }]}
            filename="righting-moment"
            note="Peaks at 90° and returns to zero at 180°, where the vehicle is inverted and equally happy — a submerged body has no range of stability in the surface-ship sense, only a restoring moment that vanishes upside down. What matters in practice is the slope near zero."
          />
          <Card title="Reading this curve">
            <ul className="ml-4 list-disc space-y-2 text-xs leading-relaxed text-muted">
              <li>
                The <strong className="text-ink">slope at zero</strong> is the stiffness: {q(v.pitchStiffness)} per radian here. A stiffer
                vehicle self-rights faster but also resists the pitch changes you want during a glide.
              </li>
              <li>
                Everything scales with <strong className="text-ink">BG</strong>, the CB–CG separation. Doubling it doubles the whole curve.
              </li>
              <li>
                This is <strong className="text-ink">static</strong> only. It says nothing about how fast the vehicle returns, which depends on
                added mass and on damping from the fins — a stiff vehicle with little damping oscillates rather than settling.
              </li>
              <li>
                Verify it in a tank before trusting it: disturb the vehicle by hand and watch how briskly and how smoothly it comes back.
              </li>
            </ul>
          </Card>
        </Grid>
      )}
    </div>
  );
}

"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, downloadText, toCsv, type Row } from "../client";
import { Card, Grid, Stat, Badge, UnitInput, NumberInput, Checkbox, Spinner, ErrorNotice, WarningList } from "../ui";
import { LinePlot } from "../Charts";
import type { MissionResult, MissionState } from "@/lib/calc/mission";
import { formatQty } from "@/lib/units";

export function MissionWorkspace({
  projectId,
  stateDescriptions,
  defaults,
  context,
  savedSimulations,
}: {
  projectId: string;
  stateDescriptions: Record<MissionState, string>;
  defaults: {
    targetDepthSI: number;
    depthLimitSI: number;
    surfaceThresholdSI: number;
    cycles: number;
    bottomDwellSI: number;
    surfaceDwellSI: number;
    currentVelocitySI: number;
    velocityTimeConstantSI: number;
    diveNetBuoyancySI: number;
    climbNetBuoyancySI: number;
    actuationTimeSI: number;
  };
  context: {
    authorityN: number;
    batteryWh: number;
    hotelW: number;
    actuatorW: number;
    coefficientSource: string;
    diveSpeed: number;
    glideRatio: number;
  };
  savedSimulations: Row[];
}) {
  const router = useRouter();
  const [inputs, setInputs] = React.useState(defaults);
  const [result, setResult] = React.useState<MissionResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [save, setSave] = React.useState(false);

  const set = <K extends keyof typeof defaults>(k: K, v: (typeof defaults)[K]) => setInputs((s) => ({ ...s, [k]: v }));

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.simulate(projectId, { ...inputs, save });
      setResult(res.result as MissionResult);
      if (save) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Decimate the trace for plotting so a long run stays responsive; the CSV
  // export always carries every sample.
  const plotData = React.useMemo(() => {
    if (!result) return [];
    const stride = Math.max(1, Math.ceil(result.samples.length / 900));
    return result.samples
      .filter((_, i) => i % stride === 0)
      .map((s) => ({
        time_s: Number(s.t.toFixed(2)),
        depth_m: Number(s.depth.toFixed(4)),
        horizontal_m: Number(s.x.toFixed(3)),
        vertical_speed_m_s: Number(s.verticalSpeed.toFixed(4)),
        state_of_charge: Number((s.stateOfCharge * 100).toFixed(2)),
        power_W: Number(s.power.toFixed(3)),
        net_buoyancy_N: Number(s.netBuoyancy.toFixed(4)),
      }));
  }, [result]);

  const trajectory = React.useMemo(() => {
    if (!result) return [];
    const stride = Math.max(1, Math.ceil(result.samples.length / 900));
    return result.samples.filter((_, i) => i % stride === 0).map((s) => ({ horizontal_m: Number(s.x.toFixed(3)), depth_m: Number(s.depth.toFixed(4)) }));
  }, [result]);

  const stateTotals = React.useMemo(() => {
    if (!result) return [];
    const totals = new Map<string, { time: number; energy: number }>();
    for (let i = 1; i < result.samples.length; i++) {
      const s = result.samples[i - 1];
      const dt = result.samples[i].t - s.t;
      const e = totals.get(s.state) ?? { time: 0, energy: 0 };
      e.time += dt;
      e.energy += s.power * dt;
      totals.set(s.state, e);
    }
    return [...totals.entries()].map(([state, v]) => ({ state, time_s: Number(v.time.toFixed(1)), energy_J: Number(v.energy.toFixed(1)) })).sort((a, b) => b.energy_J - a.energy_J);
  }, [result]);

  return (
    <div className="space-y-4">
      {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}

      <Grid cols={2}>
        <Card title="Mission inputs" subtitle="Defaults come from project settings and the buoyancy engine. Override them here to explore without changing the project.">
          <Grid cols={2}>
            <UnitInput label="Target depth" dimension="length" valueSI={inputs.targetDepthSI} onChangeSI={(v) => set("targetDepthSI", v ?? 0)} />
            <UnitInput label="Depth limit (fault)" dimension="length" valueSI={inputs.depthLimitSI} onChangeSI={(v) => set("depthLimitSI", v ?? 0)} />
            <UnitInput label="Surface threshold" dimension="length" valueSI={inputs.surfaceThresholdSI} onChangeSI={(v) => set("surfaceThresholdSI", v ?? 0)} />
            <NumberInput label="Cycles" value={inputs.cycles} onChange={(v) => set("cycles", v ?? 1)} min={1} max={200} />
            <UnitInput label="Dive net buoyancy (negative)" dimension="force" valueSI={inputs.diveNetBuoyancySI} onChangeSI={(v) => set("diveNetBuoyancySI", Math.min(0, v ?? 0))} hint={`The engine's total swing is ${context.authorityN.toFixed(3)} N; half in each direction is the default.`} />
            <UnitInput label="Climb net buoyancy (positive)" dimension="force" valueSI={inputs.climbNetBuoyancySI} onChangeSI={(v) => set("climbNetBuoyancySI", Math.max(0, v ?? 0))} />
            <UnitInput label="Actuation time" dimension="time" valueSI={inputs.actuationTimeSI} onChangeSI={(v) => set("actuationTimeSI", v ?? 0)} hint="Time for the engine to move between states." />
            <UnitInput label="Bottom dwell" dimension="time" valueSI={inputs.bottomDwellSI} onChangeSI={(v) => set("bottomDwellSI", v ?? 0)} />
            <UnitInput label="Surface dwell" dimension="time" valueSI={inputs.surfaceDwellSI} onChangeSI={(v) => set("surfaceDwellSI", v ?? 0)} />
            <UnitInput label="Ambient current" dimension="velocity" valueSI={inputs.currentVelocitySI} onChangeSI={(v) => set("currentVelocitySI", v ?? 0)} />
            <UnitInput
              label="Velocity time constant"
              dimension="time"
              valueSI={inputs.velocityTimeConstantSI}
              onChangeSI={(v) => set("velocityTimeConstantSI", v ?? 0)}
              hint="0 applies equilibrium glide speed instantly, which is optimistic. Set a few seconds to see how much the acceleration transient matters on a short dive."
            />
          </Grid>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="gf-btn gf-btn-primary" onClick={run} disabled={busy}>
              {busy ? <Spinner label="Simulating…" /> : "Run simulation"}
            </button>
            <Checkbox label="Save this run to the project" checked={save} onChange={setSave} hint="Stores the summary, a decimated trace and an immutable calculation snapshot." />
          </div>
        </Card>

        <Card title="Model inputs coming from elsewhere">
          <table className="gf-table">
            <tbody>
              <tr>
                <td className="font-medium">Buoyancy engine authority</td>
                <td>
                  {context.authorityN.toFixed(4)} N total
                  <Link href="/syringe" className="ml-2 text-[11px] underline">
                    syringe
                  </Link>
                </td>
              </tr>
              <tr>
                <td className="font-medium">Hydrodynamic coefficients</td>
                <td>
                  <Badge tone={context.coefficientSource === "experimental" ? "good" : "warning"}>{context.coefficientSource}</Badge>
                  <Link href="/hydro" className="ml-2 text-[11px] underline">
                    hydrodynamics
                  </Link>
                </td>
              </tr>
              <tr>
                <td className="font-medium">Predicted dive speed / glide ratio</td>
                <td>
                  {context.diveSpeed.toFixed(3)} m/s · {context.glideRatio.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td className="font-medium">Usable battery energy</td>
                <td>
                  {context.batteryWh.toFixed(2)} Wh
                  <Link href="/electronics" className="ml-2 text-[11px] underline">
                    power budget
                  </Link>
                </td>
              </tr>
              <tr>
                <td className="font-medium">Hotel / actuator power</td>
                <td>
                  {context.hotelW.toFixed(3)} W / {context.actuatorW.toFixed(2)} W
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-snug text-muted">
            Everything the simulator needs comes from data you entered elsewhere. If a number here is wrong, fix it at its source rather than
            compensating in the simulation.
          </p>
        </Card>
      </Grid>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Cycles completed"
              value={`${result.summary.completedCycles} / ${result.summary.requestedCycles}`}
              tone={result.summary.completedCycles >= result.summary.requestedCycles ? "good" : "critical"}
            />
            <Stat label="Mission duration" value={(result.summary.durationS / 60).toFixed(1)} unit="min" />
            <Stat label="Maximum depth" value={result.summary.maxDepthM.toFixed(2)} unit="m" />
            <Stat label="Horizontal distance" value={result.summary.horizontalDistanceM.toFixed(1)} unit="m" hint="Range over the ground, including any current" />
            <Stat label="Energy used" value={(result.summary.energyUsedJ / 3600).toFixed(2)} unit="Wh" />
            <Stat
              label="Energy remaining"
              value={(result.summary.energyRemainingJ / 3600).toFixed(2)}
              unit="Wh"
              tone={result.summary.energyRemainingJ <= 0 ? "critical" : result.summary.energyRemainingJ / 3600 < context.batteryWh * 0.2 ? "warning" : "good"}
            />
            <Stat label="Energy per cycle" value={Number.isFinite(result.summary.energyPerCycleJ) ? result.summary.energyPerCycleJ.toFixed(0) : "—"} unit="J" />
            <Stat
              label="Final state"
              value={result.summary.finalState}
              tone={result.summary.finalState === "complete" ? "good" : "critical"}
              hint={stateDescriptions[result.summary.finalState]}
            />
          </div>

          {result.summary.limitViolations.length > 0 && (
            <Card title="Limit violations">
              <ul className="ml-4 list-disc space-y-1 text-xs text-[#d03b3b]">
                {result.summary.limitViolations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </Card>
          )}

          <Grid cols={2}>
            <LinePlot
              title="Depth versus time"
              subtitle="The sawtooth a glider is supposed to produce"
              data={plotData}
              xKey="time_s"
              xLabel="Time (s)"
              yLabel="Depth (m)"
              series={[{ key: "depth_m", label: "Depth", unit: "m" }]}
              filename="mission-depth"
              invertY
              referenceLines={[
                { y: inputs.targetDepthSI, label: "target depth" },
                { y: inputs.depthLimitSI, label: "depth limit" },
              ]}
              note="Depth increases downwards. Flat sections at the top and bottom are the dwell and actuation states, where the vehicle is neither diving nor climbing."
            />
            <LinePlot
              title="Predicted trajectory: depth versus horizontal position"
              data={trajectory}
              xKey="horizontal_m"
              xLabel="Horizontal position (m)"
              yLabel="Depth (m)"
              series={[{ key: "depth_m", label: "Trajectory", unit: "m" }]}
              filename="mission-trajectory"
              invertY
              note="The slope of each leg is the glide ratio. A steeper trajectory than expected usually means the drag coefficient is too low or the vehicle is not reaching steady glide."
            />
            <LinePlot
              title="Horizontal position versus time"
              data={plotData}
              xKey="time_s"
              xLabel="Time (s)"
              yLabel="Horizontal position (m)"
              series={[{ key: "horizontal_m", label: "Horizontal position", unit: "m" }]}
              filename="mission-horizontal"
              note="Slope is horizontal speed. Flat sections are dwells; if a current is set, the vehicle drifts during them."
            />
            <LinePlot
              title="Battery state of charge versus time"
              data={plotData}
              xKey="time_s"
              xLabel="Time (s)"
              yLabel="State of charge (%)"
              series={[{ key: "state_of_charge", label: "State of charge", unit: "%" }]}
              filename="mission-soc"
              referenceLines={[{ y: 20, label: "20% reserve" }]}
              note="Steps down sharply at each actuation. Keep enough reserve for one full ascent at all times — that is what a low-voltage abort threshold is for."
            />
            <LinePlot
              title="Vertical speed versus time"
              data={plotData}
              xKey="time_s"
              xLabel="Time (s)"
              yLabel="Vertical speed (m/s)"
              series={[{ key: "vertical_speed_m_s", label: "Vertical speed", unit: "m/s" }]}
              filename="mission-vertical-speed"
              note="Positive is upward. With a zero velocity time constant these are step changes, which is optimistic — a real vehicle ramps up over several seconds."
            />
            <LinePlot
              title="Power versus time"
              data={plotData}
              xKey="time_s"
              xLabel="Time (s)"
              yLabel="Power (W)"
              series={[{ key: "power_W", label: "Instantaneous power", unit: "W" }]}
              filename="mission-power"
              note="The tall narrow spikes are buoyancy engine actuations. Their area is what drains the battery; their height is what the driver and pack must survive."
            />
          </Grid>

          <Grid cols={2}>
            <Card
              title="State machine trace"
              subtitle={`${result.events.length} transitions`}
              actions={
                <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => downloadText("mission-events.csv", toCsv(result.events as unknown as Record<string, unknown>[]), "text/csv")}>
                  CSV
                </button>
              }
            >
              <div className="max-h-80 overflow-y-auto">
                <table className="gf-table">
                  <thead className="sticky top-0 bg-panel">
                    <tr>
                      <th>t (s)</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.events.map((e, i) => (
                      <tr key={i}>
                        <td>{e.t.toFixed(1)}</td>
                        <td className="text-[11px] text-muted">{e.from}</td>
                        <td className="text-[11px] font-medium">{e.to}</td>
                        <td className="text-[11px] text-muted">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Energy breakdown by state">
              <table className="gf-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Time (s)</th>
                    <th>Energy (J)</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {stateTotals.map((s) => (
                    <tr key={s.state}>
                      <td>
                        <span className="font-medium">{s.state}</span>
                        <span className="block text-[10px] leading-snug text-muted">{stateDescriptions[s.state as MissionState]}</span>
                      </td>
                      <td>{s.time_s}</td>
                      <td>{s.energy_J}</td>
                      <td>{result.summary.energyUsedJ > 0 ? `${((s.energy_J / result.summary.energyUsedJ) * 100).toFixed(1)} %` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </Grid>

          <Grid cols={2}>
            <Card title="Model assumptions">
              <ul className="ml-4 list-disc space-y-1 text-xs text-muted">
                {result.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Equations</h4>
              <pre className="gf-scroll-x mt-1 rounded bg-surface p-2 font-mono text-[11px]">{result.equations.join("\n")}</pre>
            </Card>
            <Card
              title="Export"
              actions={
                <>
                  <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => downloadText("mission-timeseries.csv", toCsv(result.samples as unknown as Record<string, unknown>[]), "text/csv")}>
                    CSV
                  </button>
                  <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => downloadText("mission-run.json", JSON.stringify(result, null, 2), "application/json")}>
                    JSON
                  </button>
                </>
              }
            >
              <p className="text-xs leading-relaxed text-muted">
                The CSV contains every simulated sample ({result.samples.length.toLocaleString()} rows) with time, depth, horizontal position,
                state, speeds, net buoyancy, power, cumulative energy and state of charge. The JSON additionally contains the event list, the
                summary and the model assumptions.
              </p>
              <WarningList warnings={result.warnings} />
            </Card>
          </Grid>
        </>
      )}

      {savedSimulations.length > 0 && (
        <Card title={`Saved simulation runs (${savedSimulations.length})`}>
          <table className="gf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Saved</th>
                <th>Cycles</th>
                <th>Duration</th>
                <th>Distance</th>
                <th>Energy</th>
              </tr>
            </thead>
            <tbody>
              {savedSimulations.map((s) => {
                let summary: { completedCycles?: number; requestedCycles?: number; durationS?: number; horizontalDistanceM?: number; energyUsedJ?: number } = {};
                try {
                  summary = JSON.parse(String(s.summary_json ?? "{}"));
                } catch {
                  /* a malformed stored summary is shown as blank rather than guessed at */
                }
                return (
                  <tr key={String(s.id)}>
                    <td className="font-medium">{String(s.name)}</td>
                    <td className="text-[11px] text-muted">{String(s.created_at).slice(0, 16).replace("T", " ")}</td>
                    <td>
                      {summary.completedCycles ?? "—"} / {summary.requestedCycles ?? "—"}
                    </td>
                    <td>{summary.durationS !== undefined ? `${(summary.durationS / 60).toFixed(1)} min` : "—"}</td>
                    <td>{summary.horizontalDistanceM !== undefined ? `${summary.horizontalDistanceM.toFixed(1)} m` : "—"}</td>
                    <td>{summary.energyUsedJ !== undefined ? formatQty({ value: summary.energyUsedJ / 3600, unit: "Wh" }, 3) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

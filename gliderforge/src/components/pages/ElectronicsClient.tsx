"use client";

import React from "react";
import { RecordEditor, type FieldSpec } from "./RecordEditor";
import type { Row } from "../client";
import { Card, Grid, Stat, Tabs, Badge, WarningList, StepList, AssumptionList, Limitations } from "../ui";
import { BarPlot } from "../Charts";
import { formatQty } from "@/lib/units";
import type { CalcWarning, CalcStep, CalcAssumption } from "@/lib/calc/types";
import type { PowerBreakdownRow } from "@/lib/calc/power";
import { CONTROL_STRATEGIES, PREDEPLOYMENT_CHECKLIST, FAULT_RESPONSES, buildPseudocode } from "@/lib/electronics/control";

const KINDS = [
  "microcontroller",
  "motor-driver",
  "motor",
  "actuator",
  "pressure-sensor",
  "depth-sensor",
  "imu",
  "leak-sensor",
  "limit-switch",
  "battery",
  "regulator",
  "radio",
  "storage",
  "other",
];

const LOAD_FIELDS: FieldSpec[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "kind", label: "Kind", type: "select", options: KINDS.map((k) => ({ value: k, label: k })) },
  { key: "part_number", label: "Part number", type: "text" },
  { key: "current_a", label: "Current while active", type: "quantity", dimension: "current", defaultUnit: "mA", hint: "Measured is far better than datasheet-typical; quiescent currents in a real circuit are routinely several times higher." },
  { key: "voltage_v", label: "Supply voltage", type: "quantity", dimension: "voltage", hint: "The rail this load runs from, not the battery voltage, unless they are the same." },
  { key: "duty_cycle", label: "Duty cycle (0–1)", type: "number", min: 0, max: 1, hint: "Fraction of mission time the load is active. This is what actually sets endurance." },
  { key: "regulator_efficiency", label: "Regulator efficiency (0–1)", type: "number", min: 0.01, max: 1, hint: "Losses between the battery and this load. A linear regulator dropping 11.1 V to 3.3 V is about 0.3." },
  {
    key: "provenance",
    label: "Provenance",
    type: "select",
    options: [
      { value: "estimated", label: "Estimated" },
      { value: "datasheet", label: "Datasheet" },
      { value: "measured", label: "Measured" },
    ],
  },
  { key: "notes", label: "Notes", type: "textarea", rows: 2 },
];

const PIN_FIELDS: FieldSpec[] = [
  { key: "controller", label: "Controller", type: "text", required: true },
  { key: "pin", label: "Pin", type: "text", required: true },
  { key: "signal", label: "Signal", type: "text", required: true },
  {
    key: "direction",
    label: "Direction",
    type: "select",
    options: [
      { value: "input", label: "Input" },
      { value: "output", label: "Output" },
      { value: "bidirectional", label: "Bidirectional" },
      { value: "power", label: "Power" },
    ],
  },
  { key: "peripheral", label: "Peripheral", type: "text" },
  { key: "wire_color", label: "Wire colour", type: "text", hint: "Record it — you will be tracing this loom at the poolside." },
  { key: "notes", label: "Notes", type: "textarea", rows: 2 },
];

export function ElectronicsClient({
  projectId,
  electronics,
  pins,
  power,
  battery,
  syringe,
}: {
  projectId: string;
  electronics: Row[];
  pins: Row[];
  power: {
    averageW: number;
    peakW: number;
    hotelW: number;
    actuatorW: number;
    usableJ: number;
    enduranceS: number;
    breakdown: PowerBreakdownRow[];
    warnings: CalcWarning[];
    steps: CalcStep[];
    assumptions: CalcAssumption[];
    limitations: string[];
  };
  battery: { chemistry: string; nominalVoltageSI: number; capacitySI: number; provenance: string };
  syringe: { actuationTimeS?: number; energyPerStrokeJ?: number; config: string };
}) {
  const [tab, setTab] = React.useState("power");
  const [strategy, setStrategy] = React.useState(CONTROL_STRATEGIES[0].id);
  const [platform, setPlatform] = React.useState("");

  const q = (v: number, unit: string, d = 4) => (Number.isFinite(v) ? formatQty({ value: v, unit }, d) : "—");
  const chart = power.breakdown
    .filter((b) => b.averagePowerW > 0)
    .map((b) => ({ name: b.name.length > 24 ? `${b.name.slice(0, 23)}…` : b.name, average_power_mW: Number((b.averagePowerW * 1000).toFixed(2)) }));

  const selected = CONTROL_STRATEGIES.find((s) => s.id === strategy)!;

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { id: "power", label: "Power budget" },
          { id: "loads", label: "Loads", badge: electronics.length },
          { id: "pins", label: "Wiring & pins", badge: pins.length },
          { id: "control", label: "Control strategy" },
          { id: "checklist", label: "Checklist & faults" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "power" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Average power" value={q(power.averageW, "W")} hint="Sets endurance" />
            <Stat label="Peak power (all loads at once)" value={q(power.peakW, "W")} hint="Sets the pack, wiring and regulator rating" />
            <Stat label="Usable battery energy" value={q(power.usableJ / 3600, "Wh")} hint={`${battery.chemistry}, provenance: ${battery.provenance}`} provenance={battery.provenance === "measured" ? "measured" : battery.provenance === "datasheet" ? "reference" : "estimated"} />
            <Stat
              label="Endurance"
              value={Number.isFinite(power.enduranceS) ? (power.enduranceS / 3600).toFixed(2) : "—"}
              unit="h"
              hint="Usable energy ÷ average power"
            />
          </div>

          <Grid cols={2}>
            <BarPlot
              title="Average power by load"
              subtitle="What actually drains the battery over a mission"
              data={chart}
              categoryKey="name"
              valueKey="average_power_mW"
              valueLabel="Average power (mW)"
              filename="power-budget"
              colorByIndex
              labelFormatter={(v) => `${v.toFixed(1)} mW`}
              note="Average power is active power × duty cycle. A high-current actuator with a 5% duty cycle can matter less than a small always-on controller."
            />
            <Card title="Buoyancy engine energy" subtitle={`Architecture: ${syringe.config}`}>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Actuation time per stroke" value={syringe.actuationTimeS !== undefined ? q(syringe.actuationTimeS, "s") : "—"} hint="From motor speed and lead screw" />
                <Stat label="Electrical energy per stroke" value={syringe.energyPerStrokeJ !== undefined ? q(syringe.energyPerStrokeJ, "J") : "—"} hint="Two strokes per dive-and-climb cycle" />
              </div>
              <p className="mt-3 text-[11px] leading-snug text-muted">
                A full cycle costs roughly twice the per-stroke energy, plus hotel load for the whole cycle duration. The mission simulator
                integrates this properly rather than multiplying — use its result for an endurance claim.
              </p>
            </Card>
          </Grid>

          <Card title="How the budget was computed">
            <div className="space-y-3">
              <StepList steps={power.steps} />
              <AssumptionList assumptions={power.assumptions} />
              <WarningList warnings={power.warnings} />
              <Limitations items={power.limitations} />
            </div>
          </Card>
        </div>
      )}

      {tab === "loads" && (
        <RecordEditor
          projectId={projectId}
          table="electronics"
          rows={electronics}
          fields={LOAD_FIELDS}
          titleKey="name"
          addLabel="Add load"
          exportName="electrical-loads"
          searchKeys={["name", "kind", "part_number"]}
          newRecordDefaults={{ kind: "sensor", duty_cycle: 1, regulator_efficiency: 1, provenance: "estimated" }}
          emptyTitle="No electrical loads recorded"
          emptyBody="List everything that draws current: controller, driver, each sensor, the radio, the logger. Without them there is no power budget and no endurance estimate."
          columns={[
            { key: "name", label: "Load", render: (r) => (<div><div className="font-medium">{String(r.name)}</div><div className="text-[11px] text-muted">{String(r.kind)}{r.part_number ? ` · ${String(r.part_number)}` : ""}</div></div>) },
            { key: "current_a", label: "Current", render: (r) => (r.current_a ? `${(Number(r.current_a) * 1000).toFixed(1)} mA` : <Badge tone="warning">missing</Badge>) },
            { key: "voltage_v", label: "Voltage", render: (r) => (r.voltage_v ? `${Number(r.voltage_v).toFixed(2)} V` : <Badge tone="warning">missing</Badge>) },
            { key: "duty_cycle", label: "Duty", render: (r) => `${(Number(r.duty_cycle ?? 1) * 100).toFixed(0)} %` },
            {
              key: "avg",
              label: "Average power",
              render: (r) => {
                const i = Number(r.current_a ?? NaN);
                const v = Number(r.voltage_v ?? NaN);
                const d = Number(r.duty_cycle ?? 1);
                const e = Number(r.regulator_efficiency ?? 1) || 1;
                const p = (i * v * d) / e;
                return Number.isFinite(p) ? `${(p * 1000).toFixed(1)} mW` : "—";
              },
            },
            { key: "provenance", label: "Provenance", render: (r) => <Badge tone={String(r.provenance) === "measured" ? "good" : String(r.provenance) === "datasheet" ? "accent" : "warning"}>{String(r.provenance)}</Badge> },
          ]}
        />
      )}

      {tab === "pins" && (
        <div className="space-y-4">
          <Card title="Wiring table">
            <p className="text-xs leading-relaxed text-muted">
              A pin table is worth writing before the loom exists and worth keeping accurate after. When a limit switch stops working at the
              poolside, the first question is which pin it is on and what colour the wire is.
            </p>
          </Card>
          <RecordEditor
            projectId={projectId}
            table="pin_assignments"
            rows={pins}
            fields={PIN_FIELDS}
            titleKey="signal"
            addLabel="Add pin"
            exportName="pin-assignments"
            searchKeys={["controller", "pin", "signal", "peripheral"]}
            newRecordDefaults={{ direction: "input" }}
            emptyTitle="No pin assignments recorded"
            emptyBody="Add the controller pins as you wire them: limit switches, motor driver, sensor bus, battery sense."
            columns={[
              { key: "controller", label: "Controller", width: "1%" },
              { key: "pin", label: "Pin", width: "1%", render: (r) => <span className="font-mono text-[11px]">{String(r.pin)}</span> },
              { key: "signal", label: "Signal", render: (r) => <span className="font-medium">{String(r.signal)}</span> },
              { key: "direction", label: "Direction", width: "1%" },
              { key: "peripheral", label: "Peripheral" },
              { key: "wire_color", label: "Wire", width: "1%" },
            ]}
          />
        </div>
      )}

      {tab === "control" && (
        <div className="space-y-4">
          <Card title="Control strategy" subtitle="Pick the simplest strategy that meets the requirement. Each step up in sophistication needs sensors you trust and dynamics you have measured.">
            <div className="grid gap-2 lg:grid-cols-2">
              {CONTROL_STRATEGIES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStrategy(s.id)}
                  aria-pressed={s.id === strategy}
                  className={`rounded border p-3 text-left transition ${s.id === strategy ? "border-[color:rgb(var(--accent))] bg-surface" : "hover:bg-surface"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{s.label}</span>
                    <Badge tone={s.complexity === "low" ? "good" : s.complexity === "high" ? "warning" : "neutral"}>{s.complexity} complexity</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted">{s.description}</p>
                </button>
              ))}
            </div>
          </Card>

          <Grid cols={2}>
            <Card title={`${selected.label} — what it needs`}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Required hardware</h4>
              <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs text-muted">
                {selected.requires.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Failure modes</h4>
              <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs text-muted">
                {selected.failureModes.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {selected.equations.length > 0 && (
                <>
                  <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Equations</h4>
                  <pre className="gf-scroll-x mt-1 rounded bg-surface p-2 font-mono text-[11px]">{selected.equations.join("\n")}</pre>
                </>
              )}
              {selected.tuningWarning && (
                <p className="mt-3 rounded border border-[#fab219] p-2 text-[11px] leading-snug text-muted">
                  <strong className="text-[#fab219]">Tuning: </strong>
                  {selected.tuningWarning}
                </p>
              )}
            </Card>

            <Card title="Pseudocode and embedded template">
              <label className="gf-label" htmlFor="platform">
                Confirm your hardware platform before generating code
              </label>
              <input
                id="platform"
                className="gf-input mt-1"
                placeholder="e.g. Arduino Nano + TB6612FNG + MS5837 depth sensor"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted">
                Templates are generated only after you state the platform, and they are structural skeletons — pin numbers, driver calls and
                sensor libraries are yours to fill in. Nothing here has been compiled or run.
              </p>
              {platform.trim().length > 3 ? (
                <pre className="gf-scroll-x mt-3 max-h-96 overflow-y-auto rounded border bg-surface p-2.5 font-mono text-[11px] leading-relaxed">
                  {buildPseudocode(selected, platform.trim(), syringe.config)}
                </pre>
              ) : (
                <div className="mt-3 rounded border border-dashed p-6 text-center text-xs text-muted">
                  Enter your hardware platform above to generate the template.
                </div>
              )}
            </Card>
          </Grid>
        </div>
      )}

      {tab === "checklist" && (
        <Grid cols={2}>
          <Card title="Pre-deployment checklist" subtitle="Work through it every time, not just the first time.">
            <ol className="space-y-2 text-xs">
              {PREDEPLOYMENT_CHECKLIST.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span className="gf-num shrink-0 font-bold text-muted">{i + 1}.</span>
                  <span>
                    <span className="font-medium">{item.step}</span>
                    <span className="block text-[11px] leading-snug text-muted">{item.why}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] text-muted">
              This is a starting checklist for a vehicle of this type. Add the items specific to your build, and delete the ones that do not
              apply — a checklist nobody believes gets skipped.
            </p>
          </Card>

          <Card title="Fault-response table" subtitle="Decide these on land, not in the water.">
            <div className="gf-scroll-x">
              <table className="gf-table">
                <thead>
                  <tr>
                    <th>Fault</th>
                    <th>Detection</th>
                    <th>Response</th>
                  </tr>
                </thead>
                <tbody>
                  {FAULT_RESPONSES.map((f, i) => (
                    <tr key={i}>
                      <td className="font-medium">{f.fault}</td>
                      <td className="text-[11px] text-muted">{f.detection}</td>
                      <td className="text-[11px] text-muted">{f.response}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 rounded border border-[#fab219] p-2 text-[11px] leading-snug text-muted">
              <strong className="text-[#fab219]">Safety: </strong>
              The single most valuable design choice for recovery is to trim the vehicle slightly POSITIVE when unpowered, so the default
              failure mode is floating. Everything in this table is secondary to that.
            </p>
          </Card>
        </Grid>
      )}
    </div>
  );
}

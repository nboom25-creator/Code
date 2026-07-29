"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../client";
import { Card, Grid, Tabs, UnitInput, NumberInput, SelectInput, TextInput, Checkbox, ErrorNotice, Spinner, Badge, WarningList, Field } from "../ui";
import type { ProjectSettings } from "@/lib/project/settings";
import { WATER_PRESETS, waterDensity, WATER_DENSITY_CORRELATION } from "@/lib/reference/water";
import { MATERIALS } from "@/lib/reference/materials";
import { ARCHITECTURES, type EngineConfig } from "@/lib/calc/syringe";
import { convert, formatQty } from "@/lib/units";

type Path = string;

function setDeep<T>(obj: T, path: Path, value: unknown): T {
  const keys = path.split(".");
  const clone = structuredClone(obj) as Record<string, unknown>;
  let cursor: Record<string, unknown> = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    cursor[keys[i]] = { ...(cursor[keys[i]] as Record<string, unknown>) };
    cursor = cursor[keys[i]] as Record<string, unknown>;
  }
  if (value === undefined) delete cursor[keys[keys.length - 1]];
  else cursor[keys[keys.length - 1]] = value;
  return clone as T;
}

export function SettingsEditor({ projectId, initial, isSample }: { projectId: string; initial: ProjectSettings; isSample: boolean }) {
  const router = useRouter();
  const [settings, setSettings] = React.useState<ProjectSettings>(initial);
  const [tab, setTab] = React.useState("environment");
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const dirty = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (path: Path, value: unknown) => {
    setSettings((s) => setDeep(s, path, value));
    dirty.current = true;
    setStatus("idle");
  };

  // Autosave: debounce so typing does not hammer the server, but never leave
  // an unsaved change sitting for more than a second.
  React.useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      setError(null);
      try {
        await api.saveSettings(projectId, settings);
        dirty.current = false;
        setStatus("saved");
        router.refresh();
      } catch (e) {
        setStatus("idle");
        setError(e instanceof ApiError ? e.message : String(e));
      }
    }, 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [settings, projectId, router]);

  const env = settings.environment;
  const water = env.densityOverrideSI
    ? { densitySI: env.densityOverrideSI, warnings: [], extrapolated: false }
    : waterDensity({ temperatureC: env.temperatureC, salinityPSU: env.salinityPSU });

  return (
    <div className="space-y-4">
      {error && <ErrorNotice title="Settings could not be saved" detail={error} onRetry={() => setError(null)} />}

      <div className="flex items-center justify-between">
        <Tabs
          tabs={[
            { id: "environment", label: "Environment" },
            { id: "mission", label: "Mission" },
            { id: "vehicle", label: "Vehicle" },
            { id: "hydro", label: "Hydrodynamics" },
            { id: "syringe", label: "Buoyancy engine" },
            { id: "structure", label: "Structure" },
            { id: "battery", label: "Battery" },
            { id: "project", label: "Project" },
          ]}
          active={tab}
          onChange={setTab}
        />
        <span className="ml-3 shrink-0 text-xs text-muted">
          {status === "saving" ? <Spinner label="Saving…" /> : status === "saved" ? "Saved" : dirty.current ? "Unsaved" : "Autosave on"}
        </span>
      </div>

      {isSample && (
        <p className="rounded border border-[#fab219] p-2 text-xs text-muted">
          You are editing the demonstration project. Changes here affect the demo only — create your own project before entering real design
          values.
        </p>
      )}

      {tab === "environment" && (
        <Grid cols={2}>
          <Card title="Water" subtitle="Shared by every buoyancy, drag and pressure calculation in this project.">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {WATER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className="gf-btn px-2 py-1 text-[11px]"
                  title={p.note}
                  onClick={() => {
                    setSettings((s) =>
                      setDeep(setDeep(setDeep(s, "environment.temperatureC", p.temperatureC), "environment.salinityPSU", p.salinityPSU), "environment.densityOverrideSI", undefined),
                    );
                    dirty.current = true;
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Grid cols={2}>
              <SelectInput
                label="Environment"
                value={env.kind}
                onChange={(v) => update("environment.kind", v)}
                options={[
                  { value: "pool", label: "Swimming pool" },
                  { value: "tank", label: "Laboratory tank" },
                  { value: "lake", label: "Lake" },
                  { value: "ocean", label: "Ocean / coastal" },
                  { value: "other", label: "Other" },
                ]}
              />
              <UnitInput
                label="Water temperature"
                dimension="temperature"
                defaultUnit="degC"
                valueSI={convert(env.temperatureC, "degC", "K")}
                onChangeSI={(v) => v !== undefined && update("environment.temperatureC", convert(v, "K", "degC"))}
                hint="Measure it on test day — it moves density by about 0.3 kg/m³ per °C near room temperature."
              />
              <NumberInput
                label="Practical salinity (PSU)"
                value={env.salinityPSU}
                onChange={(v) => update("environment.salinityPSU", v ?? 0)}
                min={0}
                max={45}
                hint="0 for fresh water; nominal open ocean is about 35."
              />
              <UnitInput
                label="Gravitational acceleration"
                dimension="acceleration"
                valueSI={env.gravitySI}
                onChangeSI={(v) => v !== undefined && update("environment.gravitySI", v)}
                hint="Standard gravity 9.80665 m/s² unless you have a reason to change it."
              />
              <UnitInput
                label="Surface pressure"
                dimension="pressure"
                defaultUnit="kPa"
                valueSI={env.surfacePressureSI}
                onChangeSI={(v) => v !== undefined && update("environment.surfacePressureSI", v)}
                hint="101.325 kPa at sea level. Reduce it if you are testing at altitude."
              />
            </Grid>

            <div className="mt-4 rounded border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Water density in use</span>
                <Badge tone={env.densityOverrideSI ? "accent" : "neutral"}>{env.densityOverrideSI ? "override" : "correlation"}</Badge>
              </div>
              <div className="gf-num mt-1 text-lg font-semibold">{formatQty({ value: water.densitySI, unit: "kg/m^3" }, 6)}</div>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                {env.densityOverrideSI ? (
                  env.densityOverrideSource || "User-entered override."
                ) : (
                  <>
                    {WATER_DENSITY_CORRELATION.name}. Valid {WATER_DENSITY_CORRELATION.validTemperatureC[0]}–
                    {WATER_DENSITY_CORRELATION.validTemperatureC[1]} °C, {WATER_DENSITY_CORRELATION.validSalinityPSU[0]}–
                    {WATER_DENSITY_CORRELATION.validSalinityPSU[1]} PSU, at 1 atm. {WATER_DENSITY_CORRELATION.citation}
                  </>
                )}
              </p>
              {"warnings" in water && <WarningList warnings={water.warnings} title="" />}
            </div>

            <details className="mt-3 rounded border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted">Advanced: override the density directly</summary>
              <div className="space-y-3 border-t p-3">
                <UnitInput
                  label="Measured water density"
                  dimension="density"
                  valueSI={env.densityOverrideSI}
                  onChangeSI={(v) => update("environment.densityOverrideSI", v)}
                  hint="Leave empty to use the correlation. Set it if you have measured the density of your actual test water, e.g. with a hydrometer."
                  placeholder="empty = use correlation"
                />
                <TextInput
                  label="Source of the override"
                  value={env.densityOverrideSource ?? ""}
                  onChange={(v) => update("environment.densityOverrideSource", v || undefined)}
                  placeholder="e.g. Hydrometer reading, pool, 2026-03-14"
                  hint="Recorded on every report that uses this density."
                />
              </div>
            </details>
          </Card>

          <Card title="Material reference library" subtitle="Bundled starter values. Unverified — replace with supplier datasheets before any structural conclusion.">
            <div className="gf-scroll-x max-h-96 overflow-y-auto">
              <table className="gf-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Density</th>
                    <th>Yield / tensile</th>
                    <th>E</th>
                    <th>Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {MATERIALS.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <span className="font-medium">{m.name}</span>
                        <span className="block text-[10px] text-muted">{m.category}</span>
                      </td>
                      <td>
                        {m.density.value} {m.density.unit}
                        {m.density.range && <span className="block text-[10px] text-muted">range {m.density.range[0]}–{m.density.range[1]}</span>}
                      </td>
                      <td className="text-[11px]">
                        {m.yieldStrength ? `${m.yieldStrength.value} ${m.yieldStrength.unit} yield` : "—"}
                        {m.tensileStrength && <span className="block">{m.tensileStrength.value} {m.tensileStrength.unit} tensile</span>}
                      </td>
                      <td>{m.youngsModulus ? `${m.youngsModulus.value} ${m.youngsModulus.unit}` : "—"}</td>
                      <td>
                        <Badge tone="warning">no</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-snug text-muted">
              Every entry is a nominal handbook figure quoted at low precision on purpose. None is traceable to a lot, grade or supplier. You
              can select a material on a component and then override its density there for your project without changing this library.
            </p>
          </Card>
        </Grid>
      )}

      {tab === "mission" && (
        <Card title="Mission profile" subtitle="Feeds the mission simulator, the pressure case for the buoyancy engine, and the depth used for structural checks.">
          <Grid cols={3}>
            <UnitInput label="Target depth" dimension="length" valueSI={settings.mission.targetDepthSI} onChangeSI={(v) => update("mission.targetDepthSI", v ?? 0)} hint="Depth the vehicle aims for on each dive. Also the pressure case for the buoyancy engine." />
            <UnitInput label="Depth limit (fault trip)" dimension="length" valueSI={settings.mission.depthLimitSI} onChangeSI={(v) => update("mission.depthLimitSI", v ?? 0)} hint="The simulator declares a fault beyond this. Set it to the shallowest of: tank depth, housing rating, and what you can reach to recover." />
            <UnitInput label="Surface threshold" dimension="length" valueSI={settings.mission.surfaceThresholdSI} onChangeSI={(v) => update("mission.surfaceThresholdSI", v ?? 0)} hint="Depth at or above which the vehicle counts as surfaced." />
            <NumberInput label="Dive-and-climb cycles" value={settings.mission.cycles} onChange={(v) => update("mission.cycles", v ?? 1)} min={1} max={500} />
            <UnitInput label="Bottom dwell" dimension="time" valueSI={settings.mission.bottomDwellSI} onChangeSI={(v) => update("mission.bottomDwellSI", v ?? 0)} />
            <UnitInput label="Surface dwell" dimension="time" valueSI={settings.mission.surfaceDwellSI} onChangeSI={(v) => update("mission.surfaceDwellSI", v ?? 0)} />
            <UnitInput label="Leak check duration" dimension="time" valueSI={settings.mission.leakCheckTimeSI} onChangeSI={(v) => update("mission.leakCheckTimeSI", v ?? 0)} hint="Surface dwell before the first dive, reading the leak sensor." />
            <UnitInput label="Initialisation time" dimension="time" valueSI={settings.mission.initializationTimeSI} onChangeSI={(v) => update("mission.initializationTimeSI", v ?? 0)} />
            <UnitInput label="Telemetry burst" dimension="time" valueSI={settings.mission.transmitTimeSI} onChangeSI={(v) => update("mission.transmitTimeSI", v ?? 0)} />
          </Grid>
          <details className="mt-4 rounded border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted">Advanced simulation settings</summary>
            <div className="border-t p-3">
              <Grid cols={3}>
                <UnitInput label="Ambient current" dimension="velocity" valueSI={settings.mission.currentVelocitySI} onChangeSI={(v) => update("mission.currentVelocitySI", v ?? 0)} hint="Positive along +x (forward). Adds directly to horizontal speed." />
                <UnitInput label="Velocity time constant" dimension="time" valueSI={settings.mission.velocityTimeConstantSI} onChangeSI={(v) => update("mission.velocityTimeConstantSI", v ?? 0)} hint="0 applies the equilibrium glide speed instantly. A few seconds is realistic for a small vehicle whose added mass is comparable to its own — set it to see how much the transient matters." />
                <UnitInput label="Simulation time step" dimension="time" defaultUnit="s" valueSI={settings.mission.dtSI} onChangeSI={(v) => update("mission.dtSI", v ?? 0.2)} hint="Smaller is more accurate and slower." />
                <UnitInput label="Simulation time limit" dimension="time" defaultUnit="min" valueSI={settings.mission.maxTimeSI} onChangeSI={(v) => update("mission.maxTimeSI", v ?? 3600)} />
              </Grid>
            </div>
          </details>
        </Card>
      )}

      {tab === "vehicle" && (
        <Card title="Vehicle geometry" subtitle="Used by the drag buildup and compared against the envelope requirements.">
          <Grid cols={3}>
            <UnitInput label="Hull length" dimension="length" defaultUnit="mm" valueSI={settings.vehicle.hullLengthSI} onChangeSI={(v) => update("vehicle.hullLengthSI", v ?? 0.6)} hint="Overall length — the characteristic length for the Reynolds number." />
            <UnitInput label="Hull maximum diameter" dimension="length" defaultUnit="mm" valueSI={settings.vehicle.hullDiameterSI} onChangeSI={(v) => update("vehicle.hullDiameterSI", v ?? 0.09)} />
            <UnitInput label="Hull wetted area (optional)" dimension="area" defaultUnit="cm^2" valueSI={settings.vehicle.hullWettedAreaSI} onChangeSI={(v) => update("vehicle.hullWettedAreaSI", v)} hint="From CAD if you have it. Left empty, the app estimates a capsule and says so." placeholder="empty = estimate" />
            <UnitInput label="Wing planform area (both wings)" dimension="area" defaultUnit="cm^2" valueSI={settings.vehicle.wingAreaSI} onChangeSI={(v) => update("vehicle.wingAreaSI", v ?? 0)} />
            <NumberInput label="Wing aspect ratio" value={settings.vehicle.wingAspectRatio} onChange={(v) => update("vehicle.wingAspectRatio", v ?? 0)} min={0} hint="span² / area. Below about 2–3 the lifting-line relations lose accuracy." />
            <NumberInput label="Wing thickness / chord" value={settings.vehicle.wingThicknessRatio} onChange={(v) => update("vehicle.wingThicknessRatio", v ?? 0.12)} min={0} max={0.5} hint="0.12 is a common thin symmetric section." />
            <UnitInput label="Tail / fin planform area" dimension="area" defaultUnit="cm^2" valueSI={settings.vehicle.tailAreaSI} onChangeSI={(v) => update("vehicle.tailAreaSI", v ?? 0)} />
            <NumberInput label="Oswald span efficiency" value={settings.vehicle.oswaldEfficiency} onChange={(v) => update("vehicle.oswaldEfficiency", v ?? 0.8)} min={0.1} max={1} hint="0.8 is a common estimate for a simple rectangular planform. It is an estimate, not a measurement." />
            <UnitInput label="Appendage / roughness drag area" dimension="area" defaultUnit="cm^2" valueSI={settings.vehicle.appendageDragAreaSI} onChangeSI={(v) => update("vehicle.appendageDragAreaSI", v ?? 0)} hint="C_D × A allowance for brackets, screw heads, tape seams and a wet antenna. On a student-built vehicle this is commonly 10–40% of total drag; zero here means the prediction will be optimistic." />
          </Grid>
          <details className="mt-4 rounded border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted">Envelope limits (checked against requirements)</summary>
            <div className="border-t p-3">
              <Grid cols={3}>
                <UnitInput label="Maximum allowed length" dimension="length" defaultUnit="mm" valueSI={settings.vehicle.maxLengthSI} onChangeSI={(v) => update("vehicle.maxLengthSI", v)} />
                <UnitInput label="Maximum allowed diameter" dimension="length" defaultUnit="mm" valueSI={settings.vehicle.maxDiameterSI} onChangeSI={(v) => update("vehicle.maxDiameterSI", v)} />
                <UnitInput label="Maximum allowed mass" dimension="mass" valueSI={settings.vehicle.maxMassSI} onChangeSI={(v) => update("vehicle.maxMassSI", v)} />
              </Grid>
            </div>
          </details>
        </Card>
      )}

      {tab === "hydro" && (
        <Card title="Hydrodynamic coefficients" subtitle="Every speed, glide-ratio, range and endurance figure in this project follows from these two numbers.">
          <Grid cols={2}>
            <SelectInput
              label="Modelling level"
              value={settings.hydro.modelLevel}
              onChange={(v) => update("hydro.modelLevel", v)}
              options={[
                { value: "coefficient", label: "1 — Simple coefficient estimate" },
                { value: "buildup", label: "2 — Component buildup" },
                { value: "experimental", label: "3 — Coefficients measured in a test" },
                { value: "calibrated", label: "4 — Buildup calibrated against test data" },
              ]}
            />
            <SelectInput
              label="Coefficient source"
              value={settings.hydro.coefficientSource}
              onChange={(v) => update("hydro.coefficientSource", v)}
              options={[
                { value: "assumed", label: "Assumed placeholder (not measured)" },
                { value: "buildup", label: "From the component buildup" },
                { value: "user", label: "User-entered from a reference" },
                { value: "experimental", label: "Measured in a test" },
              ]}
              hint="This tag propagates to every report. Do not set it to 'measured' until a test run backs it."
            />
            <NumberInput label="Lift coefficient C_L" value={settings.hydro.liftCoefficient} onChange={(v) => update("hydro.liftCoefficient", v ?? 0)} hint="Referenced to the area below." />
            <NumberInput label="Drag coefficient C_D" value={settings.hydro.dragCoefficient} onChange={(v) => update("hydro.dragCoefficient", v ?? 0.1)} min={0.0001} hint="Referenced to the same area. Glide ratio is C_L / C_D." />
            <UnitInput label="Reference area" dimension="area" defaultUnit="cm^2" valueSI={settings.hydro.referenceAreaSI} onChangeSI={(v) => update("hydro.referenceAreaSI", v ?? 0.012)} hint="Coefficients are meaningless without the area they are referenced to." />
            <TextInput label="Reference area basis" value={settings.hydro.referenceAreaBasis} onChange={(v) => update("hydro.referenceAreaBasis", v)} hint="e.g. 'Total wing planform area, both panels'." />
            <NumberInput label="Calibration factor" value={settings.hydro.calibrationFactor} onChange={(v) => update("hydro.calibrationFactor", v ?? 1)} min={0.01} hint="Multiplies the whole drag buildup. 1 = uncalibrated. Fitted from test data on the Tests page; the uncalibrated prediction is always kept for comparison." />
            <NumberInput label="Angle of attack (deg)" value={settings.hydro.angleOfAttackDeg} onChange={(v) => update("hydro.angleOfAttackDeg", v ?? 6)} hint="Recorded for reference. This app does not solve the pitch-moment balance, so angle of attack is an input, not a result." />
          </Grid>
          <div className="mt-3">
            <TextInput label="Note on the coefficients" value={settings.hydro.coefficientNote} onChange={(v) => update("hydro.coefficientNote", v)} multiline rows={3} hint="Reproduced on every report that quotes a performance figure." />
          </div>
        </Card>
      )}

      {tab === "syringe" && (
        <SyringeSettings settings={settings} update={update} />
      )}

      {tab === "structure" && (
        <Card title="Pressure housing" subtitle="Feeds the preliminary structural checks. These are closed-form checks, not finite-element analysis.">
          <Grid cols={3}>
            <UnitInput label="Housing outer diameter" dimension="length" defaultUnit="mm" valueSI={settings.structure.housingOuterDiameterSI} onChangeSI={(v) => update("structure.housingOuterDiameterSI", v)} />
            <UnitInput label="Wall thickness" dimension="length" defaultUnit="mm" valueSI={settings.structure.housingWallThicknessSI} onChangeSI={(v) => update("structure.housingWallThicknessSI", v)} />
            <UnitInput label="Unsupported length" dimension="length" defaultUnit="mm" valueSI={settings.structure.housingLengthSI} onChangeSI={(v) => update("structure.housingLengthSI", v)} hint="Between end caps or stiffening rings — shorter spans buckle at much higher pressure." />
          </Grid>
          <div className="mt-4">
            <Field label="Material" hint="Selecting a library material fills the properties below with UNVERIFIED reference values. Replace them with datasheet numbers before drawing a pass/fail conclusion.">
              <select
                className="gf-input"
                value={settings.structure.materialId ?? ""}
                onChange={(e) => {
                  const m = MATERIALS.find((x) => x.id === e.target.value);
                  if (!m) {
                    update("structure.materialId", undefined);
                    return;
                  }
                  setSettings((s) => {
                    let next = setDeep(s, "structure.materialId", m.id);
                    if (m.youngsModulus) next = setDeep(next, "structure.youngsModulusSI", m.youngsModulus.value * 1e9);
                    if (m.poissonsRatio) next = setDeep(next, "structure.poissonsRatio", m.poissonsRatio.value);
                    const strength = m.yieldStrength ?? m.tensileStrength;
                    if (strength) next = setDeep(next, "structure.yieldStrengthSI", strength.value * 1e6);
                    next = setDeep(next, "structure.materialProvenance", "reference");
                    return next;
                  });
                  dirty.current = true;
                }}
              >
                <option value="">(none selected)</option>
                {MATERIALS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Grid cols={3}>
            <UnitInput label="Young's modulus" dimension="pressure" defaultUnit="MPa" valueSI={settings.structure.youngsModulusSI} onChangeSI={(v) => update("structure.youngsModulusSI", v)} />
            <NumberInput label="Poisson's ratio" value={settings.structure.poissonsRatio} onChange={(v) => update("structure.poissonsRatio", v)} min={0} max={0.5} />
            <UnitInput label="Yield / allowable stress" dimension="pressure" defaultUnit="MPa" valueSI={settings.structure.yieldStrengthSI} onChangeSI={(v) => update("structure.yieldStrengthSI", v)} />
            <SelectInput
              label="Material property provenance"
              value={settings.structure.materialProvenance}
              onChange={(v) => update("structure.materialProvenance", v)}
              options={[
                { value: "assumed", label: "Assumed" },
                { value: "reference", label: "Unverified library reference" },
                { value: "user", label: "From the supplier datasheet" },
              ]}
              hint="A structural pass/fail must not rest on unverified values."
            />
            <NumberInput label="Required factor of safety" value={settings.structure.safetyFactor} onChange={(v) => update("structure.safetyFactor", v ?? 2)} min={1} />
          </Grid>
        </Card>
      )}

      {tab === "battery" && (
        <Card title="Battery" subtitle="Sets the energy available to the power budget and mission simulation.">
          <Grid cols={3}>
            <UnitInput label="Nameplate capacity" dimension="charge" defaultUnit="mAh" valueSI={settings.battery.capacitySI} onChangeSI={(v) => update("battery.capacitySI", v ?? 0)} />
            <UnitInput label="Nominal voltage" dimension="voltage" valueSI={settings.battery.nominalVoltageSI} onChangeSI={(v) => update("battery.nominalVoltageSI", v ?? 11.1)} />
            <TextInput label="Chemistry / description" value={settings.battery.chemistry} onChange={(v) => update("battery.chemistry", v)} />
            <NumberInput label="Usable fraction (depth of discharge)" value={settings.battery.usableFraction} onChange={(v) => update("battery.usableFraction", v ?? 0.8)} min={0.05} max={1} hint="0.8 is a common limit for lithium cells. 1.0 is not achievable in practice." />
            <NumberInput label="Derating factor" value={settings.battery.deratingFactor} onChange={(v) => update("battery.deratingFactor", v ?? 0.9)} min={0.1} max={1} hint="Temperature, age and high-rate discharge. Below 1." />
            <SelectInput
              label="Capacity provenance"
              value={settings.battery.provenance}
              onChange={(v) => update("battery.provenance", v)}
              options={[
                { value: "estimated", label: "Estimated" },
                { value: "datasheet", label: "From the datasheet" },
                { value: "measured", label: "Measured in a discharge test" },
              ]}
              hint="Nameplate capacity on inexpensive cells is frequently optimistic. A discharge test at your real load is the only reliable number."
            />
          </Grid>
        </Card>
      )}

      {tab === "project" && (
        <Card title="Project information" subtitle="Appears on generated reports.">
          <Grid cols={2}>
            <TextInput label="Revision" value={settings.project.revision} onChange={(v) => update("project.revision", v)} hint="Bump this when you issue a new report set." />
            <NumberInput label="Budget (USD)" value={settings.project.budgetUSD} onChange={(v) => update("project.budgetUSD", v)} min={0} hint="Compared against the bill of materials." />
            <TextInput label="Advisor" value={settings.project.advisorName ?? ""} onChange={(v) => update("project.advisorName", v || undefined)} />
            <TextInput label="Course" value={settings.project.courseName ?? ""} onChange={(v) => update("project.courseName", v || undefined)} />
          </Grid>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Available manufacturing methods"
              value={settings.project.manufacturingMethods.join("\n")}
              onChange={(v) => update("project.manufacturingMethods", v.split("\n").map((s) => s.trim()).filter(Boolean))}
              multiline
              rows={5}
              hint="One per line. The assistant and the fabrication guidance use this to keep suggestions buildable."
            />
            <TextInput
              label="Available tools and laboratory equipment"
              value={settings.project.availableEquipment.join("\n")}
              onChange={(v) => update("project.availableEquipment", v.split("\n").map((s) => s.trim()).filter(Boolean))}
              multiline
              rows={5}
              hint="One per line. A test plan that needs equipment you do not have is not a plan."
            />
          </div>
        </Card>
      )}

      <Card title="Data and units">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput
            label="Preferred display unit system"
            value={settings.displayUnitSystem}
            onChange={(v) => update("displayUnitSystem", v)}
            options={[
              { value: "SI", label: "SI (metric)" },
              { value: "US", label: "US customary where available" },
            ]}
            hint="All storage and calculation is in SI base units regardless. This only sets which unit a fresh input field offers first."
          />
          <div className="flex items-end">
            <a className="gf-btn w-full" href={`/api/projects/${projectId}/export`} download>
              Export this project as JSON
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SyringeSettings({ settings, update }: { settings: ProjectSettings; update: (path: string, value: unknown) => void }) {
  const s = settings.syringe;
  const arch = ARCHITECTURES[s.config];
  return (
    <div className="space-y-4">
      <Card title="Buoyancy engine architecture" subtitle="These arrangements are NOT physically equivalent. The choice sets the sign of the buoyancy change, whether vehicle mass changes, and which stroke direction fights ambient pressure.">
        <div className="grid gap-2 lg:grid-cols-2">
          {(Object.keys(ARCHITECTURES) as EngineConfig[]).map((key) => {
            const a = ARCHITECTURES[key];
            const selected = key === s.config;
            return (
              <button
                key={key}
                onClick={() => update("syringe.config", key)}
                aria-pressed={selected}
                className={`rounded border p-3 text-left transition ${selected ? "border-[color:rgb(var(--accent))] bg-surface" : "hover:bg-surface"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{a.label}</span>
                  {selected && <Badge tone="accent">selected</Badge>}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted">{a.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge tone={a.changesMass ? "warning" : "neutral"}>{a.changesMass ? "changes mass" : "mass constant"}</Badge>
                  <Badge tone={a.changesDisplacedVolume ? "accent" : "neutral"}>
                    {a.changesDisplacedVolume ? "changes displacement" : "displacement constant"}
                  </Badge>
                  <Badge tone="neutral">{a.pressureOpposedStroke} stroke fights pressure</Badge>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-3 rounded border p-3">
          <h3 className="text-xs font-semibold">What this choice means for {arch.label}</h3>
          <ul className="ml-4 mt-1.5 list-disc space-y-1 text-[11px] leading-snug text-muted">
            {arch.schematicNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
        {s.config === "combined" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <NumberInput
              label="Fraction of swept volume that changes displaced volume"
              value={s.combinedVolumeFraction ?? 1}
              onChange={(v) => update("syringe.combinedVolumeFraction", v ?? 1)}
              min={0}
              max={1}
            />
            <NumberInput
              label="Fraction of swept volume that changes vehicle mass"
              value={s.combinedMassFraction ?? 0}
              onChange={(v) => update("syringe.combinedMassFraction", v ?? 0)}
              min={0}
              max={1}
              hint="If these two are equal the effects cancel exactly and the engine has no authority."
            />
          </div>
        )}
      </Card>

      <Card title="Syringe geometry">
        <Grid cols={3}>
          <UnitInput label="Bore internal diameter" dimension="length" defaultUnit="mm" valueSI={s.boreDiameterSI} onChangeSI={(v) => update("syringe.boreDiameterSI", v ?? 0.02)} hint="Swept volume and pressure force BOTH scale with the square of this." />
          <UnitInput label="Plunger diameter (optional)" dimension="length" defaultUnit="mm" valueSI={s.plungerDiameterSI} onChangeSI={(v) => update("syringe.plungerDiameterSI", v)} placeholder="empty = same as bore" />
          <NumberInput label="Syringes in parallel" value={s.syringeCount} onChange={(v) => update("syringe.syringeCount", v ?? 1)} min={1} />
          <UnitInput label="Mechanical maximum stroke" dimension="length" defaultUnit="mm" valueSI={s.maxStrokeSI} onChangeSI={(v) => update("syringe.maxStrokeSI", v ?? 0)} />
          <UnitInput label="Usable stroke (between limit switches)" dimension="length" defaultUnit="mm" valueSI={s.usableStrokeSI} onChangeSI={(v) => update("syringe.usableStrokeSI", v ?? 0)} hint="What the engine actually uses. Must not exceed the mechanical stroke." />
          <UnitInput label="Dead volume" dimension="volume" defaultUnit="cm^3" valueSI={s.deadVolumeSI} onChangeSI={(v) => update("syringe.deadVolumeSI", v ?? 0)} hint="Volume that never participates. If it contains air it also compresses with depth." />
        </Grid>
      </Card>

      <Card title="Loads and drivetrain">
        <Grid cols={3}>
          <UnitInput label="Plunger + seal friction" dimension="force" valueSI={s.frictionForceSI} onChangeSI={(v) => update("syringe.frictionForceSI", v)} placeholder="empty = taken as 0 N" hint="MEASURE THIS. Left empty it is taken as zero, and at shallow depth friction can exceed the hydrostatic load entirely." provenance={s.frictionForceSI === undefined ? "unknown" : "measured"} />
          <NumberInput label="Mechanism efficiency" value={s.mechanismEfficiency} onChange={(v) => update("syringe.mechanismEfficiency", v ?? 0.9)} min={0.01} max={1} hint="Couplings, bearings and guides, excluding the screw itself." />
          <NumberInput label="Design safety factor" value={s.safetyFactor} onChange={(v) => update("syringe.safetyFactor", v ?? 2)} min={1} hint="Applied to the required actuator force before sizing the motor." />
          <UnitInput label="Lead screw lead (travel per revolution)" dimension="length" defaultUnit="mm" valueSI={s.leadSI} onChangeSI={(v) => update("syringe.leadSI", v)} placeholder="required for torque" hint="Not the pitch, unless the screw is single-start." />
          <NumberInput label="Lead screw efficiency" value={s.screwEfficiency} onChange={(v) => update("syringe.screwEfficiency", v)} min={0.01} max={1} hint="Empty assumes 0.30. Sliding screws run 0.2–0.4, ball screws 0.85–0.95 — a factor of three in required torque." />
          <NumberInput label="Gear reduction (motor rev per screw rev)" value={s.gearRatio} onChange={(v) => update("syringe.gearRatio", v ?? 1)} min={0.01} />
          <NumberInput label="Gearbox efficiency" value={s.gearEfficiency} onChange={(v) => update("syringe.gearEfficiency", v ?? 0.9)} min={0.01} max={1} />
          <UnitInput label="Motor available torque" dimension="torque" defaultUnit="mN*m" valueSI={s.motorTorqueSI} onChangeSI={(v) => update("syringe.motorTorqueSI", v)} placeholder="required for stall margin" hint="At the shaft the gear ratio above refers to." />
          <UnitInput label="Motor speed at that operating point" dimension="angularVelocity" defaultUnit="rpm" valueSI={s.motorSpeedSI} onChangeSI={(v) => update("syringe.motorSpeedSI", v)} placeholder="required for timing" />
          <UnitInput label="Motor current" dimension="current" defaultUnit="A" valueSI={s.motorCurrentSI} onChangeSI={(v) => update("syringe.motorCurrentSI", v)} />
          <UnitInput label="Supply voltage" dimension="voltage" valueSI={s.supplyVoltageSI} onChangeSI={(v) => update("syringe.supplyVoltageSI", v)} />
          <UnitInput label="Target buoyancy change (optional)" dimension="force" valueSI={s.targetBuoyancyForceSI} onChangeSI={(v) => update("syringe.targetBuoyancyForceSI", v)} hint="The app back-solves the stroke needed to deliver this." />
        </Grid>
      </Card>
    </div>
  );
}

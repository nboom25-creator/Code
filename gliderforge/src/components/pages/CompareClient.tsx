"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api, jsonField, downloadText, toCsv, type Row } from "../client";
import { Card, Grid, Badge, UnitInput, NumberInput, TextInput, SelectInput, Spinner, ErrorNotice, EmptyState } from "../ui";
import { BarPlot } from "../Charts";
import { computeSyringeEngine, ARCHITECTURES, type EngineConfig } from "@/lib/calc/syringe";
import { glideEquilibrium } from "@/lib/calc/hydro";
import { formatQty } from "@/lib/units";

interface VariantConfig {
  syringe: {
    config: EngineConfig;
    boreDiameterSI: number;
    maxStrokeSI: number;
    usableStrokeSI: number;
    syringeCount: number;
  };
  hydro: { liftCoefficient: number; dragCoefficient: number };
}

interface Context {
  waterDensitySI: number;
  gravitySI: number;
  depthSI: number;
  surfacePressureSI: number;
  vehicleWeightN: number;
  referenceAreaSI: number;
  coefficientSource: string;
  current: {
    config: EngineConfig;
    boreDiameterSI: number;
    maxStrokeSI: number;
    usableStrokeSI: number;
    syringeCount: number;
    frictionForceSI?: number;
    mechanismEfficiency: number;
    leadSI?: number;
    screwEfficiency?: number;
    gearRatio: number;
    gearEfficiency: number;
    motorTorqueSI?: number;
    motorSpeedSI?: number;
    motorCurrentSI?: number;
    supplyVoltageSI?: number;
    safetyFactor: number;
    liftCoefficient: number;
    dragCoefficient: number;
  };
}

const num = (v: number | undefined, unit: string, d = 4) => (v === undefined || !Number.isFinite(v) ? "—" : formatQty({ value: v, unit }, d));

export function CompareClient({ projectId, variants, context }: { projectId: string; variants: Row[]; context: Context }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(variants.slice(0, 3).map((v) => String(v.id))));
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{ name: string; description: string; config: VariantConfig }>({
    name: "New configuration",
    description: "",
    config: {
      syringe: {
        config: context.current.config,
        boreDiameterSI: context.current.boreDiameterSI,
        maxStrokeSI: context.current.maxStrokeSI,
        usableStrokeSI: context.current.usableStrokeSI,
        syringeCount: context.current.syringeCount,
      },
      hydro: { liftCoefficient: context.current.liftCoefficient, dragCoefficient: context.current.dragCoefficient },
    },
  });

  const evaluate = React.useCallback(
    (cfg: VariantConfig) => {
      const engine = computeSyringeEngine({
        config: cfg.syringe.config,
        boreDiameterSI: cfg.syringe.boreDiameterSI,
        maxStrokeSI: cfg.syringe.maxStrokeSI,
        usableStrokeSI: cfg.syringe.usableStrokeSI,
        syringeCount: cfg.syringe.syringeCount,
        waterDensitySI: context.waterDensitySI,
        gravitySI: context.gravitySI,
        depthSI: context.depthSI,
        surfacePressureSI: context.surfacePressureSI,
        frictionForceSI: context.current.frictionForceSI,
        mechanismEfficiency: context.current.mechanismEfficiency,
        leadSI: context.current.leadSI,
        screwEfficiency: context.current.screwEfficiency,
        gearRatio: context.current.gearRatio,
        gearEfficiency: context.current.gearEfficiency,
        motorTorqueSI: context.current.motorTorqueSI,
        motorSpeedSI: context.current.motorSpeedSI,
        motorCurrentSI: context.current.motorCurrentSI,
        supplyVoltageSI: context.current.supplyVoltageSI,
        safetyFactor: context.current.safetyFactor,
      });
      const authority = engine.values.buoyancyForceChange.value / 2;
      const glide = glideEquilibrium({
        netBuoyancyForceSI: authority,
        densitySI: context.waterDensitySI,
        referenceAreaSI: context.referenceAreaSI,
        liftCoefficient: cfg.hydro.liftCoefficient,
        dragCoefficient: cfg.hydro.dragCoefficient,
        descending: true,
        coefficientSource: context.coefficientSource as "user" | "buildup" | "experimental" | "assumed",
      });
      return { engine, glide, authority };
    },
    [context],
  );

  const rows = React.useMemo(() => {
    const list: { id: string; name: string; description: string; cfg: VariantConfig }[] = [
      {
        id: "__current__",
        name: "Current project settings",
        description: "The configuration actually saved on this project.",
        cfg: {
          syringe: {
            config: context.current.config,
            boreDiameterSI: context.current.boreDiameterSI,
            maxStrokeSI: context.current.maxStrokeSI,
            usableStrokeSI: context.current.usableStrokeSI,
            syringeCount: context.current.syringeCount,
          },
          hydro: { liftCoefficient: context.current.liftCoefficient, dragCoefficient: context.current.dragCoefficient },
        },
      },
      ...variants
        .filter((v) => selected.has(String(v.id)))
        .map((v) => {
          const cfg = jsonField<VariantConfig>(v.config_json, {
            syringe: { config: "external-plunger", boreDiameterSI: 0.02, maxStrokeSI: 0.05, usableStrokeSI: 0.05, syringeCount: 1 },
            hydro: { liftCoefficient: 0.35, dragCoefficient: 0.12 },
          });
          return { id: String(v.id), name: String(v.name), description: String(v.description ?? ""), cfg };
        }),
    ];
    return list.map((item) => ({ ...item, result: evaluate(item.cfg) }));
  }, [variants, selected, context, evaluate]);

  const chart = rows.map((r) => ({
    name: r.name.length > 26 ? `${r.name.slice(0, 25)}…` : r.name,
    buoyancy_authority_N: Number(r.result.engine.values.buoyancyForceChange.value.toFixed(4)),
  }));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { row } = await api.create(projectId, "design_variants", {
        name: draft.name,
        description: draft.description,
        config_json: JSON.stringify(draft.config),
      });
      setSelected((s) => new Set([...s, String(row.id)]));
      setCreating(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    downloadText(
      "design-comparison.csv",
      toCsv(
        rows.map((r) => ({
          configuration: r.name,
          architecture: r.cfg.syringe.config,
          bore_mm: r.cfg.syringe.boreDiameterSI * 1000,
          usable_stroke_mm: r.cfg.syringe.usableStrokeSI * 1000,
          syringes: r.cfg.syringe.syringeCount,
          swept_volume_cm3: r.result.engine.values.usableVolumeChange.value * 1e6,
          buoyancy_authority_N: r.result.engine.values.buoyancyForceChange.value,
          authority_percent_of_weight: context.vehicleWeightN > 0 ? (r.result.engine.values.buoyancyForceChange.value / context.vehicleWeightN) * 100 : "",
          design_force_N: r.result.engine.values.designActuatorForce.value,
          motor_torque_mNm: r.result.engine.values.requiredMotorTorque ? r.result.engine.values.requiredMotorTorque.value * 1000 : "",
          stall_margin: r.result.engine.values.stallMargin?.value ?? "",
          actuation_time_s: r.result.engine.values.actuationTime?.value ?? "",
          energy_per_stroke_J: r.result.engine.values.electricalEnergyPerStroke?.value ?? "",
          max_feasible_depth_m: r.result.engine.values.maxFeasibleDepth?.value ?? "",
          dive_speed_m_s: r.result.glide.values.speed.value,
          glide_ratio: r.result.glide.values.glideRatio.value,
          errors: r.result.engine.warnings.filter((w) => w.severity === "error").length,
        })),
      ),
      "text/csv",
    );
  };

  return (
    <div className="space-y-4">
      {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}

      <Card
        title="Configurations to compare"
        actions={
          <>
            <button className="gf-btn" onClick={exportCsv}>
              Export CSV
            </button>
            <button className="gf-btn gf-btn-primary" onClick={() => setCreating((c) => !c)}>
              {creating ? "Cancel" : "New configuration"}
            </button>
          </>
        }
      >
        {variants.length === 0 && !creating ? (
          <EmptyState
            title="Only the current settings to compare"
            body="Create a candidate configuration to see it side by side with what the project currently uses. Held constant across all candidates: the vehicle, the water, the operating depth, the friction and the drivetrain — so any difference is attributable to what you varied."
            action={
              <button className="gf-btn gf-btn-primary" onClick={() => setCreating(true)}>
                Create a candidate
              </button>
            }
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {variants.map((v) => {
              const on = selected.has(String(v.id));
              return (
                <button
                  key={String(v.id)}
                  className={`gf-btn px-2 py-1 text-[11px] ${on ? "gf-btn-primary" : ""}`}
                  aria-pressed={on}
                  onClick={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (n.has(String(v.id))) n.delete(String(v.id));
                      else n.add(String(v.id));
                      return n;
                    })
                  }
                >
                  {String(v.name)}
                </button>
              );
            })}
          </div>
        )}

        {creating && (
          <div className="mt-4 space-y-3 rounded border p-3">
            <Grid cols={2}>
              <TextInput label="Name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} required />
              <TextInput label="Description" value={draft.description} onChange={(v) => setDraft((d) => ({ ...d, description: v }))} />
            </Grid>
            <Grid cols={3}>
              <SelectInput
                label="Engine architecture"
                value={draft.config.syringe.config}
                onChange={(v) => setDraft((d) => ({ ...d, config: { ...d.config, syringe: { ...d.config.syringe, config: v as EngineConfig } } }))}
                options={(Object.keys(ARCHITECTURES) as EngineConfig[]).map((k) => ({ value: k, label: ARCHITECTURES[k].label }))}
              />
              <UnitInput
                label="Bore diameter"
                dimension="length"
                defaultUnit="mm"
                valueSI={draft.config.syringe.boreDiameterSI}
                onChangeSI={(v) => setDraft((d) => ({ ...d, config: { ...d.config, syringe: { ...d.config.syringe, boreDiameterSI: v ?? 0.02 } } }))}
              />
              <NumberInput
                label="Syringes in parallel"
                value={draft.config.syringe.syringeCount}
                onChange={(v) => setDraft((d) => ({ ...d, config: { ...d.config, syringe: { ...d.config.syringe, syringeCount: v ?? 1 } } }))}
                min={1}
              />
              <UnitInput
                label="Mechanical stroke"
                dimension="length"
                defaultUnit="mm"
                valueSI={draft.config.syringe.maxStrokeSI}
                onChangeSI={(v) => setDraft((d) => ({ ...d, config: { ...d.config, syringe: { ...d.config.syringe, maxStrokeSI: v ?? 0.05 } } }))}
              />
              <UnitInput
                label="Usable stroke"
                dimension="length"
                defaultUnit="mm"
                valueSI={draft.config.syringe.usableStrokeSI}
                onChangeSI={(v) => setDraft((d) => ({ ...d, config: { ...d.config, syringe: { ...d.config.syringe, usableStrokeSI: v ?? 0.05 } } }))}
              />
              <NumberInput
                label="Drag coefficient C_D"
                value={draft.config.hydro.dragCoefficient}
                onChange={(v) => setDraft((d) => ({ ...d, config: { ...d.config, hydro: { ...d.config.hydro, dragCoefficient: v ?? 0.12 } } }))}
                min={0.0001}
              />
            </Grid>
            <button className="gf-btn gf-btn-primary" onClick={create} disabled={busy}>
              {busy ? <Spinner label="Saving…" /> : "Save configuration"}
            </button>
          </div>
        )}
      </Card>

      <Card title="Side-by-side comparison" subtitle={`Evaluated at ${context.depthSI} m in ${context.waterDensitySI.toFixed(1)} kg/m³ water, with the same friction, drivetrain and safety factor throughout.`}>
        <div className="gf-scroll-x">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Quantity</th>
                {rows.map((r) => (
                  <th key={r.id}>
                    {r.name}
                    {r.id === "__current__" && <Badge tone="accent">current</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="Architecture" values={rows.map((r) => ARCHITECTURES[r.cfg.syringe.config].label)} />
              <Row label="Bore diameter" values={rows.map((r) => `${(r.cfg.syringe.boreDiameterSI * 1000).toFixed(1)} mm`)} />
              <Row label="Usable stroke" values={rows.map((r) => `${(r.cfg.syringe.usableStrokeSI * 1000).toFixed(1)} mm`)} />
              <Row label="Syringes" values={rows.map((r) => String(r.cfg.syringe.syringeCount))} />
              <Row label="Swept volume" values={rows.map((r) => num(r.result.engine.values.usableVolumeChange.value * 1e6, "cm^3"))} highlight />
              <Row label="Buoyancy authority" values={rows.map((r) => num(r.result.engine.values.buoyancyForceChange.value, "N"))} highlight />
              <Row
                label="Authority as % of weight"
                values={rows.map((r) =>
                  context.vehicleWeightN > 0 ? `${((r.result.engine.values.buoyancyForceChange.value / context.vehicleWeightN) * 100).toFixed(2)} %` : "—",
                )}
              />
              <Row label="Design actuator force" values={rows.map((r) => num(r.result.engine.values.designActuatorForce.value, "N"))} />
              <Row
                label="Required motor torque"
                values={rows.map((r) => (r.result.engine.values.requiredMotorTorque ? num(r.result.engine.values.requiredMotorTorque.value * 1000, "mN*m") : "—"))}
              />
              <Row
                label="Stall margin"
                values={rows.map((r) => (r.result.engine.values.stallMargin ? r.result.engine.values.stallMargin.value.toFixed(2) : "—"))}
                highlight
              />
              <Row label="Actuation time" values={rows.map((r) => (r.result.engine.values.actuationTime ? num(r.result.engine.values.actuationTime.value, "s") : "—"))} />
              <Row
                label="Energy per stroke"
                values={rows.map((r) => (r.result.engine.values.electricalEnergyPerStroke ? num(r.result.engine.values.electricalEnergyPerStroke.value, "J") : "—"))}
              />
              <Row
                label="Maximum feasible depth"
                values={rows.map((r) => (r.result.engine.values.maxFeasibleDepth ? num(r.result.engine.values.maxFeasibleDepth.value, "m") : "—"))}
              />
              <Row label="Predicted dive speed" values={rows.map((r) => num(r.result.glide.values.speed.value, "m/s"))} />
              <Row label="Predicted glide ratio" values={rows.map((r) => r.result.glide.values.glideRatio.value.toFixed(2))} />
              <tr>
                <td className="font-medium">Errors raised</td>
                {rows.map((r) => {
                  const errs = r.result.engine.warnings.filter((w) => w.severity === "error");
                  return (
                    <td key={r.id}>
                      {errs.length === 0 ? <Badge tone="good">none</Badge> : <Badge tone="critical">{errs.length}</Badge>}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Grid cols={2}>
        <BarPlot
          title="Buoyancy authority by configuration"
          data={chart}
          categoryKey="name"
          valueKey="buoyancy_authority_N"
          valueLabel="Buoyancy authority (N)"
          filename="comparison-authority"
          colorByIndex
          labelFormatter={(v) => `${v.toFixed(3)} N`}
          note="Authority alone does not decide the comparison — check it against the stall margin and the maximum feasible depth in the table, since a configuration with more authority the actuator cannot drive is worse, not better."
        />
        <Card title="Errors and warnings per configuration">
          <div className="space-y-3">
            {rows.map((r) => {
              const problems = r.result.engine.warnings.filter((w) => w.severity !== "info");
              return (
                <div key={r.id}>
                  <h4 className="text-xs font-semibold">{r.name}</h4>
                  {problems.length === 0 ? (
                    <p className="text-[11px] text-muted">No errors or warnings.</p>
                  ) : (
                    <ul className="ml-4 mt-1 list-disc space-y-1 text-[11px] text-muted">
                      {problems.slice(0, 4).map((w, i) => (
                        <li key={i} className={w.severity === "error" ? "text-[#d03b3b]" : undefined}>
                          {w.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </Grid>

      <Card title="How to use this comparison">
        <ul className="ml-4 list-disc space-y-2 text-xs leading-relaxed text-muted">
          <li>
            The comparison holds friction, drivetrain, safety factor, water and depth identical across candidates. If those differ between
            your real options, this table understates the difference — record it as a decision instead.
          </li>
          <li>
            A configuration is only better if it wins on the criteria you actually care about. Turn the winner into a{" "}
            <a href="/decisions" className="underline">
              decision record
            </a>{" "}
            with weighted criteria, so the reasoning survives the semester.
          </li>
          <li>
            The predicted speed and glide ratio inherit the hydrodynamic coefficients, which are currently{" "}
            <strong className="text-ink">{context.coefficientSource}</strong>. If they are assumed, differences in speed between
            configurations are more reliable than the absolute values.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Row({ label, values, highlight }: { label: string; values: string[]; highlight?: boolean }) {
  return (
    <tr className={highlight ? "font-semibold" : undefined}>
      <td className="font-medium">{label}</td>
      {values.map((v, i) => (
        <td key={i}>{v}</td>
      ))}
    </tr>
  );
}

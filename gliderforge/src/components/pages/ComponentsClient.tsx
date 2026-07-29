"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, downloadText, toCsv, jsonField, type Row } from "../client";
import {
  Card,
  Grid,
  UnitInput,
  NumberInput,
  TextInput,
  SelectInput,
  Checkbox,
  Badge,
  ProvenanceBadge,
  ErrorNotice,
  Spinner,
  EmptyState,
  Field,
  InfoDot,
} from "../ui";
import { GeometryUpload } from "./GeometryUpload";

const CATEGORIES = ["structure", "hull", "wing", "actuator", "electrical", "sensor", "ballast", "seal", "fastener", "payload", "other"];

const DISPLACEMENT_MODES = [
  { value: "hull", label: "hull — the pressure envelope" },
  { value: "external", label: "external — mounted outside, wetted" },
  { value: "internal", label: "internal — inside a sealed hull" },
  { value: "flooded", label: "flooded — in a free-flooding bay" },
];

const emptyDraft = (): Row => ({
  name: "",
  category: "structure",
  version: "A",
  quantity: 1,
  displacement_mode: "internal",
  include_in_budget: 1,
  movable: 0,
  confidence: "medium",
  pos_x: 0,
  pos_y: 0,
  pos_z: 0,
  com_x: 0,
  com_y: 0,
  com_z: 0,
});

export function ComponentsClient({
  projectId,
  rows,
  geometryFiles,
  materials,
  waterDensity,
}: {
  projectId: string;
  rows: Row[];
  geometryFiles: Row[];
  materials: { id: string; name: string; density: number }[];
  waterDensity: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [draft, setDraft] = React.useState<Row>(emptyDraft());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [uploadFor, setUploadFor] = React.useState<string | null>(null);

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  const startNew = () => {
    setEditing({ id: "" });
    setDraft(emptyDraft());
    setError(null);
  };

  const save = async () => {
    if (!String(draft.name ?? "").trim()) {
      setError("A component needs a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing?.id) await api.update(projectId, "components", String(editing.id), draft);
      else await api.create(projectId, "components", draft);
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await api.remove(projectId, "components", id);
      setConfirmDelete(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filtered = search.trim()
    ? rows.filter((r) => ["name", "part_number", "category", "material_name", "supplier"].some((k) => String(r[k] ?? "").toLowerCase().includes(search.toLowerCase())))
    : rows;

  // Live derived values for the row being edited.
  const mass = draft.measured_mass_kg ?? draft.estimated_mass_kg;
  const volume = draft.displaced_volume_m3 ?? draft.user_volume_m3 ?? draft.cad_volume_m3;
  const impliedDensity = Number(mass) > 0 && Number(volume) > 0 ? Number(mass) / Number(volume) : NaN;

  return (
    <div className="space-y-4">
      {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <input className="gf-input max-w-xs" placeholder="Search components…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search components" />
        <span className="text-xs text-muted">
          {filtered.length} of {rows.length}
        </span>
        <div className="ml-auto flex gap-2">
          <button className="gf-btn" onClick={() => downloadText("components.csv", toCsv(rows as Record<string, unknown>[]), "text/csv")} disabled={rows.length === 0}>
            Export CSV
          </button>
          <button className="gf-btn gf-btn-primary" onClick={startNew}>
            Add component
          </button>
        </div>
      </div>

      {editing && (
        <Card
          title={editing.id ? `Edit: ${String(editing.name ?? "")}` : "New component"}
          actions={
            <>
              <button className="gf-btn" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button className="gf-btn gf-btn-primary" onClick={save} disabled={busy}>
                {busy ? <Spinner label="Saving…" /> : "Save"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <Grid cols={3}>
              <TextInput label="Name" value={String(draft.name ?? "")} onChange={(v) => set("name", v)} required placeholder="Pressure hull tube" />
              <TextInput label="Part number" value={String(draft.part_number ?? "")} onChange={(v) => set("part_number", v)} />
              <TextInput label="Version" value={String(draft.version ?? "A")} onChange={(v) => set("version", v)} />
              <SelectInput label="Functional category" value={String(draft.category ?? "structure")} onChange={(v) => set("category", v)} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              <NumberInput label="Quantity installed" value={Number(draft.quantity ?? 1)} onChange={(v) => set("quantity", v ?? 1)} min={1} hint="Mass and volume below are for ONE unit." />
              <SelectInput
                label="Displacement mode"
                value={String(draft.displacement_mode ?? "internal")}
                onChange={(v) => set("displacement_mode", v)}
                options={DISPLACEMENT_MODES}
                hint="Decides whether this part's volume counts as displacement."
              />
            </Grid>

            <details open className="rounded border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Mass and volume</summary>
              <div className="border-t p-3">
                <Grid cols={3}>
                  <UnitInput
                    label="Measured mass"
                    dimension="mass"
                    defaultUnit="g"
                    valueSI={draft.measured_mass_kg === null || draft.measured_mass_kg === undefined ? undefined : Number(draft.measured_mass_kg)}
                    onChangeSI={(v) => set("measured_mass_kg", v)}
                    hint="Put it on a scale. A measured value always supersedes the estimate below, and the estimate is kept."
                    provenance="measured"
                  />
                  <UnitInput
                    label="Estimated mass"
                    dimension="mass"
                    defaultUnit="g"
                    valueSI={draft.estimated_mass_kg === null || draft.estimated_mass_kg === undefined ? undefined : Number(draft.estimated_mass_kg)}
                    onChangeSI={(v) => set("estimated_mass_kg", v)}
                    hint="Used only when there is no measured mass. Kept for comparison once you measure."
                    provenance="estimated"
                  />
                  <UnitInput
                    label="Displaced volume (used in the budget)"
                    dimension="volume"
                    defaultUnit="cm^3"
                    valueSI={draft.displaced_volume_m3 === null || draft.displaced_volume_m3 === undefined ? undefined : Number(draft.displaced_volume_m3)}
                    onChangeSI={(v) => set("displaced_volume_m3", v)}
                    hint="For a hull, this is the EXTERNAL envelope volume including fairings — not the internal cavity."
                  />
                  <UnitInput
                    label="CAD-derived volume"
                    dimension="volume"
                    defaultUnit="cm^3"
                    valueSI={draft.cad_volume_m3 === null || draft.cad_volume_m3 === undefined ? undefined : Number(draft.cad_volume_m3)}
                    onChangeSI={(v) => set("cad_volume_m3", v)}
                    hint="Filled in automatically when you attach a watertight mesh."
                    provenance="cad"
                  />
                  <UnitInput
                    label="Sealed internal volume"
                    dimension="volume"
                    defaultUnit="cm^3"
                    valueSI={draft.sealed_volume_m3 === null || draft.sealed_volume_m3 === undefined ? undefined : Number(draft.sealed_volume_m3)}
                    onChangeSI={(v) => set("sealed_volume_m3", v)}
                    hint="Recorded for reference; the budget uses the displaced volume above."
                  />
                  <UnitInput
                    label="Internal flooded volume"
                    dimension="volume"
                    defaultUnit="cm^3"
                    valueSI={draft.internal_flooded_m3 === null || draft.internal_flooded_m3 === undefined ? undefined : Number(draft.internal_flooded_m3)}
                    onChangeSI={(v) => set("internal_flooded_m3", v)}
                    hint="Space that fills with water. Remember its mass is not carried, but it is not displacement either."
                  />
                </Grid>
                {Number.isFinite(impliedDensity) && (
                  <p className={`mt-2 text-xs ${impliedDensity < 20 || impliedDensity > 22000 ? "text-[#d03b3b]" : "text-muted"}`}>
                    Implied density: <strong>{impliedDensity.toFixed(0)} kg/m³</strong>{" "}
                    {impliedDensity < 20
                      ? "— lighter than air. Check for a unit error (cm³ versus m³ is the usual culprit)."
                      : impliedDensity > 22000
                        ? "— denser than any engineering material. Check the units."
                        : impliedDensity < waterDensity
                          ? "— this part floats in the test water."
                          : "— this part sinks in the test water."}
                  </p>
                )}
              </div>
            </details>

            <details className="rounded border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Position and orientation</summary>
              <div className="border-t p-3">
                <p className="mb-2 text-[11px] leading-snug text-muted">
                  Vehicle frame: <strong>+x forward</strong> towards the nose, <strong>+y to port</strong>, <strong>+z up</strong>. The origin
                  is your chosen datum — conventionally the nose tip on the hull axis. Be consistent; the CG and CB are only meaningful in one
                  frame.
                </p>
                <Grid cols={3}>
                  <UnitInput label="Position x (forward)" dimension="length" defaultUnit="mm" valueSI={Number(draft.pos_x ?? 0)} onChangeSI={(v) => set("pos_x", v ?? 0)} />
                  <UnitInput label="Position y (port)" dimension="length" defaultUnit="mm" valueSI={Number(draft.pos_y ?? 0)} onChangeSI={(v) => set("pos_y", v ?? 0)} />
                  <UnitInput label="Position z (up)" dimension="length" defaultUnit="mm" valueSI={Number(draft.pos_z ?? 0)} onChangeSI={(v) => set("pos_z", v ?? 0)} />
                  <UnitInput label="COM offset x" dimension="length" defaultUnit="mm" valueSI={Number(draft.com_x ?? 0)} onChangeSI={(v) => set("com_x", v ?? 0)} hint="Centre of mass relative to the position above." />
                  <UnitInput label="COM offset y" dimension="length" defaultUnit="mm" valueSI={Number(draft.com_y ?? 0)} onChangeSI={(v) => set("com_y", v ?? 0)} />
                  <UnitInput label="COM offset z" dimension="length" defaultUnit="mm" valueSI={Number(draft.com_z ?? 0)} onChangeSI={(v) => set("com_z", v ?? 0)} />
                  <UnitInput label="Bounding size x" dimension="length" defaultUnit="mm" valueSI={draft.bbox_x === null || draft.bbox_x === undefined ? undefined : Number(draft.bbox_x)} onChangeSI={(v) => set("bbox_x", v)} hint="Used to draw the component in the 3D viewer." />
                  <UnitInput label="Bounding size y" dimension="length" defaultUnit="mm" valueSI={draft.bbox_y === null || draft.bbox_y === undefined ? undefined : Number(draft.bbox_y)} onChangeSI={(v) => set("bbox_y", v)} />
                  <UnitInput label="Bounding size z" dimension="length" defaultUnit="mm" valueSI={draft.bbox_z === null || draft.bbox_z === undefined ? undefined : Number(draft.bbox_z)} onChangeSI={(v) => set("bbox_z", v)} />
                </Grid>
                <div className="mt-3 space-y-2">
                  <Checkbox
                    label="This component can be moved for trim"
                    checked={Number(draft.movable ?? 0) === 1}
                    onChange={(v) => set("movable", v ? 1 : 0)}
                    hint="Movable components appear in the trim solver on the Stability page."
                  />
                  {Number(draft.movable ?? 0) === 1 && (
                    <Grid cols={2}>
                      <UnitInput label="Minimum x travel" dimension="length" defaultUnit="mm" valueSI={draft.min_x === null || draft.min_x === undefined ? undefined : Number(draft.min_x)} onChangeSI={(v) => set("min_x", v)} />
                      <UnitInput label="Maximum x travel" dimension="length" defaultUnit="mm" valueSI={draft.max_x === null || draft.max_x === undefined ? undefined : Number(draft.max_x)} onChangeSI={(v) => set("max_x", v)} />
                    </Grid>
                  )}
                </div>
              </div>
            </details>

            <details className="rounded border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Material, sourcing and confidence</summary>
              <div className="border-t p-3">
                <Grid cols={3}>
                  <Field label="Material" hint="Selecting a library material records its name and unverified nominal density. It does not compute the mass for you — weigh the part.">
                    <select
                      className="gf-input"
                      value={String(draft.material_id ?? "")}
                      onChange={(e) => {
                        const m = materials.find((x) => x.id === e.target.value);
                        set("material_id", e.target.value || null);
                        set("material_name", m?.name ?? null);
                        if (m) set("density_kg_m3", m.density);
                      }}
                    >
                      <option value="">(not specified)</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <UnitInput label="Density override" dimension="density" valueSI={draft.density_kg_m3 === null || draft.density_kg_m3 === undefined ? undefined : Number(draft.density_kg_m3)} onChangeSI={(v) => set("density_kg_m3", v)} hint="Project-specific override. Does not change the material library." />
                  <TextInput label="Manufacturing method" value={String(draft.manufacturing_method ?? "")} onChange={(v) => set("manufacturing_method", v)} placeholder="FDM print, 40% infill" />
                  <TextInput label="Supplier" value={String(draft.supplier ?? "")} onChange={(v) => set("supplier", v)} />
                  <NumberInput label="Unit cost (USD)" value={draft.cost === null || draft.cost === undefined ? undefined : Number(draft.cost)} onChange={(v) => set("cost", v)} min={0} />
                  <TextInput label="Datasheet URL" value={String(draft.datasheet_url ?? "")} onChange={(v) => set("datasheet_url", v)} />
                  <SelectInput
                    label="Confidence in this data"
                    value={String(draft.confidence ?? "medium")}
                    onChange={(v) => set("confidence", v)}
                    options={[
                      { value: "high", label: "High — measured or from a datasheet" },
                      { value: "medium", label: "Medium — CAD or a good estimate" },
                      { value: "low", label: "Low — a guess" },
                    ]}
                  />
                  <TextInput label="Colour in the 3D viewer" value={String(draft.color ?? "")} onChange={(v) => set("color", v)} placeholder="#7dd3fc" />
                </Grid>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <TextInput label="Notes" value={String(draft.notes ?? "")} onChange={(v) => set("notes", v)} multiline rows={3} />
                  <TextInput label="Assumptions about this component" value={String(draft.assumptions ?? "")} onChange={(v) => set("assumptions", v)} multiline rows={3} hint="e.g. 'mass estimated from a similar part', 'volume from CAD, not measured'." />
                </div>
                <div className="mt-3">
                  <Checkbox label="Include in the mass and buoyancy budget" checked={Number(draft.include_in_budget ?? 1) === 1} onChange={(v) => set("include_in_budget", v ? 1 : 0)} hint="Uncheck to keep a component on the list without counting it — useful for parts you are considering but have not committed to." />
                </div>
              </div>
            </details>
          </div>
        </Card>
      )}

      {rows.length === 0 && !editing ? (
        <EmptyState
          title="No components yet"
          body={
            <>
              Nothing downstream works without components — mass, displacement, CG, CB, stability, glide performance and the mission
              simulation all read from this list. Start with the big ones: the hull, the battery, the ballast and the buoyancy engine.
            </>
          }
          action={
            <button className="gf-btn gf-btn-primary" onClick={startNew}>
              Add the first component
            </button>
          }
        />
      ) : (
        <div className="gf-panel gf-scroll-x">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Qty</th>
                <th>Mass (each)</th>
                <th>Displacement</th>
                <th>Mode</th>
                <th>Position x, y, z (mm)</th>
                <th>Geometry</th>
                <th style={{ width: "1%" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const measured = r.measured_mass_kg !== null && r.measured_mass_kg !== undefined;
                const estimated = r.estimated_mass_kg !== null && r.estimated_mass_kg !== undefined;
                const massVal = measured ? Number(r.measured_mass_kg) : estimated ? Number(r.estimated_mass_kg) : NaN;
                const volVal = [r.displaced_volume_m3, r.user_volume_m3, r.cad_volume_m3].find((v) => v !== null && v !== undefined);
                const displaces = String(r.displacement_mode) !== "internal";
                const geo = geometryFiles.filter((g) => g.component_id === r.id);
                return (
                  <React.Fragment key={String(r.id)}>
                    <tr className={Number(r.include_in_budget) === 0 ? "opacity-50" : ""}>
                      <td>
                        <div className="font-medium">{String(r.name)}</div>
                        <div className="text-[11px] text-muted">
                          {String(r.category)}
                          {r.part_number ? ` · ${String(r.part_number)}` : ""}
                          {r.material_name ? ` · ${String(r.material_name)}` : ""}
                        </div>
                        {Number(r.include_in_budget) === 0 && <Badge tone="neutral">excluded from budget</Badge>}
                        {Number(r.movable) === 1 && <Badge tone="accent">movable</Badge>}
                      </td>
                      <td>{String(r.quantity ?? 1)}</td>
                      <td>
                        {Number.isFinite(massVal) ? (
                          <span className="inline-flex items-center gap-1">
                            {(massVal * 1000).toFixed(1)} g
                            <ProvenanceBadge provenance={measured ? "measured" : "estimated"} />
                          </span>
                        ) : (
                          <Badge tone="critical" title="Counted as zero in the budget, which biases the total and the CG.">
                            missing
                          </Badge>
                        )}
                      </td>
                      <td>
                        {!displaces ? (
                          <span className="text-[11px] text-muted">n/a (internal)</span>
                        ) : volVal !== undefined ? (
                          `${(Number(volVal) * 1e6).toFixed(1)} cm³`
                        ) : (
                          <Badge tone="critical">missing</Badge>
                        )}
                      </td>
                      <td>
                        <Badge tone={String(r.displacement_mode) === "hull" ? "accent" : "neutral"}>{String(r.displacement_mode)}</Badge>
                      </td>
                      <td className="whitespace-nowrap text-[11px]">
                        {(Number(r.pos_x ?? 0) * 1000).toFixed(0)}, {(Number(r.pos_y ?? 0) * 1000).toFixed(0)}, {(Number(r.pos_z ?? 0) * 1000).toFixed(0)}
                      </td>
                      <td>
                        {geo.length > 0 ? (
                          <div className="space-y-0.5">
                            {geo.map((g) => {
                              const parse = jsonField<{ meshAvailable?: boolean; analysis?: { isWatertight?: boolean } }>(g.parse_json, {});
                              return (
                                <div key={String(g.id)} className="text-[11px]">
                                  <a className="underline" href={`/api/files/${encodeURIComponent(String(g.stored_name))}`}>
                                    {String(g.filename)}
                                  </a>
                                  {parse.meshAvailable ? (
                                    <Badge tone={parse.analysis?.isWatertight ? "good" : "warning"}>
                                      {parse.analysis?.isWatertight ? "watertight" : "not closed"}
                                    </Badge>
                                  ) : (
                                    <Badge tone="neutral">metadata only</Badge>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted">—</span>
                        )}
                        <button className="gf-btn mt-1 px-2 py-0.5 text-[10px]" onClick={() => setUploadFor(uploadFor === String(r.id) ? null : String(r.id))}>
                          {uploadFor === String(r.id) ? "Close" : "Upload"}
                        </button>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex gap-1">
                          <button
                            className="gf-btn px-2 py-1 text-[11px]"
                            onClick={() => {
                              setEditing(r);
                              setDraft({ ...r });
                              setError(null);
                            }}
                          >
                            Edit
                          </button>
                          {confirmDelete === String(r.id) ? (
                            <>
                              <button className="gf-btn border-[#d03b3b] px-2 py-1 text-[11px] text-[#d03b3b]" onClick={() => remove(String(r.id))} disabled={busy}>
                                Confirm
                              </button>
                              <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setConfirmDelete(null)}>
                                No
                              </button>
                            </>
                          ) : (
                            <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setConfirmDelete(String(r.id))}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {uploadFor === String(r.id) && (
                      <tr>
                        <td colSpan={8} className="!p-0">
                          <div className="border-y bg-surface p-3">
                            <GeometryUpload
                              projectId={projectId}
                              componentId={String(r.id)}
                              componentName={String(r.name)}
                              onDone={() => {
                                setUploadFor(null);
                                router.refresh();
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-4 text-center text-xs text-muted">No components match &ldquo;{search}&rdquo;.</p>}
        </div>
      )}

      <p className="text-[11px] text-muted">
        A measured mass always supersedes an estimate, and the estimate is retained rather than overwritten
        <InfoDot text="Both fields are stored. The budget uses the measured value when present; the estimate stays available so you can see how far off it was." />
        . Deletions are reversible with Undo in the header.
      </p>
    </div>
  );
}

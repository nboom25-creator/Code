import { useEffect, useState } from 'react';
import { z } from 'zod';
import { errorMessage } from '../../api/client';
import {
  useAddBC,
  useCreateLoadCase,
  useCreateRegion,
  useDeleteBC,
  useDeleteLoadCase,
  useDeleteRegion,
  useLoadCases,
  useProtectRegion,
  useRegions,
  useValidateLoadCase,
} from '../../api/hooks';
import type { BCInput, BCType, LoadCaseValidation } from '../../api/types';
import { fmt, fmtInt } from '../../lib/format';
import { useUIStore } from '../../stores/ui';
import { BC_COLORS } from '../viewer/BCGlyphs';
import { Alert, Badge, Button, EmptyState, Field, Panel, cx, inputCls, selectCls } from '../ui';

const BC_TYPES: BCType[] = [
  'fixed',
  'pinned',
  'roller',
  'force',
  'pressure',
  'bearing',
  'torque',
  'gravity',
  'rotation',
  'symmetry',
];

const UNIT_OPTIONS: Partial<Record<BCType, string[]>> = {
  force: ['N', 'kN', 'lbf', 'kgf'],
  bearing: ['N', 'kN', 'lbf', 'kgf'],
  pressure: ['Pa', 'kPa', 'MPa', 'psi', 'bar'],
  torque: ['Nm', 'Nmm', 'lbf·ft', 'lbf·in'],
};

const NEEDS_MAGNITUDE = new Set<BCType>(['force', 'bearing', 'pressure', 'torque']);
const NEEDS_DIRECTION = new Set<BCType>(['force', 'bearing', 'gravity', 'roller', 'symmetry']);
const NEEDS_AXIS = new Set<BCType>(['torque', 'rotation']);
const NO_REGION = new Set<BCType>(['gravity', 'rotation']);

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

const bcSchema = z
  .object({
    bc_type: z.string(),
    region_id: z.string().nullable(),
    magnitude: z.number().nullable(),
    units: z.string().nullable(),
    direction: vec3.nullable(),
    axis_point: vec3.nullable(),
    axis_direction: vec3.nullable(),
    rpm: z.number().nullable(),
    description: z.string(),
  })
  .superRefine((v, ctx) => {
    const t = v.bc_type as BCType;
    if (!NO_REGION.has(t) && !v.region_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${t} requires a selected region`, path: ['region_id'] });
    }
    if (NEEDS_MAGNITUDE.has(t)) {
      if (v.magnitude === null || Number.isNaN(v.magnitude)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Magnitude is required', path: ['magnitude'] });
      }
      if (!v.units) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Units are required — bare numbers are rejected', path: ['units'] });
      }
    }
    if (NEEDS_DIRECTION.has(t)) {
      if (!v.direction || v.direction.every((c) => c === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A non-zero direction vector is required', path: ['direction'] });
      }
    }
    if (NEEDS_AXIS.has(t)) {
      if (!v.axis_point) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Axis point required', path: ['axis_point'] });
      if (!v.axis_direction || v.axis_direction.every((c) => c === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Axis direction required', path: ['axis_direction'] });
      }
    }
    if (t === 'rotation' && (v.rpm === null || Number.isNaN(v.rpm))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'RPM required', path: ['rpm'] });
    }
  });

export default function Step3Loads({ projectId }: { projectId: string }) {
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const { data: loadCases } = useLoadCases(projectId);
  const { data: regions } = useRegions(projectId, selectedMeshId ?? undefined);
  const activeLoadCaseId = useUIStore((s) => s.activeLoadCaseId);
  const setActiveLoadCaseId = useUIStore((s) => s.setActiveLoadCaseId);

  const activeLoadCase = loadCases?.find((lc) => lc.id === activeLoadCaseId) ?? loadCases?.[0] ?? null;

  useEffect(() => {
    if (!activeLoadCaseId && loadCases?.length) setActiveLoadCaseId(loadCases[0].id);
  }, [activeLoadCaseId, loadCases, setActiveLoadCaseId]);

  if (!selectedMeshId) {
    return (
      <EmptyState title="No mesh selected">
        Upload a mesh in step 1 first; loads are applied to regions selected on the active mesh
        version.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SelectionToolsPanel projectId={projectId} meshId={selectedMeshId} />
      <RegionManager projectId={projectId} meshId={selectedMeshId} />
      <LoadCasesPanel
        projectId={projectId}
        activeId={activeLoadCase?.id ?? null}
        onSelect={setActiveLoadCaseId}
      />
      {activeLoadCase && (
        <BCPanel
          projectId={projectId}
          loadCaseId={activeLoadCase.id}
          regionsAvailable={(regions ?? []).length > 0}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ selection tools

function SelectionToolsPanel({ projectId, meshId }: { projectId: string; meshId: string }) {
  const selectionTool = useUIStore((s) => s.selectionTool);
  const setSelectionTool = useUIStore((s) => s.setSelectionTool);
  const angle = useUIStore((s) => s.angleThresholdDeg);
  const setAngle = useUIStore((s) => s.setAngleThresholdDeg);
  const brushRadius = useUIStore((s) => s.brushRadius);
  const setBrushRadius = useUIStore((s) => s.setBrushRadius);
  const selection = useUIStore((s) => s.selectedTriangles);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const createRegion = useCreateRegion(projectId);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#38bdf8');

  return (
    <Panel title="Region selection tools">
      <div className="mb-2 flex gap-1.5">
        {(['none', 'seed', 'brush'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSelectionTool(t)}
            className={cx(
              'rounded border px-2 py-1 text-xs capitalize',
              selectionTool === t
                ? 'border-sky-500/70 bg-sky-500/20 text-sky-200'
                : 'border-slate-700 text-slate-300 hover:border-slate-600',
            )}
          >
            {t === 'none' ? 'Off' : t}
          </button>
        ))}
      </div>
      {selectionTool === 'seed' && (
        <div className="mb-1 text-[11px] text-slate-500">
          Click a triangle to flood-fill faces whose normal deviates less than the threshold from
          the clicked face. Shift+click adds, Alt+click removes.
        </div>
      )}
      {selectionTool === 'brush' && (
        <div className="mb-1 text-[11px] text-slate-500">
          Drag over the surface to add faces within the brush radius. Alt removes. Camera rotation
          is disabled while brushing.
        </div>
      )}
      <Field label={`Normal angle threshold: ${fmt(angle, 0)}°`}>
        <input type="range" min={5} max={90} step={1} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="w-full" />
      </Field>
      <Field label={`Brush radius: ${fmt(brushRadius * 100, 1)}% of model size`}>
        <input type="range" min={0.005} max={0.2} step={0.005} value={brushRadius} onChange={(e) => setBrushRadius(Number(e.target.value))} className="w-full" />
      </Field>
      <div className="mt-1 text-xs text-slate-400">
        Selected: <b className="text-slate-200">{fmtInt(selection.size)}</b> triangles{' '}
        {selection.size > 0 && (
          <button className="ml-1 text-sky-300 hover:underline" onClick={clearSelection}>
            clear
          </button>
        )}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <Field label="Region name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mounting holes" />
        </Field>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-9 shrink-0 cursor-pointer rounded border border-slate-600 bg-slate-900"
          title="Region color"
        />
        <Button
          variant="primary"
          className="shrink-0"
          disabled={selection.size === 0 || createRegion.isPending}
          onClick={() =>
            createRegion.mutate(
              {
                mesh_version_id: meshId,
                name: name || `Region (${selection.size} tris)`,
                triangle_indices: [...selection].sort((a, b) => a - b),
                color,
              },
              {
                onSuccess: () => {
                  setName('');
                  clearSelection();
                },
              },
            )
          }
        >
          Save region
        </Button>
      </div>
      {createRegion.isError && (
        <Alert kind="error" title="Save region failed" className="mt-2">
          {errorMessage(createRegion.error)}
        </Alert>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ regions

function RegionManager({ projectId, meshId }: { projectId: string; meshId: string }) {
  const { data: regions } = useRegions(projectId, meshId);
  const deleteRegion = useDeleteRegion(projectId);
  const protectMutation = useProtectRegion(projectId);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  return (
    <Panel title="Saved regions">
      {(regions ?? []).length === 0 && (
        <EmptyState title="No regions yet">
          Use the selection tools above, then save the selection as a named region.
        </EmptyState>
      )}
      <div className="flex flex-col gap-1.5">
        {regions?.map((r) => (
          <div key={r.id} className="rounded border border-slate-700 bg-slate-900/40 p-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: r.color }} />
              <span className="truncate font-medium text-slate-200">{r.name}</span>
              {r.protected && (
                <Badge color="amber" title={r.protect_reason || 'Protected region'}>
                  🔒 protected
                </Badge>
              )}
              <span className="ml-auto text-slate-500">{fmtInt(r.triangle_indices.length)} tris</span>
            </div>
            {r.protected && r.protect_reason && (
              <div className="mt-1 text-[11px] text-amber-300/80">{r.protect_reason}</div>
            )}
            <div className="mt-1.5 flex gap-2">
              {r.protected ? (
                <Button
                  className="!px-1.5 !py-0.5 text-[11px]"
                  onClick={() => protectMutation.mutate({ regionId: r.id, reason: '', protect: false })}
                >
                  Unprotect
                </Button>
              ) : reasonFor === r.id ? (
                <div className="flex w-full gap-1">
                  <input
                    className={inputCls}
                    placeholder="Why is this protected? (e.g. mating face)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    className="!px-1.5 !py-0.5 text-[11px]"
                    variant="primary"
                    onClick={() => {
                      protectMutation.mutate({ regionId: r.id, reason, protect: true });
                      setReasonFor(null);
                      setReason('');
                    }}
                  >
                    OK
                  </Button>
                </div>
              ) : (
                <Button className="!px-1.5 !py-0.5 text-[11px]" onClick={() => setReasonFor(r.id)}>
                  Protect
                </Button>
              )}
              <Button
                variant="danger"
                className="!px-1.5 !py-0.5 text-[11px]"
                onClick={() => deleteRegion.mutate(r.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
      {(deleteRegion.isError || protectMutation.isError) && (
        <Alert kind="error" title="Region update failed" className="mt-2">
          {errorMessage(deleteRegion.error ?? protectMutation.error)}
        </Alert>
      )}
      <div className="mt-2 text-[10px] text-slate-500">
        Protected regions are enforced during variant generation — operations that move them are
        rejected. To rename a region, delete and re-create it.
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ load cases

function LoadCasesPanel({
  projectId,
  activeId,
  onSelect,
}: {
  projectId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: loadCases } = useLoadCases(projectId);
  const createMutation = useCreateLoadCase(projectId);
  const deleteMutation = useDeleteLoadCase(projectId);
  const [name, setName] = useState('');

  return (
    <Panel title="Load cases">
      <div className="flex flex-col gap-1">
        {loadCases?.map((lc) => (
          <div
            key={lc.id}
            className={cx(
              'flex items-center gap-2 rounded border px-2 py-1.5 text-xs',
              lc.id === activeId ? 'border-sky-500/60 bg-sky-500/10' : 'border-slate-700 bg-slate-900/40',
            )}
          >
            <input type="radio" checked={lc.id === activeId} onChange={() => onSelect(lc.id)} />
            <span className="truncate font-medium text-slate-200">{lc.name}</span>
            <span className="ml-auto text-slate-500">{lc.boundary_conditions.length} BCs</span>
            <button className="text-slate-500 hover:text-red-400" onClick={() => deleteMutation.mutate(lc.id)} title="Delete load case">
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className={inputCls} placeholder="New load case name…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          className="shrink-0"
          disabled={createMutation.isPending}
          onClick={() =>
            createMutation.mutate(
              { name: name || `Load case ${(loadCases?.length ?? 0) + 1}`, description: '' },
              { onSuccess: (lc) => { onSelect(lc.id); setName(''); } },
            )
          }
        >
          Add
        </Button>
      </div>
      {(createMutation.isError || deleteMutation.isError) && (
        <Alert kind="error" title="Load case update failed" className="mt-2">
          {errorMessage(createMutation.error ?? deleteMutation.error)}
        </Alert>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ BC builder + list

function Vec3Input({
  value,
  onChange,
  quickButtons,
}: {
  value: [number, number, number] | null;
  onChange: (v: [number, number, number]) => void;
  quickButtons?: boolean;
}) {
  const v = value ?? [0, 0, 0];
  return (
    <div>
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <input
            key={i}
            className={cx(inputCls, 'w-0 flex-1')}
            type="number"
            step="any"
            value={v[i]}
            onChange={(e) => {
              const next: [number, number, number] = [...v] as [number, number, number];
              next[i] = Number(e.target.value);
              onChange(next);
            }}
          />
        ))}
      </div>
      {quickButtons && (
        <div className="mt-1 flex flex-wrap gap-1">
          {(
            [
              ['+X', [1, 0, 0]],
              ['−X', [-1, 0, 0]],
              ['+Y', [0, 1, 0]],
              ['−Y', [0, -1, 0]],
              ['+Z', [0, 0, 1]],
              ['−Z', [0, 0, -1]],
            ] as [string, [number, number, number]][]
          ).map(([label, dir]) => (
            <button
              key={label}
              onClick={() => onChange(dir)}
              className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-sky-500/60"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BCPanel({
  projectId,
  loadCaseId,
  regionsAvailable,
}: {
  projectId: string;
  loadCaseId: string;
  regionsAvailable: boolean;
}) {
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const { data: loadCases } = useLoadCases(projectId);
  const { data: regions } = useRegions(projectId, selectedMeshId ?? undefined);
  const addMutation = useAddBC(projectId);
  const deleteMutation = useDeleteBC(projectId);
  const validateMutation = useValidateLoadCase();
  const bcDraft = useUIStore((s) => s.bcDraft);
  const setBcDraft = useUIStore((s) => s.setBcDraft);

  const lc = loadCases?.find((l) => l.id === loadCaseId);

  const [bcType, setBcType] = useState<BCType>('fixed');
  const [regionId, setRegionId] = useState<string>('');
  const [magnitude, setMagnitude] = useState('');
  const [units, setUnits] = useState('');
  const [direction, setDirection] = useState<[number, number, number] | null>(null);
  const [axisPoint, setAxisPoint] = useState<[number, number, number] | null>(null);
  const [axisDirection, setAxisDirection] = useState<[number, number, number] | null>(null);
  const [rpm, setRpm] = useState('');
  const [g, setG] = useState('');
  const [description, setDescription] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<LoadCaseValidation | null>(null);

  // prefill from an AI draft
  useEffect(() => {
    if (!bcDraft) return;
    if (BC_TYPES.includes(bcDraft.bc_type as BCType)) setBcType(bcDraft.bc_type as BCType);
    if (bcDraft.magnitude != null) setMagnitude(String(bcDraft.magnitude));
    if (bcDraft.units) setUnits(bcDraft.units);
    if (bcDraft.direction && bcDraft.direction.length === 3) {
      setDirection([bcDraft.direction[0], bcDraft.direction[1], bcDraft.direction[2]]);
    }
    setDescription(bcDraft.description);
    setBcDraft(null);
  }, [bcDraft, setBcDraft]);

  const unitOptions = UNIT_OPTIONS[bcType] ?? [];

  const submit = () => {
    const parsed = bcSchema.safeParse({
      bc_type: bcType,
      region_id: NO_REGION.has(bcType) ? null : regionId || null,
      magnitude: magnitude.trim() === '' ? null : Number(magnitude),
      units: units || null,
      direction,
      axis_point: axisPoint,
      axis_direction: axisDirection,
      rpm: rpm.trim() === '' ? null : Number(rpm),
      description,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    const body: BCInput = {
      bc_type: bcType,
      region_id: NO_REGION.has(bcType) ? null : regionId,
      description,
      magnitude: NEEDS_MAGNITUDE.has(bcType) ? Number(magnitude) : null,
      units: NEEDS_MAGNITUDE.has(bcType) ? units : null,
      direction: NEEDS_DIRECTION.has(bcType) ? direction : null,
      axis_point: NEEDS_AXIS.has(bcType) ? axisPoint : null,
      axis_direction: NEEDS_AXIS.has(bcType) ? axisDirection : null,
      rpm: bcType === 'rotation' ? Number(rpm) : null,
      g: bcType === 'gravity' && g.trim() !== '' ? Number(g) : null,
    };
    addMutation.mutate(
      { loadCaseId, bc: body },
      {
        onSuccess: () => {
          setValidation(null);
          setDescription('');
        },
      },
    );
  };

  return (
    <Panel title="Boundary conditions">
      {!regionsAvailable && (
        <Alert kind="info" className="mb-2">
          Save at least one region above — every support and surface load must be mapped to a
          region (gravity and rotation act on the whole body).
        </Alert>
      )}

      {/* builder */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type">
          <select
            className={selectCls}
            value={bcType}
            onChange={(e) => {
              setBcType(e.target.value as BCType);
              setUnits('');
              setFormErrors({});
            }}
          >
            {BC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        {!NO_REGION.has(bcType) && (
          <Field label="Region">
            <select className={selectCls} value={regionId} onChange={(e) => setRegionId(e.target.value)}>
              <option value="">— choose —</option>
              {regions?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {formErrors.region_id && <span className="text-[11px] text-red-400">{formErrors.region_id}</span>}
          </Field>
        )}
        {NEEDS_MAGNITUDE.has(bcType) && (
          <>
            <Field label="Magnitude">
              <input className={inputCls} type="number" step="any" value={magnitude} onChange={(e) => setMagnitude(e.target.value)} />
              {formErrors.magnitude && <span className="text-[11px] text-red-400">{formErrors.magnitude}</span>}
            </Field>
            <Field label="Units (required)">
              <select className={selectCls} value={units} onChange={(e) => setUnits(e.target.value)}>
                <option value="">— choose —</option>
                {unitOptions.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              {formErrors.units && <span className="text-[11px] text-red-400">{formErrors.units}</span>}
            </Field>
          </>
        )}
        {bcType === 'gravity' && (
          <Field label="g override [m/s²]" hint="Empty = standard 9.80665">
            <input className={inputCls} type="number" step="any" value={g} onChange={(e) => setG(e.target.value)} />
          </Field>
        )}
        {bcType === 'rotation' && (
          <Field label="Speed [rpm]">
            <input className={inputCls} type="number" step="any" value={rpm} onChange={(e) => setRpm(e.target.value)} />
            {formErrors.rpm && <span className="text-[11px] text-red-400">{formErrors.rpm}</span>}
          </Field>
        )}
      </div>

      {NEEDS_DIRECTION.has(bcType) && (
        <Field label={bcType === 'roller' || bcType === 'symmetry' ? 'Constraint normal' : 'Direction vector'}>
          <Vec3Input value={direction} onChange={setDirection} quickButtons />
          {formErrors.direction && <span className="text-[11px] text-red-400">{formErrors.direction}</span>}
        </Field>
      )}
      {NEEDS_AXIS.has(bcType) && (
        <>
          <Field label="Axis point (mesh units)">
            <Vec3Input value={axisPoint} onChange={setAxisPoint} />
            {formErrors.axis_point && <span className="text-[11px] text-red-400">{formErrors.axis_point}</span>}
          </Field>
          <Field label="Axis direction">
            <Vec3Input value={axisDirection} onChange={setAxisDirection} quickButtons />
            {formErrors.axis_direction && (
              <span className="text-[11px] text-red-400">{formErrors.axis_direction}</span>
            )}
          </Field>
        </>
      )}
      <Field label="Description">
        <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Pump weight on top holes" />
      </Field>

      <Button variant="primary" className="mt-2" onClick={submit} disabled={addMutation.isPending}>
        {addMutation.isPending ? 'Adding…' : 'Add boundary condition'}
      </Button>
      {addMutation.isError && (
        <Alert kind="error" title="Add boundary condition failed" className="mt-2">
          {errorMessage(addMutation.error)}
        </Alert>
      )}

      {/* list */}
      <div className="mt-3 flex flex-col gap-1.5">
        {lc?.boundary_conditions.map((bc) => (
          <div key={bc.id} className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/40 px-2 py-1.5 text-xs">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: BC_COLORS[bc.bc_type] ?? '#94a3b8' }} />
            <span className="font-mono text-slate-200">{bc.bc_type}</span>
            {bc.params.magnitude != null && (
              <span className="text-slate-300">
                {fmt(bc.params.magnitude, 4)} {bc.params.units}
              </span>
            )}
            {bc.params.rpm != null && <span className="text-slate-300">{fmt(bc.params.rpm, 1)} rpm</span>}
            <span className="ml-auto truncate text-slate-500" title={bc.description}>
              {bc.description}
            </span>
            <button className="text-slate-500 hover:text-red-400" onClick={() => deleteMutation.mutate(bc.id)} title="Delete BC">
              ✕
            </button>
          </div>
        ))}
        {lc && lc.boundary_conditions.length === 0 && (
          <div className="text-xs text-slate-500">No boundary conditions in this load case yet.</div>
        )}
      </div>

      <Button
        className="mt-2"
        disabled={validateMutation.isPending}
        onClick={() => validateMutation.mutate(loadCaseId, { onSuccess: setValidation })}
      >
        {validateMutation.isPending ? 'Validating…' : 'Validate load case'}
      </Button>
      {validateMutation.isError && (
        <Alert kind="error" title="Validation request failed" className="mt-2">
          {errorMessage(validateMutation.error)}
        </Alert>
      )}
      {validation && (
        <div className="mt-2 flex flex-col gap-1.5">
          {validation.ok && validation.warnings.length === 0 && (
            <Alert kind="success">Load case is valid — supports and loads pass the sanity checks.</Alert>
          )}
          {validation.errors.map((e, i) => (
            <Alert key={i} kind="error">
              {e}
            </Alert>
          ))}
          {validation.warnings.map((w, i) => (
            <Alert key={i} kind="warning">
              {w}
            </Alert>
          ))}
        </div>
      )}
    </Panel>
  );
}

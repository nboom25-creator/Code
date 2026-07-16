import { useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../api/client';
import {
  useCapabilities,
  useConfirmUnit,
  useGeometryAnalysis,
  useMeshes,
  useProject,
  useRepairCommit,
  useRepairPreview,
  useStartGeometryAnalysis,
  useUnitSuggestion,
  useUploadMesh,
} from '../../api/hooks';
import type { MeshVersion, RepairOp, RepairPreview, UnitSuggestion } from '../../api/types';
import { fmt, fmtBytes, fmtInt, fmtLength, fmtMass, fmtPct, fmtVec, shortSha } from '../../lib/format';
import { TERM_TOOLTIPS } from '../../lib/format';
import { useUIStore } from '../../stores/ui';
import { Alert, Badge, Button, Collapsible, EmptyState, KVTable, Panel, Spinner, Term, cx } from '../ui';

const REPAIR_OPS: { op: RepairOp; label: string }[] = [
  { op: 'remove_duplicate_faces', label: 'Remove duplicate faces' },
  { op: 'remove_degenerate_faces', label: 'Remove degenerate faces' },
  { op: 'merge_vertices', label: 'Merge vertices' },
  { op: 'fix_winding', label: 'Fix winding' },
  { op: 'fix_normals', label: 'Fix normals' },
  { op: 'fill_holes', label: 'Fill holes' },
  { op: 'remove_small_components', label: 'Remove small components' },
  { op: 'watertight_reconstruction', label: 'Watertight reconstruction' },
];

export default function Step1Upload({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId);
  const { data: caps } = useCapabilities();
  const { data: meshes } = useMeshes(projectId);
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const setSelectedMeshId = useUIStore((s) => s.setSelectedMeshId);

  const uploadMutation = useUploadMesh(projectId);
  const confirmUnitMutation = useConfirmUnit(projectId);
  const analyzeMutation = useStartGeometryAnalysis(projectId);
  const analysisQuery = useGeometryAnalysis(selectedMeshId ?? undefined);
  const previewMutation = useRepairPreview(selectedMeshId ?? undefined);
  const commitMutation = useRepairCommit(projectId, selectedMeshId ?? undefined);

  const [dragging, setDragging] = useState(false);
  const [unitChoice, setUnitChoice] = useState<string | null>(null);
  const [selectedOps, setSelectedOps] = useState<Set<RepairOp>>(new Set());
  const [preview, setPreview] = useState<RepairPreview | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const hasMesh = !!meshes?.length;
  const suggestionQuery = useUnitSuggestion(projectId, hasMesh && !project?.unit_confirmed);
  const suggestion: UnitSuggestion | undefined =
    uploadMutation.data?.unit_suggestion ?? suggestionQuery.data;

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    uploadMutation.mutate(file);
  };

  const meshTree = useMemo(() => buildTree(meshes ?? []), [meshes]);
  const selectedMesh = meshes?.find((m) => m.id === selectedMeshId);
  const unit = project?.unit_confirmed ? project.unit : null;

  const toggleOp = (op: RepairOp) => {
    setSelectedOps((prev) => {
      const next = new Set(prev);
      if (next.has(op)) next.delete(op);
      else next.add(op);
      return next;
    });
    setPreview(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* -------- upload -------- */}
      <Panel title="Upload mesh">
        <div
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed px-3 py-6 text-center transition-colors',
            dragging ? 'border-sky-400 bg-sky-500/10' : 'border-slate-600 hover:border-slate-500',
          )}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".stl,.obj,.3mf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="text-sm text-slate-300">
            {uploadMutation.isPending ? (
              <span className="flex items-center gap-2">
                <Spinner /> Uploading…
              </span>
            ) : (
              'Drop an STL / OBJ / 3MF here, or click to browse'
            )}
          </div>
          {caps && (
            <div className="mt-1 text-[11px] text-slate-500">
              Limits: {fmtBytes(caps.max_upload_bytes)}, {fmtInt(caps.max_triangles)} triangles
            </div>
          )}
        </div>
        {uploadMutation.isError && (
          <Alert kind="error" title="Upload failed" className="mt-2">
            {errorMessage(uploadMutation.error)}
          </Alert>
        )}
        {uploadMutation.isSuccess && (
          <div className="mt-2 text-xs text-emerald-300">
            Uploaded {uploadMutation.data.asset.filename} (
            {fmtBytes(uploadMutation.data.asset.size_bytes)},{' '}
            {uploadMutation.data.asset.format}). The uploaded file is stored verbatim and never
            modified.
          </div>
        )}
      </Panel>

      {/* -------- units -------- */}
      {hasMesh && (
        <Panel title="Model units">
          {project?.unit_confirmed ? (
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <Badge color="green">confirmed</Badge> Units: {project.unit}
            </div>
          ) : (
            <>
              <Alert kind="warning" className="mb-2">
                Mesh files carry no units. Nothing is analyzed in SI until you confirm.
              </Alert>
              {suggestion && (
                <div className="mb-2 rounded bg-slate-900/70 p-2 text-xs text-slate-300">
                  <Badge color="amber" className="mr-1.5">
                    estimated
                  </Badge>
                  Suggested: <b>{suggestion.suggestion ?? 'unknown'}</b>
                  <div className="mt-1 text-slate-400">{suggestion.reason}</div>
                </div>
              )}
              <div className="mb-2 flex gap-3">
                {(['mm', 'cm', 'm', 'in'] as const).map((u) => (
                  <label key={u} className="flex items-center gap-1 text-sm text-slate-200">
                    <input
                      type="radio"
                      name="unit"
                      checked={(unitChoice ?? suggestion?.suggestion) === u}
                      onChange={() => setUnitChoice(u)}
                    />
                    {u}
                  </label>
                ))}
              </div>
              <Button
                variant="primary"
                disabled={confirmUnitMutation.isPending || !(unitChoice ?? suggestion?.suggestion)}
                onClick={() => {
                  const u = unitChoice ?? suggestion?.suggestion;
                  if (u) confirmUnitMutation.mutate(u);
                }}
              >
                Confirm units
              </Button>
              {confirmUnitMutation.isError && (
                <Alert kind="error" title="Unit confirmation failed" className="mt-2">
                  {errorMessage(confirmUnitMutation.error)}
                </Alert>
              )}
            </>
          )}
        </Panel>
      )}

      {/* -------- mesh versions -------- */}
      <Panel title="Mesh versions">
        {!hasMesh && (
          <EmptyState title="No mesh yet">Upload an STL, OBJ or 3MF file above to begin.</EmptyState>
        )}
        <div className="flex flex-col gap-1">
          {meshTree.map(({ mesh, depth }) => (
            <button
              key={mesh.id}
              onClick={() => setSelectedMeshId(mesh.id)}
              className={cx(
                'rounded border px-2 py-1.5 text-left text-xs transition-colors',
                mesh.id === selectedMeshId
                  ? 'border-sky-500/60 bg-sky-500/10'
                  : 'border-slate-700 bg-slate-900/40 hover:border-slate-600',
              )}
              style={{ marginLeft: depth * 14 }}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  color={mesh.kind === 'original' ? 'sky' : mesh.kind === 'repaired' ? 'green' : 'purple'}
                >
                  {mesh.kind}
                </Badge>
                <span className="truncate font-medium text-slate-200">{mesh.label || mesh.id}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span>{fmtInt(mesh.triangle_count)} tris</span>
                <Badge color={mesh.watertight ? 'green' : 'red'} title={TERM_TOOLTIPS.watertight}>
                  {mesh.watertight ? 'watertight' : 'not watertight'}
                </Badge>
                <span className="font-mono text-slate-500">{shortSha(mesh.sha256)}</span>
              </div>
            </button>
          ))}
        </div>
      </Panel>

      {/* -------- geometry analysis -------- */}
      {selectedMesh && (
        <Panel
          title="Geometry analysis (Tier A)"
          actions={
            <Button
              variant="primary"
              disabled={analyzeMutation.isPending}
              onClick={() => analyzeMutation.mutate(selectedMesh.id)}
            >
              {analyzeMutation.isPending ? 'Submitting…' : 'Run analysis'}
            </Button>
          }
        >
          {analyzeMutation.isError && (
            <Alert kind="error" title="Could not start analysis" className="mb-2">
              {errorMessage(analyzeMutation.error)}
            </Alert>
          )}
          {analyzeMutation.isSuccess && (
            <div className="mb-2 text-xs text-slate-400">
              Job submitted — progress appears in the job bar below.
            </div>
          )}
          {analysisQuery.isError && (
            <EmptyState title="No analysis yet">
              Run geometry analysis to get the full health report and heat maps.
            </EmptyState>
          )}
          {analysisQuery.data && <HealthReport analysis={analysisQuery.data} unit={unit ?? null} />}
        </Panel>
      )}

      {/* -------- repair -------- */}
      {selectedMesh && (
        <Panel title="Repair (non-destructive)">
          <p className="mb-2 text-[11px] text-slate-500">
            The original file is never modified — applying repairs creates a new mesh version.
          </p>
          <div className="mb-2 grid grid-cols-1 gap-1">
            {REPAIR_OPS.map(({ op, label }) => (
              <label key={op} className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={selectedOps.has(op)} onChange={() => toggleOp(op)} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              disabled={selectedOps.size === 0 || previewMutation.isPending}
              onClick={() =>
                previewMutation.mutate([...selectedOps], { onSuccess: (p) => setPreview(p) })
              }
            >
              {previewMutation.isPending ? 'Previewing…' : 'Preview'}
            </Button>
            <Button
              variant="primary"
              disabled={selectedOps.size === 0 || commitMutation.isPending}
              onClick={() =>
                commitMutation.mutate([...selectedOps], {
                  onSuccess: (r) => {
                    setSelectedMeshId(r.mesh_version.id);
                    setPreview(null);
                  },
                })
              }
            >
              {commitMutation.isPending ? 'Applying…' : 'Apply as new version'}
            </Button>
          </div>
          {previewMutation.isError && (
            <Alert kind="error" title="Repair preview failed" className="mt-2">
              {errorMessage(previewMutation.error)}
            </Alert>
          )}
          {commitMutation.isError && (
            <Alert kind="error" title="Repair commit failed" className="mt-2">
              {errorMessage(commitMutation.error)}
            </Alert>
          )}
          {preview && <RepairDiff preview={preview} />}
          {commitMutation.isSuccess && (
            <div className="mt-2 text-xs text-emerald-300">
              Created new version. Log: {commitMutation.data.log.join(' · ')}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ helpers

function buildTree(meshes: MeshVersion[]): { mesh: MeshVersion; depth: number }[] {
  const byParent = new Map<string | null, MeshVersion[]>();
  const ids = new Set(meshes.map((m) => m.id));
  for (const m of meshes) {
    const parent = m.parent_mesh_id && ids.has(m.parent_mesh_id) ? m.parent_mesh_id : null;
    const list = byParent.get(parent) ?? [];
    list.push(m);
    byParent.set(parent, list);
  }
  const out: { mesh: MeshVersion; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const m of byParent.get(parent) ?? []) {
      out.push({ mesh: m, depth });
      walk(m.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function HealthReport({
  analysis,
  unit,
}: {
  analysis: NonNullable<ReturnType<typeof useGeometryAnalysis>['data']>;
  unit: string | null;
}) {
  const m = analysis.metrics;
  const h = analysis.health;
  const thickness = analysis.features?.thickness;
  const overhang = analysis.features?.overhang;
  const holes = analysis.features?.hole_candidates ?? [];
  const planar = analysis.features?.planar_faces ?? [];
  const symmetry = analysis.features?.symmetry_planes ?? [];
  const u2 = unit ? `${unit}²` : 'mesh units²';
  const u3 = unit ? `${unit}³` : 'mesh units³';

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="font-semibold text-slate-200">Metrics</div>
      <KVTable
        rows={[
          ['Triangles', fmtInt(m.triangle_count)],
          ['Vertices', fmtInt(m.vertex_count)],
          [
            'Bounding box',
            m.bounding_box_mesh_units.extents.map((e) => fmt(e, 2)).join(' × ') +
              ` ${unit ?? 'mesh units'}`,
          ],
          ['Surface area', `${fmt(m.surface_area_mesh_units2, 4)} ${u2}`],
          [
            'Volume',
            m.volume_mesh_units3 != null
              ? `${fmt(m.volume_mesh_units3, 4)} ${u3}`
              : m.volume_note ?? 'requires watertight mesh',
          ],
          [
            'Est. mass',
            m.estimated_mass_kg != null ? fmtMass(m.estimated_mass_kg) : 'needs units + material',
          ],
          ['Center of mass', `${fmtVec(m.center_of_mass_mesh_units)} ${unit ?? 'mesh units'}`],
          ['Components', fmtInt(h.connected_components)],
          ['Boundary edges', fmtInt(h.boundary_edge_count)],
          [
            <Term key="nm" text="Non-manifold edges" tip={TERM_TOOLTIPS.manifold} />,
            fmtInt(h.non_manifold_edge_count),
          ],
          ['Duplicate faces', fmtInt(h.duplicate_face_count)],
          ['Degenerate faces', fmtInt(h.degenerate_face_count)],
          ['Winding consistent', h.winding_consistent ? 'yes' : `no (${h.broken_face_count} flagged)`],
          [
            'Self-intersection',
            h.self_intersection.checked
              ? h.self_intersection.suspected
                ? `suspected (${h.self_intersection.status ?? ''})`
                : 'none detected'
              : 'not checked',
          ],
        ]}
      />
      {m.estimated_mass_kg != null && m.mass_note && (
        <div className="text-[11px] text-slate-500">{m.mass_note}</div>
      )}

      {thickness?.ok && (
        <>
          <div className="mt-1 font-semibold text-slate-200">Wall thickness (estimate)</div>
          <KVTable
            rows={[
              ['Min wall (robust)', fmtLength(thickness.min_wall_estimate ?? null, unit)],
              ['Absolute min', fmtLength(thickness.absolute_min ?? null, unit)],
              ['Median', fmtLength(thickness.median_wall ?? null, unit)],
              ['Max (p99)', fmtLength(thickness.max_wall_estimate ?? null, unit)],
              ['Sampled faces', fmtInt(thickness.sampled_faces ?? null)],
            ]}
          />
          {thickness.note && <div className="text-[11px] text-slate-500">{thickness.note}</div>}
        </>
      )}

      {overhang?.ok && (
        <>
          <div className="mt-1 font-semibold text-slate-200">
            Overhangs (build dir {fmtVec(overhang.build_direction ?? null, 1)}, threshold{' '}
            {fmt(overhang.threshold_deg ?? null, 0)}°)
          </div>
          <KVTable
            rows={[
              ['Overhang fraction', fmtPct(overhang.overhang_fraction ?? null)],
              ['Overhang faces', fmtInt(overhang.overhang_face_count ?? null)],
              ['Unsupported islands', fmtInt(overhang.unsupported_islands?.length ?? 0)],
              ['Trapped volumes', fmtInt(overhang.trapped_volumes?.length ?? 0)],
            ]}
          />
        </>
      )}

      <div className="mt-1 font-semibold text-slate-200">Feature candidates</div>
      <KVTable
        rows={[
          ['Hole candidates', fmtInt(holes.length)],
          ['Planar faces', fmtInt(planar.length)],
          ['Symmetry planes', fmtInt(symmetry.length)],
        ]}
      />
      {holes.length > 0 && (
        <Collapsible label={`Hole details (${Math.min(holes.length, 12)} shown)`}>
          <ul className="space-y-0.5">
            {holes.slice(0, 12).map((hole, i) => (
              <li key={i}>
                Ø {fmtLength(hole.radius * 2, unit, 3)} — fit error{' '}
                {fmt(hole.fit_error_ratio * 100, 2)}% of radius
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
      {analysis.features?.note && (
        <div className="text-[11px] text-slate-500">{analysis.features.note}</div>
      )}

      {h.issues.length > 0 && (
        <>
          <div className="mt-1 font-semibold text-slate-200">Issues</div>
          {h.issues.map((issue, i) => (
            <Alert key={i} kind={issue.severity === 'high' ? 'error' : 'warning'}>
              {issue.message}
            </Alert>
          ))}
        </>
      )}
    </div>
  );
}

function RepairDiff({ preview }: { preview: RepairPreview }) {
  const keys: (keyof RepairPreview['before'])[] = [
    'watertight',
    'boundary_edge_count',
    'non_manifold_edge_count',
    'duplicate_face_count',
    'degenerate_face_count',
    'connected_components',
  ];
  const label: Record<string, string> = {
    watertight: 'Watertight',
    boundary_edge_count: 'Boundary edges',
    non_manifold_edge_count: 'Non-manifold edges',
    duplicate_face_count: 'Duplicate faces',
    degenerate_face_count: 'Degenerate faces',
    connected_components: 'Components',
  };
  return (
    <div className="mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700 text-slate-400">
            <th className="py-1 text-left font-medium">Metric</th>
            <th className="py-1 text-right font-medium">Before</th>
            <th className="py-1 text-right font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-700/50">
            <td className="py-1 text-slate-400">Triangles</td>
            <td className="py-1 text-right font-mono">{fmtInt(preview.triangle_count_before)}</td>
            <td className="py-1 text-right font-mono">{fmtInt(preview.triangle_count_after)}</td>
          </tr>
          {keys.map((k) => {
            const b = preview.before[k];
            const a = preview.after[k];
            const fmtV = (v: boolean | number) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : fmtInt(v));
            const improved = String(b) !== String(a);
            return (
              <tr key={k} className="border-b border-slate-700/50">
                <td className="py-1 text-slate-400">{label[k]}</td>
                <td className="py-1 text-right font-mono">{fmtV(b)}</td>
                <td className={cx('py-1 text-right font-mono', improved && 'text-emerald-300')}>
                  {fmtV(a)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-1.5 text-[11px] text-slate-500">{preview.note}</div>
      <Collapsible label="Operation log">
        <ul className="list-disc pl-4">
          {preview.log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Collapsible>
    </div>
  );
}

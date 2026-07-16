import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl, errorMessage } from '../../api/client';
import {
  useCapabilities,
  useGeometryAnalysis,
  useLoadCases,
  useProject,
  useProjectMaterial,
  useMeshes,
  useResults,
  useStartFea,
  useStartGeometryAnalysis,
  useValidateLoadCase,
} from '../../api/hooks';
import type { LoadCaseValidation, SimulationResult } from '../../api/types';
import {
  TERM_TOOLTIPS,
  fmt,
  fmtDate,
  fmtDispMm,
  fmtInt,
  fmtStressMPa,
} from '../../lib/format';
import { useUIStore } from '../../stores/ui';
import { Alert, Badge, Button, Collapsible, EmptyState, KVTable, Panel, Term, cx, selectCls } from '../ui';

const DENSITIES = [
  { label: 'Coarse (~20k elements)', value: 20_000 },
  { label: 'Standard (~60k elements)', value: 60_000 },
  { label: 'Fine (~150k elements)', value: 150_000 },
];

export default function Step4Analysis({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId);
  const { data: caps } = useCapabilities();
  const { data: meshes } = useMeshes(projectId);
  const { data: material } = useProjectMaterial(projectId);
  const { data: loadCases } = useLoadCases(projectId);
  const { data: results } = useResults(projectId);
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const activeLoadCaseId = useUIStore((s) => s.activeLoadCaseId);
  const analysisQuery = useGeometryAnalysis(selectedMeshId ?? undefined);
  const geoMutation = useStartGeometryAnalysis(projectId);
  const feaMutation = useStartFea(projectId);
  const validateMutation = useValidateLoadCase();

  const setHeatmapField = useUIStore((s) => s.setHeatmapField);
  const feaResultId = useUIStore((s) => s.feaResultId);
  const setFeaResultId = useUIStore((s) => s.setFeaResultId);
  const setFeaField = useUIStore((s) => s.setFeaField);
  const feaScale = useUIStore((s) => s.feaScale);
  const setFeaScale = useUIStore((s) => s.setFeaScale);

  const [targetElements, setTargetElements] = useState(60_000);
  const [secondOrder, setSecondOrder] = useState(true);
  const [validation, setValidation] = useState<LoadCaseValidation | null>(null);

  const selectedMesh = meshes?.find((m) => m.id === selectedMeshId);
  const loadCase = loadCases?.find((lc) => lc.id === activeLoadCaseId) ?? loadCases?.[0] ?? null;

  // live-validate the active load case for the precondition checklist
  useEffect(() => {
    if (!loadCase) {
      setValidation(null);
      return;
    }
    validateMutation.mutate(loadCase.id, { onSuccess: setValidation });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCase?.id, loadCase?.boundary_conditions.length]);

  const checks: { label: string; ok: boolean; fix: string; fixLabel: string }[] = [
    {
      label: 'Units confirmed',
      ok: !!project?.unit_confirmed,
      fix: `/p/${projectId}/upload`,
      fixLabel: 'confirm in step 1',
    },
    {
      label: 'Material confirmed',
      ok: !!material?.confirmed,
      fix: `/p/${projectId}/material`,
      fixLabel: 'confirm in step 2',
    },
    {
      label: 'Mesh watertight',
      ok: !!selectedMesh?.watertight,
      fix: `/p/${projectId}/upload`,
      fixLabel: 'repair in step 1',
    },
    {
      label: 'Load case valid',
      ok: !!validation?.ok,
      fix: `/p/${projectId}/loads`,
      fixLabel: 'fix in step 3',
    },
    {
      label: 'Solver available (Gmsh + CalculiX)',
      ok: !!caps?.fea_available,
      fix: '/settings',
      fixLabel: 'see capabilities',
    },
  ];
  const allOk = checks.every((c) => c.ok) && !!selectedMesh && !!loadCase;

  const meshResults = (results ?? []).filter((r) => r.mesh_version_id === selectedMeshId);
  const latest = meshResults[0] ?? null;
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const shown = meshResults.find((r) => r.id === selectedResultId) ?? latest;

  return (
    <div className="flex flex-col gap-3">
      {/* ---------------- Tier A ---------------- */}
      <Panel
        title="Tier A — geometry analysis"
        actions={
          <Button
            disabled={!selectedMeshId || geoMutation.isPending}
            onClick={() => selectedMeshId && geoMutation.mutate(selectedMeshId)}
          >
            {geoMutation.isPending ? 'Submitting…' : 'Run again'}
          </Button>
        }
      >
        {geoMutation.isError && (
          <Alert kind="error" title="Could not start geometry analysis" className="mb-2">
            {errorMessage(geoMutation.error)}
          </Alert>
        )}
        {analysisQuery.data ? (
          <div className="text-xs text-slate-300">
            <div>
              Latest run: {fmtDate(analysisQuery.data.created_at)} —{' '}
              {fmtInt(analysisQuery.data.metrics.triangle_count)} triangles,{' '}
              {analysisQuery.data.health.issues.length} issue(s).
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(['thickness', 'overhang', 'sharpness'] as const).map((f) => (
                <Button key={f} className="!px-2 !py-1 text-[11px]" onClick={() => setHeatmapField(f)}>
                  {f} heat map
                </Button>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Full report in step 1; heat maps display on the model.
            </div>
          </div>
        ) : (
          <EmptyState title="No geometry analysis yet">
            Run it to unlock heat maps, recommendations and the health report.
          </EmptyState>
        )}
      </Panel>

      {/* ---------------- Tier B ---------------- */}
      <Panel title="Tier B — preliminary FEA (linear statics)">
        <ul className="mb-2 flex flex-col gap-1">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-xs">
              <span className={cx('font-bold', c.ok ? 'text-emerald-400' : 'text-red-400')}>
                {c.ok ? '✓' : '✗'}
              </span>
              <span className={c.ok ? 'text-slate-300' : 'text-slate-400'}>{c.label}</span>
              {!c.ok && (
                <Link to={c.fix} className="ml-auto text-[11px] text-sky-300 hover:underline">
                  {c.fixLabel}
                </Link>
              )}
            </li>
          ))}
        </ul>
        {validation && !validation.ok && (
          <div className="mb-2 flex flex-col gap-1">
            {validation.errors.map((e, i) => (
              <Alert key={i} kind="error">
                {e}
              </Alert>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-400">Mesh density</span>
            <select className={selectCls} value={targetElements} onChange={(e) => setTargetElements(Number(e.target.value))}>
              {DENSITIES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-1.5 pb-1.5 text-xs text-slate-300">
            <input type="checkbox" checked={secondOrder} onChange={(e) => setSecondOrder(e.target.checked)} />
            Second-order elements (C3D10)
          </label>
        </div>

        <Button
          variant="primary"
          className="mt-2 w-full"
          disabled={!allOk || feaMutation.isPending}
          onClick={() =>
            selectedMeshId &&
            loadCase &&
            feaMutation.mutate({
              mesh_version_id: selectedMeshId,
              load_case_id: loadCase.id,
              settings: { target_elements: targetElements, second_order: secondOrder },
            })
          }
        >
          {feaMutation.isPending ? 'Submitting…' : 'Run FEA'}
        </Button>
        {!allOk && (
          <div className="mt-1 text-[11px] text-slate-500">
            The run button unlocks when every precondition above passes.
          </div>
        )}
        {feaMutation.isError && (
          <Alert kind="error" title="Could not start FEA" className="mt-2">
            {errorMessage(feaMutation.error)}
          </Alert>
        )}
        {feaMutation.isSuccess && (
          <div className="mt-2 text-xs text-slate-400">Job submitted — watch the job bar below.</div>
        )}
      </Panel>

      {/* ---------------- results ---------------- */}
      <Panel title="FEA results">
        {meshResults.length === 0 && (
          <EmptyState title="No results for this mesh version">
            Run FEA above (all preconditions must pass), or select the mesh version a result was
            computed on in step 1.
          </EmptyState>
        )}
        {meshResults.length > 1 && (
          <select
            className={cx(selectCls, 'mb-2')}
            value={shown?.id ?? ''}
            onChange={(e) => setSelectedResultId(e.target.value)}
          >
            {meshResults.map((r) => (
              <option key={r.id} value={r.id}>
                {fmtDate(r.created_at)} {r.is_mock ? '(demo mock)' : ''}
              </option>
            ))}
          </select>
        )}
        {shown && (
          <ResultSummary
            result={shown}
            active={feaResultId === shown.id}
            feaScale={feaScale}
            onShowStress={() => {
              setFeaResultId(shown.id);
              setFeaField('von_mises');
            }}
            onShowDisplacement={() => {
              setFeaResultId(shown.id);
              setFeaField('displacement');
            }}
            onScale={setFeaScale}
          />
        )}
      </Panel>
    </div>
  );
}

function ResultSummary({
  result,
  active,
  feaScale,
  onShowStress,
  onShowDisplacement,
  onScale,
}: {
  result: SimulationResult;
  active: boolean;
  feaScale: number;
  onShowStress: () => void;
  onShowDisplacement: () => void;
  onScale: (v: number) => void;
}) {
  const s = result.summary;
  const failedGates = Object.entries(s.validity_gates ?? {}).filter(([, g]) => !g.ok);
  const reactions = Object.entries(s.reactions_n ?? {});
  const reactionTotal = reactions.reduce((acc, [, v]) => {
    if (Array.isArray(v)) return acc + Math.hypot(...(v as number[]));
    return acc + Math.abs(v as number);
  }, 0);

  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.is_mock && (
        <Alert kind="warning" title="Demo-mode mock result">
          This result was generated for the demo without a real solver run.
        </Alert>
      )}
      <KVTable
        rows={[
          ['Max displacement', fmtDispMm(s.max_displacement_m)],
          [
            <Term key="vm" text="Max von Mises" tip={TERM_TOOLTIPS.von_mises} />,
            fmtStressMPa(s.max_von_mises_pa),
          ],
          [
            <Term key="p95" text="p95 von Mises" tip={TERM_TOOLTIPS.p95} />,
            fmtStressMPa(s.p95_von_mises_pa),
          ],
          ['p99 von Mises', fmtStressMPa(s.p99_von_mises_pa)],
          [
            'Principal stress range',
            `${fmtStressMPa(s.min_principal_stress_pa)} … ${fmtStressMPa(s.max_principal_stress_pa)}`,
          ],
          ['Elements', `${fmtInt(s.element_count)} (${s.element_type})`],
          ['Nodes', fmtInt(s.node_count)],
        ]}
      />

      {/* factor of safety */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400">
          <Term text="FoS (yield)" tip={TERM_TOOLTIPS.fos} />:
        </span>
        <span className="font-mono text-base text-slate-100">
          {s.factor_of_safety_yield != null ? fmt(s.factor_of_safety_yield, 3) : '—'}
        </span>
        <Badge color={s.fos_valid ? 'green' : 'amber'}>{s.fos_valid ? 'valid' : 'not valid'}</Badge>
        {s.factor_of_safety_p95 != null && (
          <span className="text-slate-500">(p95-based: {fmt(s.factor_of_safety_p95, 3)})</span>
        )}
      </div>
      {!s.fos_valid && (
        <Alert kind="warning" title="Validity gates failed">
          {failedGates.map(([k, gate]) => (
            <div key={k}>
              <b>{k}</b>: {gate.detail}
            </div>
          ))}
          {s.fos_note && <div className="mt-1">{s.fos_note}</div>}
        </Alert>
      )}
      {s.singularity_suspected && (
        <Alert kind="warning" title="Stress singularity suspected">
          <Term text="Peak stress at sharp corners does not converge" tip={TERM_TOOLTIPS.singularity} />{' '}
          — the raw maximum grows with mesh refinement and is not physically meaningful there. Use
          the p95/p99 percentiles and add fillets where the peak occurs.
        </Alert>
      )}

      {/* reactions */}
      {reactions.length > 0 && (
        <>
          <div className="font-semibold text-slate-200">Reactions per support [N]</div>
          <KVTable
            rows={reactions.map(([name, v]) => [
              name,
              Array.isArray(v)
                ? `(${(v as number[]).map((x) => fmt(x, 3)).join(', ')}) — |R| ${fmt(Math.hypot(...(v as number[])), 3)} N`
                : `${fmt(v as number, 3)} N`,
            ])}
          />
          <div className="text-[11px] text-slate-500">
            Load balance: total reaction magnitude ≈ {fmt(reactionTotal, 3)} N — this should match
            the applied loads for a converged static solve.
          </div>
          {Object.keys(s.applied_loads ?? {}).length > 0 && (
            <Collapsible label="Applied load summary">
              <pre className="overflow-x-auto rounded bg-slate-900 p-2">
                {JSON.stringify(s.applied_loads, null, 2)}
              </pre>
            </Collapsible>
          )}
        </>
      )}

      {/* mesh quality */}
      {Object.keys(s.mesh_quality ?? {}).length > 0 && (
        <Collapsible label="Mesh quality">
          <KVTable rows={Object.entries(s.mesh_quality).map(([k, v]) => [k.replace(/_/g, ' '), fmt(v, 4)])} />
          {s.mesh_warnings?.map((w, i) => (
            <div key={i} className="text-amber-300">
              {w}
            </div>
          ))}
        </Collapsible>
      )}

      {/* overlay controls */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Button variant={active ? 'secondary' : 'primary'} onClick={onShowStress}>
          Show stress on model
        </Button>
        <Button onClick={onShowDisplacement}>Show displacement</Button>
      </div>
      <label className="block">
        <span className="text-slate-400">Deformation scale: ×{fmt(feaScale, 1)}</span>
        <input
          type="range"
          min={0}
          max={500}
          step={1}
          value={feaScale}
          onChange={(e) => onScale(Number(e.target.value))}
          className="w-full"
        />
      </label>

      {/* downloads */}
      <div className="flex gap-3 text-[11px]">
        <a className="text-sky-300 hover:underline" href={apiUrl(`/results/${result.id}/deck`)}>
          Download CalculiX deck (.inp)
        </a>
        <a className="text-sky-300 hover:underline" href={apiUrl(`/results/${result.id}/log`)}>
          Solver log
        </a>
      </div>

      {/* assumptions: always visible */}
      <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
        <div className="mb-1 font-semibold text-slate-300">Assumptions</div>
        {result.assumptions.length === 0 && <div className="text-slate-500">None recorded.</div>}
        <ul className="list-disc space-y-0.5 pl-4 text-slate-400">
          {result.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

import { errorMessage } from '../../api/client';
import { useComparison, useVariants } from '../../api/hooks';
import type { ComparisonRow } from '../../api/types';
import { fmt, fmtDispMm, fmtInt, fmtMass, fmtPct, fmtStressMPa } from '../../lib/format';
import { useUIStore, type Axis } from '../../stores/ui';
import { Alert, Badge, Collapsible, EmptyState, Panel, cx, selectCls } from '../ui';

interface MetricDef {
  key: keyof ComparisonRow;
  label: string;
  format: (v: unknown, row: ComparisonRow) => string;
  deltaKey?: string;
  lowerIsBetter?: boolean;
}

const METRICS: MetricDef[] = [
  { key: 'mass_kg', label: 'Mass', format: (v) => fmtMass(v as number | null), deltaKey: 'mass_kg_change_pct', lowerIsBetter: true },
  { key: 'volume_m3', label: 'Volume', format: (v) => (v == null ? '—' : `${fmt((v as number) * 1e6, 3)} cm³`) },
  { key: 'max_displacement_m', label: 'Max displacement', format: (v) => fmtDispMm(v as number | null), deltaKey: 'max_displacement_m_change_pct', lowerIsBetter: true },
  { key: 'p95_von_mises_pa', label: 'p95 von Mises', format: (v) => fmtStressMPa(v as number | null), deltaKey: 'p95_von_mises_pa_change_pct', lowerIsBetter: true },
  { key: 'max_von_mises_pa', label: 'Max von Mises', format: (v) => fmtStressMPa(v as number | null), lowerIsBetter: true },
  {
    key: 'fos_yield',
    label: 'FoS (yield)',
    format: (v, row) => (v == null ? '—' : `${fmt(v as number, 3)}${row.fos_valid ? '' : ' *'}`),
    deltaKey: 'fos_yield_change_pct',
    lowerIsBetter: false,
  },
  { key: 'min_wall_estimate', label: 'Min wall (mesh units)', format: (v) => (v == null ? '—' : fmt(v as number, 3)) },
  { key: 'triangle_count', label: 'Triangles', format: (v) => fmtInt(v as number | null) },
  { key: 'geometry_warning_count', label: 'Geometry warnings', format: (v) => fmtInt(v as number | null), lowerIsBetter: true },
  { key: 'overhang_fraction', label: 'Overhang fraction', format: (v) => (v == null ? '—' : fmtPct(v as number)), lowerIsBetter: true },
];

export default function Step7Comparison({ projectId }: { projectId: string }) {
  const comparisonQuery = useComparison(projectId);
  const { data: variants } = useVariants(projectId);
  const comparisonVariantMeshId = useUIStore((s) => s.comparisonVariantMeshId);
  const setComparisonVariantMeshId = useUIStore((s) => s.setComparisonVariantMeshId);
  const mode = useUIStore((s) => s.comparisonMode);
  const setMode = useUIStore((s) => s.setComparisonMode);
  const sectionEnabled = useUIStore((s) => s.sectionEnabled);
  const sectionAxis = useUIStore((s) => s.sectionAxis);
  const sectionOffset = useUIStore((s) => s.sectionOffset);
  const setSection = useUIStore((s) => s.setSection);

  const comparison = comparisonQuery.data;
  const succeeded = (variants ?? []).filter((v) => v.status === 'succeeded' && v.result_mesh_id);
  const selectedVariant = succeeded.find((v) => v.result_mesh_id === comparisonVariantMeshId);

  if (comparisonQuery.isError) {
    return (
      <Alert kind="error" title="Comparison unavailable">
        {errorMessage(comparisonQuery.error)}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Comparison controls">
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-slate-400">Variant (right viewport)</span>
          <select
            className={selectCls}
            value={comparisonVariantMeshId ?? ''}
            onChange={(e) => setComparisonVariantMeshId(e.target.value || null)}
          >
            {succeeded.map((v) => (
              <option key={v.id} value={v.result_mesh_id!}>
                {v.name} ({v.strategy})
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 flex gap-1.5">
          {(
            [
              ['side-by-side', 'Side by side'],
              ['overlay', 'Overlay'],
              ['difference', 'Difference'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={cx(
                'rounded border px-2 py-1 text-xs',
                mode === k
                  ? 'border-sky-500/70 bg-sky-500/20 text-sky-200'
                  : 'border-slate-700 text-slate-300 hover:border-slate-600',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={sectionEnabled}
              onChange={(e) => setSection({ sectionEnabled: e.target.checked })}
            />
            Section plane (synchronized)
          </label>
          {sectionEnabled && (
            <>
              <select
                value={sectionAxis}
                onChange={(e) => setSection({ sectionAxis: e.target.value as Axis })}
                className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5"
              >
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z">Z</option>
              </select>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={sectionOffset}
                onChange={(e) => setSection({ sectionOffset: Number(e.target.value) })}
                className="w-24"
              />
            </>
          )}
        </div>
        {mode === 'difference' && (
          <div className="mt-1.5 text-[11px] text-slate-500">
            Variant faces colored by approximate surface deviation from the baseline
            (nearest-vertex grid search, client-side).
          </div>
        )}
      </Panel>

      <Panel title="Metrics">
        {!comparison && <EmptyState title="Loading comparison…" />}
        {comparison && comparison.rows.length <= 1 && (
          <EmptyState title="No variants to compare">
            Generate variants in step 6; each successful variant appears here with deltas against
            the baseline.
          </EmptyState>
        )}
        {comparison && comparison.rows.length > 1 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="py-1 pr-2 text-left font-medium">Metric</th>
                  {comparison.rows.map((r, i) => (
                    <th key={i} className="px-1.5 py-1 text-right font-medium">
                      {i === 0 ? 'Baseline' : r.name}
                      {r.score != null && (
                        <div>
                          <Badge color="purple">score {fmt(r.score, 1)}</Badge>
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => (
                  <tr key={m.key} className="border-b border-slate-700/50">
                    <td className="py-1 pr-2 text-slate-400">{m.label}</td>
                    {comparison.rows.map((r, i) => {
                      const delta = m.deltaKey ? r.deltas?.[m.deltaKey] : undefined;
                      const good = delta !== undefined && (m.lowerIsBetter ? delta < 0 : delta > 0);
                      return (
                        <td key={i} className="px-1.5 py-1 text-right font-mono text-slate-200">
                          {m.format(r[m.key], r)}
                          {i > 0 && delta !== undefined && (
                            <div className={cx('text-[10px]', good ? 'text-emerald-400' : 'text-red-400')}>
                              {delta > 0 ? '+' : ''}
                              {fmt(delta, 2)}%
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="py-1 pr-2 text-slate-400">FEA confidence</td>
                  {comparison.rows.map((r, i) => (
                    <td key={i} className="px-1.5 py-1 text-right text-slate-300">
                      {i === 0 ? (r.fos_valid ? 'valid FEA' : '—') : r.confidence ?? '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <div className="mt-1.5 text-[10px] text-slate-500">
              * FoS shown for reference only — its validity gates failed on that design.
            </div>
            <div className="mt-1.5 rounded bg-slate-900/60 p-2 text-[11px] text-slate-400">
              {comparison.score_explanation}
            </div>
          </div>
        )}
      </Panel>

      {selectedVariant && (
        <Panel title={`Operation timeline — ${selectedVariant.name}`}>
          <ol className="flex flex-col gap-1 text-xs">
            {selectedVariant.operations.map((op) => (
              <li key={op.seq} className="flex items-start gap-2 rounded bg-slate-900/50 p-1.5">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] text-slate-300">
                  {op.seq + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-slate-200">{op.op_type}</span>
                    <Badge color={op.status === 'applied' ? 'green' : op.status === 'failed' ? 'red' : 'amber'}>
                      {op.status}
                    </Badge>
                  </div>
                  {op.reason && <div className="text-slate-500">{op.reason}</div>}
                  {op.error && <div className="text-red-300">{op.error}</div>}
                </div>
              </li>
            ))}
            {selectedVariant.operations.length === 0 && (
              <li className="text-slate-500">No operations recorded.</li>
            )}
          </ol>
          <Collapsible label="Raw operation parameters">
            <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-[10px]">
              {JSON.stringify(selectedVariant.operations.map((o) => o.params), null, 2)}
            </pre>
          </Collapsible>
        </Panel>
      )}
    </div>
  );
}

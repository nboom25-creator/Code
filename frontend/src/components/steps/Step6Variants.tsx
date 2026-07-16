import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, errorMessage } from '../../api/client';
import {
  useGenerateVariants,
  useRecommendations,
  useSetVariantApproval,
  useVariants,
} from '../../api/hooks';
import type { DesignVariant } from '../../api/types';
import { fmt, fmtLength, fmtMass } from '../../lib/format';
import { useUIStore } from '../../stores/ui';
import { Alert, Badge, Button, Collapsible, EmptyState, Panel, cx } from '../ui';

// Mirrors backend STRATEGIES descriptions (services/variants.py); the API also
// returns strategy_description on each generated variant.
const STRATEGIES: { key: string; label: string; description: string }[] = [
  { key: 'conservative', label: 'Conservative', description: 'Smallest geometry change, manufacturability first.' },
  { key: 'balanced', label: 'Balanced', description: 'Moderate changes for strength-to-weight.' },
  { key: 'performance', label: 'Performance', description: 'Aggressive reinforcement within envelope limits.' },
];

export default function Step6Variants({ projectId }: { projectId: string }) {
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const { data: recs } = useRecommendations(projectId, selectedMeshId ?? undefined);
  const { data: variants } = useVariants(projectId);
  const generateMutation = useGenerateVariants(projectId);

  const [strategies, setStrategies] = useState<Set<string>>(
    new Set(['conservative', 'balanced', 'performance']),
  );
  const autoRecs = useMemo(() => (recs ?? []).filter((r) => r.auto_generatable && r.state !== 'dismissed'), [recs]);
  const manualRecs = useMemo(() => (recs ?? []).filter((r) => !r.auto_generatable && r.state !== 'dismissed'), [recs]);
  const [selectedRecs, setSelectedRecs] = useState<Set<string> | null>(null); // null = all auto
  const effectiveSelected = selectedRecs ?? new Set(autoRecs.map((r) => r.id));

  const toggleStrategy = (k: string) =>
    setStrategies((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const toggleRec = (id: string) => {
    const n = new Set(effectiveSelected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelectedRecs(n);
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Generate design variants">
        <div className="mb-2 flex flex-col gap-1.5">
          {STRATEGIES.map((s) => (
            <label key={s.key} className="flex items-start gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={strategies.has(s.key)}
                onChange={() => toggleStrategy(s.key)}
              />
              <span>
                <b>{s.label}</b> — <span className="text-slate-400">{s.description}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mb-1 text-xs font-semibold text-slate-200">Recommendations to include</div>
        {autoRecs.length === 0 && (
          <Alert kind="info" className="mb-2">
            No auto-generatable recommendations for this mesh. Generate recommendations in step 5
            first — manual-only findings cannot be automated.
          </Alert>
        )}
        <div className="flex flex-col gap-1">
          {autoRecs.map((r) => (
            <label key={r.id} className="flex items-start gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={effectiveSelected.has(r.id)}
                onChange={() => toggleRec(r.id)}
              />
              <span>
                {r.title} <Badge color="green">auto</Badge>
              </span>
            </label>
          ))}
        </div>
        {manualRecs.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] font-medium text-slate-500">
              Requires manual CAD work (not selectable):
            </div>
            <ul className="mt-0.5 list-disc pl-4 text-[11px] text-slate-500">
              {manualRecs.map((r) => (
                <li key={r.id}>{r.title}</li>
              ))}
            </ul>
          </div>
        )}

        <Button
          variant="primary"
          className="mt-3 w-full"
          disabled={!selectedMeshId || strategies.size === 0 || generateMutation.isPending || autoRecs.length === 0}
          onClick={() =>
            selectedMeshId &&
            generateMutation.mutate({
              base_mesh_id: selectedMeshId,
              strategies: [...strategies],
              recommendation_ids: [...effectiveSelected],
            })
          }
        >
          {generateMutation.isPending ? 'Submitting…' : 'Generate variants'}
        </Button>
        {generateMutation.isError && (
          <Alert kind="error" title="Generate variants failed" className="mt-2">
            {errorMessage(generateMutation.error)}
          </Alert>
        )}
        {generateMutation.isSuccess && (
          <div className="mt-2 text-xs text-slate-400">
            Job submitted — each variant re-runs geometry checks (and FEA when possible). Watch the
            job bar.
          </div>
        )}
      </Panel>

      <Panel title="Variants">
        {(variants ?? []).length === 0 && (
          <EmptyState title="No variants yet">
            Generate variants above once auto-generatable recommendations exist.
          </EmptyState>
        )}
        <div className="flex flex-col gap-2">
          {variants?.map((v) => (
            <VariantCard key={v.id} variant={v} projectId={projectId} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

const OP_STATUS_COLOR: Record<string, 'green' | 'red' | 'amber' | 'slate'> = {
  applied: 'green',
  failed: 'red',
  rejected: 'amber',
};

function VariantCard({ variant: v, projectId }: { variant: DesignVariant; projectId: string }) {
  const approvalMutation = useSetVariantApproval(projectId);
  const setComparisonVariantMeshId = useUIStore((s) => s.setComparisonVariantMeshId);
  const navigate = useNavigate();
  const m = v.metrics?.metrics;

  return (
    <div
      className={cx(
        'rounded border border-slate-700 bg-slate-900/50 p-2 text-xs',
        v.status === 'failed' && 'border-red-500/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-slate-100">{v.name || v.strategy}</span>
        <Badge color="sky">{v.strategy}</Badge>
        <Badge color={v.status === 'succeeded' ? 'green' : v.status === 'failed' ? 'red' : 'slate'}>
          {v.status}
        </Badge>
        {v.approval !== 'pending' && (
          <Badge color={v.approval === 'approved' ? 'green' : 'red'}>{v.approval}</Badge>
        )}
        {v.score != null && (
          <Badge color="purple" title="Comparative score from the comparison run — not an acceptance value">
            score {fmt(v.score, 1)}
          </Badge>
        )}
      </div>
      {v.strategy_description && <div className="mt-0.5 text-[11px] text-slate-500">{v.strategy_description}</div>}

      {v.status === 'failed' && v.error && (
        <Alert kind="error" title="Variant generation failed" className="mt-1.5">
          {v.error}
        </Alert>
      )}

      {m && (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
          <span className="text-slate-500">Est. mass</span>
          <span className="text-right font-mono text-slate-300">
            {m.estimated_mass_kg != null ? fmtMass(m.estimated_mass_kg) : '—'}
          </span>
          <span className="text-slate-500">Min wall</span>
          <span className="text-right font-mono text-slate-300">
            {fmtLength(v.metrics?.min_wall_estimate ?? null, m.unit ?? null)}
          </span>
          <span className="text-slate-500">Watertight</span>
          <span className="text-right font-mono text-slate-300">{m.watertight ? 'yes' : 'no'}</span>
          <span className="text-slate-500">Geometry issues</span>
          <span className="text-right font-mono text-slate-300">{v.metrics?.issue_count ?? '—'}</span>
        </div>
      )}

      {v.operations.length > 0 && (
        <Collapsible label={`Operations (${v.operations.length})`}>
          <ol className="space-y-1">
            {v.operations.map((op) => (
              <li key={op.seq} className="flex flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-slate-300">
                    {op.seq + 1}. {op.op_type}
                  </span>
                  <Badge color={OP_STATUS_COLOR[op.status] ?? 'slate'}>{op.status}</Badge>
                </span>
                {op.reason && <span className="text-slate-500">{op.reason}</span>}
                {op.error && <span className="text-red-300">{op.status}: {op.error}</span>}
              </li>
            ))}
          </ol>
        </Collapsible>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          className="!px-2 !py-0.5 text-[11px]"
          variant={v.approval === 'approved' ? 'primary' : 'secondary'}
          onClick={() =>
            approvalMutation.mutate({
              variantId: v.id,
              approval: v.approval === 'approved' ? 'pending' : 'approved',
            })
          }
        >
          {v.approval === 'approved' ? 'Approved ✓' : 'Approve'}
        </Button>
        <Button
          className="!px-2 !py-0.5 text-[11px]"
          variant={v.approval === 'rejected' ? 'danger' : 'secondary'}
          onClick={() =>
            approvalMutation.mutate({
              variantId: v.id,
              approval: v.approval === 'rejected' ? 'pending' : 'rejected',
            })
          }
        >
          {v.approval === 'rejected' ? 'Rejected ✗' : 'Reject'}
        </Button>
        {v.result_mesh_id && (
          <>
            <a
              className="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-100 hover:bg-slate-600"
              href={apiUrl(`/meshes/${v.result_mesh_id}/file`)}
            >
              STL
            </a>
            <a
              className="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-100 hover:bg-slate-600"
              href={apiUrl(`/variants/${v.id}/recipe`)}
              target="_blank"
              rel="noreferrer"
              title="JSON modification recipe — the exact validated operations"
            >
              Recipe JSON
            </a>
            <Button
              className="!px-2 !py-0.5 text-[11px]"
              onClick={() => {
                setComparisonVariantMeshId(v.result_mesh_id);
                navigate(`/p/${projectId}/comparison`);
              }}
            >
              View in comparison
            </Button>
          </>
        )}
      </div>
      {approvalMutation.isError && (
        <Alert kind="error" title="Approval update failed" className="mt-1.5">
          {errorMessage(approvalMutation.error)}
        </Alert>
      )}
    </div>
  );
}

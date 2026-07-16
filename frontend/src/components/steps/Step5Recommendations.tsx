import { useMemo, useState } from 'react';
import { errorMessage } from '../../api/client';
import {
  useAIExplain,
  useGenerateRecommendations,
  usePatchRecommendation,
  useRecommendations,
} from '../../api/hooks';
import type { Recommendation, Severity } from '../../api/types';
import { fmt } from '../../lib/format';
import { useUIStore } from '../../stores/ui';
import { Alert, Badge, Button, Collapsible, EmptyState, Panel, cx } from '../ui';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_STYLE: Record<Severity, { border: string; badge: 'red' | 'orange' | 'yellow' | 'blue' | 'slate' }> = {
  critical: { border: 'border-l-red-500', badge: 'red' },
  high: { border: 'border-l-orange-500', badge: 'orange' },
  medium: { border: 'border-l-yellow-500', badge: 'yellow' },
  low: { border: 'border-l-blue-500', badge: 'blue' },
  info: { border: 'border-l-slate-500', badge: 'slate' },
};

export default function Step5Recommendations({ projectId }: { projectId: string }) {
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const { data: recs } = useRecommendations(projectId, selectedMeshId ?? undefined);
  const generateMutation = useGenerateRecommendations(projectId);
  const explainMutation = useAIExplain(projectId);

  const sorted = useMemo(
    () =>
      [...(recs ?? [])].sort(
        (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
      ),
    [recs],
  );

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Recommendations"
        actions={
          <Button
            variant="primary"
            disabled={!selectedMeshId || generateMutation.isPending}
            onClick={() => selectedMeshId && generateMutation.mutate(selectedMeshId)}
          >
            {generateMutation.isPending ? 'Generating…' : 'Generate'}
          </Button>
        }
      >
        {generateMutation.isError && (
          <Alert kind="error" title="Generate recommendations failed">
            {errorMessage(generateMutation.error)}
            {String(errorMessage(generateMutation.error)).includes('geometry analysis') && (
              <div className="mt-1">Run geometry analysis in step 1 or 4 first, then retry.</div>
            )}
          </Alert>
        )}
        {sorted.length === 0 && !generateMutation.isError && (
          <EmptyState title="No recommendations yet">
            Requires a completed geometry analysis on the selected mesh version. Click Generate to
            evaluate the rule set (FEA-based rules also run when a result exists).
          </EmptyState>
        )}

        {sorted.length > 0 && (
          <div className="mb-2">
            <Button
              className="!px-2 !py-1 text-[11px]"
              disabled={!selectedMeshId || explainMutation.isPending}
              onClick={() => selectedMeshId && explainMutation.mutate(selectedMeshId)}
            >
              {explainMutation.isPending ? 'Explaining…' : 'Explain (AI)'}
            </Button>
            {explainMutation.isError && (
              <Alert kind="error" title="AI explain failed" className="mt-2">
                {errorMessage(explainMutation.error)}
              </Alert>
            )}
            {explainMutation.data && (
              <div className="mt-2 rounded border border-slate-700 bg-slate-900/60 p-2 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <Badge color="sky">provider: {explainMutation.data.provider}</Badge>
                </div>
                <div className="whitespace-pre-wrap text-slate-300">{explainMutation.data.text}</div>
                <div className="mt-1 text-[10px] text-slate-500">{explainMutation.data.note}</div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {sorted.map((r) => (
            <RecCard key={r.id} rec={r} projectId={projectId} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function RecCard({ rec, projectId }: { rec: Recommendation; projectId: string }) {
  const patchMutation = usePatchRecommendation(projectId);
  const requestFlyTo = useUIStore((s) => s.requestFlyTo);
  const setHighlightTriangles = useUIStore((s) => s.setHighlightTriangles);
  const [patchError, setPatchError] = useState<string | null>(null);
  const style = SEVERITY_STYLE[rec.severity] ?? SEVERITY_STYLE.info;

  const centroid = rec.location?.centroid;
  const hasLocation = Array.isArray(centroid) && centroid.length === 3;

  const focus = () => {
    if (hasLocation) {
      requestFlyTo([centroid[0], centroid[1], centroid[2]]);
    }
    const tris = rec.location?.triangle_indices;
    setHighlightTriangles(Array.isArray(tris) && tris.length ? (tris as number[]) : null);
  };

  return (
    <div
      className={cx(
        'rounded border border-slate-700 border-l-4 bg-slate-900/50 p-2 text-xs',
        style.border,
        rec.state === 'dismissed' && 'opacity-50',
        hasLocation && 'cursor-pointer hover:border-slate-500',
      )}
      onClick={focus}
      title={hasLocation ? 'Click to fly the camera to this finding' : undefined}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-slate-100">{rec.title}</span>
        <Badge color={style.badge}>{rec.severity}</Badge>
        <Badge color="slate" title="Rule confidence">
          confidence: {rec.confidence}
        </Badge>
        {rec.auto_generatable && (
          <Badge color="green" title="A variant operation can be generated automatically">
            auto-generatable
          </Badge>
        )}
        {rec.state !== 'open' && <Badge color={rec.state === 'accepted' ? 'sky' : 'slate'}>{rec.state}</Badge>}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-slate-500">{rec.rule_id}</div>
      <p className="mt-1 text-slate-300">{rec.problem}</p>

      {Object.keys(rec.evidence ?? {}).length > 0 && (
        <div className="mt-1.5 rounded bg-slate-800/80 p-1.5">
          <div className="mb-0.5 font-medium text-slate-400">Evidence</div>
          {Object.entries(rec.evidence).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-slate-500">{k.replace(/_/g, ' ')}</span>
              <span className="font-mono text-slate-300">
                {typeof v === 'number' ? fmt(v, 4) : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}

      {rec.rationale && (
        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
          <Collapsible label="Rationale">{rec.rationale}</Collapsible>
        </div>
      )}

      {rec.proposed_change && (
        <div className="mt-1.5">
          <span className="font-medium text-sky-300">Proposed change: </span>
          <span className="text-slate-300">{rec.proposed_change}</span>
        </div>
      )}

      <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
        <Collapsible label="Details (benefit / downside / manufacturing / validation)">
          {rec.expected_benefit && (
            <p>
              <b>Expected benefit:</b> {rec.expected_benefit}
            </p>
          )}
          {rec.possible_downside && (
            <p>
              <b>Possible downside:</b> {rec.possible_downside}
            </p>
          )}
          {rec.manufacturing_impact && (
            <p>
              <b>Manufacturing impact:</b> {rec.manufacturing_impact}
            </p>
          )}
          {rec.validation_required && (
            <p>
              <b>Validation required:</b> {rec.validation_required}
            </p>
          )}
        </Collapsible>
      </div>

      {rec.assumptions.length > 0 && (
        <div className="mt-1.5 border-t border-slate-700/60 pt-1 text-[10px] text-slate-500">
          Assumptions: {rec.assumptions.join('; ')}
        </div>
      )}

      <div className="mt-1.5 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button
          className="!px-2 !py-0.5 text-[11px]"
          variant={rec.state === 'accepted' ? 'primary' : 'secondary'}
          onClick={() =>
            patchMutation.mutate(
              { id: rec.id, state: rec.state === 'accepted' ? 'open' : 'accepted' },
              { onError: (e) => setPatchError(errorMessage(e)) },
            )
          }
        >
          {rec.state === 'accepted' ? 'Accepted ✓' : 'Accept'}
        </Button>
        <Button
          className="!px-2 !py-0.5 text-[11px]"
          onClick={() =>
            patchMutation.mutate(
              { id: rec.id, state: rec.state === 'dismissed' ? 'open' : 'dismissed' },
              { onError: (e) => setPatchError(errorMessage(e)) },
            )
          }
        >
          {rec.state === 'dismissed' ? 'Reopen' : 'Dismiss'}
        </Button>
      </div>
      {patchError && (
        <Alert kind="error" title="Update failed" className="mt-1.5">
          {patchError}
        </Alert>
      )}
    </div>
  );
}

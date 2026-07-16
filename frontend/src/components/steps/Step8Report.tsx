import { apiUrl, errorMessage } from '../../api/client';
import {
  useCapabilities,
  useGenerateReport,
  useMeshes,
  useReports,
  useResults,
  useVariants,
} from '../../api/hooks';
import { fmtDate, shortSha } from '../../lib/format';
import { useUIStore } from '../../stores/ui';
import { Alert, Badge, Button, EmptyState, Panel } from '../ui';

export default function Step8Report({ projectId }: { projectId: string }) {
  const { data: caps } = useCapabilities();
  const { data: meshes } = useMeshes(projectId);
  const { data: variants } = useVariants(projectId);
  const { data: results } = useResults(projectId);
  const { data: reports } = useReports(projectId);
  const selectedMeshId = useUIStore((s) => s.selectedMeshId);
  const reportMutation = useGenerateReport(projectId);

  const originals = (meshes ?? []).filter((m) => m.kind === 'original');
  const repaired = (meshes ?? []).filter((m) => m.kind === 'repaired');
  const succeededVariants = (variants ?? []).filter((v) => v.status === 'succeeded' && v.result_mesh_id);

  const linkCls = 'text-sky-300 hover:underline';

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="PDF report"
        actions={
          <Button
            variant="primary"
            disabled={reportMutation.isPending}
            onClick={() => reportMutation.mutate(selectedMeshId)}
          >
            {reportMutation.isPending ? 'Submitting…' : 'Generate PDF report'}
          </Button>
        }
      >
        {reportMutation.isError && (
          <Alert kind="error" title="Report generation failed" className="mb-2">
            {errorMessage(reportMutation.error)}
          </Alert>
        )}
        {reportMutation.isSuccess && (
          <div className="mb-2 text-xs text-slate-400">
            Report job submitted — the download link appears below when it finishes.
          </div>
        )}
        {(reports ?? []).length === 0 ? (
          <EmptyState title="No reports yet">
            Generate one — it bundles geometry metrics, material assumptions, load cases, FEA
            summaries, recommendations and attached snapshots.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {reports!.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded bg-slate-900/50 px-2 py-1.5">
                <span className="text-slate-300">
                  {fmtDate(r.created_at)}{' '}
                  <span className="font-mono text-slate-500">{shortSha(r.sha256)}</span>
                </span>
                <a className={linkCls} href={apiUrl(`/reports/${r.id}/file`)}>
                  Download PDF
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 text-[11px] text-slate-500">
          Snapshots: use the viewer's Screenshot → “Attach to report” button. Attached snapshots are
          embedded in future reports (the two most recent are used).
        </div>
      </Panel>

      <Panel title="Geometry downloads">
        <ul className="flex flex-col gap-1 text-xs">
          {originals.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded bg-slate-900/50 px-2 py-1.5">
              <span className="truncate text-slate-300">
                <Badge color="sky" className="mr-1.5">original</Badge>
                {m.label || m.id}
              </span>
              <a className={linkCls} href={apiUrl(`/meshes/${m.id}/file`)}>
                STL
              </a>
            </li>
          ))}
          {repaired.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded bg-slate-900/50 px-2 py-1.5">
              <span className="truncate text-slate-300">
                <Badge color="green" className="mr-1.5">repaired</Badge>
                {m.label || m.id}
              </span>
              <a className={linkCls} href={apiUrl(`/meshes/${m.id}/file`)}>
                STL
              </a>
            </li>
          ))}
          {succeededVariants.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 rounded bg-slate-900/50 px-2 py-1.5">
              <span className="truncate text-slate-300">
                <Badge color="purple" className="mr-1.5">variant</Badge>
                {v.name}
              </span>
              <span className="flex shrink-0 gap-2">
                <a className={linkCls} href={apiUrl(`/meshes/${v.result_mesh_id}/file`)}>
                  STL
                </a>
                <a className={linkCls} href={apiUrl(`/variants/${v.id}/recipe`)} target="_blank" rel="noreferrer">
                  Recipe JSON
                </a>
              </span>
            </li>
          ))}
          {(meshes ?? []).length === 0 && (
            <li className="text-slate-500">No meshes yet — upload one in step 1.</li>
          )}
        </ul>
        <a
          className="mt-2 inline-block rounded bg-slate-700 px-2.5 py-1.5 text-xs text-slate-100 hover:bg-slate-600"
          href={apiUrl(`/projects/${projectId}/archive`)}
        >
          Download project archive (ZIP)
        </a>
        <div className="mt-1 text-[11px] text-slate-500">
          ZIP contains a manifest, every mesh version and all finished PDF reports.
        </div>
      </Panel>

      <Panel title="Solver artifacts">
        {(results ?? []).length === 0 ? (
          <EmptyState title="No FEA results">Run FEA in step 4 to get solver decks and logs.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {results!.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded bg-slate-900/50 px-2 py-1.5">
                <span className="text-slate-300">
                  {fmtDate(r.created_at)}
                  {r.is_mock && <Badge color="amber" className="ml-1.5">demo mock</Badge>}
                </span>
                <span className="flex shrink-0 gap-2">
                  <a className={linkCls} href={apiUrl(`/results/${r.id}/deck`)}>
                    CalculiX deck
                  </a>
                  <a className={linkCls} href={apiUrl(`/results/${r.id}/log`)}>
                    Solver log
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="What these exports are">
        <ul className="list-disc space-y-1 pl-4 text-xs text-slate-400">
          <li>
            <b className="text-slate-300">STL</b> — tessellated (triangle) geometry, exactly what
            the analyses ran on.
          </li>
          <li>
            <b className="text-slate-300">Recipe JSON</b> — the exact validated operations that
            produced a variant, for replay in other tools.
          </li>
          <li>
            <b className="text-slate-300">No STEP export</b> —{' '}
            {caps?.step_export_note ??
              'STEP requires a parametric solid (B-rep); this tool modifies tessellated geometry, so no true solid exists to export.'}
          </li>
        </ul>
      </Panel>
    </div>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { API_BASE, errorMessage } from '../api/client';
import { getJobRequest, invalidateForJobKind, useCancelJob, useJobs, useRetryJob } from '../api/hooks';
import type { Job } from '../api/types';
import { fmtPct } from '../lib/format';
import { Badge, ProgressBar, Spinner, cx } from './ui';

const KIND_LABELS: Record<string, string> = {
  geometry_analysis: 'Geometry analysis',
  fea: 'FEA',
  variant_generation: 'Variant generation',
  report: 'Report',
};

const STATUS_COLORS: Record<string, 'slate' | 'sky' | 'green' | 'red' | 'amber'> = {
  pending: 'slate',
  running: 'sky',
  succeeded: 'green',
  failed: 'red',
  cancelled: 'amber',
};

const ACTIVE = new Set(['pending', 'running']);

/**
 * Bottom bar: live background-job list. Jobs stream over SSE
 * (GET /jobs/{id}/events); if the stream fails we fall back to 1.5 s polling.
 * Progress values come straight from the API — no fake animation.
 */
export default function JobsBar({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [sseFailed, setSseFailed] = useState(false);
  const jobsQuery = useJobs(projectId, sseFailed ? 1500 : 5000);
  const jobs = jobsQuery.data ?? [];
  const active = jobs.filter((j) => ACTIVE.has(j.status));
  const cancelMutation = useCancelJob(projectId);
  const retryMutation = useRetryJob(projectId);
  const sources = useRef(new Map<string, EventSource>());
  const prevStatuses = useRef(new Map<string, string>());

  // invalidate dependent queries when a job reaches a terminal state
  useEffect(() => {
    for (const j of jobs) {
      const prev = prevStatuses.current.get(j.id);
      if (prev && ACTIVE.has(prev) && !ACTIVE.has(j.status)) {
        invalidateForJobKind(qc, j.kind);
      }
      prevStatuses.current.set(j.id, j.status);
    }
  }, [jobs, qc]);

  // SSE per active job
  useEffect(() => {
    const activeIds = new Set(active.map((j) => j.id));
    // close streams for finished jobs
    for (const [id, es] of sources.current) {
      if (!activeIds.has(id)) {
        es.close();
        sources.current.delete(id);
      }
    }
    for (const id of activeIds) {
      if (sources.current.has(id)) continue;
      const es = new EventSource(`${API_BASE}/jobs/${id}/events`);
      es.onmessage = (ev) => {
        try {
          const job = JSON.parse(ev.data) as Job;
          qc.setQueryData<Job[]>(['jobs', projectId], (old) =>
            old ? old.map((j) => (j.id === job.id ? job : j)) : old,
          );
          if (!ACTIVE.has(job.status)) {
            es.close();
            sources.current.delete(id);
          }
        } catch {
          /* ignore malformed event */
        }
      };
      es.onerror = () => {
        setSseFailed(true);
        es.close();
        sources.current.delete(id);
      };
      sources.current.set(id, es);
    }
  }, [active, projectId, qc]);

  useEffect(() => {
    const map = sources.current;
    return () => {
      for (const es of map.values()) es.close();
      map.clear();
    };
  }, [projectId]);

  const shown = jobs.slice(0, 8);

  return (
    <div
      className="flex h-16 items-center gap-2 overflow-x-auto border-t px-3 backdrop-blur-md"
      style={{ background: 'var(--lab-panel)', borderColor: 'var(--lab-border)' }}
    >
      <div className="flex shrink-0 flex-col items-start gap-0.5 pr-3">
        <span className="label-tech flex items-center gap-1.5">
          {active.length > 0 ? <Spinner className="h-3 w-3" /> : <span className="led bg-current text-slate-600" />}
          Operations
        </span>
        <span className="font-mono text-[10px] text-slate-600">
          {active.length > 0 ? `${active.length} running` : 'idle'}
          {sseFailed && (
            <span title="SSE stream unavailable; polling every 1.5 s"> · polling</span>
          )}
        </span>
      </div>
      {shown.length === 0 && <span className="text-xs text-slate-500">No background jobs yet.</span>}
      {shown.map((j) => (
        <div
          key={j.id}
          className={cx(
            'lab-panel-raised flex w-64 shrink-0 flex-col gap-1 !rounded-md px-2 py-1.5',
            j.status === 'failed' && '!border-red-500/40',
            j.status === 'running' && '!border-sky-500/30',
          )}
        >
          <div className="flex items-center justify-between gap-1 text-[11px]">
            <span className="truncate font-medium text-slate-200">
              {KIND_LABELS[j.kind] ?? j.kind}
            </span>
            <div className="flex items-center gap-1">
              <Badge color={STATUS_COLORS[j.status] ?? 'slate'}>{j.status}</Badge>
              {ACTIVE.has(j.status) && (
                <button
                  className="text-slate-500 hover:text-red-300"
                  title="Cancel job"
                  onClick={() => cancelMutation.mutate(j.id)}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          {ACTIVE.has(j.status) && (
            <>
              <ProgressBar value={j.progress} />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span className="truncate">{j.message || '…'}</span>
                <span className="font-mono">{fmtPct(j.progress, 0)}</span>
              </div>
            </>
          )}
          {j.status === 'failed' && (
            <div className="flex items-center justify-between gap-1 text-[10px]">
              <span className="truncate text-red-300" title={j.error ?? undefined}>
                {j.error ?? 'failed'}
              </span>
              {getJobRequest(j.id) && (
                <button
                  className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-slate-200 hover:bg-slate-600"
                  onClick={() =>
                    retryMutation.mutate(j.id, {
                      onError: (err) => alert(errorMessage(err)),
                    })
                  }
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {j.status === 'succeeded' && (
            <div className="truncate text-[10px] text-slate-500">{j.message || 'done'}</div>
          )}
        </div>
      ))}
    </div>
  );
}

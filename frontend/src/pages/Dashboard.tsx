import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { errorMessage } from '../api/client';
import { useCapabilities, useCreateDemo, useCreateProject, useDeleteProject, useProjects } from '../api/hooks';
import { fmtDate } from '../lib/format';
import { Alert, Badge, Button, Field, Panel, Spinner, inputCls } from '../components/ui';

const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(255, 'Max 255 characters'),
  description: z.string().max(5000, 'Max 5000 characters'),
});

export default function Dashboard() {
  const { data: projects, isLoading, error } = useProjects();
  const { data: caps } = useCapabilities();
  const createMutation = useCreateProject();
  const demoMutation = useCreateDemo();
  const deleteMutation = useDeleteProject();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formErrors, setFormErrors] = useState<{ name?: string; description?: string }>({});

  const submit = () => {
    const parsed = projectSchema.safeParse({ name, description });
    if (!parsed.success) {
      const errs: { name?: string; description?: string } = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as 'name' | 'description';
        errs[k] = issue.message;
      }
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    createMutation.mutate(parsed.data, {
      onSuccess: (p) => navigate(`/p/${p.id}/upload`),
    });
  };

  return (
    <div className="min-h-full">
      <header
        className="flex items-center justify-between border-b px-5 py-3 backdrop-blur-md"
        style={{ background: 'var(--lab-panel)', borderColor: 'var(--lab-border)' }}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded border border-sky-500/50 bg-sky-500/10 font-mono text-[15px] font-bold text-sky-400 shadow-glow-cyan-soft">
            ⌬
          </span>
          <h1 className="font-display text-lg font-semibold tracking-wide text-slate-100">
            PartForge <span className="text-sky-400">AI</span>
          </h1>
          <span className="label-tech hidden md:block">
            Engineering laboratory · STL analysis · preliminary FEA · design variants
          </span>
        </div>
        <div className="flex items-center gap-3">
          {caps && (
            <Badge color={caps.fea_available ? 'green' : 'amber'}>
              {caps.fea_available ? 'FEA solver online' : 'FEA solver offline'}
            </Badge>
          )}
          <Link to="/settings" className="label-tech transition-colors hover:text-sky-300">
            Settings
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        <div
          className="mb-8 rounded-lg border px-6 py-5"
          style={{
            borderColor: 'var(--lab-border)',
            background:
              'radial-gradient(600px 200px at 20% 0%, rgba(35,213,255,0.08), transparent 70%), ' +
              'radial-gradient(500px 220px at 85% 110%, rgba(139,92,255,0.07), transparent 70%), var(--lab-panel)',
          }}
        >
          <div className="label-tech mb-1.5">Digital engineering laboratory</div>
          <h2 className="font-display text-xl font-semibold text-slate-100">
            Place a component on the bench. Inspect it, test it, evolve it.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Upload an STL, confirm its units, declare material and loads, then run geometry
            diagnostics and preliminary finite-element analysis. Evidence-based recommendations
            drive automatic design variants you can compare and export. Every number comes from
            deterministic analysis — assumptions and validity gates are always shown.
          </p>
        </div>
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="New project">
            <div className="flex flex-col gap-2.5">
              <Field label="Name">
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Motor mount bracket"
                />
                {formErrors.name && <span className="text-xs text-red-400">{formErrors.name}</span>}
              </Field>
              <Field label="Description">
                <textarea
                  className={inputCls}
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this part for?"
                />
                {formErrors.description && (
                  <span className="text-xs text-red-400">{formErrors.description}</span>
                )}
              </Field>
              <div>
                <Button variant="primary" onClick={submit} disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create project'}
                </Button>
              </div>
              {createMutation.isError && (
                <Alert kind="error" title="Create project failed">
                  {errorMessage(createMutation.error)}
                </Alert>
              )}
            </div>
          </Panel>

          <Panel title="Demo">
            <p className="mb-3 text-xs text-slate-400">
              Loads a seeded demo bracket project with geometry analysis already run. FEA and
              variant generation are submitted as background jobs — watch the job bar.
            </p>
            <Button
              onClick={() =>
                demoMutation.mutate(undefined, {
                  onSuccess: (r) => navigate(`/p/${r.project.id}/upload`),
                })
              }
              disabled={demoMutation.isPending}
            >
              {demoMutation.isPending ? 'Loading demo…' : 'Load demo project'}
            </Button>
            {demoMutation.isError && (
              <Alert kind="error" title="Demo failed" className="mt-2">
                {errorMessage(demoMutation.error)}
              </Alert>
            )}
          </Panel>
        </div>

        <h2 className="mb-3 text-sm font-semibold text-slate-300">Projects</h2>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner /> Loading projects…
          </div>
        )}
        {error != null && (
          <Alert kind="error" title="Failed to load projects">
            {errorMessage(error)}
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {projects?.map((p) => (
            <div
              key={p.id}
              className="group relative rounded-lg border border-slate-700/70 bg-slate-800 p-3 transition-colors hover:border-sky-500/50"
            >
              <Link to={`/p/${p.id}/upload`} className="block">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-100">{p.name}</span>
                  {p.is_demo && <Badge color="purple">demo</Badge>}
                  {p.unit_confirmed ? (
                    <Badge color="green">{p.unit}</Badge>
                  ) : (
                    <Badge color="amber">units?</Badge>
                  )}
                </div>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">{p.description}</p>
                )}
                <div className="mt-2 text-[11px] text-slate-500">Updated {fmtDate(p.updated_at)}</div>
              </Link>
              <button
                title="Delete project"
                className="absolute right-2 top-2 hidden text-slate-500 hover:text-red-400 group-hover:block"
                onClick={() => {
                  if (confirm(`Delete project "${p.name}"? This cannot be undone.`)) {
                    deleteMutation.mutate(p.id);
                  }
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {projects && projects.length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
              No projects yet — create one or load the demo.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

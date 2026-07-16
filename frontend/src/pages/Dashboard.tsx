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
      <header className="flex items-center justify-between border-b border-slate-700/70 bg-slate-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-sky-400">PartForge AI</h1>
          <span className="text-xs text-slate-500">
            STL analysis · preliminary FEA · design variants
          </span>
        </div>
        <div className="flex items-center gap-3">
          {caps && (
            <Badge color={caps.fea_available ? 'green' : 'amber'}>
              {caps.fea_available ? 'FEA: available' : 'FEA: solver not installed'}
            </Badge>
          )}
          <Link to="/settings" className="text-sm text-slate-400 hover:text-sky-300">
            Settings
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">
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

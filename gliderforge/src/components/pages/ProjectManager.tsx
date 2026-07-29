"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../client";
import { Card, TextInput, SelectInput, Checkbox, Badge, ErrorNotice, Spinner, EmptyState } from "../ui";
import { PROJECT_PHASES } from "@/lib/project/settings";

interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phase: string;
  is_sample: number;
  updated_at: string;
}

export function ProjectManager({ projects, activeId }: { projects: ProjectSummary[]; activeId: string | null }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [phase, setPhase] = React.useState<string>("concept");
  const [starterRisks, setStarterRisks] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const activate = (id: string) => {
    document.cookie = `gf_project=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}

      <Card title="Create a project">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Project name"
            value={name}
            onChange={setName}
            required
            placeholder="e.g. Senior Design — Lab Glider"
            hint="Used on every generated report."
          />
          <SelectInput
            label="Starting phase"
            value={phase}
            onChange={setPhase}
            options={PROJECT_PHASES.map((p) => ({ value: p.id, label: p.label }))}
            hint="You can change this at any time; it only affects the dashboard framing."
          />
        </div>
        <div className="mt-3">
          <TextInput
            label="Description"
            value={description}
            onChange={setDescription}
            multiline
            rows={2}
            placeholder="What the vehicle is for and where it will be tested."
          />
        </div>
        <div className="mt-3">
          <Checkbox
            label="Pre-populate the risk register with common underwater-glider risks"
            checked={starterRisks}
            onChange={setStarterRisks}
            hint="They are inserted as unreviewed starter examples and are flagged as such until you edit and accept each one."
          />
        </div>
        <div className="mt-4 flex gap-2">
          <button
            className="gf-btn gf-btn-primary"
            disabled={!name.trim() || busy !== null}
            onClick={() =>
              run("create", async () => {
                const { project } = await api.createProject({
                  name: name.trim(),
                  description: description.trim() || undefined,
                  phase,
                  includeStarterRisks: starterRisks,
                });
                setName("");
                setDescription("");
                activate(String(project.id));
                router.push("/settings");
              })
            }
          >
            {busy === "create" ? <Spinner label="Creating…" /> : "Create project"}
          </button>
          <button
            className="gf-btn"
            disabled={busy !== null}
            onClick={() =>
              run("sample", async () => {
                const { project } = await api.createSample();
                activate(String(project.id));
                router.push("/");
              })
            }
          >
            {busy === "sample" ? <Spinner label="Building…" /> : "Load the demonstration project"}
          </button>
        </div>
      </Card>

      <Card title={`Existing projects (${projects.length})`}>
        {projects.length === 0 ? (
          <EmptyState title="No projects yet" body="Create one above, or load the demonstration project to explore the workflow first." />
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 rounded border p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{p.name}</span>
                    {p.id === activeId && <Badge tone="accent">active</Badge>}
                    {p.is_sample === 1 && <Badge tone="warning">demonstration data</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {PROJECT_PHASES.find((x) => x.id === p.phase)?.label ?? p.phase} · updated {p.updated_at.slice(0, 16).replace("T", " ")}
                  </p>
                  {p.description && <p className="mt-1 max-w-2xl text-xs leading-snug text-muted">{p.description}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {p.id !== activeId && (
                    <button className="gf-btn" onClick={() => activate(p.id)}>
                      Open
                    </button>
                  )}
                  <a className="gf-btn" href={`/api/projects/${p.id}/export`} download>
                    Export JSON
                  </a>
                  {confirmDelete === p.id ? (
                    <>
                      <button
                        className="gf-btn border-[#d03b3b] text-[#d03b3b]"
                        disabled={busy !== null}
                        onClick={() =>
                          run("delete", async () => {
                            await api.deleteProject(p.id);
                            setConfirmDelete(null);
                            router.refresh();
                          })
                        }
                      >
                        Delete permanently
                      </button>
                      <button className="gf-btn" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="gf-btn" onClick={() => setConfirmDelete(p.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {confirmDelete && (
          <p className="mt-3 rounded border border-[#d03b3b] p-2 text-xs text-muted">
            Deleting a project removes every component, requirement, test, calculation snapshot and notebook entry it contains, and this
            cannot be undone. Export the project first if you might want it back.
          </p>
        )}
      </Card>

      <Card title="Backup and restore">
        <p className="text-xs leading-relaxed text-muted">
          <strong className="text-ink">Export</strong> downloads the complete project as JSON — every table, with all values in SI base
          units. Keep a copy before a major change or before a design review; it is the only backup this application makes for you.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          The database itself lives at the path in <code className="rounded bg-surface px-1">GLIDERFORGE_DB</code> (
          <code className="rounded bg-surface px-1">./data/gliderforge.db</code> by default). Copying that file copies every project at
          once.
        </p>
      </Card>
    </div>
  );
}

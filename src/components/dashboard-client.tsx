"use client";

import Link from "next/link";
import {
  Activity,
  Bookmark,
  CheckCircle2,
  DollarSign,
  GraduationCap,
  Hammer,
  Play,
  ShoppingCart,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectCard } from "@/components/project-card";
import { ProgressBar } from "@/components/progress-bar";
import { EmptyState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/lib/store/store";
import { PROJECT_BY_ID } from "@/lib/seed/projects";
import { formatCents } from "@/lib/format";
import {
  estimatedMoneySavedCents,
  progressPercent,
} from "@/lib/progress";
import { remainingItemCount } from "@/lib/shopping";
import type { Project, UserProject } from "@/lib/types";

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function InProgressRow({
  userProject,
  project,
}: {
  userProject: UserProject;
  project: Project;
}) {
  const percent = progressPercent(userProject.steps);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{project.title}</h3>
            <Badge variant="muted">{project.steps.length} steps</Badge>
          </div>
          <div className="mt-2">
            <ProgressBar
              value={percent}
              completed={userProject.steps.filter((s) => s.completed).length}
              total={project.steps.length}
            />
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link href={`/projects/${project.slug}/guide`}>
            <Play className="h-4 w-4" aria-hidden="true" /> Resume
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function DashboardClient() {
  const { hydrated, data } = useAppStore();

  if (!hydrated) {
    return (
      <div className="container py-8">
        <Skeleton className="h-9 w-48" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  const inProgress = data.userProjects
    .filter((up) => up.status === "in_progress")
    .map((up) => ({ up, project: PROJECT_BY_ID[up.projectId] }))
    .filter((x): x is { up: UserProject; project: Project } => Boolean(x.project))
    .sort((a, b) => b.up.updatedAt.localeCompare(a.up.updatedAt));

  const completed = data.userProjects
    .filter((up) => up.status === "completed")
    .map((up) => PROJECT_BY_ID[up.projectId])
    .filter((p): p is Project => Boolean(p));

  const saved = data.savedProjects
    .map((s) => PROJECT_BY_ID[s.projectId])
    .filter((p): p is Project => Boolean(p));

  const moneySaved = estimatedMoneySavedCents(completed);
  const skills = Array.from(
    new Set(completed.flatMap((p) => p.skillPrerequisites)),
  );
  const shoppingRemaining = remainingItemCount(data.shoppingList?.items ?? []);

  const recentActivity = [...data.userProjects]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold">Your dashboard</h1>
      <p className="text-muted-foreground">
        Track progress, resume projects, and see what you&apos;ve accomplished.
      </p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Trophy className="h-5 w-5" />}
          value={String(completed.length)}
          label="Projects completed"
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5" />}
          value={`~${formatCents(moneySaved)}`}
          label="Estimated saved"
        />
        <StatCard
          icon={<GraduationCap className="h-5 w-5" />}
          value={String(skills.length)}
          label="Skills learned"
        />
        <StatCard
          icon={<ShoppingCart className="h-5 w-5" />}
          value={String(shoppingRemaining)}
          label="Items to buy"
        />
      </div>

      {/* In progress */}
      <section className="mt-10" aria-labelledby="in-progress-heading">
        <h2 id="in-progress-heading" className="mb-3 text-xl font-semibold">
          In progress
        </h2>
        {inProgress.length > 0 ? (
          <div className="space-y-3">
            {inProgress.map(({ up, project }) => (
              <InProgressRow key={up.id} userProject={up} project={project} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Hammer className="h-8 w-8" />}
            title="Nothing in progress"
            description="Start a project and it will show up here so you can pick up where you left off."
            action={
              <Button asChild>
                <Link href="/projects">Find a project</Link>
              </Button>
            }
          />
        )}
      </section>

      {/* Skills learned */}
      {skills.length > 0 ? (
        <section className="mt-10" aria-labelledby="skills-heading">
          <h2 id="skills-heading" className="mb-3 text-xl font-semibold">
            Skills you&apos;ve learned
          </h2>
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <Badge key={skill} variant="secondary">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {skill}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {/* Completed */}
      {completed.length > 0 ? (
        <section className="mt-10" aria-labelledby="completed-heading">
          <h2 id="completed-heading" className="mb-3 text-xl font-semibold">
            Completed projects
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {completed.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Saved */}
      <section className="mt-10" aria-labelledby="saved-heading">
        <h2
          id="saved-heading"
          className="mb-3 flex items-center gap-2 text-xl font-semibold"
        >
          <Bookmark className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Saved projects
        </h2>
        {saved.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Bookmark className="h-8 w-8" />}
            title="No saved projects"
            description="Tap Save on any project to keep it here for later."
          />
        )}
      </section>

      {/* Recent activity + notes */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length > 0 ? (
              <ul className="space-y-2">
                {recentActivity.map((up) => {
                  const project = PROJECT_BY_ID[up.projectId];
                  if (!project) return null;
                  return (
                    <li
                      key={up.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <Link
                        href={`/projects/${project.slug}`}
                        className="truncate hover:underline"
                      >
                        {project.title}
                      </Link>
                      <span className="shrink-0 text-muted-foreground">
                        {up.status === "completed"
                          ? "Completed"
                          : `${progressPercent(up.steps)}%`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your notes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.notes.length > 0 ? (
              <ul className="space-y-3">
                {data.notes.slice(0, 4).map((note) => {
                  const project = PROJECT_BY_ID[note.projectId];
                  return (
                    <li key={note.id} className="rounded-lg border p-3">
                      {project ? (
                        <Link
                          href={`/projects/${project.slug}`}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          {project.title}
                        </Link>
                      ) : null}
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {note.body}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Notes you add to projects will appear here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

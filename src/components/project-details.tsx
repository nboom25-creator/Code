"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertOctagon,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Clock,
  DollarSign,
  ListChecks,
  PhoneCall,
  Play,
  ShoppingCart,
  Timer,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DifficultyBadge } from "@/components/difficulty-badge";
import { SafetyBadge } from "@/components/safety-badge";
import { ProjectIllustration } from "@/components/project-illustration";
import { ToolChecklist, MaterialChecklist } from "@/components/checklists";
import { SafetyWarning } from "@/components/safety-warning";
import { ProgressBar } from "@/components/progress-bar";
import { useAppStore } from "@/lib/store/store";
import { CATEGORY_BY_SLUG } from "@/lib/seed/categories";
import { formatCostRange, formatMinutes } from "@/lib/format";
import { progressPercent } from "@/lib/progress";
import type { Project } from "@/lib/types";

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function BulletList({
  items,
  tone = "muted",
}: {
  items: string[];
  tone?: "muted" | "danger";
}) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span
            className={
              tone === "danger"
                ? "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
                : "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            }
            aria-hidden="true"
          />
          <span className={tone === "danger" ? "" : "text-muted-foreground"}>
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ProjectDetails({ project }: { project: Project }) {
  const router = useRouter();
  const {
    hydrated,
    recordView,
    isToolOwned,
    toggleToolOwned,
    isSaved,
    toggleSaved,
    startProject,
    getUserProject,
    addProjectToShoppingList,
  } = useAppStore();

  const [ownedMaterials, setOwnedMaterials] = useState<Set<string>>(new Set());
  const [addedCount, setAddedCount] = useState<number | null>(null);

  useEffect(() => {
    if (hydrated) recordView(project.id);
  }, [hydrated, project.id, recordView]);

  const category = CATEGORY_BY_SLUG[project.category];
  const userProject = getUserProject(project.id);
  const saved = isSaved(project.id);

  const missingCount = useMemo(() => {
    const missingTools = project.tools.filter((t) => !isToolOwned(t.toolId)).length;
    const missingMaterials = project.materials.filter(
      (m) => !ownedMaterials.has(m.materialId),
    ).length;
    return missingTools + missingMaterials;
  }, [project.tools, project.materials, ownedMaterials, isToolOwned]);

  const handleStart = () => {
    startProject(project);
    router.push(`/projects/${project.slug}/guide`);
  };

  const toggleMaterial = (id: string) => {
    setOwnedMaterials((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const elevatedWarnings = project.steps
    .flatMap((s) => s.safetyWarnings)
    .filter((w) => w.level === "elevated");

  return (
    <div className="container py-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/projects" className="hover:text-foreground">
              Projects
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={`/projects?category=${project.category}`}
              className="hover:text-foreground"
            >
              {category.name}
            </Link>
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          {/* Header */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{category.name}</Badge>
              <DifficultyBadge difficulty={project.difficulty} />
              <SafetyBadge level={project.safetyLevel} />
              {project.renterFriendly ? (
                <Badge variant="outline">Renter-friendly</Badge>
              ) : null}
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{project.title}</h1>
            <p className="text-lg text-muted-foreground">{project.description}</p>
          </div>

          <ProjectIllustration
            category={project.category}
            alt={project.imageAlt}
            className="aspect-[16/9] w-full rounded-xl"
            iconClassName="h-20 w-20"
          />

          {/* Professional / permit banner */}
          {project.requiresPermitOrPro ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
            >
              <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <p className="font-semibold">This project may require a professional or permit</p>
                <p className="text-sm text-muted-foreground">
                  {project.permitDisclaimer ??
                    "Check your local codes. When in doubt, hire a licensed pro."}
                </p>
              </div>
            </div>
          ) : project.permitDisclaimer ? (
            <div className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-sm">{project.permitDisclaimer}</p>
            </div>
          ) : null}

          {/* Elevated safety warnings up top, always visible */}
          {elevatedWarnings.length > 0 ? (
            <div className="space-y-3">
              {elevatedWarnings.map((w) => (
                <SafetyWarning key={w.id} warning={w} />
              ))}
            </div>
          ) : null}

          {/* Key info grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <InfoTile
              icon={<Timer className="h-3.5 w-3.5" />}
              label="Active time"
              value={formatMinutes(project.activeMinutes)}
            />
            <InfoTile
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Total time"
              value={formatMinutes(project.totalMinutes)}
            />
            <InfoTile
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="Est. cost"
              value={formatCostRange(
                project.estimatedCostLowCents,
                project.estimatedCostHighCents,
              )}
            />
            <InfoTile
              icon={<Users className="h-3.5 w-3.5" />}
              label="People"
              value={project.recommendedPeople === 1 ? "1 person" : `${project.recommendedPeople} people`}
            />
          </div>

          {/* Prerequisites */}
          {project.skillPrerequisites.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Skills you&apos;ll use</CardTitle>
              </CardHeader>
              <CardContent>
                <BulletList items={project.skillPrerequisites} />
              </CardContent>
            </Card>
          ) : null}

          {/* Tools */}
          <section aria-labelledby="tools-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="tools-heading" className="text-xl font-semibold">
                Tools required
              </h2>
              <span className="text-sm text-muted-foreground">
                Check off what you own
              </span>
            </div>
            <ToolChecklist
              tools={project.tools}
              isOwned={isToolOwned}
              onToggle={toggleToolOwned}
            />
          </section>

          {/* Materials */}
          <section aria-labelledby="materials-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="materials-heading" className="text-xl font-semibold">
                Materials
              </h2>
              <span className="text-sm text-muted-foreground">
                Check off what you have
              </span>
            </div>
            <MaterialChecklist
              materials={project.materials}
              owned={ownedMaterials}
              onToggle={toggleMaterial}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Prices are rough estimates, not live store pricing.
            </p>
          </section>

          {/* Preparation */}
          <Card>
            <CardHeader>
              <CardTitle>Before you start</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Preparation checklist</h3>
                <BulletList items={project.preparation} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Safety equipment</h3>
                <div className="flex flex-wrap gap-2">
                  {project.safetyEquipment.map((eq) => (
                    <Badge key={eq} variant="muted">
                      {eq}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Common mistakes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="h-5 w-5 text-warning" aria-hidden="true" />
                Common mistakes to avoid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BulletList items={project.commonMistakes} />
            </CardContent>
          </Card>

          {/* Do not attempt + call a pro */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertOctagon className="h-5 w-5 text-destructive" aria-hidden="true" />
                  Don&apos;t attempt this if…
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BulletList items={project.doNotAttemptIf} tone="danger" />
              </CardContent>
            </Card>
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PhoneCall className="h-5 w-5 text-destructive" aria-hidden="true" />
                  Call a professional if…
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BulletList items={project.callProfessionalIf} tone="danger" />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Sticky action panel */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <Card>
            <CardContent className="space-y-4 p-5">
              {userProject && userProject.status !== "not_started" ? (
                <div className="space-y-2">
                  <ProgressBar
                    value={progressPercent(userProject.steps)}
                    showLabel={false}
                  />
                  <p className="text-sm text-muted-foreground">
                    {userProject.status === "completed"
                      ? "You completed this project."
                      : "You have this project in progress."}
                  </p>
                  <Button asChild className="w-full" size="lg">
                    <Link href={`/projects/${project.slug}/guide`}>
                      <Play className="h-4 w-4" aria-hidden="true" />
                      {userProject.status === "completed" ? "Review steps" : "Resume project"}
                    </Link>
                  </Button>
                </div>
              ) : (
                <Button onClick={handleStart} className="w-full" size="lg" disabled={!hydrated}>
                  <Play className="h-4 w-4" aria-hidden="true" /> Start Project
                </Button>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => toggleSaved(project.id)}
                  disabled={!hydrated}
                  aria-pressed={saved}
                >
                  {saved ? (
                    <>
                      <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> Saved
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-4 w-4" aria-hidden="true" /> Save
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const added = addProjectToShoppingList(project, ownedMaterials);
                    setAddedCount(added);
                  }}
                  disabled={!hydrated}
                >
                  <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Add list
                </Button>
              </div>

              {addedCount !== null ? (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-md bg-success/10 p-2 text-sm text-success"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {addedCount === 0
                    ? "You already have everything — nothing to buy!"
                    : `Added ${addedCount} missing item${addedCount === 1 ? "" : "s"} to your shopping list.`}
                  {addedCount > 0 ? (
                    <Link href="/shopping-list" className="ml-auto underline">
                      View
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  {missingCount === 0
                    ? "You have everything you need."
                    : `You're missing ${missingCount} item${missingCount === 1 ? "" : "s"}.`}
                </p>
              )}

              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium">{project.steps.length} guided steps</p>
                <p className="text-muted-foreground">
                  Progress saves automatically. Pause and resume anytime.
                </p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

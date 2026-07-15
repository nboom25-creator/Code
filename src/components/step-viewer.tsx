"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Lightbulb,
  LifeBuoy,
  Package,
  PartyPopper,
  PauseCircle,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProgressBar } from "@/components/progress-bar";
import { SafetyWarning } from "@/components/safety-warning";
import { ProjectIllustration } from "@/components/project-illustration";
import { TroubleshootingPanel } from "@/components/troubleshooting-panel";
import { useAppStore } from "@/lib/store/store";
import { MATERIAL_BY_ID, TOOL_BY_ID } from "@/lib/seed/catalog";
import { formatMinutes } from "@/lib/format";
import { progressPercent, stepAcknowledgmentBlocked } from "@/lib/progress";
import type { Project, ProjectStep, UserProject } from "@/lib/types";

function StepResources({ step }: { step: ProjectStep }) {
  if (step.tools.length === 0 && step.materials.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {step.tools.length > 0 ? (
        <div className="rounded-lg border p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Wrench className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Tools for this step
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {step.tools.map((t) => (
              <li key={t.toolId}>{TOOL_BY_ID[t.toolId]?.name ?? t.toolId}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {step.materials.length > 0 ? (
        <div className="rounded-lg border p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Materials for this step
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {step.materials.map((m) => {
              const mat = MATERIAL_BY_ID[m.materialId];
              return (
                <li key={m.materialId}>
                  {m.quantity ? `${m.quantity} × ` : ""}
                  {mat?.name ?? m.materialId}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StepBody({
  project,
  step,
  isCompleted,
  acknowledgedIds,
  onAcknowledge,
  onToggleComplete,
  gateBlocked,
}: {
  project: Project;
  step: ProjectStep;
  isCompleted: boolean;
  acknowledgedIds: string[];
  onAcknowledge: (id: string) => void;
  onToggleComplete: (completed: boolean) => void;
  gateBlocked: boolean;
}) {
  return (
    <div className="space-y-5">
      <ProjectIllustration
        category={project.category}
        alt={step.imageAlt}
        className="h-44 w-full rounded-lg"
        iconClassName="h-12 w-12"
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {formatMinutes(step.estimatedMinutes)}
        </span>
      </div>

      <p className="text-base leading-relaxed">{step.instructions}</p>

      {/* Safety warnings are ALWAYS visible, never behind an expander. */}
      {step.safetyWarnings.length > 0 ? (
        <div className="space-y-3">
          {step.safetyWarnings.map((w) => (
            <SafetyWarning
              key={w.id}
              warning={w}
              acknowledged={acknowledgedIds.includes(w.id)}
              onAcknowledge={
                w.requiresAcknowledgment ? () => onAcknowledge(w.id) : undefined
              }
            />
          ))}
        </div>
      ) : null}

      <StepResources step={step} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Lightbulb className="h-4 w-4 text-primary" aria-hidden="true" /> Beginner tip
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{step.beginnerTip}</p>
        </div>
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <TriangleAlert className="h-4 w-4 text-warning" aria-hidden="true" /> Common mistake
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{step.commonMistake}</p>
        </div>
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="why" className="rounded-lg border px-3">
          <AccordionTrigger>
            <span className="flex items-center gap-1.5">
              <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Why this matters
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground">
            {step.whyItMatters}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <label className="flex items-center gap-3 rounded-lg border bg-card p-4">
        <Checkbox
          checked={isCompleted}
          disabled={gateBlocked && !isCompleted}
          onCheckedChange={(v) => onToggleComplete(v === true)}
          aria-label={`Mark step ${step.order} complete`}
        />
        <span className="font-medium">
          {isCompleted ? "Completed" : "Mark this step complete"}
        </span>
        {gateBlocked && !isCompleted ? (
          <span className="text-sm text-destructive">
            Acknowledge the safety warning first
          </span>
        ) : null}
      </label>
    </div>
  );
}

export function StepViewer({
  project,
  userProject,
}: {
  project: Project;
  userProject: UserProject;
}) {
  const { setStepCompleted, setCurrentStep, acknowledgeWarning } = useAppStore();
  const [viewAll, setViewAll] = useState(false);

  const steps = project.steps;
  const currentIndex = Math.min(userProject.currentStepIndex, steps.length - 1);
  const currentStep = steps[currentIndex];

  const completedMap = useMemo(
    () => new Map(userProject.steps.map((s) => [s.stepId, s.completed])),
    [userProject.steps],
  );
  const percent = progressPercent(userProject.steps);
  const completedCount = userProject.steps.filter((s) => s.completed).length;

  const stepGateBlocked = (step: ProjectStep) =>
    stepAcknowledgmentBlocked(step, userProject.acknowledgedWarnings);

  if (!currentStep) return null;

  const isLast = currentIndex === steps.length - 1;
  const allComplete = completedCount === steps.length;

  const troubleshootingDialog = (stepId: string | null) => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LifeBuoy className="h-4 w-4" aria-hidden="true" /> Troubleshoot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Troubleshooting</DialogTitle>
        </DialogHeader>
        <TroubleshootingPanel project={project} stepId={stepId} />
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      {/* Sticky progress + controls */}
      <div className="sticky top-16 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{project.title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewAll((v) => !v)}
              aria-pressed={viewAll}
            >
              {viewAll ? "One step at a time" : "View all steps"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                <PauseCircle className="h-4 w-4" aria-hidden="true" /> Pause &amp; save
              </Link>
            </Button>
          </div>
        </div>
        <ProgressBar value={percent} completed={completedCount} total={steps.length} />
      </div>

      {allComplete ? (
        <Card className="border-success/50 bg-success/5">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <PartyPopper className="h-10 w-10 text-success" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Project complete — nice work!</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              You finished every step of {project.title}. Add a note about how it
              went, or head to your dashboard to see it in your completed projects.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href={`/projects/${project.slug}/complete`}>
                  See completion summary
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {viewAll ? (
        <div className="space-y-4">
          {steps.map((step) => {
            const done = completedMap.get(step.id) ?? false;
            return (
              <Card key={step.id} id={`step-${step.order}`}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-lg font-semibold">
                      <Badge variant={done ? "success" : "secondary"}>
                        Step {step.order}
                      </Badge>
                      {step.title}
                    </h3>
                    {troubleshootingDialog(step.id)}
                  </div>
                  <StepBody
                    project={project}
                    step={step}
                    isCompleted={done}
                    acknowledgedIds={userProject.acknowledgedWarnings}
                    onAcknowledge={(id) => acknowledgeWarning(project.id, id)}
                    onToggleComplete={(completed) =>
                      setStepCompleted(project.id, step.id, completed)
                    }
                    gateBlocked={stepGateBlocked(step)}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold sm:text-xl">
                <Badge
                  variant={completedMap.get(currentStep.id) ? "success" : "secondary"}
                >
                  Step {currentStep.order} of {steps.length}
                </Badge>
                {currentStep.title}
              </h2>
              {troubleshootingDialog(currentStep.id)}
            </div>

            <StepBody
              project={project}
              step={currentStep}
              isCompleted={completedMap.get(currentStep.id) ?? false}
              acknowledgedIds={userProject.acknowledgedWarnings}
              onAcknowledge={(id) => acknowledgeWarning(project.id, id)}
              onToggleComplete={(completed) =>
                setStepCompleted(project.id, currentStep.id, completed)
              }
              gateBlocked={stepGateBlocked(currentStep)}
            />

            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(project.id, currentIndex - 1)}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
              </Button>

              {!isLast ? (
                <Button
                  onClick={() => {
                    // Mark current complete when advancing (unless gated).
                    if (
                      !stepGateBlocked(currentStep) &&
                      !completedMap.get(currentStep.id)
                    ) {
                      setStepCompleted(project.id, currentStep.id, true);
                    }
                    setCurrentStep(project.id, currentIndex + 1);
                  }}
                  disabled={stepGateBlocked(currentStep)}
                >
                  Next step <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="success"
                  onClick={() => setStepCompleted(project.id, currentStep.id, true)}
                  disabled={
                    stepGateBlocked(currentStep) ||
                    (completedMap.get(currentStep.id) ?? false)
                  }
                >
                  Finish project
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { StepViewer } from "@/components/step-viewer";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { useAppStore } from "@/lib/store/store";
import { PROJECT_BY_SLUG } from "@/lib/seed/projects";

export function GuideClient({ slug }: { slug: string }) {
  const { hydrated, getUserProject, startProject } = useAppStore();
  const project = PROJECT_BY_SLUG[slug];

  // Auto-start the project if the user arrives here directly.
  useEffect(() => {
    if (hydrated && project && !getUserProject(project.id)) {
      startProject(project);
    }
  }, [hydrated, project, getUserProject, startProject]);

  if (!project) {
    return (
      <div className="container py-16">
        <ErrorState
          title="Project not found"
          description="We couldn't find that project."
          action={
            <Button asChild variant="outline">
              <Link href="/projects">Browse projects</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const userProject = getUserProject(project.id);

  return (
    <div className="min-h-screen">
      {/* Minimal guided-mode top bar */}
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/projects/${project.slug}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Project details
            </Link>
          </Button>
          <Link href="/" aria-label="ProjectPath home">
            <Logo className="text-base" />
          </Link>
          <div className="w-[132px]" aria-hidden="true" />
        </div>
      </div>

      <div className="container max-w-3xl py-6">
        {!hydrated || !userProject ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <StepViewer project={project} userProject={userProject} />
        )}
      </div>
    </div>
  );
}

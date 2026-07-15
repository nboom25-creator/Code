"use client";

import Link from "next/link";
import { Clock, DollarSign, PartyPopper, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NoteEditor } from "@/components/note-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { useAppStore } from "@/lib/store/store";
import { PROJECT_BY_SLUG } from "@/lib/seed/projects";
import { formatCents, formatMinutes } from "@/lib/format";
import { estimatedMoneySavedCents } from "@/lib/progress";

export function CompletionClient({ slug }: { slug: string }) {
  const { hydrated, getUserProject } = useAppStore();
  const project = PROJECT_BY_SLUG[slug];

  if (!project) {
    return (
      <div className="container py-16">
        <ErrorState title="Project not found" />
      </div>
    );
  }

  const userProject = hydrated ? getUserProject(project.id) : undefined;
  const saved = estimatedMoneySavedCents([project]);

  return (
    <div className="container max-w-2xl py-10">
      <Card className="border-success/40 bg-success/5">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
            <Trophy className="h-8 w-8" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold">You did it!</h1>
          <p className="text-muted-foreground">
            You completed <span className="font-medium">{project.title}</span>. That&apos;s
            a real skill you can use again.
          </p>
        </CardContent>
      </Card>

      {!hydrated ? (
        <Skeleton className="mt-6 h-24 w-full" />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
              <PartyPopper className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="text-2xl font-bold">{project.steps.length}</p>
              <p className="text-xs text-muted-foreground">steps completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
              <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="text-2xl font-bold">{formatMinutes(project.activeMinutes)}</p>
              <p className="text-xs text-muted-foreground">of active work</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-1 p-4 text-center">
              <DollarSign className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="text-2xl font-bold">~{formatCents(saved)}</p>
              <p className="text-xs text-muted-foreground">estimated saved</p>
            </CardContent>
          </Card>
        </div>
      )}

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Savings are a rough estimate versus hiring out — not a guarantee.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Add your notes</CardTitle>
        </CardHeader>
        <CardContent>
          <NoteEditor projectId={project.id} />
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/projects">Find your next project</Link>
        </Button>
      </div>

      {hydrated && userProject?.status !== "completed" ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Haven&apos;t finished every step yet?{" "}
          <Link href={`/projects/${project.slug}/guide`} className="underline">
            Return to the guide
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

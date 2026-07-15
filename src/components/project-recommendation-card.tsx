import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DifficultyBadge } from "@/components/difficulty-badge";
import { SafetyBadge } from "@/components/safety-badge";
import { ProjectIllustration } from "@/components/project-illustration";
import { formatCostRange, formatMinutes } from "@/lib/format";
import type { ProjectRecommendation } from "@/lib/types";

export function ProjectRecommendationCard({
  recommendation,
}: {
  recommendation: ProjectRecommendation;
}) {
  const { project, reasons } = recommendation;
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-4 border-b p-4">
        <ProjectIllustration
          category={project.category}
          alt={project.imageAlt}
          className="h-16 w-16 shrink-0 rounded-lg"
          iconClassName="h-7 w-7"
        />
        <div>
          <CardTitle className="text-base">{project.title}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatMinutes(project.totalMinutes)} ·{" "}
            {formatCostRange(
              project.estimatedCostLowCents,
              project.estimatedCostHighCents,
            )}
          </p>
        </div>
      </div>
      <CardHeader className="flex-row flex-wrap gap-1.5 space-y-0 py-3">
        <DifficultyBadge difficulty={project.difficulty} />
        <SafetyBadge level={project.safetyLevel} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div>
          <p className="mb-1 text-sm font-medium">Why it&apos;s a good match</p>
          <ul className="space-y-1">
            {reasons.slice(0, 3).map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-success"
                  aria-hidden="true"
                />
                {reason}
              </li>
            ))}
          </ul>
        </div>
        <Button asChild variant="outline" className="mt-auto w-full">
          <Link href={`/projects/${project.slug}`}>
            View this project <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

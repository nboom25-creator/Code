import Link from "next/link";
import { Clock, DollarSign, Home, ListChecks, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DifficultyBadge } from "@/components/difficulty-badge";
import { SafetyBadge } from "@/components/safety-badge";
import { ProjectIllustration } from "@/components/project-illustration";
import { CATEGORY_BY_SLUG } from "@/lib/seed/categories";
import { formatCostRange, formatMinutes } from "@/lib/format";
import type { Project } from "@/lib/types";

export function ProjectCard({ project }: { project: Project }) {
  const category = CATEGORY_BY_SLUG[project.category];
  return (
    <Card className="group flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
      <Link
        href={`/projects/${project.slug}`}
        className="flex h-full flex-col outline-none"
        aria-label={`View guide: ${project.title}`}
      >
        <div className="relative">
          <ProjectIllustration
            category={project.category}
            alt={project.imageAlt}
            className="h-40 w-full"
            iconClassName="h-14 w-14"
          />
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <Badge variant="secondary">{category.name}</Badge>
          </div>
          {project.renterFriendly ? (
            <div className="absolute right-3 top-3">
              <Badge variant="outline" className="bg-background/90">
                <Home className="h-3 w-3" aria-hidden="true" /> Renter-friendly
              </Badge>
            </div>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <h3 className="font-semibold leading-tight group-hover:text-primary">
              {project.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {project.summary}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <DifficultyBadge difficulty={project.difficulty} />
            <SafetyBadge level={project.safetyLevel} />
          </div>

          <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" aria-hidden="true" />
              <dt className="sr-only">Total time</dt>
              <dd>{formatMinutes(project.totalMinutes)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-4 w-4" aria-hidden="true" />
              <dt className="sr-only">Estimated cost</dt>
              <dd>
                {formatCostRange(
                  project.estimatedCostLowCents,
                  project.estimatedCostHighCents,
                )}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              <dt className="sr-only">Number of steps</dt>
              <dd>{project.steps.length} steps</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Wrench className="h-4 w-4" aria-hidden="true" />
              <dt className="sr-only">Tools needed</dt>
              <dd>{project.tools.length} tools</dd>
            </div>
          </dl>
        </div>
      </Link>
    </Card>
  );
}

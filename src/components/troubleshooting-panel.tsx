"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  PhoneCall,
  Search,
  StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import {
  matchTroubleshooting,
  type TroubleshootingMatch,
} from "@/lib/troubleshooting";
import {
  troubleshootingSchema,
  type TroubleshootingFormValues,
} from "@/lib/validation";
import type { Project, TroubleshootingEntry } from "@/lib/types";

function EntryCard({
  entry,
  matched,
  isPossibleMatch,
}: {
  entry: TroubleshootingEntry;
  matched?: string[];
  isPossibleMatch?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="font-semibold">{entry.symptom}</p>
            {isPossibleMatch ? (
              <p className="text-xs text-muted-foreground">
                Possible match{matched && matched.length > 0 ? ` · matched: ${matched.join(", ")}` : ""}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3 text-sm">
        <Section
          label="Possible causes (not confirmed)"
          icon={<AlertCircle className="h-4 w-4 text-warning" aria-hidden="true" />}
          items={entry.likelyCauses}
        />
        <Section
          label="Safe checks to try"
          icon={<Search className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />}
          items={entry.safeChecks}
        />
        <Section
          label="What usually helps"
          icon={<CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
          items={entry.correctiveActions}
        />
        {entry.stopIf.length > 0 ? (
          <Section
            label="Stop if"
            icon={<StopCircle className="h-4 w-4 text-destructive" aria-hidden="true" />}
            items={entry.stopIf}
          />
        ) : null}
        {entry.callProfessionalIf.length > 0 ? (
          <Section
            label="Call a licensed professional if"
            icon={<PhoneCall className="h-4 w-4 text-destructive" aria-hidden="true" />}
            items={entry.callProfessionalIf}
          />
        ) : null}
      </div>
    </div>
  );
}

function Section({
  label,
  icon,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="flex items-center gap-1.5 font-medium">
        {icon}
        {label}
      </p>
      <ul className="ml-6 mt-1 list-disc space-y-0.5 text-muted-foreground">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Troubleshooting panel. v1 matches the user's free-text description against
 * predefined keyword entries and presents ranked *possibilities* — never a
 * confirmed diagnosis. The matching function is isolated (see
 * `lib/troubleshooting`) so an AI service can replace it later.
 */
export function TroubleshootingPanel({
  project,
  stepId,
}: {
  project: Project;
  stepId?: string | null;
}) {
  const [matches, setMatches] = useState<TroubleshootingMatch[] | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TroubleshootingFormValues>({
    resolver: zodResolver(troubleshootingSchema),
    defaultValues: { description: "" },
  });

  const contextEntries = useMemo(
    () =>
      project.troubleshooting.filter(
        (e) => stepId === undefined || e.stepId === null || e.stepId === stepId,
      ),
    [project.troubleshooting, stepId],
  );

  const onSubmit = (values: TroubleshootingFormValues) => {
    setMatches(matchTroubleshooting(project, values.description, stepId));
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
        <label htmlFor="ts-description" className="text-sm font-medium">
          Describe what you&apos;re seeing
        </label>
        <Textarea
          id="ts-description"
          placeholder="e.g. The shelf looks crooked and tilts to one side"
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? "ts-error" : undefined}
          {...register("description")}
        />
        {errors.description ? (
          <p id="ts-error" className="text-sm text-destructive">
            {errors.description.message}
          </p>
        ) : null}
        <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          These are general possibilities, not a diagnosis of your specific
          situation. When in doubt, stop and ask a professional.
        </div>
        <Button type="submit" size="sm">
          <Search className="h-4 w-4" aria-hidden="true" /> Find suggestions
        </Button>
      </form>

      {matches !== null ? (
        matches.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              {matches.length} possible {matches.length === 1 ? "match" : "matches"}
            </p>
            {matches.map((m) => (
              <EntryCard
                key={m.entry.id}
                entry={m.entry}
                matched={m.matchedKeywords}
                isPossibleMatch
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<HelpCircle className="h-8 w-8" />}
            title="No close match found"
            description="Try describing it differently, or browse the common issues below. If something feels unsafe, stop and consult a professional."
          />
        )
      ) : null}

      {contextEntries.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Badge variant="muted">Common issues</Badge>
          </div>
          {contextEntries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Compass, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectRecommendationCard } from "@/components/project-recommendation-card";
import { EmptyState } from "@/components/states";
import { plannerSchema, type PlannerFormValues } from "@/lib/validation";
import { recommendProjects } from "@/lib/planner";
import { PROJECTS } from "@/lib/seed/projects";
import { TOOLS } from "@/lib/seed/catalog";
import type { Difficulty, ProjectRecommendation } from "@/lib/types";

const TIME_CHOICES = [
  { label: "About 30 minutes", minutes: 30 },
  { label: "An hour or two", minutes: 120 },
  { label: "Half a day", minutes: 240 },
  { label: "A full day or more", minutes: 60 * 10 },
];

const BUDGET_CHOICES = [
  { label: "Under $25", cents: 2500 },
  { label: "Up to $75", cents: 7500 },
  { label: "Up to $200", cents: 20000 },
  { label: "$200+", cents: 50000 },
];

export function PlannerClient() {
  const [results, setResults] = useState<ProjectRecommendation[] | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PlannerFormValues>({
    resolver: zodResolver(plannerSchema),
    defaultValues: {
      goal: "",
      availableMinutes: 120,
      budgetCents: 7500,
      ownedToolIds: [],
      experience: "beginner",
      rentOrOwn: "rent",
      comfortablePlumbingElectrical: false,
    },
  });

  const availableMinutes = watch("availableMinutes");
  const budgetCents = watch("budgetCents");
  const ownedToolIds = watch("ownedToolIds") ?? [];

  const onSubmit = (values: PlannerFormValues) => {
    const recs = recommendProjects(PROJECTS, {
      goal: values.goal ?? "",
      availableMinutes: values.availableMinutes,
      budgetCents: values.budgetCents,
      ownedToolIds: values.ownedToolIds ?? [],
      experience: values.experience,
      rentOrOwn: values.rentOrOwn,
      comfortablePlumbingElectrical: values.comfortablePlumbingElectrical ?? false,
    });
    setResults(recs);
    if (typeof document !== "undefined") {
      document.getElementById("planner-results")?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const toggleTool = (id: string) => {
    const next = ownedToolIds.includes(id)
      ? ownedToolIds.filter((t) => t !== id)
      : [...ownedToolIds, id];
    setValue("ownedToolIds", next, { shouldDirty: true });
  };

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-3xl font-bold">Project planner</h1>
          <p className="text-muted-foreground">
            Answer a few questions and we&apos;ll suggest projects that fit you.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="goal">What do you want to accomplish?</Label>
              <Input
                id="goal"
                placeholder="e.g. freshen up my bedroom, or fix a leaky toilet"
                {...register("goal")}
              />
              {errors.goal ? (
                <p className="text-sm text-destructive">{errors.goal.message}</p>
              ) : null}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">How much time do you have?</legend>
              <div className="flex flex-wrap gap-2">
                {TIME_CHOICES.map((c) => (
                  <button
                    key={c.minutes}
                    type="button"
                    aria-pressed={availableMinutes === c.minutes}
                    onClick={() => setValue("availableMinutes", c.minutes)}
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Badge variant={availableMinutes === c.minutes ? "default" : "outline"}>
                      {c.label}
                    </Badge>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What&apos;s your budget?</legend>
              <div className="flex flex-wrap gap-2">
                {BUDGET_CHOICES.map((c) => (
                  <button
                    key={c.cents}
                    type="button"
                    aria-pressed={budgetCents === c.cents}
                    onClick={() => setValue("budgetCents", c.cents)}
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Badge variant={budgetCents === c.cents ? "default" : "outline"}>
                      {c.label}
                    </Badge>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="experience">Your experience level</Label>
                <Controller
                  control={control}
                  name="experience"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => field.onChange(v as Difficulty)}
                    >
                      <SelectTrigger id="experience">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="beginner">Beginner — new to this</SelectItem>
                        <SelectItem value="intermediate">
                          Intermediate — some projects done
                        </SelectItem>
                        <SelectItem value="advanced">Advanced — very comfortable</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rentOrOwn">Do you rent or own?</Label>
                <Controller
                  control={control}
                  name="rentOrOwn"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="rentOrOwn">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rent">I rent</SelectItem>
                        <SelectItem value="own">I own</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Controller
                control={control}
                name="comfortablePlumbingElectrical"
                render={({ field }) => (
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                    aria-label="Comfortable with basic plumbing or electrical work"
                  />
                )}
              />
              <span className="text-sm">
                I&apos;m comfortable with basic plumbing tasks.
                <span className="block text-muted-foreground">
                  We only ever suggest beginner-safe tasks — never wiring, gas, or
                  major plumbing.
                </span>
              </span>
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Which tools do you already own? ({ownedToolIds.length})
              </legend>
              <div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-3">
                {TOOLS.map((tool) => (
                  <label key={tool.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={ownedToolIds.includes(tool.id)}
                      onCheckedChange={() => toggleTool(tool.id)}
                    />
                    {tool.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <Button type="submit" size="lg" className="w-full sm:w-auto">
              <Wand2 className="h-4 w-4" aria-hidden="true" /> Show my recommendations
            </Button>
          </form>
        </CardContent>
      </Card>

      <div id="planner-results" className="scroll-mt-24">
        {results !== null ? (
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-2xl font-semibold">
              <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
              {results.length > 0
                ? `${results.length} project${results.length === 1 ? "" : "s"} for you`
                : "Recommendations"}
            </h2>
            {results.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2">
                {results.map((rec) => (
                  <ProjectRecommendationCard key={rec.project.id} recommendation={rec} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No perfect match — but don't stop here"
                description="Try widening your time or budget, or browse the full library. Every expert started with a first project."
                action={
                  <Button asChild variant="outline">
                    <Link href="/projects">Browse all projects</Link>
                  </Button>
                }
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

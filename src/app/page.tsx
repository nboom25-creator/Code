import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  Compass,
  Hammer,
  Rocket,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import * as Icons from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HeroSearch } from "@/components/hero-search";
import { RecentlyViewed } from "@/components/recently-viewed";
import { ProjectCard } from "@/components/project-card";
import { CATEGORIES } from "@/lib/seed/categories";
import { PROJECTS } from "@/lib/seed/projects";

const HOW_IT_WORKS = [
  {
    icon: Compass,
    title: "Pick a project",
    body: "Browse, search, or use the planner to find something that fits your time, budget, and skill level.",
  },
  {
    icon: ClipboardList,
    title: "Prep with confidence",
    body: "See the tools, materials, safety gear, and common mistakes before you begin. Build a missing-items shopping list.",
  },
  {
    icon: Hammer,
    title: "Follow one step at a time",
    body: "A distraction-free workspace guides you step by step, with tips, safety notes, and troubleshooting help.",
  },
  {
    icon: Rocket,
    title: "Track your progress",
    body: "Your progress saves automatically. Pause anytime and pick up exactly where you left off.",
  },
];

function CategoryIcon({ name }: { name: string }) {
  const Icon = (Icons[name as keyof typeof Icons] ??
    Icons.Wrench) as Icons.LucideIcon;
  return <Icon className="h-6 w-6" aria-hidden="true" />;
}

export default function HomePage() {
  const featured = PROJECTS.filter((p) => p.featured).slice(0, 4);
  const beginner = PROJECTS.filter((p) => p.difficulty === "beginner").slice(0, 3);

  return (
    <div>
      {/* Hero */}
      <section className="border-b bg-gradient-to-b from-accent/60 to-background">
        <div className="container flex flex-col items-center gap-6 py-16 text-center sm:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Beginner-friendly, safety-first
          </span>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Every project is easier with a clear path.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            ProjectPath turns home-improvement projects into simple, guided steps
            — so you can do it yourself, safely, even if you&apos;ve never picked
            up a drill.
          </p>
          <HeroSearch />
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/projects">
                Find a Project <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/projects?difficulty=beginner">Browse Beginner Projects</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="container py-12" aria-labelledby="categories-heading">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 id="categories-heading" className="text-2xl font-semibold">
              Popular categories
            </h2>
            <p className="text-muted-foreground">Find projects by what you&apos;re working on.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={`/projects?category=${category.slug}`}
              className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-secondary group-hover:bg-primary group-hover:text-primary-foreground">
                    <CategoryIcon name={category.icon} />
                  </span>
                  <span className="text-sm font-medium">{category.name}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured beginner projects */}
      <section className="container py-8" aria-labelledby="featured-heading">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 id="featured-heading" className="text-2xl font-semibold">
              Featured projects
            </h2>
            <p className="text-muted-foreground">Great first projects to build your confidence.</p>
          </div>
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/projects">
              View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </section>

      <RecentlyViewed />

      {/* How it works */}
      <section className="border-y bg-card" aria-labelledby="how-heading">
        <div className="container py-14">
          <h2 id="how-heading" className="text-center text-2xl font-semibold">
            How ProjectPath works
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.title} className="relative">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Step {i + 1}
                </p>
                <h3 className="mt-1 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Safety messaging */}
      <section className="container py-14">
        <Card className="overflow-hidden border-primary/20">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center sm:flex-row sm:text-left">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
              <ShieldCheck className="h-7 w-7" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <h2 className="text-xl font-semibold">Safety comes first — always</h2>
              <p className="mt-1 text-muted-foreground">
                Every guide flags risks in plain language and tells you clearly
                when a job is better left to a licensed professional. We never ask
                beginners to take on electrical, gas, or structural work.
              </p>
            </div>
            <Button asChild variant="secondary">
              <Link href="/planner">Find a safe first project</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Beginner picks */}
      <section className="container pb-16" aria-labelledby="beginner-heading">
        <h2 id="beginner-heading" className="mb-6 text-2xl font-semibold">
          Beginner picks
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {beginner.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </section>
    </div>
  );
}

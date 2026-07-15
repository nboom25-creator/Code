import type { Metadata } from "next";
import { ProjectLibrary } from "@/components/project-library";
import { CATEGORIES } from "@/lib/seed/categories";
import type {
  CategorySlug,
  Difficulty,
  ProjectFilterState,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Project library",
  description: "Browse and filter beginner-friendly DIY projects.",
};

const VALID_DIFFICULTY: Difficulty[] = ["beginner", "intermediate", "advanced"];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initial: Partial<ProjectFilterState> = {};

  const q = params.q;
  if (typeof q === "string") initial.query = q;

  const category = params.category;
  if (typeof category === "string") {
    const match = CATEGORIES.find((c) => c.slug === category);
    if (match) initial.categories = [match.slug as CategorySlug];
  }

  const difficulty = params.difficulty;
  if (
    typeof difficulty === "string" &&
    VALID_DIFFICULTY.includes(difficulty as Difficulty)
  ) {
    initial.difficulties = [difficulty as Difficulty];
  }

  return <ProjectLibrary initialFilters={initial} />;
}

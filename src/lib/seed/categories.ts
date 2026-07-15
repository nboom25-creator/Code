import type { ProjectCategory } from "@/lib/types";

export const CATEGORIES: ProjectCategory[] = [
  {
    slug: "painting",
    name: "Painting",
    description: "Refresh walls, trim, and furniture with a coat of color.",
    icon: "Paintbrush",
  },
  {
    slug: "walls-drywall",
    name: "Walls & Drywall",
    description: "Patch holes, fix dings, and prep surfaces.",
    icon: "Square",
  },
  {
    slug: "shelving-storage",
    name: "Shelving & Storage",
    description: "Add shelves and organize your space.",
    icon: "LayoutGrid",
  },
  {
    slug: "plumbing",
    name: "Plumbing",
    description: "Simple, low-risk fixes that save water and money.",
    icon: "Droplets",
  },
  {
    slug: "furniture",
    name: "Furniture",
    description: "Assemble and refresh everyday furniture.",
    icon: "Armchair",
  },
  {
    slug: "flooring",
    name: "Flooring",
    description: "Small flooring updates and repairs.",
    icon: "Grid3x3",
  },
  {
    slug: "outdoor",
    name: "Outdoor",
    description: "Projects for porches, patios, and yards.",
    icon: "Trees",
  },
  {
    slug: "electrical",
    name: "Electrical",
    description: "Beginner-safe, no-wiring electrical basics.",
    icon: "Zap",
  },
  {
    slug: "maintenance",
    name: "Maintenance",
    description: "Keep your home in good shape year-round.",
    icon: "Wrench",
  },
  {
    slug: "woodworking",
    name: "Basic Woodworking",
    description: "Simple builds to learn the fundamentals.",
    icon: "Hammer",
  },
];

export const CATEGORY_BY_SLUG = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
) as Record<ProjectCategory["slug"], ProjectCategory>;

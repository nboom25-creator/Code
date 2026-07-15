/**
 * ProjectPath domain types.
 *
 * These mirror the database schema in `supabase/migrations`. Content types
 * (Project, Tool, Step, ...) are public/read-only seed data. User types
 * (UserProject, StepProgress, ShoppingList, ...) are per-user and are the
 * only records protected by row-level security.
 */

export type Difficulty = "beginner" | "intermediate" | "advanced";

/**
 * Safety level communicates risk. We never rely on color alone — every level
 * carries an explicit label and icon in the UI.
 */
export type SafetyLevel = "low" | "moderate" | "elevated";

export type CostBand = "under_25" | "25_75" | "75_200" | "200_plus";

export type CategorySlug =
  | "painting"
  | "walls-drywall"
  | "shelving-storage"
  | "plumbing"
  | "furniture"
  | "flooring"
  | "outdoor"
  | "electrical"
  | "maintenance"
  | "woodworking";

export type StoreDepartment =
  | "paint"
  | "hardware"
  | "plumbing"
  | "electrical"
  | "lumber"
  | "tools"
  | "tile-flooring"
  | "adhesives-sealants"
  | "safety"
  | "other";

export interface ProjectCategory {
  slug: CategorySlug;
  name: string;
  description: string;
  icon: string; // lucide icon name
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  /** Typical rough purchase price in USD cents. Labeled as an estimate in UI. */
  estimatedCostCents: number;
  department: StoreDepartment;
}

export interface Material {
  id: string;
  name: string;
  unit: string; // e.g. "tube", "sheet", "box"
  estimatedCostCents: number;
  department: StoreDepartment;
}

export interface ProjectTool {
  toolId: string;
  optional: boolean;
  note?: string;
}

export interface ProjectMaterial {
  materialId: string;
  quantity: number;
  note?: string;
}

export interface StepTool {
  toolId: string;
}

export interface StepMaterial {
  materialId: string;
  quantity?: number;
}

/**
 * A safety warning. When `requiresAcknowledgment` is true the guided flow
 * blocks progress until the user explicitly confirms they understand.
 */
export interface SafetyWarning {
  id: string;
  level: SafetyLevel;
  title: string;
  detail: string;
  requiresAcknowledgment: boolean;
}

export interface TroubleshootingEntry {
  id: string;
  /** Keywords matched against the user's free-text description (v1). */
  keywords: string[];
  /** Which step this relates to, or null for project-wide issues. */
  stepId: string | null;
  symptom: string; // "What you may be seeing"
  likelyCauses: string[];
  safeChecks: string[];
  correctiveActions: string[];
  stopIf: string[]; // conditions that require stopping
  callProfessionalIf: string[];
}

export interface ProjectStep {
  id: string;
  order: number;
  title: string;
  instructions: string;
  estimatedMinutes: number;
  tools: StepTool[];
  materials: StepMaterial[];
  /** Inline safety warnings shown for this step, never hidden. */
  safetyWarnings: SafetyWarning[];
  whyItMatters: string;
  beginnerTip: string;
  commonMistake: string;
  imageAlt: string;
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  category: CategorySlug;
  summary: string;
  description: string;
  difficulty: Difficulty;
  safetyLevel: SafetyLevel;
  indoor: boolean;
  renterFriendly: boolean;
  requiresPermitOrPro: boolean;
  permitDisclaimer?: string;
  activeMinutes: number;
  totalMinutes: number;
  costBand: CostBand;
  estimatedCostLowCents: number;
  estimatedCostHighCents: number;
  recommendedPeople: number;
  skillPrerequisites: string[];
  tools: ProjectTool[];
  materials: ProjectMaterial[];
  preparation: string[];
  safetyEquipment: string[];
  commonMistakes: string[];
  doNotAttemptIf: string[];
  callProfessionalIf: string[];
  steps: ProjectStep[];
  troubleshooting: TroubleshootingEntry[];
  imageAlt: string;
  featured: boolean;
}

/* ----------------------------- User records ----------------------------- */

export interface User {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
}

export type ProjectStatus = "not_started" | "in_progress" | "completed";

export interface StepProgress {
  stepId: string;
  completed: boolean;
  completedAt: string | null;
}

export interface UserProject {
  id: string;
  userId: string;
  projectId: string;
  status: ProjectStatus;
  currentStepIndex: number;
  steps: StepProgress[];
  /** Safety warning ids the user has explicitly acknowledged. */
  acknowledgedWarnings: string[];
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface SavedProject {
  id: string;
  userId: string;
  projectId: string;
  savedAt: string;
}

export interface UserNote {
  id: string;
  userId: string;
  projectId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserToolInventory {
  userId: string;
  toolId: string;
  ownedAt: string;
}

export interface ShoppingListItem {
  id: string;
  /** Source project, or null for a manually added custom item. */
  projectId: string | null;
  /** References a Material or Tool id, or null for custom items. */
  refId: string | null;
  name: string;
  department: StoreDepartment;
  quantity: number;
  estimatedUnitCostCents: number;
  owned: boolean;
  purchased: boolean;
}

export interface ShoppingList {
  id: string;
  userId: string;
  items: ShoppingListItem[];
  updatedAt: string;
}

/* --------------------------- Derived / view types --------------------------- */

export interface ProjectFilterState {
  query: string;
  categories: CategorySlug[];
  difficulties: Difficulty[];
  maxMinutes: number | null;
  costBands: CostBand[];
  indoor: "all" | "indoor" | "outdoor";
  requiredTools: string[];
  renterFriendlyOnly: boolean;
  hideProfessionalRequired: boolean;
}

export interface PlannerAnswers {
  goal: string;
  availableMinutes: number;
  budgetCents: number;
  ownedToolIds: string[];
  experience: Difficulty;
  rentOrOwn: "rent" | "own";
  comfortablePlumbingElectrical: boolean;
}

export interface ProjectRecommendation {
  project: Project;
  score: number;
  reasons: string[];
}

import { z } from "zod";

/** Difficulty enum shared by planner + filters. */
export const difficultySchema = z.enum(["beginner", "intermediate", "advanced"]);

/**
 * Planner questionnaire validation. Time and budget are coerced from form
 * inputs (strings) into numbers with sane bounds.
 */
export const plannerSchema = z.object({
  goal: z
    .string()
    .trim()
    .max(300, "Please keep this under 300 characters")
    .default(""),
  availableMinutes: z.coerce
    .number()
    .int()
    .min(15, "Choose at least 15 minutes")
    .max(60 * 24 * 3, "That's a very long time!"),
  budgetCents: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000, "Budget looks too high"),
  ownedToolIds: z.array(z.string()).default([]),
  experience: difficultySchema,
  rentOrOwn: z.enum(["rent", "own"]),
  comfortablePlumbingElectrical: z.boolean().default(false),
});

export type PlannerFormValues = z.input<typeof plannerSchema>;

/** A user note. Body is length-limited; rendering escapes HTML (see NoteEditor). */
export const noteSchema = z.object({
  projectId: z.string().min(1),
  body: z
    .string()
    .trim()
    .min(1, "Note cannot be empty")
    .max(2000, "Notes are limited to 2000 characters"),
});

export type NoteFormValues = z.infer<typeof noteSchema>;

/** Custom shopping-list item added by the user. */
export const customItemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter an item name")
    .max(120, "Name is too long"),
  quantity: z.coerce.number().int().min(1).max(999),
  department: z
    .enum([
      "paint",
      "hardware",
      "plumbing",
      "electrical",
      "lumber",
      "tools",
      "tile-flooring",
      "adhesives-sealants",
      "safety",
      "other",
    ])
    .default("other"),
  estimatedUnitCostCents: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export type CustomItemFormValues = z.input<typeof customItemSchema>;

/** Free-text troubleshooting description. */
export const troubleshootingSchema = z.object({
  description: z
    .string()
    .trim()
    .min(3, "Please describe what you're seeing")
    .max(500, "Please keep it under 500 characters"),
});

export type TroubleshootingFormValues = z.infer<typeof troubleshootingSchema>;

/** Auth (used only when Supabase is configured). */
export const authSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type AuthFormValues = z.infer<typeof authSchema>;

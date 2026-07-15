import { describe, expect, it } from "vitest";
import {
  customItemSchema,
  noteSchema,
  plannerSchema,
  troubleshootingSchema,
} from "@/lib/validation";

describe("plannerSchema", () => {
  it("accepts valid answers and coerces numeric strings", () => {
    const result = plannerSchema.safeParse({
      goal: "paint a wall",
      availableMinutes: "120",
      budgetCents: "7500",
      experience: "beginner",
      rentOrOwn: "rent",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.availableMinutes).toBe(120);
      expect(result.data.ownedToolIds).toEqual([]);
    }
  });

  it("rejects an out-of-range time", () => {
    const result = plannerSchema.safeParse({
      availableMinutes: 5,
      budgetCents: 1000,
      experience: "beginner",
      rentOrOwn: "own",
    });
    expect(result.success).toBe(false);
  });
});

describe("noteSchema", () => {
  it("rejects an empty note", () => {
    expect(noteSchema.safeParse({ projectId: "p1", body: "   " }).success).toBe(false);
  });
  it("accepts a valid note", () => {
    expect(noteSchema.safeParse({ projectId: "p1", body: "went well" }).success).toBe(true);
  });
  it("rejects an over-long note", () => {
    expect(
      noteSchema.safeParse({ projectId: "p1", body: "x".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("customItemSchema", () => {
  it("requires a name and coerces quantity", () => {
    const result = customItemSchema.safeParse({ name: "Screws", quantity: "3" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.quantity).toBe(3);
  });
  it("rejects an empty name", () => {
    expect(customItemSchema.safeParse({ name: "", quantity: 1 }).success).toBe(false);
  });
});

describe("troubleshootingSchema", () => {
  it("requires a minimum description length", () => {
    expect(troubleshootingSchema.safeParse({ description: "x" }).success).toBe(false);
    expect(
      troubleshootingSchema.safeParse({ description: "shelf is crooked" }).success,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { PROJECTS } from "@/lib/seed/projects";
import { MATERIAL_BY_ID, TOOL_BY_ID } from "@/lib/seed/catalog";
import { CATEGORY_BY_SLUG } from "@/lib/seed/categories";
import { stepAcknowledgmentBlocked } from "@/lib/progress";

describe("seed data integrity", () => {
  it("ships at least 10 projects", () => {
    expect(PROJECTS.length).toBeGreaterThanOrEqual(10);
  });

  it("every project has a known category", () => {
    for (const p of PROJECTS) {
      expect(CATEGORY_BY_SLUG[p.category]).toBeDefined();
    }
  });

  it("every project has at least 5 steps and 2 troubleshooting entries", () => {
    for (const p of PROJECTS) {
      expect(p.steps.length).toBeGreaterThanOrEqual(5);
      expect(p.troubleshooting.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("references only tools and materials that exist in the catalog", () => {
    for (const p of PROJECTS) {
      for (const t of p.tools) expect(TOOL_BY_ID[t.toolId]).toBeDefined();
      for (const m of p.materials) expect(MATERIAL_BY_ID[m.materialId]).toBeDefined();
      for (const step of p.steps) {
        for (const t of step.tools) expect(TOOL_BY_ID[t.toolId]).toBeDefined();
        for (const m of step.materials) expect(MATERIAL_BY_ID[m.materialId]).toBeDefined();
      }
    }
  });

  it("uses unique step ids within each project and sequential order", () => {
    for (const p of PROJECTS) {
      const ids = p.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      p.steps.forEach((s, i) => expect(s.order).toBe(i + 1));
    }
  });

  it("keeps active time no greater than total time", () => {
    for (const p of PROJECTS) {
      expect(p.activeMinutes).toBeLessThanOrEqual(p.totalMinutes);
    }
  });

  it("does not instruct beginners to perform elevated-risk work in the seed library", () => {
    for (const p of PROJECTS) {
      expect(p.requiresPermitOrPro).toBe(false);
      expect(p.safetyLevel).not.toBe("elevated");
    }
  });

  it("provides stop-and-call-a-pro guidance for every project", () => {
    for (const p of PROJECTS) {
      expect(p.callProfessionalIf.length).toBeGreaterThan(0);
    }
  });
});

describe("high-risk warning acknowledgment", () => {
  const stepWithGate = PROJECTS.flatMap((p) => p.steps).find((s) =>
    s.safetyWarnings.some((w) => w.requiresAcknowledgment),
  );

  it("has at least one acknowledgment-gated step in the seed data", () => {
    expect(stepWithGate).toBeDefined();
  });

  it("blocks a gated step until its warning is acknowledged", () => {
    if (!stepWithGate) return;
    const warningId = stepWithGate.safetyWarnings.find(
      (w) => w.requiresAcknowledgment,
    )!.id;
    expect(stepAcknowledgmentBlocked(stepWithGate, [])).toBe(true);
    expect(stepAcknowledgmentBlocked(stepWithGate, [warningId])).toBe(false);
  });

  it("does not block steps without required acknowledgments", () => {
    const openStep = PROJECTS.flatMap((p) => p.steps).find(
      (s) => !s.safetyWarnings.some((w) => w.requiresAcknowledgment),
    )!;
    expect(stepAcknowledgmentBlocked(openStep, [])).toBe(false);
  });
});

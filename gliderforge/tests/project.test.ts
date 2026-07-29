import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Point the database at a scratch file BEFORE the client module is imported.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gliderforge-test-"));
process.env.GLIDERFORGE_DB = path.join(tmpDir, "test.db");

const { createSampleProject, SAMPLE_SLUG } = await import("@/lib/sample/sampleProject");
const { buildSnapshot } = await import("@/lib/project/snapshot");
const repo = await import("@/lib/db/repo");
const { closeDb } = await import("@/lib/db/client");
const { rankNextActions } = await import("@/lib/assistant/nextActions");
const { LocalAssistant } = await import("@/lib/assistant/local");
const { generateReport, REPORT_CATALOG } = await import("@/lib/reports/generate");

let projectId: string;

beforeAll(() => {
  const p = createSampleProject();
  projectId = p.id;
});

afterAll(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sample project", () => {
  it("creates a project flagged as demonstration data", () => {
    const p = repo.getProject(projectId)!;
    expect(p.slug).toBe(SAMPLE_SLUG);
    expect(p.is_sample).toBe(1);
    expect(p.description).toMatch(/DEMONSTRATION/i);
  });

  it("is idempotent — calling it twice does not duplicate the project", () => {
    const again = createSampleProject();
    expect(again.id).toBe(projectId);
    expect(repo.listProjects().filter((p) => p.slug === SAMPLE_SLUG)).toHaveLength(1);
  });

  it("contains the components the brief asks the sample to demonstrate", () => {
    const names = repo.listRows("components", projectId).map((c) => String(c.name).toLowerCase());
    for (const needed of ["hull", "wing", "fin", "battery", "controller", "sensor", "gearmotor", "lead screw", "syringe", "ballast"]) {
      expect(names.some((n) => n.includes(needed)), `missing a component matching "${needed}"`).toBe(true);
    }
  });

  it("contains requirements, risks, test plans, decisions and notebook entries", () => {
    expect(repo.listRows("requirements", projectId).length).toBeGreaterThanOrEqual(10);
    expect(repo.listRows("risks", projectId).length).toBeGreaterThanOrEqual(15);
    expect(repo.listRows("tests", projectId).length).toBeGreaterThanOrEqual(8);
    expect(repo.listRows("decisions", projectId).length).toBeGreaterThanOrEqual(2);
    expect(repo.listRows("notebook_entries", projectId).length).toBeGreaterThanOrEqual(3);
    expect(repo.listRows("electronics", projectId).length).toBeGreaterThanOrEqual(8);
    expect(repo.listRows("design_variants", projectId).length).toBeGreaterThanOrEqual(3);
  });

  it("leaves starter risks marked as not reviewed by the team", () => {
    const risks = repo.listRows("risks", projectId);
    expect(risks.every((r) => Number(r.is_starter) === 1)).toBe(true);
    expect(risks.every((r) => Number(r.reviewed) === 0)).toBe(true);
  });
});

describe("project snapshot", () => {
  it("computes a self-consistent mass and buoyancy budget", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    // 3.28 kg vehicle displacing 3285 cm^3 in 25 degC fresh water
    expect(snap.massProps.values.totalMass.value).toBeCloseTo(3.28, 2);
    expect(snap.massProps.values.totalDisplacedVolume.value * 1e6).toBeCloseTo(3285, 0);
    expect(snap.water.densitySI).toBeCloseTo(997.05, 1);
    // Near neutral: within about 10 g either way
    expect(Math.abs(snap.neutral.massChangeSI)).toBeLessThan(0.02);
  });

  it("puts the centre of buoyancy above the centre of gravity", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    expect(snap.stability.values.verticalSeparation.value).toBeGreaterThan(0.01);
    expect(snap.stability.warnings.some((w) => w.severity === "error")).toBe(false);
  });

  it("settles at a modest nose-down attitude rather than an extreme one", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    const pitchDeg = (snap.stability.values.equilibriumPitch.value * 180) / Math.PI;
    expect(Math.abs(pitchDeg)).toBeLessThan(20);
  });

  it("sizes the buoyancy engine with a usable stall margin", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    expect(snap.syringe.values.usableVolumeChange.value * 1e6).toBeCloseTo(44.5, 0);
    expect(snap.syringe.values.stallMargin!.value).toBeGreaterThan(1.5);
    expect(snap.syringe.values.maxFeasibleDepth!.value).toBeGreaterThan(3);
  });

  it("predicts a plausible glide", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    expect(snap.diveGlide.values.speed.value).toBeGreaterThan(0.05);
    expect(snap.diveGlide.values.speed.value).toBeLessThan(2);
    expect(snap.diveGlide.values.glideRatio.value).toBeCloseTo(0.35 / 0.12, 6);
  });

  it("produces a power budget and endurance", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    expect(snap.power.values.averagePower.value).toBeGreaterThan(0);
    expect(snap.power.values.enduranceTime.value).toBeGreaterThan(3600);
  });

  it("reports partial completion, not 0 or 100", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    expect(snap.completion.percent).toBeGreaterThan(10);
    expect(snap.completion.percent).toBeLessThan(100);
  });
});

describe("next-action ranking", () => {
  it("ranks actions and explains why each matters", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    const actions = rankNextActions(snap);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.why.length).toBeGreaterThan(20);
      expect(a.evidence.length).toBeGreaterThan(10);
      expect(a.score).toBeGreaterThanOrEqual(0);
    }
    // Sorted descending
    for (let i = 1; i < actions.length; i++) expect(actions[i - 1].score).toBeGreaterThanOrEqual(actions[i].score);
  });

  it("flags the unmeasured hydrodynamic coefficients in the sample project", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    const actions = rankNextActions(snap);
    expect(actions.some((a) => a.id === "hydro-coeffs")).toBe(true);
    expect(actions.some((a) => a.id === "review-risks")).toBe(true);
    expect(actions.some((a) => a.id === "run-tests")).toBe(true);
  });
});

describe("local assistant", () => {
  const ask = async (q: string) => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    return new LocalAssistant().answer(q, snap, []);
  };

  it("answers the ballast question with a traceable number", async () => {
    const a = await ask("How much ballast should I add?");
    expect(a.intent).toBe("ballast");
    expect(a.calculations.length).toBeGreaterThan(0);
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.answer).toMatch(/g /);
  });

  it("answers whether the syringe is large enough and cites the architecture", async () => {
    const a = await ask("Is the current syringe large enough?");
    expect(a.intent).toBe("syringe-adequate");
    expect(a.citations.some((c) => c.label === "Engine architecture")).toBe(true);
  });

  it("identifies missing data", async () => {
    const a = await ask("What information is still missing?");
    expect(a.intent).toBe("missing-data");
    expect(a.missingData.length).toBeGreaterThan(0);
  });

  it("performs a what-if on vehicle mass", async () => {
    const a = await ask("What happens if vehicle mass increases by 200 grams?");
    expect(a.intent).toBe("what-if-mass");
    expect(a.calculations.some((c) => /after/i.test(c.label))).toBe(true);
  });

  it("falls back honestly on an unmatched question", async () => {
    const a = await ask("zzzz qqqq");
    expect(a.intent).toBe("fallback");
    expect(a.answer).toMatch(/could not match/i);
  });

  it("always appends the standing caveat", async () => {
    const a = await ask("Prepare me for my advisor meeting");
    expect(a.advice.at(-1)).toMatch(/not a verified engineering result/i);
  });
});

describe("reports", () => {
  it("generates every report kind without throwing, with a header and a limitations block", () => {
    const snap = buildSnapshot(repo.getProject(projectId)!);
    for (const entry of REPORT_CATALOG) {
      const r = generateReport(entry.kind, snap);
      expect(r.markdown, `report ${entry.kind} is empty`).toBeTruthy();
      expect(r.markdown).toContain("**Project:**");
      expect(r.markdown).toContain("Verification status and limitations");
      expect(r.markdown).toContain("DEMONSTRATION PROJECT");
    }
  });
});

describe("persistence, revisions and undo", () => {
  it("round-trips a component through create, update and read", () => {
    const created = repo.createRow("components", projectId, {
      name: "Test widget",
      category: "structure",
      measured_mass_kg: 0.123,
      displacement_mode: "internal",
      pos_x: 0.1,
      quantity: 1,
      include_in_budget: 1,
    });
    expect(created.id).toBeTruthy();
    const updated = repo.updateRow("components", String(created.id), { measured_mass_kg: 0.456 });
    expect(Number(updated.measured_mass_kg)).toBeCloseTo(0.456, 9);
    expect(Number(repo.getRow("components", String(created.id))!.measured_mass_kg)).toBeCloseTo(0.456, 9);
  });

  it("undoes an update, restoring the previous value", () => {
    const created = repo.createRow("components", projectId, {
      name: "Undo widget",
      category: "structure",
      measured_mass_kg: 1.0,
      displacement_mode: "internal",
    });
    repo.updateRow("components", String(created.id), { measured_mass_kg: 2.0 });
    const result = repo.undoLast(projectId);
    expect(result.undone).toBe(true);
    expect(Number(repo.getRow("components", String(created.id))!.measured_mass_kg)).toBeCloseTo(1.0, 9);
  });

  it("undoes a create by removing the row", () => {
    const created = repo.createRow("components", projectId, { name: "Ephemeral", category: "structure", displacement_mode: "internal" });
    repo.undoLast(projectId);
    expect(repo.getRow("components", String(created.id))).toBeUndefined();
  });

  it("undoes a delete by restoring the row", () => {
    const created = repo.createRow("components", projectId, { name: "Restore me", category: "structure", displacement_mode: "internal" });
    repo.deleteRow("components", String(created.id));
    expect(repo.getRow("components", String(created.id))).toBeUndefined();
    repo.undoLast(projectId);
    expect(repo.getRow("components", String(created.id))?.name).toBe("Restore me");
  });

  it("refuses to mutate an immutable calculation snapshot", () => {
    const run = repo.createRow("calculation_runs", projectId, {
      calc_id: "buoyancy.net",
      title: "Static buoyancy",
      inputs_json: "{}",
      results_json: "{}",
    });
    expect(() => repo.updateRow("calculation_runs", String(run.id), { title: "edited" })).toThrow(/immutable/i);
  });

  it("rejects an unknown collection name", () => {
    expect(() => repo.listRows("secrets; DROP TABLE projects", projectId)).toThrow(/Unknown collection/);
  });

  it("ignores unknown columns in a payload rather than failing or injecting them", () => {
    const created = repo.createRow("components", projectId, {
      name: "Sanitised",
      category: "structure",
      displacement_mode: "internal",
      not_a_real_column: "should be dropped",
    });
    expect(created.name).toBe("Sanitised");
    expect("not_a_real_column" in created).toBe(false);
  });

  it("exports the whole project as a bundle", () => {
    const bundle = repo.exportProject(projectId) as Record<string, unknown[]>;
    expect(bundle.project).toBeTruthy();
    expect((bundle.components as unknown[]).length).toBeGreaterThan(10);
    expect((bundle.requirements as unknown[]).length).toBeGreaterThanOrEqual(10);
  });

  it("reopens the project with data intact after closing the connection", () => {
    const before = repo.listRows("components", projectId).length;
    closeDb();
    const after = repo.listRows("components", projectId).length;
    expect(after).toBe(before);
  });
});

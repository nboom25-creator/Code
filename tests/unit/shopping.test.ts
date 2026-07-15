import { describe, expect, it } from "vitest";
import {
  buildProjectShoppingItems,
  estimatedTotalCents,
  groupByDepartment,
  remainingItemCount,
} from "@/lib/shopping";
import { PROJECT_BY_SLUG } from "@/lib/seed/projects";

const project = PROJECT_BY_SLUG["install-a-floating-shelf"]!;

describe("buildProjectShoppingItems", () => {
  it("includes all tools and materials when the user owns nothing", () => {
    const items = buildProjectShoppingItems(project, new Set(), new Set());
    expect(items).toHaveLength(project.tools.length + project.materials.length);
  });

  it("excludes owned tools and materials (missing-items list)", () => {
    const ownedTool = project.tools[0]!.toolId;
    const ownedMaterial = project.materials[0]!.materialId;
    const items = buildProjectShoppingItems(
      project,
      new Set([ownedTool]),
      new Set([ownedMaterial]),
    );
    expect(items.some((i) => i.refId === ownedTool)).toBe(false);
    expect(items.some((i) => i.refId === ownedMaterial)).toBe(false);
    expect(items).toHaveLength(
      project.tools.length + project.materials.length - 2,
    );
  });

  it("carries material quantities through", () => {
    const items = buildProjectShoppingItems(project, new Set(), new Set());
    const firstMaterial = project.materials[0]!;
    const item = items.find((i) => i.refId === firstMaterial.materialId);
    expect(item?.quantity).toBe(firstMaterial.quantity);
  });
});

describe("estimatedTotalCents", () => {
  it("sums unit cost times quantity, ignoring owned items", () => {
    const items = buildProjectShoppingItems(project, new Set(), new Set());
    const total = estimatedTotalCents(items);
    expect(total).toBeGreaterThan(0);

    const withOwned = items.map((i, idx) => (idx === 0 ? { ...i, owned: true } : i));
    expect(estimatedTotalCents(withOwned)).toBeLessThan(total);
  });
});

describe("groupByDepartment", () => {
  it("groups items and preserves every non-owned item", () => {
    const items = buildProjectShoppingItems(project, new Set(), new Set());
    const groups = groupByDepartment(items);
    const grouped = groups.flatMap((g) => g.items);
    expect(grouped).toHaveLength(items.length);
  });
});

describe("remainingItemCount", () => {
  it("counts only items that are neither owned nor purchased", () => {
    const items = buildProjectShoppingItems(project, new Set(), new Set());
    const modified = items.map((i, idx) =>
      idx === 0 ? { ...i, purchased: true } : idx === 1 ? { ...i, owned: true } : i,
    );
    expect(remainingItemCount(modified)).toBe(items.length - 2);
  });
});

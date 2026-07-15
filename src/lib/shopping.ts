import { MATERIAL_BY_ID, TOOL_BY_ID } from "@/lib/seed/catalog";
import type {
  Project,
  ShoppingListItem,
  StoreDepartment,
} from "@/lib/types";
import { createId } from "@/lib/utils";

export const DEPARTMENT_LABELS: Record<StoreDepartment, string> = {
  paint: "Paint",
  hardware: "Hardware & Fasteners",
  plumbing: "Plumbing",
  electrical: "Electrical",
  lumber: "Lumber & Building Materials",
  tools: "Tools",
  "tile-flooring": "Tile & Flooring",
  "adhesives-sealants": "Adhesives & Sealants",
  safety: "Safety Gear",
  other: "Other",
};

const DEPARTMENT_ORDER: StoreDepartment[] = [
  "tools",
  "hardware",
  "lumber",
  "paint",
  "adhesives-sealants",
  "tile-flooring",
  "plumbing",
  "electrical",
  "safety",
  "other",
];

/**
 * Build shopping-list items for a project, EXCLUDING anything in the owned set
 * (materials the user has checked as "already have"). This is the missing-items
 * shopping list. Optional tools are still included but flagged in the note.
 */
export function buildProjectShoppingItems(
  project: Project,
  ownedToolIds: Set<string>,
  ownedMaterialIds: Set<string>,
): ShoppingListItem[] {
  const items: ShoppingListItem[] = [];

  for (const pt of project.tools) {
    if (ownedToolIds.has(pt.toolId)) continue;
    const tool = TOOL_BY_ID[pt.toolId];
    if (!tool) continue;
    items.push({
      id: createId("sli"),
      projectId: project.id,
      refId: tool.id,
      name: pt.optional ? `${tool.name} (optional)` : tool.name,
      department: tool.department,
      quantity: 1,
      estimatedUnitCostCents: tool.estimatedCostCents,
      owned: false,
      purchased: false,
    });
  }

  for (const pm of project.materials) {
    if (ownedMaterialIds.has(pm.materialId)) continue;
    const material = MATERIAL_BY_ID[pm.materialId];
    if (!material) continue;
    items.push({
      id: createId("sli"),
      projectId: project.id,
      refId: material.id,
      name: material.name,
      department: material.department,
      quantity: pm.quantity,
      estimatedUnitCostCents: material.estimatedCostCents,
      owned: false,
      purchased: false,
    });
  }

  return items;
}

export interface DepartmentGroup {
  department: StoreDepartment;
  label: string;
  items: ShoppingListItem[];
}

/** Group items by store department in a sensible walking order. */
export function groupByDepartment(items: ShoppingListItem[]): DepartmentGroup[] {
  const map = new Map<StoreDepartment, ShoppingListItem[]>();
  for (const item of items) {
    const list = map.get(item.department) ?? [];
    list.push(item);
    map.set(item.department, list);
  }
  return DEPARTMENT_ORDER.filter((d) => map.has(d)).map((department) => ({
    department,
    label: DEPARTMENT_LABELS[department],
    items: map.get(department) ?? [],
  }));
}

export interface ProjectGroup {
  projectId: string | null;
  items: ShoppingListItem[];
}

export function groupByProject(items: ShoppingListItem[]): ProjectGroup[] {
  const map = new Map<string | null, ShoppingListItem[]>();
  for (const item of items) {
    const list = map.get(item.projectId) ?? [];
    list.push(item);
    map.set(item.projectId, list);
  }
  return [...map.entries()].map(([projectId, groupItems]) => ({
    projectId,
    items: groupItems,
  }));
}

/** Estimated total for items that are not owned and not yet purchased. */
export function estimatedTotalCents(items: ShoppingListItem[]): number {
  return items
    .filter((i) => !i.owned)
    .reduce((sum, i) => sum + i.estimatedUnitCostCents * i.quantity, 0);
}

export function remainingItemCount(items: ShoppingListItem[]): number {
  return items.filter((i) => !i.owned && !i.purchased).length;
}

/** Plain-text rendering for copy/print. */
export function toPlainText(items: ShoppingListItem[]): string {
  const groups = groupByDepartment(items.filter((i) => !i.owned));
  const lines: string[] = ["ProjectPath — Shopping List (estimated prices)", ""];
  for (const group of groups) {
    lines.push(group.label.toUpperCase());
    for (const item of group.items) {
      const check = item.purchased ? "[x]" : "[ ]";
      lines.push(`  ${check} ${item.quantity}× ${item.name}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

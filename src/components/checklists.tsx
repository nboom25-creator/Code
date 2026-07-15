"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/format";
import { MATERIAL_BY_ID, TOOL_BY_ID } from "@/lib/seed/catalog";
import type { ProjectMaterial, ProjectTool } from "@/lib/types";

/**
 * Tool checklist — users check off tools they already own. Ownership is stored
 * globally (tool inventory) so it carries across projects.
 */
export function ToolChecklist({
  tools,
  isOwned,
  onToggle,
}: {
  tools: ProjectTool[];
  isOwned: (toolId: string) => boolean;
  onToggle: (toolId: string) => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {tools.map((pt) => {
        const tool = TOOL_BY_ID[pt.toolId];
        if (!tool) return null;
        const owned = isOwned(pt.toolId);
        return (
          <li key={pt.toolId} className="flex items-start gap-3 p-3">
            <Checkbox
              id={`tool-${pt.toolId}`}
              checked={owned}
              onCheckedChange={() => onToggle(pt.toolId)}
              aria-label={`I own ${tool.name}`}
            />
            <label htmlFor={`tool-${pt.toolId}`} className="flex-1 cursor-pointer">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {tool.name}
                {pt.optional ? (
                  <Badge variant="muted">Optional</Badge>
                ) : null}
              </span>
              <span className="block text-sm text-muted-foreground">
                {pt.note ?? tool.description}
              </span>
            </label>
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              ~{formatCents(tool.estimatedCostCents)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Material checklist — users check off materials they already have. Selection
 * is passed up so the details page can build a missing-items shopping list.
 */
export function MaterialChecklist({
  materials,
  owned,
  onToggle,
}: {
  materials: ProjectMaterial[];
  owned: Set<string>;
  onToggle: (materialId: string) => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {materials.map((pm) => {
        const material = MATERIAL_BY_ID[pm.materialId];
        if (!material) return null;
        const have = owned.has(pm.materialId);
        return (
          <li key={pm.materialId} className="flex items-start gap-3 p-3">
            <Checkbox
              id={`mat-${pm.materialId}`}
              checked={have}
              onCheckedChange={() => onToggle(pm.materialId)}
              aria-label={`I already have ${material.name}`}
            />
            <label htmlFor={`mat-${pm.materialId}`} className="flex-1 cursor-pointer">
              <span className="font-medium">
                {pm.quantity} × {material.name}
                <span className="text-muted-foreground"> ({material.unit})</span>
              </span>
              {pm.note ? (
                <span className="block text-sm text-muted-foreground">{pm.note}</span>
              ) : null}
            </label>
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              ~{formatCents(material.estimatedCostCents * pm.quantity)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

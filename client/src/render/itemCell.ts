/**
 * Builds an item icon cell with a rarity-colored border and tooltip wiring.
 * Shared by the character panel and the loot window.
 */

import { QUALITY_COLORS, getItem } from "@wow/shared";
import type { ItemTooltip } from "./ItemTooltip.js";

export interface ItemCellOptions {
  itemId: string | null;
  tooltip: ItemTooltip;
  onClick?: () => void;
  /** Optional placeholder text for an empty slot (e.g. the slot name). */
  emptyLabel?: string;
}

export function makeItemCell(opts: ItemCellOptions): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "item-cell";

  const item = opts.itemId ? getItem(opts.itemId) : undefined;
  if (item) {
    cell.classList.add("filled");
    cell.style.setProperty("--rarity", QUALITY_COLORS[item.quality]);
    cell.textContent = item.icon;
    cell.addEventListener("mouseenter", (e) => opts.tooltip.show(item.id, e.clientX, e.clientY));
    cell.addEventListener("mousemove", (e) => opts.tooltip.move(e.clientX, e.clientY));
    cell.addEventListener("mouseleave", () => opts.tooltip.hide());
  } else if (opts.emptyLabel) {
    cell.classList.add("empty-labeled");
    cell.textContent = opts.emptyLabel;
  }

  if (opts.onClick) cell.addEventListener("click", opts.onClick);
  return cell;
}

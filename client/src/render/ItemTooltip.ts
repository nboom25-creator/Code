/**
 * A single floating tooltip reused across the character panel and loot window.
 * Shows an item's name (in its rarity color), quality and stat lines.
 */

import { QUALITY_COLORS, QUALITY_LABELS, SLOT_LABELS, describeItemStats, getItem } from "@wow/shared";

export class ItemTooltip {
  private readonly root = document.createElement("div");

  constructor(parent: HTMLElement) {
    this.root.className = "item-tooltip hidden";
    parent.append(this.root);
  }

  show(itemId: string, clientX: number, clientY: number): void {
    const item = getItem(itemId);
    if (!item) return;

    const color = QUALITY_COLORS[item.quality];
    const stats = describeItemStats(item.stats)
      .map((line) => `<div class="tt-stat">${line}</div>`)
      .join("");

    this.root.innerHTML = `
      <div class="tt-name" style="color:${color}">${item.name}</div>
      <div class="tt-sub">${QUALITY_LABELS[item.quality]} · ${SLOT_LABELS[item.slot]}</div>
      ${stats}
    `;
    this.root.classList.remove("hidden");
    this.move(clientX, clientY);
  }

  move(clientX: number, clientY: number): void {
    // Keep the tooltip on-screen-ish; offset from the cursor.
    this.root.style.left = `${clientX + 16}px`;
    this.root.style.top = `${clientY + 16}px`;
  }

  hide(): void {
    this.root.classList.add("hidden");
  }
}

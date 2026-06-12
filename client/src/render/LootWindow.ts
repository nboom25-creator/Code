/**
 * Classic-style loot window(s). For each monster corpse that still has loot, a
 * small window is anchored over the corpse on the canvas. Clicking an item
 * sends a loot request to the server; the window re-renders from the next
 * snapshot and closes itself once the corpse is empty.
 */

import { QUALITY_COLORS, getItem } from "@wow/shared";
import type { EntitySnapshot } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";
import type { Connection } from "../net/Connection.js";
import type { Renderer } from "./Renderer.js";
import type { ItemTooltip } from "./ItemTooltip.js";

interface LootWidget {
  root: HTMLElement;
  list: HTMLElement;
  signature: string;
}

export class LootWindow {
  private readonly widgets = new Map<number, LootWidget>();

  constructor(
    private readonly parent: HTMLElement,
    private readonly state: ClientState,
    private readonly connection: Connection,
    private readonly renderer: Renderer,
    private readonly tooltip: ItemTooltip,
  ) {}

  update(): void {
    const active = new Set<number>();
    for (const entity of this.state.entities.values()) {
      if (entity.kind !== "monster" || entity.hp > 0 || entity.loot.length === 0) continue;
      active.add(entity.id);
      this.sync(entity);
    }
    // Close windows whose corpse is gone or fully looted.
    for (const [id, widget] of this.widgets) {
      if (!active.has(id)) {
        widget.root.remove();
        this.widgets.delete(id);
      }
    }
  }

  private sync(entity: EntitySnapshot): void {
    let widget = this.widgets.get(entity.id);
    if (!widget) {
      widget = this.build(entity);
      this.widgets.set(entity.id, widget);
    }

    // Anchor to the corpse position (follows the camera as the player moves).
    const pos = this.renderer.worldToScreen(entity.x, entity.y);
    widget.root.style.left = `${pos.x + 26}px`;
    widget.root.style.top = `${pos.y - 24}px`;

    const signature = entity.loot.join(",");
    if (signature !== widget.signature) {
      widget.signature = signature;
      this.renderRows(entity, widget.list);
    }
  }

  private build(entity: EntitySnapshot): LootWidget {
    const root = document.createElement("div");
    root.className = "loot-window";

    const header = document.createElement("div");
    header.className = "loot-header";
    header.textContent = entity.name;

    const list = document.createElement("div");
    list.className = "loot-list";

    root.append(header, list);
    this.parent.append(root);
    return { root, list, signature: "" };
  }

  private renderRows(entity: EntitySnapshot, list: HTMLElement): void {
    list.replaceChildren();
    entity.loot.forEach((itemId, index) => {
      const item = getItem(itemId);
      if (!item) return;
      const row = document.createElement("div");
      row.className = "loot-row";

      const icon = document.createElement("span");
      icon.className = "loot-icon";
      icon.style.setProperty("--rarity", QUALITY_COLORS[item.quality]);
      icon.textContent = item.icon;

      const name = document.createElement("span");
      name.className = "loot-name";
      name.style.color = QUALITY_COLORS[item.quality];
      name.textContent = item.name;

      row.append(icon, name);
      row.addEventListener("click", () => this.connection.lootItem(entity.id, index));
      row.addEventListener("mouseenter", (e) => this.tooltip.show(item.id, e.clientX, e.clientY));
      row.addEventListener("mousemove", (e) => this.tooltip.move(e.clientX, e.clientY));
      row.addEventListener("mouseleave", () => this.tooltip.hide());
      list.append(row);
    });
  }
}

/**
 * Toggleable Character & Bag panel (bound to 'B').
 *
 * Left: a paper-doll of the 5 equipment slots. Right: the 16-slot backpack.
 * Clicking a bag item equips it; clicking an equipped item unequips it. Every
 * move is a request to the server — the panel re-renders from the authoritative
 * container state in the next snapshot, never mutating locally.
 */

import { EQUIP_SLOTS, SLOT_LABELS, type EquipSlot } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";
import type { Connection } from "../net/Connection.js";
import type { ItemTooltip } from "./ItemTooltip.js";
import { makeItemCell } from "./itemCell.js";

export class CharacterPanel {
  private readonly root = document.createElement("div");
  private readonly paperDoll = document.createElement("div");
  private readonly bagGrid = document.createElement("div");
  private visible = false;
  private signature = "";

  constructor(
    parent: HTMLElement,
    private readonly state: ClientState,
    private readonly connection: Connection,
    private readonly tooltip: ItemTooltip,
  ) {
    this.root.className = "character-panel hidden";

    const header = document.createElement("div");
    header.className = "panel-header";
    header.textContent = "Character & Bags";

    const body = document.createElement("div");
    body.className = "panel-body";

    const left = document.createElement("div");
    left.className = "paper-doll-wrap";
    const leftTitle = document.createElement("div");
    leftTitle.className = "panel-subtitle";
    leftTitle.textContent = "Equipped";
    this.paperDoll.className = "paper-doll";
    left.append(leftTitle, this.paperDoll);

    const right = document.createElement("div");
    right.className = "bag-wrap";
    const rightTitle = document.createElement("div");
    rightTitle.className = "panel-subtitle";
    rightTitle.textContent = "Backpack";
    this.bagGrid.className = "bag-grid";
    right.append(rightTitle, this.bagGrid);

    body.append(left, right);

    const footer = document.createElement("div");
    footer.className = "panel-footer";
    footer.textContent = "Click a bag item to equip · click equipped gear to unequip · press B to close";

    this.root.append(header, body, footer);
    parent.append(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle("hidden", !this.visible);
    if (!this.visible) this.tooltip.hide();
    else this.signature = ""; // force a rebuild on open
  }

  update(): void {
    if (!this.visible) return;
    const { inventory, equipment } = this.state.containers;
    const sig = JSON.stringify({ inventory, equipment });
    if (sig === this.signature) return;
    this.signature = sig;
    this.tooltip.hide();

    this.renderPaperDoll(equipment);
    this.renderBag(inventory);
  }

  private renderPaperDoll(equipment: Record<EquipSlot, string | null>): void {
    this.paperDoll.replaceChildren();
    for (const slot of EQUIP_SLOTS) {
      const itemId = equipment[slot];
      const row = document.createElement("div");
      row.className = "doll-slot";
      const cell = makeItemCell({
        itemId,
        tooltip: this.tooltip,
        emptyLabel: itemId ? undefined : SLOT_LABELS[slot].slice(0, 1),
        onClick: itemId ? () => this.connection.unequipItem(slot) : undefined,
      });
      const label = document.createElement("span");
      label.className = "doll-label";
      label.textContent = SLOT_LABELS[slot];
      row.append(cell, label);
      this.paperDoll.append(row);
    }
  }

  private renderBag(inventory: (string | null)[]): void {
    this.bagGrid.replaceChildren();
    inventory.forEach((itemId, index) => {
      const cell = makeItemCell({
        itemId,
        tooltip: this.tooltip,
        onClick: itemId ? () => this.connection.equipItem(index) : undefined,
      });
      this.bagGrid.append(cell);
    });
  }
}

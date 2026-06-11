/**
 * WoW-style unit frames for the player and current target: nameplate, health
 * bar and mana bar. Built once as DOM and updated each frame from state.
 */

import type { EntitySnapshot } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";

class UnitFrame {
  readonly root = document.createElement("div");
  private readonly nameEl = document.createElement("span");
  private readonly combatEl = document.createElement("span");
  private readonly hpFill: HTMLElement;
  private readonly hpLabel: HTMLElement;
  private readonly manaFill: HTMLElement;
  private readonly manaLabel: HTMLElement;

  constructor(private readonly placeholder: string) {
    this.root.className = "unit-frame empty";

    const nameRow = document.createElement("div");
    nameRow.className = "name";
    this.combatEl.className = "combat-flag";
    nameRow.append(this.nameEl, this.combatEl);

    const hp = this.makeBar("hp");
    const mana = this.makeBar("mana");
    this.hpFill = hp.fill;
    this.hpLabel = hp.label;
    this.manaFill = mana.fill;
    this.manaLabel = mana.label;

    this.root.append(nameRow, hp.bar, mana.bar);
    this.update(undefined);
  }

  private makeBar(kind: "hp" | "mana") {
    const bar = document.createElement("div");
    bar.className = `bar ${kind}`;
    const fill = document.createElement("div");
    fill.className = "fill";
    const label = document.createElement("div");
    label.className = "label";
    bar.append(fill, label);
    return { bar, fill, label };
  }

  update(unit: EntitySnapshot | undefined): void {
    if (!unit) {
      this.root.className = "unit-frame empty";
      this.nameEl.textContent = this.placeholder;
      this.combatEl.textContent = "";
      this.setBar(this.hpFill, this.hpLabel, 0, 0);
      this.setBar(this.manaFill, this.manaLabel, 0, 0);
      return;
    }
    this.root.className = "unit-frame has-unit";
    this.nameEl.textContent = unit.name;
    this.combatEl.textContent = unit.inCombat ? "⚔ In Combat" : "";
    this.setBar(this.hpFill, this.hpLabel, unit.hp, unit.maxHp);
    this.setBar(this.manaFill, this.manaLabel, unit.mana, unit.maxMana);
  }

  private setBar(fill: HTMLElement, label: HTMLElement, value: number, max: number): void {
    const pct = max > 0 ? value / max : 0;
    fill.style.transform = `scaleX(${pct})`;
    label.textContent = max > 0 ? `${value} / ${max}` : "";
  }
}

export class UnitFrames {
  private readonly player = new UnitFrame("No Player");
  private readonly target = new UnitFrame("No Target");

  constructor(root: HTMLElement) {
    root.append(this.player.root, this.target.root);
  }

  update(state: ClientState): void {
    this.player.update(state.player);
    this.target.update(state.target);
  }
}

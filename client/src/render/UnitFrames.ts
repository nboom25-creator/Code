/**
 * WoW-style unit frames for the player and current target: nameplate, health
 * bar and a resource bar that recolors to match the active power type
 * (blue mana / yellow energy / red rage). Built once and updated each frame.
 */

import type { EntitySnapshot, PowerType } from "@wow/shared";
import { getStance, powerLabel } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";

class UnitFrame {
  readonly root = document.createElement("div");
  private readonly nameEl = document.createElement("span");
  private readonly combatEl = document.createElement("span");
  private readonly hpFill: HTMLElement;
  private readonly hpLabel: HTMLElement;
  private readonly powerBar: HTMLElement;
  private readonly powerFill: HTMLElement;
  private readonly powerLabelEl: HTMLElement;
  private readonly buffRow = document.createElement("div");

  constructor(private readonly placeholder: string) {
    this.root.className = "unit-frame empty";

    const nameRow = document.createElement("div");
    nameRow.className = "name";
    this.combatEl.className = "combat-flag";
    nameRow.append(this.nameEl, this.combatEl);

    const hp = this.makeBar("hp");
    const power = this.makeBar("power");
    this.hpFill = hp.fill;
    this.hpLabel = hp.label;
    this.powerBar = power.bar;
    this.powerFill = power.fill;
    this.powerLabelEl = power.label;

    this.buffRow.className = "buff-row";

    this.root.append(nameRow, hp.bar, power.bar, this.buffRow);
    this.update(undefined);
  }

  private makeBar(kind: "hp" | "power") {
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
      this.powerBar.style.display = "none";
      this.buffRow.replaceChildren();
      return;
    }
    this.root.className = "unit-frame has-unit";
    this.nameEl.textContent = unit.name;
    this.combatEl.textContent = unit.inCombat ? "⚔ In Combat" : "";
    this.setBar(this.hpFill, this.hpLabel, unit.hp, unit.maxHp);

    // Resource bar: hide for unitless pools (e.g. target dummies), otherwise
    // recolor to the active power type.
    if (unit.maxPower <= 0) {
      this.powerBar.style.display = "none";
    } else {
      this.powerBar.style.display = "";
      this.setPowerColor(unit.powerType);
      this.setBar(this.powerFill, this.powerLabelEl, unit.power, unit.maxPower, powerLabel(unit.powerType));
    }

    this.updateBuffs(unit);
  }

  /** Show a badge for the active stance (non-neutral stances only). */
  private updateBuffs(unit: EntitySnapshot): void {
    this.buffRow.replaceChildren();
    if (!unit.classId || unit.stanceId === "neutral") return;
    const stance = getStance(unit.classId, unit.stanceId);
    const badge = document.createElement("span");
    badge.className = "buff-badge";
    badge.style.setProperty("--badge", stance.color);
    badge.textContent = stance.badge;
    badge.title = stance.name;
    this.buffRow.append(badge);
  }

  private setPowerColor(type: PowerType): void {
    this.powerFill.className = `fill power-${type}`;
  }

  private setBar(fill: HTMLElement, label: HTMLElement, value: number, max: number, prefix = ""): void {
    const pct = max > 0 ? value / max : 0;
    fill.style.transform = `scaleX(${pct})`;
    const text = max > 0 ? `${value} / ${max}` : "";
    label.textContent = prefix && text ? `${prefix}  ${text}` : text;
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

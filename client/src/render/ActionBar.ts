/**
 * Bottom action bar. Each slot binds a hotkey to an action and shows live
 * state: the auto-attack toggle highlights while active, spell slots show the
 * Global Cooldown sweep and are dimmed when their resource can't be paid, and a
 * dedicated stance toggle (Warriors only) flips Battle/Defensive stance with
 * its own short cooldown sweep.
 */

import {
  GCD_MS,
  SPELLS,
  STANCE_COOLDOWN_MS,
  getClass,
  getStance,
} from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";
import type { Connection } from "../net/Connection.js";

export interface ActionSlot {
  key: string;
  name: string;
  icon: string;
  /** "autoattack" or a spell id from SPELLS. */
  action: string;
  onActivate: () => void;
}

class SlotButton {
  readonly root = document.createElement("div");
  private readonly cdOverlay = document.createElement("div");
  private readonly nameEl = document.createElement("div");

  constructor(key: string, name: string, icon: string, tooltip: string, onClick: () => void) {
    this.root.className = "action-button";

    const keyEl = document.createElement("div");
    keyEl.className = "key";
    keyEl.textContent = key;

    const iconEl = document.createElement("div");
    iconEl.className = "icon";
    iconEl.textContent = icon;

    this.nameEl.className = "name";
    this.nameEl.textContent = name;

    this.cdOverlay.className = "cd-overlay";

    this.root.append(this.cdOverlay, keyEl, iconEl, this.nameEl);
    this.root.title = tooltip;
    this.root.addEventListener("click", onClick);
  }

  setName(name: string): void {
    this.nameEl.textContent = name;
  }
  setActive(active: boolean): void {
    this.root.classList.toggle("active", active);
  }
  setUnusable(unusable: boolean): void {
    this.root.classList.toggle("unusable", unusable);
  }
  setHidden(hidden: boolean): void {
    this.root.style.display = hidden ? "none" : "";
  }
  setAccent(color: string | null): void {
    this.root.style.borderColor = color ?? "";
  }
  setGcd(fraction: number): void {
    this.cdOverlay.style.transform = `scaleY(${fraction})`;
  }
}

export class ActionBar {
  private readonly buttons = new Map<string, { slot: ActionSlot; btn: SlotButton }>();
  private readonly stanceButton: SlotButton;

  constructor(
    root: HTMLElement,
    private readonly state: ClientState,
    slots: ActionSlot[],
    private readonly connection: Connection,
  ) {
    for (const slot of slots) {
      const btn = new SlotButton(
        slot.key,
        slot.name,
        slot.icon,
        SPELLS[slot.action]?.description ?? slot.name,
        slot.onActivate,
      );
      this.buttons.set(slot.key, { slot, btn });
      root.append(btn.root);
    }

    this.stanceButton = new SlotButton("R", "Stance", "🛡", "Toggle stance (Warrior)", () =>
      this.toggleStance(),
    );
    root.append(this.stanceButton.root);
  }

  /** Activate a slot by hotkey (called from the input layer). */
  activateKey(key: string): void {
    this.buttons.get(key)?.slot?.onActivate();
  }

  /** Flip to the player's other stance (Warriors only). */
  toggleStance(): void {
    const player = this.state.player;
    if (!player?.classId) return;
    const stances = getClass(player.classId).stances;
    if (stances.length < 2) return;
    const next = stances.find((s) => s.id !== player.stanceId) ?? stances[0];
    this.connection.setStance(next.id);
  }

  update(): void {
    const gcdFraction = clamp01(this.state.gcdRemaining / GCD_MS);
    const player = this.state.player;
    const autoOn = player?.autoAttacking ?? false;

    for (const { slot, btn } of this.buttons.values()) {
      if (slot.action === "autoattack") {
        btn.setActive(autoOn);
        btn.setGcd(0);
        btn.setUnusable(false);
        continue;
      }
      btn.setGcd(gcdFraction);
      const spell = SPELLS[slot.action];
      if (!spell || !player) {
        btn.setUnusable(true);
        continue;
      }
      const cost = spell.cost;
      const usable =
        cost.type === "health"
          ? player.hp > cost.amount
          : player.powerType === cost.type && player.power >= cost.amount;
      btn.setUnusable(!usable);
    }

    this.updateStanceButton();
  }

  private updateStanceButton(): void {
    const player = this.state.player;
    const stances = player?.classId ? getClass(player.classId).stances : [];
    if (!player?.classId || stances.length < 2) {
      this.stanceButton.setHidden(true);
      return;
    }
    const stance = getStance(player.classId, player.stanceId);
    this.stanceButton.setHidden(false);
    this.stanceButton.setName(stance.badge);
    this.stanceButton.setAccent(stance.color);
    this.stanceButton.setGcd(clamp01(this.state.stanceCdRemaining / STANCE_COOLDOWN_MS));
  }

  static defaultSlots(connection: Connection): ActionSlot[] {
    return [
      { key: "1", name: "Auto-Attack", icon: "⚔", action: "autoattack", onActivate: () => connection.toggleAutoAttack() },
      { key: "2", name: "Mortal Strike", icon: "🪓", action: "mortalstrike", onActivate: () => connection.castSpell("mortalstrike") },
      { key: "3", name: "Sinister Strike", icon: "🗡️", action: "sinisterstrike", onActivate: () => connection.castSpell("sinisterstrike") },
      { key: "4", name: "Fireball", icon: "🔥", action: "fireball", onActivate: () => connection.castSpell("fireball") },
    ];
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

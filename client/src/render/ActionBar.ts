/**
 * Bottom action bar. Each slot binds a hotkey to an action and shows live
 * state: the auto-attack toggle highlights while active, spell slots show the
 * Global Cooldown sweep, and slots whose resource the player can't currently
 * pay are dimmed as "unusable".
 */

import { GCD_MS, SPELLS } from "@wow/shared";
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

  constructor(readonly slot: ActionSlot) {
    this.root.className = "action-button";

    const key = document.createElement("div");
    key.className = "key";
    key.textContent = slot.key;

    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = slot.icon;

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = slot.name;

    this.cdOverlay.className = "cd-overlay";

    this.root.append(this.cdOverlay, key, icon, name);
    this.root.title = SPELLS[slot.action]?.description ?? slot.name;
    this.root.addEventListener("click", () => slot.onActivate());
  }

  setActive(active: boolean): void {
    this.root.classList.toggle("active", active);
  }

  setUnusable(unusable: boolean): void {
    this.root.classList.toggle("unusable", unusable);
  }

  setGcd(fraction: number): void {
    this.cdOverlay.style.transform = `scaleY(${fraction})`;
  }
}

export class ActionBar {
  private readonly buttons: SlotButton[] = [];

  constructor(
    root: HTMLElement,
    private readonly state: ClientState,
    slots: ActionSlot[],
  ) {
    for (const slot of slots) {
      const button = new SlotButton(slot);
      this.buttons.push(button);
      root.append(button.root);
    }
  }

  /** Activate by hotkey (called from the input layer). */
  activateKey(key: string): void {
    this.buttons.find((b) => b.slot.key === key)?.slot.onActivate();
  }

  update(): void {
    const gcdFraction = Math.max(0, Math.min(1, this.state.gcdRemaining / GCD_MS));
    const player = this.state.player;
    const autoOn = player?.autoAttacking ?? false;

    for (const button of this.buttons) {
      const action = button.slot.action;
      if (action === "autoattack") {
        button.setActive(autoOn);
        button.setGcd(0);
        button.setUnusable(false);
        continue;
      }

      // Spell slot: GCD sweep + resource availability.
      button.setGcd(gcdFraction);
      const spell = SPELLS[action];
      if (!spell || !player) {
        button.setUnusable(true);
        continue;
      }
      const cost = spell.cost;
      const usable =
        cost.type === "health"
          ? player.hp > cost.amount
          : player.powerType === cost.type && player.power >= cost.amount;
      button.setUnusable(!usable);
    }
  }

  static defaultSlots(connection: Connection): ActionSlot[] {
    return [
      {
        key: "1",
        name: "Auto-Attack",
        icon: "⚔",
        action: "autoattack",
        onActivate: () => connection.toggleAutoAttack(),
      },
      {
        key: "2",
        name: "Mortal Strike",
        icon: "🪓",
        action: "mortalstrike",
        onActivate: () => connection.castSpell("mortalstrike"),
      },
      {
        key: "3",
        name: "Sinister Strike",
        icon: "🗡️",
        action: "sinisterstrike",
        onActivate: () => connection.castSpell("sinisterstrike"),
      },
      {
        key: "4",
        name: "Fireball",
        icon: "🔥",
        action: "fireball",
        onActivate: () => connection.castSpell("fireball"),
      },
    ];
  }
}

/**
 * Class selector. Instantiates the player as a Warrior / Rogue / Mage, which
 * locks in the corresponding resource type server-side. The active class is
 * highlighted from the player's live snapshot.
 */

import { CLASSES, POWER_COLORS, type ClassId } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";
import type { Connection } from "../net/Connection.js";

const ORDER: { classId: ClassId; key: string }[] = [
  { classId: "warrior", key: "Z" },
  { classId: "rogue", key: "X" },
  { classId: "mage", key: "C" },
];

export class ClassBar {
  private readonly buttons = new Map<ClassId, HTMLElement>();

  constructor(
    root: HTMLElement,
    private readonly state: ClientState,
    private readonly connection: Connection,
  ) {
    for (const { classId, key } of ORDER) {
      const def = CLASSES[classId];
      const btn = document.createElement("button");
      btn.className = "profile-button";
      btn.style.setProperty("--accent", POWER_COLORS[def.power]);
      btn.innerHTML = `<span class="pkey">${key}</span>${def.name}<span class="ptype">${def.power}</span>`;
      btn.addEventListener("click", () => this.connection.setClass(classId));
      root.append(btn);
      this.buttons.set(classId, btn);
    }
  }

  /** Switch class by hotkey (called from the input layer). */
  activateKey(classId: ClassId): void {
    this.connection.setClass(classId);
  }

  update(): void {
    const active = this.state.player?.classId;
    for (const [classId, btn] of this.buttons) {
      btn.classList.toggle("active", classId === active);
    }
  }
}

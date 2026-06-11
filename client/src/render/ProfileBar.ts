/**
 * Class/resource profile selector. Lets us swap the player between the Warrior
 * (Rage), Rogue (Energy) and Mage (Mana) profiles to exercise each resource
 * mechanic. The active profile is highlighted based on the player's live power
 * type reported by the server.
 */

import { PROFILES, POWER_COLORS, type ClassProfile } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";
import type { Connection } from "../net/Connection.js";

const ORDER: { profile: ClassProfile; key: string }[] = [
  { profile: "warrior", key: "Z" },
  { profile: "rogue", key: "X" },
  { profile: "mage", key: "C" },
];

export class ProfileBar {
  private readonly buttons = new Map<ClassProfile, HTMLElement>();

  constructor(
    root: HTMLElement,
    private readonly state: ClientState,
    private readonly connection: Connection,
  ) {
    for (const { profile, key } of ORDER) {
      const def = PROFILES[profile];
      const btn = document.createElement("button");
      btn.className = "profile-button";
      btn.style.setProperty("--accent", POWER_COLORS[def.power]);
      btn.innerHTML = `<span class="pkey">${key}</span>${def.label}<span class="ptype">${def.power}</span>`;
      btn.addEventListener("click", () => this.connection.setProfile(profile));
      root.append(btn);
      this.buttons.set(profile, btn);
    }
  }

  /** Switch profile by hotkey (called from the input layer). */
  activateKey(profile: ClassProfile): void {
    this.connection.setProfile(profile);
  }

  update(): void {
    const power = this.state.player?.powerType;
    for (const [profile, btn] of this.buttons) {
      btn.classList.toggle("active", PROFILES[profile].power === power);
    }
  }
}

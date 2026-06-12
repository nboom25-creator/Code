/**
 * On-screen menu buttons for touch devices, covering the actions that are
 * otherwise keyboard-only (Bags = B, Talents = N). Movement uses the virtual
 * joystick; abilities, class swap and stance already have tappable buttons.
 */

import type { CharacterPanel } from "./CharacterPanel.js";
import type { TalentPanel } from "./TalentPanel.js";

export class MobileMenu {
  constructor(parent: HTMLElement, characterPanel: CharacterPanel, talentPanel: TalentPanel) {
    parent.append(
      this.button("🎒", "Bags", () => characterPanel.toggle()),
      this.button("✨", "Talents", () => talentPanel.toggle()),
    );
  }

  private button(icon: string, label: string, onTap: () => void): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "mobile-button";
    btn.innerHTML = `<span class="mb-icon">${icon}</span><span class="mb-label">${label}</span>`;
    btn.addEventListener("click", onTap);
    return btn;
  }
}

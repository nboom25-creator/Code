/**
 * Scrolling combat-text log. Renders the most recent events from state, newest
 * at the bottom, color-coded by damage school / event kind.
 */

import type { CombatLogEvent } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";

const VISIBLE = 12;

export class CombatLog {
  private renderedUpTo = -1;

  constructor(private readonly root: HTMLElement) {}

  update(state: ClientState): void {
    const newest = state.log.length ? state.log[state.log.length - 1].id : -1;
    if (newest === this.renderedUpTo) return;
    this.renderedUpTo = newest;

    const recent = state.log.slice(-VISIBLE);
    this.root.replaceChildren(...recent.map((e) => this.renderEntry(e)));
  }

  private renderEntry(event: CombatLogEvent): HTMLElement {
    const el = document.createElement("div");
    el.className = `entry ${this.classFor(event)}`;
    el.textContent = event.text;
    return el;
  }

  private classFor(event: CombatLogEvent): string {
    if (event.kind === "damage" && event.school) return `school-${event.school}`;
    return `log-${event.kind}`;
  }
}

/**
 * Center-screen cast bar for the local player. Interpolates smoothly between
 * server snapshots so the bar fills fluidly at the cast's wall-clock rate.
 */

import type { ClientState } from "../state/ClientState.js";

export class CastBar {
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;
  private lastSpellId: string | null = null;
  private localElapsed = 0;
  private lastFrame = performance.now();

  constructor(private readonly container: HTMLElement) {
    const bar = document.createElement("div");
    bar.className = "cast-bar";
    this.fill = document.createElement("div");
    this.fill.className = "fill";
    this.label = document.createElement("div");
    this.label.className = "label";
    bar.append(this.fill, this.label);
    container.append(bar);
  }

  update(state: ClientState): void {
    const now = performance.now();
    const frameDt = now - this.lastFrame;
    this.lastFrame = now;

    const cast = state.player?.cast ?? null;
    if (!cast) {
      this.container.classList.remove("active");
      this.lastSpellId = null;
      return;
    }

    // Re-sync local elapsed when the server snapshot arrives / a new cast starts.
    if (cast.spellId !== this.lastSpellId) {
      this.lastSpellId = cast.spellId;
      this.localElapsed = cast.elapsed;
    } else {
      // Advance locally, but trust the server snapshot as the anchor.
      this.localElapsed = Math.max(this.localElapsed + frameDt, cast.elapsed);
      this.localElapsed = Math.min(this.localElapsed, cast.total);
    }

    const pct = cast.total > 0 ? this.localElapsed / cast.total : 0;
    this.container.classList.add("active");
    this.fill.style.transform = `scaleX(${pct})`;
    const remaining = Math.max(0, (cast.total - this.localElapsed) / 1000);
    this.label.innerHTML = `<span>${cast.spellName}</span><span>${remaining.toFixed(1)}s</span>`;
  }
}

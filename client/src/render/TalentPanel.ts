/**
 * Toggleable talent-tree overlay (bound to 'N'). Renders one node per talent
 * with a "+" to spend a point and a rank pip readout, plus a points counter and
 * a Reset button. Spending immediately fires a WebSocket message — the panel
 * never mutates ranks locally; it re-renders from the authoritative talent
 * state in the next snapshot, which prevents client/server drift.
 */

import { TALENTS, type TalentDef } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";
import type { Connection } from "../net/Connection.js";

class TalentNode {
  readonly root = document.createElement("div");
  private readonly rankEl = document.createElement("div");
  private readonly descEl = document.createElement("div");
  private readonly plus = document.createElement("button");

  constructor(
    private readonly talent: TalentDef,
    onSpend: () => void,
  ) {
    this.root.className = "talent-node";

    const title = document.createElement("div");
    title.className = "talent-name";
    title.textContent = talent.name;

    this.rankEl.className = "talent-rank";
    this.descEl.className = "talent-desc";

    this.plus.className = "talent-plus";
    this.plus.textContent = "+";
    this.plus.addEventListener("click", onSpend);

    this.root.append(title, this.rankEl, this.descEl, this.plus);
  }

  update(rank: number, pointsAvailable: boolean): void {
    const max = this.talent.maxRank;
    this.rankEl.textContent = `${rank} / ${max}`;
    this.descEl.textContent = this.talent.describe(Math.max(1, rank));
    const maxed = rank >= max;
    this.plus.disabled = maxed || !pointsAvailable;
    this.root.classList.toggle("maxed", maxed);
    this.root.classList.toggle("learned", rank > 0);
  }
}

export class TalentPanel {
  private readonly root = document.createElement("div");
  private readonly pointsEl = document.createElement("span");
  private readonly nodes: TalentNode[] = [];
  private visible = false;

  constructor(
    parent: HTMLElement,
    private readonly state: ClientState,
    private readonly connection: Connection,
  ) {
    this.root.className = "talent-panel hidden";

    const header = document.createElement("div");
    header.className = "talent-header";
    const title = document.createElement("span");
    title.textContent = "Talents";
    header.append(title, this.pointsEl);

    const grid = document.createElement("div");
    grid.className = "talent-grid";
    for (const talent of TALENTS) {
      const node = new TalentNode(talent, () => this.connection.spendTalent(talent.id));
      this.nodes.push(node);
      grid.append(node.root);
    }

    const footer = document.createElement("div");
    footer.className = "talent-footer";
    const reset = document.createElement("button");
    reset.className = "talent-reset";
    reset.textContent = "Reset Talents";
    reset.addEventListener("click", () => this.connection.resetTalents());
    const hint = document.createElement("span");
    hint.className = "talent-hint";
    hint.textContent = "Press N to close";
    footer.append(reset, hint);

    this.root.append(header, grid, footer);
    parent.append(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle("hidden", !this.visible);
  }

  update(): void {
    if (!this.visible) return;
    const talents = this.state.talents;
    const available = talents.pointsTotal - talents.pointsSpent;
    this.pointsEl.className = "talent-points";
    this.pointsEl.textContent = `${available} / ${talents.pointsTotal} points`;
    TALENTS.forEach((talent, i) => {
      this.nodes[i].update(talents.ranks[talent.id] ?? 0, available > 0);
    });
  }
}

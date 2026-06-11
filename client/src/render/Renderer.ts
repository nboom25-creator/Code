/**
 * Canvas world renderer. Draws entities as simple colored circles with a
 * camera centered on the local player, plus floating nameplates and the
 * selection ring for the current target.
 */

import { MELEE_RANGE } from "@wow/shared";
import type { EntitySnapshot } from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";

const COLORS = {
  player: "#3f7fff",
  monster: "#d24b4b",
  grid: "rgba(255,255,255,0.04)",
  selection: "#ffd34d",
};

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly state: ClientState) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Convert a world point to a screen point using the player-centered camera. */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const player = this.state.player;
    const camX = player?.x ?? 0;
    const camY = player?.y ?? 0;
    return {
      x: this.width / 2 + (wx - camX),
      y: this.height / 2 + (wy - camY),
    };
  }

  /** Inverse mapping — used by click-to-target hit testing. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const player = this.state.player;
    const camX = player?.x ?? 0;
    const camY = player?.y ?? 0;
    return {
      x: sx - this.width / 2 + camX,
      y: sy - this.height / 2 + camY,
    };
  }

  render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawGrid();

    for (const entity of this.state.entities.values()) {
      this.drawEntity(entity);
    }
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const spacing = 50;
    const origin = this.worldToScreen(0, 0);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = origin.x % spacing; x < this.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = origin.y % spacing; y < this.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  private drawEntity(entity: EntitySnapshot): void {
    const ctx = this.ctx;
    const { x, y } = this.worldToScreen(entity.x, entity.y);
    const radius = entity.kind === "player" ? 16 : 20;
    const isTarget = this.state.player?.targetId === entity.id;

    // Selection ring
    if (isTarget) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Body
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = entity.kind === "player" ? COLORS.player : COLORS.monster;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();

    // Casting indicator (pulsing outline)
    if (entity.cast) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffd34d";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    this.drawNameplate(entity, x, y - radius - 10);
  }

  private drawNameplate(entity: EntitySnapshot, x: number, y: number): void {
    const ctx = this.ctx;
    const w = 70;
    const h = 6;

    // Mini health bar
    ctx.fillStyle = "#000";
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = entity.kind === "player" ? "#3fbf52" : "#d24b4b";
    const pct = entity.maxHp > 0 ? entity.hp / entity.maxHp : 0;
    ctx.fillRect(x - w / 2, y, w * pct, h);

    // Name
    ctx.fillStyle = "#e8e0c8";
    ctx.font = "11px Trebuchet MS, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(entity.name, x, y - 4);
  }

  /** Distance helper exposed for the input layer (in melee range coloring etc). */
  static meleeRange = MELEE_RANGE;
}

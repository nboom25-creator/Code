/**
 * Keyboard + mouse input. Translates raw events into network commands:
 * movement vectors, action-bar hotkeys, Tab/click targeting.
 */

import type { ClassId } from "@wow/shared";
import type { Connection } from "../net/Connection.js";
import type { ClientState } from "../state/ClientState.js";
import type { Renderer } from "../render/Renderer.js";
import type { ActionBar } from "../render/ActionBar.js";
import type { ClassBar } from "../render/ClassBar.js";
import type { TalentPanel } from "../render/TalentPanel.js";
import type { CharacterPanel } from "../render/CharacterPanel.js";

const CLASS_KEYS: Record<string, ClassId> = {
  KeyZ: "warrior",
  KeyX: "rogue",
  KeyC: "mage",
};

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class Input {
  private readonly pressed = new Set<string>();
  private tabIndex = 0;

  constructor(
    private readonly connection: Connection,
    private readonly state: ClientState,
    private readonly renderer: Renderer,
    private readonly actionBar: ActionBar,
    private readonly classBar: ClassBar,
    private readonly talentPanel: TalentPanel,
    private readonly characterPanel: CharacterPanel,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  attach(): void {
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => this.onKeyUp(e));
    this.canvas.addEventListener("mousedown", (e) => this.onClick(e));
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;

    // Action bar hotkeys.
    if (["1", "2", "3", "4"].includes(e.key)) {
      this.actionBar.activateKey(e.key);
      return;
    }
    // Stance toggle (Warriors).
    if (e.code === "KeyR") {
      this.actionBar.toggleStance();
      return;
    }
    // Talent panel.
    if (e.code === "KeyN") {
      this.talentPanel.toggle();
      return;
    }
    // Character & bag panel.
    if (e.code === "KeyB") {
      this.characterPanel.toggle();
      return;
    }
    // Class swap hotkeys.
    if (CLASS_KEYS[e.code]) {
      this.classBar.activateKey(CLASS_KEYS[e.code]);
      return;
    }
    // Targeting.
    if (e.code === "Tab") {
      e.preventDefault();
      this.cycleTarget();
      return;
    }
    if (e.code === "Escape") {
      this.connection.setTarget(null);
      return;
    }
    // Movement.
    if (MOVE_KEYS[e.code]) {
      this.pressed.add(e.code);
      this.updateMovement();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (MOVE_KEYS[e.code]) {
      this.pressed.delete(e.code);
      this.updateMovement();
    }
  }

  private updateMovement(): void {
    let dx = 0;
    let dy = 0;
    for (const code of this.pressed) {
      const [mx, my] = MOVE_KEYS[code];
      dx += mx;
      dy += my;
    }
    this.connection.setMove(Math.sign(dx), Math.sign(dy));
  }

  private cycleTarget(): void {
    const targets = this.state.targetables();
    if (targets.length === 0) return;
    this.tabIndex = (this.tabIndex + 1) % targets.length;
    this.connection.setTarget(targets[this.tabIndex].id);
  }

  private onClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const world = this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    let picked: number | null = null;
    let bestDist = Infinity;
    for (const entity of this.state.entities.values()) {
      if (entity.id === this.state.playerId) continue;
      const d = Math.hypot(entity.x - world.x, entity.y - world.y);
      const radius = entity.kind === "player" ? 16 : 20;
      if (d <= radius + 8 && d < bestDist) {
        bestDist = d;
        picked = entity.id;
      }
    }
    if (picked != null) this.connection.setTarget(picked);
  }
}

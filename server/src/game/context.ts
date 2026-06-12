/**
 * Per-tick context handed to every system, plus the combat-log sink that
 * systems use to broadcast human-readable events to clients.
 */

import type { CombatLogEvent, CombatLogKind, DamageSchool } from "@wow/shared";
import type { World } from "../ecs/World.js";

/** Collects combat-log events during a tick; drained by the network layer. */
export class CombatLog {
  private buffer: CombatLogEvent[] = [];
  private seq = 0;

  push(kind: CombatLogKind, text: string, school?: DamageSchool): void {
    this.buffer.push({ id: this.seq++, kind, text, school, time: Date.now() });
  }

  /** Return and clear the buffered events. */
  drain(): CombatLogEvent[] {
    if (this.buffer.length === 0) return [];
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}

export interface GameContext {
  world: World;
  /** Absolute server time in ms (Date.now() at tick start). */
  now: number;
  /** Delta time since the previous tick, in seconds. */
  dt: number;
  log: CombatLog;
}

export interface System {
  readonly name: string;
  update(ctx: GameContext): void;
}

/**
 * Client-side mirror of the authoritative world. The server is the source of
 * truth; this object simply caches the most recent snapshot plus a rolling
 * combat-log buffer for the UI to read each frame.
 */

import type { CombatLogEvent, EntitySnapshot } from "@wow/shared";

const MAX_LOG = 50;

export class ClientState {
  playerId: number | null = null;
  entities = new Map<number, EntitySnapshot>();
  gcdRemaining = 0;
  /** Server time of the latest snapshot (ms). */
  serverTime = 0;
  /** Local clock offset estimate vs. server, for smooth cast bars. */
  log: CombatLogEvent[] = [];

  applySnapshot(entities: EntitySnapshot[], gcdRemaining: number, serverTime: number): void {
    this.entities.clear();
    for (const e of entities) this.entities.set(e.id, e);
    this.gcdRemaining = gcdRemaining;
    this.serverTime = serverTime;
  }

  appendLog(events: CombatLogEvent[]): void {
    this.log.push(...events);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  get player(): EntitySnapshot | undefined {
    return this.playerId != null ? this.entities.get(this.playerId) : undefined;
  }

  get target(): EntitySnapshot | undefined {
    const tid = this.player?.targetId;
    return tid != null ? this.entities.get(tid) : undefined;
  }

  /** All entities the player could target (everything but itself). */
  targetables(): EntitySnapshot[] {
    return [...this.entities.values()].filter((e) => e.id !== this.playerId);
  }
}

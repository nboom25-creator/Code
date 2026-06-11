/**
 * Client-side mirror of the authoritative world. The server is the source of
 * truth; this object simply caches the most recent snapshot plus a rolling
 * combat-log buffer for the UI to read each frame.
 */

import type {
  ContainerState,
  CombatLogEvent,
  EntitySnapshot,
  SnapshotMessage,
  TalentState,
} from "@wow/shared";

const MAX_LOG = 50;

const EMPTY_TALENTS: TalentState = { ranks: {}, pointsTotal: 0, pointsSpent: 0 };
const EMPTY_CONTAINERS: ContainerState = {
  inventory: [],
  equipment: { head: null, chest: null, hands: null, legs: null, mainhand: null },
};

export class ClientState {
  playerId: number | null = null;
  entities = new Map<number, EntitySnapshot>();
  gcdRemaining = 0;
  stanceCdRemaining = 0;
  /** The controlling player's talent allocation (authoritative, server-sent). */
  talents: TalentState = EMPTY_TALENTS;
  /** The controlling player's backpack + equipped gear (authoritative). */
  containers: ContainerState = EMPTY_CONTAINERS;
  /** Server time of the latest snapshot (ms). */
  serverTime = 0;
  log: CombatLogEvent[] = [];

  applySnapshot(msg: SnapshotMessage): void {
    this.entities.clear();
    for (const e of msg.entities) this.entities.set(e.id, e);
    this.gcdRemaining = msg.gcdRemaining;
    this.stanceCdRemaining = msg.stanceCdRemaining;
    this.talents = msg.talents;
    this.containers = msg.containers;
    this.serverTime = msg.serverTime;
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

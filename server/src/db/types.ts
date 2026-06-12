import type { ClassId, EquipSlot } from "@wow/shared";

/** Full, serializable snapshot of a player's persisted account state. */
export interface PersistedPlayer {
  /** Primary key in the `players` table. */
  id: number;
  username: string;
  classType: ClassId;
  level: number;
  x: number;
  y: number;
  currentHp: number;
  /** Current value of the active resource (mana / energy / rage). */
  currentResource: number;
  /** Equipped item id per slot (null = empty). */
  gear: Record<EquipSlot, string | null>;
  /** Backpack: item id per slot index (null = empty), length INVENTORY_SIZE. */
  inventory: (string | null)[];
  /** Allocated talent ranks keyed by talent id. */
  talents: Record<string, number>;
}

/** Lightweight state persisted by the auto-save heartbeat. */
export interface LightState {
  id: number;
  x: number;
  y: number;
  currentHp: number;
  currentResource: number;
}

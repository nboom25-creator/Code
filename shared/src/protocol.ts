/**
 * Network protocol shared by client and server.
 *
 * All messages are JSON objects with a discriminating `type` field. Keeping
 * these definitions in one place guarantees the wire format never drifts
 * between the two sides.
 */

import type { DamageSchool } from "./spells.js";
import type { PowerType } from "./resources.js";
import type { ClassId } from "./classes.js";
import type { TalentState } from "./talents.js";
import type { EquipSlot } from "./items.js";

export type EntityKind = "player" | "monster";

/** Monster AI states (see the server MonsterAISystem). */
export type AIState = "idle" | "patrol" | "chase" | "evade";

/** A single entity as serialized in a world snapshot. */
export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Active resource (mana / energy / rage) — drives the unit-frame bar. */
  power: number;
  maxPower: number;
  powerType: PowerType;
  /** Class identity and current stance/form, for nameplates and buff badges. */
  classId: ClassId | null;
  stanceId: string;
  inCombat: boolean;
  targetId: number | null;
  /** Active spell cast, or null when not casting. */
  cast: CastSnapshot | null;
  /** Whether auto-attack is toggled on (players only). */
  autoAttacking: boolean;
  /** Lootable item ids on this entity's corpse (empty unless dead with loot). */
  loot: string[];
  /** Monster AI state (null for players). */
  aiState: AIState | null;
  /** Proximity aggro radius in world units (0 for players). */
  aggroRadius: number;
}

/** Player-owned containers, sent only to the controlling client. */
export interface ContainerState {
  /** Backpack: item id per slot, or null for an empty slot. */
  inventory: (string | null)[];
  /** Equipped item id per slot. */
  equipment: Record<EquipSlot, string | null>;
}

export interface CastSnapshot {
  spellId: string;
  spellName: string;
  /** Total cast time in ms. */
  total: number;
  /** Elapsed time in ms. */
  elapsed: number;
}

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface WelcomeMessage {
  type: "welcome";
  /** The entity id the connecting client controls. */
  playerId: number;
  /** The account name that was logged in. */
  username: string;
}

/** Sent when a login attempt is rejected (e.g. already online). */
export interface LoginErrorMessage {
  type: "loginError";
  message: string;
}

export interface SnapshotMessage {
  type: "snapshot";
  serverTime: number;
  entities: EntitySnapshot[];
  /** Remaining Global Cooldown in ms for the receiving player. */
  gcdRemaining: number;
  /** Remaining stance-swap cooldown in ms for the receiving player. */
  stanceCdRemaining: number;
  /** The receiving player's allocated talents. */
  talents: TalentState;
  /** The receiving player's backpack + equipped gear. */
  containers: ContainerState;
}

export interface CombatLogMessage {
  type: "combatLog";
  events: CombatLogEvent[];
}

export type CombatLogKind =
  | "damage"
  | "crit"
  | "heal"
  | "resource"
  | "miss"
  | "cast"
  | "info";

export interface CombatLogEvent {
  id: number;
  kind: CombatLogKind;
  text: string;
  school?: DamageSchool;
  /** Server timestamp (ms). */
  time: number;
}

export type ServerMessage =
  | WelcomeMessage
  | LoginErrorMessage
  | SnapshotMessage
  | CombatLogMessage;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface SetTargetMessage {
  type: "setTarget";
  targetId: number | null;
}

export interface CastSpellMessage {
  type: "castSpell";
  spellId: string;
}

export interface ToggleAutoAttackMessage {
  type: "toggleAutoAttack";
}

/** Continuous movement intent expressed as a normalized direction vector. */
export interface MoveMessage {
  type: "move";
  dx: number;
  dy: number;
}

/** Instantiate the player as a class, locking in its resource type. */
export interface SetClassMessage {
  type: "setClass";
  classId: ClassId;
}

/** Switch the active stance/form (subject to the stance cooldown). */
export interface SetStanceMessage {
  type: "setStance";
  stanceId: string;
}

/** Spend one talent point in the named talent. */
export interface SpendTalentMessage {
  type: "spendTalent";
  talentId: string;
}

/** Refund all spent talent points. */
export interface ResetTalentsMessage {
  type: "resetTalents";
}

/** Equip the item in a backpack slot to its matching equipment slot. */
export interface EquipItemMessage {
  type: "equipItem";
  bagIndex: number;
}

/** Unequip the item in an equipment slot back into the backpack. */
export interface UnequipItemMessage {
  type: "unequipItem";
  slot: EquipSlot;
}

/** Take an item off a monster's corpse into the backpack. */
export interface LootItemMessage {
  type: "lootItem";
  sourceId: number;
  lootIndex: number;
}

/** First message a client sends: log into (or create) an account. */
export interface LoginMessage {
  type: "login";
  username: string;
}

export type DevCommandName = "save" | "item" | "spawn";

/** GM/developer slash command from the dev console. */
export interface DevCommandMessage {
  type: "devCommand";
  command: DevCommandName;
  arg?: string;
}

export type ClientMessage =
  | LoginMessage
  | SetTargetMessage
  | CastSpellMessage
  | ToggleAutoAttackMessage
  | MoveMessage
  | SetClassMessage
  | SetStanceMessage
  | SpendTalentMessage
  | ResetTalentsMessage
  | EquipItemMessage
  | UnequipItemMessage
  | LootItemMessage
  | DevCommandMessage;

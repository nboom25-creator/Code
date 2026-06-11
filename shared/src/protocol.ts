/**
 * Network protocol shared by client and server.
 *
 * All messages are JSON objects with a discriminating `type` field. Keeping
 * these definitions in one place guarantees the wire format never drifts
 * between the two sides.
 */

import type { DamageSchool } from "./spells.js";
import type { ClassProfile, PowerType } from "./resources.js";

export type EntityKind = "player" | "monster";

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
  inCombat: boolean;
  targetId: number | null;
  /** Active spell cast, or null when not casting. */
  cast: CastSnapshot | null;
  /** Whether auto-attack is toggled on (players only). */
  autoAttacking: boolean;
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
}

export interface SnapshotMessage {
  type: "snapshot";
  serverTime: number;
  entities: EntitySnapshot[];
  /** Remaining Global Cooldown in ms for the receiving player. */
  gcdRemaining: number;
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

/** Swap the player's class profile, changing the active resource type. */
export interface SetProfileMessage {
  type: "setProfile";
  profile: ClassProfile;
}

export type ClientMessage =
  | SetTargetMessage
  | CastSpellMessage
  | ToggleAutoAttackMessage
  | MoveMessage
  | SetProfileMessage;

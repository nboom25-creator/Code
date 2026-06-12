/**
 * Shared tuning constants for the combat engine.
 *
 * These live in `shared/` so the server (authoritative simulation) and the
 * client (prediction / UI) agree on the same numbers. The server is always the
 * source of truth; the client only uses these for smooth rendering.
 */

/** Global Cooldown duration in milliseconds (Classic WoW baseline = 1.5s). */
export const GCD_MS = 1500;

/** Stance/form swaps are gated by a short cooldown, separate from the GCD. */
export const STANCE_COOLDOWN_MS = 1000;

/** Default weapon swing timer in milliseconds (auto-attack cadence). */
export const SWING_TIMER_MS = 2000;

/** Server simulation tick rate. */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

/** How often the server pushes a world snapshot to clients (ms). */
export const SNAPSHOT_INTERVAL_MS = 50;

/** Melee range (world units). Auto-attacks only land inside this radius. */
export const MELEE_RANGE = 64;

/** Movement speed for player input (world units per second). */
export const MOVE_SPEED = 120;

/** Logical world / canvas dimensions shared by server spawns and renderer. */
export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 600;

// ---------------------------------------------------------------------------
// Combat matrix (attack table)
// ---------------------------------------------------------------------------

/** Base chance (%) for a melee attack to miss. */
export const BASE_MISS_CHANCE = 5;
/** Base chance (%) for a defender to dodge a melee attack. */
export const BASE_DODGE_CHANCE = 5;
/** Melee critical strikes deal this multiple of normal damage. */
export const MELEE_CRIT_MULTIPLIER = 2.0;

/** Classic armor mitigation curve: reduction = armor / (armor + K + level*PER). */
export const ARMOR_CONSTANT = 400;
export const ARMOR_PER_LEVEL = 85;
/** Everything currently assumes level 1. */
export const DEFAULT_LEVEL = 1;

// ---------------------------------------------------------------------------
// Resource regeneration
// ---------------------------------------------------------------------------

/** Energy regenerates in discrete ticks: +AMOUNT every INTERVAL ms. */
export const ENERGY_TICK_INTERVAL_MS = 2000;
export const ENERGY_TICK_AMOUNT = 20;

/** Rage decays by this many points per second while out of combat. */
export const RAGE_DECAY_PER_SEC = 1;
/** Rage generated = damage / RAGE_DAMAGE_DIVISOR (both dealing and taking). */
export const RAGE_DAMAGE_DIVISOR = 2;

/** Default continuous mana regen (points per second). */
export const MANA_REGEN_PER_SEC = 8;
/** Default out-of-combat health regen (points per second). */
export const HP_REGEN_PER_SEC = 6;

/** Each point of Stamina above the class base grants this much Max HP. */
export const HP_PER_STAMINA = 10;

/** Delay before a slain monster respawns (ms). */
export const MONSTER_RESPAWN_MS = 6000;

// ---------------------------------------------------------------------------
// Monster AI: navigation, aggro, social pulls and leashing
// ---------------------------------------------------------------------------

/** Base monster walk speed during PATROL (world units / second). */
export const MONSTER_WALK_SPEED = 70;
/** CHASE runs 50% faster than the walk speed. */
export const CHASE_SPEED_MULT = 1.5;
/** EVADE runs 200% faster (3x) than the walk speed, with CC immunity. */
export const EVADE_SPEED_MULT = 3.0;

/** Proximity aggro radius: a player inside this circle pulls the monster. */
export const AGGRO_RADIUS = 120;
/** Social aggro radius: nearby friendly monsters joined into the fight. */
export const SOCIAL_RADIUS = 60;
/** Max distance from HomePosition before the monster leashes and evades. */
export const LEASH_RANGE = 400;
/** Distance from home considered "arrived" when returning from EVADE. */
export const HOME_ARRIVE_EPSILON = 8;
/** Fraction of max HP regenerated per second while evading. */
export const EVADE_HEAL_PER_SEC = 1.0;


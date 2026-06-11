/**
 * Shared tuning constants for the combat engine.
 *
 * These live in `shared/` so the server (authoritative simulation) and the
 * client (prediction / UI) agree on the same numbers. The server is always the
 * source of truth; the client only uses these for smooth rendering.
 */

/** Global Cooldown duration in milliseconds (Classic WoW baseline = 1.5s). */
export const GCD_MS = 1500;

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

/**
 * File-based player persistence — a dependency-free JSON store.
 *
 * This replaces the native SQLite driver so the server installs and runs
 * anywhere Node does (including phones via Termux) with no compilation. It
 * keeps the exact same public API and validation as before: every record is
 * sanitized against the shared item/talent/class catalogs on load *and* save,
 * and writes are atomic (temp file + rename) so a crash mid-save can't corrupt
 * the file.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  EQUIP_SLOTS,
  INVENTORY_SIZE,
  getClass,
  getItem,
  getTalent,
  type ClassId,
  type EquipSlot,
} from "@wow/shared";
import type { LightState, PersistedPlayer } from "./types.js";

const DEFAULT_CLASS: ClassId = "mage";
const DEFAULT_INVENTORY = ["whirlwind_axe", "robes_archmage", "tattered_gloves"];

interface StoreFile {
  nextId: number;
  /** Keyed by stringified player id. */
  players: Record<string, PersistedPlayer>;
}

function emptyGear(): Record<EquipSlot, string | null> {
  return Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])) as Record<EquipSlot, string | null>;
}
function safeNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export class PlayerStore {
  private data: StoreFile = { nextId: 1, players: {} };

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as StoreFile;
      const players: Record<string, PersistedPlayer> = {};
      let maxId = 0;
      for (const rec of Object.values(parsed.players ?? {})) {
        const clean = this.sanitize(rec);
        players[String(clean.id)] = clean;
        maxId = Math.max(maxId, clean.id);
      }
      this.data = { nextId: Math.max(safeNumber(parsed.nextId, 1), maxId + 1), players };
    } catch {
      // Corrupt or unreadable file: start fresh rather than crash.
      console.warn(`[store] could not read ${this.filePath}; starting empty`);
      this.data = { nextId: 1, players: {} };
    }
  }

  private persist(): void {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.filePath); // atomic replace
  }

  /** Load an existing account, or create a fresh one with default gear. */
  loadOrCreate(username: string): PersistedPlayer {
    const existing = Object.values(this.data.players).find(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );
    if (existing) return structuredClone(existing);
    const record = this.createDefault(username);
    this.data.players[String(record.id)] = record;
    this.persist();
    return structuredClone(record);
  }

  private createDefault(username: string): PersistedPlayer {
    const def = getClass(DEFAULT_CLASS);
    const inventory: (string | null)[] = new Array(INVENTORY_SIZE).fill(null);
    DEFAULT_INVENTORY.forEach((item, i) => (inventory[i] = item));
    return {
      id: this.data.nextId++,
      username,
      classType: DEFAULT_CLASS,
      level: 1,
      x: 0,
      y: 0,
      currentHp: def.base.hp,
      currentResource: def.powerStart,
      gear: emptyGear(),
      inventory,
      talents: {},
    };
  }

  /** Persist a full player record (validated before writing). */
  saveFull(record: PersistedPlayer): void {
    const clean = this.sanitize(record);
    this.data.players[String(clean.id)] = clean;
    this.persist();
  }

  /** Batch-persist lightweight state (position + resources) for the heartbeat. */
  saveLightBatch(list: LightState[]): void {
    if (list.length === 0) return;
    let touched = false;
    for (const s of list) {
      const rec = this.data.players[String(s.id)];
      if (!rec) continue;
      rec.x = safeNumber(s.x);
      rec.y = safeNumber(s.y);
      rec.currentHp = Math.max(0, Math.round(safeNumber(s.currentHp)));
      rec.currentResource = Math.max(0, Math.round(safeNumber(s.currentResource)));
      touched = true;
    }
    if (touched) this.persist();
  }

  close(): void {
    this.persist();
  }

  /** Validate/normalize a record against the shared catalogs. */
  private sanitize(rec: PersistedPlayer): PersistedPlayer {
    const classType: ClassId = getClass(rec.classType) ? rec.classType : DEFAULT_CLASS;

    const gear = emptyGear();
    for (const slot of EQUIP_SLOTS) {
      const itemId = rec.gear?.[slot];
      if (itemId && getItem(itemId)) gear[slot] = itemId;
    }

    const inventory: (string | null)[] = new Array(INVENTORY_SIZE).fill(null);
    const src = Array.isArray(rec.inventory) ? rec.inventory : [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const itemId = src[i];
      inventory[i] = itemId && getItem(itemId) ? itemId : null;
    }

    const talents: Record<string, number> = {};
    for (const [talentId, rank] of Object.entries(rec.talents ?? {})) {
      const t = getTalent(talentId);
      const r = Math.round(safeNumber(rank));
      if (t && r > 0) talents[talentId] = Math.min(r, t.maxRank);
    }

    return {
      id: Math.round(safeNumber(rec.id, this.data.nextId)),
      username: String(rec.username ?? "Adventurer"),
      classType,
      level: Math.max(1, Math.round(safeNumber(rec.level, 1))),
      x: safeNumber(rec.x),
      y: safeNumber(rec.y),
      currentHp: Math.max(0, Math.round(safeNumber(rec.currentHp, getClass(classType).base.hp))),
      currentResource: Math.max(0, Math.round(safeNumber(rec.currentResource))),
      gear,
      inventory,
      talents,
    };
  }
}

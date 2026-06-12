/**
 * Embedded SQLite persistence layer (better-sqlite3 — synchronous, ideal for
 * the blocking save-on-logout transaction).
 *
 * All writes are validated against the shared item/talent/class catalogs before
 * touching disk: an unknown item id, slot name or talent never gets persisted,
 * which keeps the save files consistent across server sessions and prevents
 * item duplication / corruption.
 */

import Database from "better-sqlite3";
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
/** Items a brand-new character starts with in their backpack. */
const DEFAULT_INVENTORY = ["whirlwind_axe", "robes_archmage", "tattered_gloves"];

interface PlayerRow {
  id: number;
  username: string;
  class_type: string;
  level: number;
  x: number;
  y: number;
  current_hp: number;
  current_mana_or_resource: number;
}

function emptyGear(): Record<EquipSlot, string | null> {
  return Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])) as Record<EquipSlot, string | null>;
}

function safeNumber(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

export class PlayerStore {
  private readonly db: Database.Database;

  // Prepared statements
  private readonly selPlayer;
  private readonly insPlayer;
  private readonly updPlayer;
  private readonly updLight;
  private readonly selGear;
  private readonly delGear;
  private readonly insGear;
  private readonly selInv;
  private readonly delInv;
  private readonly insInv;
  private readonly selTal;
  private readonly delTal;
  private readonly insTal;

  private readonly saveTx: Database.Transaction;
  private readonly lightTx: Database.Transaction;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();

    this.selPlayer = this.db.prepare<[string]>("SELECT * FROM players WHERE username = ?");
    this.insPlayer = this.db.prepare(
      `INSERT INTO players (username, class_type, level, x, y, current_hp, current_mana_or_resource)
       VALUES (@username, @class_type, @level, @x, @y, @current_hp, @current_mana_or_resource)`,
    );
    this.updPlayer = this.db.prepare(
      `UPDATE players SET class_type=@class_type, level=@level, x=@x, y=@y,
         current_hp=@current_hp, current_mana_or_resource=@current_mana_or_resource WHERE id=@id`,
    );
    this.updLight = this.db.prepare(
      `UPDATE players SET x=@x, y=@y, current_hp=@current_hp,
         current_mana_or_resource=@current_mana_or_resource WHERE id=@id`,
    );

    this.selGear = this.db.prepare<[number]>("SELECT slot_name, item_id FROM player_gear WHERE player_id = ?");
    this.delGear = this.db.prepare<[number]>("DELETE FROM player_gear WHERE player_id = ?");
    this.insGear = this.db.prepare("INSERT INTO player_gear (player_id, slot_name, item_id) VALUES (?, ?, ?)");

    this.selInv = this.db.prepare<[number]>("SELECT slot_index, item_id FROM player_inventory WHERE player_id = ?");
    this.delInv = this.db.prepare<[number]>("DELETE FROM player_inventory WHERE player_id = ?");
    this.insInv = this.db.prepare("INSERT INTO player_inventory (player_id, slot_index, item_id) VALUES (?, ?, ?)");

    this.selTal = this.db.prepare<[number]>("SELECT talent_id, rank FROM player_talents WHERE player_id = ?");
    this.delTal = this.db.prepare<[number]>("DELETE FROM player_talents WHERE player_id = ?");
    this.insTal = this.db.prepare("INSERT INTO player_talents (player_id, talent_id, rank) VALUES (?, ?, ?)");

    // A single atomic transaction guarantees no half-written saves on logout.
    this.saveTx = this.db.transaction((rec: PersistedPlayer) => this.writeFull(rec));
    this.lightTx = this.db.transaction((list: LightState[]) => {
      for (const s of list) {
        this.updLight.run({
          id: s.id,
          x: safeNumber(s.x),
          y: safeNumber(s.y),
          current_hp: Math.max(0, Math.round(safeNumber(s.currentHp))),
          current_mana_or_resource: Math.max(0, Math.round(safeNumber(s.currentResource))),
        });
      }
    });
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        class_type TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        current_hp INTEGER NOT NULL,
        current_mana_or_resource INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_gear (
        player_id INTEGER NOT NULL,
        slot_name TEXT NOT NULL,
        item_id TEXT NOT NULL,
        PRIMARY KEY (player_id, slot_name),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS player_inventory (
        player_id INTEGER NOT NULL,
        slot_index INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        PRIMARY KEY (player_id, slot_index),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS player_talents (
        player_id INTEGER NOT NULL,
        talent_id TEXT NOT NULL,
        rank INTEGER NOT NULL,
        PRIMARY KEY (player_id, talent_id),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
    `);
  }

  /** Load an existing account, or create a fresh one with default gear. */
  loadOrCreate(username: string): PersistedPlayer {
    const row = this.selPlayer.get(username) as PlayerRow | undefined;
    return row ? this.hydrate(row) : this.create(username);
  }

  private create(username: string): PersistedPlayer {
    const def = getClass(DEFAULT_CLASS);
    const info = this.insPlayer.run({
      username,
      class_type: DEFAULT_CLASS,
      level: 1,
      x: 0,
      y: 0,
      current_hp: def.base.hp,
      current_mana_or_resource: def.powerStart,
    });
    const inventory: (string | null)[] = new Array(INVENTORY_SIZE).fill(null);
    DEFAULT_INVENTORY.forEach((item, i) => (inventory[i] = item));

    const record: PersistedPlayer = {
      id: Number(info.lastInsertRowid),
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
    this.saveFull(record); // persist the seeded inventory immediately
    return record;
  }

  /** Build a validated PersistedPlayer from a DB row + its child tables. */
  private hydrate(row: PlayerRow): PersistedPlayer {
    const classType: ClassId = getClass(row.class_type as ClassId) ? (row.class_type as ClassId) : DEFAULT_CLASS;

    const gear = emptyGear();
    for (const r of this.selGear.all(row.id) as { slot_name: string; item_id: string }[]) {
      if ((EQUIP_SLOTS as string[]).includes(r.slot_name) && getItem(r.item_id)) {
        gear[r.slot_name as EquipSlot] = r.item_id;
      }
    }

    const inventory: (string | null)[] = new Array(INVENTORY_SIZE).fill(null);
    for (const r of this.selInv.all(row.id) as { slot_index: number; item_id: string }[]) {
      if (r.slot_index >= 0 && r.slot_index < INVENTORY_SIZE && getItem(r.item_id)) {
        inventory[r.slot_index] = r.item_id;
      }
    }

    const talents: Record<string, number> = {};
    for (const r of this.selTal.all(row.id) as { talent_id: string; rank: number }[]) {
      const t = getTalent(r.talent_id);
      if (t && r.rank > 0) talents[r.talent_id] = Math.min(r.rank, t.maxRank);
    }

    return {
      id: row.id,
      username: row.username,
      classType,
      level: row.level,
      x: row.x,
      y: row.y,
      currentHp: row.current_hp,
      currentResource: row.current_mana_or_resource,
      gear,
      inventory,
      talents,
    };
  }

  /** Persist a full player record in one atomic transaction. */
  saveFull(record: PersistedPlayer): void {
    this.saveTx(record);
  }

  private writeFull(rec: PersistedPlayer): void {
    const classType = getClass(rec.classType) ? rec.classType : DEFAULT_CLASS;
    this.updPlayer.run({
      id: rec.id,
      class_type: classType,
      level: Math.max(1, Math.round(safeNumber(rec.level, 1))),
      x: safeNumber(rec.x),
      y: safeNumber(rec.y),
      current_hp: Math.max(0, Math.round(safeNumber(rec.currentHp))),
      current_mana_or_resource: Math.max(0, Math.round(safeNumber(rec.currentResource))),
    });

    // Gear: validate slot + item before writing.
    this.delGear.run(rec.id);
    for (const slot of EQUIP_SLOTS) {
      const itemId = rec.gear[slot];
      if (itemId && getItem(itemId)) this.insGear.run(rec.id, slot, itemId);
    }

    // Inventory: validate index range + item before writing.
    this.delInv.run(rec.id);
    rec.inventory.forEach((itemId, index) => {
      if (itemId && index >= 0 && index < INVENTORY_SIZE && getItem(itemId)) {
        this.insInv.run(rec.id, index, itemId);
      }
    });

    // Talents: validate id + clamp rank before writing.
    this.delTal.run(rec.id);
    for (const [talentId, rank] of Object.entries(rec.talents)) {
      const t = getTalent(talentId);
      if (t && rank > 0) this.insTal.run(rec.id, talentId, Math.min(Math.round(rank), t.maxRank));
    }
  }

  /** Batch-persist lightweight state (position + resources) for the heartbeat. */
  saveLightBatch(list: LightState[]): void {
    if (list.length > 0) this.lightTx(list);
  }

  close(): void {
    this.db.close();
  }
}

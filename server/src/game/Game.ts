/**
 * The authoritative game simulation: owns the ECS world, runs the fixed-step
 * system pipeline, applies player commands and serializes world snapshots.
 */

import {
  AGGRO_RADIUS,
  MONSTER_WALK_SPEED,
  MOVE_SPEED,
  STANCE_COOLDOWN_MS,
  STARTING_TALENT_POINTS,
  getClass,
  getItem,
  getTalent,
  pointsSpent,
  type ClassId,
  type CombatLogEvent,
  type ContainerState,
  type EntitySnapshot,
  type EquipSlot,
  type TalentState,
} from "@wow/shared";
import { World, type EntityId } from "../ecs/World.js";
import {
  ClassState,
  Combat,
  Corpse,
  Equipment,
  Identity,
  Inventory,
  Locomotion,
  LootTable,
  MonsterAI,
  MoveIntent,
  Position,
  Power,
  Stats,
  Talents,
  ThreatTable,
} from "../ecs/components.js";
import { CombatLog, type GameContext, type System } from "./context.js";
import { tryStartCast } from "./combat.js";
import { recalculateStats } from "./stats.js";
import { distance } from "./util.js";
import { CastingSystem } from "./systems/CastingSystem.js";
import { AutoAttackSystem } from "./systems/AutoAttackSystem.js";
import { CorpseSystem } from "./systems/CorpseSystem.js";
import { MonsterAISystem } from "./systems/MonsterAISystem.js";
import { MovementSystem } from "./systems/MovementSystem.js";
import { ResourceSystem } from "./systems/ResourceSystem.js";

/** How close a player must be to loot a corpse (world units). */
const LOOT_RANGE = 140;

/** Class a freshly-spawned player is instantiated as. */
const DEFAULT_CLASS: ClassId = "mage";

export class Game {
  readonly world = new World();
  private readonly log = new CombatLog();
  private readonly systems: System[];
  private lastTick = Date.now();

  constructor() {
    // Order matters: move/AI decide intent, casting & swings resolve, regen last.
    this.systems = [
      new MovementSystem(),
      new MonsterAISystem(),
      new CastingSystem(),
      new AutoAttackSystem(),
      new ResourceSystem(),
      new CorpseSystem(),
    ];
  }

  // -- Spawning -------------------------------------------------------------

  /** Apply a class's base stats, resource and default stance to an entity. */
  private instantiateClass(id: EntityId, classId: ClassId): void {
    const def = getClass(classId);
    const b = def.base;
    this.world.add(
      id,
      new Stats(
        b.hp,
        b.hp,
        { strength: b.strength, agility: b.agility, intellect: b.intellect, stamina: b.stamina },
        b.armor,
        b.weaponMin,
        b.weaponMax,
        b.critChance,
        b.hpRegen,
      ),
    );
    this.world.add(id, new Power(def.power, def.powerStart, def.powerMax, def.manaRegen));
    this.world.add(id, new ClassState(def.id, def.stances[0].id));
  }

  spawnPlayer(name: string): EntityId {
    const id = this.world.createEntity();
    this.world.add(id, new Identity(name, "player"));
    this.world.add(id, new Position(0, 0));
    this.instantiateClass(id, DEFAULT_CLASS);
    this.world.add(id, new Talents({}, STARTING_TALENT_POINTS));
    this.world.add(id, new Combat());
    this.world.add(id, new MoveIntent());
    this.world.add(id, new Locomotion(MOVE_SPEED));

    // Containers: seed the backpack with the test items so equipping can be
    // tried immediately (loot drops add more on top).
    const inventory = this.world.add(id, new Inventory());
    this.world.add(id, new Equipment());
    inventory.add("whirlwind_axe");
    inventory.add("robes_archmage");
    inventory.add("tattered_gloves");
    recalculateStats(this.world, id);

    this.log.push("info", `${name} has entered the world as a ${getClass(DEFAULT_CLASS).name}.`);
    return id;
  }

  /**
   * Spawn a patrolling monster. It walks the line between (patrolAx,patrolAy)
   * and (patrolBx,patrolBy), aggroes players nearby and leashes back to its
   * HomePosition at (homeX,homeY).
   */
  spawnMonster(
    name: string,
    homeX: number,
    homeY: number,
    patrol: { ax: number; ay: number; bx: number; by: number },
  ): EntityId {
    const id = this.world.createEntity();
    this.world.add(id, new Identity(name, "monster"));
    this.world.add(id, new Position(homeX, homeY));
    this.world.add(
      id,
      new Stats(
        /*hp*/ 200,
        /*maxHp*/ 200,
        { strength: 10, agility: 10, intellect: 10, stamina: 10 },
        /*armor*/ 150,
        /*weaponMin*/ 3,
        /*weaponMax*/ 5,
        /*critChance*/ 0,
        /*hpRegen*/ 0,
      ),
    );
    this.world.add(id, new Combat());
    this.world.add(id, new ThreatTable());
    this.world.add(id, new MoveIntent());
    this.world.add(id, new Locomotion(MONSTER_WALK_SPEED));
    this.world.add(id, new MonsterAI(homeX, homeY, patrol.ax, patrol.ay, patrol.bx, patrol.by));
    // Loot table: each entry rolls independently when the monster dies.
    this.world.add(
      id,
      new LootTable([
        { itemId: "tattered_gloves", chance: 0.5 },
        { itemId: "robes_archmage", chance: 0.3 },
        { itemId: "whirlwind_axe", chance: 0.1 },
      ]),
    );
    return id;
  }

  // -- Command handling -----------------------------------------------------

  setTarget(player: EntityId, targetId: EntityId | null): void {
    const combat = this.world.get(player, Combat);
    if (!combat) return;
    if (targetId !== null && !this.world.exists(targetId)) return;
    combat.targetId = targetId;
  }

  toggleAutoAttack(player: EntityId): void {
    const combat = this.world.get(player, Combat);
    if (!combat) return;
    combat.autoAttacking = !combat.autoAttacking;
    if (combat.autoAttacking) {
      combat.inCombat = true;
      const name = this.world.get(player, Identity)?.name ?? "You";
      this.log.push("info", `${name} starts attacking.`);
    } else {
      this.log.push("info", `Auto-attack disabled.`);
    }
  }

  castSpell(player: EntityId, spellId: string): void {
    const error = tryStartCast(this.ctx(), player, spellId);
    if (error) this.log.push("info", error);
  }

  /** Instantiate the player as a class, locking in its resource type. */
  setClass(player: EntityId, classId: ClassId): void {
    if (!this.world.exists(player) || !getClass(classId)) return;
    this.instantiateClass(player, classId); // resets Stats / Power / stance
    recalculateStats(this.world, player); // re-fold equipped gear + talents
    const combat = this.world.get(player, Combat);
    if (combat) combat.cast = null;
    const def = getClass(classId);
    const name = this.world.get(player, Identity)?.name ?? "You";
    this.log.push("info", `${name} becomes a ${def.name} (${def.power}).`);
  }

  /** Switch the active stance/form, gated by the stance cooldown. */
  setStance(player: EntityId, stanceId: string, now = Date.now()): void {
    const cls = this.world.get(player, ClassState);
    if (!cls) return;
    const def = getClass(cls.classId);
    const stance = def.stances.find((s) => s.id === stanceId);
    if (!stance) {
      this.log.push("info", "That stance is not available to your class.");
      return;
    }
    if (cls.stanceId === stanceId) return;
    if (now < cls.stanceCdEndsAt) {
      this.log.push("info", "Stance not ready.");
      return;
    }
    cls.stanceId = stanceId;
    cls.stanceCdEndsAt = now + STANCE_COOLDOWN_MS;
    const name = this.world.get(player, Identity)?.name ?? "You";
    this.log.push("info", `${name} switches to ${stance.name}.`);
  }

  /** Spend one talent point in a talent, if budget and rank allow. */
  spendTalent(player: EntityId, talentId: string): void {
    const talents = this.world.get(player, Talents);
    const talent = getTalent(talentId);
    if (!talents || !talent) return;
    const current = talents.ranks[talentId] ?? 0;
    if (current >= talent.maxRank) {
      this.log.push("info", `${talent.name} is already at max rank.`);
      return;
    }
    if (pointsSpent(talents.ranks) >= talents.pointsTotal) {
      this.log.push("info", "No talent points available.");
      return;
    }
    talents.ranks[talentId] = current + 1;
    recalculateStats(this.world, player); // e.g. Armored To The Teeth -> armor
    this.log.push("info", `Learned ${talent.name} (rank ${current + 1}/${talent.maxRank}).`);
  }

  /** Refund all spent talent points. */
  resetTalents(player: EntityId): void {
    const talents = this.world.get(player, Talents);
    if (!talents) return;
    talents.ranks = {};
    recalculateStats(this.world, player);
    this.log.push("info", "Talents reset.");
  }

  // -- Inventory / equipment / loot -----------------------------------------

  /** Equip the item in a backpack slot, swapping any item already in that slot. */
  equipItem(player: EntityId, bagIndex: number): void {
    const inv = this.world.get(player, Inventory);
    const equip = this.world.get(player, Equipment);
    if (!inv || !equip) return;
    if (bagIndex < 0 || bagIndex >= inv.slots.length) return;

    const itemId = inv.slots[bagIndex];
    if (!itemId) return;
    const item = getItem(itemId);
    if (!item) return;

    const previous = equip.slots[item.slot];
    equip.slots[item.slot] = itemId;
    inv.slots[bagIndex] = previous; // previously-equipped item drops into the bag
    recalculateStats(this.world, player);
    this.log.push("info", `Equipped ${item.name}.`);
  }

  /** Unequip an item back into the first free backpack slot. */
  unequipItem(player: EntityId, slot: EquipSlot): void {
    const inv = this.world.get(player, Inventory);
    const equip = this.world.get(player, Equipment);
    if (!inv || !equip) return;

    const itemId = equip.slots[slot];
    if (!itemId) return;
    if (inv.firstFree() < 0) {
      this.log.push("info", "Your backpack is full.");
      return;
    }
    inv.add(itemId);
    equip.slots[slot] = null;
    recalculateStats(this.world, player);
    this.log.push("info", `Unequipped ${getItem(itemId)?.name ?? itemId}.`);
  }

  /** Move an item from a monster's corpse into the player's backpack. */
  lootItem(player: EntityId, sourceId: EntityId, lootIndex: number): void {
    const corpse = this.world.get(sourceId, Corpse);
    if (!corpse) return;
    if (lootIndex < 0 || lootIndex >= corpse.loot.length) return;
    if (distance(this.world, player, sourceId) > LOOT_RANGE) {
      this.log.push("info", "You are too far away to loot that.");
      return;
    }
    const inv = this.world.get(player, Inventory);
    if (!inv) return;
    if (inv.firstFree() < 0) {
      this.log.push("info", "Your backpack is full.");
      return;
    }
    const itemId = corpse.loot[lootIndex];
    inv.add(itemId);
    corpse.loot.splice(lootIndex, 1);
    this.log.push("info", `You receive loot: ${getItem(itemId)?.name ?? itemId}.`);
  }

  setMoveIntent(player: EntityId, dx: number, dy: number): void {
    const intent = this.world.get(player, MoveIntent);
    if (intent) {
      intent.dx = dx;
      intent.dy = dy;
    }
  }

  removePlayer(player: EntityId): void {
    const name = this.world.get(player, Identity)?.name;
    this.world.destroyEntity(player);
    // Clear the departed player from every threat table.
    for (const id of this.world.query(ThreatTable)) {
      this.world.get(id, ThreatTable)!.remove(player);
    }
    if (name) this.log.push("info", `${name} has left the world.`);
  }

  // -- Tick -----------------------------------------------------------------

  tick(now = Date.now()): void {
    const dt = Math.min((now - this.lastTick) / 1000, 0.25); // clamp long pauses
    this.lastTick = now;
    const ctx: GameContext = { world: this.world, now, dt, log: this.log };
    for (const system of this.systems) system.update(ctx);
  }

  private ctx(now = Date.now()): GameContext {
    return { world: this.world, now, dt: 0, log: this.log };
  }

  // -- Serialization --------------------------------------------------------

  drainLog(): CombatLogEvent[] {
    return this.log.drain();
  }

  /** Remaining GCD (ms) for a given player, for the client's button sweep. */
  gcdRemaining(player: EntityId, now = Date.now()): number {
    const combat = this.world.get(player, Combat);
    if (!combat) return 0;
    return Math.max(0, combat.gcdEndsAt - now);
  }

  /** Remaining stance-swap cooldown (ms) for a player. */
  stanceCdRemaining(player: EntityId, now = Date.now()): number {
    const cls = this.world.get(player, ClassState);
    if (!cls) return 0;
    return Math.max(0, cls.stanceCdEndsAt - now);
  }

  /** The player's talent allocation, serialized for the client panel. */
  talentState(player: EntityId): TalentState {
    const talents = this.world.get(player, Talents);
    if (!talents) return { ranks: {}, pointsTotal: 0, pointsSpent: 0 };
    return {
      ranks: { ...talents.ranks },
      pointsTotal: talents.pointsTotal,
      pointsSpent: pointsSpent(talents.ranks),
    };
  }

  /** The player's backpack + equipped gear, serialized for the client. */
  containerState(player: EntityId): ContainerState {
    const inv = this.world.get(player, Inventory);
    const equip = this.world.get(player, Equipment);
    return {
      inventory: inv ? [...inv.slots] : [],
      equipment: equip
        ? { ...equip.slots }
        : { head: null, chest: null, hands: null, legs: null, mainhand: null },
    };
  }

  snapshot(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const id of this.world.query(Identity, Position, Stats, Combat)) {
      const ident = this.world.get(id, Identity)!;
      const pos = this.world.get(id, Position)!;
      const stats = this.world.get(id, Stats)!;
      const combat = this.world.get(id, Combat)!;
      const power = this.world.get(id, Power);
      const cls = this.world.get(id, ClassState);
      const corpse = this.world.get(id, Corpse);
      const ai = this.world.get(id, MonsterAI);
      out.push({
        id,
        kind: ident.kind,
        name: ident.name,
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        hp: Math.round(stats.hp),
        maxHp: stats.maxHp,
        power: power ? Math.floor(power.current) : 0,
        maxPower: power ? power.max : 0,
        powerType: power ? power.type : "mana",
        classId: cls ? cls.classId : null,
        stanceId: cls ? cls.stanceId : "neutral",
        inCombat: combat.inCombat,
        targetId: combat.targetId,
        autoAttacking: combat.autoAttacking,
        loot: corpse ? [...corpse.loot] : [],
        aiState: ai ? ai.state : null,
        aggroRadius: ai ? AGGRO_RADIUS : 0,
        cast: combat.cast
          ? {
              spellId: combat.cast.spellId,
              spellName: combat.cast.spellName,
              total: combat.cast.castTime,
              elapsed: Math.min(combat.cast.elapsed, combat.cast.castTime),
            }
          : null,
      });
    }
    return out;
  }
}

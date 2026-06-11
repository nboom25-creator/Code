/**
 * Core gameplay components.
 *
 * Each component is a small bag of mutable data. Behaviour lives in systems,
 * not here — this keeps the data model easy to serialize and reason about.
 */

import type { EntityKind, PowerType } from "@wow/shared";
import { Component, type EntityId } from "./World.js";

/** Human-readable identity used for nameplates and the kind discriminator. */
export class Identity extends Component {
  constructor(
    public name: string,
    public kind: EntityKind,
  ) {
    super();
  }
}

/** World-space position in logical units. */
export class Position extends Component {
  constructor(
    public x: number,
    public y: number,
  ) {
    super();
  }
}

/** Primary attributes from which combat values are derived. */
export interface Attributes {
  strength: number;
  agility: number;
  intellect: number;
  stamina: number;
}

/** Health, attributes, weapon and defensive stats. Resources live in Power. */
export class Stats extends Component {
  constructor(
    public hp: number,
    public maxHp: number,
    public attributes: Attributes,
    public armor: number,
    public weaponMinDamage: number,
    public weaponMaxDamage: number,
    /** Critical strike chance as a percentage (0-100). */
    public critChance: number,
    /** Out-of-combat health regen per second. */
    public hpRegen = 0,
  ) {
    super();
  }
  get dead(): boolean {
    return this.hp <= 0;
  }
}

/** The unit's single active resource pool (mana, energy or rage). */
export class Power extends Component {
  /** Accumulator for discrete energy ticks (ms). */
  tickAccumulator = 0;
  constructor(
    public type: PowerType,
    public current: number,
    public max: number,
    /** Continuous mana regen per second (mana only). */
    public manaRegen = 0,
  ) {
    super();
  }
}

/** An in-progress spell cast. */
export class ActiveCast {
  elapsed = 0;
  constructor(
    public spellId: string,
    public spellName: string,
    public castTime: number,
  ) {}
}

/** Combat state: target, auto-attack, swing timer, GCD and active cast. */
export class Combat extends Component {
  targetId: EntityId | null = null;
  inCombat = false;
  autoAttacking = false;
  /** ms until the next weapon swing is ready. */
  swingTimer = 0;
  /** Absolute server timestamp (ms) at which the GCD ends. */
  gcdEndsAt = 0;
  /** Active cast, or null. */
  cast: ActiveCast | null = null;
}

/** Threat accumulated per attacker; monsters target the highest entry. */
export class ThreatTable extends Component {
  readonly threat = new Map<EntityId, number>();

  add(source: EntityId, amount: number): void {
    this.threat.set(source, (this.threat.get(source) ?? 0) + amount);
  }

  remove(source: EntityId): void {
    this.threat.delete(source);
  }

  /** Entity with the most threat, or null if the table is empty. */
  highest(): EntityId | null {
    let best: EntityId | null = null;
    let bestVal = -Infinity;
    for (const [id, val] of this.threat) {
      if (val > bestVal) {
        bestVal = val;
        best = id;
      }
    }
    return best;
  }
}

/** Current movement intent (normalized direction) set from client input. */
export class MoveIntent extends Component {
  dx = 0;
  dy = 0;
}

/** Tags an entity as monster AI-controlled (vs. a network-controlled player). */
export class MonsterAI extends Component {
  /** A passive target dummy reacts to threat but never swings back. */
  constructor(public passive = false) {
    super();
  }
}

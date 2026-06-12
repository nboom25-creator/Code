/**
 * Data-driven talent system.
 *
 * A talent is a pure data object: a name, a max rank, and a list of typed
 * `TalentModifier`s. The engine never references a talent by name — it asks
 * `computeTalentEffects()` for the aggregated numbers and reads those. Adding a
 * new talent that reuses an existing modifier kind requires touching ONLY this
 * file (append a `TalentDef`); no core engine change is needed.
 */

/** Number of talent points granted for testing. */
export const STARTING_TALENT_POINTS = 5;

/**
 * A single typed modifier. Each `kind` is interpreted by the aggregator below.
 * Adding a brand-new *kind* of effect is the one case that also extends the
 * aggregator + the engine field that consumes it.
 */
export type TalentModifier =
  | { kind: "physicalCrit"; perRank: number } // additive crit % for physical
  | { kind: "armorPct"; perRank: number } // additive % to total armor
  | { kind: "spellCastReductionMs"; spellId: string; perRank: number };

export interface TalentDef {
  id: string;
  name: string;
  maxRank: number;
  /** Per-rank summary used by the talent panel tooltip. */
  describe: (rank: number) => string;
  modifiers: TalentModifier[];
}

export const TALENTS: TalentDef[] = [
  {
    id: "cruelty",
    name: "Cruelty",
    maxRank: 3,
    describe: (r) => `Increases critical strike chance of physical attacks by ${r}%.`,
    modifiers: [{ kind: "physicalCrit", perRank: 1 }],
  },
  {
    id: "improved_fireball",
    name: "Improved Fireball",
    maxRank: 2,
    describe: (r) => `Reduces the cast time of Fireball by ${(r * 0.25).toFixed(2)}s.`,
    modifiers: [{ kind: "spellCastReductionMs", spellId: "fireball", perRank: 250 }],
  },
  {
    id: "armored_to_the_teeth",
    name: "Armored To The Teeth",
    maxRank: 3,
    describe: (r) => `Increases total Armor by ${r * 4}%.`,
    modifiers: [{ kind: "armorPct", perRank: 4 }],
  },
];

export function getTalent(id: string): TalentDef | undefined {
  return TALENTS.find((t) => t.id === id);
}

/** Aggregated, engine-ready talent effects. */
export interface TalentEffects {
  /** Additive crit chance (%) applied to physical attacks. */
  physicalCritBonus: number;
  /** Multiplier applied to base armor (1.0 = unchanged). */
  armorMultiplier: number;
  /** Cast-time reduction in ms, keyed by spell id. */
  spellCastReductionMs: Record<string, number>;
}

export type TalentRanks = Record<string, number>;

/** Fold a set of allocated ranks into aggregated combat effects. */
export function computeTalentEffects(ranks: TalentRanks): TalentEffects {
  const effects: TalentEffects = {
    physicalCritBonus: 0,
    armorMultiplier: 1,
    spellCastReductionMs: {},
  };

  for (const talent of TALENTS) {
    const rank = ranks[talent.id] ?? 0;
    if (rank <= 0) continue;
    for (const mod of talent.modifiers) {
      switch (mod.kind) {
        case "physicalCrit":
          effects.physicalCritBonus += mod.perRank * rank;
          break;
        case "armorPct":
          effects.armorMultiplier += (mod.perRank * rank) / 100;
          break;
        case "spellCastReductionMs":
          effects.spellCastReductionMs[mod.spellId] =
            (effects.spellCastReductionMs[mod.spellId] ?? 0) + mod.perRank * rank;
          break;
      }
    }
  }
  return effects;
}

/** Total points spent across all talents. */
export function pointsSpent(ranks: TalentRanks): number {
  return Object.values(ranks).reduce((sum, r) => sum + r, 0);
}

/** Serializable talent state sent to the controlling client. */
export interface TalentState {
  ranks: TalentRanks;
  pointsTotal: number;
  pointsSpent: number;
}

/**
 * Spell definitions shared between server and client.
 *
 * The server uses these to resolve effects; the client uses them to render
 * action bar tooltips, cast-time previews and combat-log school colours.
 */

export type ResourceType = "mana" | "health";
export type DamageSchool = "physical" | "shadow" | "fire" | "frost" | "holy";

export interface SpellCost {
  type: ResourceType;
  amount: number;
}

export interface SpellEffect {
  /** Damage dealt to the current target (0 if none). */
  damage?: number;
  damageSchool?: DamageSchool;
  /** Resource restored to the caster. */
  restore?: { type: ResourceType; amount: number };
}

export interface SpellDef {
  id: string;
  name: string;
  /** Cast time in ms. 0 means an instant cast. */
  castTime: number;
  cost: SpellCost;
  /** Whether casting this spell triggers the Global Cooldown. */
  triggersGcd: boolean;
  /** Maximum range in world units the target may be at. */
  range: number;
  effect: SpellEffect;
  /** Short text for tooltips / action bar. */
  description: string;
}

export const SPELLS: Record<string, SpellDef> = {
  shadowbolt: {
    id: "shadowbolt",
    name: "Shadowbolt",
    castTime: 2000,
    cost: { type: "mana", amount: 10 },
    triggersGcd: true,
    range: 300,
    effect: { damage: 20, damageSchool: "shadow" },
    description: "2.0s cast. Deals 20 Shadow damage to your target.",
  },
  lifetap: {
    id: "lifetap",
    name: "Life Tap",
    castTime: 0,
    cost: { type: "health", amount: 10 },
    triggersGcd: true,
    range: 0,
    effect: { restore: { type: "mana", amount: 20 } },
    description: "Instant. Converts 10 health into 20 mana.",
  },
};

export function getSpell(id: string): SpellDef | undefined {
  return SPELLS[id];
}

import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";

/**
 * CLAUDE.md calls kernel purity a non-negotiable and says it is "enforced by lint
 * rule". A rule that is configured but not exercised is not enforcement — it is a
 * comment. These tests lint probe sources at virtual paths and assert the boundary
 * actually bites.
 *
 * Probes are linted as text, never written to disk, so `npm run lint` over the real
 * tree stays clean and there are no violating fixtures to trip over.
 */

const eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, "..") });

/** Lint `code` as though it lived at `virtualPath`; return the rule IDs that fired. */
async function ruleIdsFor(code: string, virtualPath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.resolve(import.meta.dirname, "..", virtualPath),
    warnIgnored: false,
  });
  return (result?.messages ?? [])
    .map((m) => m.ruleId)
    .filter((id): id is string => id !== null);
}

const KERNEL_FILE = "src/kernel/probe.ts";
const UI_FILE = "src/ui/probe.ts";

describe("kernel purity (CLAUDE.md non-negotiable #2)", () => {
  it.each([
    ["react", `import { useState } from "react";\nexport const x = useState;`],
    ["maplibre-gl", `import maplibregl from "maplibre-gl";\nexport const x = maplibregl;`],
    ["zustand", `import { create } from "zustand";\nexport const x = create;`],
    ["d3", `import * as d3 from "d3";\nexport const x = d3;`],
  ])("rejects a %s import from src/kernel/", async (_name, code) => {
    const ids = await ruleIdsFor(code, KERNEL_FILE);
    expect(ids).toContain("@typescript-eslint/no-restricted-imports");
  });

  it.each([
    ["map", `import { layer } from "../map/layers/front.ts";\nexport const x = layer;`],
    ["ui", `import { App } from "../ui/App.tsx";\nexport const x = App;`],
    ["state", `import { store } from "../state/store.ts";\nexport const x = store;`],
  ])("rejects a relative import into %s/ (ARCHITECTURE §2 hard rule)", async (_n, code) => {
    const ids = await ruleIdsFor(code, KERNEL_FILE);
    expect(ids).toContain("@typescript-eslint/no-restricted-imports");
  });

  it.each(["document", "window", "localStorage", "requestAnimationFrame"])(
    "rejects the DOM global %s in src/kernel/",
    async (global) => {
      const ids = await ruleIdsFor(`export const x = ${global};`, KERNEL_FILE);
      expect(ids).toContain("no-restricted-globals");
    },
  );

  it("rejects `any` in src/kernel/ (CLAUDE.md conventions)", async () => {
    const ids = await ruleIdsFor(`export const x = (v: any) => v;`, KERNEL_FILE);
    expect(ids).toContain("@typescript-eslint/no-explicit-any");
  });

  it("permits plain typed ESM in src/kernel/", async () => {
    const ids = await ruleIdsFor(
      `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
      KERNEL_FILE,
    );
    expect(ids).toEqual([]);
  });

  it("still allows React in src/ui/ — the boundary is one-directional", async () => {
    const ids = await ruleIdsFor(
      `import { useState } from "react";\nexport const x = useState;`,
      UI_FILE,
    );
    expect(ids).not.toContain("@typescript-eslint/no-restricted-imports");
  });
});

describe("fog of war as a type boundary (CLAUDE.md non-negotiable #4)", () => {
  it("stops src/ui/ importing the enemy truth module", async () => {
    const ids = await ruleIdsFor(
      `import type { Formation } from "../kernel/truth";\nexport type X = Formation;`,
      UI_FILE,
    );
    expect(ids).toContain("@typescript-eslint/no-restricted-imports");
  });

  it("leaves Contact imports alone — that is the sanctioned channel", async () => {
    const ids = await ruleIdsFor(
      `import type { Contact } from "../kernel/types.ts";\nexport type X = Contact;`,
      UI_FILE,
    );
    expect(ids).not.toContain("@typescript-eslint/no-restricted-imports");
  });
});

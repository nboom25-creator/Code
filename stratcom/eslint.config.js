import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * The kernel-purity boundary is the point of this file.
 *
 * CLAUDE.md non-negotiable #2: `src/kernel/` runs under plain Node with no React, no
 * DOM and no MapLibre. That is what lets the calibration harness and the Monte Carlo
 * worker execute headlessly (ARCHITECTURE §9). "Enforced by lint rule; do not add an
 * exception" — so if a kernel file trips these rules, change the file, not this
 * config.
 */

/** Packages the kernel may never pull in, however convenient. */
const UI_PACKAGES = [
  "react",
  "react-dom",
  "react-dom/client",
  "maplibre-gl",
  "zustand",
  "d3",
];

/** Globals that only exist in a browser; their use would break the headless paths. */
const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "location",
  "history",
  "alert",
  "requestAnimationFrame",
];

export default tseslint.config(
  { ignores: ["dist", "node_modules", "**/*.tsbuildinfo"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },

  /* Browser-side code: DOM globals are expected here. */
  {
    files: ["src/ui/**/*.{ts,tsx}", "src/map/**/*.{ts,tsx}", "src/main.tsx"],
    languageOptions: { globals: globals.browser },
  },

  /* Node-side tooling. */
  {
    files: ["scripts/**/*.ts", "calibration/**/*.{ts,mjs}", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },

  /* ── The kernel-purity boundary ──────────────────────────────────────────── */
  {
    files: ["src/kernel/**/*.ts"],
    languageOptions: {
      // Deliberately NOT globals.browser. The kernel gets Node and nothing more.
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: UI_PACKAGES.map((name) => ({
            name,
            message:
              "src/kernel/ must run under plain Node (CLAUDE.md #2). The harness and the Monte Carlo worker depend on this.",
          })),
          patterns: [
            {
              group: ["**/map/**", "**/ui/**", "**/state/**", "**/data/**"],
              message:
                "src/kernel/ must not import from map/, ui/, state/ or data/ (ARCHITECTURE §2, hard rule). Dependencies point inward only.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...DOM_GLOBALS.map((name) => ({
          name,
          message:
            "DOM global in src/kernel/ — this file must execute headlessly under plain Node (CLAUDE.md #2).",
        })),
      ],
      // CLAUDE.md conventions: "No `any` in src/kernel/."
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  /* ── Fog of war as a type boundary (CLAUDE.md #4, ARCHITECTURE §6) ───────── */
  {
    files: ["src/ui/**/*.{ts,tsx}", "src/map/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Enemy information reaches the UI as `Contact` records only. Truth
              // types for formations live behind this boundary and stay there.
              group: ["**/kernel/truth", "**/kernel/truth/**"],
              message:
                "UI/map code must read enemy state from Contact records, never the true formation type (CLAUDE.md #4).",
              allowTypeImports: false,
            },
          ],
        },
      ],
    },
  },
);

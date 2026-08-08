import { defineConfig } from "vitest/config";

/**
 * Test configuration, deliberately free of app plugins.
 *
 * CLAUDE.md non-negotiable #2 and ARCHITECTURE §9: the kernel and the ten-war
 * harness must execute headlessly under plain Node — that is what makes the
 * calibration gate and the Monte Carlo worker possible. Defaulting the environment to
 * `node` rather than `jsdom` means a kernel test that reaches for the DOM fails here
 * rather than passing by accident.
 *
 * A UI test that genuinely needs a DOM opts in per file with:
 *   // @vitest-environment jsdom
 * and that will need jsdom plus the React plugin added — do that when the first such
 * test arrives (Phase 11), not before.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "calibration/**/*.test.ts"],
  },
});

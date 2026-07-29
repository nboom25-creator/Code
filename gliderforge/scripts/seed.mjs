// Seeds the demonstration project into the configured database.
// Usage: npm run db:seed
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "-e", `
    const { createSampleProject } = await import("./src/lib/sample/sampleProject.ts");
    const p = createSampleProject();
    console.log("Sample project ready:", p.name, "(" + p.slug + ")");
  `],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);

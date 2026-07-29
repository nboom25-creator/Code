// Generates src/lib/db/schema.generated.ts from the canonical schema.sql so the
// SQL is bundled with the app and needs no filesystem access at runtime.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sql = fs.readFileSync(path.join(root, "src/lib/db/schema.sql"), "utf8");
const out = `// GENERATED FILE — do not edit.
// Source: src/lib/db/schema.sql   Regenerate with: npm run db:schema
export const SCHEMA_SQL = ${JSON.stringify(sql)};
`;
fs.writeFileSync(path.join(root, "src/lib/db/schema.generated.ts"), out);
console.log("wrote src/lib/db/schema.generated.ts (%d bytes of SQL)", sql.length);

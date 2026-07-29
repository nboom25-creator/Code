// Deletes the SQLite database file so the next run starts from a clean schema.
// Usage: npm run db:reset
import fs from "node:fs";
import path from "node:path";

const configured = process.env.GLIDERFORGE_DB ?? "./data/gliderforge.db";
const file = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);

let removed = 0;
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const target = `${file}${suffix}`;
  if (fs.existsSync(target)) {
    fs.rmSync(target);
    removed++;
  }
}
console.log(removed > 0 ? `Removed ${removed} database file(s) at ${file}` : `No database file found at ${file}`);
console.log("The schema is recreated automatically the next time the app starts.");

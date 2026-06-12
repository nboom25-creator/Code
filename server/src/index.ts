/**
 * Server entry point. Wires together Express (HTTP), the SQLite persistence
 * layer, the WebSocket transport and the authoritative game loop, then spins up
 * the demo world.
 */

import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import { TICK_MS } from "@wow/shared";
import { Game } from "./game/Game.js";
import { NetworkServer } from "./net/NetworkServer.js";
import { PlayerStore } from "./db/PlayerStore.js";

const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "game.db");
/** Auto-save heartbeat interval (ms). */
const AUTOSAVE_MS = 10_000;

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

const httpServer = createServer(app);

// -- Persistence ------------------------------------------------------------
const store = new PlayerStore(DB_PATH);

// -- Game world -------------------------------------------------------------
const game = new Game();

// Demo world: a small pack of Defias monsters that patrol south of the origin —
// close enough to walk into their aggro radius, packed close enough to social-aggro.
game.spawnMonster("Defias Bandit", 0, 180, { ax: -40, ay: 180, bx: 40, by: 180 });
game.spawnMonster("Defias Highwayman", 45, 180, { ax: 45, ay: 165, bx: 45, by: 195 });

// Fixed-step simulation loop.
setInterval(() => game.tick(), TICK_MS);

// -- Network ----------------------------------------------------------------
const net = new NetworkServer(httpServer, game, store);
net.start();

// Auto-save heartbeat: silently batch position + resources for active players.
const autosave = setInterval(() => {
  const records = game
    .playersWithAccount()
    .map((id) => game.lightState(id))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  store.saveLightBatch(records);
}, AUTOSAVE_MS);

httpServer.listen(PORT, () => {
  console.log(`[server] HTTP + WebSocket listening on http://localhost:${PORT}`);
  console.log(`[server] simulation tick: ${TICK_MS.toFixed(1)}ms`);
  console.log(`[server] database: ${DB_PATH}`);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[server] shutting down — saving all players...");
  clearInterval(autosave);
  net.saveAll(); // blocking, atomic per-player saves
  net.stop();
  store.close();
  httpServer.close(() => process.exit(0));
  // Safety net in case the HTTP server is slow to close.
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

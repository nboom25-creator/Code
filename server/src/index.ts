/**
 * Server entry point. Wires together Express (HTTP), the WebSocket transport
 * and the authoritative game loop, then spins up the demo sandbox.
 */

import { createServer } from "node:http";
import express from "express";
import { TICK_MS } from "@wow/shared";
import { Game } from "./game/Game.js";
import { NetworkServer } from "./net/NetworkServer.js";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

const httpServer = createServer(app);

// -- Game world -------------------------------------------------------------
const game = new Game();

// Demo sandbox: one player is created per WebSocket connection. Here we spawn a
// small pack of Defias monsters that patrol south of the player's spawn — close
// enough to walk into their aggro radius, packed close enough to social-aggro.
game.spawnMonster("Defias Bandit", 0, 180, { ax: -40, ay: 180, bx: 40, by: 180 });
game.spawnMonster("Defias Highwayman", 45, 180, { ax: 45, ay: 165, bx: 45, by: 195 });

// Fixed-step simulation loop.
setInterval(() => game.tick(), TICK_MS);

// -- Network ----------------------------------------------------------------
const net = new NetworkServer(httpServer, game);
net.start();

httpServer.listen(PORT, () => {
  console.log(`[server] HTTP + WebSocket listening on http://localhost:${PORT}`);
  console.log(`[server] simulation tick: ${TICK_MS.toFixed(1)}ms`);
});

const shutdown = () => {
  console.log("\n[server] shutting down...");
  net.stop();
  httpServer.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

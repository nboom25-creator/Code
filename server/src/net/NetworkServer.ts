/**
 * WebSocket transport. Maps each socket to a player entity, decodes client
 * commands into game calls, and broadcasts world snapshots + combat-log events
 * on a fixed interval.
 */

import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "node:http";
import {
  SNAPSHOT_INTERVAL_MS,
  type ClientMessage,
  type ServerMessage,
} from "@wow/shared";
import type { Game } from "../game/Game.js";
import type { EntityId } from "../ecs/World.js";

export class NetworkServer {
  private readonly wss: WebSocketServer;
  private readonly players = new Map<WebSocket, EntityId>();
  private broadcastTimer?: NodeJS.Timeout;

  constructor(
    server: Server,
    private readonly game: Game,
  ) {
    this.wss = new WebSocketServer({ server });
    this.wss.on("connection", (socket) => this.onConnection(socket));
  }

  /** Begin pushing snapshots to all connected clients. */
  start(): void {
    this.broadcastTimer = setInterval(() => this.broadcast(), SNAPSHOT_INTERVAL_MS);
  }

  stop(): void {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    this.wss.close();
  }

  private onConnection(socket: WebSocket): void {
    const playerId = this.game.spawnPlayer(`Player-${this.players.size + 1}`);
    this.players.set(socket, playerId);

    this.send(socket, { type: "welcome", playerId });

    socket.on("message", (data) => this.onMessage(socket, playerId, data));
    socket.on("close", () => {
      this.players.delete(socket);
      this.game.removePlayer(playerId);
    });
    socket.on("error", () => socket.close());
  }

  private onMessage(socket: WebSocket, playerId: EntityId, data: RawData): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "setTarget":
        this.game.setTarget(playerId, msg.targetId);
        break;
      case "castSpell":
        this.game.castSpell(playerId, msg.spellId);
        break;
      case "toggleAutoAttack":
        this.game.toggleAutoAttack(playerId);
        break;
      case "move":
        this.game.setMoveIntent(playerId, msg.dx, msg.dy);
        break;
      case "setProfile":
        this.game.setResourceProfile(playerId, msg.profile);
        break;
    }
  }

  private broadcast(): void {
    const now = Date.now();
    const entities = this.game.snapshot();
    const logEvents = this.game.drainLog();

    for (const [socket, playerId] of this.players) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      this.send(socket, {
        type: "snapshot",
        serverTime: now,
        entities,
        gcdRemaining: this.game.gcdRemaining(playerId, now),
      });
      if (logEvents.length > 0) {
        this.send(socket, { type: "combatLog", events: logEvents });
      }
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    socket.send(JSON.stringify(message));
  }
}

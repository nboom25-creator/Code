/**
 * WebSocket transport with account sessions.
 *
 * A socket has no player until it sends a `login`. On login we load (or create)
 * the account from the PlayerStore and spawn the player from that record. On
 * disconnect we run a blocking, atomic save so positions, gear, inventory and
 * talents survive logouts and restarts without duplication or rollback.
 */

import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "node:http";
import {
  SNAPSHOT_INTERVAL_MS,
  type ClientMessage,
  type ServerMessage,
} from "@wow/shared";
import type { Game } from "../game/Game.js";
import type { PlayerStore } from "../db/PlayerStore.js";
import type { EntityId } from "../ecs/World.js";

const MAX_USERNAME = 24;

export class NetworkServer {
  private readonly wss: WebSocketServer;
  private readonly players = new Map<WebSocket, EntityId>();
  private broadcastTimer?: NodeJS.Timeout;

  constructor(
    server: Server,
    private readonly game: Game,
    private readonly store: PlayerStore,
  ) {
    this.wss = new WebSocketServer({ server });
    this.wss.on("connection", (socket) => this.onConnection(socket));
  }

  start(): void {
    this.broadcastTimer = setInterval(() => this.broadcast(), SNAPSHOT_INTERVAL_MS);
  }

  stop(): void {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    this.wss.close();
  }

  /** Save every logged-in player (used on server shutdown). */
  saveAll(): void {
    for (const playerId of this.players.values()) this.persist(playerId);
  }

  private onConnection(socket: WebSocket): void {
    // No player yet — wait for the login message.
    socket.on("message", (data) => this.onMessage(socket, data));
    socket.on("close", () => this.onClose(socket));
    socket.on("error", () => socket.close());
  }

  private onMessage(socket: WebSocket, data: RawData): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }

    const playerId = this.players.get(socket);

    // Pre-login: only `login` is accepted.
    if (playerId === undefined) {
      if (msg.type === "login") this.handleLogin(socket, msg.username);
      return;
    }

    this.dispatch(socket, playerId, msg);
  }

  private handleLogin(socket: WebSocket, rawUsername: string): void {
    const username = String(rawUsername ?? "").trim().slice(0, MAX_USERNAME);
    if (!username) {
      this.send(socket, { type: "loginError", message: "Please enter a username." });
      return;
    }
    if (this.game.findByUsername(username) !== null) {
      this.send(socket, { type: "loginError", message: `${username} is already online.` });
      return;
    }

    const record = this.store.loadOrCreate(username);
    const playerId = this.game.spawnPlayerFromRecord(record);
    this.players.set(socket, playerId);
    this.send(socket, { type: "welcome", playerId, username });
  }

  private dispatch(socket: WebSocket, playerId: EntityId, msg: ClientMessage): void {
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
      case "setClass":
        this.game.setClass(playerId, msg.classId);
        break;
      case "setStance":
        this.game.setStance(playerId, msg.stanceId);
        break;
      case "spendTalent":
        this.game.spendTalent(playerId, msg.talentId);
        break;
      case "resetTalents":
        this.game.resetTalents(playerId);
        break;
      case "equipItem":
        this.game.equipItem(playerId, msg.bagIndex);
        break;
      case "unequipItem":
        this.game.unequipItem(playerId, msg.slot);
        break;
      case "lootItem":
        this.game.lootItem(playerId, msg.sourceId, msg.lootIndex);
        break;
      case "devCommand":
        this.handleDevCommand(playerId, msg.command, msg.arg);
        break;
    }
  }

  private handleDevCommand(playerId: EntityId, command: string, arg?: string): void {
    switch (command) {
      case "save":
        this.persist(playerId);
        this.game.pushLog("Character saved to the database.");
        break;
      case "item":
        if (arg) this.game.devGiveItem(playerId, arg.trim());
        else this.game.pushLog("Usage: /item [id]");
        break;
      case "spawn":
        this.game.devTeleportOrigin(playerId);
        break;
    }
  }

  private onClose(socket: WebSocket): void {
    const playerId = this.players.get(socket);
    if (playerId === undefined) return;
    this.persist(playerId); // blocking save before despawn
    this.players.delete(socket);
    this.game.removePlayer(playerId);
  }

  /** Build and atomically persist a player's full record. */
  private persist(playerId: EntityId): void {
    const record = this.game.buildPersisted(playerId);
    if (record) this.store.saveFull(record);
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
        stanceCdRemaining: this.game.stanceCdRemaining(playerId, now),
        talents: this.game.talentState(playerId),
        containers: this.game.containerState(playerId),
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

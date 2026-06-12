/**
 * Thin WebSocket client. Decodes server messages into the shared ClientState
 * and exposes typed senders for the input layer to drive.
 */

import type {
  ClassId,
  ClientMessage,
  DevCommandName,
  EquipSlot,
  ServerMessage,
} from "@wow/shared";
import type { ClientState } from "../state/ClientState.js";

const WS_URL =
  import.meta.env.VITE_WS_URL ?? `ws://${location.hostname}:3001`;

export class Connection {
  private socket?: WebSocket;
  private lastMove = { dx: 0, dy: 0 };
  /** Account name to (re)send on connect; null when logged out. */
  private username: string | null = null;
  private intentionalClose = false;

  // UI hooks set by the bootstrap.
  onLogin?: (username: string) => void;
  onLoginError?: (message: string) => void;
  onLogout?: () => void;

  constructor(private readonly state: ClientState) {}

  /** Log in (or create) an account; (re)connects the socket as needed. */
  login(username: string): void {
    this.username = username;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.send({ type: "login", username });
    } else {
      this.connect();
    }
  }

  /** Disconnect intentionally; the server saves on socket close. */
  logout(): void {
    this.intentionalClose = true;
    this.username = null;
    this.state.reset();
    this.socket?.close();
  }

  private connect(): void {
    this.intentionalClose = false;
    const socket = new WebSocket(WS_URL);
    this.socket = socket;
    socket.onopen = () => {
      if (this.username) this.send({ type: "login", username: this.username });
    };
    socket.onclose = () => {
      if (this.intentionalClose) {
        this.onLogout?.();
        return;
      }
      // Unexpected drop: reconnect and (via onopen) re-login automatically.
      setTimeout(() => this.connect(), 1000);
    };
    socket.onmessage = (ev) => this.onMessage(ev.data);
  }

  private onMessage(data: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome":
        this.state.playerId = msg.playerId;
        this.onLogin?.(msg.username);
        break;
      case "loginError":
        this.onLoginError?.(msg.message);
        break;
      case "snapshot":
        this.state.applySnapshot(msg);
        break;
      case "combatLog":
        this.state.appendLog(msg.events);
        break;
    }
  }

  private send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  setTarget(targetId: number | null): void {
    this.send({ type: "setTarget", targetId });
  }

  castSpell(spellId: string): void {
    this.send({ type: "castSpell", spellId });
  }

  toggleAutoAttack(): void {
    this.send({ type: "toggleAutoAttack" });
  }

  setClass(classId: ClassId): void {
    this.send({ type: "setClass", classId });
  }

  setStance(stanceId: string): void {
    this.send({ type: "setStance", stanceId });
  }

  spendTalent(talentId: string): void {
    this.send({ type: "spendTalent", talentId });
  }

  resetTalents(): void {
    this.send({ type: "resetTalents" });
  }

  equipItem(bagIndex: number): void {
    this.send({ type: "equipItem", bagIndex });
  }

  unequipItem(slot: EquipSlot): void {
    this.send({ type: "unequipItem", slot });
  }

  lootItem(sourceId: number, lootIndex: number): void {
    this.send({ type: "lootItem", sourceId, lootIndex });
  }

  devCommand(command: DevCommandName, arg?: string): void {
    this.send({ type: "devCommand", command, arg });
  }

  /** Send a movement vector only when it changes, to avoid socket spam. */
  setMove(dx: number, dy: number): void {
    if (dx === this.lastMove.dx && dy === this.lastMove.dy) return;
    this.lastMove = { dx, dy };
    this.send({ type: "move", dx, dy });
  }
}

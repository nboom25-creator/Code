/**
 * Tiny GM/developer slash-command console beneath the canvas:
 *   /save        force an instant DB save
 *   /item [id]   insert an item id into the backpack (server-validated)
 *   /spawn       teleport back to the origin
 * Plus a Logout button that disconnects (triggering a server-side save).
 */

import type { Connection } from "../net/Connection.js";

export class DevConsole {
  private readonly input = document.createElement("input");

  constructor(parent: HTMLElement, private readonly connection: Connection) {
    const row = document.createElement("div");
    row.className = "dev-row";

    this.input.className = "dev-input";
    this.input.type = "text";
    this.input.placeholder = "/save · /item [id] · /spawn";
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.run();
      // Don't let movement/hotkeys fire while typing.
      e.stopPropagation();
    });

    const logout = document.createElement("button");
    logout.className = "dev-logout";
    logout.textContent = "Logout";
    logout.addEventListener("click", () => this.connection.logout());

    row.append(this.input, logout);
    parent.append(row);
  }

  private run(): void {
    const text = this.input.value.trim();
    this.input.value = "";
    if (!text.startsWith("/")) return;

    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "save":
        this.connection.devCommand("save");
        break;
      case "item":
        this.connection.devCommand("item", arg);
        break;
      case "spawn":
        this.connection.devCommand("spawn");
        break;
    }
  }
}

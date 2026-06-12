/**
 * Textual login / character-select screen shown before the world loads.
 * A username and "Enter Azeroth" button is all that's needed — the server
 * loads the account if it exists, or creates a fresh one at (0,0).
 */

export class LoginScreen {
  private readonly root = document.createElement("div");
  private readonly input = document.createElement("input");
  private readonly button = document.createElement("button");
  private readonly error = document.createElement("div");

  constructor(parent: HTMLElement, onSubmit: (username: string) => void) {
    this.root.className = "login-screen";

    const panel = document.createElement("div");
    panel.className = "login-panel";

    const title = document.createElement("h1");
    title.className = "login-title";
    title.textContent = "Mini-MMORPG";
    const subtitle = document.createElement("div");
    subtitle.className = "login-subtitle";
    subtitle.textContent = "Enter a character name to begin";

    this.input.className = "login-input";
    this.input.type = "text";
    this.input.placeholder = "Username";
    this.input.maxLength = 24;
    this.input.autofocus = true;

    this.button.className = "login-button";
    this.button.textContent = "Enter Azeroth";

    this.error.className = "login-error";

    const submit = () => {
      const username = this.input.value.trim();
      if (!username) {
        this.showError("Please enter a username.");
        return;
      }
      this.error.textContent = "";
      onSubmit(username);
    };
    this.button.addEventListener("click", submit);
    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // don't leak typing into game hotkeys
      if (e.key === "Enter") submit();
    });

    panel.append(title, subtitle, this.input, this.button, this.error);
    this.root.append(panel);
    parent.append(this.root);
    this.input.focus();
  }

  show(): void {
    this.root.classList.remove("hidden");
    this.input.value = "";
    this.error.textContent = "";
    this.input.focus();
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  showError(message: string): void {
    this.error.textContent = message;
  }
}

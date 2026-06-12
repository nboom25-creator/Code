/**
 * On-screen virtual joystick for touch devices. Drag the knob to send a
 * movement direction to the server (the server normalizes it, so only the
 * direction matters); release to stop. Uses Pointer Events so it works for
 * touch and mouse alike.
 */

import type { Connection } from "../net/Connection.js";

const RADIUS = 48; // max knob travel in px
const DEAD_ZONE = 6;

export class VirtualJoystick {
  private readonly base = document.createElement("div");
  private readonly knob = document.createElement("div");
  private pointerId: number | null = null;

  constructor(parent: HTMLElement, private readonly connection: Connection) {
    this.base.className = "joystick-base";
    this.knob.className = "joystick-knob";
    this.base.append(this.knob);
    parent.append(this.base);

    this.base.addEventListener("pointerdown", (e) => this.onDown(e));
    this.base.addEventListener("pointermove", (e) => this.onMove(e));
    this.base.addEventListener("pointerup", (e) => this.onUp(e));
    this.base.addEventListener("pointercancel", (e) => this.onUp(e));
  }

  private onDown(e: PointerEvent): void {
    this.pointerId = e.pointerId;
    this.base.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.apply(e);
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.apply(e);
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.knob.style.transform = "translate(0px, 0px)";
    this.connection.setMove(0, 0);
  }

  private apply(e: PointerEvent): void {
    const rect = this.base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const mag = Math.hypot(dx, dy);

    // Position the knob (clamped to the base radius).
    const clamped = Math.min(mag, RADIUS);
    const angle = Math.atan2(dy, dx);
    this.knob.style.transform = `translate(${Math.cos(angle) * clamped}px, ${Math.sin(angle) * clamped}px)`;

    if (mag < DEAD_ZONE) {
      this.connection.setMove(0, 0);
      return;
    }
    // Send a unit direction (y-down matches world coords). Rounded to limit spam.
    const nx = Math.round((dx / mag) * 100) / 100;
    const ny = Math.round((dy / mag) * 100) / 100;
    this.connection.setMove(nx, ny);
  }
}

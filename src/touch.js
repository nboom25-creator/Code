// ===========================================================
// Touch controls for phones/tablets: a virtual movement stick
// (left), and Jump / Target buttons (right). Camera-look,
// tap-to-select and pinch-zoom are handled by the canvas
// pointer handlers in main.js. The action bar is already tappable.
// ===========================================================
import * as THREE from "three";

export function isTouchDevice() {
  return (matchMedia && matchMedia("(pointer: coarse)").matches) ||
         ("ontouchstart" in window) ||
         new URLSearchParams(location.search).has("touch");
}

// helpers: { jump(), cycleTarget() }; state = G (we set state.input.axis)
export function initTouchControls(state, helpers) {
  document.body.classList.add("touch");
  const ui = document.getElementById("game-ui");

  // ---- movement joystick ----
  const joy = document.createElement("div");
  joy.id = "touch-joystick";
  joy.innerHTML = `<div class="joy-thumb"></div>`;
  ui.appendChild(joy);
  const thumb = joy.querySelector(".joy-thumb");
  const R = 52;                       // max thumb travel (px)
  let joyId = null, cx = 0, cy = 0;

  state.input.axis = { f: 0, r: 0 };

  const setThumb = (dx, dy) => { thumb.style.transform = `translate(${dx}px, ${dy}px)`; };

  joy.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    joyId = e.pointerId;
    const rect = joy.getBoundingClientRect();
    cx = rect.left + rect.width / 2;
    cy = rect.top + rect.height / 2;
    try { joy.setPointerCapture(e.pointerId); } catch {}
    moveJoy(e.clientX, e.clientY);
  });
  joy.addEventListener("pointermove", e => {
    if (e.pointerId !== joyId) return;
    e.preventDefault();
    moveJoy(e.clientX, e.clientY);
  });
  const endJoy = e => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    state.input.axis.f = 0; state.input.axis.r = 0;
    setThumb(0, 0);
  };
  joy.addEventListener("pointerup", endJoy);
  joy.addEventListener("pointercancel", endJoy);

  function moveJoy(px, py) {
    let dx = px - cx, dy = py - cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    setThumb(dx, dy);
    state.input.axis.r = dx / R;        // right
    state.input.axis.f = -dy / R;       // up = forward
  }

  // ---- action buttons ----
  const btns = document.createElement("div");
  btns.id = "touch-buttons";
  btns.innerHTML = `
    <button class="touch-btn" id="tb-target" title="Target">🎯</button>
    <button class="touch-btn big" id="tb-jump" title="Jump">⤒</button>`;
  ui.appendChild(btns);

  const hook = (id, fn) => {
    const el = document.getElementById(id);
    el.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); fn(); });
  };
  hook("tb-jump", () => { state.input.jump = true; });
  hook("tb-target", () => helpers.cycleTarget());
}

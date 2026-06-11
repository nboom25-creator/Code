/**
 * Client bootstrap. Wires the network connection, world renderer and HUD
 * components together, then runs a single requestAnimationFrame render loop.
 */

import { ClientState } from "./state/ClientState.js";
import { Connection } from "./net/Connection.js";
import { Renderer } from "./render/Renderer.js";
import { UnitFrames } from "./render/UnitFrames.js";
import { CastBar } from "./render/CastBar.js";
import { ActionBar } from "./render/ActionBar.js";
import { ClassBar } from "./render/ClassBar.js";
import { TalentPanel } from "./render/TalentPanel.js";
import { CharacterPanel } from "./render/CharacterPanel.js";
import { LootWindow } from "./render/LootWindow.js";
import { ItemTooltip } from "./render/ItemTooltip.js";
import { CombatLog } from "./render/CombatLog.js";
import { Input } from "./input/Input.js";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} element`);
  return node as T;
}

const state = new ClientState();
const connection = new Connection(state);

const canvas = el<HTMLCanvasElement>("game");
const renderer = new Renderer(canvas, state);

const unitFrames = new UnitFrames(el("unit-frames"));
const castBar = new CastBar(el("cast-bar-container"));
const combatLog = new CombatLog(el("combat-log"));
const actionBar = new ActionBar(el("action-bar"), state, ActionBar.defaultSlots(connection), connection);
const classBar = new ClassBar(el("class-bar"), state, connection);
const tooltip = new ItemTooltip(el("tooltip-root"));
const talentPanel = new TalentPanel(el("talent-root"), state, connection);
const characterPanel = new CharacterPanel(el("character-root"), state, connection, tooltip);
const lootWindow = new LootWindow(el("loot-root"), state, connection, renderer, tooltip);

const input = new Input(connection, state, renderer, actionBar, classBar, talentPanel, characterPanel, canvas);
input.attach();

connection.connect();

function frame(): void {
  renderer.render();
  unitFrames.update(state);
  castBar.update(state);
  actionBar.update();
  classBar.update();
  talentPanel.update();
  characterPanel.update();
  lootWindow.update();
  combatLog.update(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

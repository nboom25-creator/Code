// Options page: API key, model, body photo library, storage.

import * as db from "../lib/db.js";
import { BODIES, LOOKS } from "../lib/db.js";
import { downscale, thumbnail, prettyBytes } from "../lib/images.js";
import { getSettings, setSettings, DEFAULT_MODEL } from "../lib/settings.js";
import { verifyKey } from "../lib/gemini.js";

const $ = (id) => document.getElementById(id);
const MAX_EDGE = 1024;

let settings = null;
let bodies = [];

init();

async function init() {
  settings = await getSettings();

  $("apiKey").value = settings.apiKey;
  $("model").value = settings.model || DEFAULT_MODEL;
  $("autoSave").checked = settings.autoSave;

  $("saveKey").addEventListener("click", saveKey);
  $("toggleKey").addEventListener("click", toggleKeyVisibility);
  $("testKey").addEventListener("click", testKey);

  $("model").addEventListener("change", saveModel);
  $("findModels").addEventListener("click", findModels);
  $("resetModel").addEventListener("click", async () => {
    $("model").value = DEFAULT_MODEL;
    await saveModel();
  });

  $("addBody").addEventListener("click", () => $("filePicker").click());
  $("filePicker").addEventListener("change", onFilesChosen);

  $("autoSave").addEventListener("change", async (e) => {
    settings = await setSettings({ autoSave: e.target.checked });
    toast(e.target.checked ? "Try-ons will be saved automatically." : "Auto-save off.");
  });

  $("clearLooks").addEventListener("click", clearLooks);
  $("clearAll").addEventListener("click", clearAll);

  await loadBodies();
  refreshUsage();
}

// ───────────────────────────────── key ───────────────────────────────────

async function saveKey() {
  settings = await setSettings({ apiKey: $("apiKey").value.trim() });
  toast("API key saved.");
}

function toggleKeyVisibility() {
  const input = $("apiKey");
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  $("toggleKey").textContent = hidden ? "Hide" : "Show";
}

async function testKey() {
  const key = $("apiKey").value.trim();
  const status = $("keyStatus");
  if (!key) {
    status.textContent = "Paste a key first.";
    return;
  }
  status.textContent = "Checking…";
  try {
    const { models } = await verifyKey(key);
    settings = await setSettings({ apiKey: key });
    status.textContent = models.length
      ? `Working — ${models.length} image model${models.length === 1 ? "" : "s"} available.`
      : "Key works, but no image models are enabled for it.";
    fillModelList(models);
  } catch (err) {
    status.textContent = err.message;
  }
}

// ──────────────────────────────── model ──────────────────────────────────

async function saveModel() {
  const value = $("model").value.trim() || DEFAULT_MODEL;
  $("model").value = value;
  settings = await setSettings({ model: value });
  toast(`Using ${value}.`);
}

async function findModels() {
  const key = $("apiKey").value.trim() || settings.apiKey;
  const status = $("modelStatus");
  if (!key) {
    status.textContent = "Add an API key first.";
    return;
  }
  status.textContent = "Asking Google what your key can reach…";
  try {
    const { models } = await verifyKey(key);
    fillModelList(models);
    status.textContent = models.length
      ? `Found ${models.length}: ${models.map((m) => m.id).join(", ")}`
      : "No image-capable models found for this key.";
  } catch (err) {
    status.textContent = err.message;
  }
}

function fillModelList(models) {
  $("modelList").replaceChildren(
    ...models.map((m) => Object.assign(document.createElement("option"), { value: m.id }))
  );
}

// ────────────────────────────── body photos ──────────────────────────────

async function loadBodies() {
  bodies = await db.all(BODIES);
  renderBodies();
}

function renderBodies() {
  $("bodyEmpty").hidden = bodies.length > 0;
  $("bodyGrid").replaceChildren(...bodies.map(renderBodyCard));
}

function renderBodyCard(body) {
  const card = document.createElement("div");
  card.className = "bodycard";
  card.classList.toggle("is-default", body.id === settings.defaultBodyId);

  const img = document.createElement("img");
  img.src = body.thumbUrl || body.dataUrl;
  img.alt = body.name || "Body photo";

  const name = document.createElement("input");
  name.className = "bodycard__name";
  name.value = body.name || "";
  name.setAttribute("aria-label", "Photo name");
  name.addEventListener("change", async () => {
    await db.put(BODIES, { ...body, name: name.value.trim() || "Untitled" });
    await loadBodies();
  });

  const actions = document.createElement("div");
  actions.className = "bodycard__actions";

  if (body.id === settings.defaultBodyId) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Default";
    actions.append(badge);
  } else {
    const use = document.createElement("button");
    use.className = "link";
    use.type = "button";
    use.textContent = "Make default";
    use.addEventListener("click", async () => {
      settings = await setSettings({ defaultBodyId: body.id });
      renderBodies();
    });
    actions.append(use);
  }

  const remove = document.createElement("button");
  remove.className = "link link--danger";
  remove.type = "button";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    if (!confirm(`Delete “${body.name || "this photo"}”?`)) return;
    await db.del(BODIES, body.id);
    bodies = await db.all(BODIES);
    if (settings.defaultBodyId === body.id) {
      settings = await setSettings({ defaultBodyId: bodies[0]?.id || "" });
    }
    renderBodies();
    refreshUsage();
  });
  actions.append(remove);

  const bodyEl = document.createElement("div");
  bodyEl.className = "bodycard__body";
  bodyEl.append(name, actions);
  card.append(img, bodyEl);
  return card;
}

async function onFilesChosen(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  if (!files.length) return;

  for (const file of files) {
    const raw = await fileToDataUrl(file);
    const { dataUrl } = await downscale(raw, MAX_EDGE);
    await db.put(BODIES, {
      id: db.newId(),
      name: file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Photo",
      dataUrl,
      thumbUrl: await thumbnail(dataUrl, 300),
      createdAt: Date.now(),
    });
  }

  bodies = await db.all(BODIES);
  if (!settings.defaultBodyId || !bodies.some((b) => b.id === settings.defaultBodyId)) {
    settings = await setSettings({ defaultBodyId: bodies[0].id });
  }
  renderBodies();
  refreshUsage();
  toast(`Added ${files.length} photo${files.length === 1 ? "" : "s"}.`);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────── storage ─────────────────────────────────

async function refreshUsage() {
  const { bytes, bodies: bodyCount, looks } = await db.usage();
  $("usage").textContent =
    `${bodyCount} photo${bodyCount === 1 ? "" : "s"} and ${looks} saved look${
      looks === 1 ? "" : "s"
    }, using about ${prettyBytes(bytes)}.`;
}

async function clearLooks() {
  if (!confirm("Delete every saved look? This cannot be undone.")) return;
  await db.clear(LOOKS);
  refreshUsage();
  toast("Lookbook cleared.");
}

async function clearAll() {
  if (!confirm("Delete all photos, looks and settings, including your API key?")) return;
  await Promise.all([db.clear(LOOKS), db.clear(BODIES)]);
  await chrome.storage.local.clear();
  settings = await getSettings();
  bodies = [];
  $("apiKey").value = "";
  $("model").value = DEFAULT_MODEL;
  $("autoSave").checked = settings.autoSave;
  renderBodies();
  refreshUsage();
  toast("Everything deleted.");
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

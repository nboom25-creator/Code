// Side panel controller.
//
// Note on untrusted text: page titles, image alt text and product URLs come
// from whatever store the shopper is on, so everything derived from them is set
// with textContent / setAttribute, never innerHTML.

import * as db from "../lib/db.js";
import { BODIES, LOOKS } from "../lib/db.js";
import { downscale, thumbnail, prettyBytes } from "../lib/images.js";
import { getSettings, setSettings, onSettingsChanged } from "../lib/settings.js";
import { generateTryOn } from "../lib/gemini.js";
import {
  buildPrompt,
  FIT_OPTIONS,
  BACKGROUND_OPTIONS,
  FRAMING_OPTIONS,
} from "../lib/prompt.js";

const $ = (id) => document.getElementById(id);

const MAX_EDGE = 1024; // what we send to the model
const PENDING_TTL = 5 * 60 * 1000; // ignore stale staged garments

const state = {
  settings: null,
  bodies: [],
  looks: [],
  garment: null, // { dataUrl, sourceUrl, pageUrl, pageTitle, alt }
  result: null, // { dataUrl, look }
  controller: null,
  picking: new Set(), // lookbook compare selection
  compareMode: false,
  filePickerMode: "garment",
  timer: null,
};

// ───────────────────────────────── boot ──────────────────────────────────

init();

async function init() {
  state.settings = await getSettings();
  fillSelect($("optFit"), FIT_OPTIONS, state.settings.fit);
  fillSelect($("optFraming"), FRAMING_OPTIONS, state.settings.framing);
  fillSelect($("optBackground"), BACKGROUND_OPTIONS, state.settings.background);
  $("optNotes").value = state.settings.notes || "";

  wireEvents();

  await Promise.all([loadBodies(), loadLooks()]);
  renderSetup();
  renderReady();

  chrome.runtime.sendMessage({ type: "panel-opened" }).catch(() => {});
  await consumePendingGarment();

  onSettingsChanged((next) => {
    state.settings = next;
    renderSetup();
    renderReady();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "garment-staged") consumePendingGarment();
  });
}

function fillSelect(select, options, value) {
  select.replaceChildren(
    ...options.map(([val, label]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      return opt;
    })
  );
  select.value = value;
}

// ──────────────────────────────── events ─────────────────────────────────

function wireEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  $("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("manageBodies").addEventListener("click", () => chrome.runtime.openOptionsPage());

  $("setupSave").addEventListener("click", saveKeyFromSetup);
  $("setupKey").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveKeyFromSetup();
  });

  // garment sources -------------------------------------------------------
  $("uploadGarment").addEventListener("click", () => openFilePicker("garment"));
  $("garmentDrop").addEventListener("click", () => openFilePicker("garment"));
  $("clearGarment").addEventListener("click", clearGarment);
  $("scanPage").addEventListener("click", scanPage);
  $("pickerClose").addEventListener("click", () => ($("pickerWrap").hidden = true));
  $("filePicker").addEventListener("change", onFileChosen);

  const drop = $("garmentDrop");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-dragging");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
  drop.addEventListener("drop", onDrop);
  document.addEventListener("paste", onPaste);

  // options ---------------------------------------------------------------
  for (const [id, key] of [
    ["optFit", "fit"],
    ["optFraming", "framing"],
    ["optBackground", "background"],
    ["optNotes", "notes"],
  ]) {
    $(id).addEventListener("change", async (e) => {
      state.settings = await setSettings({ [key]: e.target.value });
    });
  }

  // generate --------------------------------------------------------------
  $("tryOn").addEventListener("click", runTryOn);
  $("regenBtn").addEventListener("click", runTryOn);
  $("cancel").addEventListener("click", () => state.controller?.abort());
  $("downloadBtn").addEventListener("click", () => {
    if (state.result) download(state.result.dataUrl, "fitting-room");
  });

  const compareBtn = $("compareBtn");
  const hold = (show) => () => {
    const body = currentBody();
    if (!body || !state.result) return;
    $("compareImg").src = body.dataUrl;
    $("compareImg").hidden = !show;
  };
  compareBtn.addEventListener("pointerdown", hold(true));
  compareBtn.addEventListener("pointerup", hold(false));
  compareBtn.addEventListener("pointerleave", hold(false));

  // lookbook --------------------------------------------------------------
  $("compareMode").addEventListener("click", toggleCompareMode);
  $("clearLooks").addEventListener("click", clearLooks);
  $("detailClose").addEventListener("click", () => ($("detail").hidden = true));
}

function switchTab(name) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  $("view-fit").hidden = name !== "fit";
  $("view-lookbook").hidden = name !== "lookbook";
}

// ───────────────────────────────── setup ─────────────────────────────────

function renderSetup() {
  $("setupCard").hidden = Boolean(state.settings.apiKey);
}

async function saveKeyFromSetup() {
  const key = $("setupKey").value.trim();
  const err = $("setupError");
  if (!key) {
    err.textContent = "Paste a key first.";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  state.settings = await setSettings({ apiKey: key });
  $("setupKey").value = "";
  renderSetup();
  renderReady();
}

// ────────────────────────────── body photos ──────────────────────────────

async function loadBodies() {
  state.bodies = await db.all(BODIES);
  if (
    state.bodies.length &&
    !state.bodies.some((b) => b.id === state.settings.defaultBodyId)
  ) {
    state.settings = await setSettings({ defaultBodyId: state.bodies[0].id });
  }
  renderBodies();
}

function currentBody() {
  return state.bodies.find((b) => b.id === state.settings.defaultBodyId) || null;
}

function renderBodies() {
  const strip = $("bodyStrip");
  const nodes = state.bodies.map((body) => {
    const btn = document.createElement("button");
    btn.className = "bodychip";
    btn.classList.toggle("is-selected", body.id === state.settings.defaultBodyId);
    btn.title = body.name || "Body photo";
    const img = document.createElement("img");
    img.src = body.thumbUrl || body.dataUrl;
    img.alt = body.name || "Body photo";
    btn.append(img);
    btn.addEventListener("click", async () => {
      state.settings = await setSettings({ defaultBodyId: body.id });
      renderBodies();
      renderReady();
    });
    return btn;
  });

  const add = document.createElement("button");
  add.className = "bodychip bodychip--add";
  add.textContent = "＋";
  add.title = "Add a photo of yourself";
  add.addEventListener("click", () => openFilePicker("body"));
  nodes.push(add);

  strip.replaceChildren(...nodes);
  $("bodyHint").hidden = state.bodies.length > 0;
}

async function addBodyPhoto(dataUrl, name) {
  let sized;
  try {
    ({ dataUrl: sized } = await downscale(dataUrl, MAX_EDGE));
  } catch {
    showError("Chrome could not read that photo. Try a JPEG or PNG.");
    return;
  }
  const record = {
    id: db.newId(),
    name: name || `Photo ${state.bodies.length + 1}`,
    dataUrl: sized,
    thumbUrl: await safeThumb(sized, 180),
    createdAt: Date.now(),
  };
  await db.put(BODIES, record);
  state.settings = await setSettings({ defaultBodyId: record.id });
  await loadBodies();
  renderReady();
}

// ──────────────────────────────── garment ────────────────────────────────

function openFilePicker(mode) {
  state.filePickerMode = mode;
  $("filePicker").value = "";
  $("filePicker").click();
}

async function onFileChosen(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const dataUrl = await fileToDataUrl(file);
  if (state.filePickerMode === "body") {
    await addBodyPhoto(dataUrl, file.name.replace(/\.[^.]+$/, ""));
  } else {
    await setGarment(dataUrl, { alt: file.name });
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function onDrop(event) {
  event.preventDefault();
  $("garmentDrop").classList.remove("is-dragging");
  showError(null);

  const file = [...(event.dataTransfer?.files || [])].find((f) =>
    f.type.startsWith("image/")
  );
  if (file) return setGarment(await fileToDataUrl(file), { alt: file.name });

  const url = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain");
  if (url) return loadGarmentFromUrl(url.trim());
}

async function onPaste(event) {
  const item = [...(event.clipboardData?.items || [])].find((i) =>
    i.type.startsWith("image/")
  );
  if (item) {
    const file = item.getAsFile();
    if (file) return setGarment(await fileToDataUrl(file), { alt: "Pasted image" });
  }
  const text = event.clipboardData?.getData("text")?.trim();
  if (text && /^https?:\/\//i.test(text) && document.activeElement?.tagName !== "TEXTAREA") {
    return loadGarmentFromUrl(text);
  }
}

async function loadGarmentFromUrl(url, meta = {}) {
  try {
    setGarmentBusy(true);
    const res = await chrome.runtime.sendMessage({ type: "fetch-image", url });
    if (!res?.ok) throw new Error(res?.error || "Could not load that image.");
    await setGarment(res.dataUrl, { ...meta, sourceUrl: url });
  } catch (err) {
    showError(err.message);
  } finally {
    setGarmentBusy(false);
  }
}

function setGarmentBusy(busy) {
  $("garmentEmpty").textContent = busy ? "Loading image…" : "";
  if (!busy) renderGarment();
}

async function setGarment(dataUrl, meta = {}) {
  showError(null);
  let sized;
  try {
    ({ dataUrl: sized } = await downscale(dataUrl, MAX_EDGE));
  } catch {
    showError("Chrome could not read that image. Try a JPEG or PNG.");
    return;
  }
  state.garment = { dataUrl: sized, ...meta };
  $("pickerWrap").hidden = true;
  renderGarment();
  renderReady();
}

function clearGarment() {
  state.garment = null;
  renderGarment();
  renderReady();
}

function renderGarment() {
  const has = Boolean(state.garment);
  $("garmentPreview").hidden = !has;
  $("garmentEmpty").hidden = has;
  $("clearGarment").hidden = !has;

  const metaEl = $("garmentMeta");
  if (!has) {
    $("garmentEmpty").replaceChildren(
      Object.assign(document.createElement("strong"), {
        textContent: "Hover any product photo",
      }),
      document.createTextNode(" and hit “Try this on”, or drop an image here.")
    );
    metaEl.hidden = true;
    return;
  }

  $("garmentPreview").src = state.garment.dataUrl;
  const label = state.garment.pageTitle || state.garment.alt || state.garment.sourceUrl;
  metaEl.textContent = label || "";
  metaEl.title = label || "";
  metaEl.hidden = !label;
}

async function consumePendingGarment() {
  const { pendingGarment } = await chrome.storage.local.get("pendingGarment");
  if (!pendingGarment?.url) return;
  await chrome.storage.local.remove("pendingGarment");
  if (Date.now() - (pendingGarment.at || 0) > PENDING_TTL) return;

  switchTab("fit");
  await loadGarmentFromUrl(pendingGarment.url, {
    pageUrl: pendingGarment.pageUrl,
    pageTitle: pendingGarment.pageTitle,
    alt: pendingGarment.alt,
  });
}

async function scanPage() {
  showError(null);
  const btn = $("scanPage");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "scan-page" });
    if (!res?.ok) throw new Error(res?.error || "Could not read that page.");
    if (!res.images.length) throw new Error("No product-sized images found on this page.");
    renderPicker(res.images, res);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Grab from page";
  }
}

function renderPicker(images, page) {
  const grid = $("picker");
  grid.replaceChildren(
    ...images.map((candidate) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = candidate.alt || candidate.url;
      const img = document.createElement("img");
      img.src = candidate.url;
      img.alt = candidate.alt || "";
      img.loading = "lazy";
      btn.append(img);
      btn.addEventListener("click", () =>
        loadGarmentFromUrl(candidate.url, {
          pageUrl: page.pageUrl,
          pageTitle: page.pageTitle,
          alt: candidate.alt,
        })
      );
      return btn;
    })
  );
  $("pickerTitle").textContent = `${images.length} images on this page`;
  $("pickerWrap").hidden = false;
}

// ─────────────────────────────── generate ────────────────────────────────

function renderReady() {
  const body = currentBody();
  const missing = [];
  if (!state.settings.apiKey) missing.push("an API key");
  if (!body) missing.push("a photo of you");
  if (!state.garment) missing.push("a garment");

  $("tryOn").disabled = missing.length > 0 || Boolean(state.controller);
  $("hint").textContent = missing.length ? `Still need ${listify(missing)}.` : "";
}

function listify(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

async function runTryOn() {
  const body = currentBody();
  if (!body || !state.garment || state.controller) return;

  showError(null);
  state.controller = new AbortController();
  renderReady();

  $("result").hidden = false;
  $("busy").hidden = false;
  $("compareImg").hidden = true;
  $("savedNote").textContent = "";
  $("resultImg").src = body.dataUrl; // something to look at while it renders
  startTimer();

  const prompt = buildPrompt({
    fit: state.settings.fit,
    framing: state.settings.framing,
    background: state.settings.background,
    notes: state.settings.notes,
    garmentHint: state.garment.alt || state.garment.pageTitle || "",
  });

  try {
    const { dataUrl } = await generateTryOn({
      apiKey: state.settings.apiKey,
      model: state.settings.model,
      personDataUrl: body.dataUrl,
      garmentDataUrl: state.garment.dataUrl,
      prompt,
      signal: state.controller.signal,
    });

    $("resultImg").src = dataUrl;
    state.result = { dataUrl };

    // Saving is best-effort: a full disk or an odd encoding must never cost the
    // shopper the image they just paid for.
    if (state.settings.autoSave) {
      try {
        await saveLook(dataUrl, body, prompt);
        $("savedNote").textContent = "Saved to your lookbook.";
      } catch (err) {
        $("savedNote").textContent = `Couldn't save this one: ${err.message}`;
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") showError(err.message);
    if (!state.result) $("result").hidden = true;
  } finally {
    stopTimer();
    $("busy").hidden = true;
    state.controller = null;
    renderReady();
  }
}

/** Thumbnails are a nicety; fall back to the full image rather than failing. */
async function safeThumb(dataUrl, size) {
  try {
    return await thumbnail(dataUrl, size);
  } catch {
    return dataUrl;
  }
}

async function saveLook(dataUrl, body, prompt) {
  const look = {
    id: db.newId(),
    createdAt: Date.now(),
    resultDataUrl: dataUrl,
    thumbUrl: await safeThumb(dataUrl, 300),
    garmentThumbUrl: await safeThumb(state.garment.dataUrl, 180),
    garmentUrl: state.garment.sourceUrl || "",
    productUrl: state.garment.pageUrl || "",
    productTitle: state.garment.pageTitle || state.garment.alt || "",
    bodyId: body.id,
    model: state.settings.model,
    prompt,
  };
  await db.put(LOOKS, look);
  await loadLooks();
  return look;
}

function startTimer() {
  const started = Date.now();
  $("busyTimer").textContent = "0s";
  state.timer = setInterval(() => {
    $("busyTimer").textContent = `${Math.round((Date.now() - started) / 1000)}s`;
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = null;
}

function showError(message) {
  const el = $("error");
  el.textContent = message || "";
  el.hidden = !message;
}

// ─────────────────────────────── lookbook ────────────────────────────────

async function loadLooks() {
  state.looks = await db.all(LOOKS);
  renderLookbook();
}

function renderLookbook() {
  const count = $("lookCount");
  count.textContent = String(state.looks.length);
  count.hidden = state.looks.length === 0;

  $("lookEmpty").hidden = state.looks.length > 0;
  $("lookGrid").replaceChildren(
    ...state.looks.map((look) => {
      const card = document.createElement("button");
      card.className = "lookcard";
      card.classList.toggle("is-picked", state.picking.has(look.id));

      const img = document.createElement("img");
      img.src = look.thumbUrl || look.resultDataUrl;
      img.alt = look.productTitle || "Saved look";
      img.loading = "lazy";

      const label = document.createElement("div");
      label.className = "lookcard__label";
      label.textContent = look.productTitle || formatDate(look.createdAt);

      card.append(img, label);
      if (state.picking.has(look.id)) {
        const tick = document.createElement("span");
        tick.className = "lookcard__tick";
        tick.textContent = "✓";
        card.append(tick);
      }

      card.addEventListener("click", () =>
        state.compareMode ? togglePick(look) : openDetail(look)
      );
      return card;
    })
  );

  renderCompareStrip();
}

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toggleCompareMode() {
  state.compareMode = !state.compareMode;
  state.picking.clear();
  $("compareMode").textContent = state.compareMode ? "Done" : "Compare";
  $("compareHelp").hidden = !state.compareMode;
  renderLookbook();
}

function togglePick(look) {
  if (state.picking.has(look.id)) state.picking.delete(look.id);
  else if (state.picking.size < 3) state.picking.add(look.id);
  renderLookbook();
}

function renderCompareStrip() {
  const strip = $("compareStrip");
  const picked = state.looks.filter((l) => state.picking.has(l.id));
  strip.hidden = picked.length < 2;
  if (strip.hidden) return;
  strip.replaceChildren(
    ...picked.map((look) => {
      const img = document.createElement("img");
      img.src = look.resultDataUrl;
      img.alt = look.productTitle || "Saved look";
      return img;
    })
  );
}

async function clearLooks() {
  if (!state.looks.length) return;
  if (!confirm(`Delete all ${state.looks.length} saved looks? This cannot be undone.`)) {
    return;
  }
  await db.clear(LOOKS);
  state.picking.clear();
  await loadLooks();
}

function openDetail(look) {
  $("detailImg").src = look.resultDataUrl;
  $("detailTitle").textContent = look.productTitle || "Untitled look";
  $("detailDate").textContent = `${formatDate(look.createdAt)} · ${look.model || ""}`;

  const link = $("detailLink");
  const isWeb = /^https?:\/\//i.test(look.productUrl || "");
  link.hidden = !isWeb;
  if (isWeb) link.href = look.productUrl;

  $("detailDownload").onclick = () => download(look.resultDataUrl, "fitting-room");
  $("detailDelete").onclick = async () => {
    if (!confirm("Delete this look?")) return;
    await db.del(LOOKS, look.id);
    state.picking.delete(look.id);
    $("detail").hidden = true;
    await loadLooks();
  };
  $("detailReuse").onclick = async () => {
    if (look.garmentThumbUrl) {
      await setGarment(look.garmentThumbUrl, {
        pageUrl: look.productUrl,
        pageTitle: look.productTitle,
      });
    }
    $("detail").hidden = true;
    switchTab("fit");
  };

  $("detail").hidden = false;
}

function download(dataUrl, prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${prefix}-${stamp}.png`;
  a.click();
}

// Surface storage pressure before Chrome starts refusing writes.
navigator.storage?.estimate?.().then((est) => {
  if (est?.usage && est.quota && est.usage / est.quota > 0.9) {
    showError(
      `Storage is nearly full (${prettyBytes(est.usage)}). Clear some looks to keep saving.`
    );
  }
});

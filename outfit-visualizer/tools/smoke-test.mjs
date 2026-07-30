// End-to-end smoke test: loads the unpacked extension into Chromium, exercises
// the real flow (key -> body photo -> garment -> generate -> lookbook) against a
// mocked Gemini endpoint, and fails on any console or page error.
//
//   npm install --no-save playwright
//   node tools/smoke-test.mjs [--headed] [--shots <dir>]
//
// No network is touched: the Gemini call is intercepted and answered locally.

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { encodePng } from "./make-icons.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const SHOT_DIR = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ───────────────────────── 1. static structure ───────────────────────────

console.log("\nmanifest & files");

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
check("manifest.json parses", true);
check("manifest v3", manifest.manifest_version === 3);

const referenced = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  manifest.options_page,
  ...manifest.content_scripts.flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
];
for (const file of new Set(referenced)) {
  check(`referenced file exists: ${file}`, existsSync(join(ROOT, file)));
}

// Every local href/src in the HTML pages must resolve.
for (const html of ["src/sidepanel/sidepanel.html", "src/options/options.html"]) {
  const source = readFileSync(join(ROOT, html), "utf8");
  const base = dirname(join(ROOT, html));
  for (const m of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:|data:|#|mailto:)/.test(ref)) continue;
    check(`${html} -> ${ref}`, existsSync(join(base, ref)));
  }
}

// Local ES-module imports must resolve too.
const jsFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".js")) jsFiles.push(full);
  }
})(join(ROOT, "src"));

for (const file of jsFiles) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
    check(
      `${relative(ROOT, file)} imports ${m[1]}`,
      existsSync(join(dirname(file), m[1]))
    );
  }
}

// ───────────────────────── 2. fixture server ─────────────────────────────

// A stand-in product page, so the content script has a real http origin to
// attach to (content scripts do not run on data: or about:blank). The hero has
// to clear the extension's own 180px product-size threshold to be offered.
function solidPng(width, height, [r, g, b]) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels.set([r, g, b, 255], i * 4);
  }
  return encodePng(width, height, pixels);
}

const heroImage = solidPng(400, 500, [0x7c, 0x5c, 0xff]);
const tinyImage = solidPng(24, 24, [0x33, 0x33, 0x33]);
const server = createServer((req, res) => {
  if (req.url === "/hero.png" || req.url === "/tiny.png") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(req.url === "/hero.png" ? heroImage : tinyImage);
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>Test Store — Violet Hanger Tee</title>
    <body style="background:#fff">
      <img id="hero" src="/hero.png" width="400" height="500" alt="Violet Hanger Tee">
      <img id="tiny" src="/tiny.png" width="24" height="24" alt="icon">
    </body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

// ───────────────────────── 3. launch extension ───────────────────────────

console.log("\nextension runtime");

const context = await chromium.launchPersistentContext("", {
  headless: !HEADED,
  // Extensions need a full Chrome build, not the headless shell. Set
  // CHROMIUM_PATH when the local Playwright download does not match.
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    "--no-sandbox",
  ],
});

const errors = [];
context.on("weberror", (e) => errors.push(`page error: ${e.error()?.message}`));

function watch(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
}

// The service worker registering at all proves the manifest and its ES-module
// imports are valid; a syntax error there shows up as no worker.
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
const extensionId = new URL(worker.url()).host;
check("service worker registered", Boolean(extensionId), extensionId);

// Answer the Gemini call locally with a real, decodable PNG. (Do not swap in
// one of the "1x1 transparent pixel" base64 strings floating around online —
// several are corrupt, and createImageBitmap rejects them.)
const FAKE_IMAGE = solidPng(64, 96, [0x2e, 0xd5, 0x9a]).toString("base64");
let generateCalls = 0;
await context.route("https://generativelanguage.googleapis.com/**", async (route) => {
  const url = route.request().url();
  if (url.includes(":generateContent")) {
    generateCalls++;
    const body = JSON.parse(route.request().postData() || "{}");
    const parts = body.contents?.[0]?.parts || [];
    const images = parts.filter((p) => p.inline_data || p.inlineData);
    check("request carries exactly two images", images.length === 2, `got ${images.length}`);
    check("request has a text prompt", typeof parts[0]?.text === "string");
    check(
      "request asks for image output",
      (body.generationConfig?.responseModalities || []).includes("IMAGE")
    );
    check("request uses the configured model", url.includes("gemini-2.5-flash-image"));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ inlineData: { mimeType: "image/png", data: FAKE_IMAGE } }] },
          },
        ],
      }),
    });
  }
  // model listing
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      models: [
        {
          name: "models/gemini-2.5-flash-image",
          displayName: "Gemini 2.5 Flash Image",
          supportedGenerationMethods: ["generateContent"],
        },
      ],
    }),
  });
});

// Browser-driven sections run inside a guard so that a thrown assertion still
// prints whatever the pages logged — that is usually the actual cause.
try {

// ───────────────────────── 4. options page ───────────────────────────────

console.log("\noptions page");

const options = await context.newPage();
watch(options);
await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
await options.waitForLoadState("domcontentloaded");

await options.fill("#apiKey", "AIza-test-key");
await options.click("#saveKey");
await options.waitForFunction(() => document.getElementById("toast")?.hidden === false);
check("saving the key shows a toast", true);

await options.click("#testKey");
await options.waitForFunction(() =>
  /Working/.test(document.getElementById("keyStatus").textContent)
);
check("test connection reports success", true);

await options.click("#findModels");
await options.waitForFunction(
  () => document.querySelectorAll("#modelList option").length > 0
);
check("model discovery populates the datalist", true);

await options.setInputFiles("#filePicker", join(ROOT, "icons", "icon128.png"));
await options.waitForSelector(".bodycard");
check("body photo added and rendered", true);
check(
  "first photo becomes the default",
  await options.locator(".bodycard.is-default").count() === 1
);

const usage = await options.textContent("#usage");
check("storage readout populated", /1 photo/.test(usage), usage.trim());

if (SHOT_DIR) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await options.screenshot({ path: join(SHOT_DIR, "options.png"), fullPage: true });
}

// ───────────────────────── 5. content script ─────────────────────────────

console.log("\ncontent script");

const store = await context.newPage();
watch(store);
await store.goto(`${origin}/`);
await store.waitForLoadState("networkidle");

await store.hover("#hero");
await store.waitForSelector("#fitting-room-pill.fitting-room-pill--visible", {
  timeout: 5000,
});
check("hover pill appears over a product-sized image", true);

await store.hover("#tiny");
await store.waitForFunction(
  () =>
    !document
      .getElementById("fitting-room-pill")
      ?.classList.contains("fitting-room-pill--visible")
);
check("hover pill ignores tiny images", true);

// Exercise the real path: extension page -> service worker -> content script.
// (Evaluating in the store page itself would run in the main world, which has
// no chrome.runtime, so it has to be driven from an extension context.)
await store.bringToFront();
const scan = await options.evaluate(() =>
  chrome.runtime.sendMessage({ type: "scan-page" })
);
check("worker scan reaches the content script", scan?.ok === true, scan?.error || "");
check(
  "scan returns only the product-sized image",
  scan?.images?.length === 1,
  JSON.stringify(scan?.images?.map((i) => `${i.width}x${i.height}`))
);
check("scan carries the page title", /Violet Hanger Tee/.test(scan?.pageTitle || ""));

// The worker fetches garment bytes on the panel's behalf precisely so that
// cross-origin product CDNs do not trip CORS.
const fetched = await options.evaluate(
  (url) => chrome.runtime.sendMessage({ type: "fetch-image", url }),
  `${origin}/hero.png`
);
check(
  "worker fetches a garment image as a data URL",
  fetched?.ok === true && fetched.dataUrl.startsWith("data:image/png;base64,"),
  fetched?.error || ""
);

// ───────────────────────── 6. side panel flow ────────────────────────────

console.log("\nside panel");

const panel = await context.newPage();
watch(panel);
await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
await panel.waitForSelector(".bodychip.is-selected");
check("saved body photo shows as selected", true);
check("setup card hidden once a key exists", await panel.locator("#setupCard").isHidden());

await panel.setInputFiles("#filePicker", join(ROOT, "icons", "icon48.png"));
await panel.waitForFunction(() => !document.getElementById("garmentPreview").hidden);
check("uploaded garment previews", true);

await panel.waitForFunction(() => !document.getElementById("tryOn").disabled);
check("try-on button enables when everything is ready", true);

await panel.click("#tryOn");
await panel.waitForFunction(
  (fake) => document.getElementById("resultImg").src.includes(fake.slice(0, 40)),
  FAKE_IMAGE,
  { timeout: 20000 }
);
check("generated image renders in the result stage", true);
check("exactly one generate request was made", generateCalls === 1, `${generateCalls}`);

await panel.waitForFunction(() =>
  /Saved to your lookbook/.test(document.getElementById("savedNote").textContent)
);
check("result auto-saved to the lookbook", true);

await panel.click('.tab[data-tab="lookbook"]');
await panel.waitForSelector(".lookcard");
check("lookbook shows the saved look", (await panel.locator(".lookcard").count()) === 1);

await panel.click(".lookcard");
await panel.waitForFunction(() => !document.getElementById("detail").hidden);
check("look detail opens", true);
await panel.click("#detailClose");

if (SHOT_DIR) {
  await panel.click('.tab[data-tab="fit"]');
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.screenshot({ path: join(SHOT_DIR, "sidepanel.png"), fullPage: true });
}

} catch (err) {
  check(`browser flow threw: ${err.message.split("\n")[0]}`, false);
}

// ───────────────────────────── 7. verdict ────────────────────────────────

console.log("\nruntime errors");
if (errors.length) {
  for (const e of errors) console.log(`  FAIL  ${e}`);
  failures += errors.length;
} else {
  check("no console or page errors", true);
}

await context.close();
server.close();

console.log(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);

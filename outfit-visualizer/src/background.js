// Service worker: opens the side panel, owns the right-click menu, and does all
// cross-origin image fetching (host permissions mean no CORS trouble here).

import { fetchImageAsDataUrl } from "./lib/images.js";

const PANEL_PATH = "src/sidepanel/sidepanel.html";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "try-on",
      title: "Try this on in Fitting Room",
      contexts: ["image"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "try-on" || !info.srcUrl) return;
  stageGarment(
    {
      url: info.srcUrl,
      pageUrl: info.pageUrl || tab?.url || "",
      pageTitle: tab?.title || "",
    },
    tab?.id
  );
});

/**
 * Remember the garment the shopper picked, then bring the panel up. The panel
 * reads `pendingGarment` on load and also listens for the live message, so it
 * works whether or not it was already open.
 */
async function stageGarment(garment, tabId) {
  await chrome.storage.local.set({ pendingGarment: { ...garment, at: Date.now() } });
  try {
    if (tabId != null) await chrome.sidePanel.open({ tabId });
  } catch {
    // open() needs a user gesture; if we lose it, nudge via the badge instead.
    chrome.action.setBadgeText({ text: "1" });
    chrome.action.setBadgeBackgroundColor({ color: "#7c5cff" });
  }
  chrome.runtime.sendMessage({ type: "garment-staged", garment }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content script: shopper clicked the "Try on" pill over an image.
  if (msg?.type === "try-on-image") {
    stageGarment(
      {
        url: msg.url,
        pageUrl: sender.tab?.url || "",
        pageTitle: sender.tab?.title || "",
        alt: msg.alt || "",
      },
      sender.tab?.id
    );
    sendResponse({ ok: true });
    return false;
  }

  // Side panel: fetch a remote image without CORS getting in the way.
  if (msg?.type === "fetch-image") {
    fetchImageAsDataUrl(msg.url)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  // Side panel: ask the active tab for its product images.
  if (msg?.type === "scan-page") {
    scanActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg?.type === "panel-opened") {
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab to scan.");
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    throw new Error("Chrome blocks extensions on this page. Open a store page and try again.");
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "collect-images" });
  } catch {
    // Content script not there yet (installed mid-session, or a slow page).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content/content.js"],
    });
    response = await chrome.tabs.sendMessage(tab.id, { type: "collect-images" });
  }

  return {
    images: response?.images || [],
    pageUrl: tab.url || "",
    pageTitle: response?.title || tab.title || "",
  };
}

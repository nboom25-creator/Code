// Small key/value settings kept in chrome.storage.local. Images never go here.

export const DEFAULT_MODEL = "gemini-2.5-flash-image";

export const DEFAULTS = {
  apiKey: "",
  model: DEFAULT_MODEL,
  defaultBodyId: "",
  fit: "true-to-size",
  background: "keep",
  framing: "keep",
  notes: "",
  autoSave: true,
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      callback({ ...DEFAULTS, ...(changes.settings.newValue || {}) });
    }
  });
}

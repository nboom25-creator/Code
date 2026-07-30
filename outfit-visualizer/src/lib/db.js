// IndexedDB storage for body photos and saved looks.
//
// Images live here rather than in chrome.storage because they are large and
// numerous; chrome.storage keeps only small settings. Both the side panel and
// the options page are document contexts, so both can talk to this directly.

const DB_NAME = "fitting-room";
const DB_VERSION = 1;

export const BODIES = "bodies";
export const LOOKS = "looks";

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BODIES)) {
        db.createObjectStore(BODIES, { keyPath: "id" }).createIndex(
          "createdAt",
          "createdAt"
        );
      }
      if (!db.objectStoreNames.contains(LOOKS)) {
        db.createObjectStore(LOOKS, { keyPath: "id" }).createIndex(
          "createdAt",
          "createdAt"
        );
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.onabort = t.onerror = () => reject(t.error);
        t.oncomplete = () => resolve(req ? req.result : undefined);
      })
  );
}

export const put = (store, value) => run(store, "readwrite", (s) => s.put(value));
export const get = (store, id) => run(store, "readonly", (s) => s.get(id));
export const del = (store, id) => run(store, "readwrite", (s) => s.delete(id));
export const clear = (store) => run(store, "readwrite", (s) => s.clear());

/** Everything in a store, newest first. */
export async function all(store) {
  const rows = await run(store, "readonly", (s) => s.getAll());
  return (rows || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function newId() {
  return crypto.randomUUID();
}

/** Rough byte count of stored images, for the "space used" readout. */
export async function usage() {
  const [bodies, looks] = await Promise.all([all(BODIES), all(LOOKS)]);
  const size = (s) => (typeof s === "string" ? Math.floor(s.length * 0.75) : 0);
  let bytes = 0;
  for (const b of bodies) bytes += size(b.dataUrl) + size(b.thumbUrl);
  for (const l of looks) {
    bytes += size(l.resultDataUrl) + size(l.thumbUrl) + size(l.garmentThumbUrl);
  }
  return { bytes, bodies: bodies.length, looks: looks.length };
}

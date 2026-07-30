// Image helpers shared by the side panel, options page and service worker.
// Everything here sticks to APIs that exist in both window and worker scopes
// (createImageBitmap, OffscreenCanvas, fetch) so the service worker can reuse it.

/** Split a data: URL into the pieces the Gemini API wants. */
export function dataUrlParts(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!m) throw new Error("Not a data URL");
  const [, mimeType, isB64, payload] = m;
  return {
    mimeType,
    data: isB64 ? payload : btoa(unescape(encodeURIComponent(payload))),
  };
}

/** ArrayBuffer -> base64, chunked so large images don't blow the call stack. */
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function blobToDataUrl(blob) {
  const b64 = bufferToBase64(await blob.arrayBuffer());
  return `data:${blob.type || "image/png"};base64,${b64}`;
}

/**
 * Fetch a remote image and return it as a data URL. Called from the service
 * worker, where host permissions mean CORS does not apply — that is the whole
 * reason garment fetching lives in the background rather than the page.
 */
export async function fetchImageAsDataUrl(url) {
  if (url.startsWith("data:")) return url;
  const res = await fetch(url, { credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error(`Could not load that image (HTTP ${res.status})`);
  const blob = await res.blob();
  if (!/^image\//.test(blob.type)) {
    throw new Error("That link does not point at an image");
  }
  return blobToDataUrl(blob);
}

/**
 * Shrink an image so its longest edge is at most `maxDim`, re-encoding as JPEG
 * (or PNG when transparency matters). Keeps API payloads small and fast; the
 * model does not benefit from more than ~1024px on input.
 */
export async function downscale(dataUrl, maxDim = 1024, { mime = "image/jpeg", quality = 0.9 } = {}) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (mime === "image/jpeg") {
    // JPEG has no alpha; without this, transparent PNGs come out black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: mime, quality });
  return { dataUrl: await blobToDataUrl(blob), width: w, height: h };
}

/** Square, centre-cropped thumbnail for the gallery grids. */
export async function thumbnail(dataUrl, size = 256) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#14141a";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  return blobToDataUrl(blob);
}

export function prettyBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

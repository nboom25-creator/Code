// Runs on every page. Two jobs:
//   1. show a "Try on" pill when the shopper hovers a product-sized image
//   2. answer the side panel's "collect-images" request with ranked candidates
//
// Guarded against double injection because background.js may inject this file
// manually when the panel scans a tab that loaded before the extension did.

(() => {
  if (window.__fittingRoomLoaded) return;
  window.__fittingRoomLoaded = true;

  const MIN_EDGE = 180; // ignore icons, sprites, payment badges
  const PILL_ID = "fitting-room-pill";

  // ---------------------------------------------------------------- helpers

  /** Best available source for an <img>, preferring what the browser chose. */
  function bestSrc(img) {
    if (img.currentSrc) return img.currentSrc;
    if (img.srcset) {
      const best = img.srcset
        .split(",")
        .map((entry) => {
          const [url, descriptor = ""] = entry.trim().split(/\s+/);
          const width = parseInt(descriptor, 10);
          return { url, weight: Number.isFinite(width) ? width : 1 };
        })
        .filter((c) => c.url)
        .sort((a, b) => b.weight - a.weight)[0];
      if (best) return new URL(best.url, location.href).href;
    }
    return img.src || "";
  }

  function isUsable(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w < MIN_EDGE || h < MIN_EDGE) return false;

    const rect = img.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return false;

    const src = bestSrc(img);
    if (!src || src.startsWith("blob:")) return false; // blob: is per-context

    const style = getComputedStyle(img);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  /**
   * Product shots are usually large and portrait-ish, so rank on area with a
   * nudge for aspect ratios that look like a garment rather than a banner.
   */
  function score(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const ratio = h / w;
    const shape = ratio > 0.9 && ratio < 2.0 ? 1.4 : ratio >= 2.0 ? 0.8 : 0.5;
    return w * h * shape;
  }

  // ------------------------------------------------------------- hover pill

  let pill = null;
  let target = null;

  function ensurePill() {
    if (pill && document.documentElement.contains(pill)) return pill;
    pill = document.createElement("button");
    pill.id = PILL_ID;
    pill.type = "button";
    pill.textContent = "Try this on";
    pill.setAttribute("aria-label", "Try this garment on in Fitting Room");
    pill.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!target) return;
      chrome.runtime.sendMessage({
        type: "try-on-image",
        url: bestSrc(target),
        alt: target.alt || document.title,
      });
      pill.textContent = "Opening…";
      setTimeout(() => {
        pill.textContent = "Try this on";
        hidePill();
      }, 900);
    });
    document.documentElement.appendChild(pill);
    return pill;
  }

  function showPill(img) {
    target = img;
    const el = ensurePill();
    const rect = img.getBoundingClientRect();
    el.style.top = `${window.scrollY + rect.top + 10}px`;
    el.style.left = `${window.scrollX + rect.left + 10}px`;
    el.classList.add("fitting-room-pill--visible");
  }

  function hidePill() {
    target = null;
    if (pill) pill.classList.remove("fitting-room-pill--visible");
  }

  document.addEventListener(
    "mouseover",
    (event) => {
      const el = event.target;
      if (el === pill) return;
      if (el instanceof HTMLImageElement && isUsable(el)) {
        showPill(el);
      } else if (!el.closest?.(`#${PILL_ID}`)) {
        hidePill();
      }
    },
    true
  );

  window.addEventListener("scroll", hidePill, { passive: true });

  // -------------------------------------------------------------- messaging

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "collect-images") return false;

    const seen = new Set();
    const images = [...document.images]
      .filter(isUsable)
      .sort((a, b) => score(b) - score(a))
      .map((img) => ({
        url: bestSrc(img),
        alt: (img.alt || "").slice(0, 200),
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      }))
      .filter((c) => (seen.has(c.url) ? false : seen.add(c.url)))
      .slice(0, 24);

    sendResponse({ images, title: document.title });
    return false;
  });
})();

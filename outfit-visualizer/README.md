# 👗 Fitting Room

A Chrome extension that shows you what a garment looks like **on you** while you're
shopping. Hover any product photo, hit **Try this on**, and a side panel renders you
wearing it — using a reference photo of yourself and Google's Gemini image model.

Every try-on is kept in a lookbook so you can put three jackets side by side before
you spend anything.

---

## Install

No build step — it's plain ES modules, loaded straight from disk.

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this `outfit-visualizer/` folder
4. Pin the hanger icon to your toolbar

### Add your API key

Try-ons are rendered by Google's Gemini image model, so you need your own key.

1. Get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click the extension icon → paste the key into the setup card (or open **Settings**)
3. Hit **Test connection** in Settings to confirm it works

Roughly a few US cents per image on paid tiers; free-tier keys work but are rate
limited to a handful of images per minute.

### Add a photo of yourself

Settings → **Your photos** → **Add photo**. What works best:

- lit from the front, no harsh shadow across your face
- shot straight on, whole outfit visible, arms slightly away from your body
- plain-ish background

Add several — standing, seated, different lighting — and pick whichever suits the item.
Photos are downscaled to 1024px and stored locally.

---

## Using it

| To do this | Do that |
| --- | --- |
| Try on a product you're looking at | Hover its photo, click **Try this on** |
| Same, from the right-click menu | Right-click the image → **Try this on in Fitting Room** |
| Pick from everything on the page | Side panel → **Grab from page** |
| Use an image from elsewhere | Drag it onto the panel, paste it, or **Upload** |
| Check the fit before/after | Press and hold **Hold to compare** |
| Compare several items | **Lookbook** tab → **Compare** → pick two or three |

Under **Fit & scene** you can tell the model the item runs oversized, ask for a
full-length shot, or drop your background for a studio one. Free-text notes get passed
through too ("sleeves rolled", "tucked in").

---

## What it sends where

- Your photo and the garment image go to `generativelanguage.googleapis.com`, with
  your own API key, only when you press **Try it on**.
- Everything else — photos, lookbook, key, settings — stays in this browser profile
  (IndexedDB and `chrome.storage.local`). There is no server, no account, no analytics.
- **Settings → Storage → Delete everything** wipes the lot.

The extension requests access to all sites because it has to read product images on
whatever store you happen to be on. It only ever reads image URLs — it does not touch
page text, forms, or cookies.

---

## Layout

```
manifest.json                  MV3 manifest
src/
  background.js                service worker — side panel, context menu, image fetching
  content/content.js           the "Try this on" hover pill + page image scanner
  sidepanel/                   the main UI (try-on + lookbook)
  options/                     API key, model, photo library, storage
  lib/
    gemini.js                  Gemini API client
    prompt.js                  the try-on prompt  ← tune this first
    db.js                      IndexedDB (photos + looks)
    images.js                  downscale / thumbnail / fetch helpers
    settings.js                chrome.storage wrapper
tools/
  make-icons.mjs               generates icons/*.png (no image deps)
  smoke-test.mjs               loads the extension in Chromium and drives the flow
```

**`src/lib/prompt.js` is the thing to tune.** It decides how hard the model tries to
keep your face versus the garment's details, and it's plain text — edit it, reload the
extension, try again.

---

## Development

```bash
node tools/make-icons.mjs           # regenerate icons after editing the glyph

npm install --no-save playwright    # once
node tools/smoke-test.mjs           # load the extension and drive the whole flow
node tools/smoke-test.mjs --headed  # watch it happen
```

The smoke test mocks the Gemini endpoint, so it costs nothing and needs no key. It
checks the manifest and every referenced file, the service worker registering, the
options flows, the content script's hover pill and page scan, and a full
garment → generate → lookbook round trip — failing on any console error.

If your local Playwright download doesn't match the browser on disk, point it at one:

```bash
CHROMIUM_PATH=/path/to/chrome node tools/smoke-test.mjs
```

After changing anything, hit the reload arrow on `chrome://extensions`. Content script
changes also need a page refresh.

### If generation starts failing

Google renames and retires image models fairly regularly. If you see *"that model id
does not exist"*, open **Settings → Image model → Find models** — it asks your key what
it can actually reach and offers those. The default is `gemini-2.5-flash-image`.

---

## Known limits

- The model reproduces a garment convincingly, but it is **not a fit predictor** — it
  will not tell you whether a size M actually fits. Treat it as a styling preview.
- Flat-lay product shots work better than photos on a model, which sometimes bleed the
  original model's pose into the result.
- Busy prints, small logos and text on clothing are the first things to drift.
- One garment at a time; to build a full outfit, run a try-on and then feed the result
  back in as your body photo.

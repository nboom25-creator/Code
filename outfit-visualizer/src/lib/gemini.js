// Gemini image API client.
//
// Uses the generateContent endpoint with two inline image parts. The model id
// is a setting rather than a constant because Google renames and retires image
// models fairly often — listImageModels() lets the options page offer whatever
// the key can actually reach today.

import { dataUrlParts } from "./images.js";

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

/** Turn an API error body into something worth showing a shopper. */
function describeError(status, body) {
  const message = body?.error?.message || "";
  if (status === 400 && /API key not valid/i.test(message)) {
    return "That API key was rejected. Check it in Settings.";
  }
  if (status === 400) return message || "The request was rejected (400).";
  if (status === 401 || status === 403) {
    return "Your API key is not authorised for this model. Check the key, and that the Gemini API is enabled for its project.";
  }
  if (status === 404) {
    return "That model id does not exist for your key. Pick a different model in Settings.";
  }
  if (status === 429) {
    return "Rate limit hit. Wait a moment and try again — free-tier keys allow only a few images per minute.";
  }
  if (status === 500 || status === 503) {
    return "Google's image service is busy right now. Try again in a few seconds.";
  }
  return message || `Request failed (HTTP ${status}).`;
}

async function callApi(path, { apiKey, method = "GET", body, signal } = {}) {
  if (!apiKey) throw new Error("Add your Gemini API key in Settings first.");

  let res;
  try {
    res = await fetch(`${API_ROOT}${path}`, {
      method,
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Could not reach Google's API — check your connection.");
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(describeError(res.status, json));
  return json;
}

/** Models this key can use that can return images. */
export async function listImageModels(apiKey) {
  const json = await callApi("/models?pageSize=200", { apiKey });
  return (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .filter((m) => /image/i.test(m.name) && !/embedding|aqa/i.test(m.name))
    .map((m) => ({
      id: m.name.replace(/^models\//, ""),
      label: m.displayName || m.name,
      description: m.description || "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Cheap key check for the options page — lists models and reports reachability. */
export async function verifyKey(apiKey) {
  const models = await listImageModels(apiKey);
  return { ok: true, models };
}

/**
 * Generate one try-on image.
 * @param {{apiKey: string, model: string, personDataUrl: string,
 *          garmentDataUrl: string, prompt: string, signal?: AbortSignal}} opts
 * @returns {Promise<{dataUrl: string, text: string}>}
 */
export async function generateTryOn({
  apiKey,
  model,
  personDataUrl,
  garmentDataUrl,
  prompt,
  signal,
}) {
  const person = dataUrlParts(personDataUrl);
  const garment = dataUrlParts(garmentDataUrl);

  const json = await callApi(`/models/${encodeURIComponent(model)}:generateContent`, {
    apiKey,
    method: "POST",
    signal,
    body: {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { text: "IMAGE 1 — the person:" },
            { inline_data: { mime_type: person.mimeType, data: person.data } },
            { text: "IMAGE 2 — the garment:" },
            { inline_data: { mime_type: garment.mimeType, data: garment.data } },
          ],
        },
      ],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    },
  });

  const candidate = json.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData || p.inline_data);
  const text = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!imagePart) {
    // Most commonly a safety block or a model that only speaks text back.
    const reason = candidate?.finishReason || json.promptFeedback?.blockReason;
    if (reason && reason !== "STOP") {
      throw new Error(
        `The model declined to generate this image (${reason}). Try a different photo — clear, well-lit, fully-clothed photos work best.`
      );
    }
    throw new Error(
      text
        ? `The model replied with text instead of an image: "${text.slice(0, 200)}"`
        : "The model returned no image. Check that the selected model supports image output."
    );
  }

  const inline = imagePart.inlineData || imagePart.inline_data;
  const mime = inline.mimeType || inline.mime_type || "image/png";
  return { dataUrl: `data:${mime};base64,${inline.data}`, text };
}

// The try-on prompt.
//
// This is the part that decides whether the result looks like you or like a
// stranger, so it is deliberately explicit about what must be preserved from
// each of the two input images. Image order matters and is asserted in the
// text: image 1 is the person, image 2 is the garment.

const FIT_NOTES = {
  "true-to-size": "The garment fits true to size — natural drape, neither tight nor loose.",
  fitted: "The garment fits close to the body — tailored and snug, following the person's shape.",
  relaxed: "The garment fits relaxed — a little roomy, with soft folds.",
  oversized: "The garment is deliberately oversized — dropped shoulders, generous volume, long sleeves.",
};

const BACKGROUND_NOTES = {
  keep: "Keep the exact background, lighting, and setting from the first image.",
  studio: "Replace the background with a clean, evenly lit light-grey studio backdrop, keeping the person and their lighting natural.",
  street: "Place the person on a softly blurred outdoor city street, with daylight that matches the direction of light on their face.",
  neutral: "Replace the background with a plain, softly shadowed off-white wall.",
};

const FRAMING_NOTES = {
  keep: "Keep the original pose, camera angle, distance and crop from the first image.",
  full: "Show the person full-length, head to feet, centred in frame.",
  upper: "Frame the person from mid-thigh up, so the garment's upper half reads clearly.",
};

/**
 * Build the instruction text sent alongside the two images.
 * @param {{fit?: string, background?: string, framing?: string, notes?: string, garmentHint?: string}} opts
 */
export function buildPrompt(opts = {}) {
  const {
    fit = "true-to-size",
    background = "keep",
    framing = "keep",
    notes = "",
    garmentHint = "",
  } = opts;

  const lines = [
    "You are a virtual fitting room. You are given exactly two images.",
    "IMAGE 1 is a photograph of a real person.",
    "IMAGE 2 is a clothing product photo, which may be shown flat, on a hanger, or on a different model.",
    "",
    "Produce ONE photorealistic image of the person from IMAGE 1 wearing the garment from IMAGE 2.",
    "",
    "Preserve from IMAGE 1, exactly and without alteration:",
    "- the person's face, facial features and expression — this must remain unmistakably the same individual",
    "- their hair, skin tone, body proportions, height and build",
    "- their hands, and any visible jewellery or glasses",
    "",
    "Reproduce from IMAGE 2, faithfully:",
    "- the garment's exact colour, pattern, print, graphics, logos and text",
    "- its fabric texture and sheen, its cut, neckline, sleeve and hem length",
    "- its buttons, zips, seams and other hardware",
    "",
    "Replace only the clothing item that the garment corresponds to. Leave the person's other",
    "clothing, shoes and accessories as they are in IMAGE 1, unless they would be covered by the garment.",
    "Do not add a different person. Do not restyle the person. Do not slim, retouch or beautify them.",
    "",
    FIT_NOTES[fit] || FIT_NOTES["true-to-size"],
    FRAMING_NOTES[framing] || FRAMING_NOTES.keep,
    BACKGROUND_NOTES[background] || BACKGROUND_NOTES.keep,
    "The garment must be lit consistently with the scene, with contact shadows and folds where the fabric meets the body.",
  ];

  if (garmentHint.trim()) {
    lines.push("", `The product is described as: ${garmentHint.trim()}`);
  }
  if (notes.trim()) {
    lines.push("", `Additional instructions from the shopper: ${notes.trim()}`);
  }

  lines.push("", "Return only the resulting image.");
  return lines.join("\n");
}

export const FIT_OPTIONS = [
  ["true-to-size", "True to size"],
  ["fitted", "Fitted"],
  ["relaxed", "Relaxed"],
  ["oversized", "Oversized"],
];

export const BACKGROUND_OPTIONS = [
  ["keep", "Keep my background"],
  ["studio", "Studio grey"],
  ["street", "City street"],
  ["neutral", "Plain wall"],
];

export const FRAMING_OPTIONS = [
  ["keep", "Keep my framing"],
  ["full", "Full length"],
  ["upper", "Waist up"],
];

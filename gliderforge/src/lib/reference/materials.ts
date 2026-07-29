/**
 * Starter material reference library.
 *
 * IMPORTANT HONESTY NOTE
 * ----------------------
 * Every entry below is a *nominal handbook figure* — the kind of number found
 * in an introductory materials table. They are provided so that a mass budget
 * can be started before datasheets arrive. They are:
 *
 *   - quoted at low precision on purpose (no invented significant figures),
 *   - accompanied by a plausible range where properties vary by grade/process,
 *   - flagged `verified: false`, which the UI renders as an explicit badge,
 *   - overridable per project without editing the library.
 *
 * Do NOT use these for a structural pass/fail conclusion. Replace each one
 * with a supplier datasheet value and record the datasheet as evidence.
 */

export interface MaterialProperty {
  value: number;
  unit: string;
  /** Plausible spread across grades/processes, if applicable. */
  range?: [number, number];
  condition?: string;
  note?: string;
}

export interface MaterialEntry {
  id: string;
  name: string;
  category: "metal" | "polymer" | "composite" | "foam" | "elastomer" | "other";
  density: MaterialProperty;
  yieldStrength?: MaterialProperty;
  tensileStrength?: MaterialProperty;
  youngsModulus?: MaterialProperty;
  poissonsRatio?: MaterialProperty;
  seawaterNote?: string;
  source: string;
  sourceDate: string | null;
  verified: false;
  notes: string;
}

const SOURCE =
  "Nominal handbook/teaching-table value bundled with GliderForge as a starting estimate. Not traceable to a specific lot, grade or supplier.";

const CAVEAT =
  "Unverified reference value. Replace with the supplier datasheet before using this material in a structural or buoyancy conclusion.";

export const MATERIALS: MaterialEntry[] = [
  {
    id: "al-6061-t6",
    name: "Aluminium 6061-T6",
    category: "metal",
    density: { value: 2700, unit: "kg/m^3", range: [2680, 2720] },
    yieldStrength: { value: 270, unit: "MPa", range: [240, 290], condition: "T6 temper, room temperature" },
    tensileStrength: { value: 310, unit: "MPa", range: [290, 330], condition: "T6 temper" },
    youngsModulus: { value: 69, unit: "GPa", range: [68, 70] },
    poissonsRatio: { value: 0.33, unit: "-" },
    seawaterNote:
      "Galvanic corrosion risk when fastened to stainless steel in salt water. Anodising and isolation washers are common mitigations.",
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT,
  },
  {
    id: "ss-316",
    name: "Stainless steel 316",
    category: "metal",
    density: { value: 8000, unit: "kg/m^3", range: [7900, 8060] },
    yieldStrength: { value: 240, unit: "MPa", range: [200, 290], condition: "annealed" },
    tensileStrength: { value: 550, unit: "MPa", range: [500, 620], condition: "annealed" },
    youngsModulus: { value: 193, unit: "GPa", range: [190, 200] },
    poissonsRatio: { value: 0.3, unit: "-" },
    seawaterNote: "Good general seawater corrosion resistance; can pit in stagnant, low-oxygen conditions.",
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT,
  },
  {
    id: "brass-360",
    name: "Brass (free-machining, C360)",
    category: "metal",
    density: { value: 8500, unit: "kg/m^3", range: [8400, 8600] },
    youngsModulus: { value: 97, unit: "GPa", range: [95, 110] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT,
  },
  {
    id: "pla",
    name: "PLA (FDM printed)",
    category: "polymer",
    density: { value: 1240, unit: "kg/m^3", range: [1200, 1300], condition: "solid filament" },
    tensileStrength: { value: 50, unit: "MPa", range: [30, 65], condition: "highly print-dependent" },
    youngsModulus: { value: 3.5, unit: "GPa", range: [2.0, 4.0] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes:
      CAVEAT +
      " For a printed part the EFFECTIVE density is (infill fraction x solid density) plus perimeters; measure the finished part on a scale instead of computing it.",
  },
  {
    id: "petg",
    name: "PETG (FDM printed)",
    category: "polymer",
    density: { value: 1270, unit: "kg/m^3", range: [1250, 1290], condition: "solid filament" },
    tensileStrength: { value: 45, unit: "MPa", range: [30, 55], condition: "print-dependent" },
    youngsModulus: { value: 2.0, unit: "GPa", range: [1.5, 2.3] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT + " FDM parts are rarely watertight without post-processing.",
  },
  {
    id: "abs",
    name: "ABS",
    category: "polymer",
    density: { value: 1040, unit: "kg/m^3", range: [1010, 1080] },
    tensileStrength: { value: 40, unit: "MPa", range: [28, 50] },
    youngsModulus: { value: 2.2, unit: "GPa", range: [1.8, 2.6] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT,
  },
  {
    id: "pmma",
    name: "Acrylic (PMMA), cast",
    category: "polymer",
    density: { value: 1180, unit: "kg/m^3", range: [1170, 1200] },
    tensileStrength: { value: 70, unit: "MPa", range: [50, 77] },
    youngsModulus: { value: 3.0, unit: "GPa", range: [2.4, 3.3] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes:
      CAVEAT +
      " Acrylic is brittle and notch-sensitive; it crazes with some solvents. Widely used for see-through pressure tubes at shallow depth, but treat any pressure rating as requiring a physical proof test.",
  },
  {
    id: "pc",
    name: "Polycarbonate",
    category: "polymer",
    density: { value: 1200, unit: "kg/m^3", range: [1190, 1220] },
    tensileStrength: { value: 65, unit: "MPa", range: [55, 75] },
    youngsModulus: { value: 2.3, unit: "GPa", range: [2.0, 2.4] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT + " Tougher than acrylic; less chemically resistant.",
  },
  {
    id: "pvc",
    name: "PVC (rigid)",
    category: "polymer",
    density: { value: 1400, unit: "kg/m^3", range: [1300, 1450] },
    tensileStrength: { value: 50, unit: "MPa", range: [40, 60] },
    youngsModulus: { value: 3.0, unit: "GPa", range: [2.4, 4.1] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT + " Common, cheap pressure-housing stock in student projects.",
  },
  {
    id: "nylon-6",
    name: "Nylon 6/6",
    category: "polymer",
    density: { value: 1140, unit: "kg/m^3", range: [1130, 1150] },
    tensileStrength: { value: 75, unit: "MPa", range: [50, 85], condition: "dry as moulded" },
    youngsModulus: { value: 2.8, unit: "GPa", range: [1.5, 3.5] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT + " Absorbs water, which changes both mass and stiffness — relevant for a submerged part.",
  },
  {
    id: "hdpe",
    name: "HDPE",
    category: "polymer",
    density: { value: 960, unit: "kg/m^3", range: [940, 970] },
    tensileStrength: { value: 27, unit: "MPa", range: [20, 35] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT + " Slightly less dense than fresh water, so it floats.",
  },
  {
    id: "polypropylene",
    name: "Polypropylene (typical syringe barrel)",
    category: "polymer",
    density: { value: 910, unit: "kg/m^3", range: [890, 940] },
    tensileStrength: { value: 33, unit: "MPa", range: [25, 40] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes:
      CAVEAT +
      " Disposable medical syringes are commonly polypropylene barrels with a rubber-tipped plunger. Confirm with the actual part.",
  },
  {
    id: "pu-foam-closed",
    name: "Closed-cell PU flotation foam",
    category: "foam",
    density: { value: 130, unit: "kg/m^3", range: [30, 300], condition: "grade dependent" },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes:
      CAVEAT +
      " Foam density varies enormously by grade. Cheap foams absorb water and lose buoyancy with depth/time — weigh a sample wet and dry before trusting it.",
  },
  {
    id: "nitrile",
    name: "Nitrile (Buna-N) O-ring",
    category: "elastomer",
    density: { value: 1000, unit: "kg/m^3", range: [980, 1250] },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes: CAVEAT + " Common general-purpose O-ring material for water.",
  },
  {
    id: "lipo-pack",
    name: "Li-ion / LiPo battery pack (packaged)",
    category: "other",
    density: { value: 2000, unit: "kg/m^3", range: [1500, 2600], condition: "including case and wiring" },
    source: SOURCE,
    sourceDate: null,
    verified: false,
    notes:
      CAVEAT +
      " Effective packaged density varies widely. Weigh and displacement-test your actual pack; do not compute it.",
  },
];

export function findMaterial(id: string): MaterialEntry | undefined {
  return MATERIALS.find((m) => m.id === id);
}

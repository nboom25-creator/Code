import type { Material, Tool } from "@/lib/types";

/**
 * Shared tool and material catalog. Projects and steps reference these by id.
 * All prices are rough estimates in US cents and are always labeled as
 * estimates in the UI — never presented as live store pricing.
 */

export const TOOLS: Tool[] = [
  // Measuring & marking
  { id: "tool-tape-measure", name: "Tape measure", description: "For measuring lengths and spacing.", estimatedCostCents: 900, department: "tools" },
  { id: "tool-level", name: "Level", description: "Confirms a line or object is straight.", estimatedCostCents: 1200, department: "tools" },
  { id: "tool-pencil", name: "Pencil", description: "For marking measurements.", estimatedCostCents: 200, department: "tools" },
  { id: "tool-stud-finder", name: "Stud finder", description: "Locates wall studs behind drywall.", estimatedCostCents: 1500, department: "tools" },
  // Driving & fastening
  { id: "tool-drill", name: "Cordless drill", description: "Drives screws and drills pilot holes.", estimatedCostCents: 4500, department: "tools" },
  { id: "tool-screwdriver", name: "Screwdriver set", description: "Phillips and flathead for hand-driving screws.", estimatedCostCents: 1500, department: "tools" },
  { id: "tool-hammer", name: "Hammer", description: "For nails and light tapping.", estimatedCostCents: 1200, department: "tools" },
  { id: "tool-hex-keys", name: "Hex/Allen keys", description: "For furniture bolts and set screws.", estimatedCostCents: 800, department: "tools" },
  { id: "tool-wrench-adjustable", name: "Adjustable wrench", description: "Grips nuts and fittings of varied sizes.", estimatedCostCents: 1400, department: "tools" },
  // Cutting
  { id: "tool-utility-knife", name: "Utility knife", description: "For scoring and trimming.", estimatedCostCents: 700, department: "tools" },
  { id: "tool-putty-knife", name: "Putty knife", description: "Spreads filler and scrapes surfaces.", estimatedCostCents: 600, department: "tools" },
  { id: "tool-caulk-gun", name: "Caulk gun", description: "Dispenses caulk and sealant tubes.", estimatedCostCents: 1000, department: "tools" },
  { id: "tool-caulk-removal", name: "Caulk removal tool", description: "Scores and lifts old caulk.", estimatedCostCents: 800, department: "tools" },
  // Painting
  { id: "tool-paint-roller", name: "Paint roller & tray", description: "Applies paint to large flat areas.", estimatedCostCents: 1500, department: "paint" },
  { id: "tool-paint-brush", name: "Angled paint brush", description: "For edges, corners, and trim.", estimatedCostCents: 1000, department: "paint" },
  { id: "tool-paint-tray", name: "Paint tray liner", description: "Holds and rolls out paint.", estimatedCostCents: 400, department: "paint" },
  // Sanding & prep
  { id: "tool-sanding-block", name: "Sanding block", description: "Smooths patched or rough surfaces.", estimatedCostCents: 500, department: "hardware" },
  { id: "tool-sandpaper", name: "Sandpaper (assorted grit)", description: "For smoothing wood and filler.", estimatedCostCents: 700, department: "hardware" },
  { id: "tool-scissors", name: "Scissors", description: "General cutting.", estimatedCostCents: 500, department: "tools" },
  { id: "tool-clamps", name: "Bar clamps", description: "Hold pieces together while fastening.", estimatedCostCents: 2000, department: "tools" },
  // Cleanup & safety adjacent
  { id: "tool-bucket", name: "Bucket", description: "For water and cleanup.", estimatedCostCents: 500, department: "other" },
  { id: "tool-sponge", name: "Sponge & cloths", description: "Cleaning surfaces.", estimatedCostCents: 400, department: "other" },
  { id: "tool-drop-cloth", name: "Drop cloth", description: "Protects floors and furniture.", estimatedCostCents: 1000, department: "paint" },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<string, Tool>;

export const MATERIALS: Material[] = [
  // Fasteners & anchors
  { id: "mat-wall-anchors", name: "Wall anchors", unit: "pack", estimatedCostCents: 600, department: "hardware" },
  { id: "mat-picture-hooks", name: "Picture-hanging hooks", unit: "pack", estimatedCostCents: 500, department: "hardware" },
  { id: "mat-wood-screws", name: "Wood screws", unit: "box", estimatedCostCents: 700, department: "hardware" },
  { id: "mat-cabinet-screw", name: "Cabinet handle screw", unit: "pack", estimatedCostCents: 400, department: "hardware" },
  // Drywall
  { id: "mat-spackle", name: "Lightweight spackle", unit: "tub", estimatedCostCents: 800, department: "adhesives-sealants" },
  { id: "mat-patch-kit", name: "Self-adhesive drywall patch", unit: "pack", estimatedCostCents: 900, department: "hardware" },
  { id: "mat-primer", name: "Primer", unit: "quart", estimatedCostCents: 1200, department: "paint" },
  // Paint
  { id: "mat-wall-paint", name: "Interior wall paint", unit: "gallon", estimatedCostCents: 3500, department: "paint" },
  { id: "mat-painters-tape", name: "Painter's tape", unit: "roll", estimatedCostCents: 700, department: "paint" },
  { id: "mat-paint-stir", name: "Paint stir stick", unit: "each", estimatedCostCents: 50, department: "paint" },
  // Caulk & sealant
  { id: "mat-tub-caulk", name: "Silicone tub & tile caulk", unit: "tube", estimatedCostCents: 900, department: "adhesives-sealants" },
  { id: "mat-rubbing-alcohol", name: "Rubbing alcohol", unit: "bottle", estimatedCostCents: 400, department: "other" },
  { id: "mat-painters-tape2", name: "Masking tape", unit: "roll", estimatedCostCents: 500, department: "paint" },
  // Shelving
  { id: "mat-floating-shelf", name: "Floating shelf kit", unit: "each", estimatedCostCents: 2500, department: "hardware" },
  // Plumbing
  { id: "mat-toilet-flapper", name: "Toilet flapper", unit: "each", estimatedCostCents: 800, department: "plumbing" },
  // Cabinet hardware
  { id: "mat-cabinet-handle", name: "Cabinet handle/pull", unit: "each", estimatedCostCents: 500, department: "hardware" },
  // Woodworking
  { id: "mat-cedar-boards", name: "Cedar boards (1x6)", unit: "board", estimatedCostCents: 900, department: "lumber" },
  { id: "mat-wood-glue", name: "Wood glue", unit: "bottle", estimatedCostCents: 600, department: "adhesives-sealants" },
  { id: "mat-exterior-screws", name: "Exterior wood screws", unit: "box", estimatedCostCents: 800, department: "hardware" },
  { id: "mat-landscape-fabric", name: "Landscape fabric", unit: "roll", estimatedCostCents: 900, department: "lumber" },
  // Backsplash
  { id: "mat-peel-stick-tile", name: "Peel-and-stick tile", unit: "sheet", estimatedCostCents: 800, department: "tile-flooring" },
  // Weatherstripping
  { id: "mat-weatherstrip", name: "Self-adhesive weatherstrip", unit: "roll", estimatedCostCents: 1200, department: "hardware" },
  { id: "mat-door-sweep", name: "Door sweep", unit: "each", estimatedCostCents: 1000, department: "hardware" },
  // Cleaning
  { id: "mat-cleaner", name: "Household cleaner/degreaser", unit: "bottle", estimatedCostCents: 500, department: "other" },
  { id: "mat-tack-cloth", name: "Tack cloth", unit: "pack", estimatedCostCents: 400, department: "paint" },
];

export const MATERIAL_BY_ID = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m]),
) as Record<string, Material>;

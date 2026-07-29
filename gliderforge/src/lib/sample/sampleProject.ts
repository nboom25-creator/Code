import { createProject, createRow, getProject, listProjects, type ProjectRow } from "@/lib/db/repo";
import { projectSettingsSchema } from "@/lib/project/settings";
import { STARTER_RISKS } from "./starterRisks";
import { TEST_TEMPLATES } from "./testTemplates";

/**
 * Demonstration project — SYNTHETIC DATA.
 *
 * Every value below is invented for teaching purposes. It is internally
 * consistent so that the whole workflow can be exercised end to end, but it
 * describes no real vehicle and no real measurement. The project is flagged
 * `is_sample = 1`, which the UI renders as a persistent banner on every page.
 *
 * The numbers were chosen so the demo shows a realistic *situation*: a vehicle
 * that is a few grams heavy, trimmed slightly nose-down, with an actuator that
 * has margin but a buoyancy authority of only about 1.4% of weight.
 */

export const SAMPLE_SLUG = "sample-glider-demo";

const D = "DEMONSTRATION DATA — synthetic, not measured.";

interface CompSpec {
  name: string;
  category: string;
  part_number?: string;
  material_name?: string;
  manufacturing_method?: string;
  measured_mass_kg?: number;
  estimated_mass_kg?: number;
  displaced_volume_m3?: number;
  cad_volume_m3?: number;
  displacement_mode: "hull" | "external" | "internal" | "flooded";
  pos: [number, number, number];
  quantity?: number;
  movable?: boolean;
  min_x?: number;
  max_x?: number;
  color?: string;
  cost?: number;
  supplier?: string;
  confidence?: string;
  notes?: string;
}

const COMPONENTS: CompSpec[] = [
  {
    name: "Pressure hull tube + end caps",
    category: "structure",
    part_number: "GF-HULL-01",
    material_name: "Acrylic (PMMA), cast",
    manufacturing_method: "Purchased tube, machined caps",
    measured_mass_kg: 0.85,
    displaced_volume_m3: 3.2e-3,
    cad_volume_m3: 3.2e-3,
    displacement_mode: "hull",
    pos: [0.3, 0, 0],
    color: "#7dd3fc",
    cost: 42,
    supplier: "(demo supplier)",
    confidence: "high",
    notes: `${D} 90 mm OD acrylic tube, 3 mm wall, 500 mm long with two machined end caps and nose/tail fairings. The 3200 cm^3 is the EXTERNAL envelope including fairings — the single largest term in the displacement budget.`,
  },
  {
    name: "Wing panel",
    category: "structure",
    part_number: "GF-WING-01",
    material_name: "PETG (FDM printed)",
    manufacturing_method: "FDM print, 40% infill",
    measured_mass_kg: 0.038,
    displaced_volume_m3: 3.0e-5,
    displacement_mode: "external",
    pos: [0.32, 0.09, 0],
    quantity: 2,
    color: "#a3e635",
    confidence: "medium",
    notes: `${D} 60 cm^2 planform each, flat-plate section with rounded leading edge. Printed part mass was WEIGHED rather than computed from infill, which is the right way round.`,
  },
  {
    name: "Tail fin",
    category: "structure",
    part_number: "GF-FIN-01",
    material_name: "PETG (FDM printed)",
    manufacturing_method: "FDM print",
    measured_mass_kg: 0.013,
    displaced_volume_m3: 1.0e-5,
    displacement_mode: "external",
    pos: [0.55, 0.05, 0.02],
    quantity: 2,
    color: "#a3e635",
    confidence: "medium",
    notes: `${D} Fixed vertical/horizontal stabiliser pair.`,
  },
  {
    name: "Battery pack, 3S 2500 mAh Li-ion",
    category: "electrical",
    part_number: "GF-BATT-01",
    material_name: "Li-ion / LiPo battery pack (packaged)",
    measured_mass_kg: 0.19,
    displacement_mode: "internal",
    pos: [0.2, 0, -0.02],
    color: "#fbbf24",
    cost: 28,
    confidence: "high",
    notes: `${D} Mounted low in the hull to keep the CG below the CB. Inside the sealed hull, so it contributes mass but no displacement.`,
  },
  {
    name: "Microcontroller board",
    category: "electrical",
    part_number: "GF-MCU-01",
    measured_mass_kg: 0.045,
    displacement_mode: "internal",
    pos: [0.32, 0, 0.01],
    color: "#f472b6",
    cost: 24,
    confidence: "high",
    notes: `${D}`,
  },
  {
    name: "Pressure / depth sensor",
    category: "sensor",
    part_number: "GF-PS-01",
    measured_mass_kg: 0.02,
    displaced_volume_m3: 5e-6,
    displacement_mode: "external",
    pos: [0.58, 0, 0],
    color: "#c084fc",
    cost: 35,
    confidence: "high",
    notes: `${D} Mounted through the tail cap, wetted face exposed to ambient — so it displaces its own external volume.`,
  },
  {
    name: "IMU board",
    category: "sensor",
    part_number: "GF-IMU-01",
    measured_mass_kg: 0.008,
    displacement_mode: "internal",
    pos: [0.31, 0, 0.005],
    color: "#c084fc",
    confidence: "high",
    notes: `${D}`,
  },
  {
    name: "Leak sensor board",
    category: "sensor",
    measured_mass_kg: 0.005,
    displacement_mode: "internal",
    pos: [0.25, 0, -0.03],
    color: "#c084fc",
    confidence: "high",
    notes: `${D} Placed at the lowest point of the hull, which is where water collects.`,
  },
  {
    name: "Gearmotor (buoyancy engine drive)",
    category: "actuator",
    part_number: "GF-MOT-01",
    measured_mass_kg: 0.12,
    displacement_mode: "internal",
    pos: [0.42, 0, 0],
    color: "#fb7185",
    cost: 32,
    confidence: "high",
    notes: `${D} 12 V brushed gearmotor. Torque figure in the syringe module is a demonstration value.`,
  },
  {
    name: "Lead screw and nut assembly",
    category: "actuator",
    part_number: "GF-LS-01",
    material_name: "Stainless steel 316",
    measured_mass_kg: 0.06,
    displacement_mode: "internal",
    pos: [0.46, 0, 0],
    color: "#fb7185",
    cost: 14,
    confidence: "high",
    notes: `${D} 8 mm x 2 mm lead trapezoidal screw with a brass nut.`,
  },
  {
    name: "Syringe (60 mL) and mount",
    category: "actuator",
    part_number: "GF-SYR-01",
    material_name: "Polypropylene (typical syringe barrel)",
    measured_mass_kg: 0.05,
    displacement_mode: "internal",
    pos: [0.52, 0, 0],
    color: "#fb7185",
    cost: 6,
    confidence: "high",
    notes: `${D} 26.6 mm bore, 90 mm mechanical stroke. The plunger exits through the tail cap so that extending it increases the vehicle's external displaced volume — the swept volume is handled by the buoyancy-engine module, not counted here.`,
  },
  {
    name: "Fixed ballast (lead shot, potted)",
    category: "ballast",
    measured_mass_kg: 1.35,
    displacement_mode: "internal",
    pos: [0.33, 0, -0.03],
    color: "#94a3b8",
    cost: 8,
    confidence: "high",
    notes: `${D} Sized to bring a 3.2 L displacement vehicle close to neutral. Placed low for roll stability and aft to trim the nose-down attitude out.`,
  },
  {
    name: "Adjustable trim ballast",
    category: "ballast",
    measured_mass_kg: 0.4,
    displacement_mode: "internal",
    pos: [0.15, 0, -0.03],
    movable: true,
    min_x: 0.05,
    max_x: 0.4,
    color: "#94a3b8",
    confidence: "high",
    notes: `${D} Slides on a rail so pitch trim can be tuned between test runs. This is the component the trim solver moves.`,
  },
  {
    name: "Wiring, fasteners and potting",
    category: "structure",
    estimated_mass_kg: 0.08,
    displacement_mode: "internal",
    pos: [0.3, 0, 0],
    color: "#64748b",
    confidence: "low",
    notes: `${D} ESTIMATED, not weighed — a deliberate example of a low-confidence line item. This is exactly the kind of "miscellaneous" mass that grows during a build and ruins a tight buoyancy budget.`,
  },
];

const REQUIREMENTS = [
  {
    key: "REQ-001",
    title: "Maximum operating depth",
    description: "The vehicle shall operate at depths up to 3 m in the university dive tank.",
    category: "environment",
    target_value: 3,
    target_unit: "m",
    comparator: ">=",
    tolerance: "0 / +0.5 m",
    priority: "shall",
    source: "Test facility (dive tank depth)",
    rationale: "The tank available for testing is 3.5 m deep; a 0.5 m standoff avoids the bottom.",
    verification_method: "test",
    verification_status: "not-verified",
  },
  {
    key: "REQ-002",
    title: "Vehicle envelope",
    description: "Overall length shall not exceed 700 mm and maximum diameter shall not exceed 110 mm.",
    category: "envelope",
    target_value: 0.7,
    target_unit: "m",
    comparator: "<=",
    priority: "shall",
    source: "Transport case and tank access hatch",
    rationale: "The vehicle must fit through the tank hatch and into the team's transport case.",
    verification_method: "inspection",
    verification_status: "verified",
  },
  {
    key: "REQ-003",
    title: "Dry mass",
    description: "Dry mass shall not exceed 4.0 kg so that one student can deploy and recover the vehicle unaided.",
    category: "mass",
    target_value: 4.0,
    target_unit: "kg",
    comparator: "<=",
    priority: "shall",
    source: "Safe manual handling in a wet environment",
    rationale: "Single-person handling on a wet poolside.",
    verification_method: "test",
    verification_status: "not-verified",
  },
  {
    key: "REQ-004",
    title: "Buoyancy authority",
    description: "The buoyancy engine shall be able to change net buoyancy by at least 0.35 N in each direction from neutral.",
    category: "buoyancy",
    target_value: 0.35,
    target_unit: "N",
    comparator: ">=",
    priority: "shall",
    source: "Derived from the target vertical speed",
    rationale:
      "Sets the driving force for the glide. Derived, not given — if the target vertical speed changes, this number must be re-derived.",
    verification_method: "analysis",
    verification_status: "not-verified",
  },
  {
    key: "REQ-005",
    title: "Target vertical speed",
    description: "The vehicle should achieve a vertical speed of at least 0.08 m/s in a steady dive.",
    category: "performance",
    target_value: 0.08,
    target_unit: "m/s",
    comparator: ">=",
    priority: "should",
    source: "Mission duration target",
    rationale: "A 3 m dive in under 40 s keeps a full test session inside one lab period.",
    verification_method: "test",
    verification_status: "not-verified",
  },
  {
    key: "REQ-006",
    title: "Glide ratio",
    description: "The vehicle should achieve a horizontal-to-vertical glide ratio of at least 2.0.",
    category: "performance",
    target_value: 2.0,
    target_unit: "-",
    comparator: ">=",
    priority: "should",
    source: "Project objective (demonstrate gliding, not just heaving)",
    rationale: "Below about 2 the vehicle is effectively a yo-yo, not a glider.",
    verification_method: "test",
    verification_status: "not-verified",
  },
  {
    key: "REQ-007",
    title: "Dive-and-climb cycles per deployment",
    description: "The vehicle shall complete at least 6 dive-and-climb cycles on one battery charge.",
    category: "endurance",
    target_value: 6,
    target_unit: "-",
    comparator: ">=",
    priority: "shall",
    source: "Demonstration requirement for the final review",
    rationale: "Enough cycles to show repeatability rather than a single lucky run.",
    verification_method: "test",
    verification_status: "not-verified",
  },
  {
    key: "REQ-008",
    title: "Leak tolerance",
    description: "No visible water ingress into the pressure hull after a 30-minute static immersion at 3 m.",
    category: "sealing",
    target_value: 0,
    target_unit: "mL",
    comparator: "<=",
    priority: "shall",
    source: "Electronics protection",
    rationale: "Any ingress at all is a failure — this is a pass/fail, not a tolerance.",
    verification_method: "test",
    verification_status: "not-verified",
  },
  {
    key: "REQ-009",
    title: "Structural factor of safety",
    description: "The pressure housing shall have a factor of safety of at least 2.0 against predicted collapse at maximum depth.",
    category: "structure",
    target_value: 2.0,
    target_unit: "-",
    comparator: ">=",
    priority: "shall",
    source: "Course design standard",
    rationale: "Closed-form collapse predictions for thin shells are imperfection-sensitive; a factor of 2 is the course minimum.",
    verification_method: "analysis",
    verification_status: "not-verified",
  },
  {
    key: "REQ-010",
    title: "Project budget",
    description: "Total bill-of-materials cost shall not exceed 400 USD.",
    category: "programmatic",
    target_value: 400,
    target_unit: "USD",
    comparator: "<=",
    priority: "shall",
    source: "Department senior-design allowance",
    rationale: "Fixed allocation.",
    verification_method: "inspection",
    verification_status: "not-verified",
  },
];

const ELECTRONICS = [
  { kind: "microcontroller", name: "Main controller board", current_a: 0.055, voltage_v: 5, duty_cycle: 1, regulator_efficiency: 0.85, provenance: "datasheet" },
  { kind: "motor-driver", name: "H-bridge motor driver (quiescent)", current_a: 0.008, voltage_v: 11.1, duty_cycle: 1, regulator_efficiency: 1, provenance: "datasheet" },
  { kind: "motor", name: "Buoyancy engine gearmotor", current_a: 0.35, voltage_v: 11.1, duty_cycle: 0.09, regulator_efficiency: 1, provenance: "estimated" },
  { kind: "pressure-sensor", name: "Depth sensor (I2C)", current_a: 0.0014, voltage_v: 3.3, duty_cycle: 1, regulator_efficiency: 0.85, provenance: "datasheet" },
  { kind: "imu", name: "IMU (accel + gyro)", current_a: 0.0035, voltage_v: 3.3, duty_cycle: 1, regulator_efficiency: 0.85, provenance: "datasheet" },
  { kind: "leak-sensor", name: "Leak detection probe", current_a: 0.0005, voltage_v: 3.3, duty_cycle: 1, regulator_efficiency: 0.85, provenance: "estimated" },
  { kind: "limit-switch", name: "Stroke end limit switches (pair)", current_a: 0.0002, voltage_v: 3.3, duty_cycle: 1, regulator_efficiency: 1, provenance: "estimated" },
  { kind: "radio", name: "Surface telemetry radio (transmit burst)", current_a: 0.12, voltage_v: 3.3, duty_cycle: 0.02, regulator_efficiency: 0.85, provenance: "datasheet" },
  { kind: "storage", name: "SD card logger", current_a: 0.02, voltage_v: 3.3, duty_cycle: 0.3, regulator_efficiency: 0.85, provenance: "estimated" },
];

const PINS = [
  { controller: "Main controller", pin: "D2", signal: "Limit switch — retracted", direction: "input", peripheral: "Limit switch", wire_color: "white" },
  { controller: "Main controller", pin: "D3", signal: "Limit switch — extended", direction: "input", peripheral: "Limit switch", wire_color: "grey" },
  { controller: "Main controller", pin: "D5", signal: "Motor PWM", direction: "output", peripheral: "H-bridge", wire_color: "yellow" },
  { controller: "Main controller", pin: "D6", signal: "Motor direction A", direction: "output", peripheral: "H-bridge", wire_color: "orange" },
  { controller: "Main controller", pin: "D7", signal: "Motor direction B", direction: "output", peripheral: "H-bridge", wire_color: "brown" },
  { controller: "Main controller", pin: "A0", signal: "Leak probe analogue", direction: "input", peripheral: "Leak sensor", wire_color: "blue" },
  { controller: "Main controller", pin: "SDA", signal: "I2C data (depth, IMU)", direction: "bidirectional", peripheral: "Sensor bus", wire_color: "green" },
  { controller: "Main controller", pin: "SCL", signal: "I2C clock", direction: "output", peripheral: "Sensor bus", wire_color: "green/white" },
  { controller: "Main controller", pin: "A3", signal: "Battery voltage divider", direction: "input", peripheral: "Battery", wire_color: "red" },
];

const ASSUMPTIONS = [
  {
    text: "Plunger + seal friction is 4.0 N, constant over the stroke.",
    basis: "DEMONSTRATION VALUE. In a real project this must come from a spring-scale pull test; breakaway and sliding friction differ and stiction grows with dwell time.",
    criticality: "high",
    status: "open",
  },
  {
    text: "Lead-screw efficiency is 0.30.",
    basis: "Typical for a dry trapezoidal screw and brass nut. Required torque scales inversely with this, so the true value must be confirmed or measured.",
    criticality: "high",
    status: "open",
  },
  {
    text: "Lift and drag coefficients C_L = 0.35, C_D = 0.12 on the wing planform area.",
    basis: "DEMONSTRATION PLACEHOLDERS. Not measured. Every speed, glide-ratio and range figure inherits this.",
    criticality: "high",
    status: "open",
  },
  {
    text: "The hull external envelope volume is 3200 cm^3 including fairings.",
    basis: "From the CAD model. Should be confirmed by a water-displacement measurement of the assembled hull before trimming.",
    criticality: "medium",
    status: "open",
  },
  {
    text: "Wiring, fasteners and potting total 80 g.",
    basis: "Estimated, not weighed. Historically this line item grows during a build.",
    criticality: "medium",
    status: "open",
  },
  {
    text: "Test-tank water is fresh at 25 degC.",
    basis: "Heated indoor tank. A thermometer reading on test day should replace this.",
    criticality: "low",
    status: "open",
  },
];

const DECISIONS = [
  {
    key: "DEC-001",
    statement: "Use a motor-driven syringe that changes EXTERNAL displaced volume rather than an internal ballast tank.",
    context:
      "Two architectures were considered for the buoyancy engine. They are not equivalent: one changes displaced volume at constant mass, the other changes vehicle mass at constant volume.",
    alternatives: [
      { name: "External plunger (displacement change)", note: "Plunger protrudes through the tail cap into the water." },
      { name: "Internal ballast tank (mass change)", note: "Ambient water drawn into a tank inside the hull." },
      { name: "External oil bladder", note: "Carried oil pumped into a flexible external bladder." },
    ],
    criteria: [
      { name: "No water inside the hull", weight: 5 },
      { name: "Simplicity of sealing", weight: 4 },
      { name: "Cost", weight: 3 },
      { name: "Actuator load at depth", weight: 3 },
      { name: "Effect on trim", weight: 2 },
    ],
    scores: {
      "External plunger (displacement change)": [5, 3, 5, 3, 4],
      "Internal ballast tank (mass change)": [1, 4, 5, 4, 2],
      "External oil bladder": [5, 2, 2, 3, 4],
    },
    chosen: "External plunger (displacement change)",
    advantages: "No ambient water enters the hull, so a leak in the engine is not automatically a leak into the electronics. Vehicle mass stays constant, which keeps the trim analysis simple.",
    disadvantages: "Requires a dynamic seal on a moving shaft that sees full depth pressure, which is the least reliable part of the design. Extending works against ambient pressure.",
    risks: "Dynamic shaft seal failure; plunger friction higher than assumed.",
    status: "accepted",
  },
  {
    key: "DEC-002",
    statement: "Use a fixed wing with a movable internal trim mass rather than a movable wing.",
    context: "Pitch attitude must be controllable between dive and climb.",
    alternatives: [
      { name: "Movable internal trim mass", note: "Ballast slides fore/aft on a rail." },
      { name: "Movable (rotating) wing", note: "Wing incidence changes." },
      { name: "Fixed everything, rely on CG/CB offset only", note: "No trim adjustment at all." },
    ],
    criteria: [
      { name: "Mechanical simplicity", weight: 5 },
      { name: "No extra hull penetration", weight: 5 },
      { name: "Trim authority", weight: 4 },
      { name: "Mass cost", weight: 2 },
    ],
    scores: {
      "Movable internal trim mass": [4, 5, 4, 2],
      "Movable (rotating) wing": [2, 1, 5, 4],
      "Fixed everything, rely on CG/CB offset only": [5, 5, 1, 5],
    },
    chosen: "Movable internal trim mass",
    advantages: "Entirely inside the hull, so no additional dynamic seal. Trim can be tuned between runs without rebuilding.",
    disadvantages: "Adds mass and a second actuator if it is ever motorised; for now it is set by hand between runs.",
    risks: "Manual trim setting is easy to get wrong between runs — record it in the test log every time.",
    status: "accepted",
  },
];

const MILESTONES = [
  { title: "Concept review with advisor", offsetDays: -21, status: "complete", notes: "Buoyancy engine architecture selected and defended." },
  { title: "Preliminary design review", offsetDays: -3, status: "complete", notes: "Mass budget, buoyancy budget and syringe sizing presented." },
  { title: "Bench test of buoyancy engine complete", offsetDays: 10, status: "upcoming", notes: "Stroke, friction and displacement measured; motor sized against measured load." },
  { title: "First wet test in the dive tank", offsetDays: 24, status: "upcoming", notes: "Static leak test, trim test, then a single dive-and-climb cycle." },
  { title: "Critical design review", offsetDays: 38, status: "upcoming", notes: "All shall-requirements verified or with a closure plan." },
  { title: "Final presentation and report", offsetDays: 66, status: "upcoming", notes: "Full report with traceability matrix and test evidence." },
];

const NOTEBOOK = [
  {
    kind: "meeting",
    title: "Advisor meeting — buoyancy engine architecture",
    subsystem: "buoyancy-engine",
    tags: "meeting,architecture,decision",
    body: `${D}\n\nDiscussed the three candidate buoyancy-engine architectures. The advisor pushed back hard on the internal ballast tank: taking ambient water inside a hull that also contains a LiPo pack means a single seal failure is both a buoyancy failure and an electrical one.\n\nAgreed to proceed with the external-plunger arrangement and to treat the dynamic shaft seal as the top technical risk. Action: measure plunger friction before sizing the motor — the advisor pointed out our torque number is meaningless while friction is assumed zero.\n\nRecorded as DEC-001.`,
    author: "Demo student",
  },
  {
    kind: "calculation",
    title: "First-pass buoyancy budget",
    subsystem: "buoyancy",
    tags: "calculation,mass,buoyancy",
    body: `${D}\n\nBuilt the component list and ran the mass/buoyancy budget. The 90 mm x 500 mm hull displaces about 3.2 L, which needs roughly 3.28 kg of vehicle to be neutral. Our dry electronics and structure only come to about 1.5 kg, so we need over 1.7 kg of ballast — far more than expected.\n\nThat is not a mistake, it is what a large-diameter hull costs. Two consequences: the vehicle is heavy to handle (check REQ-003), and all that lead is free real estate for lowering the CG, which is good for roll stability.\n\nCurrent budget lands about 5 g heavy. That is well inside the uncertainty of the estimates, so it means "close to neutral", not "5 g heavy".`,
    author: "Demo student",
  },
  {
    kind: "question",
    title: "Open question — does the plunger seal see full depth pressure?",
    subsystem: "sealing",
    tags: "question,sealing,risk",
    body: `${D}\n\nThe plunger rod passes through the tail cap. Ambient pressure acts on the wetted face, and the hull interior is at surface pressure, so the rod seal sees the full differential — about 29 kPa at 3 m.\n\nThat is not much in absolute terms, but the seal is DYNAMIC (the rod slides through it), and dynamic seals leak far more readily than static ones. Need to check the O-ring gland geometry against the dynamic squeeze band, not the static one.\n\nStill open.`,
    author: "Demo student",
  },
];

const REFS = [
  {
    citation: "Millero, F.J. & Poisson, A. (1981). International one-atmosphere equation of state of seawater. Deep-Sea Research 28A(6), 625-629.",
    kind: "paper",
    notes: "Source of the water-density correlation used throughout this workspace.",
  },
  {
    citation: "Hoerner, S.F. (1965). Fluid-Dynamic Drag. Published by the author.",
    kind: "book",
    notes: "Source of the body-of-revolution form-factor correlation in the drag buildup.",
  },
  {
    citation: "Windenburg, D.F. & Trilling, C. (1934). Collapse by instability of thin cylindrical shells under external pressure. Transactions ASME 56(11).",
    kind: "paper",
    notes: "Finite-length external-pressure collapse formula used in the housing check.",
  },
  {
    citation: "Young, W.C., Budynas, R.G. & Sadegh, A.M. Roark's Formulas for Stress and Strain.",
    kind: "book",
    notes: "Flat circular plate formulas used for the end-cap check.",
  },
  {
    citation: "Parker Hannifin. Parker O-Ring Handbook, ORD-5700.",
    kind: "standard",
    notes: "Gland squeeze and fill design bands referenced by the seal check. Confirm against the current edition for your specific seal.",
  },
];

/* ------------------------------------------------------------------ */

export function sampleSettings() {
  return projectSettingsSchema.parse({
    displayUnitSystem: "SI",
    environment: { kind: "pool", temperatureC: 25, salinityPSU: 0, gravitySI: 9.80665, surfacePressureSI: 101325 },
    mission: {
      targetDepthSI: 3,
      depthLimitSI: 3.5,
      surfaceThresholdSI: 0.15,
      cycles: 6,
      bottomDwellSI: 5,
      surfaceDwellSI: 10,
      leakCheckTimeSI: 30,
      initializationTimeSI: 15,
      transmitTimeSI: 5,
      currentVelocitySI: 0,
      maxTimeSI: 3600,
      dtSI: 0.2,
      velocityTimeConstantSI: 0,
    },
    vehicle: {
      hullLengthSI: 0.6,
      hullDiameterSI: 0.09,
      wingAreaSI: 0.012,
      wingAspectRatio: 4,
      wingThicknessRatio: 0.08,
      oswaldEfficiency: 0.8,
      tailAreaSI: 0.004,
      appendageDragAreaSI: 0.0004,
      maxLengthSI: 0.7,
      maxDiameterSI: 0.11,
      maxMassSI: 4.0,
    },
    hydro: {
      modelLevel: "buildup",
      referenceAreaSI: 0.012,
      referenceAreaBasis: "Total wing planform area, both panels",
      liftCoefficient: 0.35,
      dragCoefficient: 0.12,
      coefficientSource: "assumed",
      calibrationFactor: 1,
      angleOfAttackDeg: 6,
    },
    syringe: {
      config: "external-plunger",
      boreDiameterSI: 0.0266,
      maxStrokeSI: 0.09,
      usableStrokeSI: 0.08,
      deadVolumeSI: 2e-6,
      syringeCount: 1,
      frictionForceSI: 4,
      mechanismEfficiency: 0.9,
      leadSI: 0.002,
      screwEfficiency: 0.3,
      gearRatio: 1,
      gearEfficiency: 1,
      motorTorqueSI: 0.12,
      motorSpeedSI: 12.566,
      motorCurrentSI: 0.35,
      supplyVoltageSI: 11.1,
      safetyFactor: 2,
      targetBuoyancyForceSI: 0.35,
    },
    structure: {
      housingOuterDiameterSI: 0.09,
      housingWallThicknessSI: 0.003,
      housingLengthSI: 0.5,
      materialId: "pmma",
      youngsModulusSI: 3.0e9,
      poissonsRatio: 0.35,
      yieldStrengthSI: 70e6,
      materialProvenance: "reference",
      safetyFactor: 2,
    },
    battery: {
      capacitySI: 9000,
      nominalVoltageSI: 11.1,
      usableFraction: 0.8,
      deratingFactor: 0.9,
      chemistry: "Li-ion 3S 2500 mAh",
      provenance: "estimated",
    },
    project: {
      budgetUSD: 400,
      manufacturingMethods: ["FDM 3D printing", "Manual lathe", "Bench drill", "Hand tools"],
      availableEquipment: ["3.5 m dive tank", "Digital scale (0.1 g)", "Spring scale (0-50 N)", "Bench power supply", "Digital calipers", "Oscilloscope"],
      advisorName: "(demo advisor)",
      courseName: "Senior Design (demonstration)",
      revision: "A",
    },
  });
}

export function createSampleProject(): ProjectRow {
  const existing = listProjects().find((p) => p.slug === SAMPLE_SLUG);
  if (existing) return existing;

  const project = createProject({
    name: "DEMO — Laboratory Underwater Glider",
    slug: SAMPLE_SLUG,
    description:
      "DEMONSTRATION PROJECT. Every value in this project is synthetic example data created to show the full workflow. It describes no real vehicle and contains no real measurements. Do not copy its numbers into your own design.",
    phase: "preliminary",
    isSample: true,
    settings: sampleSettings(),
  });
  const pid = project.id;
  const now = Date.now();
  const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);

  for (const c of COMPONENTS) {
    createRow("components", pid, {
      name: c.name,
      part_number: c.part_number,
      version: "A",
      category: c.category,
      material_name: c.material_name,
      manufacturing_method: c.manufacturing_method,
      measured_mass_kg: c.measured_mass_kg,
      estimated_mass_kg: c.estimated_mass_kg,
      displaced_volume_m3: c.displaced_volume_m3,
      cad_volume_m3: c.cad_volume_m3,
      displacement_mode: c.displacement_mode,
      quantity: c.quantity ?? 1,
      pos_x: c.pos[0],
      pos_y: c.pos[1],
      pos_z: c.pos[2],
      include_in_budget: 1,
      movable: c.movable ? 1 : 0,
      min_x: c.min_x,
      max_x: c.max_x,
      color: c.color,
      cost: c.cost,
      supplier: c.supplier,
      confidence: c.confidence ?? "medium",
      notes: c.notes,
      assumptions: c.confidence === "low" ? "Mass is estimated, not weighed." : null,
    });
  }

  for (const r of REQUIREMENTS) {
    createRow("requirements", pid, { ...r, links_json: JSON.stringify({ tests: [], components: [], calculations: [] }), notes: D });
  }

  for (const e of ELECTRONICS) {
    createRow("electronics", pid, { ...e, notes: D });
  }
  for (const p of PINS) {
    createRow("pin_assignments", pid, { ...p, notes: D });
  }
  for (const a of ASSUMPTIONS) {
    createRow("assumptions", pid, a);
  }
  for (const r of STARTER_RISKS) {
    createRow("risks", pid, { ...r, is_starter: 1, reviewed: 0 });
  }
  for (const t of TEST_TEMPLATES) {
    createRow("tests", pid, {
      key: t.key,
      title: t.title,
      objective: t.objective,
      category: t.category,
      requirement_ids_json: JSON.stringify(t.requirementKeys ?? []),
      equipment: t.equipment,
      setup: t.setup,
      variables_json: JSON.stringify(t.variables),
      procedure: t.procedure,
      safety: t.safety,
      raw_fields_json: JSON.stringify(t.rawFields),
      expected_result: t.expected,
      pass_criteria: t.passCriteria,
      uncertainty_sources: t.uncertaintySources,
      status: "planned",
    });
  }
  for (const d of DECISIONS) {
    createRow("decisions", pid, {
      key: d.key,
      statement: d.statement,
      context: d.context,
      alternatives_json: JSON.stringify(d.alternatives),
      criteria_json: JSON.stringify(d.criteria),
      scores_json: JSON.stringify(d.scores),
      chosen: d.chosen,
      advantages: d.advantages,
      disadvantages: d.disadvantages,
      risks: d.risks,
      status: d.status,
      decided_on: day(-20),
      evidence_json: JSON.stringify([]),
    });
  }
  for (const m of MILESTONES) {
    createRow("milestones", pid, { title: m.title, due_date: day(m.offsetDays), status: m.status, notes: m.notes });
  }
  for (const n of NOTEBOOK) {
    createRow("notebook_entries", pid, n);
  }
  for (const r of REFS) {
    createRow("refs", pid, { ...r, added_at: new Date().toISOString() });
  }

  createRow("tasks", pid, {
    title: "Measure plunger breakaway and sliding friction",
    detail: "Spring scale, dry and wet, at three stroke positions. Feeds directly into the motor sizing.",
    status: "open",
    priority: "high",
    due_date: day(7),
    phase: "preliminary",
    source: "user",
  });
  createRow("tasks", pid, {
    title: "Water-displacement test of the assembled hull",
    detail: "Confirms the 3200 cm^3 CAD envelope volume, which is the largest single term in the buoyancy budget.",
    status: "open",
    priority: "high",
    due_date: day(9),
    phase: "preliminary",
    source: "user",
  });

  createRow("design_variants", pid, {
    name: "Baseline — 26.6 mm bore, 80 mm stroke",
    description: `${D} The as-designed configuration.`,
    config_json: JSON.stringify({
      syringe: { boreDiameterSI: 0.0266, usableStrokeSI: 0.08, maxStrokeSI: 0.09, syringeCount: 1, config: "external-plunger" },
      hydro: { dragCoefficient: 0.12, liftCoefficient: 0.35 },
    }),
  });
  createRow("design_variants", pid, {
    name: "Alternative — 20 mm bore, 120 mm stroke",
    description: `${D} Same swept volume from a narrower, longer syringe: lower pressure force and torque, but a longer package and slower actuation.`,
    config_json: JSON.stringify({
      syringe: { boreDiameterSI: 0.02, usableStrokeSI: 0.12, maxStrokeSI: 0.13, syringeCount: 1, config: "external-plunger" },
      hydro: { dragCoefficient: 0.12, liftCoefficient: 0.35 },
    }),
  });
  createRow("design_variants", pid, {
    name: "Alternative — twin 20 mm bores, 80 mm stroke",
    description: `${D} Two syringes in parallel: more authority, more force, more plumbing.`,
    config_json: JSON.stringify({
      syringe: { boreDiameterSI: 0.02, usableStrokeSI: 0.08, maxStrokeSI: 0.09, syringeCount: 2, config: "external-plunger" },
      hydro: { dragCoefficient: 0.12, liftCoefficient: 0.35 },
    }),
  });

  return getProject(pid)!;
}

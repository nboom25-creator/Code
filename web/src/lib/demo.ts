import type { Lesson, Solve } from "./schemas";

/**
 * DEMO CONTENT — clearly labeled, hand-authored sample data so the UI (equation
 * rendering, sections, video panel, hint reveal) can be explored WITHOUT an API
 * key. This is NOT AI output and NOT a live result. The `topic`/titles below say
 * "(demo)" so it can never be mistaken for generated content.
 */

export const DEMO_LESSON: Lesson = {
  topic: "Bernoulli's equation (demo)",
  discipline: "Fluid mechanics",
  level: "intermediate",
  overview:
    "Bernoulli's equation relates pressure, velocity, and elevation along a streamline for steady, incompressible, inviscid flow. It is an energy statement: the sum of pressure head, velocity head, and elevation head is constant along a streamline.",
  prerequisites: ["Conservation of energy", "Fluid statics", "Streamlines and steady flow"],
  objectives: [
    "State Bernoulli's equation and its assumptions",
    "Apply it between two points on a streamline",
    "Recognize when it is NOT valid",
  ],
  definitions: [
    { term: "Streamline", definition: "A curve everywhere tangent to the velocity field at an instant." },
    { term: "Head", definition: "Energy per unit weight of fluid, expressed as an equivalent height." },
  ],
  principles: ["Conservation of mechanical energy along a streamline (no friction, no shaft work)."],
  equations: [
    {
      name: "Bernoulli's equation",
      latex: "p_1 + \\tfrac{1}{2}\\rho v_1^2 + \\rho g z_1 = p_2 + \\tfrac{1}{2}\\rho v_2^2 + \\rho g z_2",
      description: "Between points 1 and 2 on the same streamline.",
    },
  ],
  variables: [
    { symbol: "p", name: "Pressure", siUnit: "Pa", description: "Static pressure" },
    { symbol: "\\rho", name: "Density", siUnit: "kg/m^3", description: "Fluid density" },
    { symbol: "v", name: "Speed", siUnit: "m/s", description: "Flow speed" },
    { symbol: "g", name: "Gravity", siUnit: "m/s^2", description: "9.81 m/s²" },
    { symbol: "z", name: "Elevation", siUnit: "m", description: "Height above a datum" },
  ],
  assumptions: ["Steady flow", "Incompressible", "Inviscid (no friction)", "Along a single streamline"],
  example: {
    problem: "Water drains from a large open tank through a hole 5 m below the surface. Find the exit speed.",
    steps: [
      {
        title: "Apply Bernoulli between surface (1) and hole (2)",
        explanation: "Both are at atmospheric pressure, so $p_1 = p_2$. The tank is large, so $v_1 \\approx 0$.",
        latex: "\\rho g z_1 = \\tfrac{1}{2}\\rho v_2^2 + \\rho g z_2",
      },
      {
        title: "Solve for the exit speed (Torricelli)",
        explanation: "With $h = z_1 - z_2 = 5\\,\\text{m}$:",
        latex: "v_2 = \\sqrt{2 g h}",
      },
    ],
    answer: "$v_2 = \\sqrt{2(9.81)(5)} \\approx 9.9\\ \\text{m/s}$",
  },
  commonMistakes: [
    "Applying Bernoulli across a pump or turbine (there is shaft work).",
    "Ignoring friction in long pipes (use the energy equation with head loss instead).",
    "Mixing gauge and absolute pressure inconsistently.",
  ],
  physicalInterpretation:
    "As the fluid speeds up, its pressure drops — the kinetic energy comes at the expense of pressure or elevation energy.",
  knowledgeCheck: [
    {
      question: "If elevation is constant and speed increases, what happens to pressure?",
      options: ["Increases", "Decreases", "Unchanged"],
      answer: "Decreases",
      explanation: "Higher velocity head must be offset by lower pressure head.",
    },
  ],
  relatedConcepts: ["Continuity equation", "Venturi meter", "Head loss", "Energy equation"],
  videoQueries: [
    "Bernoulli equation worked example tank draining Torricelli",
    "Venturi meter Bernoulli continuity example",
    "when is Bernoulli equation not valid assumptions",
  ],
};

export const DEMO_SOLVE: Solve = {
  problemStatement:
    "(demo) 2 kg of water at 20 °C is heated to 80 °C in an insulated container. c = 4186 J/(kg·K). Find the heat required.",
  discipline: "Thermodynamics",
  known: [
    { symbol: "m", value: "2", unit: "kg", label: "mass of water", source: "given" },
    { symbol: "c", value: "4186", unit: "J/(kg·K)", label: "specific heat", source: "given" },
    { symbol: "\\Delta T", value: "60", unit: "K", label: "temperature rise (80−20)", source: "given" },
  ],
  unknown: [{ symbol: "Q", label: "heat required" }],
  assumptions: ["No phase change", "Constant specific heat", "No losses (insulated)"],
  missingInfo: [],
  diagram: {
    type: "mermaid",
    title: "Energy balance",
    content: "flowchart LR\n  Q[Heat in Q] --> W[Water 2 kg]\n  W --> dT[Temp 20C to 80C]",
    caption: "Closed system: all heat raises internal energy.",
  },
  governingPrinciples: ["First law for a closed system with only sensible heating: Q = m c ΔT."],
  equations: [{ name: "Sensible heat", latex: "Q = m\\,c\\,\\Delta T", description: "" }],
  steps: [
    { title: "Write the governing equation", detail: "For sensible heating, $Q = m\\,c\\,\\Delta T$.", latex: "Q = m c \\Delta T" },
    { title: "Substitute with units", detail: "$Q = (2\\,\\text{kg})(4186\\,\\tfrac{\\text{J}}{\\text{kg·K}})(60\\,\\text{K})$", latex: "" },
    { title: "Compute", detail: "The kg and K cancel, leaving joules.", latex: "Q = 502{,}320\\ \\text{J}" },
  ],
  unitCheck: "$\\text{kg} \\cdot \\tfrac{\\text{J}}{\\text{kg·K}} \\cdot \\text{K} = \\text{J}$ ✓",
  finalAnswer: { value: "502320", unit: "J", latex: "Q \\approx 5.02\\times10^5\\ \\text{J}", sigFigs: 3 },
  sanityCheck: "About 500 kJ to heat 2 L of water by 60 °C is reasonable.",
  physicalInterpretation: "All supplied heat becomes internal energy since no work is done and nothing escapes.",
  commonMistakes: ["Using °C for ΔT where an absolute temperature is needed", "Forgetting c is per kelvin"],
  videoQueries: ["specific heat sensible heat Q = m c delta T worked example"],
  practiceProblem: "Repeat for 0.5 kg of aluminum (c = 900 J/(kg·K)) heated by 40 K.",
  calcRequest: {
    expression: "m*c*dT",
    variables: { m: "2 kg", c: "4186 J/(kg*K)", dT: "60 K" },
    expectedUnit: "J",
  },
};

/**
 * Test-plan templates for a laboratory underwater glider.
 *
 * These are starting points, not procedures approved for your facility. Each
 * one has to be edited for the equipment you actually have and reviewed for
 * safety before anyone runs it.
 */

export interface TestTemplate {
  key: string;
  title: string;
  category: string;
  objective: string;
  requirementKeys?: string[];
  equipment: string;
  setup: string;
  variables: { name: string; role: "independent" | "dependent" | "controlled"; unit: string }[];
  procedure: string;
  safety: string;
  rawFields: { name: string; unit: string; note?: string }[];
  expected: string;
  passCriteria: string;
  uncertaintySources: string;
}

export const TEST_TEMPLATES: TestTemplate[] = [
  {
    key: "TST-001",
    title: "Syringe static leak test",
    category: "leak",
    objective: "Confirm the syringe and its plunger seal hold a pressure differential equivalent to the maximum operating depth without measurable leakage.",
    requirementKeys: ["REQ-008"],
    equipment: "Syringe assembly, water column or hand pump with gauge, stopwatch, absorbent paper, digital scale (0.1 g).",
    setup: "Fill the syringe with water, seal the outlet, and apply the test pressure to the plunger face. Support the assembly so no side load acts on the plunger.",
    variables: [
      { name: "Applied pressure", role: "independent", unit: "kPa" },
      { name: "Hold time", role: "controlled", unit: "min" },
      { name: "Mass of water passed", role: "dependent", unit: "g" },
      { name: "Water temperature", role: "controlled", unit: "degC" },
    ],
    procedure:
      "1. Record ambient temperature and the initial mass of the absorbent paper.\n2. Assemble and pressurise slowly to the test pressure.\n3. Hold for 30 minutes, recording the gauge every 5 minutes.\n4. Wipe any escaped water onto the pre-weighed paper and re-weigh.\n5. Depressurise slowly and inspect the seal.",
    safety:
      "Pressurised water stores energy. Do not exceed the syringe's rated pressure. Wear eye protection. Point the plunger away from people. Depressurise before disassembly.",
    rawFields: [
      { name: "time_min", unit: "min" },
      { name: "gauge_pressure_kPa", unit: "kPa" },
      { name: "paper_mass_g", unit: "g", note: "Pre- and post-test" },
      { name: "temperature_C", unit: "degC" },
      { name: "observations", unit: "-" },
    ],
    expected: "No measurable mass of water passes the seal and the gauge holds steady.",
    passCriteria: "Less than 0.1 g of water passed in 30 minutes and no pressure decay beyond the gauge resolution.",
    uncertaintySources: "Gauge resolution and calibration; evaporation from the paper between wiping and weighing; temperature-driven pressure change in a sealed volume; scale resolution.",
  },
  {
    key: "TST-002",
    title: "Plunger friction measurement",
    category: "mechanism",
    objective: "Measure the breakaway and sliding friction of the syringe plunger, dry and wetted, so the actuator can be sized against a measured load instead of an assumption.",
    requirementKeys: ["REQ-004"],
    equipment: "Spring scale (0-50 N) or load cell, syringe, clamp/vice, ruler, video camera (optional, to read the peak).",
    setup: "Clamp the barrel horizontally with the outlet OPEN so no pressure builds. Attach the scale to the plunger rod in line with its axis.",
    variables: [
      { name: "Stroke position", role: "independent", unit: "mm" },
      { name: "Wetted / dry", role: "independent", unit: "-" },
      { name: "Breakaway force", role: "dependent", unit: "N" },
      { name: "Sliding force", role: "dependent", unit: "N" },
      { name: "Pull speed", role: "controlled", unit: "mm/s" },
    ],
    procedure:
      "1. With the outlet open, pull the plunger slowly and steadily; record the PEAK force (breakaway) and the steady force (sliding).\n2. Repeat at 25%, 50% and 75% of stroke.\n3. Repeat in both directions.\n4. Repeat with the plunger wetted, and again after a 10-minute dwell to capture stiction growth.\n5. Perform at least three repeats per condition.",
    safety: "Keep fingers clear of the plunger travel. Do not overload the spring scale.",
    rawFields: [
      { name: "run", unit: "-" },
      { name: "stroke_position_mm", unit: "mm" },
      { name: "direction", unit: "-" },
      { name: "condition", unit: "-", note: "dry / wet / wet after dwell" },
      { name: "breakaway_force_N", unit: "N" },
      { name: "sliding_force_N", unit: "N" },
    ],
    expected: "Breakaway force exceeds sliding force; both are roughly constant along the stroke.",
    passCriteria: "Measured sliding friction is at or below the value used in the actuator sizing, with the stall margin recomputed from the MEASURED value.",
    uncertaintySources: "Spring-scale resolution and calibration; reading the peak by eye; off-axis pull adding side load; pull speed affecting the sliding value; seal condition changing between runs.",
  },
  {
    key: "TST-003",
    title: "Buoyancy engine stroke and displacement test",
    category: "buoyancy-engine",
    objective: "Measure the actual volume displaced per unit stroke and confirm it matches the swept volume computed from the bore.",
    requirementKeys: ["REQ-004"],
    equipment: "Graduated cylinder (1 mL divisions) or scale with a beaker, calipers, assembled buoyancy engine, power supply.",
    setup: "Run the engine through its full stroke while discharging into a graduated cylinder, or measure the mass of water displaced.",
    variables: [
      { name: "Commanded stroke", role: "independent", unit: "mm" },
      { name: "Delivered volume", role: "dependent", unit: "mL" },
      { name: "Water temperature", role: "controlled", unit: "degC" },
    ],
    procedure:
      "1. Measure the bore with calipers at three positions and record all three.\n2. Drive the plunger to the retracted limit and zero the measurement.\n3. Command 25%, 50%, 75% and 100% of usable stroke, measuring the delivered volume at each.\n4. Repeat three times.\n5. Compare the volume-versus-stroke slope with pi/4 * D^2.",
    safety: "Keep the power supply and any mains equipment away from the water. Current-limit the supply.",
    rawFields: [
      { name: "run", unit: "-" },
      { name: "commanded_stroke_mm", unit: "mm" },
      { name: "measured_stroke_mm", unit: "mm" },
      { name: "delivered_volume_mL", unit: "mL" },
      { name: "temperature_C", unit: "degC" },
    ],
    expected: "Delivered volume is linear in stroke with a slope equal to the piston area.",
    passCriteria: "Measured slope within 5% of pi/4 * D^2, and total usable volume at least the value required by REQ-004.",
    uncertaintySources: "Graduated-cylinder resolution and meniscus reading; water clinging to the vessel; caliper accuracy on a thin-wall barrel; dead volume and trapped air.",
  },
  {
    key: "TST-004",
    title: "Static buoyancy and trim test",
    category: "buoyancy",
    objective: "Determine the ballast needed for neutral buoyancy and the resting attitude of the assembled vehicle in the test tank.",
    requirementKeys: ["REQ-003", "REQ-004"],
    equipment: "Test tank, assembled vehicle, calibrated ballast weights (1 g to 50 g), thermometer, waterproof camera or phone, protractor or IMU log.",
    setup: "Vehicle fully assembled and sealed, buoyancy engine at mid-stroke, submerged and released at mid-depth.",
    variables: [
      { name: "Added ballast mass", role: "independent", unit: "g" },
      { name: "Ballast position", role: "independent", unit: "mm" },
      { name: "Vertical drift rate", role: "dependent", unit: "mm/s" },
      { name: "Resting pitch angle", role: "dependent", unit: "deg" },
      { name: "Water temperature", role: "controlled", unit: "degC" },
    ],
    procedure:
      "1. Record water temperature and estimate density.\n2. Submerge the vehicle at mid-depth and release it gently with no initial velocity.\n3. Time its travel over a marked distance to get the drift rate.\n4. Add or remove ballast and repeat until the drift is below the resolution of the measurement.\n5. Photograph or log the resting pitch and roll.\n6. Repeat the whole sequence three times to establish repeatability.",
    safety: "Never work alone at the tank. Keep electrical equipment away from the water. Agree a stop-work signal.",
    rawFields: [
      { name: "run", unit: "-" },
      { name: "ballast_mass_g", unit: "g" },
      { name: "ballast_position_mm", unit: "mm" },
      { name: "drift_distance_m", unit: "m" },
      { name: "drift_time_s", unit: "s" },
      { name: "pitch_deg", unit: "deg" },
      { name: "roll_deg", unit: "deg" },
      { name: "temperature_C", unit: "degC" },
    ],
    expected: "A ballast mass exists at which the vehicle hovers; the resting pitch matches the predicted equilibrium attitude.",
    passCriteria: "Neutral achievable within the available ballast range, and measured resting pitch within 5 degrees of the predicted equilibrium pitch.",
    uncertaintySources: "Residual water currents in the tank; air bubbles clinging to the hull; surface tension at release; timing by hand; thermal stratification in the tank; the vehicle not being fully wetted out.",
  },
  {
    key: "TST-005",
    title: "Hull proof pressure test",
    category: "pressure",
    objective: "Demonstrate that the empty pressure housing withstands more than the maximum operating pressure without leakage or permanent deformation.",
    requirementKeys: ["REQ-002", "REQ-009"],
    equipment: "Pressure vessel or deep tank, gauge, calipers, camera, dummy mass in place of electronics.",
    setup: "Housing sealed with a dummy internal mass and a witness paper inside. No electronics fitted.",
    variables: [
      { name: "Applied pressure", role: "independent", unit: "kPa" },
      { name: "Hold time", role: "controlled", unit: "min" },
      { name: "Diameter change", role: "dependent", unit: "mm" },
      { name: "Water ingress", role: "dependent", unit: "g" },
    ],
    procedure:
      "1. Measure and record the housing diameter at three stations before the test.\n2. Pressurise in steps to 1.5x the maximum operating pressure, holding and inspecting at each step.\n3. Hold at the proof pressure for 15 minutes.\n4. Depressurise, open, and inspect the witness paper.\n5. Re-measure the diameters and compare.",
    safety:
      "THIS IS THE MOST HAZARDOUS TEST IN THE PROGRAMME. A failing housing releases stored energy. Use a shielded vessel or full water immersion (water stores far less energy than gas), never compressed air in an open lab. Get this procedure reviewed and supervised by your advisor or lab technician before running it.",
    rawFields: [
      { name: "step", unit: "-" },
      { name: "pressure_kPa", unit: "kPa" },
      { name: "hold_time_min", unit: "min" },
      { name: "diameter_station1_mm", unit: "mm" },
      { name: "diameter_station2_mm", unit: "mm" },
      { name: "diameter_station3_mm", unit: "mm" },
      { name: "witness_paper_dry", unit: "-" },
    ],
    expected: "No ingress, no audible cracking, no permanent diameter change.",
    passCriteria: "Witness paper dry, and diameter change after depressurisation within measurement resolution.",
    uncertaintySources: "Caliper repeatability on a compliant polymer; gauge calibration; temperature change during pressurisation; operator variation in caliper pressure.",
  },
  {
    key: "TST-006",
    title: "Motor stall torque and current test",
    category: "actuator",
    objective: "Measure the torque and current the drivetrain actually delivers, and confirm the stall margin against the measured plunger load.",
    requirementKeys: ["REQ-004"],
    equipment: "Bench power supply with current display, lever arm and spring scale (or a torque transducer), tachometer or timed rotations, ruler.",
    setup: "Motor and gearbox mounted rigidly, lever arm of known length clamped to the output shaft.",
    variables: [
      { name: "Supply voltage", role: "independent", unit: "V" },
      { name: "Applied load", role: "independent", unit: "N" },
      { name: "Output torque", role: "dependent", unit: "N*m" },
      { name: "Current draw", role: "dependent", unit: "A" },
      { name: "Speed", role: "dependent", unit: "rpm" },
    ],
    procedure:
      "1. Run the motor unloaded and record no-load current and speed.\n2. Apply increasing load through the lever arm, recording force, current and speed at each step.\n3. Continue to stall, recording the stall current briefly.\n4. Repeat at the battery's minimum expected voltage as well as its nominal voltage.",
    safety: "Stall current can be many times the running current — fuse the supply and do not hold a stall for more than a second or two. Keep clear of the lever arm.",
    rawFields: [
      { name: "supply_voltage_V", unit: "V" },
      { name: "lever_arm_m", unit: "m" },
      { name: "force_N", unit: "N" },
      { name: "current_A", unit: "A" },
      { name: "speed_rpm", unit: "rpm" },
    ],
    expected: "Torque falls roughly linearly with speed; stall torque exceeds the required design torque with margin.",
    passCriteria: "Stall margin against the measured plunger load is at least 1.5 at the minimum battery voltage.",
    uncertaintySources: "Lever-arm length measurement; spring-scale reading; supply voltage sag; motor heating during the test changing its characteristics.",
  },
  {
    key: "TST-007",
    title: "Power consumption and endurance test",
    category: "power",
    objective: "Measure the real average and peak current of the complete vehicle over a representative cycle, to replace the estimated power budget.",
    requirementKeys: ["REQ-007"],
    equipment: "Inline current meter or shunt with a logging DMM, bench supply or the flight pack, stopwatch.",
    setup: "Complete vehicle powered and running its mission state machine on the bench, with the buoyancy engine cycling into air.",
    variables: [
      { name: "Mission state", role: "independent", unit: "-" },
      { name: "Bus current", role: "dependent", unit: "A" },
      { name: "Bus voltage", role: "dependent", unit: "V" },
      { name: "Elapsed time", role: "controlled", unit: "s" },
    ],
    procedure:
      "1. Log current and voltage at 10 Hz or faster through at least three complete cycles.\n2. Annotate the log with state transitions.\n3. Integrate to get energy per cycle and average power per state.\n4. Compare with the power-budget prediction.",
    safety: "Fuse the pack. Do not leave a lithium pack charging or discharging unattended.",
    rawFields: [
      { name: "time_s", unit: "s" },
      { name: "current_A", unit: "A" },
      { name: "voltage_V", unit: "V" },
      { name: "state", unit: "-" },
    ],
    expected: "Average power close to the budget; actuator bursts visible as short high-current spikes.",
    passCriteria: "Measured energy per cycle is at or below the budgeted value, and the predicted cycle count meets REQ-007.",
    uncertaintySources: "Shunt tolerance and self-heating; logger sample rate aliasing short current spikes; supply voltage differing from the flight pack; running the engine in air rather than against real pressure.",
  },
  {
    key: "TST-008",
    title: "Pool glide test",
    category: "performance",
    objective: "Measure the glide speed, glide angle and glide ratio of the trimmed vehicle at a known net buoyancy, to replace the assumed hydrodynamic coefficients.",
    requirementKeys: ["REQ-005", "REQ-006"],
    equipment: "Test tank with marked distances, two cameras (side and above) or an underwater camera, stopwatch, IMU logging, depth logging.",
    setup: "Vehicle trimmed neutral, then the buoyancy engine set to a known offset from neutral. Marked reference grid on the tank wall.",
    variables: [
      { name: "Net buoyancy setting", role: "independent", unit: "N" },
      { name: "Trim ballast position", role: "independent", unit: "mm" },
      { name: "Glide speed", role: "dependent", unit: "m/s" },
      { name: "Glide path angle", role: "dependent", unit: "deg" },
      { name: "Vertical speed", role: "dependent", unit: "m/s" },
    ],
    procedure:
      "1. Confirm neutral trim first (TST-004).\n2. Set a known buoyancy offset and release the vehicle with zero initial velocity.\n3. Record video against the marked grid and log depth and attitude.\n4. Extract the steady portion of the glide only — discard the initial transient.\n5. Repeat at three buoyancy settings, three runs each.\n6. Fit C_L and C_D from the measured speed and angle.",
    safety: "Never test alone. Attach a light recovery line for the first runs. Keep electrical equipment away from the water.",
    rawFields: [
      { name: "run", unit: "-" },
      { name: "net_buoyancy_N", unit: "N" },
      { name: "trim_position_mm", unit: "mm" },
      { name: "distance_m", unit: "m" },
      { name: "time_s", unit: "s" },
      { name: "depth_change_m", unit: "m" },
      { name: "pitch_deg", unit: "deg" },
    ],
    expected: "Speed increases with the square root of net buoyancy; glide angle is roughly independent of it.",
    passCriteria: "Vertical speed meets REQ-005 and glide ratio meets REQ-006 at the design buoyancy setting.",
    uncertaintySources:
      "Parallax in the video; identifying where the steady glide actually begins; tank wall and free-surface effects at this scale; net buoyancy not being exactly what the engine position implies; hand timing; the vehicle not being perfectly trimmed between runs.",
  },
  {
    key: "TST-009",
    title: "Depth-control and cycle-repeatability test",
    category: "control",
    objective: "Confirm the state machine reliably reverses at the target depth and at the surface, over repeated cycles.",
    requirementKeys: ["REQ-001", "REQ-007"],
    equipment: "Test tank, full vehicle, depth logging, stopwatch, recovery line.",
    setup: "Vehicle configured for autonomous cycling with the depth limit set conservatively for the first runs.",
    variables: [
      { name: "Target depth", role: "independent", unit: "m" },
      { name: "Cycle number", role: "independent", unit: "-" },
      { name: "Achieved depth", role: "dependent", unit: "m" },
      { name: "Cycle time", role: "dependent", unit: "s" },
      { name: "Overshoot", role: "dependent", unit: "m" },
    ],
    procedure:
      "1. Zero the depth sensor at the surface.\n2. Run a single cycle with a recovery line attached and confirm the reversal.\n3. Run six consecutive cycles logging depth continuously.\n4. Extract achieved depth, overshoot and cycle time for each.",
    safety: "Recovery line on early runs. Two people present. Independent time-based depth backstop enabled in software.",
    rawFields: [
      { name: "cycle", unit: "-" },
      { name: "target_depth_m", unit: "m" },
      { name: "achieved_depth_m", unit: "m" },
      { name: "overshoot_m", unit: "m" },
      { name: "cycle_time_s", unit: "s" },
      { name: "battery_voltage_V", unit: "V" },
    ],
    expected: "Consistent cycle time and achieved depth across cycles, with modest overshoot.",
    passCriteria: "Six cycles completed, achieved depth within 0.3 m of target on every cycle, no depth-limit violation.",
    uncertaintySources: "Depth sensor drift and zeroing; latency between the depth trigger and the engine reaching its new state; battery voltage falling across the run changing actuation time; tank thermal stratification.",
  },
];

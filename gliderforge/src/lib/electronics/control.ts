/**
 * Control-strategy reference and code templates.
 *
 * Two rules govern this file:
 *  1. No controller is tuned here. Tuning needs measured vehicle dynamics; a
 *     gain suggested from invented dynamics would be worse than no suggestion.
 *  2. Code templates are only produced once the user has confirmed the hardware
 *     platform, and they are explicitly structural skeletons, not working
 *     firmware.
 */

export interface ControlStrategy {
  id: string;
  label: string;
  description: string;
  complexity: "low" | "medium" | "high";
  requires: string[];
  failureModes: string[];
  equations: string[];
  tuningWarning?: string;
}

export const CONTROL_STRATEGIES: ControlStrategy[] = [
  {
    id: "timed",
    label: "Timed actuation",
    description:
      "Run the buoyancy engine for a fixed time in each direction. The simplest thing that can possibly work, and the right first step for a bench test.",
    complexity: "low",
    requires: ["Motor driver", "A timer in firmware", "Nothing else"],
    failureModes: [
      "Actuation time varies with battery voltage and with depth (pressure load), so the delivered volume drifts run to run.",
      "No knowledge of actual plunger position — after a stall the controller's idea of the state is wrong and stays wrong.",
      "Cannot detect a jam.",
    ],
    equations: ["x_commanded = v_plunger * t_run", "v_plunger = (omega_motor / G) / (2*pi) * L"],
  },
  {
    id: "limit-switch",
    label: "Limit-switch (bang-bang) control",
    description:
      "Drive to a mechanical end stop detected by a switch. Gives a repeatable full-stroke volume without any position sensing, and is the usual first working configuration.",
    complexity: "low",
    requires: ["Two limit switches", "Two digital inputs", "A motor time-out as a backup"],
    failureModes: [
      "A failed switch means the motor drives into the hard stop until the time-out catches it.",
      "Only two buoyancy states — no partial stroke, so no proportional control of net buoyancy.",
      "Contact bounce can cause a false trigger; debounce in firmware.",
    ],
    equations: ["Buoyancy states are the two mechanical extremes: dV = A_p * x_usable"],
  },
  {
    id: "position",
    label: "Plunger position feedback",
    description:
      "Measure plunger position (encoder, potentiometer or step counting) and command an arbitrary stroke. Gives proportional control of net buoyancy, which is what a real glider needs to hold a glide angle.",
    complexity: "medium",
    requires: ["Position sensor or a stepper with reliable step counting", "Homing routine against a limit switch at power-up"],
    failureModes: [
      "Step counting silently loses position on a stall — always home against a switch, never trust the count across a fault.",
      "Analogue position sensors drift with temperature and need calibration.",
    ],
    equations: ["V(t) = A_p * x(t)", "F_net(t) = rho*g*(V_0 + dV(t)) - m*g"],
  },
  {
    id: "depth-threshold",
    label: "Depth-threshold cycling",
    description:
      "Reverse the buoyancy engine when a target depth or the surface is detected. This is the state machine the mission simulator models, and it is enough to demonstrate repeated dive-and-climb cycles.",
    complexity: "medium",
    requires: ["Depth or pressure sensor, zeroed at the surface each run", "An independent time-based depth backstop"],
    failureModes: [
      "Sensor drift or a bad zero sends the vehicle past its depth limit — always run an independent time backstop.",
      "Latency between the trigger and the engine reaching its new state causes overshoot; at a typical glider sink rate that overshoot is (sink rate × actuation time).",
      "Air trapped in the sensor port gives a slow, wrong reading.",
    ],
    equations: ["overshoot ≈ V_vertical * t_actuation", "trigger: depth >= depth_target -> command climb state"],
  },
  {
    id: "pitch-feedback",
    label: "Pitch feedback with a movable mass",
    description:
      "Use an IMU to measure pitch and move a trim mass to hold a commanded glide angle. Only worth attempting once the vehicle glides stably open-loop.",
    complexity: "high",
    requires: ["IMU with a filtered pitch estimate", "Motorised trim mass with position feedback", "Measured pitch dynamics"],
    failureModes: [
      "The trim mass and the buoyancy engine both affect pitch, so the two loops interact.",
      "IMU pitch is corrupted by vehicle acceleration; a complementary or Kalman filter is needed, not raw accelerometer angle.",
      "Chasing pitch with a slow actuator produces a limit cycle — the vehicle porpoises.",
    ],
    equations: ["theta_eq = atan2(x_CB - x_CG, z_CB - z_CG)", "d(x_CG) = m_trim * delta / M_total"],
    tuningWarning:
      "This application will NOT suggest gains. Tuning a pitch loop needs the vehicle's measured pitch response — natural frequency and damping — which depends on added mass, fin area and speed. Identify that response from a tank test (release the vehicle at a disturbed pitch and log the IMU), then tune against the measured response. Gains derived from invented dynamics are worse than useless because they look authoritative.",
  },
  {
    id: "pid-depth",
    label: "Proportional or PID depth hold",
    description:
      "Continuously modulate buoyancy to hold a commanded depth. The most capable option and the least appropriate one to start with, because a buoyancy engine is a slow, rate-limited actuator with significant dead time.",
    complexity: "high",
    requires: ["Proportional buoyancy control (position feedback)", "Reliable depth sensing", "Measured vehicle heave response"],
    failureModes: [
      "The actuator is rate-limited and has dead time; a naive PID will oscillate.",
      "Integral windup while the actuator is saturated at an end stop.",
      "Depth sensor noise differentiated by the D term.",
    ],
    equations: [
      "e(t) = depth_target - depth(t)",
      "u(t) = Kp*e(t) + Ki*integral(e dt) + Kd*de/dt",
      "u is a commanded buoyancy (or plunger position), NOT a motor voltage",
    ],
    tuningWarning:
      "No gains are suggested. A buoyancy engine takes seconds to move and the vehicle takes tens of seconds to respond, so the loop is dominated by dead time — the regime where textbook tuning rules perform worst. Measure a step response first (command a known buoyancy change and log depth against time), fit a first-order-plus-dead-time model to THAT data, and tune from it. Add anti-windup and a rate limit before you put the vehicle in water.",
  },
];

export const PREDEPLOYMENT_CHECKLIST: { step: string; why: string }[] = [
  { step: "Confirm a second person is present and a stop-work signal is agreed.", why: "Nobody tests alone at a tank. This outranks every technical item below." },
  { step: "Check battery voltage and confirm it is above the brown-out threshold with margin.", why: "A mission that browns out mid-dive is a recovery problem, not a data point." },
  { step: "Inspect and grease the O-rings; check the sealing surfaces for scratches and hair.", why: "A single hair across a face seal is a classic cause of a flooded hull." },
  { step: "Torque the end-cap fasteners in a cross pattern and record the value.", why: "Uneven clamping distorts the cap and unseats the seal." },
  { step: "Run a dry-land full stroke of the buoyancy engine and watch both limit switches trigger.", why: "Catches a mis-wired switch before the vehicle is sealed and wet." },
  { step: "Zero the depth sensor at the surface.", why: "An un-zeroed sensor offsets every depth trigger in the run." },
  { step: "Confirm the leak sensor reads dry and that its alarm path actually works (wet it briefly).", why: "An untested alarm is not an alarm." },
  { step: "Confirm the independent time-based depth backstop is enabled.", why: "It is the only protection that survives a failed depth sensor." },
  { step: "Static float test: confirm the vehicle floats when unpowered, and record the trim.", why: "Positive-when-unpowered means the default failure mode is floating, not sinking." },
  { step: "Attach the recovery line for early runs.", why: "Cheap insurance while you still do not trust the vehicle." },
  { step: "Start the data log and note the run number, ballast and trim positions.", why: "An unlabelled run is unusable data." },
  { step: "Keep mains-powered equipment away from the water and on an RCD.", why: "Electrical safety at the poolside is the highest-consequence risk on the project." },
];

export const FAULT_RESPONSES: { fault: string; detection: string; response: string }[] = [
  { fault: "Leak detected", detection: "Leak probe conductivity above threshold", response: "Immediately command maximum positive buoyancy, log continuously, surface and hold. Do not attempt to continue the mission." },
  { fault: "Depth limit exceeded", detection: "Depth sensor above limit, or elapsed-time backstop", response: "Command maximum positive buoyancy and surface. Log the depth trace for diagnosis." },
  { fault: "Actuator stall", detection: "Motor current above threshold for longer than a set time, or no limit-switch trigger within the expected travel time", response: "Stop the motor to protect the driver, reverse briefly to unjam, then command positive buoyancy. If the retry fails, surface on whatever buoyancy is available." },
  { fault: "Limit switch not reached", detection: "Travel time-out with no switch transition", response: "Stop, assume position is unknown, home against the opposite switch, and abort the mission if homing fails." },
  { fault: "Battery low", detection: "Pack voltage below the reserve threshold", response: "Abort the mission with enough energy left for one full ascent. Reserve that energy explicitly rather than discovering it is gone." },
  { fault: "Depth sensor implausible", detection: "Reading jumps beyond a physically possible rate, or disagrees with the elapsed-time estimate", response: "Fall back to time-based control, surface, and flag the run as unusable for depth data." },
  { fault: "IMU not responding", detection: "Bus time-out or stale data", response: "Continue on depth control alone if that is enough; abort if the mission depends on attitude." },
  { fault: "Loss of surface communication", detection: "No acknowledgement within a set window at the surface", response: "Hold at the surface, keep the strobe on, and continue logging. Do not dive again — a vehicle you cannot talk to should stay where you can reach it." },
];

/** Structural pseudocode skeleton. Deliberately not compilable firmware. */
export function buildPseudocode(strategy: ControlStrategy, platform: string, engineConfig: string): string {
  const lines: string[] = [
    `// GliderForge control skeleton`,
    `// Platform (as stated by you): ${platform}`,
    `// Strategy: ${strategy.label}`,
    `// Buoyancy engine architecture: ${engineConfig}`,
    `//`,
    `// THIS IS A STRUCTURAL SKELETON, NOT WORKING FIRMWARE.`,
    `// Pin numbers, driver calls, sensor libraries, timing and every threshold`,
    `// below are placeholders. Nothing here has been compiled or run, and no`,
    `// control gain has been chosen for you — see the tuning note on this page.`,
    ``,
    `// ---- Configuration you must fill in -------------------------------`,
    `const PIN_MOTOR_PWM      = /* fill in */;`,
    `const PIN_MOTOR_DIR_A    = /* fill in */;`,
    `const PIN_MOTOR_DIR_B    = /* fill in */;`,
    `const PIN_LIMIT_RETRACT  = /* fill in */;`,
    `const PIN_LIMIT_EXTEND   = /* fill in */;`,
    `const PIN_LEAK           = /* fill in */;`,
    ``,
    `const DEPTH_TARGET_M     = /* from project settings */;`,
    `const DEPTH_LIMIT_M      = /* hard abort */;`,
    `const SURFACE_THRESH_M   = /* from project settings */;`,
    `const STROKE_TIMEOUT_MS  = /* > expected full-stroke time, with margin */;`,
    `const MOTOR_STALL_AMPS   = /* measured stall current, not datasheet */;`,
    `const BATTERY_RESERVE_V  = /* enough for one full ascent */;`,
    ``,
    `enum State { INIT, LEAK_CHECK, DIVE_PREP, DESCENDING, BOTTOM, CLIMB_PREP,`,
    `             ASCENDING, SURFACE_DETECT, TRANSMIT, FAULT, RECOVERY, DONE };`,
    `State state = INIT;`,
    ``,
    `void loop() {`,
    `  sensors.read();          // depth, leak, current, attitude, battery`,
    ``,
    `  // ---- Guards run BEFORE the state machine, every iteration -------`,
    `  if (sensors.leakDetected())            { enterRecovery("leak"); }`,
    `  if (sensors.depth_m > DEPTH_LIMIT_M)   { enterRecovery("depth limit"); }`,
    `  if (sensors.battery_V < BATTERY_RESERVE_V) { enterRecovery("battery reserve"); }`,
    `  if (motor.running() && motor.current_A > MOTOR_STALL_AMPS &&`,
    `      motor.runTime_ms() > STALL_DEBOUNCE_MS) { handleStall(); }`,
    ``,
    `  switch (state) {`,
    `    case INIT:`,
    `      depthSensor.zeroAtSurface();   // must happen at the surface`,
    `      buoyancy.home();               // home against a limit switch`,
    `      state = LEAK_CHECK; break;`,
    ``,
    `    case LEAK_CHECK:`,
    `      if (elapsedInState() > LEAK_CHECK_MS) state = DIVE_PREP;`,
    `      break;`,
    ``,
    `    case DIVE_PREP:`,
  ];

  if (strategy.id === "timed") {
    lines.push(
      `      buoyancy.runFor(DIVE_DIRECTION, DIVE_RUN_MS);`,
      `      // NOTE: delivered volume varies with battery voltage and depth.`,
      `      if (buoyancy.idle()) state = DESCENDING;`,
    );
  } else if (strategy.id === "limit-switch") {
    lines.push(
      `      buoyancy.driveToLimit(LIMIT_RETRACT);   // debounce the switch`,
      `      if (buoyancy.atLimit() || buoyancy.timedOut()) {`,
      `        if (buoyancy.timedOut()) enterFault("no limit switch");`,
      `        else state = DESCENDING;`,
      `      }`,
    );
  } else {
    lines.push(
      `      buoyancy.commandPosition(DIVE_POSITION_MM);`,
      `      if (buoyancy.atCommandedPosition()) state = DESCENDING;`,
    );
  }

  lines.push(
    `      break;`,
    ``,
    `    case DESCENDING:`,
  );

  if (strategy.id === "pid-depth") {
    lines.push(
      `      // Closed-loop depth hold. u is a commanded BUOYANCY, not a voltage.`,
      `      // Gains are NOT supplied: identify the vehicle's step response first.`,
      `      error = DEPTH_TARGET_M - sensors.depth_m;`,
      `      u = Kp*error + Ki*integral + Kd*derivative;   // add anti-windup`,
      `      u = clamp(u, U_MIN, U_MAX);                   // and a rate limit`,
      `      buoyancy.commandNetBuoyancy(u);`,
    );
  } else if (strategy.id === "pitch-feedback") {
    lines.push(
      `      // Trim mass holds the commanded glide angle.`,
      `      // Gains are NOT supplied: measure the pitch response first.`,
      `      pitchError = PITCH_TARGET_DEG - attitude.pitchFiltered();`,
      `      trimMass.commandPosition(trimMass.position() + Kp_pitch * pitchError);`,
    );
  }

  lines.push(
    `      if (sensors.depth_m >= DEPTH_TARGET_M) state = BOTTOM;`,
    `      break;`,
    ``,
    `    case BOTTOM:`,
    `      if (elapsedInState() > BOTTOM_DWELL_MS) state = CLIMB_PREP;`,
    `      break;`,
    ``,
    `    case CLIMB_PREP:`,
    `      // Mirror of DIVE_PREP in the opposite direction.`,
    `      if (buoyancy.ready()) state = ASCENDING;`,
    `      break;`,
    ``,
    `    case ASCENDING:`,
    `      if (sensors.depth_m <= SURFACE_THRESH_M) state = SURFACE_DETECT;`,
    `      break;`,
    ``,
    `    case SURFACE_DETECT:`,
    `      if (elapsedInState() > SURFACE_DWELL_MS) state = TRANSMIT;`,
    `      break;`,
    ``,
    `    case TRANSMIT:`,
    `      telemetry.send(log.summary());`,
    `      cyclesDone++;`,
    `      state = (cyclesDone >= CYCLES_COMMANDED) ? DONE : DIVE_PREP;`,
    `      break;`,
    ``,
    `    case RECOVERY:`,
    `      buoyancy.commandMaximumPositive();   // fail towards the surface`,
    `      if (sensors.depth_m <= SURFACE_THRESH_M) state = FAULT;`,
    `      break;`,
    ``,
    `    case FAULT:`,
    `    case DONE:`,
    `      motor.stop();`,
    `      beacon.on();`,
    `      log.flush();`,
    `      break;`,
    `  }`,
    ``,
    `  log.write(state, sensors, buoyancy.position());`,
    `}`,
    ``,
    `// Log every iteration. A run you cannot reconstruct afterwards is not a test.`,
  );

  return lines.join("\n");
}

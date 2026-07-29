import { glideEquilibrium } from "./hydro";
import { info, warn, type CalcWarning } from "./types";

/**
 * Mission / trajectory simulator.
 *
 * A transparent, explicit state machine stepped at a fixed time step. Every
 * state transition is recorded so that a plot of depth versus time can be read
 * alongside the reason the vehicle changed behaviour.
 *
 * The vehicle model is deliberately QUASI-STATIC: within a gliding state the
 * vehicle is assumed to be at its steady glide equilibrium immediately. That
 * is optimistic — a real vehicle spends the first seconds of each glide
 * accelerating, and a short dive may never reach equilibrium at all. An
 * optional first-order velocity lag is provided to expose how much that
 * matters.
 */

export type MissionState =
  | "initialization"
  | "leak_check"
  | "dive_prep"
  | "descending"
  | "bottom_transition"
  | "climb_prep"
  | "ascending"
  | "surface_detection"
  | "data_transmission"
  | "fault"
  | "recovery"
  | "complete";

export const STATE_DESCRIPTIONS: Record<MissionState, string> = {
  initialization: "Power-up, sensor self-test, zeroing the depth sensor at the surface.",
  leak_check: "Dwell at the surface reading the leak sensor before committing to a dive.",
  dive_prep: "Buoyancy engine driven to the negative state; vehicle still near-neutral while the actuator runs.",
  descending: "Steady negative-buoyancy glide towards the target depth.",
  bottom_transition: "Target depth reached; dwell before reversing the buoyancy engine.",
  climb_prep: "Buoyancy engine driven to the positive state.",
  ascending: "Steady positive-buoyancy glide towards the surface.",
  surface_detection: "Near-surface dwell to confirm the vehicle has surfaced.",
  data_transmission: "Radio or telemetry burst at the surface.",
  fault: "A limit was violated. The vehicle holds this state until the run ends.",
  recovery: "Emergency positive buoyancy commanded; ascend and hold at the surface.",
  complete: "All commanded cycles finished.",
};

export interface MissionInput {
  /** Time step, s. */
  dtSI: number;
  /** Hard stop on simulated time, s. */
  maxTimeSI: number;
  initialDepthSI: number;
  targetDepthSI: number;
  /** Depth at or above which the vehicle counts as surfaced, m. */
  surfaceThresholdSI: number;
  cycles: number;

  /** Net buoyancy force in the dive state (negative = sinks), N. */
  diveNetBuoyancySI: number;
  /** Net buoyancy force in the climb state (positive = rises), N. */
  climbNetBuoyancySI: number;

  waterDensitySI: number;
  referenceAreaSI: number;
  liftCoefficient: number;
  dragCoefficient: number;

  /** Time for the buoyancy engine to move between states, s. */
  actuationTimeSI: number;
  /** Dwell at the bottom of a cycle, s. */
  bottomDwellSI: number;
  /** Dwell at the surface, s. */
  surfaceDwellSI: number;
  leakCheckTimeSI: number;
  initializationTimeSI: number;
  transmitTimeSI: number;

  /** Horizontal water current, m/s, positive along +x. */
  currentVelocitySI: number;

  /** Usable battery energy, J. */
  batteryEnergySI: number;
  /** Always-on hotel load, W. */
  hotelPowerSI: number;
  /** Extra power while the actuator runs, W. */
  actuatorPowerSI: number;
  /** Extra power while transmitting, W. */
  transmitPowerSI: number;
  /** Extra power while a sensor package is sampling during glide, W. */
  sensorPowerSI: number;

  /** Depth beyond which the run is declared a fault, m. */
  depthLimitSI: number;
  /** Optional first-order velocity response time constant, s. 0 disables. */
  velocityTimeConstantSI?: number;
}

export interface MissionSample {
  t: number;
  depth: number;
  x: number;
  state: MissionState;
  verticalSpeed: number;
  horizontalSpeed: number;
  netBuoyancy: number;
  power: number;
  energyUsed: number;
  stateOfCharge: number;
  cycle: number;
}

export interface MissionEvent {
  t: number;
  from: MissionState;
  to: MissionState;
  reason: string;
}

export interface MissionResult {
  samples: MissionSample[];
  events: MissionEvent[];
  warnings: CalcWarning[];
  summary: {
    completedCycles: number;
    requestedCycles: number;
    durationS: number;
    maxDepthM: number;
    horizontalDistanceM: number;
    energyUsedJ: number;
    energyRemainingJ: number;
    finalState: MissionState;
    diveSpeedMS: number;
    climbSpeedMS: number;
    diveGlideAngleDeg: number;
    climbGlideAngleDeg: number;
    averageCycleTimeS: number;
    energyPerCycleJ: number;
    limitViolations: string[];
  };
  equations: string[];
  assumptions: string[];
}

export function simulateMission(input: MissionInput): MissionResult {
  const warnings: CalcWarning[] = [];
  const limitViolations: string[] = [];

  const dt = input.dtSI > 0 ? input.dtSI : 0.1;
  if (input.dtSI <= 0) warnings.push(warn("Time step was not positive; 0.1 s was used."));

  const diveGlide = glideEquilibrium({
    netBuoyancyForceSI: input.diveNetBuoyancySI,
    densitySI: input.waterDensitySI,
    referenceAreaSI: input.referenceAreaSI,
    liftCoefficient: input.liftCoefficient,
    dragCoefficient: input.dragCoefficient,
    descending: true,
    coefficientSource: "user",
  });
  const climbGlide = glideEquilibrium({
    netBuoyancyForceSI: input.climbNetBuoyancySI,
    densitySI: input.waterDensitySI,
    referenceAreaSI: input.referenceAreaSI,
    liftCoefficient: input.liftCoefficient,
    dragCoefficient: input.dragCoefficient,
    descending: false,
    coefficientSource: "user",
  });
  warnings.push(...diveGlide.warnings.filter((w) => w.severity === "error"));
  warnings.push(...climbGlide.warnings.filter((w) => w.severity === "error"));

  const diveVz = Math.abs(diveGlide.values.verticalSpeed.value); // downward magnitude
  const diveVx = diveGlide.values.horizontalSpeed.value;
  const climbVz = Math.abs(climbGlide.values.verticalSpeed.value);
  const climbVx = climbGlide.values.horizontalSpeed.value;

  if (!(diveVz > 0)) {
    warnings.push({
      severity: "error",
      message:
        "The dive state produces no downward speed. Check that the dive net buoyancy is non-zero and that the drag coefficient is positive — the vehicle cannot begin a mission.",
    });
  }
  if (!(climbVz > 0)) {
    warnings.push({
      severity: "error",
      message: "The climb state produces no upward speed; the vehicle would never return to the surface.",
    });
  }

  const tau = input.velocityTimeConstantSI ?? 0;

  let t = 0;
  let depth = input.initialDepthSI;
  let x = 0;
  let energy = 0;
  let cycle = 0;
  // Annotated via `as` rather than a type annotation so TypeScript keeps the
  // full union: the variable is reassigned inside the transition() closure.
  let state = "initialization" as MissionState;
  let stateT = 0;
  let vz = 0;
  let vx = 0;

  const samples: MissionSample[] = [];
  const events: MissionEvent[] = [];
  let completedCycles = 0;
  let maxDepth = depth;
  const cycleStartTimes: number[] = [];

  const transition = (to: MissionState, reason: string) => {
    events.push({ t, from: state, to, reason });
    state = to;
    stateT = 0;
  };

  const powerFor = (s: MissionState): number => {
    let p = input.hotelPowerSI;
    if (s === "dive_prep" || s === "climb_prep" || s === "recovery") p += input.actuatorPowerSI;
    if (s === "data_transmission") p += input.transmitPowerSI;
    if (s === "descending" || s === "ascending") p += input.sensorPowerSI;
    return p;
  };

  const targetVelocity = (s: MissionState): { vz: number; vx: number; fnet: number } => {
    if (s === "descending") return { vz: -diveVz, vx: diveVx, fnet: input.diveNetBuoyancySI };
    if (s === "ascending" || s === "recovery") return { vz: climbVz, vx: climbVx, fnet: input.climbNetBuoyancySI };
    return { vz: 0, vx: 0, fnet: 0 };
  };

  const maxSteps = Math.ceil(input.maxTimeSI / dt) + 1;
  let steps = 0;

  while (t <= input.maxTimeSI && steps < maxSteps) {
    steps++;
    const target = targetVelocity(state);
    if (tau > 0) {
      const alpha = 1 - Math.exp(-dt / tau);
      vz += (target.vz - vz) * alpha;
      vx += (target.vx - vx) * alpha;
    } else {
      vz = target.vz;
      vx = target.vx;
    }

    const p = powerFor(state);
    energy += p * dt;
    const soc = input.batteryEnergySI > 0 ? Math.max(0, 1 - energy / input.batteryEnergySI) : 0;

    samples.push({
      t,
      depth,
      x,
      state,
      verticalSpeed: vz,
      horizontalSpeed: vx + input.currentVelocitySI,
      netBuoyancy: target.fnet,
      power: p,
      energyUsed: energy,
      stateOfCharge: soc,
      cycle,
    });

    // --- integrate ---
    depth = Math.max(0, depth - vz * dt); // depth is positive downwards
    x += (vx + input.currentVelocitySI) * dt;
    maxDepth = Math.max(maxDepth, depth);
    t += dt;
    stateT += dt;

    // --- limits ---
    if (state !== "fault" && state !== "complete" && state !== "recovery") {
      if (depth > input.depthLimitSI) {
        limitViolations.push(`Depth limit of ${input.depthLimitSI} m exceeded at t = ${t.toFixed(1)} s (reached ${depth.toFixed(2)} m).`);
        transition("fault", `Depth exceeded the ${input.depthLimitSI} m limit`);
        continue;
      }
      if (input.batteryEnergySI > 0 && energy >= input.batteryEnergySI) {
        limitViolations.push(`Battery energy exhausted at t = ${t.toFixed(1)} s.`);
        transition("fault", "Battery energy exhausted");
        continue;
      }
    }

    // --- state machine ---
    switch (state) {
      case "initialization":
        if (stateT >= input.initializationTimeSI) transition("leak_check", "Initialisation complete");
        break;
      case "leak_check":
        if (stateT >= input.leakCheckTimeSI) {
          cycleStartTimes.push(t);
          transition("dive_prep", "Leak check passed");
        }
        break;
      case "dive_prep":
        if (stateT >= input.actuationTimeSI) transition("descending", "Buoyancy engine at dive state");
        break;
      case "descending":
        if (depth >= input.targetDepthSI) transition("bottom_transition", `Target depth of ${input.targetDepthSI} m reached`);
        break;
      case "bottom_transition":
        if (stateT >= input.bottomDwellSI) transition("climb_prep", "Bottom dwell complete");
        break;
      case "climb_prep":
        if (stateT >= input.actuationTimeSI) transition("ascending", "Buoyancy engine at climb state");
        break;
      case "ascending":
        if (depth <= input.surfaceThresholdSI) transition("surface_detection", `Surface threshold of ${input.surfaceThresholdSI} m reached`);
        break;
      case "surface_detection":
        if (stateT >= input.surfaceDwellSI) transition("data_transmission", "Surface confirmed");
        break;
      case "data_transmission":
        if (stateT >= input.transmitTimeSI) {
          completedCycles++;
          cycle = completedCycles;
          if (completedCycles >= input.cycles) {
            transition("complete", `All ${input.cycles} cycles complete`);
          } else {
            cycleStartTimes.push(t);
            transition("dive_prep", `Cycle ${completedCycles} complete, starting cycle ${completedCycles + 1}`);
          }
        }
        break;
      case "recovery":
        if (depth <= input.surfaceThresholdSI) transition("fault", "Recovered to the surface after a fault");
        break;
      case "fault":
      case "complete":
        break;
    }

    if (state === "complete" || state === "fault") {
      // Record one final sample then stop.
      samples.push({
        t,
        depth,
        x,
        state,
        verticalSpeed: 0,
        horizontalSpeed: input.currentVelocitySI,
        netBuoyancy: 0,
        power: input.hotelPowerSI,
        energyUsed: energy,
        stateOfCharge: input.batteryEnergySI > 0 ? Math.max(0, 1 - energy / input.batteryEnergySI) : 0,
        cycle,
      });
      break;
    }
  }

  if (steps >= maxSteps && state !== "complete" && state !== "fault") {
    limitViolations.push(`Simulation reached the ${input.maxTimeSI} s time limit in state "${state}" without completing ${input.cycles} cycles.`);
    warnings.push(warn(`The mission did not finish within the ${input.maxTimeSI} s simulated window. Either the cycles take longer than expected or the vehicle is stuck in a state.`));
  }

  const cycleTimes: number[] = [];
  for (let i = 1; i < cycleStartTimes.length; i++) cycleTimes.push(cycleStartTimes[i] - cycleStartTimes[i - 1]);
  const avgCycle = cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : NaN;

  if (completedCycles < input.cycles) {
    warnings.push(
      warn(`Only ${completedCycles} of the ${input.cycles} requested cycles completed. See the limit violations for why.`),
    );
  }
  if (input.batteryEnergySI > 0 && energy / input.batteryEnergySI > 0.8) {
    warnings.push(
      warn(`The mission consumes ${((energy / input.batteryEnergySI) * 100).toFixed(0)}% of the usable battery energy, leaving little reserve for recovery or an unplanned extra cycle.`),
    );
  }
  if (tau === 0) {
    warnings.push(
      info(
        "Velocity was applied instantaneously at each state change (no acceleration transient). For short dives this overstates the distance covered. Set a velocity time constant to see the sensitivity — a value of a few seconds is typical for a small vehicle whose added mass is comparable to its own mass.",
      ),
    );
  }

  return {
    samples,
    events,
    warnings,
    summary: {
      completedCycles,
      requestedCycles: input.cycles,
      durationS: t,
      maxDepthM: maxDepth,
      horizontalDistanceM: x,
      energyUsedJ: energy,
      energyRemainingJ: Math.max(0, input.batteryEnergySI - energy),
      finalState: state,
      diveSpeedMS: diveGlide.values.speed.value,
      climbSpeedMS: climbGlide.values.speed.value,
      diveGlideAngleDeg: (diveGlide.values.glidePathAngle.value * 180) / Math.PI,
      climbGlideAngleDeg: (climbGlide.values.glidePathAngle.value * 180) / Math.PI,
      averageCycleTimeS: avgCycle,
      energyPerCycleJ: completedCycles > 0 ? energy / completedCycles : NaN,
      limitViolations,
    },
    equations: [
      "V = sqrt(2|F_net| / (rho*S*sqrt(C_L^2+C_D^2)))",
      "tan(gamma) = C_D/C_L",
      "depth(t+dt) = depth(t) - V_z*dt",
      "E(t+dt) = E(t) + P(state)*dt",
    ],
    assumptions: [
      "Each gliding state is at its steady equilibrium speed; no acceleration transient unless a velocity time constant is set.",
      "The buoyancy engine reaches its commanded state after a fixed actuation time, with no partial-stroke behaviour in between.",
      "Water density, current and drag coefficients are constant over the whole mission.",
      "Depth is measured positive downwards from the free surface; the surface is flat.",
      "Power in each state is constant.",
      "No control system: the vehicle follows the state machine open-loop, with depth as the only trigger.",
    ],
  };
}

/** CSV export of the mission time history. */
export function missionToCsv(result: MissionResult): string {
  const header = [
    "time_s",
    "depth_m",
    "horizontal_position_m",
    "state",
    "vertical_speed_m_per_s",
    "horizontal_speed_m_per_s",
    "net_buoyancy_N",
    "power_W",
    "energy_used_J",
    "state_of_charge_fraction",
    "cycle",
  ].join(",");
  const rows = result.samples.map((s) =>
    [
      s.t.toFixed(3),
      s.depth.toFixed(4),
      s.x.toFixed(4),
      s.state,
      s.verticalSpeed.toFixed(5),
      s.horizontalSpeed.toFixed(5),
      s.netBuoyancy.toFixed(5),
      s.power.toFixed(4),
      s.energyUsed.toFixed(3),
      s.stateOfCharge.toFixed(5),
      s.cycle,
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

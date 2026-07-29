import { qty, type Quantity } from "@/lib/units";
import { G_STANDARD } from "@/lib/reference/water";
import { err, info, requireFinite, warn, type CalcResult, type CalcWarning } from "./types";

/**
 * Buoyancy-engine architecture.
 *
 * These arrangements are NOT physically equivalent and the application never
 * treats them as such. The sign of the buoyancy change, whether vehicle mass
 * changes, and whether ambient pressure helps or fights the actuator all
 * differ between them.
 */
export type EngineConfig =
  | "external-plunger" // plunger travels out of the barrel into the water: external displaced volume changes, mass fixed
  | "internal-ballast" // ambient water is drawn INTO a tank inside the sealed hull: mass changes, external volume fixed
  | "external-bladder" // carried fluid is pushed OUT into a flexible external bladder: external volume changes, total mass fixed
  | "piston-separator" // a piston separates carried fluid from ambient; the wetted face moves the external envelope
  | "combined"; // user states that both mass and displaced volume change

export interface EngineArchitecture {
  config: EngineConfig;
  label: string;
  /** Does extending the actuator increase the vehicle's displaced volume? */
  changesDisplacedVolume: boolean;
  /** Does actuation change the total vehicle mass? */
  changesMass: boolean;
  /**
   * Sign of dF_net/dV_stroke for the "extend"/"fill" direction, where
   * V_stroke is the swept volume. +1 = extending makes the vehicle more
   * buoyant, -1 = extending makes it heavier.
   */
  extendSign: 1 | -1;
  /** Which stroke direction has to work against ambient hydrostatic pressure. */
  pressureOpposedStroke: "extend" | "retract";
  description: string;
  schematicNotes: string[];
}

export const ARCHITECTURES: Record<EngineConfig, EngineArchitecture> = {
  "external-plunger": {
    config: "external-plunger",
    label: "External plunger (displacement change)",
    changesDisplacedVolume: true,
    changesMass: false,
    extendSign: 1,
    pressureOpposedStroke: "extend",
    description:
      "The plunger is driven outward so that part of it, or a moving end cap, protrudes into the water. The vehicle's external envelope grows by the swept volume while its mass stays constant, so buoyancy increases. Retracting shrinks the envelope and the vehicle sinks.",
    schematicNotes: [
      "Vehicle mass is CONSTANT. Only displaced volume changes.",
      "Extending works AGAINST ambient pressure: the actuator must push the wetted face out against P_ambient.",
      "The moving face must be sealed to the hull; the seal sees the full depth pressure differential.",
      "Because mass is constant, the CG barely moves, but the CB shifts towards the moving face.",
    ],
  },
  "internal-ballast": {
    config: "internal-ballast",
    label: "Internal ballast tank (mass change)",
    changesDisplacedVolume: false,
    changesMass: true,
    extendSign: -1,
    pressureOpposedStroke: "retract",
    description:
      "The syringe draws ambient water through a port into a tank inside the sealed hull. External envelope volume is unchanged; vehicle mass increases by rho_water * V, so the vehicle becomes negatively buoyant. Expelling the water restores buoyancy.",
    schematicNotes: [
      "External displaced volume is CONSTANT. Only vehicle mass changes.",
      "Ambient pressure HELPS the intake stroke and FIGHTS the discharge stroke — size the motor for discharge at maximum depth.",
      "Water inside the hull is a leak-tolerance and electrical hazard: keep the tank sealed from electronics and add a leak sensor in the bay.",
      "The added water mass moves the CG towards the tank. That trim shift is real and must be included in the stability check.",
    ],
  },
  "external-bladder": {
    config: "external-bladder",
    label: "External bladder (displacement change)",
    changesDisplacedVolume: true,
    changesMass: false,
    extendSign: 1,
    pressureOpposedStroke: "extend",
    description:
      "A carried working fluid (typically oil) is pumped from a rigid internal reservoir into a flexible bladder outside the hull. The total mass of the vehicle is unchanged, but the external envelope grows by the transferred volume, so buoyancy increases.",
    schematicNotes: [
      "Vehicle mass is CONSTANT — the fluid never leaves the vehicle.",
      "Inflating works AGAINST ambient pressure plus the bladder's own elastic back-pressure.",
      "A slack bladder is essentially at ambient pressure; a taut or over-filled one adds significant back-pressure that this model only includes if you enter it.",
      "Bladder compliance means the delivered volume change is not exactly the swept volume. Verify by displacement test.",
    ],
  },
  "piston-separator": {
    config: "piston-separator",
    label: "Piston separating internal and external fluid",
    changesDisplacedVolume: true,
    changesMass: false,
    extendSign: 1,
    pressureOpposedStroke: "extend",
    description:
      "A free or driven piston separates carried fluid from ambient water inside a through-hull cylinder. Moving the piston changes how much of the cylinder is occupied by ambient water versus carried fluid, changing the external displaced volume at constant mass.",
    schematicNotes: [
      "Vehicle mass is CONSTANT provided ambient water does not enter the hull.",
      "The piston sees the full pressure differential across its face.",
      "Dead volume and any trapped air on the dry side are compressible and reduce delivered volume with depth.",
    ],
  },
  combined: {
    config: "combined",
    label: "Combined mass and displacement change",
    changesDisplacedVolume: true,
    changesMass: true,
    extendSign: 1,
    pressureOpposedStroke: "extend",
    description:
      "The mechanism changes both the vehicle's mass and its displaced volume. Both effects must be entered separately; they can partly cancel, which is a common cause of an engine with far less authority than expected.",
    schematicNotes: [
      "Both mass and displaced volume change — enter the fraction of the swept volume that goes to each.",
      "If water is taken in AND the envelope grows by the same volume, the net buoyancy change is ZERO. Check the signs carefully.",
    ],
  },
};

export interface SyringeInput {
  config: EngineConfig;
  /** Syringe barrel internal diameter, m. */
  boreDiameterSI: number;
  /** Plunger (piston) diameter, m. Defaults to bore diameter. */
  plungerDiameterSI?: number;
  /** Mechanical maximum stroke, m. */
  maxStrokeSI: number;
  /** Stroke actually usable between limit switches, m. */
  usableStrokeSI?: number;
  /** Dead volume at full retraction that never participates, m^3. */
  deadVolumeSI?: number;

  /** Water density, kg/m^3. */
  waterDensitySI: number;
  gravitySI?: number;
  /** Operating depth for the pressure case, m. */
  depthSI: number;
  /** Pressure at the water surface, Pa. Default 1 atm. */
  surfacePressureSI?: number;
  /** Pressure inside the vehicle / on the dry side of the piston, Pa. */
  internalPressureSI?: number;

  /** Measured or estimated static friction of the plunger + seals, N. */
  frictionForceSI?: number;
  /** Overall mechanism efficiency (0..1), excluding the lead screw. */
  mechanismEfficiency?: number;

  /** Lead screw travel per revolution, m/rev. */
  leadSI?: number;
  /** Lead screw efficiency (0..1). */
  screwEfficiency?: number;
  /** Gear reduction between motor and screw (motor rev per screw rev). */
  gearRatio?: number;
  gearEfficiency?: number;

  /** Motor rated / stall torque available at the motor shaft, N*m. */
  motorTorqueSI?: number;
  /** Motor speed at that operating point, rad/s. */
  motorSpeedSI?: number;
  motorCurrentSI?: number;
  supplyVoltageSI?: number;

  /** Design safety factor applied to the required actuator force. */
  safetyFactor?: number;

  /** Target buoyancy change the engine must deliver, N. Optional. */
  targetBuoyancyForceSI?: number;
  /** Fractions for the "combined" architecture. */
  combinedMassFraction?: number;
  combinedVolumeFraction?: number;
  /** Number of syringes operating in parallel. */
  syringeCount?: number;
}

export interface SyringeValues extends Record<string, Quantity | undefined> {
  pistonArea: Quantity;
  volumePerStroke: Quantity;
  usableVolumeChange: Quantity;
  volumePerMm: Quantity;
  buoyancyForceChange: Quantity;
  buoyancyMassChange: Quantity;
  hydrostaticPressure: Quantity;
  pressureDifferential: Quantity;
  pressureForce: Quantity;
  frictionForce: Quantity;
  requiredActuatorForce: Quantity;
  designActuatorForce: Quantity;
  idealScrewTorque?: Quantity;
  designScrewTorque?: Quantity;
  requiredMotorTorque?: Quantity;
  requiredMotorSpeed?: Quantity;
  actuationTime?: Quantity;
  mechanicalWorkPerStroke: Quantity;
  electricalEnergyPerStroke?: Quantity;
  estimatedPower?: Quantity;
  energyPerCycle?: Quantity;
  stallMargin?: Quantity;
  maxFeasibleDepth?: Quantity;
  requiredStrokeForTarget?: Quantity;
}

export function computeSyringeEngine(input: SyringeInput): CalcResult<SyringeValues> {
  const warnings: CalcWarning[] = [];
  const arch = ARCHITECTURES[input.config];
  const g = input.gravitySI ?? G_STANDARD;
  const surfaceP = input.surfacePressureSI ?? 101325;
  const internalP = input.internalPressureSI ?? surfaceP;
  const nSyringes = input.syringeCount && input.syringeCount > 0 ? input.syringeCount : 1;

  requireFinite(warnings, "Bore diameter", input.boreDiameterSI, { min: 1e-4, max: 1, field: "boreDiameterSI" });
  requireFinite(warnings, "Maximum stroke", input.maxStrokeSI, { min: 0, allowZero: true, field: "maxStrokeSI" });
  requireFinite(warnings, "Water density", input.waterDensitySI, { min: 1, max: 2000, field: "waterDensitySI" });
  requireFinite(warnings, "Depth", input.depthSI, { min: 0, allowZero: true, field: "depthSI" });

  const bore = input.boreDiameterSI;
  const plungerD = input.plungerDiameterSI ?? bore;
  if (input.plungerDiameterSI !== undefined && Math.abs(plungerD - bore) / bore > 0.05) {
    warnings.push(
      warn(
        `Plunger diameter (${(plungerD * 1000).toFixed(2)} mm) differs from the bore (${(bore * 1000).toFixed(2)} mm) by more than 5%. The swept volume is computed from the BORE; a plunger that much smaller than the bore will not seal.`,
        "plungerDiameterSI",
      ),
    );
  }

  const area = (Math.PI / 4) * bore * bore;
  const areaTotal = area * nSyringes;
  const maxStroke = input.maxStrokeSI;
  const usableStroke = input.usableStrokeSI ?? maxStroke;
  const deadVolume = input.deadVolumeSI ?? 0;

  if (usableStroke > maxStroke + 1e-12) {
    warnings.push(
      err(
        `Usable stroke (${(usableStroke * 1000).toFixed(1)} mm) exceeds the mechanical maximum stroke (${(maxStroke * 1000).toFixed(1)} mm). The plunger would hit the end of the barrel.`,
        "usableStrokeSI",
      ),
    );
  }
  if (usableStroke === 0) {
    warnings.push(
      err("Usable stroke is zero, so the engine delivers no buoyancy change at all.", "usableStrokeSI"),
    );
  }

  const volumePerStroke = areaTotal * maxStroke;
  const usableVolume = areaTotal * usableStroke;
  const volumePerMm = areaTotal * 1e-3; // m^3 per mm of stroke

  if (deadVolume > 0 && deadVolume > volumePerStroke * 0.5) {
    warnings.push(
      warn(
        `Dead volume (${(deadVolume * 1e6).toFixed(1)} cm^3) is more than half the swept volume. Dead volume does no useful work and, if it contains air, it compresses with depth and reduces the delivered volume change.`,
        "deadVolumeSI",
      ),
    );
  }

  // ---- Buoyancy authority -------------------------------------------------
  const rho = input.waterDensitySI;
  let effectiveVolumeForBuoyancy = usableVolume;
  let massChangePerStroke = 0;
  if (input.config === "combined") {
    const fv = input.combinedVolumeFraction ?? 1;
    const fm = input.combinedMassFraction ?? 0;
    effectiveVolumeForBuoyancy = usableVolume * (fv - fm);
    massChangePerStroke = rho * usableVolume * fm;
    warnings.push(
      info(
        `Combined architecture: the displaced-volume share (${(fv * 100).toFixed(0)}%) and the mass share (${(fm * 100).toFixed(0)}%) partly cancel. Net authority corresponds to ${(((fv - fm) * 100)).toFixed(0)}% of the swept volume.`,
      ),
    );
    if (Math.abs(fv - fm) < 0.05) {
      warnings.push(
        err(
          "With these fractions the mass change and the displacement change almost exactly cancel, so the engine has essentially no buoyancy authority. Re-check the architecture.",
        ),
      );
    }
  } else if (arch.changesMass) {
    massChangePerStroke = rho * usableVolume;
  }

  const buoyancyForceChange = rho * g * Math.abs(effectiveVolumeForBuoyancy);
  const buoyancyMassChange = buoyancyForceChange / g;

  // ---- Pressure and force -------------------------------------------------
  const hydrostatic = surfaceP + rho * g * input.depthSI;
  const deltaP = hydrostatic - internalP;
  const pressureForce = Math.abs(deltaP) * areaTotal;
  const friction = input.frictionForceSI ?? 0;
  if (input.frictionForceSI === undefined) {
    warnings.push(
      warn(
        "No plunger/seal friction was entered, so friction is taken as ZERO. For a rubber-tipped disposable syringe, breakaway friction of a few newtons is common and can dominate at shallow depth. Measure it with a spring scale (see the 'Syringe friction' test template) before sizing the motor.",
        "frictionForceSI",
      ),
    );
  }
  const mechEff = clamp01(input.mechanismEfficiency ?? 1, warnings, "mechanismEfficiency");
  const requiredForce = (pressureForce + friction) / (mechEff || 1);
  const sf = input.safetyFactor ?? 1;
  if (sf < 1) {
    warnings.push(err("Safety factor is below 1. That would size the actuator smaller than the computed load.", "safetyFactor"));
  }
  const designForce = requiredForce * sf;

  // ---- Lead screw / motor -------------------------------------------------
  const lead = input.leadSI;
  const screwEff = clamp01(input.screwEfficiency ?? 0.3, warnings, "screwEfficiency");
  const gearRatio = input.gearRatio && input.gearRatio > 0 ? input.gearRatio : 1;
  const gearEff = clamp01(input.gearEfficiency ?? 1, warnings, "gearEfficiency");

  let idealScrewTorque: number | undefined;
  let designScrewTorque: number | undefined;
  let requiredMotorTorque: number | undefined;
  if (lead !== undefined && Number.isFinite(lead) && lead > 0) {
    idealScrewTorque = (designForce * lead) / (2 * Math.PI);
    designScrewTorque = idealScrewTorque / (screwEff || 1);
    requiredMotorTorque = designScrewTorque / (gearRatio * (gearEff || 1));
    if (input.screwEfficiency === undefined) {
      warnings.push(
        warn(
          "Lead-screw efficiency was not supplied; 0.30 was assumed. Efficiency of a small ACME/trapezoidal screw running dry is commonly 0.2-0.4 and a ball screw 0.85-0.95. This single number changes the required torque by a factor of three — confirm it or measure it.",
          "screwEfficiency",
        ),
      );
    }
  } else {
    warnings.push(
      info("No lead-screw lead entered, so torque requirements cannot be computed. Enter the screw lead (travel per revolution) to size the motor."),
    );
  }

  // ---- Timing and energy --------------------------------------------------
  let actuationTime: number | undefined;
  let requiredMotorSpeed: number | undefined;
  if (input.motorSpeedSI !== undefined && lead && lead > 0 && input.motorSpeedSI > 0) {
    const screwOmega = input.motorSpeedSI / gearRatio; // rad/s at the screw
    const linearSpeed = (screwOmega / (2 * Math.PI)) * lead; // m/s
    actuationTime = linearSpeed > 0 ? usableStroke / linearSpeed : undefined;
  }

  const mechanicalWork = designForce * usableStroke;
  let electricalEnergy: number | undefined;
  let power: number | undefined;
  if (input.supplyVoltageSI !== undefined && input.motorCurrentSI !== undefined) {
    power = input.supplyVoltageSI * input.motorCurrentSI;
    if (actuationTime !== undefined) electricalEnergy = power * actuationTime;
  } else if (actuationTime !== undefined && actuationTime > 0) {
    // Fall back to mechanical work / efficiency chain, clearly labelled.
    const chainEff = (screwEff || 1) * (gearEff || 1) * (mechEff || 1);
    electricalEnergy = mechanicalWork / (chainEff || 1);
    power = electricalEnergy / actuationTime;
    warnings.push(
      info(
        "Motor voltage and current were not supplied, so electrical energy is estimated as mechanical work divided by the drivetrain efficiency chain. This ignores motor copper losses and no-load current and will UNDER-estimate real consumption, often by a factor of two or more.",
      ),
    );
  }
  const energyPerCycle = electricalEnergy !== undefined ? electricalEnergy * 2 : undefined;

  // ---- Margins ------------------------------------------------------------
  let stallMargin: number | undefined;
  let maxDepth: number | undefined;
  if (input.motorTorqueSI !== undefined && requiredMotorTorque !== undefined && requiredMotorTorque > 0) {
    stallMargin = input.motorTorqueSI / requiredMotorTorque;
    if (stallMargin < 1) {
      warnings.push(
        err(
          `The motor cannot drive this stroke at ${input.depthSI} m: available torque ${(input.motorTorqueSI * 1000).toFixed(1)} mN*m is only ${(stallMargin * 100).toFixed(0)}% of the ${(requiredMotorTorque * 1000).toFixed(1)} mN*m required. The actuator will stall.`,
        ),
      );
    } else if (stallMargin < 1.5) {
      warnings.push(
        warn(
          `Stall margin is only ${stallMargin.toFixed(2)}. Motor torque falls with temperature and battery sag, and seal friction rises as the syringe ages. Aim for at least 1.5-2.0.`,
        ),
      );
    }
  }
  if (input.motorTorqueSI !== undefined && lead && lead > 0) {
    // Force the drivetrain can actually deliver at the plunger.
    const forceCapability =
      (2 * Math.PI * input.motorTorqueSI * gearRatio * (gearEff || 1) * (screwEff || 1) * (mechEff || 1)) / lead;
    const pressureAllowance = forceCapability / (sf || 1) - friction;
    if (pressureAllowance > 0) {
      const dpMax = pressureAllowance / areaTotal;
      maxDepth = (dpMax - (surfaceP - internalP)) / (rho * g);
      if (maxDepth < input.depthSI) {
        warnings.push(
          err(
            `Maximum feasible depth for this drivetrain is about ${maxDepth.toFixed(1)} m, below the ${input.depthSI} m operating depth requested.`,
          ),
        );
      }
    } else {
      maxDepth = 0;
      warnings.push(err("The drivetrain cannot even overcome the entered friction at the surface."));
    }
  }

  // ---- Target-driven sizing ----------------------------------------------
  let requiredStroke: number | undefined;
  if (input.targetBuoyancyForceSI !== undefined && input.targetBuoyancyForceSI > 0) {
    const requiredVolume = input.targetBuoyancyForceSI / (rho * g);
    requiredStroke = requiredVolume / areaTotal;
    if (requiredStroke > usableStroke + 1e-12) {
      warnings.push(
        err(
          `To deliver ${input.targetBuoyancyForceSI.toFixed(3)} N of buoyancy change this bore needs ${(requiredStroke * 1000).toFixed(1)} mm of stroke, but only ${(usableStroke * 1000).toFixed(1)} mm is usable. Increase the bore, the stroke, or the number of syringes.`,
        ),
      );
    }
  }

  const steps = [
    {
      label: "Piston area",
      equation: "A_p = pi/4 * D_bore^2" + (nSyringes > 1 ? "  (x N syringes)" : ""),
      substitution: `A_p = pi/4 * (${(bore * 1000).toFixed(3)} mm)^2${nSyringes > 1 ? ` * ${nSyringes}` : ""}`,
      result: `A_p = ${(areaTotal * 1e6).toPrecision(5)} mm^2 = ${areaTotal.toExponential(4)} m^2`,
    },
    {
      label: "Swept volume per unit stroke",
      equation: "dV/dx = A_p",
      result: `${(volumePerMm * 1e6).toPrecision(4)} cm^3 per mm of stroke`,
    },
    {
      label: "Usable volume change",
      equation: "dV = A_p * x_usable",
      substitution: `dV = ${areaTotal.toExponential(4)} m^2 * ${(usableStroke * 1000).toFixed(2)} mm`,
      result: `dV = ${(usableVolume * 1e6).toPrecision(5)} cm^3`,
    },
    {
      label: `Buoyancy authority (${arch.label})`,
      equation: arch.changesMass && !arch.changesDisplacedVolume
        ? "dF_net = -rho * g * dV   (water taken in adds mass; displaced volume unchanged)"
        : "dF_B = rho * g * dV",
      substitution: `= ${rho.toFixed(1)} kg/m^3 * ${g} m/s^2 * ${Math.abs(effectiveVolumeForBuoyancy).toExponential(4)} m^3`,
      result: `|dF| = ${buoyancyForceChange.toPrecision(4)} N  (equivalent to ${(buoyancyMassChange * 1000).toPrecision(4)} g of ballast)`,
      note: arch.changesMass
        ? `This architecture changes vehicle MASS by ${(massChangePerStroke * 1000).toFixed(1)} g over the full stroke. That mass shift also moves the CG — check the stability page.`
        : "This architecture changes displaced VOLUME at constant mass.",
    },
    {
      label: "Hydrostatic pressure at depth",
      equation: "P = P_surface + rho * g * h",
      substitution: `P = ${(surfaceP / 1000).toFixed(2)} kPa + ${rho.toFixed(1)} * ${g} * ${input.depthSI} m`,
      result: `P = ${(hydrostatic / 1000).toPrecision(5)} kPa absolute (${((hydrostatic - surfaceP) / 1000).toPrecision(4)} kPa gauge)`,
    },
    {
      label: "Pressure force on the plunger face",
      equation: "F_P = dP * A_p,  dP = P_ambient - P_internal",
      substitution: `F_P = ${(deltaP / 1000).toPrecision(5)} kPa * ${areaTotal.toExponential(4)} m^2`,
      result: `F_P = ${pressureForce.toPrecision(4)} N`,
      note: `For this architecture the ${arch.pressureOpposedStroke.toUpperCase()} stroke works against this pressure; the other direction is assisted by it.`,
    },
    {
      label: "Required actuator force",
      equation: "F_req = (F_P + F_friction) / eta_mech",
      substitution: `F_req = (${pressureForce.toPrecision(4)} + ${friction.toPrecision(4)}) / ${mechEff}`,
      result: `F_req = ${requiredForce.toPrecision(4)} N`,
    },
    {
      label: "Design actuator force (with safety factor)",
      equation: "F_design = SF * F_req",
      substitution: `F_design = ${sf} * ${requiredForce.toPrecision(4)} N`,
      result: `F_design = ${designForce.toPrecision(4)} N`,
    },
  ];

  if (idealScrewTorque !== undefined) {
    steps.push(
      {
        label: "Ideal lead-screw torque (frictionless)",
        equation: "T_ideal = F * L / (2*pi)",
        substitution: `T_ideal = ${designForce.toPrecision(4)} N * ${((lead as number) * 1000).toFixed(2)} mm / (2*pi)`,
        result: `T_ideal = ${((idealScrewTorque as number) * 1000).toPrecision(4)} mN*m`,
        note: "This is a lower bound only. A real screw is nowhere near frictionless.",
      },
      {
        label: "Design screw torque",
        equation: "T_screw = T_ideal / eta_screw",
        substitution: `T_screw = ${((idealScrewTorque as number) * 1000).toPrecision(4)} mN*m / ${screwEff}`,
        result: `T_screw = ${((designScrewTorque as number) * 1000).toPrecision(4)} mN*m`,
      },
      {
        label: "Required motor torque",
        equation: "T_motor = T_screw / (G * eta_gear)",
        substitution: `T_motor = ${((designScrewTorque as number) * 1000).toPrecision(4)} mN*m / (${gearRatio} * ${gearEff})`,
        result: `T_motor = ${((requiredMotorTorque as number) * 1000).toPrecision(4)} mN*m`,
      },
    );
  }
  if (actuationTime !== undefined) {
    steps.push({
      label: "Actuation time for the usable stroke",
      equation: "t = x / v,  v = (omega_motor / G) / (2*pi) * L",
      result: `t = ${actuationTime.toPrecision(4)} s`,
    });
  }
  steps.push({
    label: "Mechanical work per stroke",
    equation: "W = F_design * x_usable  (constant-force approximation)",
    substitution: `W = ${designForce.toPrecision(4)} N * ${usableStroke.toPrecision(4)} m`,
    result: `W = ${mechanicalWork.toPrecision(4)} J`,
    note: "Constant force is a reasonable approximation at fixed depth. During a real dive the depth, and hence the pressure force, changes through the stroke.",
  });

  const assumptions = [
    {
      text: `Architecture: ${arch.label}. ${arch.description}`,
      basis: "User-selected. The buoyancy sign, mass behaviour and pressure-opposed stroke direction all follow from this choice.",
    },
    {
      text: "The swept volume equals the delivered volume change.",
      basis:
        "Ignores fluid compressibility, trapped air, bladder compliance and barrel expansion under pressure. Verify with a displacement test.",
    },
    {
      text: `Internal (dry-side) pressure is ${(internalP / 1000).toFixed(1)} kPa absolute and constant.`,
      basis:
        input.internalPressureSI === undefined
          ? "Defaulted to the surface pressure — correct for a rigid hull sealed at the surface, wrong if the hull is pressure-compensated."
          : "User-entered.",
    },
    {
      text: "Friction is a single constant force independent of speed, depth and stroke position.",
      basis:
        "A simplification. Real syringe seals show a high breakaway force followed by lower sliding friction, and stiction grows with dwell time.",
    },
    {
      text: "Quasi-static actuation: plunger and fluid inertia are neglected.",
      basis: "Valid for the slow strokes (seconds) typical of a buoyancy engine; not valid for fast actuation.",
    },
  ];

  return {
    id: "syringe.sizing",
    title: `Syringe buoyancy engine — ${arch.label}`,
    values: {
      pistonArea: qty(areaTotal, "m^2"),
      volumePerStroke: qty(volumePerStroke, "m^3"),
      usableVolumeChange: qty(usableVolume, "m^3"),
      volumePerMm: qty(volumePerMm, "m^3"),
      buoyancyForceChange: qty(buoyancyForceChange, "N"),
      buoyancyMassChange: qty(buoyancyMassChange, "kg"),
      hydrostaticPressure: qty(hydrostatic, "Pa"),
      pressureDifferential: qty(deltaP, "Pa"),
      pressureForce: qty(pressureForce, "N"),
      frictionForce: qty(friction, "N", input.frictionForceSI === undefined ? "assumed" : "user"),
      requiredActuatorForce: qty(requiredForce, "N"),
      designActuatorForce: qty(designForce, "N"),
      idealScrewTorque: idealScrewTorque !== undefined ? qty(idealScrewTorque, "N*m") : undefined,
      designScrewTorque: designScrewTorque !== undefined ? qty(designScrewTorque, "N*m") : undefined,
      requiredMotorTorque: requiredMotorTorque !== undefined ? qty(requiredMotorTorque, "N*m") : undefined,
      requiredMotorSpeed: requiredMotorSpeed !== undefined ? qty(requiredMotorSpeed, "rad/s") : undefined,
      actuationTime: actuationTime !== undefined ? qty(actuationTime, "s") : undefined,
      mechanicalWorkPerStroke: qty(mechanicalWork, "J"),
      electricalEnergyPerStroke: electricalEnergy !== undefined ? qty(electricalEnergy, "J") : undefined,
      estimatedPower: power !== undefined ? qty(power, "W") : undefined,
      energyPerCycle: energyPerCycle !== undefined ? qty(energyPerCycle, "J") : undefined,
      stallMargin: stallMargin !== undefined ? qty(stallMargin, "-") : undefined,
      maxFeasibleDepth: maxDepth !== undefined ? qty(maxDepth, "m") : undefined,
      requiredStrokeForTarget: requiredStroke !== undefined ? qty(requiredStroke, "m") : undefined,
    },
    steps,
    equations: [
      "A_p = pi/4 * D^2",
      "dV = A_p * x",
      "dF_B = rho * g * dV",
      "P = P_surface + rho*g*h",
      "F_P = dP * A_p",
      "T_ideal = F*L/(2*pi)",
      "T_screw = T_ideal / eta_screw",
    ],
    assumptions,
    warnings,
    inputs: { ...input, gravitySI: g, surfacePressureSI: surfaceP, internalPressureSI: internalP },
    confidence: input.frictionForceSI === undefined || input.screwEfficiency === undefined ? "low" : "medium",
    limitations: [
      "This is a quasi-static force/torque balance, not a dynamic simulation of the drivetrain.",
      "Motor torque-speed behaviour, driver current limits and thermal derating are not modelled.",
      "Seal friction dominates the load at shallow depth and is the least reliable number here. Measure it.",
    ],
  };
}

function clamp01(v: number, warnings: CalcWarning[], field: string): number {
  if (!Number.isFinite(v)) {
    warnings.push(err(`${field} must be a number between 0 and 1.`, field));
    return 1;
  }
  if (v <= 0 || v > 1) {
    warnings.push(err(`${field} = ${v} is outside the physical range 0 < eta <= 1.`, field));
    return Math.min(1, Math.max(1e-6, v));
  }
  return v;
}

/* ------------------------------------------------------------------ */
/* Detailed lead-screw torque (Acme / trapezoidal thread)              */
/* ------------------------------------------------------------------ */

export interface LeadScrewInput {
  /** Axial load, N. */
  loadSI: number;
  /** Screw lead (axial travel per revolution), m. */
  leadSI: number;
  /** Mean (pitch) diameter of the thread, m. */
  meanDiameterSI: number;
  /** Coefficient of friction between screw and nut. */
  frictionCoefficient: number;
  /** Thread half-angle, radians. Acme = 14.5 deg, metric trapezoidal = 15 deg, square = 0. */
  threadHalfAngle: number;
  /** Collar/thrust-bearing friction coefficient. Optional. */
  collarFriction?: number;
  /** Mean collar diameter, m. Optional. */
  collarDiameterSI?: number;
}

export interface LeadScrewResult {
  raiseTorqueSI: number;
  lowerTorqueSI: number;
  collarTorqueSI: number;
  totalRaiseTorqueSI: number;
  efficiency: number;
  selfLocking: boolean;
  warnings: CalcWarning[];
  steps: { label: string; equation: string; result: string }[];
}

/**
 * Power-screw torque from the classical relation (Shigley, "Mechanical
 * Engineering Design", power-screw chapter):
 *
 *   T_raise = F*d_m/2 * (L + pi*mu*d_m*sec(alpha)) / (pi*d_m - mu*L*sec(alpha))
 *   T_lower = F*d_m/2 * (pi*mu*d_m*sec(alpha) - L) / (pi*d_m + mu*L*sec(alpha))
 *
 * The screw is self-locking (will not back-drive under load) when
 * pi*mu*d_m > L*cos(alpha).
 */
export function leadScrewTorque(input: LeadScrewInput): LeadScrewResult {
  const warnings: CalcWarning[] = [];
  const { loadSI: F, leadSI: L, meanDiameterSI: dm, frictionCoefficient: mu, threadHalfAngle: alpha } = input;

  requireFinite(warnings, "Axial load", F, { min: 0, allowZero: true });
  requireFinite(warnings, "Lead", L, { min: 1e-6 });
  requireFinite(warnings, "Mean diameter", dm, { min: 1e-4 });
  requireFinite(warnings, "Friction coefficient", mu, { min: 0, max: 1, allowZero: true });

  const sec = 1 / Math.cos(alpha);
  const denomRaise = Math.PI * dm - mu * L * sec;
  if (denomRaise <= 0) {
    warnings.push(err("Thread geometry and friction give a non-physical (negative) denominator; check the mean diameter, lead and friction coefficient."));
  }
  const raise = ((F * dm) / 2) * ((L + Math.PI * mu * dm * sec) / denomRaise);
  const lower = ((F * dm) / 2) * ((Math.PI * mu * dm * sec - L) / (Math.PI * dm + mu * L * sec));

  const collarMu = input.collarFriction ?? 0;
  const collarD = input.collarDiameterSI ?? 0;
  const collarTorque = (F * collarMu * collarD) / 2;

  const idealTorque = (F * L) / (2 * Math.PI);
  const efficiency = raise > 0 ? idealTorque / raise : 0;
  const selfLocking = Math.PI * mu * dm > L * Math.cos(alpha);

  if (!selfLocking) {
    warnings.push(
      warn(
        "This screw is NOT self-locking: an external load can back-drive it. For a buoyancy engine that means hydrostatic pressure could push the plunger back when power is removed. Either add a brake/worm stage or hold position with the motor (which costs energy).",
      ),
    );
  }
  if (efficiency > 0.5 && mu > 0.05) {
    warnings.push(info(`Computed screw efficiency is ${(efficiency * 100).toFixed(0)}%, which is high for a sliding-contact screw. Confirm the friction coefficient.`));
  }

  return {
    raiseTorqueSI: raise,
    lowerTorqueSI: lower,
    collarTorqueSI: collarTorque,
    totalRaiseTorqueSI: raise + collarTorque,
    efficiency,
    selfLocking,
    warnings,
    steps: [
      {
        label: "Raising torque (load opposes motion)",
        equation: "T_R = F*d_m/2 * (L + pi*mu*d_m*sec(a)) / (pi*d_m - mu*L*sec(a))",
        result: `${(raise * 1000).toPrecision(4)} mN*m`,
      },
      {
        label: "Lowering torque",
        equation: "T_L = F*d_m/2 * (pi*mu*d_m*sec(a) - L) / (pi*d_m + mu*L*sec(a))",
        result: `${(lower * 1000).toPrecision(4)} mN*m ${lower < 0 ? "(negative: the load drives the screw back)" : ""}`,
      },
      {
        label: "Collar / thrust bearing torque",
        equation: "T_c = F * mu_c * d_c / 2",
        result: `${(collarTorque * 1000).toPrecision(4)} mN*m`,
      },
      {
        label: "Screw efficiency",
        equation: "eta = (F*L/2*pi) / T_R",
        result: `${(efficiency * 100).toFixed(1)} %`,
      },
      {
        label: "Self-locking check",
        equation: "pi*mu*d_m > L*cos(a) ?",
        result: selfLocking ? "Self-locking" : "NOT self-locking — can back-drive",
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Parameter sweep                                                     */
/* ------------------------------------------------------------------ */

export interface SweepPoint {
  variable: number;
  usableVolumeCm3: number;
  buoyancyForceN: number;
  requiredForceN: number;
  motorTorqueMNm?: number;
  actuationTimeS?: number;
  energyPerStrokeJ?: number;
  maxDepthM?: number;
  feasible: boolean;
}

export function sweepSyringe(
  base: SyringeInput,
  variable: "boreDiameterSI" | "maxStrokeSI" | "depthSI" | "leadSI",
  values: number[],
): SweepPoint[] {
  return values.map((v) => {
    const input: SyringeInput = { ...base, [variable]: v };
    if (variable === "maxStrokeSI") input.usableStrokeSI = v;
    const r = computeSyringeEngine(input);
    return {
      variable: v,
      usableVolumeCm3: (r.values.usableVolumeChange?.value ?? 0) * 1e6,
      buoyancyForceN: r.values.buoyancyForceChange?.value ?? 0,
      requiredForceN: r.values.designActuatorForce?.value ?? 0,
      motorTorqueMNm: r.values.requiredMotorTorque ? r.values.requiredMotorTorque.value * 1000 : undefined,
      actuationTimeS: r.values.actuationTime?.value,
      energyPerStrokeJ: r.values.electricalEnergyPerStroke?.value,
      maxDepthM: r.values.maxFeasibleDepth?.value,
      feasible: !r.warnings.some((w) => w.severity === "error"),
    };
  });
}

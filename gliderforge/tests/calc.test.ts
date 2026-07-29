import { describe, it, expect } from "vitest";
import { computeBuoyancy, solveForNeutral } from "@/lib/calc/buoyancy";
import { computeMassProperties, type CalcComponent } from "@/lib/calc/massprops";
import { computeStability, solveTrim } from "@/lib/calc/stability";
import { computeSyringeEngine, leadScrewTorque, ARCHITECTURES, sweepSyringe } from "@/lib/calc/syringe";
import { hydrostaticPressure, cylinderExternalPressure, flatEndCap, oRingGland } from "@/lib/calc/pressure";
import { reynoldsNumber, dragBuildup, glideEquilibrium, estimateHullWettedArea, liftCurveSlope } from "@/lib/calc/hydro";
import { computePowerBudget, type PowerLoad } from "@/lib/calc/power";
import { simulateMission, missionToCsv } from "@/lib/calc/mission";
import { propagate, quadrature } from "@/lib/calc/uncertainty";
import { waterDensity, pureWaterDensity, G_STANDARD } from "@/lib/reference/water";

const G = G_STANDARD;
const hasError = (r: { warnings: { severity: string }[] }) => r.warnings.some((w) => w.severity === "error");

/* ================================================================== */
/* Archimedes buoyancy                                                 */
/* ================================================================== */

describe("Archimedes buoyancy", () => {
  it("matches a hand calculation for 2.0 L displaced in fresh water", () => {
    // Hand calc: F_B = 1000 * 9.80665 * 0.002 = 19.6133 N
    //            W   = 1.8 * 9.80665         = 17.65197 N
    //            F_net                        = 1.96133 N
    const r = computeBuoyancy({ displacedVolumeSI: 0.002, waterDensitySI: 1000, massSI: 1.8 });
    expect(r.values.buoyantForce.value).toBeCloseTo(19.6133, 4);
    expect(r.values.weight.value).toBeCloseTo(17.65197, 5);
    expect(r.values.netBuoyantForce.value).toBeCloseTo(1.96133, 5);
    expect(r.values.netBuoyantMass.value).toBeCloseTo(0.2, 10);
    expect(r.values.averageDensity.value).toBeCloseTo(900, 9);
  });

  it("gives exactly zero net force at neutral buoyancy", () => {
    const r = computeBuoyancy({ displacedVolumeSI: 0.0025, waterDensitySI: 998.2, massSI: 0.0025 * 998.2 });
    expect(r.values.netBuoyantForce.value).toBeCloseTo(0, 12);
    expect(r.values.averageDensity.value).toBeCloseTo(998.2, 9);
    expect(r.warnings.some((w) => /neutral/i.test(w.message))).toBe(true);
  });

  it("is more buoyant in salt water than fresh for the same vehicle", () => {
    const fresh = computeBuoyancy({ displacedVolumeSI: 0.003, waterDensitySI: 998.2, massSI: 3.0 });
    const salt = computeBuoyancy({ displacedVolumeSI: 0.003, waterDensitySI: 1025.0, massSI: 3.0 });
    expect(salt.values.netBuoyantForce.value).toBeGreaterThan(fresh.values.netBuoyantForce.value);
    // Difference = (1025 - 998.2) * 9.80665 * 0.003 = 0.78846 N
    expect(salt.values.netBuoyantForce.value - fresh.values.netBuoyantForce.value).toBeCloseTo(
      (1025 - 998.2) * G * 0.003,
      9,
    );
  });

  it("flags zero volume and zero mass as errors rather than returning a silent zero", () => {
    const r = computeBuoyancy({ displacedVolumeSI: 0, waterDensitySI: 1000, massSI: 0 });
    expect(hasError(r)).toBe(true);
    expect(r.warnings.filter((w) => w.severity === "error").length).toBeGreaterThanOrEqual(2);
  });

  it("rejects impossible negative inputs", () => {
    const r = computeBuoyancy({ displacedVolumeSI: -0.001, waterDensitySI: 1000, massSI: 1 });
    expect(hasError(r)).toBe(true);
  });

  it("rejects a non-physical water density", () => {
    const r = computeBuoyancy({ displacedVolumeSI: 0.001, waterDensitySI: 50_000, massSI: 1 });
    expect(hasError(r)).toBe(true);
  });

  it("solves for the ballast needed to reach neutral", () => {
    const input = { displacedVolumeSI: 0.002, waterDensitySI: 1000, massSI: 1.8 };
    const s = solveForNeutral(input);
    expect(s.massChangeSI).toBeCloseTo(0.2, 12); // add 200 g
    // Or reduce displacement by 200 cm^3
    expect(s.volumeChangeSI).toBeCloseTo(-0.0002, 15);
  });
});

/* ================================================================== */
/* Water properties                                                    */
/* ================================================================== */

describe("water density (EOS-80)", () => {
  it("reproduces the pure-water maximum near 4 degC", () => {
    const d0 = pureWaterDensity(0);
    const d4 = pureWaterDensity(4);
    const d10 = pureWaterDensity(10);
    expect(d4).toBeGreaterThan(d0);
    expect(d4).toBeGreaterThan(d10);
    expect(d4).toBeCloseTo(999.97, 1);
  });

  it("gives standard published values within the correlation's stated accuracy", () => {
    // Widely tabulated: pure water at 20 degC is 998.2 kg/m^3, at 25 degC 997.0
    expect(waterDensity({ temperatureC: 20, salinityPSU: 0 }).densitySI).toBeCloseTo(998.2, 1);
    expect(waterDensity({ temperatureC: 25, salinityPSU: 0 }).densitySI).toBeCloseTo(997.0, 1);
    // Seawater S=35, T=15 is close to 1025.97 kg/m^3 in EOS-80 tables
    expect(waterDensity({ temperatureC: 15, salinityPSU: 35 }).densitySI).toBeCloseTo(1025.97, 1);
  });

  it("warns when extrapolated outside its validated range", () => {
    const r = waterDensity({ temperatureC: 90, salinityPSU: 0 });
    expect(r.extrapolated).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("rejects negative salinity", () => {
    const r = waterDensity({ temperatureC: 20, salinityPSU: -1 });
    expect(Number.isNaN(r.densitySI)).toBe(true);
  });
});

/* ================================================================== */
/* Mass properties, CG and CB                                          */
/* ================================================================== */

const comp = (over: Partial<CalcComponent>): CalcComponent => ({
  id: over.id ?? "c",
  name: over.name ?? "part",
  category: "structure",
  quantity: 1,
  displacementMode: "internal",
  position: { x: 0, y: 0, z: 0 },
  includeInBudget: true,
  ...over,
});

describe("centre of gravity", () => {
  it("puts the CG at the midpoint of two equal masses", () => {
    const r = computeMassProperties([
      comp({ id: "a", massSI: 1, position: { x: 0, y: 0, z: 0 } }),
      comp({ id: "b", massSI: 1, position: { x: 1, y: 0, z: 0 } }),
    ]);
    expect(r.cg.x).toBeCloseTo(0.5, 12);
    expect(r.values.totalMass.value).toBeCloseTo(2, 12);
  });

  it("weights the CG towards the heavier mass (hand calc)", () => {
    // (3*0 + 1*0.4)/4 = 0.1 m
    const r = computeMassProperties([
      comp({ id: "a", massSI: 3, position: { x: 0, y: 0, z: 0 } }),
      comp({ id: "b", massSI: 1, position: { x: 0.4, y: 0, z: 0 } }),
    ]);
    expect(r.cg.x).toBeCloseTo(0.1, 12);
  });

  it("respects component quantity and centre-of-mass offset", () => {
    const r = computeMassProperties([
      comp({ id: "a", massSI: 0.5, quantity: 4, position: { x: 0.2, y: 0, z: 0 }, comOffset: { x: 0.05, y: 0, z: 0 } }),
    ]);
    expect(r.values.totalMass.value).toBeCloseTo(2.0, 12);
    expect(r.cg.x).toBeCloseTo(0.25, 12);
  });

  it("treats a component with no mass as missing data, not as zero", () => {
    const r = computeMassProperties([
      comp({ id: "a", massSI: 1, position: { x: 0, y: 0, z: 0 } }),
      comp({ id: "b", position: { x: 1, y: 0, z: 0 } }),
    ]);
    expect(r.missingMass).toContain("part");
    expect(hasError(r)).toBe(true);
    expect(r.confidence).toBe("low");
  });

  it("excludes components not included in the budget", () => {
    const r = computeMassProperties([
      comp({ id: "a", massSI: 1, position: { x: 0, y: 0, z: 0 } }),
      comp({ id: "b", massSI: 99, position: { x: 1, y: 0, z: 0 }, includeInBudget: false }),
    ]);
    expect(r.values.totalMass.value).toBeCloseTo(1, 12);
  });

  it("rejects a negative mass", () => {
    const r = computeMassProperties([comp({ id: "a", massSI: -1 })]);
    expect(r.warnings.some((w) => w.severity === "error" && /negative mass/i.test(w.message))).toBe(true);
  });
});

describe("centre of buoyancy", () => {
  it("is the volume centroid and ignores mass entirely", () => {
    const r = computeMassProperties([
      comp({ id: "a", massSI: 10, displacedVolumeSI: 0.001, displacementMode: "hull", position: { x: 0, y: 0, z: 0 } }),
      comp({ id: "b", massSI: 0.001, displacedVolumeSI: 0.003, displacementMode: "external", position: { x: 1, y: 0, z: 0 } }),
    ]);
    // CB = (0.001*0 + 0.003*1)/0.004 = 0.75 m — independent of the 10 kg
    expect(r.cb.x).toBeCloseTo(0.75, 12);
  });

  it("does not count internal components as displacement", () => {
    const r = computeMassProperties([
      comp({ id: "hull", massSI: 1, displacedVolumeSI: 0.002, displacementMode: "hull", position: { x: 0.3, y: 0, z: 0 } }),
      comp({ id: "batt", massSI: 0.5, displacedVolumeSI: 0.0003, displacementMode: "internal", position: { x: 0.1, y: 0, z: 0 } }),
    ]);
    expect(r.values.totalDisplacedVolume.value).toBeCloseTo(0.002, 12);
    expect(r.cb.x).toBeCloseTo(0.3, 12);
    expect(r.warnings.some((w) => /deliberately NOT counted/.test(w.message))).toBe(true);
  });

  it("flags a missing displacement volume on a water-exposed component", () => {
    const r = computeMassProperties([
      comp({ id: "hull", massSI: 1, displacedVolumeSI: 0.002, displacementMode: "hull" }),
      comp({ id: "wing", name: "wing", massSI: 0.1, displacementMode: "external" }),
    ]);
    expect(r.missingVolume).toContain("wing");
  });

  it("flags an implausible implied density (unit error)", () => {
    // 100 g in what was typed as 0.05 m^3 but was meant to be 50 cm^3
    const r = computeMassProperties([
      comp({ id: "a", massSI: 0.1, displacedVolumeSI: 0.05, displacementMode: "external" }),
    ]);
    expect(r.warnings.some((w) => /unit error/i.test(w.message))).toBe(true);
  });

  it("returns NaN for the CB when nothing displaces, without crashing", () => {
    const r = computeMassProperties([comp({ id: "a", massSI: 1 })]);
    expect(Number.isNaN(r.cb.x)).toBe(true);
  });
});

/* ================================================================== */
/* Stability and trim                                                  */
/* ================================================================== */

describe("static stability", () => {
  it("computes the righting moment from rho*g*V*BG*sin(theta)", () => {
    const r = computeStability({
      cg: { x: 0.3, y: 0, z: 0.0 },
      cb: { x: 0.3, y: 0, z: 0.01 },
      displacedVolumeSI: 0.002,
      waterDensitySI: 1000,
      massSI: 2.0,
      evaluationAngleSI: Math.PI / 18, // 10 deg
    });
    const expected = 1000 * G * 0.002 * 0.01 * Math.sin(Math.PI / 18);
    expect(r.values.rightingMomentAtAngle.value).toBeCloseTo(expected, 9);
    expect(r.values.verticalSeparation.value).toBeCloseTo(0.01, 12);
  });

  it("declares an error when the CB is at or below the CG", () => {
    const r = computeStability({
      cg: { x: 0, y: 0, z: 0.02 },
      cb: { x: 0, y: 0, z: 0.01 },
      displacedVolumeSI: 0.002,
      waterDensitySI: 1000,
      massSI: 2,
    });
    expect(hasError(r)).toBe(true);
  });

  it("gives a nose-down attitude when the CB is aft of the CG", () => {
    // +x is forward, so CB aft means x_CB < x_CG -> negative (nose-down) pitch
    const r = computeStability({
      cg: { x: 0.30, y: 0, z: 0 },
      cb: { x: 0.28, y: 0, z: 0.02 },
      displacedVolumeSI: 0.002,
      waterDensitySI: 1000,
      massSI: 2,
    });
    expect(r.values.equilibriumPitch.value).toBeLessThan(0);
    // atan2(-0.02, 0.02) = -45 deg
    expect((r.values.equilibriumPitch.value * 180) / Math.PI).toBeCloseTo(-45, 6);
  });

  it("reports a lateral roll from a lateral CB-CG offset", () => {
    const r = computeStability({
      cg: { x: 0, y: 0, z: 0 },
      cb: { x: 0, y: 0.005, z: 0.02 },
      displacedVolumeSI: 0.002,
      waterDensitySI: 1000,
      massSI: 2,
    });
    expect(r.values.equilibriumRoll.value).toBeGreaterThan(0);
    expect(r.warnings.some((w) => /permanent roll/i.test(w.message))).toBe(true);
  });
});

describe("trim solver", () => {
  it("computes the component travel needed for a target pitch", () => {
    // Target 0 deg: need x_CG = x_CB = 0.30. Currently 0.28, so shift +0.02 m.
    // Battery is 0.5 kg of a 2 kg vehicle -> travel = 0.02 * 2/0.5 = 0.08 m
    const r = solveTrim(0, { cgX: 0.28, cbX: 0.3, verticalSeparationSI: 0.02, totalMassSI: 2 }, [
      { id: "b", name: "Battery", massSI: 0.5, positionX: 0.2, minX: 0.05, maxX: 0.45 },
    ]);
    expect(r.requiredCgShiftSI).toBeCloseTo(0.02, 12);
    expect(r.solutions[0].travelSI).toBeCloseTo(0.08, 12);
    expect(r.solutions[0].withinLimits).toBe(true);
  });

  it("reports when a component cannot reach the target within its travel", () => {
    const r = solveTrim(0, { cgX: 0.2, cbX: 0.3, verticalSeparationSI: 0.02, totalMassSI: 2 }, [
      { id: "b", name: "Battery", massSI: 0.05, positionX: 0.2, minX: 0.15, maxX: 0.25 },
    ]);
    expect(r.solutions[0].withinLimits).toBe(false);
    expect(hasError(r)).toBe(true);
  });

  it("always states that the solution is not unique", () => {
    const r = solveTrim(0, { cgX: 0.28, cbX: 0.3, verticalSeparationSI: 0.02, totalMassSI: 2 }, [
      { id: "b", name: "Battery", massSI: 0.5, positionX: 0.2, minX: 0, maxX: 0.5 },
    ]);
    expect(r.nonUniqueness).toMatch(/NOT a unique answer/);
  });

  it("refuses to trim when there is no vertical separation to trim against", () => {
    const r = solveTrim(0, { cgX: 0.28, cbX: 0.3, verticalSeparationSI: 0, totalMassSI: 2 }, []);
    expect(hasError(r)).toBe(true);
  });
});

/* ================================================================== */
/* Syringe buoyancy engine                                             */
/* ================================================================== */

const baseSyringe = {
  config: "external-plunger" as const,
  boreDiameterSI: 0.02,
  maxStrokeSI: 0.1,
  waterDensitySI: 1000,
  depthSI: 0,
  safetyFactor: 1,
  mechanismEfficiency: 1,
  frictionForceSI: 0,
};

describe("syringe volume and buoyancy change", () => {
  it("matches a hand calculation for a 20 mm bore, 100 mm stroke", () => {
    // A_p = pi/4 * 0.02^2 = 3.14159e-4 m^2
    // dV  = 3.14159e-4 * 0.1 = 3.14159e-5 m^3 = 31.416 cm^3
    // dF  = 1000 * 9.80665 * 3.141593e-5 = 0.3080850 N
    const r = computeSyringeEngine(baseSyringe);
    expect(r.values.pistonArea.value).toBeCloseTo(3.14159265e-4, 10);
    expect(r.values.usableVolumeChange.value).toBeCloseTo(3.14159265e-5, 12);
    expect(r.values.buoyancyForceChange.value).toBeCloseTo(0.3080850, 6);
    expect(r.values.buoyancyMassChange.value * 1000).toBeCloseTo(31.4159, 3);
  });

  it("scales swept volume with the square of the bore", () => {
    const a = computeSyringeEngine({ ...baseSyringe, boreDiameterSI: 0.02 });
    const b = computeSyringeEngine({ ...baseSyringe, boreDiameterSI: 0.04 });
    expect(b.values.usableVolumeChange.value / a.values.usableVolumeChange.value).toBeCloseTo(4, 9);
  });

  it("gives zero authority at zero stroke and says so", () => {
    const r = computeSyringeEngine({ ...baseSyringe, maxStrokeSI: 0, usableStrokeSI: 0 });
    expect(r.values.usableVolumeChange.value).toBe(0);
    expect(r.values.buoyancyForceChange.value).toBe(0);
    expect(hasError(r)).toBe(true);
  });

  it("rejects a usable stroke longer than the mechanical stroke", () => {
    const r = computeSyringeEngine({ ...baseSyringe, maxStrokeSI: 0.05, usableStrokeSI: 0.08 });
    expect(hasError(r)).toBe(true);
  });

  it("multiplies authority by the number of parallel syringes", () => {
    const one = computeSyringeEngine(baseSyringe);
    const two = computeSyringeEngine({ ...baseSyringe, syringeCount: 2 });
    expect(two.values.buoyancyForceChange.value / one.values.buoyancyForceChange.value).toBeCloseTo(2, 9);
  });
});

describe("buoyancy-engine architectures are not interchangeable", () => {
  it("changes vehicle mass for an internal ballast tank but not for an external plunger", () => {
    expect(ARCHITECTURES["internal-ballast"].changesMass).toBe(true);
    expect(ARCHITECTURES["internal-ballast"].changesDisplacedVolume).toBe(false);
    expect(ARCHITECTURES["external-plunger"].changesMass).toBe(false);
    expect(ARCHITECTURES["external-plunger"].changesDisplacedVolume).toBe(true);
    expect(ARCHITECTURES["external-bladder"].changesMass).toBe(false);
  });

  it("opposes the extend stroke with pressure for a plunger, and the retract stroke for a ballast tank", () => {
    expect(ARCHITECTURES["external-plunger"].pressureOpposedStroke).toBe("extend");
    expect(ARCHITECTURES["internal-ballast"].pressureOpposedStroke).toBe("retract");
  });

  it("reverses the sign of the buoyancy change for an internal ballast tank", () => {
    expect(ARCHITECTURES["external-plunger"].extendSign).toBe(1);
    expect(ARCHITECTURES["internal-ballast"].extendSign).toBe(-1);
  });

  it("detects a combined architecture whose mass and volume changes cancel", () => {
    const r = computeSyringeEngine({
      ...baseSyringe,
      config: "combined",
      combinedVolumeFraction: 1,
      combinedMassFraction: 1,
    });
    expect(r.values.buoyancyForceChange.value).toBeCloseTo(0, 12);
    expect(hasError(r)).toBe(true);
  });
});

describe("hydrostatic pressure and plunger force", () => {
  it("gives about 1 bar of gauge pressure per 10 m of fresh water", () => {
    const r = hydrostaticPressure({ depthSI: 10, waterDensitySI: 1000 });
    expect(r.values.gauge.value).toBeCloseTo(98066.5, 3);
    expect(r.values.absolute.value).toBeCloseTo(199391.5, 3);
  });

  it("equals the surface pressure at zero depth", () => {
    const r = hydrostaticPressure({ depthSI: 0, waterDensitySI: 1025 });
    expect(r.values.gauge.value).toBe(0);
    expect(r.values.absolute.value).toBeCloseTo(101325, 9);
  });

  it("computes plunger pressure force as dP * A_p (hand calc)", () => {
    // 20 mm bore at 5 m: dP = 1000*9.80665*5 = 49033.25 Pa
    // A_p = 3.14159265e-4 -> F = 15.404 N
    const r = computeSyringeEngine({ ...baseSyringe, depthSI: 5 });
    expect(r.values.pressureDifferential.value).toBeCloseTo(49033.25, 4);
    expect(r.values.pressureForce.value).toBeCloseTo(49033.25 * 3.14159265e-4, 6);
  });

  it("adds friction and applies the safety factor to the design force", () => {
    const r = computeSyringeEngine({ ...baseSyringe, depthSI: 5, frictionForceSI: 4, safetyFactor: 2, mechanismEfficiency: 0.8 });
    const pressureForce = 49033.25 * 3.14159265e-4;
    expect(r.values.requiredActuatorForce.value).toBeCloseTo((pressureForce + 4) / 0.8, 6);
    expect(r.values.designActuatorForce.value).toBeCloseTo(((pressureForce + 4) / 0.8) * 2, 6);
  });

  it("survives an extremely high pressure without producing nonsense", () => {
    const r = computeSyringeEngine({ ...baseSyringe, depthSI: 6000 });
    expect(Number.isFinite(r.values.pressureForce.value)).toBe(true);
    expect(r.values.pressureForce.value).toBeGreaterThan(1000);
  });
});

describe("lead screw torque", () => {
  it("computes the ideal torque as F*L/(2*pi)", () => {
    // F = 100 N (design), L = 2 mm -> T_ideal = 100*0.002/(2pi) = 0.031831 N*m
    const r = computeSyringeEngine({
      ...baseSyringe,
      depthSI: 0,
      frictionForceSI: 100,
      leadSI: 0.002,
      screwEfficiency: 1,
      gearRatio: 1,
      gearEfficiency: 1,
    });
    expect(r.values.idealScrewTorque!.value).toBeCloseTo(0.0318309886, 9);
  });

  it("divides by the screw efficiency to get the design torque", () => {
    const r = computeSyringeEngine({
      ...baseSyringe,
      frictionForceSI: 100,
      leadSI: 0.002,
      screwEfficiency: 0.25,
      gearRatio: 1,
      gearEfficiency: 1,
    });
    expect(r.values.designScrewTorque!.value).toBeCloseTo(0.0318309886 / 0.25, 9);
  });

  it("divides by the gear ratio to get the motor torque", () => {
    const r = computeSyringeEngine({
      ...baseSyringe,
      frictionForceSI: 100,
      leadSI: 0.002,
      screwEfficiency: 0.25,
      gearRatio: 10,
      gearEfficiency: 1,
    });
    expect(r.values.requiredMotorTorque!.value).toBeCloseTo(0.0318309886 / 0.25 / 10, 10);
  });

  it("computes the classical Acme power-screw torque and self-locking condition", () => {
    // Shigley-style: F=1000 N, L=5 mm, d_m=25 mm, mu=0.15, alpha=14.5 deg
    const r = leadScrewTorque({
      loadSI: 1000,
      leadSI: 0.005,
      meanDiameterSI: 0.025,
      frictionCoefficient: 0.15,
      threadHalfAngle: (14.5 * Math.PI) / 180,
    });
    const sec = 1 / Math.cos((14.5 * Math.PI) / 180);
    const expected =
      ((1000 * 0.025) / 2) * ((0.005 + Math.PI * 0.15 * 0.025 * sec) / (Math.PI * 0.025 - 0.15 * 0.005 * sec));
    expect(r.raiseTorqueSI).toBeCloseTo(expected, 9);
    expect(r.selfLocking).toBe(true);
    expect(r.efficiency).toBeGreaterThan(0);
    expect(r.efficiency).toBeLessThan(0.5);
  });

  it("warns when a coarse screw is not self-locking", () => {
    const r = leadScrewTorque({
      loadSI: 100,
      leadSI: 0.02,
      meanDiameterSI: 0.008,
      frictionCoefficient: 0.05,
      threadHalfAngle: 0,
    });
    expect(r.selfLocking).toBe(false);
    expect(r.warnings.some((w) => /back-drive/i.test(w.message))).toBe(true);
  });

  it("flags a stall when the motor cannot supply the required torque", () => {
    const r = computeSyringeEngine({
      ...baseSyringe,
      depthSI: 10,
      leadSI: 0.008,
      screwEfficiency: 0.3,
      motorTorqueSI: 0.001,
    });
    expect(r.values.stallMargin!.value).toBeLessThan(1);
    expect(hasError(r)).toBe(true);
  });

  it("reports a maximum feasible depth from the drivetrain capability", () => {
    const r = computeSyringeEngine({
      ...baseSyringe,
      depthSI: 3,
      leadSI: 0.002,
      screwEfficiency: 0.3,
      motorTorqueSI: 0.05,
      gearRatio: 1,
    });
    expect(r.values.maxFeasibleDepth!.value).toBeGreaterThan(0);
    expect(Number.isFinite(r.values.maxFeasibleDepth!.value)).toBe(true);
  });

  it("computes the stroke required for a target buoyancy change", () => {
    // Target 0.2 N -> V = 0.2/(1000*9.80665) = 2.0394e-5 m^3 -> x = V/A = 64.9 mm
    const r = computeSyringeEngine({ ...baseSyringe, targetBuoyancyForceSI: 0.2 });
    expect(r.values.requiredStrokeForTarget!.value).toBeCloseTo(0.2 / (1000 * G) / 3.14159265e-4, 6);
  });
});

describe("syringe parameter sweep", () => {
  it("produces a monotonic increase in volume with bore diameter", () => {
    const points = sweepSyringe(baseSyringe, "boreDiameterSI", [0.01, 0.02, 0.03, 0.04]);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].usableVolumeCm3).toBeGreaterThan(points[i - 1].usableVolumeCm3);
    }
  });

  it("increases the required force with depth", () => {
    const points = sweepSyringe(baseSyringe, "depthSI", [0, 5, 10, 20]);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].requiredForceN).toBeGreaterThan(points[i - 1].requiredForceN);
    }
  });
});

/* ================================================================== */
/* Structural checks                                                   */
/* ================================================================== */

describe("pressure housing checks", () => {
  const mat = { youngsModulusSI: 3e9, poissonsRatio: 0.35, yieldStrengthSI: 50e6, materialProvenance: "user" as const };

  it("computes hoop stress and the long-tube collapse pressure from the published formulas", () => {
    const r = cylinderExternalPressure({
      outerDiameterSI: 0.09,
      wallThicknessSI: 0.003,
      lengthSI: 0.4,
      externalPressureSI: 50000,
      safetyFactor: 2,
      ...mat,
    });
    const Rm = (0.09 - 0.003) / 2;
    expect(r.values.hoopStress.value).toBeCloseTo((50000 * Rm) / 0.003, 6);
    const tOverD = 0.003 / 0.09;
    expect(r.values.bucklingPressureLong.value).toBeCloseTo((2 * 3e9 / (1 - 0.35 ** 2)) * tOverD ** 3, 3);
  });

  it("always warns about imperfection sensitivity", () => {
    const r = cylinderExternalPressure({
      outerDiameterSI: 0.09, wallThicknessSI: 0.003, lengthSI: 0.4,
      externalPressureSI: 50000, safetyFactor: 2, ...mat,
    });
    expect(r.warnings.some((w) => /imperfection|out-of-round/i.test(w.message))).toBe(true);
    expect(r.limitations?.join(" ")).toMatch(/NOT a finite-element analysis/);
  });

  it("errors when the collapse margin is below the required factor of safety", () => {
    const r = cylinderExternalPressure({
      outerDiameterSI: 0.09, wallThicknessSI: 0.0005, lengthSI: 0.6,
      externalPressureSI: 300000, safetyFactor: 3, ...mat,
    });
    expect(hasError(r)).toBe(true);
  });

  it("warns when the thin-wall assumption is violated", () => {
    const r = cylinderExternalPressure({
      outerDiameterSI: 0.05, wallThicknessSI: 0.01, lengthSI: 0.2,
      externalPressureSI: 50000, safetyFactor: 2, ...mat,
    });
    expect(r.warnings.some((w) => /t\/D/.test(w.message))).toBe(true);
  });

  it("computes clamped flat-plate stress as 3qa^2/(4t^2)", () => {
    const r = flatEndCap({
      radiusSI: 0.04, thicknessSI: 0.006, pressureSI: 50000,
      youngsModulusSI: 3e9, poissonsRatio: 0.35, yieldStrengthSI: 50e6,
      edgeCondition: "clamped", safetyFactor: 2,
    });
    expect(r.values.maxStress.value).toBeCloseTo((3 * 50000 * 0.04 ** 2) / (4 * 0.006 ** 2), 6);
  });

  it("checks O-ring squeeze against the published band", () => {
    // 3 mm cord in a 2.2 mm deep gland -> 26.7% squeeze, inside the face-seal band
    const ok = oRingGland({
      cordDiameterSI: 0.003, glandDepthSI: 0.0022, glandWidthSI: 0.004,
      sealType: "face", externalPressureSI: 50000,
    });
    expect(ok.values.squeezeFraction.value).toBeCloseTo(0.26667, 4);
    expect(hasError(ok)).toBe(false);

    const tooLittle = oRingGland({
      cordDiameterSI: 0.003, glandDepthSI: 0.0029, glandWidthSI: 0.004,
      sealType: "face", externalPressureSI: 50000,
    });
    expect(hasError(tooLittle)).toBe(true);
  });
});

/* ================================================================== */
/* Hydrodynamics                                                       */
/* ================================================================== */

describe("Reynolds number", () => {
  it("matches a hand calculation", () => {
    // Re = 1000 * 0.3 * 0.6 / 1.002e-3 = 1.796e5
    const r = reynoldsNumber({ velocitySI: 0.3, characteristicLengthSI: 0.6, densitySI: 1000, dynamicViscositySI: 1.002e-3 });
    expect(r.values.reynolds.value).toBeCloseTo((1000 * 0.3 * 0.6) / 1.002e-3, 3);
  });

  it("is zero at zero velocity", () => {
    const r = reynoldsNumber({ velocitySI: 0, characteristicLengthSI: 0.6, densitySI: 1000, dynamicViscositySI: 1e-3 });
    expect(r.values.reynolds.value).toBe(0);
  });

  it("derives viscosity from temperature when not supplied", () => {
    const r = reynoldsNumber({ velocitySI: 0.3, characteristicLengthSI: 0.6, densitySI: 998, temperatureC: 20 });
    // Water at 20 degC is about 1.0e-3 Pa*s
    expect(r.values.dynamicViscosity.value).toBeGreaterThan(0.8e-3);
    expect(r.values.dynamicViscosity.value).toBeLessThan(1.2e-3);
  });
});

describe("drag buildup", () => {
  it("uses the ITTC-57 friction line above Re = 1e4", () => {
    const r = dragBuildup({
      velocitySI: 0.4, densitySI: 1000, dynamicViscositySI: 1e-3,
      hullLengthSI: 0.6, hullDiameterSI: 0.09, appendageDragAreaSI: 0,
    });
    const Re = (1000 * 0.4 * 0.6) / 1e-3;
    expect(r.values.frictionCoefficient.value).toBeCloseTo(0.075 / (Math.log10(Re) - 2) ** 2, 9);
  });

  it("computes the Hoerner form factor", () => {
    const dOverL = 0.09 / 0.6;
    const expected = 1 + 1.5 * dOverL ** 1.5 + 7 * dOverL ** 3;
    const r = dragBuildup({
      velocitySI: 0.4, densitySI: 1000, dynamicViscositySI: 1e-3,
      hullLengthSI: 0.6, hullDiameterSI: 0.09,
    });
    expect(r.values.formFactor.value).toBeCloseTo(expected, 9);
  });

  it("scales drag with the square of velocity", () => {
    const mk = (v: number) => dragBuildup({
      velocitySI: v, densitySI: 1000, dynamicViscositySI: 1e-3,
      hullLengthSI: 0.6, hullDiameterSI: 0.09, appendageDragAreaSI: 0.0001,
    }).values.totalDrag.value;
    // Not exactly 4x: the ITTC friction coefficient falls as Re rises. Between
    // 0.4 and 0.8 m/s on a 0.6 m hull, C_f drops by a factor of 0.843, so the
    // friction term scales by 4 x 0.843 = 3.37 while the fixed appendage drag
    // area scales by exactly 4. The total must land between the two.
    const ratio = mk(0.8) / mk(0.4);
    expect(ratio).toBeGreaterThan(3.3);
    expect(ratio).toBeLessThan(4.0);
  });

  it("warns loudly when no appendage drag allowance is entered", () => {
    const r = dragBuildup({ velocitySI: 0.4, densitySI: 1000, hullLengthSI: 0.6, hullDiameterSI: 0.09 });
    expect(r.warnings.some((w) => /appendage/i.test(w.message))).toBe(true);
  });

  it("estimates hull wetted area as a capsule", () => {
    // L=0.6, D=0.09: cylinder part 0.51 long -> pi*0.09*0.51 + 4*pi*0.045^2
    const expected = Math.PI * 0.09 * 0.51 + 4 * Math.PI * 0.045 ** 2;
    expect(estimateHullWettedArea(0.6, 0.09)).toBeCloseTo(expected, 12);
  });

  it("applies a calibration factor and says it did", () => {
    const base = dragBuildup({ velocitySI: 0.4, densitySI: 1000, hullLengthSI: 0.6, hullDiameterSI: 0.09, appendageDragAreaSI: 0 });
    const cal = dragBuildup({ velocitySI: 0.4, densitySI: 1000, hullLengthSI: 0.6, hullDiameterSI: 0.09, appendageDragAreaSI: 0, calibrationFactor: 1.4 });
    expect(cal.values.totalDrag.value / base.values.totalDrag.value).toBeCloseTo(1.4, 9);
    expect(cal.warnings.some((w) => /calibration factor/i.test(w.message))).toBe(true);
  });
});

describe("steady glide", () => {
  it("solves the equilibrium speed and glide angle (hand calc)", () => {
    // F=0.5 N, rho=1000, S=0.012, CL=0.4, CD=0.1
    // sqrt(CL^2+CD^2)=0.412311; V = sqrt(2*0.5/(1000*0.012*0.412311)) = 0.44975 m/s
    const r = glideEquilibrium({
      netBuoyancyForceSI: 0.5, densitySI: 1000, referenceAreaSI: 0.012,
      liftCoefficient: 0.4, dragCoefficient: 0.1, descending: true, coefficientSource: "user",
    });
    const mag = Math.sqrt(0.4 ** 2 + 0.1 ** 2);
    expect(r.values.speed.value).toBeCloseTo(Math.sqrt((2 * 0.5) / (1000 * 0.012 * mag)), 9);
    expect((r.values.glidePathAngle.value * 180) / Math.PI).toBeCloseTo((Math.atan(0.1 / 0.4) * 180) / Math.PI, 9);
    expect(r.values.glideRatio.value).toBeCloseTo(4, 12);
  });

  it("descends with a negative vertical speed and climbs with a positive one", () => {
    const common = { netBuoyancyForceSI: 0.5, densitySI: 1000, referenceAreaSI: 0.012, liftCoefficient: 0.4, dragCoefficient: 0.1, coefficientSource: "user" as const };
    expect(glideEquilibrium({ ...common, descending: true }).values.verticalSpeed.value).toBeLessThan(0);
    expect(glideEquilibrium({ ...common, descending: false }).values.verticalSpeed.value).toBeGreaterThan(0);
  });

  it("refuses to glide at zero net buoyancy", () => {
    const r = glideEquilibrium({
      netBuoyancyForceSI: 0, densitySI: 1000, referenceAreaSI: 0.012,
      liftCoefficient: 0.4, dragCoefficient: 0.1, descending: true, coefficientSource: "user",
    });
    expect(hasError(r)).toBe(true);
    expect(r.values.speed.value).toBe(0);
  });

  it("reports a vertical descent when there is no lift", () => {
    const r = glideEquilibrium({
      netBuoyancyForceSI: 0.5, densitySI: 1000, referenceAreaSI: 0.012,
      liftCoefficient: 0, dragCoefficient: 0.4, descending: true, coefficientSource: "user",
    });
    expect((r.values.glidePathAngle.value * 180) / Math.PI).toBeCloseTo(90, 9);
    expect(r.values.horizontalSpeed.value).toBeCloseTo(0, 12);
  });

  it("flags an implausibly high glide ratio", () => {
    const r = glideEquilibrium({
      netBuoyancyForceSI: 0.5, densitySI: 1000, referenceAreaSI: 0.012,
      liftCoefficient: 1.0, dragCoefficient: 0.02, descending: true, coefficientSource: "user",
    });
    expect(r.warnings.some((w) => /exceptional/i.test(w.message))).toBe(true);
  });

  it("labels assumed coefficients as such", () => {
    const r = glideEquilibrium({
      netBuoyancyForceSI: 0.5, densitySI: 1000, referenceAreaSI: 0.012,
      liftCoefficient: 0.4, dragCoefficient: 0.1, descending: true, coefficientSource: "assumed",
    });
    expect(r.warnings.some((w) => /ASSUMED/.test(w.message))).toBe(true);
  });

  it("gives the Helmbold lift slope tending to 2*pi at high aspect ratio", () => {
    expect(liftCurveSlope(100).perRad).toBeGreaterThan(5.9);
    expect(liftCurveSlope(100).perRad).toBeLessThan(2 * Math.PI);
    expect(liftCurveSlope(2).perRad).toBeLessThan(3.5);
  });
});

/* ================================================================== */
/* Power and endurance                                                 */
/* ================================================================== */

describe("power budget and battery endurance", () => {
  const loads: PowerLoad[] = [
    { id: "1", name: "MCU", subsystem: "controller", currentSI: 0.05, voltageSI: 5, dutyCycle: 1, provenance: "datasheet" },
    { id: "2", name: "Motor", subsystem: "actuator", currentSI: 1.0, voltageSI: 12, dutyCycle: 0.05, provenance: "measured" },
  ];

  it("computes average and peak power by hand", () => {
    // MCU: 0.25 W * 1.0 = 0.25 W;  Motor: 12 W * 0.05 = 0.6 W;  avg = 0.85 W
    const r = computePowerBudget(loads, {
      capacitySI: 9000, nominalVoltageSI: 11.1, usableFraction: 0.8, deratingFactor: 1,
      chemistry: "Li-ion", provenance: "datasheet",
    });
    expect(r.values.averagePower.value).toBeCloseTo(0.85, 9);
    expect(r.values.peakPower.value).toBeCloseTo(12.25, 9);
    expect(r.values.hotelPower.value).toBeCloseTo(0.25, 9);
    expect(r.values.actuatorPower.value).toBeCloseTo(0.6, 9);
  });

  it("computes endurance as usable energy over average power", () => {
    // E = 9000 C * 11.1 V * 0.8 * 1 = 79920 J; t = 79920/0.85 = 94023.5 s
    const r = computePowerBudget(loads, {
      capacitySI: 9000, nominalVoltageSI: 11.1, usableFraction: 0.8, deratingFactor: 1,
      chemistry: "Li-ion", provenance: "datasheet",
    });
    expect(r.values.usableEnergy.value).toBeCloseTo(79920, 6);
    expect(r.values.enduranceTime.value).toBeCloseTo(79920 / 0.85, 6);
  });

  it("accounts for regulator efficiency", () => {
    const r = computePowerBudget(
      [{ ...loads[0], regulatorEfficiency: 0.5 }],
      { capacitySI: 9000, nominalVoltageSI: 11.1, usableFraction: 0.8, deratingFactor: 1, chemistry: "Li-ion", provenance: "datasheet" },
    );
    expect(r.values.averagePower.value).toBeCloseTo(0.5, 9);
  });

  it("errors when there are no loads at all", () => {
    const r = computePowerBudget([], { capacitySI: 9000, nominalVoltageSI: 11.1, usableFraction: 0.8, deratingFactor: 1, chemistry: "x", provenance: "estimated" });
    expect(hasError(r)).toBe(true);
  });

  it("warns when 100% depth of discharge is assumed", () => {
    const r = computePowerBudget(loads, { capacitySI: 9000, nominalVoltageSI: 11.1, usableFraction: 1, deratingFactor: 1, chemistry: "x", provenance: "datasheet" });
    expect(r.warnings.some((w) => /100%/.test(w.message))).toBe(true);
  });

  it("ranks the breakdown by average power", () => {
    const r = computePowerBudget(loads, { capacitySI: 9000, nominalVoltageSI: 11.1, usableFraction: 0.8, deratingFactor: 1, chemistry: "x", provenance: "datasheet" });
    expect(r.breakdown[0].name).toBe("Motor");
    expect(r.breakdown[0].shareOfAverage).toBeCloseTo(0.6 / 0.85, 9);
  });
});

/* ================================================================== */
/* Mission simulation                                                  */
/* ================================================================== */

const baseMission = {
  dtSI: 0.1,
  maxTimeSI: 2000,
  initialDepthSI: 0,
  targetDepthSI: 2,
  surfaceThresholdSI: 0.1,
  cycles: 2,
  diveNetBuoyancySI: -0.3,
  climbNetBuoyancySI: 0.3,
  waterDensitySI: 1000,
  referenceAreaSI: 0.012,
  liftCoefficient: 0.4,
  dragCoefficient: 0.1,
  actuationTimeSI: 5,
  bottomDwellSI: 2,
  surfaceDwellSI: 2,
  leakCheckTimeSI: 5,
  initializationTimeSI: 2,
  transmitTimeSI: 2,
  currentVelocitySI: 0,
  batteryEnergySI: 80000,
  hotelPowerSI: 0.3,
  actuatorPowerSI: 12,
  transmitPowerSI: 1,
  sensorPowerSI: 0.2,
  depthLimitSI: 5,
};

describe("mission simulation", () => {
  it("completes the requested number of cycles", () => {
    const r = simulateMission(baseMission);
    expect(r.summary.completedCycles).toBe(2);
    expect(r.summary.finalState).toBe("complete");
    expect(r.summary.maxDepthM).toBeGreaterThanOrEqual(2);
  });

  it("passes through the expected state sequence", () => {
    const r = simulateMission(baseMission);
    const states = r.events.map((e) => e.to);
    expect(states.slice(0, 6)).toEqual([
      "leak_check", "dive_prep", "descending", "bottom_transition", "climb_prep", "ascending",
    ]);
  });

  it("times a single dive close to depth divided by vertical speed", () => {
    const r = simulateMission({ ...baseMission, cycles: 1 });
    const start = r.events.find((e) => e.to === "descending")!.t;
    const end = r.events.find((e) => e.to === "bottom_transition")!.t;
    const vz = Math.abs(r.samples.find((s) => s.state === "descending")!.verticalSpeed);
    expect(end - start).toBeCloseTo(2 / vz, 0);
  });

  it("declares a fault when the depth limit is exceeded", () => {
    const r = simulateMission({ ...baseMission, targetDepthSI: 10, depthLimitSI: 3 });
    expect(r.summary.finalState).toBe("fault");
    expect(r.summary.limitViolations.some((v) => /Depth limit/.test(v))).toBe(true);
  });

  it("declares a fault when the battery runs out", () => {
    const r = simulateMission({ ...baseMission, batteryEnergySI: 50, cycles: 10 });
    expect(r.summary.finalState).toBe("fault");
    expect(r.summary.limitViolations.some((v) => /Battery/.test(v))).toBe(true);
  });

  it("accumulates energy monotonically and reports a per-cycle figure", () => {
    const r = simulateMission(baseMission);
    for (let i = 1; i < r.samples.length; i++) {
      expect(r.samples[i].energyUsed).toBeGreaterThanOrEqual(r.samples[i - 1].energyUsed);
    }
    expect(r.summary.energyPerCycleJ).toBeGreaterThan(0);
  });

  it("carries the vehicle downstream when there is a current", () => {
    const still = simulateMission(baseMission);
    const drift = simulateMission({ ...baseMission, currentVelocitySI: 0.2 });
    expect(drift.summary.horizontalDistanceM).toBeGreaterThan(still.summary.horizontalDistanceM);
  });

  it("lengthens each glide when a velocity lag is modelled", () => {
    // With a first-order lag the vehicle takes time to reach its equilibrium
    // sink rate, so it needs longer to reach the target depth and the whole
    // mission takes longer. (It also coasts during the dwell states, so total
    // horizontal distance can go either way — duration is the robust check.)
    const instant = simulateMission(baseMission);
    const lagged = simulateMission({ ...baseMission, velocityTimeConstantSI: 5 });
    expect(lagged.summary.durationS).toBeGreaterThan(instant.summary.durationS);
    expect(lagged.summary.completedCycles).toBe(instant.summary.completedCycles);
  });

  it("errors out rather than looping forever if the vehicle cannot climb", () => {
    const r = simulateMission({ ...baseMission, climbNetBuoyancySI: 0, maxTimeSI: 200 });
    expect(r.warnings.some((w) => w.severity === "error")).toBe(true);
    expect(r.samples.length).toBeLessThanOrEqual(Math.ceil(200 / 0.1) + 2);
  });

  it("exports a CSV with a header and one row per sample", () => {
    const r = simulateMission({ ...baseMission, cycles: 1 });
    const csv = missionToCsv(r);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("time_s");
    expect(lines.length).toBe(r.samples.length + 1);
  });
});

/* ================================================================== */
/* Uncertainty propagation                                             */
/* ================================================================== */

describe("uncertainty propagation", () => {
  it("reproduces the analytical result for a product", () => {
    // F = rho*g*V; relative uncertainties add in quadrature
    const rho = 1000, V = 0.002, uRho = 5, uV = 2e-5;
    const r = propagate(({ rho: a, V: b }) => a * G * b, [
      { name: "rho", value: rho, uncertainty: uRho },
      { name: "V", value: V, uncertainty: uV },
    ]);
    const expected = rho * G * V * Math.sqrt((uRho / rho) ** 2 + (uV / V) ** 2);
    expect(r.value).toBeCloseTo(rho * G * V, 9);
    expect(r.uncertainty / expected).toBeCloseTo(1, 4);
  });

  it("reports variance shares that sum to one", () => {
    const r = propagate(({ a, b }) => a * b, [
      { name: "a", value: 10, uncertainty: 1 },
      { name: "b", value: 5, uncertainty: 0.1 },
    ]);
    const sum = r.contributions.reduce((s, c) => s + c.share, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(r.contributions[0].name).toBe("a");
  });

  it("expands by the coverage factor", () => {
    const r = propagate(({ a }) => a * 2, [{ name: "a", value: 10, uncertainty: 0.5 }], 2);
    expect(r.expanded).toBeCloseTo(2 * r.uncertainty, 12);
    expect(r.uncertainty).toBeCloseTo(1.0, 6);
  });

  it("warns when a relative uncertainty is large enough to break linearisation", () => {
    const r = propagate(({ a }) => a ** 2, [{ name: "a", value: 1, uncertainty: 0.5 }]);
    expect(r.warnings.some((w) => /linearised/.test(w))).toBe(true);
  });

  it("handles zero-uncertainty inputs without dividing by zero", () => {
    const r = propagate(({ a, b }) => a + b, [
      { name: "a", value: 1, uncertainty: 0 },
      { name: "b", value: 2, uncertainty: 0.1 },
    ]);
    expect(r.uncertainty).toBeCloseTo(0.1, 6);
  });

  it("combines independent uncertainties in quadrature", () => {
    expect(quadrature(3, 4)).toBeCloseTo(5, 12);
  });
});

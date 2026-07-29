import { qty, type Quantity } from "@/lib/units";
import { err, info, requireFinite, warn, type CalcResult, type CalcWarning } from "./types";

/**
 * Power budget and battery endurance.
 *
 * Loads are grouped by duty cycle because that is what actually determines
 * endurance: a 2 A motor that runs for 8 s per 10-minute cycle costs far less
 * than a 40 mA controller that never sleeps.
 */

export interface PowerLoad {
  id: string;
  name: string;
  subsystem: "controller" | "sensor" | "actuator" | "comms" | "payload" | "other";
  /** Steady current draw while active, A. */
  currentSI: number;
  /** Bus voltage this load runs from, V. */
  voltageSI: number;
  /** Fraction of mission time the load is active, 0..1. */
  dutyCycle: number;
  /** Efficiency of the regulator feeding it, 0..1. */
  regulatorEfficiency?: number;
  provenance: "datasheet" | "measured" | "estimated";
  note?: string;
}

export interface BatterySpec {
  /** Nominal capacity, C (coulombs). Use units.convert from mAh. */
  capacitySI: number;
  nominalVoltageSI: number;
  /** Usable fraction of nameplate capacity, 0..1 (depth of discharge). */
  usableFraction: number;
  /** Derating for temperature, age and high-rate discharge, 0..1. */
  deratingFactor: number;
  chemistry: string;
  provenance: "datasheet" | "measured" | "estimated";
}

export interface PowerValues extends Record<string, Quantity | undefined> {
  averagePower: Quantity;
  peakPower: Quantity;
  hotelPower: Quantity;
  actuatorPower: Quantity;
  usableEnergy: Quantity;
  enduranceTime: Quantity;
  averageCurrentAtBus: Quantity;
}

export interface PowerBreakdownRow {
  id: string;
  name: string;
  subsystem: string;
  activePowerW: number;
  averagePowerW: number;
  shareOfAverage: number;
  provenance: string;
}

export interface PowerResult extends CalcResult<PowerValues> {
  breakdown: PowerBreakdownRow[];
}

export function computePowerBudget(loads: PowerLoad[], battery: BatterySpec): PowerResult {
  const warnings: CalcWarning[] = [];
  let average = 0;
  let peak = 0;
  let hotel = 0;
  let actuator = 0;
  const rows: PowerBreakdownRow[] = [];

  if (loads.length === 0) {
    warnings.push(err("No electrical loads have been entered, so no endurance estimate is possible."));
  }

  for (const l of loads) {
    const eff = l.regulatorEfficiency ?? 1;
    if (eff <= 0 || eff > 1) {
      warnings.push(err(`Regulator efficiency for "${l.name}" must be between 0 and 1.`, l.id));
    }
    const duty = Math.min(1, Math.max(0, l.dutyCycle));
    if (l.dutyCycle < 0 || l.dutyCycle > 1) {
      warnings.push(err(`Duty cycle for "${l.name}" must be between 0 and 1.`, l.id));
    }
    const activeP = (l.currentSI * l.voltageSI) / (eff || 1);
    const avgP = activeP * duty;
    average += avgP;
    peak += activeP;
    if (l.subsystem === "actuator") actuator += avgP;
    else hotel += avgP;
    rows.push({
      id: l.id,
      name: l.name,
      subsystem: l.subsystem,
      activePowerW: activeP,
      averagePowerW: avgP,
      shareOfAverage: 0,
      provenance: l.provenance,
    });
    if (l.provenance === "estimated") {
      warnings.push(
        info(`Current draw for "${l.name}" is an ESTIMATE. Measure it with a bench supply or inline meter — quiescent currents are routinely several times the datasheet typical value in a real circuit.`, l.id),
      );
    }
  }
  for (const r of rows) r.shareOfAverage = average > 0 ? r.averagePowerW / average : 0;
  rows.sort((a, b) => b.averagePowerW - a.averagePowerW);

  requireFinite(warnings, "Battery capacity", battery.capacitySI, { min: 0, allowZero: true });
  requireFinite(warnings, "Battery nominal voltage", battery.nominalVoltageSI, { min: 0.1 });

  const nameplateEnergy = battery.capacitySI * battery.nominalVoltageSI; // C * V = J
  const usable = nameplateEnergy * battery.usableFraction * battery.deratingFactor;
  const endurance = average > 0 ? usable / average : Infinity;
  const avgCurrent = battery.nominalVoltageSI > 0 ? average / battery.nominalVoltageSI : NaN;

  if (battery.usableFraction >= 1) {
    warnings.push(
      warn(
        "Usable capacity is set to 100% of nameplate. No real pack delivers that: lithium chemistries are normally limited to 80-90% depth of discharge to protect cycle life, and the last part of the discharge curve is below the electronics' minimum voltage anyway.",
      ),
    );
  }
  if (battery.provenance === "estimated") {
    warnings.push(warn("Battery capacity is an estimate. Nameplate capacity of cheap cells is frequently optimistic; a discharge test at your actual load is the only reliable number."));
  }
  if (peak > 0 && average > 0 && peak / average > 20) {
    warnings.push(
      info(
        `Peak load is ${(peak / average).toFixed(0)}x the average. Endurance is set by the average, but the pack, wiring and regulator must survive the PEAK. Check the pack's continuous and burst current ratings against ${(peak / battery.nominalVoltageSI).toFixed(2)} A.`,
      ),
    );
  }
  warnings.push(
    info(
      "Endurance here is energy divided by average power. It ignores the voltage sag that ends a mission before the coulombs run out, self-discharge, and the fact that a stalled actuator draws far more than its running current.",
    ),
  );

  return {
    id: "power.budget",
    title: "Power and energy budget",
    values: {
      averagePower: qty(average, "W"),
      peakPower: qty(peak, "W"),
      hotelPower: qty(hotel, "W"),
      actuatorPower: qty(actuator, "W"),
      usableEnergy: qty(usable, "J"),
      enduranceTime: qty(endurance, "s"),
      averageCurrentAtBus: qty(avgCurrent, "A"),
    },
    breakdown: rows,
    steps: [
      { label: "Active power per load", equation: "P_active = V * I / eta_regulator", result: `${loads.length} loads` },
      { label: "Average power", equation: "P_avg = sum( P_active,i * duty_i )", result: `${average.toPrecision(4)} W` },
      { label: "Peak power (all loads simultaneously)", equation: "P_peak = sum( P_active,i )", result: `${peak.toPrecision(4)} W` },
      {
        label: "Usable battery energy",
        equation: "E = Q * V_nom * DoD * derating",
        substitution: `E = ${(battery.capacitySI / 3.6).toFixed(0)} mAh * ${battery.nominalVoltageSI} V * ${battery.usableFraction} * ${battery.deratingFactor}`,
        result: `${(usable / 3600).toPrecision(4)} Wh = ${usable.toPrecision(4)} J`,
      },
      {
        label: "Endurance",
        equation: "t = E_usable / P_avg",
        result: `${Number.isFinite(endurance) ? (endurance / 3600).toPrecision(4) : "—"} h`,
      },
    ],
    equations: ["P = V*I/eta", "P_avg = sum(P_i * duty_i)", "E = Q*V*DoD*k", "t = E/P_avg"],
    assumptions: [
      { text: "Loads draw constant current while active.", basis: "A simplification: microcontrollers and radios have bursty consumption." },
      { text: "Battery voltage is constant at its nominal value.", basis: "In reality it falls through the discharge; the mission usually ends at the brown-out voltage, not at zero charge." },
      { text: `Usable capacity taken as ${(battery.usableFraction * 100).toFixed(0)}% of nameplate, with a further derating factor of ${battery.deratingFactor}.`, basis: "User-set. Confirm with a discharge test at your real load." },
    ],
    warnings,
    inputs: { loads, battery },
    confidence: loads.every((l) => l.provenance === "measured") ? "medium" : "low",
    limitations: [
      "No voltage-sag, temperature or ageing model.",
      "Stall and inrush currents are not modelled; they can be several times the running current and are what actually trips a driver or browns out a controller.",
    ],
  };
}

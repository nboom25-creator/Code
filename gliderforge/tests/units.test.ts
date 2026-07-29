import { describe, it, expect } from "vitest";
import {
  convert,
  toSI,
  fromSI,
  sigFigs,
  formatNumber,
  formatQty,
  inferSigFigs,
  dimensionOf,
  UnitError,
  resolveUnit,
  unitsFor,
  prettyUnit,
} from "@/lib/units";

describe("unit conversion", () => {
  it("converts length exactly for defined factors", () => {
    expect(convert(1, "in", "m")).toBeCloseTo(0.0254, 15);
    expect(convert(1, "ft", "in")).toBeCloseTo(12, 12);
    expect(convert(1000, "mm", "m")).toBeCloseTo(1, 15);
  });

  it("converts mass exactly", () => {
    expect(convert(1, "lb", "kg")).toBeCloseTo(0.45359237, 15);
    expect(convert(1, "kg", "g")).toBeCloseTo(1000, 12);
  });

  it("converts force and pressure", () => {
    expect(convert(1, "lbf", "N")).toBeCloseTo(4.4482216152605, 12);
    expect(convert(1, "atm", "Pa")).toBeCloseTo(101325, 9);
    expect(convert(1, "bar", "kPa")).toBeCloseTo(100, 12);
    // 1 psi = 1 lbf / in^2
    expect(convert(1, "psi", "Pa")).toBeCloseTo(4.4482216152605 / 0.00064516, 6);
  });

  it("converts volume: 1 L = 1000 cm^3 = 1000 cc", () => {
    expect(convert(1, "L", "cm^3")).toBeCloseTo(1000, 9);
    expect(convert(1, "cc", "mL")).toBeCloseTo(1, 12);
    expect(convert(60, "mL", "m^3")).toBeCloseTo(6e-5, 15);
  });

  it("converts torque units used for hobby motors", () => {
    expect(convert(1, "kg*cm", "N*m")).toBeCloseTo(0.0980665, 12);
    expect(convert(1000, "mN*m", "N*m")).toBeCloseTo(1, 12);
  });

  it("converts charge for battery capacity", () => {
    expect(convert(2500, "mAh", "C")).toBeCloseTo(9000, 9);
    expect(convert(1, "Ah", "C")).toBeCloseTo(3600, 9);
  });

  it("handles offset temperature units", () => {
    expect(convert(0, "degC", "K")).toBeCloseTo(273.15, 10);
    expect(convert(100, "degC", "degF")).toBeCloseTo(212, 8);
    expect(convert(32, "degF", "degC")).toBeCloseTo(0, 8);
    expect(convert(-40, "degC", "degF")).toBeCloseTo(-40, 8);
  });

  it("round-trips through SI without drift", () => {
    for (const [v, u] of [
      [12.7, "in"],
      [3.5, "lb"],
      [45, "psi"],
      [230, "mL"],
      [17, "degC"],
    ] as [number, string][]) {
      expect(fromSI(toSI(v, u), u)).toBeCloseTo(v, 9);
    }
  });

  it("rejects conversions between different dimensions", () => {
    expect(() => convert(1, "kg", "m")).toThrow(UnitError);
    expect(() => convert(1, "N", "Pa")).toThrow(/dimensions differ/);
  });

  it("rejects unknown units", () => {
    expect(() => convert(1, "smoots", "m")).toThrow(/Unknown source unit/);
  });

  it("rejects non-finite values", () => {
    expect(() => convert(NaN, "m", "mm")).toThrow();
    expect(() => convert(Infinity, "m", "mm")).toThrow();
  });

  it("resolves common aliases from CSV imports", () => {
    expect(resolveUnit("grams")?.symbol).toBe("g");
    expect(resolveUnit("inches")?.symbol).toBe("in");
    expect(resolveUnit("Nm")?.symbol).toBe("N*m");
    expect(resolveUnit("cm3")?.symbol).toBe("cm^3");
    expect(resolveUnit("")?.symbol).toBe("-");
  });

  it("reports dimensions", () => {
    expect(dimensionOf("psi")).toBe("pressure");
    expect(dimensionOf("mAh")).toBe("charge");
    expect(dimensionOf("Pa*s")).toBe("dynamicViscosity");
  });

  it("lists SI units first for a dimension", () => {
    const list = unitsFor("length");
    expect(list[0].system).toBe("SI");
    expect(list.map((u) => u.symbol)).toContain("in");
  });
});

describe("significant figures and formatting", () => {
  it("rounds to significant figures", () => {
    expect(sigFigs(1234.5678, 3)).toBeCloseTo(1230, 9);
    expect(sigFigs(0.00123456, 3)).toBeCloseTo(0.00123, 12);
    expect(sigFigs(-9.876, 2)).toBeCloseTo(-9.9, 9);
    expect(sigFigs(0, 3)).toBe(0);
  });

  it("formats numbers with a readable range and exponent fallback", () => {
    expect(formatNumber(1234.5678, 4)).toBe("1235");
    expect(formatNumber(0.125, 3)).toBe("0.125");
    expect(formatNumber(1.5e-7, 3)).toContain("e-7");
    expect(formatNumber(NaN)).toBe("—");
  });

  it("formats quantities with units and uncertainty", () => {
    expect(formatQty({ value: 2.5, unit: "N" })).toBe("2.500 N");
    expect(formatQty({ value: 2.5, unit: "N", uncertainty: 0.12 })).toBe("2.500 ± 0.12 N");
    expect(formatQty({ value: 3, unit: "-" })).toBe("3.000");
    expect(formatQty(undefined)).toBe("—");
  });

  it("pretty-prints units for display without changing the stored symbol", () => {
    expect(prettyUnit("cm^3")).toBe("cm³");
    expect(prettyUnit("m/s^2")).toBe("m/s²");
    expect(prettyUnit("N*m")).toBe("N·m");
    expect(prettyUnit("kg/m^3")).toBe("kg/m³");
    expect(prettyUnit("deg")).toBe("°");
    expect(prettyUnit("degC")).toBe("°C");
    expect(prettyUnit("-")).toBe("");
    // The canonical symbol is still what the registry resolves.
    expect(resolveUnit("cm^3")?.symbol).toBe("cm^3");
  });

  it("uses the pretty unit in formatted quantities", () => {
    expect(formatQty({ value: 3285, unit: "cm^3" })).toBe("3285 cm³");
    expect(formatQty({ value: 1.5, unit: "N*m" })).toBe("1.500 N·m");
  });

  it("infers significant figures from typed input", () => {
    expect(inferSigFigs("0.0250")).toBe(3);
    expect(inferSigFigs("1200")).toBe(2);
    expect(inferSigFigs("1200.")).toBe(4);
    expect(inferSigFigs("9")).toBe(1);
  });
});

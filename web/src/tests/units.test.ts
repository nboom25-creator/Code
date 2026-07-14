import { describe, it, expect } from "vitest";
import {
  convert,
  convertDelta,
  compatible,
  parseCompoundDim,
  dim,
  dimEqual,
  toSigFigs,
  UnitError,
} from "@/lib/units";

describe("unit conversion", () => {
  it("converts length units", () => {
    expect(convert(1, "m", "cm")).toBeCloseTo(100);
    expect(convert(12, "in", "ft")).toBeCloseTo(1);
    expect(convert(1, "km", "m")).toBeCloseTo(1000);
  });

  it("converts absolute temperatures with offsets", () => {
    expect(convert(0, "degC", "K")).toBeCloseTo(273.15);
    expect(convert(100, "degC", "degF")).toBeCloseTo(212);
    expect(convert(32, "degF", "degC")).toBeCloseTo(0);
  });

  it("converts energy and pressure", () => {
    expect(convert(1, "kJ", "J")).toBeCloseTo(1000);
    expect(convert(1, "atm", "Pa")).toBeCloseTo(101325);
    expect(convert(1, "bar", "kPa")).toBeCloseTo(100);
  });

  it("throws on incompatible units", () => {
    expect(() => convert(1, "m", "s")).toThrow(UnitError);
    expect(() => convert(1, "J", "N")).toThrow(UnitError);
  });

  it("throws on unknown units", () => {
    expect(() => convert(1, "zorks", "m")).toThrow(UnitError);
  });
});

describe("temperature differences (the delta gotcha)", () => {
  it("treats a 1 degC delta as a 1 K delta", () => {
    expect(convertDelta(1, "degC", "K")).toBeCloseTo(1);
  });
  it("treats a 5 degF delta as 5*(5/9) K, NOT via the offset", () => {
    expect(convertDelta(5, "degF", "K")).toBeCloseTo((5 * 5) / 9);
  });
  it("differs from absolute conversion", () => {
    // absolute 5 degC -> 278.15 K, but a 5 degC *change* is 5 K.
    expect(convert(5, "degC", "K")).toBeCloseTo(278.15);
    expect(convertDelta(5, "degC", "K")).toBeCloseTo(5);
  });
});

describe("dimensional analysis", () => {
  it("parses compound units to dimensions", () => {
    // N = kg*m/s^2
    expect(dimEqual(parseCompoundDim("kg*m/s^2"), dim({ M: 1, L: 1, T: -2 }))).toBe(true);
    // J = N*m = kg*m^2/s^2
    expect(dimEqual(parseCompoundDim("J"), parseCompoundDim("kg*m^2/s^2"))).toBe(true);
    // specific heat J/(kg*K)
    expect(dimEqual(parseCompoundDim("J/(kg*K)"), dim({ L: 2, T: -2, K: -1 }))).toBe(true);
  });

  it("knows compatibility", () => {
    expect(compatible("N", "lbf")).toBe(true);
    expect(compatible("Pa", "psi")).toBe(true);
    expect(compatible("W", "J")).toBe(false);
  });
});

describe("significant figures", () => {
  it("rounds to sig figs", () => {
    expect(toSigFigs(3.14159, 3)).toBe("3.14");
    expect(toSigFigs(1234.5, 2)).toBe("1200");
    expect(toSigFigs(0, 3)).toBe("0");
  });
});

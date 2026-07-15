import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatCostBand,
  formatCostRange,
  formatDifficulty,
  formatLength,
  formatMinutes,
  formatSafetyLevel,
} from "@/lib/format";

describe("formatCents", () => {
  it("formats whole dollars without decimals", () => {
    expect(formatCents(3500)).toBe("$35");
  });
  it("formats partial dollars with cents", () => {
    expect(formatCents(3599)).toBe("$35.99");
  });
  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0");
  });
});

describe("formatCostRange", () => {
  it("collapses equal endpoints", () => {
    expect(formatCostRange(2500, 2500)).toBe("$25");
  });
  it("renders a range with an en dash", () => {
    expect(formatCostRange(2500, 7500)).toBe("$25–$75");
  });
});

describe("formatMinutes", () => {
  it("renders minutes under an hour", () => {
    expect(formatMinutes(45)).toBe("45 min");
  });
  it("renders whole hours", () => {
    expect(formatMinutes(120)).toBe("2 hr");
  });
  it("renders hours and minutes", () => {
    expect(formatMinutes(90)).toBe("1 hr 30 min");
  });
  it("renders days for long cure times", () => {
    expect(formatMinutes(1440)).toBe("1 day");
    expect(formatMinutes(2880)).toBe("2 days");
  });
});

describe("label formatters", () => {
  it("formats cost bands", () => {
    expect(formatCostBand("under_25")).toBe("Under $25");
    expect(formatCostBand("200_plus")).toBe("$200+");
  });
  it("formats difficulty", () => {
    expect(formatDifficulty("beginner")).toBe("Beginner");
  });
  it("formats safety level", () => {
    expect(formatSafetyLevel("elevated")).toBe("Elevated risk");
  });
});

describe("formatLength", () => {
  it("keeps inches for US units", () => {
    expect(formatLength(12, "us")).toBe("12 in");
  });
  it("converts to centimeters for metric units", () => {
    expect(formatLength(12, "metric")).toBe("30 cm");
  });
});

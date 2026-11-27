import { describe, expect, it } from "vitest";
import { americanToDecimal, decimalToAmerican, formatOdds, impliedFromAmerican, parseOdds } from "./odds.js";

describe("odds", () => {
  it("implied probability from American odds", () => {
    expect(impliedFromAmerican(-115)).toBeCloseTo(0.5349, 4);
    expect(impliedFromAmerican(105)).toBeCloseTo(0.4878, 4);
    expect(impliedFromAmerican(-100)).toBe(0.5);
    expect(impliedFromAmerican(100)).toBe(0.5);
  });

  it("converts American to decimal and back", () => {
    expect(americanToDecimal(-115)).toBeCloseTo(1.8696, 4);
    expect(americanToDecimal(150)).toBe(2.5);
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(1.87)).toBe(-115);
    for (const o of [-300, -150, -110, 100, 120, 450])
      expect(decimalToAmerican(americanToDecimal(o))).toBe(o);
  });

  it("rejects impossible American odds", () => {
    expect(() => impliedFromAmerican(50)).toThrow(RangeError);
    expect(() => americanToDecimal(-99)).toThrow(RangeError);
  });

  it("formats both ways", () => {
    expect(formatOdds(105)).toBe("+105");
    expect(formatOdds(-115)).toBe("-115");
    expect(formatOdds(-115, "decimal")).toBe("1.87");
  });

  it("parses what a person types", () => {
    expect(parseOdds("-115")).toBe(-115);
    expect(parseOdds("+105")).toBe(105);
    expect(parseOdds(" 105 ")).toBe(105);
    expect(parseOdds("1.87")).toBe(-115);
    expect(parseOdds("2.50")).toBe(150);
    expect(parseOdds("50")).toBeNull();
    expect(parseOdds("abc")).toBeNull();
    expect(parseOdds("")).toBeNull();
  });
});

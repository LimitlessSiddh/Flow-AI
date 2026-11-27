import { describe, expect, it } from "vitest";
import { daysUntilReset, estimateLine, LINE_RULES, propCreditBudget } from "./lines.js";

describe("estimateLine", () => {
  it("rounds the season and recent midpoint to a half point", () => {
    const vals = [20, 22, 24, 26, 28, 30, 25, 27, 29, 31, 26, 28];
    // season mean 26.33, last 10 mean 27.2, midpoint 26.77, so 26.5
    expect(estimateLine(vals, LINE_RULES.NBA.points!)).toBe(26.5);
  });

  it("skips small roles and thin samples", () => {
    expect(estimateLine([4, 5, 6, 5, 4, 6, 5, 5], LINE_RULES.NBA.points!)).toBeNull();
    expect(estimateLine([30, 31, 29], LINE_RULES.NBA.points!)).toBeNull();
  });

  it("uses 0.5 for yes/no props", () => {
    expect(estimateLine([0, 1, 0, 0, 1, 0, 0, 1], LINE_RULES.NHL.goals!)).toBe(0.5);
  });
});

describe("propCreditBudget", () => {
  it("spreads what's left over the rest of the month", () => {
    expect(propCreditBudget({ remaining: 459, daysLeft: 4, scansPerDay: 2, reserve: 20 })).toBe(54);
    expect(propCreditBudget({ remaining: 500, daysLeft: 30, scansPerDay: 2, reserve: 20 })).toBe(8);
    expect(propCreditBudget({ remaining: 10, daysLeft: 3, scansPerDay: 2, reserve: 20 })).toBe(0);
  });

  it("counts days to the reset, including today", () => {
    expect(daysUntilReset("2026-11-27")).toBe(4);
    expect(daysUntilReset("2026-12-01")).toBe(31);
    expect(daysUntilReset("2026-11-10", 15)).toBe(5);
  });
});

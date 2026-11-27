import { describe, expect, it } from "vitest";
import { daysUntilReset, estimateLine, LINE_RULES, propCreditBudget } from "./lines.js";

describe("estimateLine", () => {
  it("picks the half point where the season splits closest to 50/50", () => {
    const vals = [20, 22, 24, 26, 28, 30, 25, 27, 29, 31, 26, 28];
    // 26.5: 6 of 12 games over
    expect(estimateLine(vals, LINE_RULES.NBA.points!)).toBe(26.5);
  });

  it("gives a 2-point-a-game skater 1.5, not 0.5", () => {
    const vals = [2, 3, 1, 2, 4, 0, 2, 1, 1, 2, 3, 2, 1, 2, 3, 1, 1, 4, 2, 1];
    // over 1.5 in 11 of 20, over 0.5 in 19 of 20
    expect(estimateLine(vals, LINE_RULES.NHL.points!)).toBe(1.5);
  });

  it("skips a stat too lumpy to split near 50/50", () => {
    // about 1 shot a game: over 0.5 in 75% of games, over 1.5 in 25%. Either line hands one side a lock.
    const vals = [1, 0, 2, 1, 1, 0, 2, 1, 1, 3, 0, 1, 2, 1, 0, 1];
    expect(estimateLine(vals, { min: 0.5 })).toBeNull();
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

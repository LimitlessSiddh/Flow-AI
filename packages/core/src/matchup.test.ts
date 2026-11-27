import { describe, expect, it } from "vitest";
import { expectedMargin, normCdf, teamMarketProbability } from "./matchup.js";

const team = (margin: number, total = 220) => ({
  games: Array.from({ length: 12 }, () => ({ scored: (total + margin) / 2, allowed: (total - margin) / 2 })),
});

describe("matchup model", () => {
  it("normal CDF", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("an even matchup at home is a small favourite", () => {
    const p = teamMarketProbability("NBA", "moneyline", { me: team(0), opp: team(0), home: true })!;
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.62);
  });

  it("a big underdog getting the points isn't a lock just because it covered big numbers before", () => {
    // weaker team (+3) away at a strong team (+8), getting 9.5
    const p = teamMarketProbability("NBA", "spread", {
      me: team(3),
      opp: team(8),
      home: false,
      points: 9.5,
    })!;
    expect(expectedMargin("NBA", team(3), team(8), false)).toBeCloseTo(-6, 5);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.65);
  });

  it("totals use both teams", () => {
    const over = teamMarketProbability("NBA", "total", {
      me: team(0, 230),
      opp: team(0, 226),
      home: true,
      points: 221.5,
      side: "Over",
    })!;
    const under = teamMarketProbability("NBA", "total", {
      me: team(0, 230),
      opp: team(0, 226),
      home: true,
      points: 221.5,
      side: "Under",
    })!;
    expect(over).toBeGreaterThan(0.6);
    expect(over + under).toBeCloseTo(1, 6);
  });

  it("needs five games from each team", () => {
    expect(
      teamMarketProbability("NHL", "moneyline", { me: { games: [] }, opp: team(0), home: true }),
    ).toBeNull();
  });
});

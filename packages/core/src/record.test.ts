import { describe, expect, it } from "vitest";
import {
  calibration,
  clvPoints,
  fitFormWeight,
  gradeOutcome,
  profitUnits,
  recordStats,
  sampleStage,
  type TuneSample,
} from "./record.js";

describe("gradeOutcome", () => {
  it("grades props, totals and pushes", () => {
    expect(gradeOutcome("prop", "Over", 8.5, 12)).toBe("win");
    expect(gradeOutcome("prop", "Under", 3.5, 2)).toBe("win");
    expect(gradeOutcome("prop", "Under", 3.5, 4)).toBe("loss");
    expect(gradeOutcome("total", "Over", 220, 220)).toBe("push");
    expect(gradeOutcome("prop", "Over", 8.5, null)).toBe("void");
  });

  it("grades moneylines and spreads from the team's margin", () => {
    expect(gradeOutcome("moneyline", "NYK", null, -4)).toBe("loss");
    expect(gradeOutcome("moneyline", "NYK", null, 1)).toBe("win");
    // Hawks +10.5 lose by 8: covered
    expect(gradeOutcome("spread", "ATL", 10.5, -8)).toBe("win");
    // -4.5 favourite wins by 3: didn't cover
    expect(gradeOutcome("spread", "BOS", -4.5, 3)).toBe("loss");
    expect(gradeOutcome("spread", "BOS", -3, 3)).toBe("push");
  });
});

describe("profit and closing line value", () => {
  it("pays the price on a win and loses the stake on a loss", () => {
    expect(profitUnits("win", 110)).toBeCloseTo(1.1);
    expect(profitUnits("win", -150)).toBeCloseTo(0.6667, 3);
    expect(profitUnits("loss", -150)).toBe(-1);
    expect(profitUnits("push", -110)).toBe(0);
    expect(profitUnits("win", null)).toBeNull();
  });

  it("is positive when the price got shorter after you took it", () => {
    expect(clvPoints(110, -110)).toBeGreaterThan(0);
    expect(clvPoints(-110, 110)).toBeLessThan(0);
    expect(clvPoints(-110, -110)).toBe(0);
  });
});

describe("recordStats", () => {
  it("adds up a 3 and 1 day", () => {
    const s = recordStats([
      { outcome: "win", odds: -115, chance: 0.6, closeOdds: -125 },
      { outcome: "loss", odds: -140, chance: 0.6, closeOdds: null },
      { outcome: "win", odds: -110, chance: 0.55, closeOdds: -105 },
      { outcome: "win", odds: 110, chance: 0.5, closeOdds: null },
      { outcome: null, odds: -110, chance: 0.5, closeOdds: null },
    ]);
    expect(s).toMatchObject({ plays: 5, graded: 4, won: 3, lost: 1, pending: 1, priced: 4 });
    expect(s.winRate).toBe(0.75);
    // 0.8696 + 0.9091 + 1.1 - 1
    expect(s.units).toBeCloseTo(1.8787, 3);
    expect(s.roi).toBeCloseTo(0.4697, 3);
    expect(s.expectedWinRate).toBeCloseTo(0.5625);
    expect(s.clv.n).toBe(2);
    expect(s.clv.beat).toBe(1);
  });

  it("counts wins without a price but leaves them out of profit", () => {
    const s = recordStats([
      { outcome: "win", odds: null, chance: null, closeOdds: null },
      { outcome: "void", odds: -110, chance: 0.6, closeOdds: null },
    ]);
    expect(s).toMatchObject({ won: 1, push: 1, priced: 0, units: 0, roi: null, winRate: 1 });
  });
});

describe("calibration", () => {
  it("compares Flow's chance with how often plays hit", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({
        chance: 0.62,
        outcome: i < 6 ? ("win" as const) : ("loss" as const),
      })),
      { chance: 0.45, outcome: "loss" as const },
      { chance: 0.99, outcome: "win" as const },
      { chance: 0.55, outcome: "push" as const },
      { chance: null, outcome: "win" as const },
    ];
    const c = calibration(rows);
    expect(c.n).toBe(12);
    const b60 = c.buckets.find((b) => b.from === 0.6)!;
    expect(b60).toMatchObject({ n: 10, predicted: 0.62, actual: 0.6 });
    expect(c.buckets.at(-1)).toMatchObject({ n: 1, actual: 1 }); // 0.99 lands in the top bucket
    expect(c.buckets.find((b) => b.from === 0.5)!.n).toBe(0); // the push is left out
    expect(c.brier).toBeGreaterThan(0);
  });
});

describe("fitFormWeight", () => {
  // Deterministic samples where the truth is: chance = implied + 0.6 x (model - implied)
  function samples(n: number, trueWeight: number): TuneSample[] {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    return Array.from({ length: n }, () => {
      const implied = 0.4 + rand() * 0.2;
      const model = 0.3 + rand() * 0.4;
      const p = implied + trueWeight * (model - implied);
      return { implied, model, won: rand() < p };
    });
  }

  it("waits for enough plays before suggesting a change", () => {
    const r = fitFormWeight(samples(40, 0.6));
    expect(r.n).toBe(40);
    expect(r.best).toBeNull();
    expect(r.lossCurrent).not.toBeNull();
  });

  it("finds a weight near the one that made the data", () => {
    const r = fitFormWeight(samples(6000, 0.6));
    expect(r.best).toBeGreaterThanOrEqual(0.4);
    expect(r.best).toBeLessThanOrEqual(0.8);
    expect(r.lossBest!).toBeLessThanOrEqual(r.lossCurrent!);
  });
});

it("labels sample sizes", () => {
  expect(sampleStage(0)).toBe("none");
  expect(sampleStage(4)).toBe("early");
  expect(sampleStage(250)).toBe("building");
  expect(sampleStage(900)).toBe("solid");
});

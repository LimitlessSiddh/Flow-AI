import { describe, expect, it } from "vitest";
import { summarizeForm } from "./form.js";
import {
  betValue,
  blendSignal,
  flowSignal,
  modelPoints,
  modelProbability,
  tier,
  valueLabel,
  watchReasons,
} from "./score.js";
import type { GameValue } from "./types.js";

const log = (vals: (number | null)[]): GameValue[] =>
  vals.map((value, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, value }));

describe("summarizeForm", () => {
  it("computes windows, season and streak", () => {
    const f = summarizeForm(log([22, 25, 19, 28, 24, 31, 29, 33, 27, 34]), 26.5);
    expect(f.windows.map((w) => w.n)).toEqual([5, 8, 10]);
    expect(f.windows[0]).toMatchObject({ n: 5, hits: 5, avg: 30.8 });
    expect(f.windows[2]).toMatchObject({ n: 10, hits: 6 });
    expect(f.streak).toBe(5);
    expect(f.season.games).toBe(10);
  });

  it("skips missed games and treats a push as not a hit", () => {
    const f = summarizeForm(log([4, null, 3.5, 5, 2, 6]), 3.5);
    expect(f.season.games).toBe(5);
    expect(f.windows.map((w) => w.n)).toEqual([5]);
    expect(f.windows[0]!.hits).toBe(3);
    expect(f.playedRecent).toBe(5);
  });

  it("supports unders", () => {
    const f = summarizeForm(log([1, 2, 1, 0, 2]), 2.5, "Under");
    expect(f.windows[0]!.hits).toBe(5);
  });
});

describe("blendSignal", () => {
  it("maps chances to points", () => {
    expect(modelPoints(0.5)).toBe(50);
    expect(modelPoints(0.65)).toBeCloseTo(75);
    expect(modelPoints(0.9)).toBe(100);
    expect(modelPoints(0.1)).toBe(0);
  });

  it("keeps a streak the model rates as a coin flip out of Hot", () => {
    // Live case: total Over with a form signal of 80 and a model chance of 50.6%.
    const s = blendSignal(80, 0.506)!;
    expect(tier(s)).not.toBe("Hot");
    // A streak the model agrees with stays Hot.
    expect(tier(blendSignal(84, 0.737)!)).toBe("Hot");
  });

  it("falls back to form alone without a model chance", () => {
    expect(blendSignal(72, null)).toBe(72);
    expect(blendSignal(null, 0.7)).toBeNull();
  });
});

describe("flowSignal", () => {
  it("is high for a hot player over the line and low for a cold one", () => {
    const hot = summarizeForm(log([22, 25, 19, 28, 24, 31, 29, 33, 27, 34]), 26.5);
    const cold = summarizeForm(log([34, 31, 30, 28, 24, 20, 22, 19, 21, 18]), 26.5);
    const h = flowSignal(hot, 26.5)!;
    const c = flowSignal(cold, 26.5)!;
    expect(h).toBeGreaterThanOrEqual(65);
    expect(c).toBeLessThan(40);
    expect(h).toBeLessThanOrEqual(100);
    expect(c).toBeGreaterThanOrEqual(0);
  });

  it("returns null with too few games", () => {
    expect(flowSignal(summarizeForm(log([30, 31, 29]), 26.5), 26.5)).toBeNull();
  });

  it("tiers at 65 and 80", () => {
    expect(tier(80)).toBe("Hot");
    expect(tier(79)).toBe("Warm");
    expect(tier(65)).toBe("Warm");
    expect(tier(64)).toBe("Mild");
  });
});

describe("value", () => {
  it("shrinks recent rate toward the season rate", () => {
    const f = summarizeForm(log([22, 25, 19, 28, 24, 31, 29, 33, 27, 34]), 26.5);
    const p = modelProbability(f)!;
    // last 10 = 6/10 and season = 6/10. Season pulled toward 50%: (6 + 3) / 16 = 0.5625.
    const expected = (6 + 12 * 0.5625) / 22;
    expect(p).toBeCloseTo(expected, 5);
    expect(betValue(p, -115)).toBeCloseTo(0.35 * (expected - 115 / 215) * 100, 5);
  });

  it("doesn't call a 9-of-10 run in a 10-game season a 90% chance", () => {
    // Live case: a QB's rushing Under 10.5, under in 9 of his 10 games.
    const f = summarizeForm(log([2, 6, 7, 10, 10, 2, 73, 4, 2, 5]), 10.5, "Under");
    const p = modelProbability(f)!;
    expect(p).toBeLessThan(0.85);
    expect(p).toBeGreaterThan(0.7);
  });

  it("needs a price and an estimate", () => {
    expect(betValue(null, -110)).toBeNull();
    expect(betValue(0.55, null)).toBeNull();
  });

  it("labels value", () => {
    expect(valueLabel(4.1)).toBe("Good price");
    expect(valueLabel(1)).toBe("Small edge");
    expect(valueLabel(-0.1)).toBe("Priced in");
  });

  it("returns no estimate below 8 games", () => {
    expect(modelProbability(summarizeForm(log([30, 31, 29, 28, 27, 33, 26]), 26.5))).toBeNull();
  });
});

describe("watchReasons", () => {
  it("flags thin data, stale prices and no sources", () => {
    const f = summarizeForm(log([30, 31, 29, 28]), 26.5);
    const r = watchReasons({ form: f, priceAgeMinutes: 300, sourceCount: 0 });
    expect(r).toHaveLength(3);
  });
});

import { impliedFromAmerican, payoutPerUnit } from "./odds.js";
import { cleared } from "./form.js";
import { FORM_WEIGHT, SIGNAL_VERSION } from "./score.js";

/**
 * My Record: the math that turns stored plays and picks into a track record.
 * Pure functions only. Everything the record page shows is computed here.
 */

/** void = the bet was cancelled (the player didn't play), so the stake comes back. */
export type Outcome = "win" | "loss" | "push" | "void";

/** Stamped on every stored play and pick, so results can be split by model version later. */
export const MODEL_VERSION = `${SIGNAL_VERSION}+form${FORM_WEIGHT}`;

/** Profit is shown in dollars at a flat stake, so different prices compare fairly. */
export const STAKE_DOLLARS = 10;

/** Below this many graded plays, luck explains most of a record. */
export const EARLY_SAMPLE = 100;
/** Priced, graded plays needed before Flow suggests changing how far it leans on form. */
export const MIN_SAMPLES_TO_TUNE = 150;

/** The number a market's result is compared with. Spreads compare the margin with minus the points. */
export function compareLineFor(kind: string, line: number | null): number {
  if (kind === "moneyline") return 0;
  if (kind === "spread") return -(line ?? 0);
  return line ?? 0;
}

/**
 * Grade one market from its result. `value` is the player's stat, the team's margin (moneyline, spread)
 * or the game total. null = the player didn't play, which books void.
 */
export function gradeOutcome(kind: string, side: string, line: number | null, value: number | null): Outcome {
  if (value == null) return "void";
  const target = compareLineFor(kind, line);
  if (value === target) return "push";
  const dir: "Over" | "Under" = side === "Under" ? "Under" : "Over";
  return cleared(value, target, dir) ? "win" : "loss";
}

/** Profit on a 1-unit stake. null when the price is unknown. */
export function profitUnits(outcome: Outcome, odds: number | null): number | null {
  if (outcome === "push" || outcome === "void") return 0;
  if (odds == null) return null;
  return outcome === "win" ? payoutPerUnit(odds) : -1;
}

/**
 * Closing line value, in percentage points of chance. Positive = your price was better than the price
 * right before the game (the market moved toward you). Only meaningful when both prices are at the same line.
 */
export function clvPoints(takenOdds: number, closeOdds: number): number {
  return (impliedFromAmerican(closeOdds) - impliedFromAmerican(takenOdds)) * 100;
}

/** One graded or pending bet, as the record math sees it. */
export interface RecordRow {
  outcome: Outcome | null;
  odds: number | null;
  /** Flow's chance the play hits, 0..1 */
  chance: number | null;
  /** closing price at the same line, if captured */
  closeOdds: number | null;
}

export interface RecordStats {
  plays: number;
  graded: number;
  won: number;
  lost: number;
  push: number;
  pending: number;
  /** wins / (wins + losses) */
  winRate: number | null;
  /** plays whose profit is known (graded with a price) */
  priced: number;
  units: number;
  /** profit / stake risked */
  roi: number | null;
  /** average Flow chance on decided plays, to compare with winRate */
  expectedWinRate: number | null;
  clv: { n: number; avg: number | null; beat: number };
}

export function recordStats(rows: RecordRow[]): RecordStats {
  let won = 0,
    lost = 0,
    push = 0,
    pending = 0,
    priced = 0,
    units = 0,
    risked = 0,
    chanceSum = 0,
    chanceN = 0,
    clvSum = 0,
    clvN = 0,
    beat = 0;
  for (const r of rows) {
    if (r.odds != null && r.closeOdds != null) {
      const c = clvPoints(r.odds, r.closeOdds);
      clvSum += c;
      clvN++;
      if (c > 0) beat++;
    }
    if (r.outcome == null) {
      pending++;
      continue;
    }
    if (r.outcome === "win") won++;
    else if (r.outcome === "loss") lost++;
    else push++;
    const decided = r.outcome === "win" || r.outcome === "loss";
    if (decided && r.chance != null) {
      chanceSum += r.chance;
      chanceN++;
    }
    const p = profitUnits(r.outcome, r.odds);
    if (p != null && decided) {
      priced++;
      units += p;
      risked += 1;
    }
  }
  return {
    plays: rows.length,
    graded: won + lost + push,
    won,
    lost,
    push,
    pending,
    winRate: won + lost ? won / (won + lost) : null,
    priced,
    units: round(units, 4),
    roi: risked ? round(units / risked, 4) : null,
    expectedWinRate: chanceN ? round(chanceSum / chanceN, 4) : null,
    clv: { n: clvN, avg: clvN ? round(clvSum / clvN, 2) : null, beat },
  };
}

/** Chance buckets for the calibration check. Flow's chances mostly sit between 40% and 70%. */
export const CALIBRATION_EDGES = [0, 0.4, 0.5, 0.6, 0.7, 1] as const;

export interface CalibrationBucket {
  from: number;
  to: number;
  n: number;
  /** average chance Flow gave */
  predicted: number | null;
  /** share that actually hit */
  actual: number | null;
}

/**
 * Do Flow's 60% plays hit about 60% of the time? Groups decided plays by Flow's chance and compares the
 * average chance with the hit rate. Pushes and voids are left out.
 */
export function calibration(
  rows: { chance: number | null; outcome: Outcome | null }[],
  edges: readonly number[] = CALIBRATION_EDGES,
): { buckets: CalibrationBucket[]; n: number; brier: number | null } {
  const buckets: (CalibrationBucket & { sum: number; hits: number })[] = [];
  for (let i = 0; i < edges.length - 1; i++)
    buckets.push({
      from: edges[i]!,
      to: edges[i + 1]!,
      n: 0,
      predicted: null,
      actual: null,
      sum: 0,
      hits: 0,
    });
  let brierSum = 0;
  let n = 0;
  for (const r of rows) {
    if (r.chance == null || (r.outcome !== "win" && r.outcome !== "loss")) continue;
    const y = r.outcome === "win" ? 1 : 0;
    const last = buckets.length - 1;
    const b = buckets.find((x, i) => r.chance! >= x.from && (r.chance! < x.to || i === last))!;
    b.n++;
    b.sum += r.chance;
    b.hits += y;
    brierSum += (r.chance - y) ** 2;
    n++;
  }
  return {
    buckets: buckets.map(({ sum, hits, ...b }) => ({
      ...b,
      predicted: b.n ? round(sum / b.n, 4) : null,
      actual: b.n ? round(hits / b.n, 4) : null,
    })),
    n,
    brier: n ? round(brierSum / n, 4) : null,
  };
}

export interface TuneSample {
  /** Flow's form-based rate before the price is blended in */
  model: number;
  /** the price's break-even chance */
  implied: number;
  won: boolean;
}

export interface TuneResult {
  n: number;
  current: number;
  /** the form weight that would have predicted these results best; null until there are enough */
  best: number | null;
  /** average log loss at the current and best weights (lower is better) */
  lossCurrent: number | null;
  lossBest: number | null;
}

/**
 * Flow's chance = price's chance + FORM_WEIGHT x (form rate - price's chance). This finds the weight that
 * would have predicted the graded results best (lowest log loss), on a 0.05 grid from 0 to 1.
 * It only answers once there are MIN_SAMPLES_TO_TUNE plays, because a small sample fits noise.
 */
export function fitFormWeight(
  samples: TuneSample[],
  current = FORM_WEIGHT,
  minSamples = MIN_SAMPLES_TO_TUNE,
): TuneResult {
  const loss = (w: number) => {
    let s = 0;
    for (const x of samples) {
      const p = Math.min(0.99, Math.max(0.01, x.implied + w * (x.model - x.implied)));
      s -= x.won ? Math.log(p) : Math.log(1 - p);
    }
    return s / samples.length;
  };
  if (!samples.length) return { n: 0, current, best: null, lossCurrent: null, lossBest: null };
  const lossCurrent = round(loss(current), 5);
  if (samples.length < minSamples)
    return { n: samples.length, current, best: null, lossCurrent, lossBest: null };
  let best = 0;
  let bestLoss = Infinity;
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    const l = loss(w);
    if (l < bestLoss - 1e-12) {
      bestLoss = l;
      best = w;
    }
  }
  return { n: samples.length, current, best, lossCurrent, lossBest: round(bestLoss, 5) };
}

export type SampleStage = "none" | "early" | "building" | "solid";

/** How much to trust a record of n graded plays. */
export function sampleStage(n: number): SampleStage {
  if (n === 0) return "none";
  if (n < EARLY_SAMPLE) return "early";
  if (n < 500) return "building";
  return "solid";
}

function round(x: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

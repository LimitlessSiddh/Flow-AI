import { impliedFromAmerican } from "./odds.js";
import type { FormSummary, Quality, Tier, ValueLabel } from "./types.js";

export const SIGNAL_VERSION = "signal-v1";
export const MIN_GAMES_FOR_SIGNAL = 5;
export const MIN_GAMES_FOR_ESTIMATE = 8;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Flow Signal, 0 to 100: how strongly recent form points the way of the play.
 * It ignores the price on purpose. Three parts:
 *  - recent clear rate (last 5, 8, 10 weighted .5/.3/.2), 50%
 *  - lift: recent average against the season average, in standard deviations, 25%
 *  - cushion: last-5 average against the line, in standard deviations, 25%
 * Each part maps to 0..1; a neutral player sits near 50.
 */
export function flowSignal(form: FormSummary, line: number, side: "Over" | "Under" = "Over"): number | null {
  if (form.season.games < MIN_GAMES_FOR_SIGNAL) return null;
  const w = (n: number) => form.windows.find((x) => x.n === n);
  const parts: [number, number][] = [];
  const weights: Record<number, number> = { 5: 0.5, 8: 0.3, 10: 0.2 };
  for (const n of [5, 8, 10]) {
    const win = w(n);
    if (win) parts.push([win.rate, weights[n]!]);
  }
  const totalW = parts.reduce((a, [, wt]) => a + wt, 0);
  const recentRate = totalW ? parts.reduce((a, [r, wt]) => a + r * wt, 0) / totalW : form.season.rate;

  const sd = Math.max(form.season.sd, 0.5);
  const dir = side === "Under" ? -1 : 1;
  const recent = w(10) ?? w(8) ?? w(5);
  const lift = recent ? clamp((dir * (recent.avg - form.season.avg)) / sd, -2, 2) : 0;
  const last5 = w(5);
  const cushion = last5 ? clamp((dir * (last5.avg - line)) / sd, -2, 2) : 0;

  const score = 0.5 * recentRate + 0.25 * ((lift + 2) / 4) + 0.25 * ((cushion + 2) / 4);
  return Math.round(clamp(score, 0, 1) * 100);
}

export function tier(signal: number): Tier {
  return signal >= 80 ? "Hot" : signal >= 65 ? "Warm" : "Mild";
}

/**
 * Flow's chance the play hits: the last-10 clear rate shrunk toward the season clear rate.
 * The shrink weight k means "k games of season evidence". Returns null when the sample is too thin.
 */
export function modelProbability(form: FormSummary, k = 12): number | null {
  if (form.season.games < MIN_GAMES_FOR_ESTIMATE) return null;
  const recent = form.windows.find((x) => x.n === 10) ?? form.windows.find((x) => x.n === 8);
  if (!recent) return null;
  const p = (recent.hits + k * form.season.rate) / (recent.games + k);
  return clamp(p, 0.03, 0.97);
}

/**
 * How far Flow moves away from the market. Betting markets are hard to beat, so Flow's estimate starts at the
 * price's own chance and moves part of the way toward what recent form says. 0.35 = 35% of the way.
 * Tracked results will tell us whether to raise or lower it.
 */
export const FORM_WEIGHT = 0.35;

/** Flow's chance the play hits, given its form-based rate and the price. */
export function flowEstimate(model: number | null, odds: number | null, weight = FORM_WEIGHT): number | null {
  if (model == null || odds == null) return null;
  const implied = impliedFromAmerican(odds);
  return implied + weight * (model - implied);
}

/** Bet value in percentage points: Flow's chance minus the chance the price needs. */
export function betValue(model: number | null, odds: number | null): number | null {
  const est = flowEstimate(model, odds);
  if (est == null || odds == null) return null;
  return (est - impliedFromAmerican(odds)) * 100;
}

export function valueLabel(v: number): ValueLabel {
  return v >= 3 ? "Good price" : v >= 0 ? "Small edge" : "Priced in";
}

/** Expected profit per 1 unit staked at these odds. */
export function expectedValuePerUnit(model: number, odds: number): number {
  const dec = odds < 0 ? 1 + 100 / -odds : 1 + odds / 100;
  return model * (dec - 1) - (1 - model);
}

export interface WatchInput {
  form: FormSummary;
  priceAgeMinutes?: number | null;
  sourceCount: number;
  availability?: "ok" | "questionable" | "out" | "unknown";
}

/** Reasons to label a play "Watch": it can still show, but the evidence is thin. */
export function watchReasons(input: WatchInput): string[] {
  const r: string[] = [];
  if (input.form.season.games < MIN_GAMES_FOR_ESTIMATE)
    r.push(`Only ${input.form.season.games} games this season, too few to estimate a chance.`);
  else if (input.form.playedRecent < 7)
    r.push(`Played ${input.form.playedRecent} of the last 10 games, so recent form is patchy.`);
  if (input.priceAgeMinutes != null && input.priceAgeMinutes > 180)
    r.push(`The price is ${Math.round(input.priceAgeMinutes / 60)} hours old. Check it before betting.`);
  if (input.availability === "questionable") r.push("Listed as questionable. Check the final injury report.");
  if (input.sourceCount === 0) r.push("No news source confirmed the context yet.");
  return r;
}

export function evidenceQuality(form: FormSummary, sourceCount: number, corroborated: number): Quality {
  let q = 1;
  if (form.season.games >= 10 && form.playedRecent >= 8) q++;
  if (sourceCount >= 2 && corroborated >= 1) q++;
  return Math.min(3, q) as Quality;
}

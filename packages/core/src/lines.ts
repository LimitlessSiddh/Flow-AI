import { mean } from "./form.js";
import type { League } from "./types.js";

/**
 * Estimated prop lines, for players the free odds feed doesn't price.
 *
 * Books set most lines near a player's expected output, and always on a half point so there are no pushes.
 * Flow's estimate is the midpoint of the season and last-10 averages, rounded to the nearest x.5 below
 * the next whole number. It is a stand-in until you type in Betway's real line, and the board says so.
 */
export interface LineRule {
  /** Lowest line a book usually offers for this stat; below it, the player isn't worth a prop. */
  min: number;
  /** Yes/no props (anytime goal, anytime TD, 1+ point) always use 0.5, Over only. */
  fixed?: number;
}

export const LINE_RULES: Record<League, Record<string, LineRule>> = {
  NBA: {
    points: { min: 9.5 },
    rebounds: { min: 3.5 },
    assists: { min: 2.5 },
    threes: { min: 1.5 },
  },
  NHL: {
    points: { min: 0.5, fixed: 0.5 },
    shots: { min: 1.5 },
    goals: { min: 0.5, fixed: 0.5 },
  },
  NFL: {
    passYds: { min: 150.5 },
    rushYds: { min: 9.5 },
    recYds: { min: 14.5 },
    receptions: { min: 1.5 },
    anytimeTd: { min: 0.5, fixed: 0.5 },
  },
};

/** Minimum role to rate a player at all: NBA minutes, NHL time on ice (last 10 average). */
export const MIN_ROLE_MINUTES: Partial<Record<League, number>> = { NBA: 20, NHL: 13 };

/** Fewer played games than this and Flow won't guess a line. */
export const MIN_GAMES_FOR_LINE = 8;

export function estimateLine(values: number[], rule: LineRule): number | null {
  if (values.length < MIN_GAMES_FOR_LINE) return null;
  if (rule.fixed != null) return rule.fixed;
  const base = 0.5 * mean(values) + 0.5 * mean(values.slice(-10));
  const line = Math.floor(base) + 0.5;
  return line >= rule.min ? line : null;
}

/**
 * How many Odds API credits one scan may spend on player props. The free plan has 500 a month, so Flow spreads
 * what's left over the days left in the month, keeping a small reserve.
 */
export function propCreditBudget(opts: {
  remaining: number;
  /** Days left in the credit month, counting today. */
  daysLeft: number;
  scansPerDay: number;
  reserve: number;
}): number {
  const spendable = Math.max(0, opts.remaining - opts.reserve);
  const scansLeft = Math.max(1, opts.daysLeft * Math.max(1, opts.scansPerDay));
  return Math.floor(spendable / scansLeft);
}

/** Days left until the credit month resets on `resetDay` (1 to 28), counting today. */
export function daysUntilReset(today: string, resetDay = 1): number {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const target = d < resetDay ? Date.UTC(y, m - 1, resetDay) : Date.UTC(y, m, resetDay);
  return Math.max(1, Math.round((target - Date.UTC(y, m - 1, d)) / 86_400_000));
}

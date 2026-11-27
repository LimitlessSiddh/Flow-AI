import { mean } from "./form.js";
import type { League } from "./types.js";

/**
 * Estimated prop lines, for players the free odds feed doesn't price.
 *
 * Books aim for a line that splits a player's outcomes about evenly, always on a half point so there are no
 * pushes. Flow picks the half-point line where the player's games split closest to 50/50 (the last 10 count double,
 * as books lean on recent games), so the line itself says "coin flip" and only form against it moves the signal. (Rounding the average instead put
 * stars like a 2-point-a-game skater at 0.5 and made low-count Unders look like locks.)
 * It is a stand-in until you type in Betway's real line, and the board says so.
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
    points: { min: 0.5 },
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

/**
 * If no half-point line splits the season within this much of 50/50, the stat is too lumpy to guess a line
 * for (a 1-shot-a-game player is under 1.5 in most games and over 0.5 in most games). Flow skips it.
 */
export const MAX_SPLIT_GAP = 0.15;

export function estimateLine(values: number[], rule: LineRule): number | null {
  if (values.length < MIN_GAMES_FOR_LINE) return null;
  if (rule.fixed != null) return rule.fixed;
  const center = 0.5 * mean(values) + 0.5 * mean(values.slice(-10));
  let best: { line: number; gap: number; dist: number } | null = null;
  const lo = Math.floor(Math.min(...values));
  const hi = Math.ceil(Math.max(...values));
  for (let k = lo; k <= hi; k++) {
    const line = k + 0.5;
    // Books lean on recent games, so the last 10 count double in the split.
    const recentFrom = values.length - 10;
    let w = 0;
    let wOver = 0;
    values.forEach((v, i) => {
      const wt = i >= recentFrom ? 2 : 1;
      w += wt;
      if (v > line) wOver += wt;
    });
    const over = wOver / w;
    const gap = Math.abs(over - 0.5);
    const dist = Math.abs(line - center);
    if (!best || gap < best.gap - 1e-9 || (Math.abs(gap - best.gap) <= 1e-9 && dist < best.dist))
      best = { line, gap, dist };
  }
  if (!best || best.gap > MAX_SPLIT_GAP || best.line < rule.min) return null;
  return best.line;
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

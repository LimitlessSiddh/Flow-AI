import type { League } from "./types.js";

/**
 * A simple matchup model for team markets (moneyline, spread, total).
 * Past cover rates against today's line are biased, because past games had different lines and opponents,
 * so team markets estimate a margin or total from both teams' form and turn it into a chance.
 */
export const MARGIN_SD: Record<League, number> = { NBA: 12, NFL: 13.5, NHL: 2.3 };
export const TOTAL_SD: Record<League, number> = { NBA: 18, NFL: 13.5, NHL: 2.2 };
export const HOME_EDGE: Record<League, number> = { NBA: 2.5, NFL: 1.5, NHL: 0.25 };
/** Team strength regresses toward average; keep this share of the raw difference. */
export const REGRESS = 0.7;

export interface TeamForm {
  games: { scored: number; allowed: number }[]; // oldest first
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Half last-10, half season: recent form counts, but one hot week doesn't define a team. */
function blended(xs: number[]): number {
  return 0.5 * avg(xs.slice(-10)) + 0.5 * avg(xs);
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, accurate to about 1e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function expectedMargin(league: League, me: TeamForm, opp: TeamForm, home: boolean): number {
  const m = blended(me.games.map((g) => g.scored - g.allowed));
  const o = blended(opp.games.map((g) => g.scored - g.allowed));
  return REGRESS * (m - o) + (home ? HOME_EDGE[league] : -HOME_EDGE[league]);
}

export function expectedTotal(a: TeamForm, b: TeamForm): number {
  return (
    (blended(a.games.map((g) => g.scored + g.allowed)) + blended(b.games.map((g) => g.scored + g.allowed))) /
    2
  );
}

export const MIN_TEAM_GAMES = 5;

/** Chance the side hits. points = the side's spread (e.g. -4.5), totalLine for totals. */
export function teamMarketProbability(
  league: League,
  kind: "moneyline" | "spread" | "total",
  args: { me: TeamForm; opp: TeamForm; home: boolean; points?: number | null; side?: string },
): number | null {
  if (args.me.games.length < MIN_TEAM_GAMES || args.opp.games.length < MIN_TEAM_GAMES) return null;
  let p: number;
  if (kind === "total") {
    const pred = expectedTotal(args.me, args.opp);
    const over = 1 - normCdf(((args.points ?? 0) - pred) / TOTAL_SD[league]);
    p = args.side === "Under" ? 1 - over : over;
  } else {
    const pred = expectedMargin(league, args.me, args.opp, args.home);
    p = normCdf((pred + (kind === "spread" ? (args.points ?? 0) : 0)) / MARGIN_SD[league]);
  }
  return Math.min(0.97, Math.max(0.03, p));
}

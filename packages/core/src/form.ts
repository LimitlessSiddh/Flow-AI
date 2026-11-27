import type { FormSummary, GameValue, Window } from "./types.js";

export const WINDOWS = [5, 8, 10] as const;

/** Did a value clear the line for the side being judged? Exactly on the line is a push, which is not a hit. */
export function cleared(value: number, line: number, side: "Over" | "Under" = "Over"): boolean {
  return side === "Under" ? value < line : value > line;
}

/** values are ordered oldest first; null entries are games missed. */
export function summarizeForm(log: GameValue[], line: number, side: "Over" | "Under" = "Over"): FormSummary {
  const played = log.filter((g): g is GameValue & { value: number } => g.value != null).map((g) => g.value);
  const windows: Window[] = [];
  for (const n of WINDOWS) {
    if (played.length < n) continue;
    const slice = played.slice(-n);
    const hits = slice.filter((v) => cleared(v, line, side)).length;
    windows.push({ n, games: n, avg: mean(slice), hits, rate: hits / n });
  }
  const seasonHits = played.filter((v) => cleared(v, line, side)).length;
  let streak = 0;
  for (let i = played.length - 1; i >= 0; i--) {
    if (cleared(played[i]!, line, side)) streak++;
    else break;
  }
  const recentSlots = log.slice(-10);
  return {
    windows,
    season: {
      games: played.length,
      avg: played.length ? mean(played) : 0,
      rate: played.length ? seasonHits / played.length : 0,
      sd: stdev(played),
    },
    streak,
    playedRecent: recentSlots.filter((g) => g.value != null).length,
  };
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

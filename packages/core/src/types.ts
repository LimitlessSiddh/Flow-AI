export type League = "NBA" | "NFL" | "NHL";
export const LEAGUES: readonly League[] = ["NBA", "NFL", "NHL"] as const;

export type MarketKind = "prop" | "moneyline" | "spread" | "total";
export type Side = "Over" | "Under" | "Yes" | string; // team markets use the team code as the side

export type OddsFormat = "american" | "decimal";

/** One game's value for the stat being judged. null = did not play. */
export type GameValue = { date: string; opponent?: string; value: number | null };

export interface Window {
  n: number;
  games: number;
  avg: number;
  hits: number;
  rate: number;
}

export interface FormSummary {
  windows: Window[]; // last 5, 8, 10 (only those with enough games)
  season: { games: number; avg: number; rate: number; sd: number };
  streak: number; // games in a row that cleared, most recent first
  playedRecent: number; // games played in the last 10 slots
}

export type Tier = "Hot" | "Warm" | "Mild";
export type ValueLabel = "Good price" | "Small edge" | "Priced in";
export type Quality = 1 | 2 | 3;

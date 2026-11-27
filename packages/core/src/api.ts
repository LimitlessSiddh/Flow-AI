import type { Tier, ValueLabel } from "./types.js";

/** The API contract shared by the backend and the frontend. */

export interface BoardTeam {
  code: string;
  name: string;
  logo?: string;
  color?: string;
}
export interface BoardGame {
  id: string;
  league: string;
  startTime: string;
  status: string;
  home: BoardTeam;
  away: BoardTeam;
  homeScore: number | null;
  awayScore: number | null;
  playCount: number;
}
export interface PlayPrice {
  book: string;
  bookTitle: string;
  odds: number;
  line: number | null;
  retrievedAt: string;
  origin: string;
  implied: number;
}
export interface PlaySummary {
  id: string;
  date: string;
  league: string;
  gameId: string;
  kind: string;
  subject: string;
  team: string | null;
  position: string | null;
  headshot: string | null;
  stat: string | null;
  statLabel: string;
  unit: string;
  side: string;
  line: number | null;
  /** book: the line came with a real price. estimated: Flow guessed it until you type in Betway's line. */
  lineSource: "book" | "estimated";
  market: string;
  signal: number | null;
  tier: Tier | null;
  model: number | null;
  /** Flow's chance at the price used: the market's chance moved toward recent form */
  estimate: number | null;
  value: number | null;
  valueLabel: ValueLabel | null;
  price: PlayPrice | null;
  isPreferredBook: boolean;
  watch: string[];
  streak: number;
  log: { date: string; opponent?: string; value: number | null }[];
  windows: { n: number; avg: number; hits: number }[];
  seasonAvg: number | null;
  seasonGames: number | null;
  quality: number;
  origin: string;
  saved: boolean;
  dismissed: boolean;
  tracked: boolean;
  result: { won: boolean | null; push: boolean; value: number | null } | null;
}
export interface PlayDetail extends PlaySummary {
  read: string | null;
  counter: string | null;
  availability: { status: string; text: string } | null;
  context: { label: string; recent: number; season: number }[];
  sources: { publisher: string; title: string; url: string; retrievedAt: string; corroborated: boolean }[];
  prices: PlayPrice[];
  researchedBy: string | null;
  updatedAt: string;
}
export interface Board {
  date: string;
  games: BoardGame[];
  plays: PlaySummary[];
  leftOff: { market: string; reason: string }[];
  scan: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    steps: { at: string; text: string; level: string }[];
    oddsCreditsRemaining: number | null;
  } | null;
  record: { won: number; lost: number; pending: number };
  week: { won: number; lost: number };
}

export interface DaySummary {
  date: string;
  plays: number;
  won: number;
  lost: number;
}

export interface StatOption {
  key: string;
  label: string;
  unit: string;
}

export interface Meta {
  today: string;
  timezone: string;
  preferredBook: string;
  leagues: string[];
  stats: Record<string, StatOption[]>;
  oddsApi: boolean;
  research: "claude" | "codex" | "off";
  settings: Record<string, string>;
}

export interface ScanStatus {
  id: string;
  date: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  steps: { at: string; text: string; level: string }[];
  oddsCreditsRemaining: number | null;
  playCount: number | null;
}

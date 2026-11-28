import type { CalibrationBucket, Outcome, RecordStats, SampleStage, TuneResult } from "./record.js";
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
  /** your logged bet on this play, if any */
  pick: { id: string; odds: number | null; outcome: Outcome | null } | null;
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

/** A bet you logged, as the record page shows it. */
export interface PickView {
  id: string;
  playId: string | null;
  date: string;
  league: string;
  gameId: string | null;
  startTime: string | null;
  kind: string;
  subject: string;
  team: string | null;
  stat: string | null;
  statLabel: string;
  side: string;
  line: number | null;
  market: string;
  odds: number | null;
  book: string | null;
  signal: number | null;
  tier: Tier | null;
  /** Flow's chance at your price */
  estimate: number | null;
  value: number | null;
  closeOdds: number | null;
  closeLine: number | null;
  closeBook: string | null;
  /** percentage points; positive = your price beat the close. null when not comparable */
  clv: number | null;
  outcome: Outcome | null;
  resultValue: number | null;
  gradedBy: "flow" | "you" | null;
  /** at STAKE_DOLLARS a pick; null when the price is unknown or it isn't graded */
  profit: number | null;
  source: string;
  note: string | null;
}

export interface RecordSplit {
  key: string;
  label: string;
  stats: RecordStats;
}

export type RecordView = "picks" | "all";

export interface RecordReport {
  view: RecordView;
  from: string | null;
  to: string;
  stake: number;
  stage: SampleStage;
  stats: RecordStats;
  /** past their game by hours and still without a result: the data source missed them, check by hand */
  ungraded: number;
  /** stats.units x stake */
  profit: number;
  byKind: RecordSplit[];
  byLeague: RecordSplit[];
  byTier: RecordSplit[];
  byValue: RecordSplit[];
  byDay: { date: string; stats: RecordStats; profit: number }[];
  calibration: { buckets: CalibrationBucket[]; n: number; brier: number | null };
  /** how far Flow leans on form, and what graded plays say it should be */
  tuning: TuneResult & { needed: number };
  picks: PickView[];
}

export interface PickInput {
  date: string;
  league: string;
  kind: "prop" | "moneyline" | "spread" | "total";
  /** player name for props; team name or code for team markets and totals */
  subject: string;
  stat?: string | null;
  /** Over or Under for props and totals; ignored for team markets */
  side?: "Over" | "Under" | null;
  line?: number | null;
  /** what you typed: -115, +105 or 1.87 */
  odds?: string | null;
  outcome?: Outcome | null;
  note?: string | null;
}

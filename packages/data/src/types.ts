import type { League } from "@flow/core";

export interface TeamRef {
  code: string; // league abbreviation, e.g. BOS, NYJ, TOR
  name: string; // full name, e.g. Boston Celtics
  logo?: string;
  color?: string;
  sourceId: string; // id in the source that produced it (ESPN team id, NHL abbrev)
}

export type GameStatus = "scheduled" | "live" | "final";

export interface Game {
  id: string; // stable id: league-date-away-home
  league: League;
  date: string; // local calendar date of the game
  startTime: string; // ISO instant
  status: GameStatus;
  home: TeamRef;
  away: TeamRef;
  homeScore?: number;
  awayScore?: number;
  sourceId: string;
}

/** Stats Flow knows how to judge. */
export type StatKey =
  | "points"
  | "rebounds"
  | "assists"
  | "threes"
  | "passYds"
  | "rushYds"
  | "recYds"
  | "receptions"
  | "anytimeTd"
  | "shots"
  | "goals";

export const STAT_LABEL: Record<StatKey, { label: string; unit: string }> = {
  points: { label: "Points", unit: "pts" },
  rebounds: { label: "Rebounds", unit: "reb" },
  assists: { label: "Assists", unit: "ast" },
  threes: { label: "Threes made", unit: "threes" },
  passYds: { label: "Passing yards", unit: "yds" },
  rushYds: { label: "Rushing yards", unit: "yds" },
  recYds: { label: "Receiving yards", unit: "yds" },
  receptions: { label: "Receptions", unit: "rec" },
  anytimeTd: { label: "Anytime touchdown", unit: "TDs" },
  shots: { label: "Shots on goal", unit: "shots" },
  goals: { label: "Goals", unit: "goals" },
};

export const LEAGUE_STATS: Record<League, StatKey[]> = {
  NBA: ["points", "rebounds", "assists", "threes"],
  NFL: ["passYds", "rushYds", "recYds", "receptions", "anytimeTd"],
  NHL: ["points", "shots", "goals"],
};

export interface Player {
  id: string; // source-prefixed: espn:123, nhl:8478402
  name: string;
  team: string;
  position?: string;
  league: League;
  headshot?: string;
}

export interface PlayerGame {
  date: string;
  opponent?: string;
  home?: boolean;
  minutes?: number; // NBA minutes or NHL time on ice, in minutes
  stats: Partial<Record<StatKey, number>>;
}

export interface TeamGameResult {
  date: string;
  opponent: string;
  home: boolean;
  scored: number;
  allowed: number;
}

export interface LeagueSource {
  league: League;
  games(date: string): Promise<Game[]>;
  teamResults(team: TeamRef, before: string): Promise<TeamGameResult[]>;
  roster(team: TeamRef): Promise<Player[]>;
  playerLog(player: Player, before: string): Promise<PlayerGame[]>;
}

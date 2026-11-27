import { localDate } from "@flow/core";
import { fetchJson } from "../http.js";
import type { Game, GameStatus, LeagueSource, Player, PlayerGame, TeamGameResult, TeamRef } from "../types.js";

/** The NHL's own public web API (api-web.nhle.com). No key needed. */
const BASE = "https://api-web.nhle.com/v1";

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
const def = (x: unknown): string => str(obj(x).default) || str(x);
const num = (x: unknown): number | undefined =>
  typeof x === "number" ? x : typeof x === "string" && x !== "" && !Number.isNaN(Number(x)) ? Number(x) : undefined;

function status(gameState: string): GameStatus {
  if (gameState === "OFF" || gameState === "FINAL") return "final";
  if (gameState === "LIVE" || gameState === "CRIT") return "live";
  return "scheduled";
}

/** Convert "18:34" time on ice into minutes. */
export function toiMinutes(toi: string): number | undefined {
  const m = /^(\d+):(\d{2})$/.exec(toi);
  return m ? Number(m[1]) + Number(m[2]) / 60 : undefined;
}

export function nhlTeamRef(t: Json): TeamRef {
  const code = str(t.abbrev).toUpperCase();
  const place = def(t.placeName);
  const common = def(t.commonName);
  return {
    code,
    name: def(t.name) || `${place} ${common}`.trim() || code,
    logo: str(t.logo) || `https://assets.nhle.com/logos/nhl/svg/${code}_light.svg`,
    sourceId: code,
  };
}

export class NhlSource implements LeagueSource {
  readonly league = "NHL" as const;
  constructor(private tz: string) {}

  async games(date: string): Promise<Game[]> {
    const body = await fetchJson<Json>(`${BASE}/schedule/${date}`, { ttl: 300 });
    const out: Game[] = [];
    for (const day of arr(body.gameWeek).map(obj)) {
      for (const g of arr(day.games).map(obj)) {
        if (num(g.gameType) !== undefined && num(g.gameType) !== 2 && num(g.gameType) !== 3) continue;
        const startTime = str(g.startTimeUTC);
        const local = localDate(new Date(startTime), this.tz);
        if (local !== date) continue;
        const home = obj(g.homeTeam);
        const away = obj(g.awayTeam);
        const h = nhlTeamRef(home);
        const a = nhlTeamRef(away);
        out.push({
          id: `nhl-${date}-${a.code}-${h.code}`.toLowerCase(),
          league: "NHL",
          date,
          startTime,
          status: status(str(g.gameState)),
          home: h,
          away: a,
          homeScore: num(home.score),
          awayScore: num(away.score),
          sourceId: `nhl:${str(g.id)}`,
        });
      }
    }
    return out;
  }

  async teamResults(team: TeamRef, before: string): Promise<TeamGameResult[]> {
    const body = await fetchJson<Json>(`${BASE}/club-schedule-season/${team.code}/now`, { ttl: 3600 });
    const out: TeamGameResult[] = [];
    for (const g of arr(body.games).map(obj)) {
      if (num(g.gameType) !== 2) continue;
      if (status(str(g.gameState)) !== "final") continue;
      const date = localDate(new Date(str(g.startTimeUTC)), this.tz);
      if (date >= before) continue;
      const home = obj(g.homeTeam);
      const away = obj(g.awayTeam);
      const isHome = str(home.abbrev).toUpperCase() === team.code;
      const me = isHome ? home : away;
      const opp = isHome ? away : home;
      const scored = num(me.score);
      const allowed = num(opp.score);
      if (scored == null || allowed == null) continue;
      out.push({ date, opponent: str(opp.abbrev), home: isHome, scored, allowed });
    }
    return out.sort((x, y) => x.date.localeCompare(y.date));
  }

  async roster(team: TeamRef): Promise<Player[]> {
    const body = await fetchJson<Json>(`${BASE}/roster/${team.code}/current`, { ttl: 6 * 3600 });
    const people = [...arr(body.forwards), ...arr(body.defensemen)].map(obj);
    return people.map((p) => ({
      id: `nhl:${str(p.id)}`,
      name: `${def(p.firstName)} ${def(p.lastName)}`.trim(),
      team: team.code,
      position: str(p.positionCode) || undefined,
      league: "NHL" as const,
      headshot: str(p.headshot) || undefined,
    }));
  }

  async playerLog(player: Player, before: string): Promise<PlayerGame[]> {
    const id = player.id.replace(/^nhl:/, "");
    const body = await fetchJson<Json>(`${BASE}/player/${id}/game-log/now`, { ttl: 3 * 3600 });
    return parseNhlGameLog(body).filter((g) => g.date < before);
  }
}

export function parseNhlGameLog(body: Json): PlayerGame[] {
  return arr(body.gameLog)
    .map(obj)
    .map((g) => ({
      date: str(g.gameDate),
      opponent: str(g.opponentAbbrev) || undefined,
      home: str(g.homeRoadFlag) ? str(g.homeRoadFlag) === "H" : undefined,
      minutes: toiMinutes(str(g.toi)),
      stats: { points: num(g.points), shots: num(g.shots), goals: num(g.goals) },
    }))
    .filter((g) => g.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

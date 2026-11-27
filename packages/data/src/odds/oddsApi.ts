import type { League } from "@flow/core";
import { fetchJson } from "../http.js";
import { normName } from "../names.js";
import type { Game, StatKey } from "../types.js";

/**
 * The Odds API (the-odds-api.com). Free plan: 500 credits a month.
 * Cost per call = markets x regions, and every 10 bookmakers count as one region.
 * Betway Ontario is not covered, so these prices are Flow's labelled backups.
 */
const BASE = "https://api.the-odds-api.com/v4";

export const SPORT_KEY: Record<League, string> = {
  NBA: "basketball_nba",
  NFL: "americanfootball_nfl",
  NHL: "icehockey_nhl",
};

export const PROP_MARKETS: Record<League, Partial<Record<StatKey, string>>> = {
  NBA: { points: "player_points", rebounds: "player_rebounds", assists: "player_assists", threes: "player_threes" },
  NFL: {
    passYds: "player_pass_yds",
    rushYds: "player_rush_yds",
    recYds: "player_reception_yds",
    receptions: "player_receptions",
    anytimeTd: "player_anytime_td",
  },
  NHL: { points: "player_points", shots: "player_shots_on_goal", goals: "player_goal_scorer_anytime" },
};

export type GameMarket = "moneyline" | "spread" | "total";

export interface Quote {
  book: string; // bookmaker key
  bookTitle: string;
  gameId: string;
  kind: GameMarket | "prop";
  stat?: StatKey;
  player?: string;
  side: string; // team code, "Over", "Under", "Yes"
  line: number | null;
  odds: number; // American
  retrievedAt: string; // ISO, the book's last update
}

export interface Credits {
  remaining: number | null;
  used: number | null;
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === "string" ? x : "");

export class OddsApi {
  credits: Credits = { remaining: null, used: null };

  constructor(
    private apiKey: string,
    private bookmakers: string[],
  ) {}

  private track = (h: Headers) => {
    const r = h.get("x-requests-remaining");
    const u = h.get("x-requests-used");
    if (r != null) this.credits.remaining = Number(r);
    if (u != null) this.credits.used = Number(u);
  };

  private books() {
    return encodeURIComponent(this.bookmakers.join(","));
  }

  /** Moneyline, spread and total for every game in a league. Costs 3 credits. */
  async gameLines(league: League, games: Game[]): Promise<Quote[]> {
    if (!games.length) return [];
    const url = `${BASE}/sports/${SPORT_KEY[league]}/odds?apiKey=${this.apiKey}&bookmakers=${this.books()}&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso`;
    const body = await fetchJson<unknown[]>(url, { onHeaders: this.track, retries: 1 });
    return arr(body).flatMap((ev) => parseGameLines(obj(ev), games));
  }

  /** Free call: the Odds API's event ids for a league, needed for props. */
  async events(league: League): Promise<{ id: string; home: string; away: string; commence: string }[]> {
    const url = `${BASE}/sports/${SPORT_KEY[league]}/events?apiKey=${this.apiKey}&dateFormat=iso`;
    const body = await fetchJson<unknown[]>(url, { onHeaders: this.track, ttl: 600 });
    return arr(body)
      .map(obj)
      .map((e) => ({
        id: str(e.id),
        home: str(e.home_team),
        away: str(e.away_team),
        commence: str(e.commence_time),
      }));
  }

  /** Player props for one event. Costs one credit per market. */
  async props(league: League, eventId: string, game: Game, stats: StatKey[]): Promise<Quote[]> {
    const markets = stats.map((s) => PROP_MARKETS[league][s]).filter((m): m is string => !!m);
    if (!markets.length) return [];
    const url = `${BASE}/sports/${SPORT_KEY[league]}/events/${eventId}/odds?apiKey=${this.apiKey}&bookmakers=${this.books()}&markets=${markets.join(",")}&oddsFormat=american&dateFormat=iso`;
    const body = await fetchJson<Json>(url, { onHeaders: this.track, retries: 1 });
    return parseProps(body, league, game);
  }
}

export function matchGame(home: string, away: string, games: Game[]): Game | undefined {
  const h = normName(home);
  const a = normName(away);
  return games.find((g) => normName(g.home.name) === h && normName(g.away.name) === a);
}

export function parseGameLines(ev: Json, games: Game[]): Quote[] {
  const game = matchGame(str(ev.home_team), str(ev.away_team), games);
  if (!game) return [];
  const teamCode = (name: string) =>
    normName(name) === normName(game.home.name)
      ? game.home.code
      : normName(name) === normName(game.away.name)
        ? game.away.code
        : null;
  const out: Quote[] = [];
  for (const bk of arr(ev.bookmakers).map(obj)) {
    for (const m of arr(bk.markets).map(obj)) {
      const key = str(m.key);
      const kind: GameMarket | null =
        key === "h2h" ? "moneyline" : key === "spreads" ? "spread" : key === "totals" ? "total" : null;
      if (!kind) continue;
      for (const o of arr(m.outcomes).map(obj)) {
        const side = kind === "total" ? str(o.name) : teamCode(str(o.name));
        if (!side || typeof o.price !== "number") continue;
        out.push({
          book: str(bk.key),
          bookTitle: str(bk.title),
          gameId: game.id,
          kind,
          side,
          line: typeof o.point === "number" ? o.point : null,
          odds: o.price,
          retrievedAt: str(m.last_update) || str(bk.last_update),
        });
      }
    }
  }
  return out;
}

export function parseProps(body: Json, league: League, game: Game): Quote[] {
  const byMarket = new Map(Object.entries(PROP_MARKETS[league]).map(([stat, m]) => [m, stat as StatKey]));
  const out: Quote[] = [];
  for (const bk of arr(body.bookmakers).map(obj)) {
    for (const m of arr(bk.markets).map(obj)) {
      const stat = byMarket.get(str(m.key));
      if (!stat) continue;
      for (const o of arr(m.outcomes).map(obj)) {
        if (typeof o.price !== "number") continue;
        const yesNo = stat === "anytimeTd" || stat === "goals";
        const name = str(o.name);
        const player = str(o.description) || (yesNo ? name : "");
        if (!player) continue;
        const side = yesNo ? (name === "No" ? "Under" : "Over") : name;
        out.push({
          book: str(bk.key),
          bookTitle: str(bk.title),
          gameId: game.id,
          kind: "prop",
          stat,
          player,
          side,
          line: typeof o.point === "number" ? o.point : yesNo ? 0.5 : null,
          odds: o.price,
          retrievedAt: str(m.last_update) || str(bk.last_update),
        });
      }
    }
  }
  return out;
}

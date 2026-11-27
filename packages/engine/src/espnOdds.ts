import { fetchJson, normName, type Game, type Quote } from "@flow/data";
import type { League } from "@flow/core";

/**
 * Free backup game lines from ESPN's scoreboard (their odds partner, usually DraftKings or ESPN BET).
 * Used when there's no Odds API key, or the key is out of credits. Moneyline, spread and total only.
 */
const PATH: Record<League, string> = { NBA: "basketball/nba", NFL: "football/nfl", NHL: "hockey/nhl" };

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
const num = (x: unknown): number | null => {
  if (typeof x === "number") return x;
  const raw = str(x).trim();
  if (/^even$/i.test(raw)) return 100;
  const s = raw.replace(/^[ou]/i, "").replace(/^\+/, "");
  if (s && !Number.isNaN(Number(s))) return Number(s);
  const o = obj(x);
  if ("american" in o) return num(o.american);
  if ("value" in o) return num(o.value);
  return null;
};

/** ESPN's newer layout keeps prices under close / current / open. Take the latest one present.
 * The newer layout names each side explicitly, so it wins over the older flat fields. */
const latest = (x: unknown, key: "odds" | "line"): number | null => {
  const o = obj(x);
  for (const k of ["close", "current", "open"]) {
    const v = num(obj(o[k])[key]);
    if (v != null) return v;
  }
  return null;
};

export interface EspnLines {
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  /** Home team's spread, e.g. -6.5. */
  spread: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

/**
 * Reads one ESPN odds object. Prices are never guessed: a missing price stays null and that side is skipped.
 * (A guessed -110 on an NHL +1.5 puck line, usually priced near -200, made every one look like great value.)
 */
export function parseEspnOdds(o: Json): EspnLines {
  const home = obj(o.homeTeamOdds);
  const away = obj(o.awayTeamOdds);
  const ml = obj(o.moneyline);
  const ps = obj(o.pointSpread);
  const tot = obj(o.total);
  return {
    homeMoneyline: latest(ml.home, "odds") ?? num(home.moneyLine),
    awayMoneyline: latest(ml.away, "odds") ?? num(away.moneyLine),
    spread: latest(ps.home, "line") ?? num(o.spread),
    homeSpreadOdds: latest(ps.home, "odds") ?? num(home.spreadOdds),
    awaySpreadOdds: latest(ps.away, "odds") ?? num(away.spreadOdds),
    total: latest(tot.over, "line") ?? num(o.overUnder),
    overOdds: latest(tot.over, "odds") ?? num(o.overOdds),
    underOdds: latest(tot.under, "odds") ?? num(o.underOdds),
  };
}

export async function espnGameLines(league: League, date: string, games: Game[]): Promise<Quote[]> {
  if (!games.length) return [];
  const body = await fetchJson<Json>(
    `https://site.api.espn.com/apis/site/v2/sports/${PATH[league]}/scoreboard?dates=${date.replaceAll("-", "")}`,
    { ttl: 600 },
  );
  const out: Quote[] = [];
  for (const e of arr(body.events).map(obj)) {
    const comp = obj(arr(e.competitions)[0]);
    const cs = arr(comp.competitors).map(obj);
    const homeName = str(obj(cs.find((c) => c.homeAway === "home")?.team).displayName);
    const awayName = str(obj(cs.find((c) => c.homeAway === "away")?.team).displayName);
    const game = games.find(
      (g) => normName(g.home.name) === normName(homeName) && normName(g.away.name) === normName(awayName),
    );
    if (!game) continue;
    const o = obj(arr(comp.odds)[0]);
    if (!Object.keys(o).length) continue;
    const provider = str(obj(o.provider).name) || "ESPN odds";
    const book = "espn:" + normName(provider).replace(/ /g, "-");
    const at = new Date().toISOString();
    const push = (kind: Quote["kind"], side: string, line: number | null, odds: number | null) => {
      if (odds == null || Math.abs(odds) < 100) return;
      out.push({ book, bookTitle: provider, gameId: game.id, kind, side, line, odds, retrievedAt: at });
    };
    const l = parseEspnOdds(o);
    push("moneyline", game.home.code, null, l.homeMoneyline);
    push("moneyline", game.away.code, null, l.awayMoneyline);
    if (l.spread != null) {
      push("spread", game.home.code, l.spread, l.homeSpreadOdds);
      push("spread", game.away.code, -l.spread, l.awaySpreadOdds);
    }
    if (l.total != null) {
      push("total", "Over", l.total, l.overOdds);
      push("total", "Under", l.total, l.underOdds);
    }
  }
  return out;
}

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
  const s = str(x).replace(/^\+/, "");
  if (s && !Number.isNaN(Number(s))) return Number(s);
  const o = obj(x);
  if ("american" in o) return num(o.american);
  if ("value" in o) return num(o.value);
  return null;
};

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
    const home = obj(o.homeTeamOdds);
    const away = obj(o.awayTeamOdds);
    const push = (kind: Quote["kind"], side: string, line: number | null, odds: number | null) => {
      if (odds == null || Math.abs(odds) < 100) return;
      out.push({ book, bookTitle: provider, gameId: game.id, kind, side, line, odds, retrievedAt: at });
    };
    push("moneyline", game.home.code, null, num(home.moneyLine));
    push("moneyline", game.away.code, null, num(away.moneyLine));
    const spread = num(o.spread); // from the home team's view
    if (spread != null) {
      push("spread", game.home.code, spread, num(home.spreadOdds) ?? -110);
      push("spread", game.away.code, -spread, num(away.spreadOdds) ?? -110);
    }
    const total = num(o.overUnder);
    if (total != null) {
      push("total", "Over", total, num(o.overOdds) ?? -110);
      push("total", "Under", total, num(o.underOdds) ?? -110);
    }
  }
  return out;
}

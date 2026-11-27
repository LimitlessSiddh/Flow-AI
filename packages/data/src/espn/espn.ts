import type { League } from "@flow/core";
import { localDate } from "@flow/core";
import { fetchJson } from "../http.js";
import type { Game, GameStatus, LeagueSource, Player, PlayerGame, StatKey, TeamGameResult, TeamRef } from "../types.js";

/**
 * ESPN's public JSON (the same feeds espn.com uses). Unofficial and undocumented,
 * fine for a personal tool; every parse is defensive because fields move.
 */
const PATH: Record<"NBA" | "NFL", string> = { NBA: "basketball/nba", NFL: "football/nfl" };
const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
const num = (x: unknown): number | undefined => {
  if (typeof x === "number") return x;
  if (typeof x === "string" && x.trim() !== "" && !Number.isNaN(Number(x))) return Number(x);
  const o = obj(x);
  if ("value" in o) return num(o.value);
  if ("displayValue" in o) return num(o.displayValue);
  return undefined;
};

export class EspnSource implements LeagueSource {
  constructor(
    readonly league: "NBA" | "NFL",
    private tz: string,
  ) {}

  private get path() {
    return PATH[this.league];
  }

  async games(date: string): Promise<Game[]> {
    const ymd = date.replaceAll("-", "");
    const body = await fetchJson<Json>(`${SITE}/${this.path}/scoreboard?dates=${ymd}`, { ttl: 300 });
    return arr(body.events)
      .map((e) => this.parseEvent(obj(e)))
      .filter((g): g is Game => !!g && g.date === date);
  }

  parseEvent(e: Json): Game | null {
    const comp = obj(arr(e.competitions)[0]);
    const cs = arr(comp.competitors).map(obj);
    const home = cs.find((c) => c.homeAway === "home");
    const away = cs.find((c) => c.homeAway === "away");
    if (!home || !away) return null;
    const startTime = str(e.date);
    const state = str(obj(obj(e.status ?? comp.status).type).state);
    const status: GameStatus = state === "post" ? "final" : state === "in" ? "live" : "scheduled";
    const h = teamRef(obj(home.team));
    const a = teamRef(obj(away.team));
    const date = localDate(new Date(startTime), this.tz);
    return {
      id: `${this.league.toLowerCase()}-${date}-${a.code}-${h.code}`.toLowerCase(),
      league: this.league,
      date,
      startTime,
      status,
      home: h,
      away: a,
      homeScore: num(home.score),
      awayScore: num(away.score),
      sourceId: `espn:${str(e.id)}`,
    };
  }

  async teamResults(team: TeamRef, before: string): Promise<TeamGameResult[]> {
    const body = await fetchJson<Json>(`${SITE}/${this.path}/teams/${team.sourceId}/schedule`, { ttl: 3600 });
    const out: TeamGameResult[] = [];
    for (const raw of arr(body.events)) {
      const e = obj(raw);
      const comp = obj(arr(e.competitions)[0]);
      if (str(obj(obj(comp.status).type).state) !== "post") continue;
      const cs = arr(comp.competitors).map(obj);
      const me = cs.find((c) => str(obj(c.team).id) === team.sourceId);
      const opp = cs.find((c) => c !== me);
      if (!me || !opp) continue;
      const scored = num(me.score);
      const allowed = num(opp.score);
      if (scored == null || allowed == null) continue;
      const date = localDate(new Date(str(e.date)), this.tz);
      if (date >= before) continue;
      out.push({
        date,
        opponent: str(obj(opp.team).abbreviation),
        home: me.homeAway === "home",
        scored,
        allowed,
      });
    }
    return out.sort((x, y) => x.date.localeCompare(y.date));
  }

  async roster(team: TeamRef): Promise<Player[]> {
    const body = await fetchJson<Json>(`${SITE}/${this.path}/teams/${team.sourceId}/roster`, { ttl: 6 * 3600 });
    // NBA: athletes is a flat list. NFL: athletes is grouped by unit with `items`.
    const flat = arr(body.athletes).flatMap((a) => {
      const o = obj(a);
      return Array.isArray(o.items) ? o.items : [o];
    });
    return flat.map(obj).map((a) => ({
      id: `espn:${str(a.id)}`,
      name: str(a.displayName ?? a.fullName),
      team: team.code,
      position: str(obj(a.position).abbreviation) || undefined,
      league: this.league as League,
      headshot: str(obj(a.headshot).href) || undefined,
    }));
  }

  async playerLog(player: Player, before: string): Promise<PlayerGame[]> {
    const id = player.id.replace(/^espn:/, "");
    const body = await fetchJson<Json>(`${WEB}/${this.path}/athletes/${id}/gamelog`, { ttl: 3 * 3600 });
    return parseEspnGamelog(body, this.league, this.tz).filter((g) => g.date < before);
  }
}

function teamRef(t: Json): TeamRef {
  const logos = arr(t.logos).map(obj);
  return {
    code: str(t.abbreviation).toUpperCase(),
    name: str(t.displayName) || `${str(t.location)} ${str(t.name)}`.trim(),
    logo: str(t.logo) || str(logos[0]?.href) || undefined,
    color: t.color ? `#${str(t.color)}` : undefined,
    sourceId: str(t.id),
  };
}

const NBA_MAP: Record<string, StatKey> = {
  points: "points",
  totalRebounds: "rebounds",
  rebounds: "rebounds",
  assists: "assists",
};
const NFL_MAP: Record<string, StatKey> = {
  passingYards: "passYds",
  rushingYards: "rushYds",
  receivingYards: "recYds",
  receptions: "receptions",
};

/**
 * ESPN gamelog: `names` lists stat keys, `seasonTypes[].categories[].events[]` holds rows of `stats`
 * aligned to those names, and `events` maps eventId to game info. NFL repeats keys per category
 * (rushing, receiving...), so the names array for a row is found by matching its length.
 */
export function parseEspnGamelog(body: Json, league: "NBA" | "NFL", tz: string): PlayerGame[] {
  const topNames = arr(body.names).map(str);
  const catNames = arr(body.categories).map((c) => arr(obj(c).names).map(str));
  const allCatNames = catNames.flat();
  const events = obj(body.events);
  const rows = new Map<string, PlayerGame>();
  const map = league === "NBA" ? NBA_MAP : NFL_MAP;

  for (const st of arr(body.seasonTypes).map(obj)) {
    const label = str(st.displayName).toLowerCase();
    if (label && !label.includes("regular")) continue; // skip preseason / postseason
    for (const cat of arr(st.categories).map(obj)) {
      for (const ev of arr(cat.events).map(obj)) {
        const stats = arr(ev.stats).map(str);
        const names =
          topNames.length === stats.length
            ? topNames
            : allCatNames.length === stats.length
              ? allCatNames
              : (catNames.find((n) => n.length === stats.length) ?? []);
        if (!names.length) continue;
        const eventId = str(ev.eventId);
        const info = obj(events[eventId]);
        const iso = str(info.gameDate);
        if (!iso) continue;
        const row: PlayerGame = rows.get(eventId) ?? {
          date: localDate(new Date(iso), tz),
          opponent: str(obj(info.opponent).abbreviation) || undefined,
          home: str(info.atVs) ? str(info.atVs) !== "@" : undefined,
          stats: {},
        };
        let tds = row.stats.anytimeTd ?? 0;
        names.forEach((name, i) => {
          const raw = stats[i] ?? "";
          if (name === "minutes") row.minutes = num(raw);
          if (name === "threePointFieldGoalsMade-threePointFieldGoalsAttempted") {
            const made = num(raw.split("-")[0]);
            if (made != null) row.stats.threes = made;
          }
          if (league === "NFL" && (name === "rushingTouchdowns" || name === "receivingTouchdowns")) {
            tds += num(raw) ?? 0;
          }
          const key = map[name];
          const v = num(raw);
          if (key && v != null) row.stats[key] = v;
        });
        if (league === "NFL") row.stats.anytimeTd = tds;
        rows.set(eventId, row);
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

import { addDays, gradeOutcome, type League } from "@flow/core";
import { findByName, type LeagueSource, type Player, type PlayerGame, type StatKey } from "@flow/data";
import {
  and,
  eq,
  games as gamesT,
  isNull,
  picks as picksT,
  playHistory,
  plays as playsT,
  results as resultsT,
  type Db,
  type GameRow,
} from "@flow/db";

export interface SettleSummary {
  /** board plays graded */
  plays: number;
  /** history rows graded (every play Flow showed) */
  history: number;
  /** your picks graded */
  picks: number;
}

/** What grading needs to know about a market. */
interface Gradable {
  gameId: string | null;
  league: string;
  kind: string;
  subject: string;
  subjectId: string | null;
  team: string | null;
  stat: string | null;
  side: string;
  line: number | null;
}

/**
 * Grade a date once its games are final: the board's plays, Flow's history and your picks.
 * Team markets use the final score; props use the player's game log for that date.
 * A pick you graded yourself is left alone. Safe to run again: only ungraded rows change.
 */
export async function settleDate(
  db: Db,
  sources: Record<League, LeagueSource>,
  date: string,
  now = new Date(),
): Promise<SettleSummary> {
  await refreshFinals(db, sources, date);
  const resolve = resultResolver(db, sources, date);
  const at = now.toISOString();
  const out: SettleSummary = { plays: 0, history: 0, picks: 0 };

  const open = db
    .select({ p: playsT })
    .from(playsT)
    .leftJoin(resultsT, eq(resultsT.playId, playsT.id))
    .where(and(eq(playsT.date, date), isNull(resultsT.playId)))
    .all()
    .map((r) => r.p);
  for (const p of open) {
    const r = await resolve(p);
    if (r === undefined) continue;
    const outcome = gradeOutcome(p.kind, p.side, p.line, r);
    db.insert(resultsT)
      .values({
        playId: p.id,
        value: r,
        won: outcome === "win" ? true : outcome === "loss" ? false : null,
        push: outcome === "push" || outcome === "void",
        settledAt: at,
      })
      .onConflictDoNothing()
      .run();
    out.plays++;
  }

  const history = db
    .select()
    .from(playHistory)
    .where(and(eq(playHistory.date, date), isNull(playHistory.outcome)))
    .all();
  for (const h of history) {
    const r = await resolve(h);
    if (r === undefined) continue;
    db.update(playHistory)
      .set({ outcome: gradeOutcome(h.kind, h.side, h.line, r), resultValue: r, gradedAt: at })
      .where(eq(playHistory.playId, h.playId))
      .run();
    out.history++;
  }

  const mine = db
    .select()
    .from(picksT)
    .where(and(eq(picksT.date, date), isNull(picksT.outcome)))
    .all();
  for (const k of mine) {
    const r = await resolve(k);
    if (r === undefined) continue;
    db.update(picksT)
      .set({
        outcome: gradeOutcome(k.kind, k.side, k.line, r),
        resultValue: r,
        gradedAt: at,
        gradedBy: "flow",
        updatedAt: at,
      })
      .where(eq(picksT.id, k.id))
      .run();
    out.picks++;
  }
  return out;
}

/** Pull final scores for every league with games or picks on this date. */
async function refreshFinals(db: Db, sources: Record<League, LeagueSource>, date: string) {
  const leagues = new Set([
    ...db
      .select({ l: gamesT.league })
      .from(gamesT)
      .where(eq(gamesT.date, date))
      .all()
      .map((r) => r.l),
    ...db
      .select({ l: picksT.league })
      .from(picksT)
      .where(eq(picksT.date, date))
      .all()
      .map((r) => r.l),
  ]);
  for (const lg of leagues) {
    const src = sources[lg as League];
    if (!src) continue;
    try {
      for (const g of await src.games(date)) {
        const row = { ...g, homeScore: g.homeScore ?? null, awayScore: g.awayScore ?? null };
        db.insert(gamesT)
          .values({ ...row, updatedAt: new Date().toISOString() })
          .onConflictDoUpdate({
            target: gamesT.id,
            set: {
              status: g.status,
              homeScore: row.homeScore,
              awayScore: row.awayScore,
              updatedAt: new Date().toISOString(),
            },
          })
          .run();
      }
    } catch {
      /* keep what we have */
    }
  }
}

/**
 * Returns a function that finds a market's result: the stat, margin or total to grade against.
 * undefined = can't grade yet (game not final, or the data isn't there); null = the player didn't play.
 * Game logs are fetched once per player.
 */
function resultResolver(db: Db, sources: Record<League, LeagueSource>, date: string) {
  const games = new Map<string, GameRow | undefined>();
  const logs = new Map<string, Promise<PlayerGame[]>>();
  const rosters = new Map<string, Promise<Player[]>>();
  const game = (id: string) => {
    if (!games.has(id)) games.set(id, db.select().from(gamesT).where(eq(gamesT.id, id)).get());
    return games.get(id);
  };
  const roster = (src: LeagueSource, t: GameRow["home"]) => {
    const k = `${src.league}:${t.code}`;
    if (!rosters.has(k))
      rosters.set(
        k,
        src.roster(t).catch(() => []),
      );
    return rosters.get(k)!;
  };

  return async (m: Gradable): Promise<number | null | undefined> => {
    if (!m.gameId) return undefined;
    const g = game(m.gameId);
    if (!g || g.status !== "final" || g.homeScore == null || g.awayScore == null) return undefined;
    if (m.kind === "moneyline" || m.kind === "spread") {
      if (m.side !== g.home.code && m.side !== g.away.code) return undefined;
      const home = m.side === g.home.code;
      return home ? g.homeScore - g.awayScore : g.awayScore - g.homeScore;
    }
    if (m.kind === "total") return g.homeScore + g.awayScore;
    if (m.kind !== "prop" || !m.stat) return undefined;

    const src = sources[m.league as League];
    if (!src) return undefined;
    let player: Player | undefined = m.subjectId
      ? { id: m.subjectId, name: m.subject, team: m.team ?? "", league: m.league as League }
      : undefined;
    if (!player) {
      const all = [...(await roster(src, g.home)), ...(await roster(src, g.away))];
      player = findByName(all, m.subject);
    }
    if (!player) return undefined;
    if (!logs.has(player.id))
      logs.set(
        player.id,
        src.playerLog(player, addDays(date, 1)).catch(() => []),
      );
    const log = await logs.get(player.id)!;
    const row = log.find((x) => x.date === date);
    // A final game with no line for the player = did not play; books void these.
    if (!row) return log.length ? null : undefined;
    return row.stats[m.stat as StatKey] ?? undefined;
  };
}

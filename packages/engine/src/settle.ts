import { addDays, cleared, type League } from "@flow/core";
import type { LeagueSource, StatKey } from "@flow/data";
import { and, eq, games as gamesT, isNull, plays as playsT, results as resultsT, type Db } from "@flow/db";

/**
 * Grade a date's plays once their games are final. Team markets use the final score;
 * props use the player's game log for that date.
 */
export async function settleDate(db: Db, sources: Record<League, LeagueSource>, date: string) {
  const leagues = [
    ...new Set(
      db
        .select({ l: gamesT.league })
        .from(gamesT)
        .where(eq(gamesT.date, date))
        .all()
        .map((r) => r.l),
    ),
  ];
  for (const lg of leagues) {
    try {
      for (const g of await sources[lg as League].games(date)) {
        db.update(gamesT)
          .set({
            status: g.status,
            homeScore: g.homeScore ?? null,
            awayScore: g.awayScore ?? null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(gamesT.id, g.id))
          .run();
      }
    } catch {
      /* keep what we have */
    }
  }
  const open = db
    .select({ p: playsT })
    .from(playsT)
    .leftJoin(resultsT, eq(resultsT.playId, playsT.id))
    .where(and(eq(playsT.date, date), isNull(resultsT.playId)))
    .all()
    .map((r) => r.p);
  let settled = 0;
  for (const p of open) {
    const game = db.select().from(gamesT).where(eq(gamesT.id, p.gameId)).get();
    if (!game || game.status !== "final" || game.homeScore == null || game.awayScore == null) continue;
    let value: number | null = null;
    let line = p.line ?? 0;
    const side: "Over" | "Under" = p.side === "Under" ? "Under" : "Over";
    if (p.kind === "moneyline") {
      const mine = p.side === game.home.code ? game.homeScore : game.awayScore;
      const theirs = p.side === game.home.code ? game.awayScore : game.homeScore;
      value = mine - theirs;
      line = 0;
    } else if (p.kind === "spread") {
      const mine = p.side === game.home.code ? game.homeScore : game.awayScore;
      const theirs = p.side === game.home.code ? game.awayScore : game.homeScore;
      value = mine - theirs;
      line = -(p.line ?? 0);
    } else if (p.kind === "total") {
      value = game.homeScore + game.awayScore;
    } else if (p.subjectId && p.stat) {
      const src = sources[p.league as League];
      const player = { id: p.subjectId, name: p.subject, team: p.team ?? "", league: p.league as League };
      const log = await src.playerLog(player, addDays(date, 1)).catch(() => []);
      const g = log.find((x) => x.date === date);
      if (!g) {
        // final game with no line for the player = did not play; bets are usually voided
        db.insert(resultsT).values({ playId: p.id, value: null, won: null, push: true }).run();
        settled++;
        continue;
      }
      value = g.stats[p.stat as StatKey] ?? null;
    }
    if (value == null) continue;
    const push = value === line;
    db.insert(resultsT)
      .values({ playId: p.id, value, won: push ? null : cleared(value, line, side), push })
      .onConflictDoNothing()
      .run();
    settled++;
  }
  return settled;
}

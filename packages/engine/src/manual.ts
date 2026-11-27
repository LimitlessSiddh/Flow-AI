import type { League } from "@flow/core";
import { findByName, type Game, type StatKey } from "@flow/data";
import { eq, games as gamesT, plays as playsT, type Db } from "@flow/db";
import { propEvidence, score, toPlayRow, type Market } from "./analyze.js";
import type { Config } from "./config.js";
import { refreshFlags, type ScanDeps } from "./scan.js";
import { MANUAL_BOOK } from "./ids.js";
import { setManualPrice } from "./board.js";

export interface ManualPlayInput {
  date: string;
  league: League;
  player: string;
  stat: StatKey;
  side: "Over" | "Under";
  line: number;
  odds: number; // American, from your Betway app
}

export class ManualPlayError extends Error {}

/** Score a prop you found on Betway yourself. Flow finds the player's game and pulls the logs. */
export async function addManualPlay(db: Db, cfg: Config, deps: ScanDeps, input: ManualPlayInput) {
  const src = deps.sources[input.league];
  let games: Game[] = db
    .select()
    .from(gamesT)
    .where(eq(gamesT.date, input.date))
    .all()
    .filter((g) => g.league === input.league)
    .map((g) => ({
      ...g,
      league: g.league as League,
      status: g.status as Game["status"],
      homeScore: g.homeScore ?? undefined,
      awayScore: g.awayScore ?? undefined,
    }));
  if (!games.length) {
    games = await src.games(input.date);
    for (const g of games) {
      const row = { ...g, homeScore: g.homeScore ?? null, awayScore: g.awayScore ?? null };
      db.insert(gamesT).values(row).onConflictDoUpdate({ target: gamesT.id, set: row }).run();
    }
  }
  if (!games.length) throw new ManualPlayError(`No ${input.league} games on ${input.date}.`);

  for (const game of games) {
    const roster = [
      ...(await src.roster(game.home).catch(() => [])),
      ...(await src.roster(game.away).catch(() => [])),
    ];
    const player = findByName(roster, input.player);
    if (!player) continue;
    const m: Market = {
      date: input.date,
      game,
      kind: "prop",
      subject: player.name,
      team: player.team,
      stat: input.stat,
      side: input.side,
      line: input.line,
    };
    const log = await src.playerLog(player, input.date);
    const ev = {
      ...propEvidence(log, input.stat, input.line, input.side),
      position: player.position,
      subjectId: player.id,
      headshot: player.headshot,
    };
    const s = score(ev);
    const row = toPlayRow(m, ev, s, null, "manual");
    db.insert(playsT).values(row).onConflictDoUpdate({ target: playsT.id, set: row }).run();
    setManualPrice(db, row.id!, input.odds, input.line);
    refreshFlags(db, input.date, [MANUAL_BOOK, ...cfg.bookmakers]);
    return row.id!;
  }
  throw new ManualPlayError(
    `Couldn't find ${input.player} on a ${input.league} team playing on ${input.date}.`,
  );
}

/**
 * You typed Betway's line for a prop, and it differs from the line Flow scored (often an estimated one).
 * Re-score the play at your line from fresh game logs, so Signal and Value match the bet you'd place.
 * Keeps the play's research text and your saved or tracked state.
 */
export async function rescorePropAtLine(db: Db, deps: ScanDeps, id: string, line: number): Promise<boolean> {
  const play = db.select().from(playsT).where(eq(playsT.id, id)).get();
  if (!play || play.kind !== "prop" || !play.stat) return false;
  if (play.line === line && play.lineSource !== "estimated") return false;
  const g = db.select().from(gamesT).where(eq(gamesT.id, play.gameId)).get();
  if (!g) throw new ManualPlayError("Couldn't find this play's game.");
  const game: Game = {
    ...g,
    league: g.league as League,
    status: g.status as Game["status"],
    homeScore: g.homeScore ?? undefined,
    awayScore: g.awayScore ?? undefined,
  };
  const src = deps.sources[game.league];
  const roster = [
    ...(await src.roster(game.home).catch(() => [])),
    ...(await src.roster(game.away).catch(() => [])),
  ];
  const player = roster.find((p) => p.id === play.subjectId) ?? findByName(roster, play.subject);
  if (!player) throw new ManualPlayError(`Couldn't load ${play.subject}'s game log right now.`);
  const stat = play.stat as StatKey;
  const m: Market = {
    date: play.date,
    game,
    kind: "prop",
    subject: play.subject,
    team: play.team ?? player.team,
    stat,
    side: play.side,
    line,
  };
  const ev = {
    ...propEvidence(await src.playerLog(player, play.date), stat, line, play.side),
    position: player.position,
    subjectId: player.id,
    headshot: player.headshot,
  };
  const row = toPlayRow(m, ev, score(ev), play.scanId, play.origin === "manual" ? "manual" : "scan");
  db.update(playsT)
    .set({
      line,
      lineSource: "book",
      signal: row.signal,
      model: row.model,
      log: row.log,
      windows: row.windows,
      seasonAvg: row.seasonAvg,
      seasonGames: row.seasonGames,
      seasonRate: row.seasonRate,
      streak: row.streak,
      ...(play.researchedBy ? {} : { read: row.read, counter: row.counter }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(playsT.id, id))
    .run();
  return true;
}

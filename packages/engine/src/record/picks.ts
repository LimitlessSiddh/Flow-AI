import { betValue, flowEstimate, MODEL_VERSION, parseOdds, type League, type PickInput } from "@flow/core";
import { findByName, normName, type Game, type LeagueSource, type Player } from "@flow/data";
import {
  and,
  eq,
  games as gamesT,
  picks as picksT,
  plays as playsT,
  userState,
  type Db,
  type GameRow,
  type NewPick,
  type PickRow,
  type PlayRow,
} from "@flow/db";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPlay, type BoardOptions } from "../board.js";
import { playId as makePlayId } from "../ids.js";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const OutcomeSchema = z.enum(["win", "loss", "push", "void"]);

/** What a typed-in pick must look like, from the API or an import file. */
export const PickInputSchema = z.object({
  date: IsoDate,
  league: z.enum(["NBA", "NFL", "NHL"]),
  kind: z.enum(["prop", "moneyline", "spread", "total"]),
  subject: z.string().trim().min(2, "Type the player or team").max(80),
  stat: z.string().max(20).nullish(),
  side: z.enum(["Over", "Under"]).nullish(),
  line: z.number().min(-100).max(1000).nullish(),
  // a number in a file (2.10 or -115) is read the same as typed text
  odds: z
    .union([z.string().max(12), z.number()])
    .nullish()
    .transform((x) => (x == null ? x : String(x))),
  outcome: OutcomeSchema.nullish(),
  note: z.string().max(280).nullish(),
});

export const PickPatchSchema = z
  .object({
    odds: z.string().max(12).nullable(),
    line: z.number().min(-100).max(1000).nullable(),
    outcome: OutcomeSchema.nullable(),
    note: z.string().max(280).nullable(),
  })
  .partial();

/** A pick Flow couldn't log, with a reason you can act on. */
export class PickError extends Error {}

/**
 * Log the bet you placed on a play from the board. Snapshots the play, Flow's numbers and the price
 * Flow had (your Betway price if you typed one). Logging the same play again refreshes the snapshot
 * unless it's already graded.
 */
export function pickFromPlay(db: Db, playId: string, o: BoardOptions, now = new Date()): PickRow {
  const p = getPlay(db, playId, o);
  if (!p) throw new PickError("That play isn't on the board anymore.");
  const play = db.select().from(playsT).where(eq(playsT.id, playId)).get()!;
  const game = db.select().from(gamesT).where(eq(gamesT.id, p.gameId)).get();
  const existing = db.select().from(picksT).where(eq(picksT.playId, playId)).get();
  if (existing?.outcome) return existing;
  const at = now.toISOString();
  const row: NewPick = {
    id: existing?.id ?? randomUUID(),
    playId,
    date: p.date,
    league: p.league,
    gameId: p.gameId,
    startTime: game?.startTime ?? null,
    kind: p.kind,
    subject: p.subject,
    subjectId: play.subjectId,
    team: p.team,
    stat: p.stat,
    side: p.side,
    line: p.line,
    odds: p.price?.odds ?? null,
    book: p.price?.book ?? null,
    signal: p.signal,
    model: p.model,
    estimate: p.estimate,
    value: p.value,
    modelVersion: MODEL_VERSION,
    source: existing?.source ?? "board",
    note: existing?.note ?? null,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  db.insert(picksT).values(row).onConflictDoUpdate({ target: picksT.id, set: row }).run();
  return db.select().from(picksT).where(eq(picksT.id, row.id!)).get()!;
}

/**
 * Log a bet you typed in yourself: one Flow didn't list, or one from a past day.
 * Flow finds the game (and the player, for props). If it had a play on the same market and line, the pick
 * is linked to it and keeps Flow's numbers at your price. With an outcome, the pick counts as graded by you.
 */
export async function logPick(
  db: Db,
  sources: Record<League, LeagueSource>,
  input: PickInput,
  o: BoardOptions,
  now = new Date(),
  source: "manual" | "import" = "manual",
): Promise<PickRow> {
  const league = input.league as League;
  const src = sources[league];
  if (!src) throw new PickError(`Flow doesn't cover ${input.league}.`);
  const odds = input.odds ? parseOdds(input.odds) : null;
  if (input.odds && odds == null)
    throw new PickError(`Couldn't read the price "${input.odds}". Type -115, +105 or 1.87.`);
  if (input.kind !== "moneyline" && input.line == null) throw new PickError("Add the line, e.g. 8.5.");

  const games = await gamesOn(db, src, input.date, league);
  if (!games.length) throw new PickError(`No ${league} games found on ${input.date}.`);

  let game: GameRow;
  let subject: string;
  let side: string;
  let team: string | null = null;
  let subjectId: string | null = null;
  let stat: string | null = null;
  if (input.kind === "prop") {
    if (!input.stat) throw new PickError("Pick the stat, e.g. points.");
    const found = await findPlayer(src, games, input.subject);
    if (!found)
      throw new PickError(`Couldn't find ${input.subject} on a ${league} team playing on ${input.date}.`);
    game = found.game;
    subject = found.player.name;
    subjectId = found.player.id;
    team = found.player.team;
    stat = input.stat;
    side = input.side === "Under" ? "Under" : "Over";
  } else {
    const found = findTeam(games, input.subject);
    game = found.game;
    if (input.kind === "total") {
      subject = `${game.away.code} @ ${game.home.code}`;
      side = input.side === "Under" ? "Under" : "Over";
    } else {
      subject = found.code;
      side = found.code;
      team = found.code;
    }
  }
  const line = input.kind === "moneyline" ? null : (input.line ?? null);
  const id = makePlayId({
    date: input.date,
    league,
    kind: input.kind,
    subject: input.kind === "total" ? game.id : subject,
    stat,
    side,
  });
  const play = db.select().from(playsT).where(eq(playsT.id, id)).get();
  const existing = db.select().from(picksT).where(eq(picksT.playId, id)).get();
  // No price typed: keep the one already logged, else the price Flow had for the same line.
  let price: { odds: number; book: string } | null = odds != null ? { odds, book: "betway" } : null;
  if (!price && existing?.odds != null) price = { odds: existing.odds, book: existing.book ?? "betway" };
  if (!price && play && (play.kind === "moneyline" || play.line === line)) {
    const p = getPlay(db, id, o)?.price;
    if (p) price = { odds: p.odds, book: p.book };
  }
  const at = now.toISOString();
  const graded = input.outcome
    ? { outcome: input.outcome, gradedBy: "you", gradedAt: at, resultValue: null }
    : { outcome: null, gradedBy: null, gradedAt: null, resultValue: null };
  const row: NewPick = {
    id: existing?.id ?? randomUUID(),
    playId: play ? id : null,
    date: input.date,
    league,
    gameId: game.id,
    startTime: game.startTime,
    kind: input.kind,
    subject,
    subjectId,
    team,
    stat,
    side,
    line,
    odds: price?.odds ?? null,
    book: price?.book ?? null,
    ...flowNumbers(play, line, price?.odds ?? null),
    source: existing?.source ?? source,
    note: input.note?.trim() || null,
    ...graded,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  db.insert(picksT).values(row).onConflictDoUpdate({ target: picksT.id, set: row }).run();
  return db.select().from(picksT).where(eq(picksT.id, row.id!)).get()!;
}

export type PickPatch = z.infer<typeof PickPatchSchema>;

/** Fix a pick: the price you got, the line, or the result. outcome null hands grading back to Flow. */
export function updatePick(db: Db, id: string, patch: PickPatch, now = new Date()): PickRow {
  const cur = db.select().from(picksT).where(eq(picksT.id, id)).get();
  if (!cur) throw new PickError("Pick not found.");
  const at = now.toISOString();
  const next: Partial<NewPick> = { updatedAt: at };
  if (patch.odds !== undefined) {
    const odds = patch.odds ? parseOdds(patch.odds) : null;
    if (patch.odds && odds == null) throw new PickError(`Couldn't read the price "${patch.odds}".`);
    next.odds = odds;
    next.book = odds != null ? "betway" : null;
  }
  if (patch.line !== undefined && cur.kind !== "moneyline") next.line = patch.line;
  if (patch.note !== undefined) next.note = patch.note?.trim() || null;
  if (patch.outcome !== undefined) {
    Object.assign(
      next,
      patch.outcome
        ? { outcome: patch.outcome, gradedBy: "you", gradedAt: at }
        : { outcome: null, gradedBy: null, gradedAt: null, resultValue: null },
    );
  }
  if (next.odds !== undefined || next.line !== undefined) {
    const play = cur.playId ? db.select().from(playsT).where(eq(playsT.id, cur.playId)).get() : undefined;
    const line = next.line !== undefined ? next.line : cur.line;
    const odds = next.odds !== undefined ? next.odds : cur.odds;
    // without the play (it can leave the board), keep the stored model and recompute at the new price
    Object.assign(next, play ? flowNumbers(play, line, odds) : flowNumbersFromModel(cur, line, odds));
  }
  db.update(picksT).set(next).where(eq(picksT.id, id)).run();
  return db.select().from(picksT).where(eq(picksT.id, id)).get()!;
}

export function deletePick(db: Db, id: string): boolean {
  const cur = db.select().from(picksT).where(eq(picksT.id, id)).get();
  if (!cur) return false;
  db.delete(picksT).where(eq(picksT.id, id)).run();
  return true;
}

/** Before picks existed, "Track result" set a flag. Turn each tracked play into a pick, once. */
export function migrateTrackedPlays(db: Db, o: BoardOptions, now = new Date()): number {
  const tracked = db.select().from(userState).where(eq(userState.tracked, true)).all();
  let n = 0;
  for (const t of tracked) {
    const hasPick = db.select({ id: picksT.id }).from(picksT).where(eq(picksT.playId, t.playId)).get();
    const hasPlay = db.select({ id: playsT.id }).from(playsT).where(eq(playsT.id, t.playId)).get();
    if (!hasPick && hasPlay) {
      pickFromPlay(db, t.playId, o, now);
      n++;
    }
    db.update(userState).set({ tracked: false }).where(eq(userState.playId, t.playId)).run();
  }
  return n;
}

/** Flow's numbers for a pick: only when the pick is on the same line Flow judged. */
function flowNumbers(play: PlayRow | undefined, line: number | null, odds: number | null) {
  const empty = { signal: null, model: null, estimate: null, value: null, modelVersion: null };
  if (!play) return empty;
  if (play.kind !== "moneyline" && play.line !== line) return empty;
  return {
    signal: play.signal,
    model: play.model,
    estimate: flowEstimate(play.model, odds),
    value: betValue(play.model, odds),
    modelVersion: MODEL_VERSION,
  };
}

function flowNumbersFromModel(cur: PickRow, line: number | null, odds: number | null) {
  if (cur.model == null || line !== cur.line) return { estimate: null, value: null };
  return { estimate: flowEstimate(cur.model, odds), value: betValue(cur.model, odds) };
}

async function gamesOn(db: Db, src: LeagueSource, date: string, league: League): Promise<GameRow[]> {
  const stored = db
    .select()
    .from(gamesT)
    .where(and(eq(gamesT.date, date), eq(gamesT.league, league)))
    .all();
  if (stored.length) return stored;
  let fetched: Game[];
  try {
    fetched = await src.games(date);
  } catch {
    throw new PickError(
      `Couldn't load the ${league} schedule for ${date}. Check your internet and try again.`,
    );
  }
  for (const g of fetched) {
    const row = { ...g, homeScore: g.homeScore ?? null, awayScore: g.awayScore ?? null };
    db.insert(gamesT).values(row).onConflictDoUpdate({ target: gamesT.id, set: row }).run();
  }
  return db
    .select()
    .from(gamesT)
    .where(and(eq(gamesT.date, date), eq(gamesT.league, league)))
    .all();
}

/** "Knicks", "NYK" or "New York Knicks" → that team's game. */
export function findTeam(games: GameRow[], text: string): { game: GameRow; code: string } {
  const q = normName(text);
  const teams = games.flatMap((game) => [
    { game, t: game.home },
    { game, t: game.away },
  ]);
  const exact = teams.filter(({ t }) => t.code.toLowerCase() === q || normName(t.name) === q);
  const words = (s: string) => ` ${normName(s)} `;
  const loose = exact.length ? exact : teams.filter(({ t }) => words(t.name).includes(` ${q} `));
  if (loose.length === 1) return { game: loose[0]!.game, code: loose[0]!.t.code };
  if (loose.length > 1)
    throw new PickError(`"${text}" matches ${loose.map((x) => x.t.name).join(" and ")}. Use the team code.`);
  throw new PickError(`No team called "${text}" played that day.`);
}

async function findPlayer(
  src: LeagueSource,
  games: GameRow[],
  name: string,
): Promise<{ game: GameRow; player: Player } | null> {
  for (const game of games) {
    const roster = [
      ...(await src.roster(game.home).catch(() => [])),
      ...(await src.roster(game.away).catch(() => [])),
    ];
    const player = findByName(roster, name);
    if (player) return { game, player };
  }
  return null;
}

/**
 * Log a batch of picks from a file: `{ "picks": [ ... ] }` or a bare list, each shaped like PickInputSchema.
 * Each pick is logged on its own, so one bad row doesn't stop the rest.
 */
export async function importPicks(
  db: Db,
  sources: Record<League, LeagueSource>,
  raw: unknown,
  o: BoardOptions,
  now = new Date(),
): Promise<{ logged: PickRow[]; errors: string[] }> {
  const list = Array.isArray(raw) ? raw : z.object({ picks: z.array(z.unknown()) }).parse(raw).picks;
  const logged: PickRow[] = [];
  const errors: string[] = [];
  for (const [i, item] of list.entries()) {
    const parsed = PickInputSchema.safeParse(item);
    if (!parsed.success) {
      errors.push(`Pick ${i + 1}: ${parsed.error.issues[0]?.message ?? "not a pick"}`);
      continue;
    }
    try {
      logged.push(await logPick(db, sources, parsed.data, o, now, "import"));
    } catch (e) {
      errors.push(`Pick ${i + 1} (${parsed.data.subject}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { logged, errors };
}

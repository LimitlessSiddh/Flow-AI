import type { League } from "@flow/core";
import { normName, type Game, type Quote, type StatKey } from "@flow/data";
import {
  and,
  eq,
  games as gamesT,
  gte,
  inArray,
  lte,
  picks as picksT,
  playHistory,
  type Db,
  type GameRow,
} from "@flow/db";
import type { Config } from "../config.js";
import type { ScanDeps } from "../scan.js";

/** Games starting within this many minutes get their closing prices captured. */
export const CLOSE_WINDOW_MIN = 40;
/** Real prop prices cost Odds API credits, so props are only fetched this close to the start, for your picks. */
export const PROP_CLOSE_WINDOW_MIN = 20;

interface Target {
  table: "history" | "pick";
  id: string;
  gameId: string;
  kind: string;
  subject: string;
  stat: string | null;
  side: string;
  line: number | null;
  closeAt: string | null;
}

/**
 * Capture the closing price for plays and picks whose games start soon. Run it every few minutes: each run
 * overwrites the last, so the stored price is the last one seen before the start.
 * Game lines come from ESPN (free). Prop prices come from The Odds API, only for your prop picks.
 */
export async function captureCloses(
  db: Db,
  deps: Pick<ScanDeps, "espnLines" | "odds" | "now">,
  cfg: Pick<Config, "bookmakers" | "oddsMinCredits">,
  windowMin = CLOSE_WINDOW_MIN,
): Promise<{ games: number; updated: number }> {
  const now = deps.now();
  const soon = db
    .select()
    .from(gamesT)
    .where(
      and(
        gte(gamesT.startTime, now.toISOString()),
        lte(gamesT.startTime, new Date(now.getTime() + windowMin * 60_000).toISOString()),
      ),
    )
    .all()
    .filter((g) => g.status === "scheduled");
  if (!soon.length) return { games: 0, updated: 0 };
  const ids = soon.map((g) => g.id);
  const targets: Target[] = [
    ...db
      .select()
      .from(playHistory)
      .where(and(inArray(playHistory.gameId, ids), eq(playHistory.onBoard, true)))
      .all()
      .map((h) => ({ ...h, table: "history" as const, id: h.playId })),
    ...db
      .select()
      .from(picksT)
      .where(inArray(picksT.gameId, ids))
      .all()
      .filter((p) => !p.outcome)
      .map((p) => ({ ...p, table: "pick" as const, gameId: p.gameId! })),
  ];
  if (!targets.length) return { games: 0, updated: 0 };

  const quotes: Quote[] = [];
  const byKey = new Map<string, GameRow[]>();
  for (const g of soon) {
    const k = `${g.league}|${g.date}`;
    byKey.set(k, [...(byKey.get(k) ?? []), g]);
  }
  for (const [k, gs] of byKey) {
    const [league, date] = k.split("|") as [League, string];
    const wanted = gs.filter((g) => targets.some((t) => t.gameId === g.id && t.kind !== "prop"));
    if (!wanted.length) continue;
    try {
      quotes.push(...(await deps.espnLines(league, date, wanted.map(asGame))));
    } catch {
      /* try again next run */
    }
  }
  if (deps.odds) quotes.push(...(await propCloses(deps.odds, soon, targets, now, cfg.oddsMinCredits)));

  const rank = (b: string) => {
    const i = cfg.bookmakers.indexOf(b);
    return i >= 0 ? i : 100;
  };
  const at = now.toISOString();
  let updated = 0;
  db.transaction((tx) => {
    for (const t of targets) {
      const match = quotes
        .filter(
          (q) =>
            q.gameId === t.gameId &&
            q.kind === t.kind &&
            q.side === t.side &&
            (t.kind !== "prop" || (q.stat === t.stat && normName(q.player ?? "") === normName(t.subject))),
        )
        .sort(
          (a, b) => Number(b.line === t.line) - Number(a.line === t.line) || rank(a.book) - rank(b.book),
        )[0];
      if (!match) continue;
      const close = { closeOdds: match.odds, closeLine: match.line, closeBook: match.bookTitle, closeAt: at };
      if (t.table === "history") tx.update(playHistory).set(close).where(eq(playHistory.playId, t.id)).run();
      else tx.update(picksT).set(close).where(eq(picksT.id, t.id)).run();
      updated++;
    }
  });
  return { games: soon.length, updated };
}

/** Prop prices for your prop picks, once per game, inside the last PROP_CLOSE_WINDOW_MIN minutes. */
async function propCloses(
  odds: NonNullable<ScanDeps["odds"]>,
  soon: GameRow[],
  targets: Target[],
  now: Date,
  minCredits: number,
): Promise<Quote[]> {
  const due = soon.filter(
    (g) =>
      Date.parse(g.startTime) - now.getTime() <= PROP_CLOSE_WINDOW_MIN * 60_000 &&
      // one paid call per game: skip games whose prop picks already have a close
      targets.some((t) => t.table === "pick" && t.gameId === g.id && t.kind === "prop" && !t.closeAt),
  );
  const out: Quote[] = [];
  for (const g of due) {
    if (odds.credits.remaining != null && odds.credits.remaining <= minCredits) break;
    const stats = [
      ...new Set(
        targets
          .filter((t) => t.table === "pick" && t.gameId === g.id && t.kind === "prop" && t.stat)
          .map((t) => t.stat as StatKey),
      ),
    ];
    try {
      const ev = (await odds.events(g.league as League)).find(
        (e) => normName(e.home) === normName(g.home.name) && normName(e.away) === normName(g.away.name),
      );
      if (ev) out.push(...(await odds.props(g.league as League, ev.id, asGame(g), stats)));
    } catch {
      /* try again next run */
    }
  }
  return out;
}

const asGame = (g: GameRow): Game => ({
  ...g,
  league: g.league as League,
  status: g.status as Game["status"],
  homeScore: g.homeScore ?? undefined,
  awayScore: g.awayScore ?? undefined,
});

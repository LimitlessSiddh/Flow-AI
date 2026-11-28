import {
  addDays,
  betValue,
  flowEstimate,
  impliedFromAmerican,
  tier,
  valueLabel,
  type Board,
  type BoardGame,
  type PlayDetail,
  type PlayPrice,
  type PlaySummary,
} from "@flow/core";
import { STAT_LABEL, type StatKey } from "@flow/data";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  leftOff,
  lte,
  games as gamesT,
  picks as picksT,
  plays as playsT,
  prices as pricesT,
  results as resultsT,
  scans,
  sources as sourcesT,
  userState,
  type Db,
  type PlayRow,
  type PickRow,
  type PriceRow,
} from "@flow/db";
import { marketLabel } from "./analyze.js";
import { MANUAL_BOOK } from "./ids.js";
import { pickPrice } from "./prices.js";

export interface BoardOptions {
  bookOrder: string[];
  preferredBook: string;
}

function unitFor(p: PlayRow): string {
  if (p.kind === "prop" && p.stat) return STAT_LABEL[p.stat as StatKey]?.unit ?? "";
  if (p.kind === "spread") return p.league === "NHL" ? "goal margin" : "point margin";
  if (p.kind === "moneyline") return "wins";
  return p.league === "NHL" ? "goals" : "points";
}

function toPrice(r: PriceRow, preferredBook: string): PlayPrice {
  return {
    book: r.book,
    bookTitle: r.book === MANUAL_BOOK ? preferredBook : r.bookTitle,
    odds: r.odds,
    line: r.line,
    retrievedAt: r.retrievedAt,
    origin: r.origin,
    implied: impliedFromAmerican(r.odds),
  };
}

function summarize(
  p: PlayRow,
  prices: PriceRow[],
  state: { saved: boolean; dismissed: boolean } | undefined,
  result: { won: boolean | null; push: boolean; value: number | null } | undefined,
  pick: PickRow | undefined,
  o: BoardOptions,
): PlaySummary {
  const pr = pickPrice(prices, o.bookOrder);
  const value = betValue(p.model, pr?.odds ?? null);
  return {
    id: p.id,
    date: p.date,
    league: p.league,
    gameId: p.gameId,
    kind: p.kind,
    subject: p.subject,
    team: p.team,
    position: p.position,
    headshot: p.headshot,
    stat: p.stat,
    statLabel: p.stat ? (STAT_LABEL[p.stat as StatKey]?.label ?? p.stat) : p.kind,
    unit: unitFor(p),
    side: p.side,
    line: p.line,
    lineSource: p.lineSource === "estimated" ? "estimated" : "book",
    market: marketLabel({
      kind: p.kind as never,
      stat: p.stat as StatKey | undefined,
      side: p.side,
      line: p.line,
      subject: p.subject,
    }),
    signal: p.signal,
    tier: p.signal == null ? null : tier(p.signal),
    model: p.model,
    estimate: flowEstimate(p.model, pr?.odds ?? null),
    value,
    valueLabel: value == null ? null : valueLabel(value),
    price: pr ? toPrice(pr, o.preferredBook) : null,
    isPreferredBook: pr?.book === MANUAL_BOOK,
    watch: p.watch,
    streak: p.streak,
    log: p.log,
    windows: p.windows,
    seasonAvg: p.seasonAvg,
    seasonGames: p.seasonGames,
    quality: p.quality,
    origin: p.origin,
    saved: state?.saved ?? false,
    dismissed: state?.dismissed ?? false,
    pick: pick
      ? {
          id: pick.id,
          odds: pick.odds,
          outcome: (pick.outcome as NonNullable<PlaySummary["pick"]>["outcome"]) ?? null,
        }
      : null,
    result: result ?? null,
  };
}

export function getBoard(db: Db, date: string, o: BoardOptions): Board {
  const playRows = db.select().from(playsT).where(eq(playsT.date, date)).orderBy(desc(playsT.signal)).all();
  const ids = playRows.map((p) => p.id);
  const priceRows = ids.length ? db.select().from(pricesT).where(inArray(pricesT.playId, ids)).all() : [];
  const states = ids.length ? db.select().from(userState).where(inArray(userState.playId, ids)).all() : [];
  const res = ids.length ? db.select().from(resultsT).where(inArray(resultsT.playId, ids)).all() : [];
  const myPicks = db.select().from(picksT).where(eq(picksT.date, date)).all();
  const plays = playRows.map((p) =>
    summarize(
      p,
      priceRows.filter((r) => r.playId === p.id),
      states.find((s) => s.playId === p.id),
      res.find((r) => r.playId === p.id),
      myPicks.find((k) => k.playId === p.id),
      o,
    ),
  );
  const gameRows = db.select().from(gamesT).where(eq(gamesT.date, date)).orderBy(asc(gamesT.startTime)).all();
  const games: BoardGame[] = gameRows.map((g) => ({
    id: g.id,
    league: g.league,
    startTime: g.startTime,
    status: g.status,
    home: g.home,
    away: g.away,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    playCount: plays.filter((p) => p.gameId === g.id && !p.dismissed).length,
  }));
  const scan =
    db.select().from(scans).where(eq(scans.date, date)).orderBy(desc(scans.startedAt)).limit(1).get() ?? null;
  const settled = plays.filter((p) => p.result && !p.result.push);
  return {
    date,
    games,
    plays,
    leftOff: db
      .select({ market: leftOff.market, reason: leftOff.reason })
      .from(leftOff)
      .where(eq(leftOff.date, date))
      .all(),
    scan: scan && {
      id: scan.id,
      status: scan.status,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      steps: scan.steps,
      oddsCreditsRemaining: scan.oddsCreditsRemaining,
    },
    record: {
      won: settled.filter((p) => p.result!.won).length,
      lost: settled.filter((p) => p.result!.won === false).length,
      pending: plays.filter((p) => !p.result).length,
    },
    week: picksRecord(db, addDays(date, -6), date),
  };
}

/** Your picks' record between two dates (inclusive). */
export function picksRecord(db: Db, from: string, to: string) {
  const rows = db
    .select({ outcome: picksT.outcome })
    .from(picksT)
    .where(and(gte(picksT.date, from), lte(picksT.date, to)))
    .all();
  return {
    won: rows.filter((r) => r.outcome === "win").length,
    lost: rows.filter((r) => r.outcome === "loss").length,
  };
}

export function getPlay(db: Db, id: string, o: BoardOptions): PlayDetail | null {
  const p = db.select().from(playsT).where(eq(playsT.id, id)).get();
  if (!p) return null;
  const prices = db.select().from(pricesT).where(eq(pricesT.playId, id)).all();
  const state = db.select().from(userState).where(eq(userState.playId, id)).get();
  const result = db.select().from(resultsT).where(eq(resultsT.playId, id)).get();
  const pick = db.select().from(picksT).where(eq(picksT.playId, id)).get();
  const base = summarize(p, prices, state, result, pick, o);
  const rank = (b: string) =>
    b === MANUAL_BOOK ? -1 : o.bookOrder.indexOf(b) >= 0 ? o.bookOrder.indexOf(b) : 100;
  return {
    ...base,
    read: p.read,
    counter: p.counter,
    availability: p.availability,
    context: p.context,
    sources: db
      .select()
      .from(sourcesT)
      .where(eq(sourcesT.playId, id))
      .all()
      .map((s) => ({
        publisher: s.publisher,
        title: s.title,
        url: s.url,
        retrievedAt: s.retrievedAt,
        corroborated: s.corroborated,
      })),
    prices: prices.sort((a, b) => rank(a.book) - rank(b.book)).map((r) => toPrice(r, o.preferredBook)),
    researchedBy: p.researchedBy,
    updatedAt: p.updatedAt,
  };
}

export function setPlayState(db: Db, id: string, patch: Partial<{ saved: boolean; dismissed: boolean }>) {
  const cur = db.select().from(userState).where(eq(userState.playId, id)).get();
  const next = {
    saved: false,
    dismissed: false,
    tracked: false,
    ...cur,
    ...patch,
    playId: id,
    updatedAt: new Date().toISOString(),
  };
  db.insert(userState).values(next).onConflictDoUpdate({ target: userState.playId, set: next }).run();
}

/** Save the price you see in your Betway app. Bet value uses it from now on. */
export function setManualPrice(db: Db, id: string, odds: number, line: number | null) {
  const play = db.select({ id: playsT.id, line: playsT.line }).from(playsT).where(eq(playsT.id, id)).get();
  if (!play) return false;
  const row = {
    playId: id,
    book: MANUAL_BOOK,
    bookTitle: "Betway",
    odds,
    line: line ?? play.line,
    retrievedAt: new Date().toISOString(),
    origin: "manual",
  };
  db.insert(pricesT)
    .values(row)
    .onConflictDoUpdate({ target: [pricesT.playId, pricesT.book], set: row })
    .run();
  return true;
}

export function clearManualPrice(db: Db, id: string) {
  db.delete(pricesT)
    .where(and(eq(pricesT.playId, id), eq(pricesT.book, MANUAL_BOOK)))
    .run();
}

/** For the calendar: every date with plays, and how they did. */
export function datesSummary(db: Db, from: string, to: string) {
  const rows = db
    .select({
      date: playsT.date,
      id: playsT.id,
      won: resultsT.won,
      push: resultsT.push,
      settled: resultsT.playId,
    })
    .from(playsT)
    .leftJoin(resultsT, eq(resultsT.playId, playsT.id))
    .where(and(gte(playsT.date, from), lte(playsT.date, to)))
    .all();
  const map = new Map<string, { date: string; plays: number; won: number; lost: number }>();
  for (const r of rows) {
    const d = map.get(r.date) ?? { date: r.date, plays: 0, won: 0, lost: 0 };
    d.plays++;
    if (r.settled && !r.push) {
      if (r.won) d.won++;
      else d.lost++;
    }
    map.set(r.date, d);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

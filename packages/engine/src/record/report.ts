import {
  calibration,
  clvPoints,
  fitFormWeight,
  impliedFromAmerican,
  MIN_SAMPLES_TO_TUNE,
  profitUnits,
  recordStats,
  sampleStage,
  STAKE_DOLLARS,
  tier,
  valueLabel,
  type Outcome,
  type PickView,
  type RecordReport,
  type RecordRow,
  type RecordSplit,
  type RecordView,
} from "@flow/core";
import { STAT_LABEL, type StatKey } from "@flow/data";
import { and, asc, eq, gte, lte, picks as picksT, playHistory, type Db } from "@flow/db";
import { marketLabel } from "../analyze.js";

export interface RecordQuery {
  view: RecordView;
  /** inclusive; null = all time */
  from: string | null;
  to: string;
  league?: string | null;
  /** used to spot plays whose game ended long ago but still have no result */
  now?: Date;
}

/** A game this long past its start should be final; if it's still ungraded, something needs a look. */
export const UNGRADED_AFTER_HOURS = 8;

/** A stored row, reduced to what the record math and splits need. */
interface Entry extends RecordRow {
  date: string;
  league: string;
  kind: string;
  signal: number | null;
  value: number | null;
  startTime: string | null;
}

const KIND_LABEL: Record<string, string> = {
  prop: "Player props",
  moneyline: "Moneylines",
  spread: "Spreads",
  total: "Totals",
};

const asOutcome = (x: string | null) => (x as Outcome | null) ?? null;
/** The close only compares with your price when it's for the same line. */
const sameLine = (a: number | null, b: number | null) => a === b;

export function getRecord(db: Db, q: RecordQuery): RecordReport {
  const picks = q.view === "picks" ? loadPicks(db, q) : [];
  const entries: Entry[] =
    q.view === "picks"
      ? picks.map((p) => ({
          date: p.date,
          league: p.league,
          kind: p.kind,
          signal: p.signal,
          value: p.value,
          startTime: p.startTime,
          outcome: p.outcome,
          odds: p.odds,
          chance: p.estimate,
          closeOdds: p.clv == null ? null : p.closeOdds,
        }))
      : loadHistory(db, q).map((h) => ({
          date: h.date,
          league: h.league,
          kind: h.kind,
          signal: h.signal,
          value: h.value,
          startTime: h.startTime,
          outcome: asOutcome(h.outcome),
          odds: h.odds,
          // with no price, Flow's chance is its form-based rate
          chance: h.estimate ?? h.model,
          closeOdds: h.odds != null && sameLine(h.closeLine, h.line) ? h.closeOdds : null,
        }));

  const stats = recordStats(entries);
  const cutoff = (q.now ?? new Date()).getTime() - UNGRADED_AFTER_HOURS * 3_600_000;
  const ungraded = entries.filter(
    (e) => e.outcome == null && e.startTime != null && Date.parse(e.startTime) < cutoff,
  ).length;
  const split = (keyOf: (e: Entry) => string | null, label: (k: string) => string, order?: string[]) => {
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = keyOf(e);
      if (k == null) continue;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const out: RecordSplit[] = [...groups].map(([key, rows]) => ({
      key,
      label: label(key),
      stats: recordStats(rows),
    }));
    return order
      ? out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
      : out.sort((a, b) => b.stats.plays - a.stats.plays);
  };
  const days = new Map<string, Entry[]>();
  for (const e of entries) days.set(e.date, [...(days.get(e.date) ?? []), e]);

  return {
    view: q.view,
    from: q.from,
    to: q.to,
    stake: STAKE_DOLLARS,
    stage: sampleStage(stats.won + stats.lost),
    stats,
    ungraded,
    profit: dollars(stats.units),
    byKind: split(
      (e) => e.kind,
      (k) => KIND_LABEL[k] ?? k,
      ["prop", "moneyline", "spread", "total"],
    ),
    byLeague: split(
      (e) => e.league,
      (k) => k,
    ),
    byTier: split(
      (e) => (e.signal == null ? null : tier(e.signal)),
      (k) => `${k} signal`,
      ["Hot", "Warm", "Mild"],
    ),
    byValue: split(
      (e) => (e.value == null ? null : valueLabel(e.value)),
      (k) => k,
      ["Good price", "Small edge", "Priced in"],
    ),
    byDay: [...days]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, rows]) => {
        const s = recordStats(rows);
        return { date, stats: s, profit: dollars(s.units) };
      }),
    calibration: calibration(entries),
    tuning: { ...tuning(db, q), needed: MIN_SAMPLES_TO_TUNE },
    picks,
  };
}

/**
 * How far Flow should lean on form. Always uses every priced play Flow showed (not just yours), because
 * that's hundreds of results a day instead of a handful.
 */
function tuning(db: Db, q: RecordQuery) {
  const rows = loadHistory(db, { ...q, view: "all" });
  return fitFormWeight(
    rows
      .filter((h) => h.model != null && h.odds != null && (h.outcome === "win" || h.outcome === "loss"))
      .map((h) => ({ model: h.model!, implied: impliedFromAmerican(h.odds!), won: h.outcome === "win" })),
  );
}

function range(q: Pick<RecordQuery, "from" | "to">, col: typeof picksT.date | typeof playHistory.date) {
  return q.from ? and(gte(col, q.from), lte(col, q.to))! : lte(col, q.to);
}

function loadHistory(db: Db, q: RecordQuery) {
  const where = [range(q, playHistory.date), eq(playHistory.onBoard, true)];
  if (q.league) where.push(eq(playHistory.league, q.league));
  return db
    .select()
    .from(playHistory)
    .where(and(...where))
    .all();
}

export function loadPicks(db: Db, q: Omit<RecordQuery, "view">): PickView[] {
  const where = [range(q, picksT.date)];
  if (q.league) where.push(eq(picksT.league, q.league));
  return db
    .select()
    .from(picksT)
    .where(and(...where))
    .orderBy(asc(picksT.date), asc(picksT.startTime), asc(picksT.createdAt))
    .all()
    .reverse()
    .map((p): PickView => {
      const outcome = asOutcome(p.outcome);
      const clv =
        p.odds != null && p.closeOdds != null && sameLine(p.closeLine, p.line)
          ? Math.round(clvPoints(p.odds, p.closeOdds) * 100) / 100
          : null;
      const units = outcome ? profitUnits(outcome, p.odds) : null;
      return {
        id: p.id,
        playId: p.playId,
        date: p.date,
        league: p.league,
        gameId: p.gameId,
        startTime: p.startTime,
        kind: p.kind,
        subject: p.subject,
        team: p.team,
        stat: p.stat,
        statLabel: p.stat ? (STAT_LABEL[p.stat as StatKey]?.label ?? p.stat) : (KIND_LABEL[p.kind] ?? p.kind),
        side: p.side,
        line: p.line,
        market: marketLabel({
          kind: p.kind as never,
          stat: p.stat as StatKey | undefined,
          side: p.side,
          line: p.line,
          subject: p.subject,
        }),
        odds: p.odds,
        book: p.book,
        signal: p.signal,
        tier: p.signal == null ? null : tier(p.signal),
        estimate: p.estimate,
        value: p.value,
        closeOdds: p.closeOdds,
        closeLine: p.closeLine,
        closeBook: p.closeBook,
        clv,
        outcome,
        resultValue: p.resultValue,
        gradedBy: (p.gradedBy as PickView["gradedBy"]) ?? null,
        profit: units == null ? null : dollars(units),
        source: p.source,
        note: p.note,
      };
    });
}

const dollars = (units: number) => Math.round(units * STAKE_DOLLARS * 100) / 100;

/** Everything stored, one row per play or pick, for a spreadsheet. */
export function exportCsv(db: Db, q: RecordQuery): string {
  const header = [
    "date",
    "league",
    "kind",
    "subject",
    "stat",
    "side",
    "line",
    "odds",
    "book",
    "signal",
    "flow_chance",
    "value_pts",
    "close_odds",
    "close_line",
    "outcome",
    "result",
    "profit_at_10",
  ];
  const rows: (string | number | null)[][] =
    q.view === "picks"
      ? loadPicks(db, q).map((p) => [
          p.date,
          p.league,
          p.kind,
          p.subject,
          p.stat,
          p.side,
          p.line,
          p.odds,
          p.book,
          p.signal,
          p.estimate == null ? null : round(p.estimate, 4),
          p.value == null ? null : round(p.value, 2),
          p.closeOdds,
          p.closeLine,
          p.outcome,
          p.resultValue,
          p.profit,
        ])
      : loadHistory(db, q).map((h) => {
          const units = h.outcome ? profitUnits(h.outcome as Outcome, h.odds) : null;
          return [
            h.date,
            h.league,
            h.kind,
            h.subject,
            h.stat,
            h.side,
            h.line,
            h.odds,
            h.bookTitle,
            h.signal,
            h.estimate ?? h.model,
            h.value == null ? null : round(h.value, 2),
            h.closeOdds,
            h.closeLine,
            h.outcome,
            h.resultValue,
            units == null ? null : dollars(units),
          ];
        });
  const cell = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;

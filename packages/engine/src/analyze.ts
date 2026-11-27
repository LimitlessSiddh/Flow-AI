import {
  betValue,
  blendSignal,
  flowSignal,
  modelProbability,
  summarizeForm,
  tier,
  teamMarketProbability,
  type FormSummary,
  type GameValue,
  type League,
} from "@flow/core";
import { STAT_LABEL, type Game, type PlayerGame, type StatKey, type TeamGameResult } from "@flow/data";
import type { ContextRow, NewPlay } from "@flow/db";
import { playId } from "./ids.js";

export type Kind = "prop" | "moneyline" | "spread" | "total";

export interface Market {
  date: string;
  game: Game;
  kind: Kind;
  subject: string; // player name, or team code ("Over"/"Under" totals use the matchup)
  team?: string;
  stat?: StatKey;
  side: string; // "Over" | "Under" | team code
  line: number | null;
}

export interface Evidence {
  log: GameValue[];
  /** line the log is compared against (for spreads, the margin needed to cover) */
  compareLine: number;
  compareSide: "Over" | "Under";
  context: ContextRow[];
  unit: string;
  position?: string;
  subjectId?: string;
  headshot?: string;
  /** team markets: chance from the matchup model, used instead of the form rate */
  teamModel?: number | null;
}

const LAST = 20; // keep the last 20 games; windows use the last 10

export function propEvidence(games: PlayerGame[], stat: StatKey, line: number, side: string): Evidence {
  const played = games.filter((g) => g.stats[stat] != null);
  const log: GameValue[] = played
    .slice(-LAST)
    .map((g) => ({ date: g.date, opponent: g.opponent, value: g.stats[stat]! }));
  const context: ContextRow[] = [];
  const mins = played.map((g) => g.minutes).filter((m): m is number => m != null);
  if (mins.length >= 5) {
    context.push({
      label: "Minutes",
      recent: round1(avg(mins.slice(-5))),
      season: round1(avg(mins)),
    });
  }
  return {
    log,
    compareLine: line,
    compareSide: side === "Under" ? "Under" : "Over",
    context,
    unit: STAT_LABEL[stat].unit,
  };
}

/** Team markets: moneyline (won = 1), spread (margin vs the points), total (both teams' game totals). */
/** Team markets. `opp` is the other team's results; totals use both teams' game totals. */
export function teamEvidence(m: Market, results: TeamGameResult[], opp: TeamGameResult[] = []): Evidence {
  const ev = teamEvidenceRaw(m, results, m.kind === "total" ? opp : undefined);
  const home = m.kind === "total" ? true : m.side === m.game.home.code;
  const teamModel = teamMarketProbability(
    m.game.league as League,
    m.kind as "moneyline" | "spread" | "total",
    {
      me: { games: results },
      opp: { games: opp },
      home,
      points: m.line,
      side: m.side,
    },
  );
  return { ...ev, teamModel };
}

function teamEvidenceRaw(m: Market, results: TeamGameResult[], other?: TeamGameResult[]): Evidence {
  const recent = results.slice(-LAST);
  const context: ContextRow[] = [];
  if (results.length >= 5) {
    context.push({
      label: "Scored",
      recent: round1(avg(results.slice(-5).map((r) => r.scored))),
      season: round1(avg(results.map((r) => r.scored))),
    });
    context.push({
      label: "Allowed",
      recent: round1(avg(results.slice(-5).map((r) => r.allowed))),
      season: round1(avg(results.map((r) => r.allowed))),
    });
  }
  const marginUnit = m.game.league === "NHL" ? "goal margin" : "point margin";
  if (m.kind === "moneyline") {
    return {
      log: recent.map((r) => ({ date: r.date, opponent: r.opponent, value: r.scored > r.allowed ? 1 : 0 })),
      compareLine: 0.5,
      compareSide: "Over",
      context,
      unit: "wins",
    };
  }
  if (m.kind === "spread") {
    return {
      log: recent.map((r) => ({ date: r.date, opponent: r.opponent, value: r.scored - r.allowed })),
      compareLine: -(m.line ?? 0),
      compareSide: "Over",
      context,
      unit: marginUnit,
    };
  }
  // total: interleave both teams' recent game totals by date
  const both = [...results, ...(other ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-LAST);
  return {
    log: both.map((r) => ({ date: r.date, opponent: r.opponent, value: r.scored + r.allowed })),
    compareLine: m.line ?? 0,
    compareSide: m.side === "Under" ? "Under" : "Over",
    context: [],
    unit: m.game.league === "NHL" ? "goals" : "points",
  };
}

export interface Scored {
  form: FormSummary;
  signal: number | null;
  model: number | null;
}

export function score(ev: Evidence): Scored {
  const form = summarizeForm(ev.log, ev.compareLine, ev.compareSide);
  const model = ev.teamModel !== undefined ? ev.teamModel : modelProbability(form);
  return { form, signal: blendSignal(flowSignal(form, ev.compareLine, ev.compareSide), model), model };
}

export function marketLabel(m: Pick<Market, "kind" | "stat" | "side" | "line" | "subject">): string {
  if (m.kind === "moneyline") return `${m.subject} to win`;
  if (m.kind === "spread") return `${m.subject} ${fmtLine(m.line)}`;
  if (m.kind === "total") return `Total ${m.side} ${m.line}`;
  const stat = m.stat ? STAT_LABEL[m.stat].label : "";
  if (m.stat === "anytimeTd") return "Anytime touchdown";
  if (m.stat === "goals" && m.line === 0.5) return "Anytime goal";
  return `${stat} ${m.side} ${m.line}`;
}

const fmtLine = (l: number | null) => (l == null ? "" : l > 0 ? `+${l}` : String(l));

/** Plain, factual text used when AI research is off or fails. No invented facts: only computed numbers. */
export function factualRead(m: Market, ev: Evidence, s: Scored): { read: string; counter: string } {
  const w = (n: number) => s.form.windows.find((x) => x.n === n);
  const l5 = w(5);
  const l10 = w(10);
  const who = m.kind === "prop" ? m.subject : m.kind === "total" ? "These two teams" : m.subject;
  const target =
    m.kind === "moneyline"
      ? "won"
      : m.kind === "spread"
        ? `covered ${fmtLine(m.line)}`
        : `gone ${ev.compareSide.toLowerCase()} ${ev.compareLine}`;
  const parts: string[] = [];
  if (l5)
    parts.push(
      `${who} ${m.kind === "prop" ? `cleared ${m.line}` : `have ${target}`} in ${l5.hits} of the last 5`,
    );
  if (l10) parts.push(`${l10.hits} of the last 10`);
  let read = parts.length
    ? parts.join(" and ") + "."
    : `${who} has only ${s.form.season.games} games of data.`;
  if (l10 && m.kind !== "moneyline")
    read += ` The last 10 average is ${round1(l10.avg)} ${ev.unit}, against ${round1(s.form.season.avg)} for the season.`;
  if (s.form.streak >= 3) read += ` That's ${s.form.streak} in a row.`;

  const counters: string[] = [];
  if (s.form.season.rate < 0.5 && s.form.season.games >= 8)
    counters.push(
      `Over the whole season it has hit only ${Math.round(s.form.season.rate * 100)}% of the time.`,
    );
  if (l5 && l10 && l5.hits < l10.hits / 2)
    counters.push("The last 5 games are cooler than the 5 before them.");
  if (s.form.season.sd > 0 && l5 && Math.abs(l5.avg - ev.compareLine) < s.form.season.sd / 2)
    counters.push("The recent average sits close to the line, so one quiet game flips it.");
  if (s.form.playedRecent < 8) counters.push(`Only ${s.form.playedRecent} of the last 10 games were played.`);
  if (!counters.length)
    counters.push("Recent form can cool off quickly, and the price already reflects part of this streak.");
  return { read, counter: counters.join(" ") };
}

export function toPlayRow(
  m: Market,
  ev: Evidence,
  s: Scored,
  scanId: string | null,
  origin: "scan" | "manual",
): NewPlay {
  const text = factualRead(m, ev, s);
  return {
    id: playId({
      date: m.date,
      kind: m.kind,
      subject: m.kind === "total" ? m.game.id : m.subject,
      stat: m.stat,
      side: m.side,
    }),
    date: m.date,
    gameId: m.game.id,
    league: m.game.league,
    kind: m.kind,
    subject: m.subject,
    subjectId: ev.subjectId ?? null,
    team: m.team ?? null,
    position: ev.position ?? null,
    headshot: ev.headshot ?? null,
    stat: m.stat ?? null,
    side: m.side,
    line: m.line,
    signal: s.signal,
    model: s.model,
    quality: 1,
    watch: [],
    log: ev.log.slice(-10),
    windows: s.form.windows.map((w) => ({ n: w.n, avg: round2(w.avg), hits: w.hits })),
    seasonAvg: round2(s.form.season.avg),
    seasonGames: s.form.season.games,
    seasonRate: round2(s.form.season.rate),
    streak: s.form.streak,
    context: ev.context,
    read: text.read,
    counter: text.counter,
    availability: { status: "unknown", text: "Not checked yet." },
    origin,
    scanId,
    updatedAt: new Date().toISOString(),
  };
}

export { betValue, tier };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

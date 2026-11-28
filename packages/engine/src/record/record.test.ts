import { describe, expect, it } from "vitest";
import { openDb, picks as picksT, playHistory, userState, eq, type GameRow } from "@flow/db";
import type { Game, LeagueSource, Player, PlayerGame, Quote, TeamGameResult, TeamRef } from "@flow/data";
import { loadConfig } from "../config.js";
import { getBoard, setManualPrice } from "../board.js";
import { runScan, type ScanDeps } from "../scan.js";
import { settleDate } from "../settle.js";
import { captureCloses } from "./close.js";
import { snapshotDate } from "./history.js";
import {
  deletePick,
  findTeam,
  importPicks,
  logPick,
  migrateTrackedPlays,
  pickFromPlay,
  PickError,
  updatePick,
} from "./picks.js";
import { exportCsv, getRecord } from "./report.js";

const DATE = "2026-11-27";
const START = "2026-11-28T00:00:00Z";
const BOS: TeamRef = { code: "BOS", name: "Boston Celtics", sourceId: "2" };
const ORL: TeamRef = { code: "ORL", name: "Orlando Magic", sourceId: "19" };
const game: Game = {
  id: "nba-2026-11-27-bos-orl",
  league: "NBA",
  date: DATE,
  startTime: START,
  status: "scheduled",
  home: ORL,
  away: BOS,
  sourceId: "espn:1",
};
const hale: Player = { id: "espn:9", name: "Marcus Hale", team: "BOS", league: "NBA", position: "F" };
const pts = [22, 25, 19, 28, 24, 31, 29, 33, 27, 34, 30, 32];
const haleLog: PlayerGame[] = pts.map((v, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, "0")}`,
  stats: { points: v },
  minutes: 34,
}));
const results = (wins: boolean[]): TeamGameResult[] =>
  wins.map((w, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, "0")}`,
    opponent: "XXX",
    home: i % 2 === 0,
    scored: w ? 115 : 101,
    allowed: w ? 104 : 110,
  }));

function nba(final: boolean): LeagueSource {
  return {
    league: "NBA",
    games: async () => [final ? { ...game, status: "final", homeScore: 99, awayScore: 112 } : game],
    teamResults: async (t) =>
      t.code === "BOS"
        ? results([true, true, false, true, true, true, false, true, true, true])
        : results([false, false, true, false, false, true, false, false, true, false]),
    roster: async (t) => (t.code === "BOS" ? [hale] : []),
    playerLog: async (_p, before) =>
      [...haleLog, ...(before > DATE ? [{ date: DATE, stats: { points: 29 } }] : [])].filter(
        (g) => g.date < before,
      ),
  };
}
const empty = (league: "NFL" | "NHL"): LeagueSource => ({
  league,
  games: async () => [],
  teamResults: async () => [],
  roster: async () => [],
  playerLog: async () => [],
});

const q = (x: Partial<Quote> & Pick<Quote, "kind" | "side" | "odds">): Quote => ({
  book: "betmgm_ca_on",
  bookTitle: "BetMGM",
  gameId: game.id,
  line: null,
  retrievedAt: "2026-11-27T16:00:00Z",
  ...x,
});
const quotes: Quote[] = [
  q({ kind: "prop", stat: "points", player: "Marcus Hale", side: "Over", line: 26.5, odds: -115 }),
  q({ kind: "prop", stat: "points", player: "Marcus Hale", side: "Under", line: 26.5, odds: -105 }),
  q({ kind: "moneyline", side: "BOS", odds: -180 }),
  q({ kind: "moneyline", side: "ORL", odds: 150 }),
];

function harness() {
  const clock = { now: new Date("2026-11-27T17:00:00Z") };
  let final = false;
  let lines = quotes;
  const deps: ScanDeps = {
    get sources() {
      return { NBA: nba(final), NFL: empty("NFL"), NHL: empty("NHL") };
    },
    odds: null,
    espnLines: async (lg) => (lg === "NBA" ? lines : []),
    research: null,
    now: () => clock.now,
  };
  return {
    db: openDb(":memory:"),
    deps,
    clock,
    goFinal: () => (final = true),
    setLines: (l: Quote[]) => (lines = l),
  };
}

const cfg = { ...loadConfig({}), estimatedLines: false };
const o = { bookOrder: ["betway", ...cfg.bookmakers], preferredBook: "Betway" };

describe("My Record", () => {
  it("keeps every play, grades it, and reports the record", async () => {
    const h = harness();
    await runScan(h.db, cfg, DATE, h.deps, { research: false });
    const board = getBoard(h.db, DATE, o);
    const stored = h.db.select().from(playHistory).all();
    expect(stored).toHaveLength(board.plays.length);
    const prop = board.plays.find((p) => p.kind === "prop")!;
    const ml = board.plays.find((p) => p.kind === "moneyline")!;
    expect(stored.find((r) => r.playId === prop.id)).toMatchObject({
      odds: -115,
      book: "betmgm_ca_on",
      onBoard: true,
      subjectId: "espn:9",
      modelVersion: expect.stringContaining("form0.35"),
    });

    // you type your Betway price and log the bet
    setManualPrice(h.db, prop.id, 105, null);
    snapshotDate(h.db, DATE, o, h.clock.now);
    const pick = pickFromPlay(h.db, prop.id, o, h.clock.now);
    expect(pick).toMatchObject({ odds: 105, book: "betway", source: "board" });
    expect(pick.estimate).not.toBeNull();
    expect(getBoard(h.db, DATE, o).plays.find((p) => p.id === prop.id)!.pick?.id).toBe(pick.id);

    // a bet typed in by team name links to Flow's moneyline play
    const mlPick = await logPick(
      h.db,
      h.deps.sources,
      { date: DATE, league: "NBA", kind: "moneyline", subject: "Celtics", odds: "-170" },
      o,
      h.clock.now,
    );
    expect(mlPick).toMatchObject({ playId: ml.id, side: "BOS", odds: -170 });
    expect(mlPick.estimate).not.toBeNull();
    // one Flow never listed
    const spread = await logPick(
      h.db,
      h.deps.sources,
      { date: DATE, league: "NBA", kind: "spread", subject: "orl", line: 4.5, odds: "1.91" },
      o,
      h.clock.now,
    );
    expect(spread).toMatchObject({ playId: null, side: "ORL", line: 4.5, odds: -110, estimate: null });

    // closing prices, 20 minutes before the start: Boston got shorter, so you beat the close
    h.clock.now = new Date("2026-11-27T23:40:00Z");
    h.setLines([
      ...quotes.filter((x) => x.kind !== "moneyline"),
      q({ kind: "moneyline", side: "BOS", odds: -200 }),
    ]);
    const c = await captureCloses(h.db, h.deps, cfg);
    expect(c.updated).toBeGreaterThanOrEqual(2);

    // after the start, a rescan with new prices can't rewrite what Flow said
    h.clock.now = new Date("2026-11-28T00:30:00Z");
    snapshotDate(h.db, DATE, o, h.clock.now);
    expect(h.db.select().from(playHistory).where(eq(playHistory.playId, prop.id)).get()!.odds).toBe(105);

    h.goFinal();
    const s = await settleDate(h.db, h.deps.sources, DATE, h.clock.now);
    expect(s).toMatchObject({ picks: 3 });
    expect(s.history).toBe(board.plays.length);

    const mine = getRecord(h.db, { view: "picks", from: null, to: DATE });
    // Hale 29 over 26.5 wins, Boston wins by 13, Orlando +4.5 loses by 13
    expect(mine.stats).toMatchObject({ won: 2, lost: 1, pending: 0 });
    expect(mine.profit).toBeCloseTo(10.5 + 5.88 - 10, 1);
    // your +105 beat the -115 close, and -170 beat -200; the spread had no close
    expect(mine.stats.clv).toMatchObject({ n: 2, beat: 2 });
    expect(mine.byKind.map((k) => k.key)).toEqual(["prop", "moneyline", "spread"]);
    expect(mine.picks.find((p) => p.kind === "moneyline")!.clv).toBeGreaterThan(0);
    expect(mine.stage).toBe("early");
    expect(mine.byDay[0]).toMatchObject({ date: DATE });

    const all = getRecord(h.db, { view: "all", from: null, to: DATE });
    expect(all.stats.graded).toBe(board.plays.length);
    expect(all.calibration.n).toBe(board.plays.length);
    expect(all.tuning).toMatchObject({ best: null, needed: 150 });

    const csv = exportCsv(h.db, { view: "picks", from: null, to: DATE });
    expect(csv.split("\n")[0]).toContain("profit_at_10");
    expect(csv.trim().split("\n")).toHaveLength(4);
  });

  it("keeps a result you entered, and hands grading back when you clear it", async () => {
    const h = harness();
    const p = await logPick(
      h.db,
      h.deps.sources,
      {
        date: DATE,
        league: "NBA",
        kind: "prop",
        subject: "marcus hale",
        stat: "points",
        side: "Under",
        line: 30.5,
        outcome: "loss",
      },
      o,
      h.clock.now,
    );
    expect(p).toMatchObject({ subject: "Marcus Hale", gradedBy: "you", outcome: "loss", odds: null });
    h.goFinal();
    expect((await settleDate(h.db, h.deps.sources, DATE)).picks).toBe(0);

    updatePick(h.db, p.id, { outcome: null, odds: "+120" });
    await settleDate(h.db, h.deps.sources, DATE);
    // 29 points: the under 30.5 hit
    expect(h.db.select().from(picksT).where(eq(picksT.id, p.id)).get()).toMatchObject({
      outcome: "win",
      gradedBy: "flow",
      odds: 120,
      resultValue: 29,
    });
    expect(getRecord(h.db, { view: "picks", from: DATE, to: DATE }).profit).toBe(12);
    expect(deletePick(h.db, p.id)).toBe(true);
  });

  it("gives clear errors for bets it can't place on the schedule", async () => {
    const h = harness();
    const bad = (subject: string) =>
      logPick(h.db, h.deps.sources, { date: DATE, league: "NBA", kind: "moneyline", subject }, o);
    await expect(bad("Knicks")).rejects.toThrow(PickError);
    await expect(
      logPick(
        h.db,
        h.deps.sources,
        { date: DATE, league: "NBA", kind: "spread", subject: "BOS", odds: "50" },
        o,
      ),
    ).rejects.toThrow(/Couldn't read the price/);
    const g = {
      home: { code: "NYR", name: "New York Rangers" },
      away: { code: "NYI", name: "New York Islanders" },
    };
    expect(() => findTeam([g as GameRow], "New York")).toThrow(/Use the team code/);
    expect(findTeam([g as GameRow], "islanders").code).toBe("NYI");
  });

  it("turns plays tracked before picks existed into picks", async () => {
    const h = harness();
    await runScan(h.db, cfg, DATE, h.deps, { research: false });
    const id = getBoard(h.db, DATE, o).plays[0]!.id;
    h.db.insert(userState).values({ playId: id, tracked: true }).run();
    expect(migrateTrackedPlays(h.db, o)).toBe(1);
    expect(migrateTrackedPlays(h.db, o)).toBe(0);
    expect(h.db.select().from(picksT).all()).toHaveLength(1);
  });

  it("imports a file of past bets, one row at a time", async () => {
    const h = harness();
    const r = await importPicks(
      h.db,
      h.deps.sources,
      {
        picks: [
          {
            date: DATE,
            league: "NBA",
            kind: "prop",
            subject: "Marcus Hale",
            stat: "points",
            side: "Over",
            line: 8.5,
            outcome: "win",
          },
          {
            date: DATE,
            league: "NBA",
            kind: "spread",
            subject: "Magic",
            line: 10.5,
            odds: 2.1,
            outcome: "win",
          },
          { date: DATE, league: "NBA", kind: "moneyline", subject: "Knicks", outcome: "loss" },
          { date: DATE, league: "MLB", kind: "moneyline", subject: "Jays" },
        ],
      },
      o,
    );
    expect(r.logged.map((p) => [p.subject, p.odds, p.outcome, p.source])).toEqual([
      ["Marcus Hale", null, "win", "import"],
      ["ORL", 110, "win", "import"],
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain("Knicks");
  });
});

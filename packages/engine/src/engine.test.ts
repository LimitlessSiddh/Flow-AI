import { describe, expect, it } from "vitest";
import { openDb } from "@flow/db";
import type { Game, LeagueSource, Player, PlayerGame, Quote, TeamGameResult, TeamRef } from "@flow/data";
import { loadConfig } from "./config.js";
import { getBoard, getPlay, setManualPrice, setPlayState, datesSummary } from "./board.js";
import { runScan, type ScanDeps } from "./scan.js";
import { settleDate } from "./settle.js";
import { addManualPlay } from "./manual.js";
import type { ResearchProvider } from "./research/types.js";

const DATE = "2026-11-27";
const BOS: TeamRef = { code: "BOS", name: "Boston Celtics", sourceId: "2" };
const ORL: TeamRef = { code: "ORL", name: "Orlando Magic", sourceId: "19" };
const game: Game = {
  id: "nba-2026-11-27-bos-orl",
  league: "NBA",
  date: DATE,
  startTime: "2026-11-28T00:00:00Z",
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
  minutes: 34 + (i % 3),
}));
const results = (wins: boolean[]): TeamGameResult[] =>
  wins.map((w, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, "0")}`,
    opponent: "XXX",
    home: i % 2 === 0,
    scored: w ? 115 : 101,
    allowed: w ? 104 : 110,
  }));

function fakeNba(final = false): LeagueSource {
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
const empty: LeagueSource = {
  league: "NHL",
  games: async () => [],
  teamResults: async () => [],
  roster: async () => [],
  playerLog: async () => [],
};

const quotes: Quote[] = [
  {
    book: "betmgm_ca_on",
    bookTitle: "BetMGM",
    gameId: game.id,
    kind: "prop",
    stat: "points",
    player: "Marcus Hale",
    side: "Over",
    line: 26.5,
    odds: -115,
    retrievedAt: new Date().toISOString(),
  },
  {
    book: "betmgm_ca_on",
    bookTitle: "BetMGM",
    gameId: game.id,
    kind: "prop",
    stat: "points",
    player: "Marcus Hale",
    side: "Under",
    line: 26.5,
    odds: -105,
    retrievedAt: new Date().toISOString(),
  },
  {
    book: "fanduel",
    bookTitle: "FanDuel",
    gameId: game.id,
    kind: "prop",
    stat: "points",
    player: "Marcus Hale",
    side: "Over",
    line: 26.5,
    odds: -120,
    retrievedAt: new Date().toISOString(),
  },
  {
    book: "betmgm_ca_on",
    bookTitle: "BetMGM",
    gameId: game.id,
    kind: "moneyline",
    side: "BOS",
    line: null,
    odds: -180,
    retrievedAt: new Date().toISOString(),
  },
  {
    book: "betmgm_ca_on",
    bookTitle: "BetMGM",
    gameId: game.id,
    kind: "moneyline",
    side: "ORL",
    line: null,
    odds: 150,
    retrievedAt: new Date().toISOString(),
  },
];

const research: ResearchProvider = {
  name: "Fake",
  research: async () => ({
    availability: { status: "ok", text: "Not on the injury report." },
    read: "Hale is taking more shots since the starting lineup changed.",
    counter: "Orlando's defense is top five.",
    context: [{ label: "Shot attempts", recent: 21, season: 18 }],
    sources: [
      {
        publisher: "ESPN",
        title: "Injury report",
        url: "https://www.espn.com/nba/injuries",
        corroborated: true,
      },
      {
        publisher: "NBA.com",
        title: "Official injury report",
        url: "https://official.nba.com/",
        corroborated: true,
      },
    ],
  }),
};

function deps(final = false): ScanDeps {
  return {
    sources: { NBA: fakeNba(final), NFL: { ...empty, league: "NFL" }, NHL: empty },
    odds: null,
    espnLines: async (lg) => (lg === "NBA" ? quotes : []),
    research,
    now: () => new Date(),
  };
}

const cfg = { ...loadConfig({}), researchTopN: 3 };
const o = { bookOrder: ["betway", ...cfg.bookmakers], preferredBook: "Betway" };

describe("scan → board → price → settle", () => {
  it("runs end to end", async () => {
    const db = openDb(":memory:");
    await runScan(db, cfg, DATE, deps());
    const board = getBoard(db, DATE, o);
    expect(board.games).toHaveLength(1);
    expect(board.scan?.status).toBe("done");

    const prop = board.plays.find((p) => p.kind === "prop")!;
    expect(prop).toBeDefined();
    expect(prop.side).toBe("Over"); // over beats under on signal
    expect(prop.signal).toBeGreaterThanOrEqual(65);
    expect(prop.price?.book).toBe("betmgm_ca_on"); // first book in your order, no Betway price yet
    expect(prop.isPreferredBook).toBe(false);

    const ml = board.plays.find((p) => p.kind === "moneyline");
    expect(ml?.side).toBe("BOS");

    const detail = getPlay(db, prop.id, o)!;
    expect(detail.read).toContain("more shots");
    expect(detail.sources).toHaveLength(2);
    expect(detail.prices.map((p) => p.book)).toEqual(["betmgm_ca_on", "fanduel"]);
    expect(detail.quality).toBe(3);

    // you type your Betway price
    setManualPrice(db, prop.id, 105, null);
    const after = getPlay(db, prop.id, o)!;
    expect(after.price?.bookTitle).toBe("Betway");
    expect(after.isPreferredBook).toBe(true);
    expect(after.value!).toBeGreaterThan(prop.value!);

    setPlayState(db, prop.id, { tracked: true });

    // rescan keeps your Betway price
    await runScan(db, cfg, DATE, deps());
    expect(getPlay(db, prop.id, o)!.price?.book).toBe("betway");

    // games go final
    const n = await settleDate(db, deps(true).sources, DATE);
    expect(n).toBeGreaterThanOrEqual(2);
    const settled = getBoard(db, DATE, o);
    expect(settled.plays.find((p) => p.id === prop.id)!.result).toMatchObject({ won: true, value: 29 });
    expect(settled.plays.find((p) => p.kind === "moneyline")!.result?.won).toBe(true);
    expect(settled.week.won).toBe(1);
    expect(datesSummary(db, "2026-11-01", DATE)[0]).toMatchObject({ date: DATE, won: 2 });
  });

  it("adds a play you found on Betway", async () => {
    const db = openDb(":memory:");
    const id = await addManualPlay(db, cfg, deps(), {
      date: DATE,
      league: "NBA",
      player: "marcus hale",
      stat: "points",
      side: "Over",
      line: 27.5,
      odds: -110,
    });
    const p = getPlay(db, id, o)!;
    expect(p.origin).toBe("manual");
    expect(p.price).toMatchObject({ bookTitle: "Betway", odds: -110 });
    expect(p.signal).not.toBeNull();
  });
});

describe("research parsing", () => {
  it("trims long text instead of rejecting the whole result", async () => {
    const { ResearchResult } = await import("./research/types.js");
    const r = ResearchResult.parse({
      availability: { status: "ok", text: "word ".repeat(200) },
      read: "Short read.",
      counter: "Short counter.",
    });
    expect(r.availability.text.length).toBeLessThanOrEqual(400);
    expect(r.availability.text.endsWith("…")).toBe(true);
    expect(r.sources).toEqual([]);
  });
});

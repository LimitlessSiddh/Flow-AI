import { describe, expect, it } from "vitest";
import { EspnSource, parseEspnGamelog } from "./espn/espn.js";
import { parseNhlGameLog, toiMinutes } from "./nhl/nhl.js";
import { parseGameLines, parseProps } from "./odds/oddsApi.js";
import { findByName, normName } from "./names.js";
import type { Game } from "./types.js";

// Fixtures are trimmed copies of the shapes these free sources return.
const TZ = "America/Toronto";

describe("ESPN", () => {
  it("parses an NBA scoreboard event", () => {
    const g = new EspnSource("NBA", TZ).parseEvent({
      id: "401",
      date: "2026-11-28T00:00Z",
      status: { type: { state: "pre" } },
      competitions: [
        {
          competitors: [
            { homeAway: "home", score: "0", team: { id: "19", abbreviation: "ORL", displayName: "Orlando Magic", logo: "x.png", color: "0077c0" } },
            { homeAway: "away", score: "0", team: { id: "2", abbreviation: "BOS", displayName: "Boston Celtics" } },
          ],
        },
      ],
    });
    expect(g).toMatchObject({ id: "nba-2026-11-27-bos-orl", date: "2026-11-27", status: "scheduled" });
    expect(g?.home).toMatchObject({ code: "ORL", sourceId: "19", color: "#0077c0" });
  });

  it("parses an NBA gamelog and skips the preseason", () => {
    const names = ["minutes", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "totalRebounds", "assists", "points"];
    const body = {
      names,
      events: {
        e1: { gameDate: "2026-11-20T00:30:00.000+00:00", atVs: "@", opponent: { abbreviation: "NYK" } },
        e2: { gameDate: "2026-11-22T00:30:00.000+00:00", atVs: "vs", opponent: { abbreviation: "MIA" } },
        e0: { gameDate: "2026-10-10T00:30:00.000+00:00", atVs: "vs", opponent: { abbreviation: "MIA" } },
      },
      seasonTypes: [
        { displayName: "2026-27 Regular Season", categories: [{ events: [
          { eventId: "e2", stats: ["36", "4-9", "8", "5", "31"] },
          { eventId: "e1", stats: ["34", "2-7", "11", "3", "24"] },
        ] }] },
        { displayName: "2026-27 Preseason", categories: [{ events: [{ eventId: "e0", stats: ["20", "1-2", "3", "1", "9"] }] }] },
      ],
    };
    const log = parseEspnGamelog(body, "NBA", TZ);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ date: "2026-11-19", opponent: "NYK", home: false, minutes: 34 });
    expect(log[1]!.stats).toEqual({ threes: 4, rebounds: 8, assists: 5, points: 31 });
  });

  it("parses an NFL gamelog across rushing and receiving categories", () => {
    const body = {
      categories: [
        { name: "rushing", names: ["rushingAttempts", "rushingYards", "rushingTouchdowns"] },
        { name: "receiving", names: ["receptions", "receivingYards", "receivingTouchdowns"] },
      ],
      events: { g1: { gameDate: "2026-11-16T18:00:00.000+00:00", atVs: "vs", opponent: { abbreviation: "BUF" } } },
      seasonTypes: [{ displayName: "2026 Regular Season", categories: [{ events: [{ eventId: "g1", stats: ["18", "88", "1", "3", "21", "1"] }] }] }],
    };
    const [g] = parseEspnGamelog(body, "NFL", TZ);
    expect(g!.stats).toMatchObject({ rushYds: 88, receptions: 3, recYds: 21, anytimeTd: 2 });
  });
});

describe("NHL", () => {
  it("parses a player game log, oldest first", () => {
    const log = parseNhlGameLog({
      gameLog: [
        { gameDate: "2026-11-25", opponentAbbrev: "DAL", homeRoadFlag: "H", toi: "18:30", goals: 1, assists: 1, points: 2, shots: 5 },
        { gameDate: "2026-11-23", opponentAbbrev: "SJS", homeRoadFlag: "R", toi: "17:06", goals: 0, assists: 0, points: 0, shots: 3 },
      ],
    });
    expect(log.map((g) => g.date)).toEqual(["2026-11-23", "2026-11-25"]);
    expect(log[1]).toMatchObject({ home: true, minutes: 18.5, stats: { goals: 1, points: 2, shots: 5 } });
    expect(toiMinutes("bad")).toBeUndefined();
  });
});

const game: Game = {
  id: "nhl-2026-11-27-tor-det",
  league: "NHL",
  date: "2026-11-27",
  startTime: "2026-11-28T00:00:00Z",
  status: "scheduled",
  home: { code: "DET", name: "Detroit Red Wings", sourceId: "DET" },
  away: { code: "TOR", name: "Toronto Maple Leafs", sourceId: "TOR" },
  sourceId: "nhl:1",
};

describe("The Odds API", () => {
  it("parses moneyline, spread and total into team codes", () => {
    const q = parseGameLines(
      {
        home_team: "Detroit Red Wings",
        away_team: "Toronto Maple Leafs",
        bookmakers: [
          {
            key: "betmgm_ca_on",
            title: "BetMGM (Ontario)",
            markets: [
              { key: "h2h", last_update: "2026-11-27T23:00:00Z", outcomes: [{ name: "Toronto Maple Leafs", price: -175 }, { name: "Detroit Red Wings", price: 145 }] },
              { key: "spreads", outcomes: [{ name: "Toronto Maple Leafs", price: 160, point: -1.5 }] },
              { key: "totals", outcomes: [{ name: "Over", price: -110, point: 6.5 }] },
            ],
          },
        ],
      },
      [game],
    );
    expect(q).toHaveLength(4);
    expect(q[0]).toMatchObject({ kind: "moneyline", side: "TOR", odds: -175, book: "betmgm_ca_on" });
    expect(q[2]).toMatchObject({ kind: "spread", side: "TOR", line: -1.5 });
    expect(q[3]).toMatchObject({ kind: "total", side: "Over", line: 6.5 });
  });

  it("ignores events it can't match to a game", () => {
    expect(parseGameLines({ home_team: "Nope", away_team: "Nobody", bookmakers: [] }, [game])).toEqual([]);
  });

  it("parses player props, including yes/no markets", () => {
    const q = parseProps(
      {
        bookmakers: [
          {
            key: "fanduel",
            title: "FanDuel",
            markets: [
              { key: "player_shots_on_goal", outcomes: [{ name: "Over", description: "Auston Matthews", price: -130, point: 3.5 }] },
              { key: "player_goal_scorer_anytime", outcomes: [{ name: "Yes", description: "Auston Matthews", price: 120 }] },
            ],
          },
        ],
      },
      "NHL",
      game,
    );
    expect(q[0]).toMatchObject({ stat: "shots", player: "Auston Matthews", side: "Over", line: 3.5 });
    expect(q[1]).toMatchObject({ stat: "goals", side: "Over", line: 0.5, odds: 120 });
  });
});

describe("names", () => {
  it("matches across accents, suffixes and initials", () => {
    expect(normName("Montréal Canadiens")).toBe("montreal canadiens");
    expect(normName("Jaren Jackson Jr.")).toBe("jaren jackson");
    const people = [{ name: "Jayson Tatum" }, { name: "Jaylen Brown" }];
    expect(findByName(people, "J. Tatum")?.name).toBe("Jayson Tatum");
    expect(findByName(people, "jaylen brown")?.name).toBe("Jaylen Brown");
  });
});

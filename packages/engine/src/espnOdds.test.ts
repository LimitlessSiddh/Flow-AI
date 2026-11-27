import { describe, expect, it } from "vitest";
import { parseEspnOdds } from "./espnOdds.js";
import { playId } from "./ids.js";

describe("parseEspnOdds", () => {
  it("reads the newer close / open layout", () => {
    const l = parseEspnOdds({
      spread: -1.5,
      overUnder: 6.5,
      homeTeamOdds: { favorite: true },
      awayTeamOdds: { favorite: false },
      moneyline: { home: { close: { odds: "-165" } }, away: { close: { odds: "+140" } } },
      pointSpread: {
        home: { close: { line: "-1.5", odds: "+170" } },
        away: { close: { line: "+1.5", odds: "-205" } },
      },
      total: {
        over: { close: { line: "o6.5", odds: "EVEN" } },
        under: { open: { line: "u6.5", odds: "-120" } },
      },
    });
    expect(l).toEqual({
      homeMoneyline: -165,
      awayMoneyline: 140,
      spread: -1.5,
      homeSpreadOdds: 170,
      awaySpreadOdds: -205,
      total: 6.5,
      overOdds: 100,
      underOdds: -120,
    });
  });

  it("reads the older flat layout", () => {
    const l = parseEspnOdds({
      spread: -6.5,
      overUnder: 224.5,
      homeTeamOdds: { moneyLine: -250, spreadOdds: -110 },
      awayTeamOdds: { moneyLine: 205, spreadOdds: -110 },
      overOdds: -112,
      underOdds: -108,
    });
    expect(l.homeMoneyline).toBe(-250);
    expect(l.spread).toBe(-6.5);
    expect(l.awaySpreadOdds).toBe(-110);
    expect(l.overOdds).toBe(-112);
  });

  it("never guesses a missing price", () => {
    const l = parseEspnOdds({ spread: -1.5, overUnder: 6.5, homeTeamOdds: {}, awayTeamOdds: {} });
    expect(l.spread).toBe(-1.5);
    expect(l.homeSpreadOdds).toBeNull();
    expect(l.awaySpreadOdds).toBeNull();
    expect(l.overOdds).toBeNull();
  });
});

describe("playId", () => {
  it("keeps the same team code apart across leagues", () => {
    const base = { date: "2026-11-27", kind: "spread", subject: "DAL", side: "DAL" };
    expect(playId({ ...base, league: "NBA" })).not.toBe(playId({ ...base, league: "NHL" }));
  });
});

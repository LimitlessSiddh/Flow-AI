import { describe, expect, it } from "vitest";
import { openDb } from "@flow/db";
import { loadConfig, type ScanDeps } from "@flow/engine";
import type { LeagueSource } from "@flow/data";
import { buildApp } from "./app.js";

const empty = (league: "NBA" | "NFL" | "NHL"): LeagueSource => ({
  league,
  games: async () => [],
  teamResults: async () => [],
  roster: async () => [],
  playerLog: async () => [],
});
const deps: ScanDeps = {
  sources: { NBA: empty("NBA"), NFL: empty("NFL"), NHL: empty("NHL") },
  odds: null,
  espnLines: async () => [],
  research: null,
  now: () => new Date("2026-11-27T17:00:00Z"),
};

describe("api", () => {
  const app = buildApp({ db: openDb(":memory:"), cfg: loadConfig({}), deps });

  it("reports health and today's date in your time zone", async () => {
    const r = await app.inject("/api/health");
    expect(r.json()).toEqual({ ok: true, today: "2026-11-27" });
  });

  it("returns an empty board", async () => {
    const r = await app.inject("/api/board?date=2026-11-27");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ date: "2026-11-27", plays: [], games: [] });
  });

  it("validates dates and odds", async () => {
    expect((await app.inject("/api/board?date=nope")).statusCode).toBe(400);
    const r = await app.inject({ method: "PUT", url: "/api/plays/x/price", payload: { odds: "50" } });
    expect(r.statusCode).toBe(400);
  });

  it("runs a scan and reports it", async () => {
    const r = await app.inject({ method: "POST", url: "/api/scan", payload: {} });
    expect(r.statusCode).toBe(202);
    const { id } = r.json();
    await new Promise((res) => setTimeout(res, 100));
    const s = await app.inject(`/api/scan/${id}`);
    expect(s.json().status).toBe("done");
  });

  it("saves settings", async () => {
    await app.inject({ method: "PUT", url: "/api/settings", payload: { oddsFormat: "decimal" } });
    const m = await app.inject("/api/meta");
    expect(m.json().settings.oddsFormat).toBe("decimal");
  });
});

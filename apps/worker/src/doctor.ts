import { spawnSync } from "node:child_process";
import { localDate } from "@flow/core";
import { EspnSource, fetchJson, NhlSource, OddsApi } from "@flow/data";
import type { Config } from "@flow/engine";

/** Checks each free source from this computer and prints what works. */
export async function doctor(cfg: Config) {
  const today = localDate(new Date(), cfg.timezone);
  const ok = (s: string) => console.log(`  ok    ${s}`);
  const bad = (s: string) => console.log(`  FAIL  ${s}`);
  const check = async (label: string, fn: () => Promise<string>) => {
    try {
      ok(`${label}: ${await fn()}`);
    } catch (e) {
      bad(`${label}: ${e instanceof Error ? e.message : e}`);
    }
  };

  console.log(`Flow doctor (${today}, ${cfg.timezone})\n`);
  const nhl = new NhlSource(cfg.timezone);
  const nba = new EspnSource("NBA", cfg.timezone);
  const nfl = new EspnSource("NFL", cfg.timezone);

  await check("NHL schedule", async () => `${(await nhl.games(today)).length} games today`);
  await check("NHL player log", async () => {
    const games = await nhl.games(today);
    const g = games[0];
    if (!g) return "no games today to sample";
    const roster = await nhl.roster(g.home);
    const log = await nhl.playerLog(roster[0]!, "9999-12-31");
    return `${roster[0]!.name}: ${log.length} games`;
  });
  await check("NBA scoreboard (ESPN)", async () => `${(await nba.games(today)).length} games today`);
  await check("NBA game log (ESPN)", async () => {
    const g = (await nba.games(today))[0];
    if (!g) return "no games today to sample";
    const roster = await nba.roster(g.home);
    const p = roster[0]!;
    const log = await nba.playerLog(p, "9999-12-31");
    return `${p.name}: ${log.length} games, last ${JSON.stringify(log.at(-1)?.stats ?? {})}`;
  });
  await check("NFL scoreboard (ESPN)", async () => `${(await nfl.games(today)).length} games today`);
  await check("NFL game log (ESPN)", async () => {
    const teams = await fetchJson<{
      sports: {
        leagues: { teams: { team: { id: string; abbreviation: string; displayName: string } }[] }[];
      }[];
    }>("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams");
    const t = teams.sports[0]!.leagues[0]!.teams[0]!.team;
    const roster = await nfl.roster({ code: t.abbreviation, name: t.displayName, sourceId: t.id });
    const p = roster.find((r) => r.position === "WR") ?? roster[0]!;
    const log = await nfl.playerLog(p, "9999-12-31");
    return `${p.name} (${p.position}): ${log.length} games, last ${JSON.stringify(log.at(-1)?.stats ?? {})}`;
  });

  if (cfg.oddsApiKey) {
    const odds = new OddsApi(cfg.oddsApiKey, cfg.bookmakers);
    await check("The Odds API", async () => {
      const ev = await odds.events("NBA");
      return `${ev.length} NBA events, ${odds.credits.remaining ?? "?"} credits left this month`;
    });
  } else {
    bad("The Odds API: no ODDS_API_KEY in .env (free key at https://the-odds-api.com)");
  }

  if (cfg.researchProvider === "off") {
    console.log("  skip  AI research is off (RESEARCH_PROVIDER=off)");
  } else {
    const bin = cfg.researchProvider === "claude" ? "claude" : "codex";
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (r.status === 0) ok(`${bin} CLI: ${r.stdout.trim()}`);
    else bad(`${bin} CLI not found. Install it and sign in, or set RESEARCH_PROVIDER=off`);
  }
}

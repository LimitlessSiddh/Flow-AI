/**
 * Dev only: fills a separate database with made-up games so you can look at the UI without network access.
 * Usage: DATABASE_PATH=data/demo.db pnpm --filter @flow/worker exec tsx src/seed-demo.ts
 */
import { addDays, impliedFromAmerican, localDate, MODEL_VERSION, type League } from "@flow/core";
import type { Game, LeagueSource, Player, PlayerGame, Quote, TeamGameResult, TeamRef } from "@flow/data";
import { openDb, picks as picksT, playHistory } from "@flow/db";
import { loadConfig, runScan, setPlayState, type ScanDeps } from "@flow/engine";

const cfg = loadConfig();
if (!/demo/.test(cfg.databasePath)) {
  console.error("Refusing to seed: set DATABASE_PATH to a file with 'demo' in its name.");
  process.exit(1);
}
const db = openDb(cfg.databasePath);
const date = localDate(new Date(), cfg.timezone);
const t = (code: string, name: string, color: string): TeamRef => ({ code, name, sourceId: code, color });
const T = {
  BOS: t("BOS", "Boston Celtics", "#007A33"),
  ORL: t("ORL", "Orlando Magic", "#0077C0"),
  DEN: t("DEN", "Denver Nuggets", "#0E2240"),
  PHX: t("PHX", "Phoenix Suns", "#E56020"),
  TOR: t("TOR", "Toronto Maple Leafs", "#00205B"),
  DET: t("DET", "Detroit Red Wings", "#CE1126"),
};
const mk = (league: League, away: TeamRef, home: TeamRef, hour: number): Game => ({
  id: `${league}-${date}-${away.code}-${home.code}`.toLowerCase(),
  league,
  date,
  startTime: new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-05:00`).toISOString(),
  status: "scheduled",
  away,
  home,
  sourceId: "demo",
});
const games = [mk("NBA", T.BOS, T.ORL, 19), mk("NBA", T.DEN, T.PHX, 21), mk("NHL", T.TOR, T.DET, 19)];
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const series = (n: number, base: number, trend: number, spread: number) =>
  Array.from({ length: n }, (_, i) =>
    Math.max(0, Math.round(base + trend * (i - n / 2) + (rnd() - 0.5) * spread)),
  );
const day = (i: number, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (n - i) * 2);
  return d.toISOString().slice(0, 10);
};
const players: (Player & {
  stat: "points" | "rebounds" | "shots";
  vals: number[];
  line: number;
  o: number;
  u: number;
})[] = [
  {
    id: "d:1",
    name: "Jordan Hale",
    team: "BOS",
    league: "NBA",
    position: "F",
    stat: "points",
    vals: series(18, 25, 0.6, 9),
    line: 26.5,
    o: -115,
    u: -105,
  },
  {
    id: "d:2",
    name: "Theo Banks",
    team: "ORL",
    league: "NBA",
    position: "C",
    stat: "rebounds",
    vals: series(18, 10, 0.25, 5),
    line: 10.5,
    o: -110,
    u: -110,
  },
  {
    id: "d:3",
    name: "Mika Laine",
    team: "TOR",
    league: "NHL",
    position: "C",
    stat: "shots",
    vals: series(18, 3.4, 0.12, 3),
    line: 3.5,
    o: 105,
    u: -135,
  },
  {
    id: "d:4",
    name: "Cole Ridley",
    team: "PHX",
    league: "NBA",
    position: "G",
    stat: "points",
    vals: series(16, 21, 0.5, 8),
    line: 22.5,
    o: -125,
    u: 105,
  },
];
const results = (code: string): TeamGameResult[] =>
  Array.from({ length: 16 }, (_, i) => {
    const s = 100 + Math.round(rnd() * 25) + (code === "BOS" || code === "DEN" ? 6 : 0);
    return {
      date: day(i, 16),
      opponent: "OPP",
      home: i % 2 === 0,
      scored: code === "TOR" || code === "DET" ? Math.round(s / 34) : s,
      allowed:
        code === "TOR" || code === "DET" ? Math.round((100 + rnd() * 25) / 34) : 100 + Math.round(rnd() * 25),
    };
  });
const src = (league: League): LeagueSource => ({
  league,
  games: async () => games.filter((g) => g.league === league),
  teamResults: async (tm) => results(tm.code),
  roster: async (tm) => players.filter((p) => p.team === tm.code),
  playerLog: async (p) =>
    players
      .find((x) => x.id === p.id)!
      .vals.map<PlayerGame>((v, i, a) => ({
        date: day(i, a.length),
        opponent: "OPP",
        minutes: 30 + Math.round(rnd() * 8),
        stats: { [players.find((x) => x.id === p.id)!.stat]: v },
      })),
});
const now = new Date().toISOString();
const quotes: Quote[] = [];
for (const p of players) {
  const g = games.find((x) => x.home.code === p.team || x.away.code === p.team)!;
  for (const [book, title, adj] of [
    ["betmgm_ca_on", "BetMGM", 0],
    ["fanduel", "FanDuel", -5],
  ] as const) {
    quotes.push({
      book,
      bookTitle: title,
      gameId: g.id,
      kind: "prop",
      stat: p.stat,
      player: p.name,
      side: "Over",
      line: p.line,
      odds: p.o + adj,
      retrievedAt: now,
    });
    quotes.push({
      book,
      bookTitle: title,
      gameId: g.id,
      kind: "prop",
      stat: p.stat,
      player: p.name,
      side: "Under",
      line: p.line,
      odds: p.u + adj,
      retrievedAt: now,
    });
  }
}
for (const g of games) {
  quotes.push({
    book: "betmgm_ca_on",
    bookTitle: "BetMGM",
    gameId: g.id,
    kind: "moneyline",
    side: g.away.code,
    line: null,
    odds: -150,
    retrievedAt: now,
  });
  quotes.push({
    book: "betmgm_ca_on",
    bookTitle: "BetMGM",
    gameId: g.id,
    kind: "moneyline",
    side: g.home.code,
    line: null,
    odds: 130,
    retrievedAt: now,
  });
  const tot = g.league === "NHL" ? 6.5 : 226.5;
  quotes.push({
    book: "betmgm_ca_on",
    bookTitle: "BetMGM",
    gameId: g.id,
    kind: "total",
    side: "Over",
    line: tot,
    odds: -110,
    retrievedAt: now,
  });
  quotes.push({
    book: "betmgm_ca_on",
    bookTitle: "BetMGM",
    gameId: g.id,
    kind: "total",
    side: "Under",
    line: tot,
    odds: -110,
    retrievedAt: now,
  });
}
const deps: ScanDeps = {
  sources: { NBA: src("NBA"), NFL: src("NFL"), NHL: src("NHL") },
  odds: null,
  espnLines: async (lg) => quotes.filter((q) => games.find((g) => g.id === q.gameId)?.league === lg),
  research: {
    name: "Demo",
    research: async (f) => ({
      availability: { status: "ok", text: `${f.subject} is not on the injury report (demo text).` },
      read: `Demo read for ${f.market}. In the real app this comes from Claude Code with sources.`,
      counter: "Demo counter-argument.",
      context: [],
      sources: [
        { publisher: "Demo", title: "Example source", url: "https://example.com/", corroborated: false },
      ],
    }),
  },
  now: () => new Date(),
};
await runScan(db, { ...cfg, researchTopN: 2 }, date, deps);
const first = db.query.plays.findFirst();
if (first) setPlayState(db, (await first)!.id, { saved: true });

// Made-up graded history for the last two weeks, so the My record page has something to show.
const kinds = ["prop", "prop", "prop", "moneyline", "spread", "total"] as const;
for (let d = 1; d <= 14; d++) {
  const day = addDays(date, -d);
  for (let i = 0; i < 30; i++) {
    const kind = kinds[i % kinds.length]!;
    const league = i % 3 === 0 ? "NHL" : "NBA";
    const model = 0.38 + rnd() * 0.4;
    const odds = rnd() < 0.5 ? -110 - Math.round(rnd() * 60) : 100 + Math.round(rnd() * 80);
    const estimate = impliedFromAmerican(odds) + 0.35 * (model - impliedFromAmerican(odds));
    const outcome = rnd() < estimate ? "win" : "loss";
    const base = {
      date: day,
      league,
      kind,
      subject: `Demo ${kind} ${i}`,
      side: kind === "prop" || kind === "total" ? "Over" : "BOS",
      line: kind === "moneyline" ? null : 10.5,
      startTime: `${day}T23:00:00Z`,
      signal: Math.round(55 + rnd() * 40),
      model,
      estimate,
      value: (estimate - impliedFromAmerican(odds)) * 100,
      odds,
      closeOdds:
        odds < 0
          ? Math.min(-100, odds + (rnd() < 0.55 ? -8 : 8))
          : Math.max(100, odds + (rnd() < 0.55 ? -8 : 8)),
      closeLine: kind === "moneyline" ? null : 10.5,
      outcome,
      resultValue: null,
      gradedAt: `${addDays(day, 1)}T12:00:00Z`,
    };
    db.insert(playHistory)
      .values({
        ...base,
        playId: `demo:${day}:${i}`,
        gameId: `demo-${day}`,
        lineSource: "book",
        quality: 2,
        origin: "scan",
        modelVersion: MODEL_VERSION,
        firstSeenAt: `${day}T12:00:00Z`,
        snapshotAt: `${day}T12:00:00Z`,
      })
      .onConflictDoNothing()
      .run();
    if (i < 3)
      db.insert(picksT)
        .values({ ...base, id: `demo-pick:${day}:${i}`, book: "betway", source: "manual", gradedBy: "flow" })
        .onConflictDoNothing()
        .run();
  }
}
console.log(`Seeded demo board for ${date} into ${cfg.databasePath}`);

import { addDays, isIsoDate, LEAGUES, localDate, type League } from "@flow/core";
import { openDb, scans, eq } from "@flow/db";
import {
  captureCloses,
  defaultDeps,
  getRecord,
  importPicks,
  loadConfig,
  MANUAL_BOOK,
  migrateTrackedPlays,
  runScan,
  settleDate,
} from "@flow/engine";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { doctor } from "./doctor.js";

const HELP = `Flow worker

  pnpm scan [YYYY-MM-DD] [--no-research] [--league NBA,NHL]
      Build the board for a date (default: today).
  pnpm settle [YYYY-MM-DD]
      Grade a date's plays, Flow's history and your picks once games are final (default: yesterday).
  pnpm close
      Save closing prices for games starting in the next 40 minutes. The app does this every 10 minutes.
  pnpm record [YYYY-MM-DD]
      Print your record and Flow's record up to a date (default: today).
  pnpm picks import <file.json>
      Log bets from a file: { "picks": [{ "date", "league", "kind", "subject", "stat", "side", "line", "odds", "outcome" }] }
  pnpm health
      Check every data source and your research tool from this computer.
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();
  const today = localDate(new Date(), cfg.timezone);
  const date = rest.find(isIsoDate);
  const flag = (f: string) => rest.includes(f);
  const leaguesArg = rest[rest.indexOf("--league") + 1];
  const leagues =
    rest.includes("--league") && leaguesArg
      ? (leaguesArg
          .toUpperCase()
          .split(",")
          .filter((l) => (LEAGUES as readonly string[]).includes(l)) as League[])
      : undefined;

  if (cmd === "doctor") return doctor(cfg);
  if (!["scan", "settle", "close", "record", "picks"].includes(cmd ?? "")) {
    console.log(HELP);
    return;
  }

  const db = openDb(cfg.databasePath);
  const deps = defaultDeps(cfg);
  const o = { bookOrder: [MANUAL_BOOK, ...cfg.bookmakers], preferredBook: cfg.preferredBook };
  migrateTrackedPlays(db, o);

  if (cmd === "close") {
    const r = await captureCloses(db, deps, cfg);
    console.log(`Saved ${r.updated} closing prices for ${r.games} games starting soon.`);
    return;
  }

  if (cmd === "record") {
    const to = date ?? today;
    const pct = (x: number | null) => (x == null ? "-" : `${(x * 100).toFixed(1)}%`);
    for (const view of ["picks", "all"] as const) {
      const r = getRecord(db, { view, from: null, to });
      const s = r.stats;
      const sign = r.profit >= 0 ? "+" : "-";
      console.log(view === "picks" ? "Your picks" : "Every play Flow showed");
      console.log(
        `  ${s.won}-${s.lost}${s.push ? `-${s.push}` : ""} (${s.pending} waiting), win rate ${pct(s.winRate)}`,
      );
      console.log(
        `  Profit at $${r.stake} a play: ${sign}$${Math.abs(r.profit).toFixed(2)} over ${s.priced} priced plays, ROI ${pct(s.roi)}`,
      );
      if (r.ungraded)
        console.log("  " + r.ungraded + " couldn't be graded from the stats source. Check them by hand.");
      if (s.clv.n) console.log(`  Beat the closing price on ${s.clv.beat} of ${s.clv.n}`);
    }
    return;
  }

  if (cmd === "picks") {
    const file = rest[0] === "import" ? rest[1] : undefined;
    if (!file) {
      console.log(HELP);
      process.exitCode = 1;
      return;
    }
    // pnpm runs scripts from apps/worker; read the path from where you typed the command
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const { logged, errors } = await importPicks(db, deps.sources, raw, o);
    for (const p of logged) {
      const what =
        p.kind === "prop"
          ? `${p.stat} ${p.side} ${p.line}`
          : p.kind === "spread"
            ? `spread ${p.line}`
            : p.kind;
      console.log(`  ok  ${p.date} ${p.subject} ${what}${p.outcome ? ` (${p.outcome})` : ""}`);
    }
    for (const e of errors) console.log(`  x   ${e}`);
    console.log(`Logged ${logged.length} picks${errors.length ? `, ${errors.length} need fixing` : ""}.`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (cmd === "scan") {
    const d = date ?? today;
    console.log(`Scanning ${d}...`);
    const id = await runScan(db, cfg, d, deps, { research: !flag("--no-research"), leagues });
    const s = db.select().from(scans).where(eq(scans.id, id)).get()!;
    for (const st of s.steps)
      console.log(`${st.level === "info" ? " " : st.level === "warn" ? "!" : "x"} ${st.text}`);
    if (s.oddsCreditsRemaining != null)
      console.log(`  Odds API credits left this month: ${s.oddsCreditsRemaining}`);
    return;
  }

  const d = date ?? addDays(today, -1);
  const n = await settleDate(db, deps.sources, d);
  console.log(`Graded ${d}: ${n.picks} of your picks, ${n.history} Flow plays, ${n.plays} on the board.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

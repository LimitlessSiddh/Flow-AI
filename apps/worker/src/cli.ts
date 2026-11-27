import { addDays, isIsoDate, LEAGUES, localDate, type League } from "@flow/core";
import { openDb, scans, eq } from "@flow/db";
import { defaultDeps, loadConfig, runScan, settleDate } from "@flow/engine";
import { doctor } from "./doctor.js";

const HELP = `Flow worker

  pnpm scan [YYYY-MM-DD] [--no-research] [--league NBA,NHL]
      Build the board for a date (default: today).
  pnpm settle [YYYY-MM-DD]
      Grade a date's plays once games are final (default: yesterday).
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
  if (cmd !== "scan" && cmd !== "settle") {
    console.log(HELP);
    return;
  }

  const db = openDb(cfg.databasePath);
  const deps = defaultDeps(cfg);

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
  console.log(`Settled ${n} plays for ${d}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

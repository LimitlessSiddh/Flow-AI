import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "@flow/db";

export interface Config {
  oddsApiKey: string | null;
  bookmakers: string[];
  oddsMinCredits: number;
  propEventsPerLeague: number;
  oddsScansPerDay: number;
  oddsResetDay: number;
  estimatedLines: boolean;
  preferredBook: string;
  researchProvider: "claude" | "codex" | "off";
  researchTopN: number;
  timezone: string;
  databasePath: string;
  cacheDir: string;
  apiPort: number;
}

let loaded = false;
function loadEnvFile() {
  if (loaded) return;
  loaded = true;
  const file = resolve(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadEnvFile();
  const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
  const provider = (env.RESEARCH_PROVIDER ?? "claude").toLowerCase();
  return {
    oddsApiKey: env.ODDS_API_KEY?.trim() || null,
    bookmakers: (env.ODDS_BOOKMAKERS ?? "betmgm_ca_on,betrivers_ca_on,proline_ca_on,draftkings,fanduel")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    oddsMinCredits: int(env.ODDS_MIN_CREDITS, 20),
    propEventsPerLeague: int(env.ODDS_PROP_EVENTS, 99),
    oddsScansPerDay: Math.max(1, int(env.ODDS_SCANS_PER_DAY, 2)),
    oddsResetDay: Math.min(28, Math.max(1, int(env.ODDS_RESET_DAY, 1))),
    estimatedLines: (env.ESTIMATED_LINES ?? "on").toLowerCase() !== "off",
    preferredBook: env.PREFERRED_BOOK?.trim() || "Betway",
    researchProvider: provider === "codex" ? "codex" : provider === "off" ? "off" : "claude",
    researchTopN: int(env.RESEARCH_TOP_N, 6),
    timezone: env.FLOW_TIMEZONE?.trim() || "America/Toronto",
    databasePath: env.DATABASE_PATH?.trim() || "data/flow.db",
    cacheDir: resolve(REPO_ROOT, "data/cache"),
    apiPort: int(env.API_PORT, 8787),
  };
}

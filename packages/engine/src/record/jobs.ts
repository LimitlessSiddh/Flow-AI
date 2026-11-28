import { addDays, localDate } from "@flow/core";
import type { Db } from "@flow/db";
import type { BoardOptions } from "../board.js";
import type { Config } from "../config.js";
import type { ScanDeps } from "../scan.js";
import { settleDate } from "../settle.js";
import { captureCloses } from "./close.js";
import { migrateTrackedPlays } from "./picks.js";

export const CLOSE_EVERY_MIN = 10;
export const SETTLE_EVERY_MIN = 60;
/** On startup, grade this many past days, so opening Flow in the morning grades last night. */
export const CATCH_UP_DAYS = 3;

interface Log {
  info: (msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
}

/**
 * Keeps the record up to date while the API runs: grades finished games and captures closing prices.
 * Returns a function that stops the timers.
 */
export function startRecordJobs(db: Db, cfg: Config, deps: ScanDeps, log: Log): () => void {
  const o: BoardOptions = { bookOrder: ["betway", ...cfg.bookmakers], preferredBook: cfg.preferredBook };
  const migrated = migrateTrackedPlays(db, o, deps.now());
  if (migrated) log.info(`Turned ${migrated} tracked plays into picks`);

  let busy = false;
  const guarded = (name: string, job: () => Promise<void>) => async () => {
    if (busy) return;
    busy = true;
    try {
      await job();
    } catch (e) {
      log.warn({ err: e }, `${name} failed`);
    } finally {
      busy = false;
    }
  };

  const settle = (days: number) =>
    guarded("Grading", async () => {
      const today = localDate(deps.now(), cfg.timezone);
      for (let i = days; i >= 0; i--) {
        const d = addDays(today, -i);
        const r = await settleDate(db, deps.sources, d, deps.now());
        if (r.plays + r.history + r.picks) log.info(`Graded ${d}: ${r.picks} picks, ${r.history} Flow plays`);
      }
    });
  const close = guarded("Closing prices", async () => {
    const r = await captureCloses(db, deps, cfg);
    if (r.updated) log.info(`Captured ${r.updated} closing prices for ${r.games} games`);
  });

  void settle(CATCH_UP_DAYS)();
  const timers = [
    setInterval(close, CLOSE_EVERY_MIN * 60_000),
    setInterval(settle(1), SETTLE_EVERY_MIN * 60_000),
  ];
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}

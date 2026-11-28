import { openDb } from "@flow/db";
import { defaultDeps, loadConfig, startRecordJobs } from "@flow/engine";
import { buildApp } from "./app.js";

const cfg = loadConfig();
const db = openDb(cfg.databasePath);
const deps = defaultDeps(cfg);
const app = buildApp({ db, cfg, deps });

app
  .listen({ port: cfg.apiPort, host: "127.0.0.1" })
  .then((url) => {
    app.log.info(`Flow API on ${url}`);
    // grade finished games and capture closing prices while the app is open
    startRecordJobs(db, cfg, deps, {
      info: (m) => app.log.info(m),
      warn: (o, m) => app.log.warn(o, m),
    });
  })
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });

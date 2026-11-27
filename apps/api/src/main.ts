import { openDb } from "@flow/db";
import { defaultDeps, loadConfig } from "@flow/engine";
import { buildApp } from "./app.js";

const cfg = loadConfig();
const db = openDb(cfg.databasePath);
const app = buildApp({ db, cfg, deps: defaultDeps(cfg) });

app
  .listen({ port: cfg.apiPort, host: "127.0.0.1" })
  .then((url) => app.log.info(`Flow API on ${url}`))
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });

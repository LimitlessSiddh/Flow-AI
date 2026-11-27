import cors from "@fastify/cors";
import { addDays, isIsoDate, localDate, LEAGUES, parseOdds } from "@flow/core";
import { LEAGUE_STATS, STAT_LABEL } from "@flow/data";
import { eq, scans, settings, type Db } from "@flow/db";
import {
  addManualPlay,
  clearManualPrice,
  datesSummary,
  getBoard,
  getPlay,
  ManualPlayError,
  MANUAL_BOOK,
  refreshFlags,
  rescorePropAtLine,
  runScan,
  settleDate,
  setManualPrice,
  setPlayState,
  type Config,
  type ScanDeps,
} from "@flow/engine";
import Fastify from "fastify";
import { z } from "zod";

export interface AppDeps {
  db: Db;
  cfg: Config;
  deps: ScanDeps;
}

const DateQ = z.object({ date: z.string().refine(isIsoDate, "Use YYYY-MM-DD").optional() });

export function buildApp({ db, cfg, deps }: AppDeps) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  app.register(cors, { origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] });

  const bookOrder = [MANUAL_BOOK, ...cfg.bookmakers];
  const o = { bookOrder, preferredBook: cfg.preferredBook };
  const today = () => localDate(deps.now(), cfg.timezone);
  let running: Promise<unknown> | null = null;

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError)
      return reply.status(400).send({ error: err.issues[0]?.message ?? "Bad request" });
    if (err instanceof ManualPlayError) return reply.status(422).send({ error: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: "Something went wrong on the server." });
  });

  app.get("/api/health", async () => ({ ok: true, today: today() }));

  app.get("/api/meta", async () => ({
    today: today(),
    timezone: cfg.timezone,
    preferredBook: cfg.preferredBook,
    leagues: LEAGUES,
    stats: Object.fromEntries(
      LEAGUES.map((l) => [l, LEAGUE_STATS[l].map((k) => ({ key: k, ...STAT_LABEL[k] }))]),
    ),
    oddsApi: !!cfg.oddsApiKey,
    research: cfg.researchProvider,
    settings: Object.fromEntries(
      db
        .select()
        .from(settings)
        .all()
        .map((s) => [s.key, s.value]),
    ),
  }));

  app.put("/api/settings", async (req) => {
    const body = z
      .object({
        oddsFormat: z.enum(["american", "decimal"]).optional(),
        theme: z.enum(["dark", "light", "system"]).optional(),
      })
      .parse(req.body);
    for (const [key, value] of Object.entries(body)) {
      if (value)
        db.insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } })
          .run();
    }
    return { ok: true };
  });

  app.get("/api/board", async (req) => {
    const { date = today() } = DateQ.parse(req.query);
    return getBoard(db, date, o);
  });

  app.get("/api/dates", async (req) => {
    const q = z
      .object({ from: z.string().refine(isIsoDate), to: z.string().refine(isIsoDate) })
      .partial()
      .parse(req.query);
    return datesSummary(db, q.from ?? addDays(today(), -90), q.to ?? today());
  });

  app.get<{ Params: { id: string } }>("/api/plays/:id", async (req, reply) => {
    const p = getPlay(db, req.params.id, o);
    return p ?? reply.status(404).send({ error: "Play not found" });
  });

  app.patch<{ Params: { id: string } }>("/api/plays/:id/state", async (req) => {
    const body = z
      .object({ saved: z.boolean(), dismissed: z.boolean(), tracked: z.boolean() })
      .partial()
      .parse(req.body);
    setPlayState(db, req.params.id, body);
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>("/api/plays/:id/price", async (req, reply) => {
    const body = z
      .object({ odds: z.string().min(1), line: z.number().nullable().optional() })
      .parse(req.body);
    const odds = parseOdds(body.odds);
    if (odds == null) return reply.status(400).send({ error: "Type odds like -115, +105 or 1.87" });
    if (body.line != null) {
      try {
        // Usually instant (game logs are cached). Don't leave the page waiting if a source is down.
        await Promise.race([
          rescorePropAtLine(db, deps, req.params.id, body.line),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), 12_000).unref()),
        ]);
      } catch (e) {
        req.log.warn({ err: e }, "couldn't re-score at the new line");
        return reply
          .status(503)
          .send({ error: "Couldn't load game logs to re-score at that line. Try again in a minute." });
      }
    }
    if (!setManualPrice(db, req.params.id, odds, body.line ?? null))
      return reply.status(404).send({ error: "Play not found" });
    const p = getPlay(db, req.params.id, o)!;
    refreshFlags(db, p.date, bookOrder, deps.now());
    return getPlay(db, req.params.id, o);
  });

  app.delete<{ Params: { id: string } }>("/api/plays/:id/price", async (req) => {
    clearManualPrice(db, req.params.id);
    return getPlay(db, req.params.id, o);
  });

  app.post("/api/plays", async (req, reply) => {
    const body = z
      .object({
        date: z.string().refine(isIsoDate).optional(),
        league: z.enum(["NBA", "NFL", "NHL"]),
        player: z.string().min(2).max(80),
        stat: z.enum(Object.keys(STAT_LABEL) as [string, ...string[]]),
        side: z.enum(["Over", "Under"]),
        line: z.number().min(0).max(1000),
        odds: z.string().min(1),
      })
      .parse(req.body);
    const odds = parseOdds(body.odds);
    if (odds == null) return reply.status(400).send({ error: "Type odds like -115, +105 or 1.87" });
    const id = await addManualPlay(db, cfg, deps, {
      ...body,
      date: body.date ?? today(),
      odds,
      stat: body.stat as never,
    });
    return reply.status(201).send(getPlay(db, id, o));
  });

  app.post("/api/scan", async (req, reply) => {
    const body = z
      .object({ date: z.string().refine(isIsoDate).optional(), research: z.boolean().optional() })
      .parse(req.body ?? {});
    if (running) return reply.status(409).send({ error: "A scan is already running." });
    const date = body.date ?? today();
    const job = runScan(db, cfg, date, deps, { research: body.research });
    running = job.finally(() => (running = null));
    job.catch((e) => app.log.error(e, "scan failed"));
    // return as soon as the scan row exists so the UI can poll it
    await new Promise((r) => setTimeout(r, 50));
    const scan = db.select().from(scans).where(eq(scans.date, date)).all().at(-1);
    return reply.status(202).send({ id: scan?.id ?? null, date });
  });

  app.get<{ Params: { id: string } }>("/api/scan/:id", async (req, reply) => {
    const s = db.select().from(scans).where(eq(scans.id, req.params.id)).get();
    return s ?? reply.status(404).send({ error: "Scan not found" });
  });

  app.post("/api/settle", async (req) => {
    const { date = addDays(today(), -1) } = DateQ.parse(req.body ?? {});
    return { settled: await settleDate(db, deps.sources, date) };
  });

  return app;
}

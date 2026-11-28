import cors from "@fastify/cors";
import { addDays, isIsoDate, localDate, LEAGUES, parseOdds } from "@flow/core";
import { LEAGUE_STATS, STAT_LABEL } from "@flow/data";
import { eq, scans, settings, type Db } from "@flow/db";
import {
  addManualPlay,
  clearManualPrice,
  datesSummary,
  deletePick,
  exportCsv,
  getBoard,
  getRecord,
  logPick,
  pickFromPlay,
  PickError,
  PickInputSchema,
  PickPatchSchema,
  getPlay,
  ManualPlayError,
  MANUAL_BOOK,
  refreshFlags,
  rescorePropAtLine,
  restoreScanLine,
  runScan,
  settleDate,
  setManualPrice,
  setPlayState,
  snapshotDate,
  updatePick,
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
  /** Keep Flow's history in step with what the board shows (only games that haven't started change). */
  const snapshot = (date: string) => snapshotDate(db, date, o, deps.now());

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError)
      return reply.status(400).send({ error: err.issues[0]?.message ?? "Bad request" });
    if (err instanceof ManualPlayError || err instanceof PickError)
      return reply.status(422).send({ error: err.message });
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
    const body = z.object({ saved: z.boolean(), dismissed: z.boolean() }).partial().parse(req.body);
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
    snapshot(p.date);
    return getPlay(db, req.params.id, o);
  });

  app.delete<{ Params: { id: string } }>("/api/plays/:id/price", async (req, reply) => {
    try {
      await Promise.race([
        restoreScanLine(db, deps, req.params.id),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), 12_000).unref()),
      ]);
    } catch (e) {
      req.log.warn({ err: e }, "couldn't restore the scan's line");
      return reply
        .status(503)
        .send({ error: "Couldn't load game logs to restore Flow's line. Try again in a minute." });
    }
    clearManualPrice(db, req.params.id);
    const p = getPlay(db, req.params.id, o);
    if (p) {
      refreshFlags(db, p.date, bookOrder, deps.now());
      snapshot(p.date);
    }
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
    snapshot(body.date ?? today());
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
    const r = await settleDate(db, deps.sources, date, deps.now());
    return { settled: r.plays, ...r };
  });

  // My Record
  const RecordQ = z.object({
    view: z.enum(["picks", "all"]).default("picks"),
    from: z.string().refine(isIsoDate, "Use YYYY-MM-DD").optional(),
    to: z.string().refine(isIsoDate, "Use YYYY-MM-DD").optional(),
    league: z.enum(["NBA", "NFL", "NHL"]).optional(),
  });
  const recordQuery = (raw: unknown) => {
    const q = RecordQ.parse(raw);
    return {
      view: q.view,
      from: q.from ?? null,
      to: q.to ?? today(),
      league: q.league ?? null,
      now: deps.now(),
    };
  };

  app.get("/api/record", async (req) => getRecord(db, recordQuery(req.query)));

  app.get("/api/record.csv", async (req, reply) => {
    const q = recordQuery(req.query);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="flow-${q.view}-${q.to}.csv"`)
      .send(exportCsv(db, q));
  });

  app.post("/api/picks", async (req, reply) => {
    const fromPlay = z.object({ playId: z.string().min(1) }).safeParse(req.body);
    if (fromPlay.success)
      return reply.status(201).send(pickFromPlay(db, fromPlay.data.playId, o, deps.now()));
    const pick = await logPick(db, deps.sources, PickInputSchema.parse(req.body), o, deps.now());
    return reply.status(201).send(pick);
  });

  app.patch<{ Params: { id: string } }>("/api/picks/:id", async (req) =>
    updatePick(db, req.params.id, PickPatchSchema.parse(req.body), deps.now()),
  );

  app.delete<{ Params: { id: string } }>("/api/picks/:id", async (req, reply) =>
    deletePick(db, req.params.id) ? { ok: true } : reply.status(404).send({ error: "Pick not found" }),
  );

  return app;
}

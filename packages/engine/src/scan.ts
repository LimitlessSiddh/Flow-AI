import {
  betValue,
  daysUntilReset,
  evidenceQuality,
  formatOdds,
  LEAGUES,
  propCreditBudget,
  tier,
  watchReasons,
  type League,
} from "@flow/core";
import {
  findByName,
  leagueSources,
  mapLimit,
  OddsApi,
  setCacheDir,
  STAT_LABEL,
  type Game,
  type LeagueSource,
  type Player,
  type PlayerGame,
  type Quote,
  type StatKey,
  type TeamGameResult,
  type TeamRef,
} from "@flow/data";
import {
  and,
  eq,
  games as gamesT,
  inArray,
  leftOff,
  picks as picksT,
  plays as playsT,
  prices as pricesT,
  scans,
  sources as sourcesT,
  userState,
  type Db,
  type NewPlay,
  type PriceRow,
} from "@flow/db";
import { randomUUID } from "node:crypto";
import {
  marketLabel,
  propEvidence,
  score,
  teamEvidence,
  toPlayRow,
  type Evidence,
  type Market,
  type Scored,
} from "./analyze.js";
import type { Config } from "./config.js";
import { espnGameLines } from "./espnOdds.js";
import { estimatedMarkets, pricedKey } from "./estimate.js";
import { MANUAL_BOOK } from "./ids.js";
import { minutesOld, pickPrice } from "./prices.js";
import { snapshotDate } from "./record/history.js";
import { makeProvider } from "./research/cli.js";
import type { ResearchProvider } from "./research/types.js";

export interface ScanDeps {
  sources: Record<League, LeagueSource>;
  odds: OddsApi | null;
  espnLines: typeof espnGameLines;
  research: ResearchProvider | null;
  now: () => Date;
}

export function defaultDeps(cfg: Config): ScanDeps {
  setCacheDir(cfg.cacheDir);
  return {
    sources: leagueSources(cfg.timezone),
    odds: cfg.oddsApiKey ? new OddsApi(cfg.oddsApiKey, cfg.bookmakers) : null,
    espnLines: espnGameLines,
    research: makeProvider(cfg.researchProvider),
    now: () => new Date(),
  };
}

/** Props asked for per game when spending Odds API credits. One credit each. */
export const DEFAULT_PROP_STATS: Record<League, StatKey[]> = {
  NBA: ["points"],
  NFL: ["recYds", "rushYds"],
  NHL: ["shots"],
};

export const MIN_SIGNAL_TO_SHOW = 55;

type Step = (text: string, level?: "info" | "warn" | "error") => void;

export async function runScan(
  db: Db,
  cfg: Config,
  date: string,
  deps: ScanDeps = defaultDeps(cfg),
  opts: { research?: boolean; leagues?: League[] } = {},
): Promise<string> {
  const scanId = randomUUID();
  const steps: { at: string; text: string; level: "info" | "warn" | "error" }[] = [];
  db.insert(scans)
    .values({ id: scanId, date, startedAt: deps.now().toISOString(), status: "running", steps })
    .run();
  const step: Step = (text, level = "info") => {
    steps.push({ at: deps.now().toISOString(), text, level });
    db.update(scans)
      .set({ steps: [...steps] })
      .where(eq(scans.id, scanId))
      .run();
  };

  try {
    const leagues = opts.leagues ?? [...LEAGUES];
    // 1. Slate
    const slate: Game[] = [];
    for (const lg of leagues) {
      try {
        const g = await deps.sources[lg].games(date);
        slate.push(...g);
        step(`${lg}: ${g.length} game${g.length === 1 ? "" : "s"}`);
      } catch (e) {
        step(`${lg}: couldn't load the schedule (${msg(e)})`, "warn");
      }
    }
    for (const g of slate) {
      const row = {
        ...g,
        homeScore: g.homeScore ?? null,
        awayScore: g.awayScore ?? null,
        updatedAt: deps.now().toISOString(),
      };
      db.insert(gamesT).values(row).onConflictDoUpdate({ target: gamesT.id, set: row }).run();
    }
    const upcoming = slate.filter((g) => g.status === "scheduled");

    // 2. Prices
    const quotes: Quote[] = [];
    for (const lg of leagues) {
      const lgGames = upcoming.filter((g) => g.league === lg);
      if (!lgGames.length) continue;
      let gotLines = false;
      if (deps.odds) {
        try {
          const q = await deps.odds.gameLines(lg, lgGames);
          quotes.push(...q);
          gotLines = q.length > 0;
          step(`${lg}: ${q.length} game-line prices from The Odds API`);
        } catch (e) {
          step(`${lg}: The Odds API failed (${msg(e)})`, "warn");
        }
      }
      if (!gotLines) {
        try {
          const q = await deps.espnLines(lg, date, lgGames);
          quotes.push(...q);
          step(`${lg}: ${q.length} backup game-line prices from ESPN`);
        } catch (e) {
          step(`${lg}: ESPN odds failed (${msg(e)})`, "warn");
        }
      }
    }
    if (deps.odds) {
      try {
        quotes.push(...(await propQuotes(deps.odds, upcoming, cfg, date, step)));
      } catch (e) {
        step(`Player props failed (${msg(e)})`, "warn");
      }
    }
    if (!deps.odds)
      step(
        "No ODDS_API_KEY set, so there are no player props. Add a free key, or add plays by hand.",
        "warn",
      );

    // 3. Markets and scoring
    const bookOrder = [MANUAL_BOOK, ...cfg.bookmakers];
    const markets: Option[][] = groupMarkets(quotes, upcoming, date, bookOrder);
    const ctx = new Ctx(deps.sources, date);
    if (cfg.estimatedLines) {
      const priced = new Set(
        markets
          .map((g) => g[0]!.m)
          .filter((m) => m.kind === "prop" && m.stat)
          .map((m) => pricedKey(m.game.id, m.subject, m.stat!)),
      );
      try {
        const est = await estimatedMarkets(
          { roster: (lg, t) => ctx.roster(lg, t), log: (lg, p) => ctx.log(lg, p) },
          upcoming,
          date,
          priced,
        );
        markets.push(...est);
        step(`Estimated lines for ${est.length} player props with no real price`);
      } catch (e) {
        step(`Estimated lines failed (${msg(e)})`, "warn");
      }
    }
    step(`Scoring ${markets.length} markets`);
    const evaluated: { m: Market; ev: Evidence; s: Scored; q: Quote[] }[] = [];
    const skipped: { market: string; reason: string }[] = [];
    await mapLimit(markets, 4, async (group) => {
      const options: { m: Market; ev: Evidence; s: Scored; q: Quote[] }[] = [];
      for (const opt of group) {
        try {
          const ev = await ctx.evidence(opt.m);
          if (!ev) {
            skipped.push({ market: describe(opt.m), reason: "Couldn't match this player to a game log." });
            continue;
          }
          options.push({ m: opt.m, ev, s: score(ev), q: opt.quotes });
        } catch (e) {
          skipped.push({ market: describe(opt.m), reason: `Data source error: ${msg(e)}` });
        }
      }
      const best = options.filter((o) => o.s.signal != null).sort((a, b) => b.s.signal! - a.s.signal!)[0];
      if (best) evaluated.push(best);
      else if (options[0])
        skipped.push({ market: describe(options[0].m), reason: "Too few games this season to judge." });
    });

    const shown = evaluated.filter((e) => e.s.signal! >= MIN_SIGNAL_TO_SHOW);
    const weak = evaluated.length - shown.length;
    if (weak)
      skipped.push({
        market: `${weak} more markets`,
        reason: `Flow Signal under ${MIN_SIGNAL_TO_SHOW}, so recent form doesn't point either way.`,
      });
    step(`${shown.length} plays made the board`);

    // 4. Save
    saveBoard(db, date, scanId, shown, skipped);

    // 5. Research the top plays
    if (deps.research && opts.research !== false) {
      const top = shown.sort((a, b) => b.s.signal! - a.s.signal!).slice(0, cfg.researchTopN);
      step(`Researching the top ${top.length} plays with ${deps.research.name}`);
      await mapLimit(top, 2, async (e) => {
        const row = toPlayRow(e.m, e.ev, e.s, scanId, "scan");
        const last = db
          .select({ at: sourcesT.retrievedAt })
          .from(sourcesT)
          .where(eq(sourcesT.playId, row.id!))
          .get();
        if (last && minutesOld(last.at, deps.now()) < 180) return; // researched in the last 3 hours
        try {
          await researchPlay(db, deps.research!, row.id!, bookOrder, cfg.preferredBook);
          step(`Researched ${describe(e.m)}`);
        } catch (err) {
          step(`Research failed for ${describe(e.m)} (${msg(err)})`, "warn");
        }
      });
    } else {
      step("AI research is off, so reads use Flow's numbers only.");
    }

    refreshFlags(db, date, bookOrder, deps.now());
    const kept = snapshotDate(db, date, { bookOrder, preferredBook: cfg.preferredBook }, deps.now());
    step(`Saved ${kept} plays to Flow's history`);
    db.update(scans)
      .set({
        status: "done",
        finishedAt: deps.now().toISOString(),
        playCount: shown.length,
        oddsCreditsRemaining: deps.odds?.credits.remaining ?? null,
      })
      .where(eq(scans.id, scanId))
      .run();
    step("Done");
    return scanId;
  } catch (e) {
    step(`Scan failed: ${msg(e)}`, "error");
    db.update(scans)
      .set({ status: "failed", finishedAt: deps.now().toISOString() })
      .where(eq(scans.id, scanId))
      .run();
    throw e;
  }
}

/**
 * Real prices for player props, one game at a time, until this scan's share of the month's credits is spent.
 * Games are taken in start order, alternating leagues, so every league gets some.
 */
async function propQuotes(
  odds: OddsApi,
  games: Game[],
  cfg: Config,
  date: string,
  step: Step,
): Promise<Quote[]> {
  const left = odds.credits.remaining;
  if (left == null) return [];
  const budget = propCreditBudget({
    remaining: left,
    daysLeft: daysUntilReset(date, cfg.oddsResetDay),
    scansPerDay: cfg.oddsScansPerDay,
    reserve: cfg.oddsMinCredits,
  });
  if (budget <= 0) {
    step(`Odds API credits are low (${left} left), so real prop prices were skipped this scan.`, "warn");
    return [];
  }
  const byLeague = new Map<League, Game[]>();
  for (const g of [...games].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const lg = g.league as League;
    const list = byLeague.get(lg) ?? [];
    if (list.length < cfg.propEventsPerLeague) list.push(g);
    byLeague.set(lg, list);
  }
  const order: Game[] = [];
  for (let i = 0; [...byLeague.values()].some((l) => i < l.length); i++)
    for (const l of byLeague.values()) if (l[i]) order.push(l[i]!);

  const events = new Map<League, Awaited<ReturnType<OddsApi["events"]>>>();
  const out: Quote[] = [];
  const counts = new Map<League, { games: number; prices: number }>();
  let lastCost = 0;
  for (const g of order) {
    const spent = left - (odds.credits.remaining ?? left);
    if (spent + lastCost > budget) break;
    const lg = g.league as League;
    if (!events.has(lg)) events.set(lg, await odds.events(lg));
    const ev = events
      .get(lg)!
      .find(
        (e) =>
          e.home.toLowerCase() === g.home.name.toLowerCase() &&
          e.away.toLowerCase() === g.away.name.toLowerCase(),
      );
    if (!ev) continue;
    const before = odds.credits.remaining ?? left;
    const q = await odds.props(lg, ev.id, g, DEFAULT_PROP_STATS[lg]);
    lastCost = Math.max(lastCost, before - (odds.credits.remaining ?? before));
    out.push(...q);
    const c = counts.get(lg) ?? { games: 0, prices: 0 };
    counts.set(lg, { games: c.games + 1, prices: c.prices + q.length });
  }
  for (const [lg, c] of counts)
    step(`${lg}: ${c.prices} real player-prop prices for ${c.games} game${c.games === 1 ? "" : "s"}`);
  const spent = left - (odds.credits.remaining ?? left);
  step(
    `Spent ${spent} of this scan's ${budget}-credit share on props (${odds.credits.remaining ?? "?"} left this month)`,
  );
  return out;
}

interface Option {
  m: Market;
  quotes: Quote[];
}

/**
 * Turn raw quotes into markets. Each group holds the sides Flow compares (Over vs Under, team A vs team B),
 * and each side is priced at one line: the line your highest-ranked book offers.
 */
export function groupMarkets(quotes: Quote[], games: Game[], date: string, bookOrder: string[]): Option[][] {
  const rank = (b: string) => {
    const i = bookOrder.indexOf(b);
    return i >= 0 ? i : 100;
  };
  const byGame = new Map(games.map((g) => [g.id, g]));
  const groups = new Map<string, Quote[]>();
  for (const q of quotes) {
    const key = q.kind === "prop" ? `${q.gameId}|prop|${q.player}|${q.stat}` : `${q.gameId}|${q.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  const out: Option[][] = [];
  for (const qs of groups.values()) {
    const game = byGame.get(qs[0]!.gameId);
    if (!game) continue;
    const sides = [...new Set(qs.map((q) => q.side))];
    const opts: Option[] = [];
    for (const side of sides) {
      const sq = qs.filter((q) => q.side === side).sort((a, b) => rank(a.book) - rank(b.book));
      const line = sq[0]!.line;
      const atLine = sq.filter((q) => q.line === line);
      const first = sq[0]!;
      const isTeam = first.kind === "moneyline" || first.kind === "spread";
      const m: Market = {
        date,
        game,
        kind: first.kind,
        subject:
          first.kind === "prop" ? first.player! : isTeam ? side : `${game.away.code} @ ${game.home.code}`,
        team: isTeam ? side : undefined,
        stat: first.stat,
        side,
        line,
      };
      opts.push({ m, quotes: atLine });
    }
    if (opts.length) out.push(opts);
  }
  return out;
}

/** Fetches and caches the evidence each market needs, so a slate costs as few calls as possible. */
class Ctx {
  private teamRes = new Map<string, Promise<TeamGameResult[]>>();
  private rosters = new Map<string, Promise<Player[]>>();
  private logs = new Map<string, Promise<PlayerGame[]>>();
  constructor(
    private sources: Record<League, LeagueSource>,
    private date: string,
  ) {}

  results(lg: League, t: TeamRef) {
    const k = `${lg}:${t.code}`;
    if (!this.teamRes.has(k)) this.teamRes.set(k, this.sources[lg].teamResults(t, this.date));
    return this.teamRes.get(k)!;
  }
  roster(lg: League, t: TeamRef) {
    const k = `${lg}:${t.code}`;
    if (!this.rosters.has(k))
      this.rosters.set(
        k,
        this.sources[lg].roster(t).catch(() => []),
      );
    return this.rosters.get(k)!;
  }
  log(lg: League, p: Player) {
    if (!this.logs.has(p.id)) this.logs.set(p.id, this.sources[lg].playerLog(p, this.date));
    return this.logs.get(p.id)!;
  }

  async player(game: Game, name: string): Promise<Player | undefined> {
    const lg = game.league as League;
    const [h, a] = await Promise.all([this.roster(lg, game.home), this.roster(lg, game.away)]);
    return findByName([...h, ...a], name);
  }

  async evidence(m: Market): Promise<Evidence | null> {
    const lg = m.game.league as League;
    if (m.kind === "prop") {
      const p = await this.player(m.game, m.subject);
      if (!p || !m.stat || m.line == null) return null;
      m.team = p.team;
      const ev = propEvidence(await this.log(lg, p), m.stat, m.line, m.side);
      return { ...ev, position: p.position, subjectId: p.id, headshot: p.headshot };
    }
    if (m.kind === "total") {
      const [h, a] = await Promise.all([this.results(lg, m.game.home), this.results(lg, m.game.away)]);
      return teamEvidence(m, h, a);
    }
    const home = m.side === m.game.home.code;
    const [me, opp] = await Promise.all([
      this.results(lg, home ? m.game.home : m.game.away),
      this.results(lg, home ? m.game.away : m.game.home),
    ]);
    return teamEvidence(m, me, opp);
  }
}

function saveBoard(
  db: Db,
  date: string,
  scanId: string,
  shown: { m: Market; ev: Evidence; s: Scored; q: Quote[] }[],
  skipped: { market: string; reason: string }[],
) {
  db.transaction((tx) => {
    const rows = shown.map((e) => ({ row: toPlayRow(e.m, e.ev, e.s, scanId, "scan"), q: e.q }));
    const keep = new Set(rows.map((r) => r.row.id!));
    // Drop earlier scan plays for this date that didn't come back, unless you saved them or logged a pick.
    // play_history keeps its own copy either way.
    const old = tx
      .select({ id: playsT.id })
      .from(playsT)
      .where(and(eq(playsT.date, date), eq(playsT.origin, "scan")))
      .all();
    const pinned = new Set([
      ...tx
        .select({ id: userState.playId })
        .from(userState)
        .all()
        .map((r) => r.id),
      ...tx
        .select({ id: picksT.playId })
        .from(picksT)
        .where(eq(picksT.date, date))
        .all()
        .map((r) => r.id),
    ]);
    const drop = old.map((o) => o.id).filter((id) => !keep.has(id) && !pinned.has(id));
    if (drop.length) tx.delete(playsT).where(inArray(playsT.id, drop)).run();

    for (const { row, q } of rows) {
      const existing = tx.select().from(playsT).where(eq(playsT.id, row.id!)).get();
      const mine = tx
        .select({ line: pricesT.line })
        .from(pricesT)
        .where(and(eq(pricesT.playId, row.id!), eq(pricesT.book, MANUAL_BOOK)))
        .get();
      if (existing && row.kind === "prop" && mine?.line != null && mine.line !== row.line) {
        // You typed Betway's line and the play was re-scored at it. Keep that; only refresh book prices.
        tx.update(playsT).set({ scanId }).where(eq(playsT.id, row.id!)).run();
        replaceApiPrices(tx, row.id!, q);
        continue;
      }
      const merged: NewPlay = existing?.researchedBy
        ? // keep yesterday's research text and availability; numbers refresh
          {
            ...row,
            read: existing.read,
            counter: existing.counter,
            availability: existing.availability,
            researchedBy: existing.researchedBy,
          }
        : row;
      tx.insert(playsT).values(merged).onConflictDoUpdate({ target: playsT.id, set: merged }).run();
      replaceApiPrices(tx, row.id!, q);
    }
    tx.delete(leftOff).where(eq(leftOff.date, date)).run();
    for (const s of skipped.slice(0, 40))
      tx.insert(leftOff).values({ date, market: s.market, reason: s.reason, scanId }).run();
  });
}

function replaceApiPrices(tx: Pick<Db, "delete" | "insert">, playId: string, q: Quote[]) {
  tx.delete(pricesT)
    .where(and(eq(pricesT.playId, playId), eq(pricesT.origin, "api")))
    .run();
  const seen = new Set<string>();
  for (const quote of q) {
    if (seen.has(quote.book)) continue;
    seen.add(quote.book);
    tx.insert(pricesT)
      .values({
        playId,
        book: quote.book,
        bookTitle: quote.bookTitle,
        odds: quote.odds,
        line: quote.line,
        retrievedAt: quote.retrievedAt || new Date().toISOString(),
        origin: "api",
      })
      .onConflictDoNothing()
      .run();
  }
}

export async function researchPlay(
  db: Db,
  provider: ResearchProvider,
  id: string,
  bookOrder: string[],
  preferredBook: string,
) {
  const play = db.select().from(playsT).where(eq(playsT.id, id)).get();
  if (!play) throw new Error("Play not found");
  const game = db.select().from(gamesT).where(eq(gamesT.id, play.gameId)).get();
  const prices = db.select().from(pricesT).where(eq(pricesT.playId, id)).all();
  const price = pickPrice(prices, bookOrder);
  const value = betValue(play.model, price?.odds ?? null);
  const w = (n: number) => play.windows.find((x) => x.n === n);
  const statLabel = play.stat ? STAT_LABEL[play.stat as StatKey]?.label : play.kind;
  const formParts = [
    w(5) && `cleared the line in ${w(5)!.hits} of the last 5`,
    w(10) && `${w(10)!.hits} of the last 10`,
    play.seasonGames != null &&
      `${Math.round((play.seasonRate ?? 0) * 100)}% of ${play.seasonGames} games this season`,
    w(10) && `last-10 average ${w(10)!.avg} vs season ${play.seasonAvg}`,
  ].filter(Boolean);
  const result = await provider.research({
    league: play.league,
    game: game ? `${game.away.code} @ ${game.home.code}, starts ${game.startTime}` : play.gameId,
    market: `${play.subject}${play.team && play.kind === "prop" ? ` (${play.team})` : ""}, ${marketLabel({ kind: play.kind as Market["kind"], side: play.side, line: play.line, stat: play.stat as StatKey | undefined, subject: play.subject })}`,
    subject: play.subject,
    team: play.team ?? undefined,
    price: price
      ? `${formatOdds(price.odds)} at ${price.book === MANUAL_BOOK ? preferredBook : price.bookTitle}`
      : "no price",
    form: `${statLabel}: ${formParts.join("; ")}.`,
    signal: play.signal,
    value,
  });
  const at = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(playsT)
      .set({
        read: result.read,
        counter: result.counter,
        availability: result.availability,
        context: [
          ...play.context,
          ...result.context.filter((c) => !play.context.some((x) => x.label === c.label)),
        ].slice(0, 5),
        researchedBy: provider.name,
        updatedAt: at,
      })
      .where(eq(playsT.id, id))
      .run();
    tx.delete(sourcesT).where(eq(sourcesT.playId, id)).run();
    for (const s of result.sources)
      tx.insert(sourcesT)
        .values({ playId: id, ...s, retrievedAt: at })
        .run();
  });
}

/** Recompute Watch labels and evidence quality from what's stored. */
export function refreshFlags(db: Db, date: string, bookOrder: string[], now = new Date()) {
  const rows = db.select().from(playsT).where(eq(playsT.date, date)).all();
  for (const p of rows) {
    const prices: PriceRow[] = db.select().from(pricesT).where(eq(pricesT.playId, p.id)).all();
    const srcs = db.select().from(sourcesT).where(eq(sourcesT.playId, p.id)).all();
    const price = pickPrice(prices, bookOrder);
    const form = {
      windows: p.windows.map((w) => ({ ...w, games: w.n, rate: w.hits / w.n })),
      season: { games: p.seasonGames ?? 0, avg: p.seasonAvg ?? 0, rate: p.seasonRate ?? 0, sd: 0 },
      streak: p.streak,
      playedRecent: p.log.filter((g) => g.value != null).length,
    };
    const watch = watchReasons({
      form,
      priceAgeMinutes: price ? minutesOld(price.retrievedAt, now) : null,
      sourceCount: p.researchedBy ? srcs.length : 1, // don't flag "no sources" when research never ran
      availability: p.availability?.status,
    });
    if (!price) watch.push("No price found for this market yet. Add your Betway price.");
    const quality = evidenceQuality(form, srcs.length, srcs.filter((s) => s.corroborated).length);
    db.update(playsT).set({ watch, quality }).where(eq(playsT.id, p.id)).run();
  }
}

const describe = (m: Market) =>
  `${m.game.away.code} @ ${m.game.home.code} · ${m.kind === "prop" ? m.subject + " " : ""}${marketLabel(m)}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export { tier };

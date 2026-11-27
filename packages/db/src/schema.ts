import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const now = () => new Date().toISOString();

export const games = sqliteTable(
  "games",
  {
    id: text("id").primaryKey(),
    league: text("league").notNull(),
    date: text("date").notNull(),
    startTime: text("start_time").notNull(),
    status: text("status").notNull(),
    home: json<{ code: string; name: string; logo?: string; color?: string; sourceId: string }>(
      "home",
    ).notNull(),
    away: json<{ code: string; name: string; logo?: string; color?: string; sourceId: string }>(
      "away",
    ).notNull(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    sourceId: text("source_id").notNull(),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("games_date").on(t.date)],
);

export interface WindowJson {
  n: number;
  avg: number;
  hits: number;
}
export interface ContextRow {
  label: string;
  recent: number;
  season: number;
}

export const plays = sqliteTable(
  "plays",
  {
    id: text("id").primaryKey(), // date + market, stable across rescans
    date: text("date").notNull(),
    gameId: text("game_id").notNull(),
    league: text("league").notNull(),
    kind: text("kind").notNull(), // prop | moneyline | spread | total
    subject: text("subject").notNull(), // player name, or team code for team markets
    subjectId: text("subject_id"),
    team: text("team"),
    position: text("position"),
    headshot: text("headshot"),
    stat: text("stat"), // StatKey for props
    side: text("side").notNull(),
    line: real("line"),
    // book: the line came with a real price. estimated: Flow guessed it; your Betway line replaces it.
    lineSource: text("line_source").notNull().default("book"),
    // the line and source the scan scored, so clearing your Betway price puts the play back
    scanLine: real("scan_line"),
    scanLineSource: text("scan_line_source"),
    signal: integer("signal"),
    model: real("model"), // Flow's chance, 0..1
    quality: integer("quality").notNull().default(1),
    watch: json<string[]>("watch")
      .notNull()
      .$defaultFn(() => []),
    log: json<{ date: string; opponent?: string; value: number | null }[]>("log").notNull(),
    windows: json<WindowJson[]>("windows").notNull(),
    seasonAvg: real("season_avg"),
    seasonGames: integer("season_games"),
    seasonRate: real("season_rate"),
    streak: integer("streak").notNull().default(0),
    context: json<ContextRow[]>("context")
      .notNull()
      .$defaultFn(() => []),
    read: text("read"),
    counter: text("counter"),
    availability: json<{ status: "ok" | "questionable" | "out" | "unknown"; text: string }>("availability"),
    origin: text("origin").notNull().default("scan"), // scan | manual
    researchedBy: text("researched_by"),
    scanId: text("scan_id"),
    createdAt: text("created_at").notNull().$defaultFn(now),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("plays_date").on(t.date)],
);

export const prices = sqliteTable(
  "prices",
  {
    playId: text("play_id")
      .notNull()
      .references(() => plays.id, { onDelete: "cascade" }),
    book: text("book").notNull(), // bookmaker key, or "betway" for prices you typed in
    bookTitle: text("book_title").notNull(),
    odds: integer("odds").notNull(), // American
    line: real("line"),
    retrievedAt: text("retrieved_at").notNull(),
    origin: text("origin").notNull(), // api | manual
  },
  (t) => [primaryKey({ columns: [t.playId, t.book] })],
);

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playId: text("play_id")
    .notNull()
    .references(() => plays.id, { onDelete: "cascade" }),
  publisher: text("publisher").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  retrievedAt: text("retrieved_at").notNull(),
  corroborated: integer("corroborated", { mode: "boolean" }).notNull().default(false),
});

export const userState = sqliteTable("user_state", {
  playId: text("play_id").primaryKey(),
  saved: integer("saved", { mode: "boolean" }).notNull().default(false),
  dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
  tracked: integer("tracked", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

export const results = sqliteTable("results", {
  playId: text("play_id").primaryKey(),
  value: real("value"),
  won: integer("won", { mode: "boolean" }),
  push: integer("push", { mode: "boolean" }).notNull().default(false),
  settledAt: text("settled_at").notNull().$defaultFn(now),
});

export const scans = sqliteTable("scans", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(), // running | done | failed
  steps: json<{ at: string; text: string; level: "info" | "warn" | "error" }[]>("steps")
    .notNull()
    .$defaultFn(() => []),
  oddsCreditsRemaining: integer("odds_credits_remaining"),
  playCount: integer("play_count"),
});

export const leftOff = sqliteTable("left_off", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  market: text("market").notNull(),
  reason: text("reason").notNull(),
  scanId: text("scan_id"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type GameRow = typeof games.$inferSelect;
export type PlayRow = typeof plays.$inferSelect;
export type NewPlay = typeof plays.$inferInsert;
export type PriceRow = typeof prices.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type ScanRow = typeof scans.$inferSelect;

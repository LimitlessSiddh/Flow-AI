import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  /** Legacy: "Track result" before picks existed. Converted to rows in `picks` on startup. */
  tracked: integer("tracked", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().$defaultFn(now),
});

/** Closing price: the last price captured before the game started. Shared by history and picks. */
const closeColumns = () => ({
  closeOdds: integer("close_odds"),
  closeLine: real("close_line"),
  closeBook: text("close_book"),
  closeAt: text("close_at"),
});

/** Grading. outcome: win | loss | push | void (player didn't play). */
const gradeColumns = () => ({
  outcome: text("outcome"),
  resultValue: real("result_value"),
  gradedAt: text("graded_at"),
});

/**
 * Every play Flow put on the board, frozen as it stood before its game started.
 * The board's `plays` table is rewritten by each scan and loses plays that drop off. This table never does:
 * it is the permanent record used to check Flow's model. Snapshots stop updating once the game starts.
 */
export const playHistory = sqliteTable(
  "play_history",
  {
    playId: text("play_id").primaryKey(),
    date: text("date").notNull(),
    gameId: text("game_id").notNull(),
    league: text("league").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    subjectId: text("subject_id"),
    team: text("team"),
    stat: text("stat"),
    side: text("side").notNull(),
    line: real("line"),
    lineSource: text("line_source").notNull(),
    startTime: text("start_time").notNull(),
    signal: integer("signal"),
    model: real("model"), // Flow's form-based rate, 0..1
    estimate: real("estimate"), // Flow's chance at the price, 0..1
    value: real("value"), // bet value, percentage points
    odds: integer("odds"), // the price Flow judged, American
    book: text("book"),
    bookTitle: text("book_title"),
    priceOrigin: text("price_origin"), // api | manual
    quality: integer("quality").notNull(),
    watchCount: integer("watch_count").notNull().default(0),
    origin: text("origin").notNull(), // scan | manual
    modelVersion: text("model_version").notNull(),
    // false when a later pre-game scan dropped it from the board; the record counts on-board plays only
    onBoard: integer("on_board", { mode: "boolean" }).notNull().default(true),
    firstSeenAt: text("first_seen_at").notNull(),
    snapshotAt: text("snapshot_at").notNull(),
    ...closeColumns(),
    ...gradeColumns(),
  },
  (t) => [index("play_history_date").on(t.date), index("play_history_game").on(t.gameId)],
);

/**
 * Bets you placed. Snapshot of the play and Flow's numbers when you logged it, plus the price you got.
 * A pick can exist without a Flow play (a bet you found yourself), so it doesn't depend on `plays`.
 */
export const picks = sqliteTable(
  "picks",
  {
    id: text("id").primaryKey(),
    playId: text("play_id"), // the Flow play this came from, if any
    date: text("date").notNull(),
    league: text("league").notNull(),
    gameId: text("game_id"),
    startTime: text("start_time"),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    subjectId: text("subject_id"),
    team: text("team"),
    stat: text("stat"),
    side: text("side").notNull(),
    line: real("line"),
    odds: integer("odds"), // the price you got, American. null = you didn't record it
    book: text("book"),
    // Flow's numbers when you logged it (null when Flow had no play for this market)
    signal: integer("signal"),
    model: real("model"),
    estimate: real("estimate"),
    value: real("value"),
    modelVersion: text("model_version"),
    source: text("source").notNull(), // board | manual | import
    note: text("note"),
    ...closeColumns(),
    ...gradeColumns(),
    gradedBy: text("graded_by"), // flow | you
    createdAt: text("created_at").notNull().$defaultFn(now),
    updatedAt: text("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("picks_date").on(t.date), uniqueIndex("picks_play").on(t.playId)],
);

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
export type HistoryRow = typeof playHistory.$inferSelect;
export type NewHistory = typeof playHistory.$inferInsert;
export type PickRow = typeof picks.$inferSelect;
export type NewPick = typeof picks.$inferInsert;

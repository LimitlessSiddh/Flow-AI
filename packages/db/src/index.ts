import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };
export { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

export type Db = BetterSQLite3Database<typeof schema>;

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");
const MIGRATIONS = resolve(here, "../drizzle");

/** Open (and migrate) the database. Pass ":memory:" for tests. */
export function openDb(path = process.env.DATABASE_PATH ?? "data/flow.db"): Db {
  const file = path === ":memory:" ? path : isAbsolute(path) ? path : resolve(REPO_ROOT, path);
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

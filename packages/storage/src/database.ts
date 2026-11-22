import { DatabaseSync } from "node:sqlite";
import { AgentContextError } from "@agentcontext/shared";
import { MIGRATIONS } from "./migrations.js";

export type Database = DatabaseSync;

/**
 * Open (or create) the metadata database and apply pending migrations.
 *
 * Pragmas: WAL journal (file databases), `synchronous = FULL` so committed
 * transactions survive power loss, foreign keys on, 5 s busy timeout.
 */
export function openDatabase(path: string): Database {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (error) {
    throw new AgentContextError(
      "STORAGE_ERROR",
      "Could not open the metadata database",
      undefined,
      {
        cause: error,
      },
    );
  }
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

/** Apply migrations newer than the recorded schema version, each in its own transaction. */
export function migrate(db: Database): number {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
    version: number | null;
  };
  const current = row.version ?? 0;
  const latest = MIGRATIONS.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new AgentContextError(
      "STORAGE_ERROR",
      "The metadata database was created by a newer AgentContext version",
      { schemaVersion: current, supportedVersion: latest },
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now(),
      );
    });
  }
  return latest;
}

/** Run `fn` inside BEGIN IMMEDIATE / COMMIT, rolling back on any error. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // the original error is more useful
    }
    throw error;
  }
}

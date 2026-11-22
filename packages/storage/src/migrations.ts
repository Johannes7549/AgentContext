/**
 * Ordered schema migrations (ADR-0002). Never edit a released migration; add a
 * new one. Timestamps are integer milliseconds since the Unix epoch.
 */
export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE contexts (
        id             TEXT PRIMARY KEY,
        workspace_id   TEXT NOT NULL,
        session_id     TEXT NOT NULL,
        content_hash   TEXT NOT NULL,
        content_type   TEXT NOT NULL,
        source         TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL,
        created_at     INTEGER NOT NULL,
        expires_at     INTEGER NOT NULL,
        blob_ref       TEXT,
        inline_content TEXT,
        CHECK ((blob_ref IS NULL) <> (inline_content IS NULL))
      );
      CREATE INDEX contexts_scope   ON contexts (workspace_id, session_id);
      CREATE INDEX contexts_expiry  ON contexts (expires_at);
      CREATE INDEX contexts_created ON contexts (created_at);
      CREATE INDEX contexts_blob    ON contexts (blob_ref);

      CREATE TABLE context_variants (
        id                TEXT PRIMARY KEY,
        context_id        TEXT NOT NULL REFERENCES contexts (id) ON DELETE CASCADE,
        strategy          TEXT NOT NULL,
        strategy_version  TEXT NOT NULL,
        optimized_content TEXT NOT NULL,
        original_tokens   INTEGER NOT NULL,
        optimized_tokens  INTEGER NOT NULL,
        tokenizer_id      TEXT NOT NULL,
        tokenizer_version TEXT NOT NULL,
        tokenizer_exact   INTEGER NOT NULL,
        created_at        INTEGER NOT NULL
      );
      CREATE INDEX variants_context ON context_variants (context_id, created_at);

      CREATE TABLE omitted_segments (
        variant_id        TEXT NOT NULL REFERENCES context_variants (id) ON DELETE CASCADE,
        segment_id        TEXT NOT NULL,
        position          INTEGER NOT NULL,
        segment_type      TEXT NOT NULL,
        original_location TEXT NOT NULL,
        reason            TEXT NOT NULL,
        recoverable       INTEGER NOT NULL,
        occurrences       INTEGER,
        note              TEXT,
        PRIMARY KEY (variant_id, segment_id)
      );

      CREATE TABLE optimization_events (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        context_id         TEXT,
        session_id         TEXT,
        event_type         TEXT NOT NULL,
        strategy           TEXT NOT NULL,
        original_tokens    INTEGER NOT NULL,
        optimized_tokens   INTEGER NOT NULL,
        recovered_tokens   INTEGER NOT NULL,
        tokenizer_id       TEXT NOT NULL,
        tokenizer_version  TEXT NOT NULL,
        tokenizer_exact    INTEGER NOT NULL,
        processing_time_ms REAL NOT NULL,
        created_at         INTEGER NOT NULL
      );
      CREATE INDEX events_created ON optimization_events (created_at);
    `,
  },
];

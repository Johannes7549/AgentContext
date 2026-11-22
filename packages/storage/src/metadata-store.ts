import type {
  ContentType,
  OmittedSegment,
  OptimizationEvent,
  StoredContext,
  TokenizerInfo,
} from "@agentcontext/shared";
import { type Database, transaction } from "./database.js";

export interface ContextRecord extends StoredContext {
  blobRef: string | null;
  inlineContent: string | null;
}

export interface VariantRecord {
  variantId: string;
  contextId: string;
  strategy: string;
  strategyVersion: string;
  optimizedContent: string;
  originalTokens: number;
  optimizedTokens: number;
  tokenizer: TokenizerInfo;
  createdAt: Date;
}

export interface EventFilter {
  since?: Date;
  sessionId?: string;
}

interface ContextRow {
  id: string;
  workspace_id: string;
  session_id: string;
  content_hash: string;
  content_type: string;
  source: string;
  size_bytes: number;
  created_at: number;
  expires_at: number;
  blob_ref: string | null;
  inline_content: string | null;
}

interface SegmentRow {
  segment_id: string;
  segment_type: string;
  original_location: string;
  reason: string;
  recoverable: number;
  occurrences: number | null;
  note: string | null;
}

/**
 * Typed access to the SQLite metadata tables (ADR-0002). Contains no policy:
 * hashing, blobs, TTL and scope checks live in higher layers.
 */
export class MetadataStore {
  constructor(private readonly db: Database) {}

  insertContext(record: ContextRecord): void {
    this.db
      .prepare(
        `INSERT INTO contexts (id, workspace_id, session_id, content_hash, content_type, source,
           size_bytes, created_at, expires_at, blob_ref, inline_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.contextId,
        record.workspaceId,
        record.sessionId,
        record.contentHash,
        record.contentType,
        record.source,
        record.sizeBytes,
        record.createdAt.getTime(),
        record.expiresAt.getTime(),
        record.blobRef,
        record.inlineContent,
      );
  }

  getContext(contextId: string): ContextRecord | null {
    const row = this.db.prepare("SELECT * FROM contexts WHERE id = ?").get(contextId) as
      | ContextRow
      | undefined;
    return row ? toContext(row) : null;
  }

  /** Insert a variant and its omission map atomically. */
  insertVariant(variant: VariantRecord, segments: readonly OmittedSegment[]): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO context_variants (id, context_id, strategy, strategy_version, optimized_content,
             original_tokens, optimized_tokens, tokenizer_id, tokenizer_version, tokenizer_exact, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          variant.variantId,
          variant.contextId,
          variant.strategy,
          variant.strategyVersion,
          variant.optimizedContent,
          variant.originalTokens,
          variant.optimizedTokens,
          variant.tokenizer.id,
          variant.tokenizer.version,
          variant.tokenizer.isExact ? 1 : 0,
          variant.createdAt.getTime(),
        );
      const insert = this.db.prepare(
        `INSERT INTO omitted_segments (variant_id, segment_id, position, segment_type, original_location,
           reason, recoverable, occurrences, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      segments.forEach((segment, position) => {
        insert.run(
          variant.variantId,
          segment.id,
          position,
          segment.type,
          segment.location,
          segment.reason,
          segment.recoverable ? 1 : 0,
          segment.occurrences ?? null,
          segment.note ?? null,
        );
      });
    });
  }

  /** Segments of the most recent variant of a context, in their original order. */
  getLatestSegments(contextId: string): OmittedSegment[] {
    const variant = this.db
      .prepare(
        "SELECT id FROM context_variants WHERE context_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(contextId) as { id: string } | undefined;
    if (!variant) return [];
    const rows = this.db
      .prepare("SELECT * FROM omitted_segments WHERE variant_id = ? ORDER BY position")
      .all(variant.id) as unknown as SegmentRow[];
    return rows.map(toSegment);
  }

  countVariants(contextId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM context_variants WHERE context_id = ?")
      .get(contextId) as { n: number };
    return row.n;
  }

  insertEvent(event: OptimizationEvent, sessionId: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO optimization_events (context_id, session_id, event_type, strategy, original_tokens,
           optimized_tokens, recovered_tokens, tokenizer_id, tokenizer_version, tokenizer_exact,
           processing_time_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.contextId,
        sessionId,
        event.eventType,
        event.strategy,
        event.originalTokens,
        event.optimizedTokens,
        event.recoveredTokens,
        event.tokenizer.id,
        event.tokenizer.version,
        event.tokenizer.isExact ? 1 : 0,
        event.processingTimeMs,
        event.createdAt.getTime(),
      );
  }

  listEvents(filter: EventFilter = {}): OptimizationEvent[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.since) {
      clauses.push("created_at >= ?");
      params.push(filter.since.getTime());
    }
    if (filter.sessionId !== undefined) {
      clauses.push("session_id = ?");
      params.push(filter.sessionId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM optimization_events ${where} ORDER BY id`)
      .all(...params) as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      contextId: (row.context_id as string | null) ?? null,
      eventType: row.event_type as OptimizationEvent["eventType"],
      strategy: row.strategy as string,
      originalTokens: row.original_tokens as number,
      optimizedTokens: row.optimized_tokens as number,
      recoveredTokens: row.recovered_tokens as number,
      tokenizer: {
        id: row.tokenizer_id as string,
        version: row.tokenizer_version as string,
        isExact: row.tokenizer_exact === 1,
      },
      processingTimeMs: row.processing_time_ms as number,
      createdAt: new Date(row.created_at as number),
    }));
  }

  /** Delete contexts (variants and segments cascade). Returns the deleted records. */
  deleteContexts(contextIds: readonly string[]): ContextRecord[] {
    if (contextIds.length === 0) return [];
    return transaction(this.db, () => {
      const select = this.db.prepare("SELECT * FROM contexts WHERE id = ?");
      const remove = this.db.prepare("DELETE FROM contexts WHERE id = ?");
      const deleted: ContextRecord[] = [];
      for (const id of contextIds) {
        const row = select.get(id) as ContextRow | undefined;
        if (!row) continue;
        remove.run(id);
        deleted.push(toContext(row));
      }
      return deleted;
    });
  }

  /** Ids of contexts expired at `now`, oldest expiry first. */
  expiredContextIds(now: Date): string[] {
    const rows = this.db
      .prepare("SELECT id FROM contexts WHERE expires_at <= ? ORDER BY expires_at, id")
      .all(now.getTime()) as unknown as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** Contexts ordered oldest first (for quota eviction). */
  contextsByAge(): { id: string; sizeBytes: number }[] {
    const rows = this.db
      .prepare("SELECT id, size_bytes FROM contexts ORDER BY created_at, id")
      .all() as unknown as { id: string; size_bytes: number }[];
    return rows.map((r) => ({ id: r.id, sizeBytes: r.size_bytes }));
  }

  totalSizeBytes(): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM contexts")
      .get() as {
      total: number;
    };
    return row.total;
  }

  isBlobReferenced(blobRef: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM contexts WHERE blob_ref = ? LIMIT 1").get(blobRef) !==
      undefined
    );
  }

  referencedBlobRefs(): Set<string> {
    const rows = this.db
      .prepare("SELECT DISTINCT blob_ref FROM contexts WHERE blob_ref IS NOT NULL")
      .all() as unknown as { blob_ref: string }[];
    return new Set(rows.map((r) => r.blob_ref));
  }
}

function toContext(row: ContextRow): ContextRecord {
  return {
    contextId: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    contentHash: row.content_hash,
    contentType: row.content_type as ContentType,
    source: row.source,
    sizeBytes: row.size_bytes,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    blobRef: row.blob_ref,
    inlineContent: row.inline_content,
  };
}

function toSegment(row: SegmentRow): OmittedSegment {
  const segment: OmittedSegment = {
    id: row.segment_id,
    type: row.segment_type as OmittedSegment["type"],
    location: row.original_location,
    reason: row.reason as OmittedSegment["reason"],
    recoverable: row.recoverable === 1,
  };
  if (row.occurrences !== null) segment.occurrences = row.occurrences;
  if (row.note !== null) segment.note = row.note;
  return segment;
}

import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AgentContextError,
  isAgentContextError,
  type OmittedSegment,
  type OptimizationEvent,
  type StoragePort,
  type StoredContext,
  sha256Hex,
  utf8ByteLength,
} from "@agentcontext/shared";
import { BlobStore } from "./blob-store.js";
import { type Database, openDatabase } from "./database.js";
import { type ContextRecord, MetadataStore } from "./metadata-store.js";

export const DEFAULT_INLINE_THRESHOLD_BYTES = 64 * 1024;
/** Default storage quota (PRODUCT_SPEC Q8). */
export const DEFAULT_QUOTA_BYTES = 500 * 1024 * 1024;
/** Unreferenced blobs and temp files younger than this are left alone (in-flight writes). */
export const DEFAULT_ORPHAN_GRACE_MS = 60 * 60 * 1000;

export interface CleanupReport {
  removedContexts: number;
  freedBytes: number;
  expiredContexts: number;
  evictedContexts: number;
  orphanBlobsRemoved: number;
  tempFilesRemoved: number;
}

export interface SqliteStorageOptions {
  /** Directory holding `agentcontext.db` and `blobs/`. Created if missing. */
  directory: string;
  /** Originals larger than this are stored as blobs; smaller ones inline. */
  inlineThresholdBytes?: number;
  /** Maximum total size of stored originals; oldest contexts are evicted beyond it. */
  quotaBytes?: number;
  /** Age before unreferenced blobs and temp files are deleted by cleanup(). */
  orphanGraceMs?: number;
  /** Clock (injectable for tests). */
  now?: () => Date;
}

/**
 * Local StoragePort implementation (ADR-0002): SQLite metadata plus
 * content-addressed blobs for large originals.
 *
 * `putOriginal` verifies the caller's hash, writes the blob (if any) atomically
 * and verified, then inserts the metadata row. `getOriginal` re-verifies the
 * hash on every read. All failures surface as AgentContextError
 * (STORAGE_ERROR, INTEGRITY_ERROR, NOT_FOUND) without raw content.
 */
export class SqliteStorage implements StoragePort {
  readonly directory: string;
  readonly db: Database;
  readonly metadata: MetadataStore;
  readonly blobs: BlobStore;
  readonly inlineThresholdBytes: number;
  readonly quotaBytes: number;
  readonly orphanGraceMs: number;
  protected readonly now: () => Date;

  constructor(options: SqliteStorageOptions) {
    this.directory = options.directory;
    this.blobs = new BlobStore(join(options.directory, "blobs"));
    this.db = openDatabase(join(options.directory, "agentcontext.db"));
    this.metadata = new MetadataStore(this.db);
    this.inlineThresholdBytes = options.inlineThresholdBytes ?? DEFAULT_INLINE_THRESHOLD_BYTES;
    this.quotaBytes = options.quotaBytes ?? DEFAULT_QUOTA_BYTES;
    this.orphanGraceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS;
    this.now = options.now ?? (() => new Date());
  }

  async putOriginal(record: Parameters<StoragePort["putOriginal"]>[0]): Promise<void> {
    if (sha256Hex(record.content) !== record.contentHash) {
      throw new AgentContextError(
        "INTEGRITY_ERROR",
        "Original content does not match the supplied hash",
        {
          contextId: record.contextId,
        },
      );
    }
    const sizeBytes = utf8ByteLength(record.content);
    if (sizeBytes > this.quotaBytes) {
      throw new AgentContextError("STORAGE_ERROR", "Original is larger than the storage quota", {
        contextId: record.contextId,
        sizeBytes,
        quotaBytes: this.quotaBytes,
      });
    }
    let blobRef: string | null = null;
    try {
      if (sizeBytes > this.inlineThresholdBytes) blobRef = this.blobs.put(record.content).ref;
      this.metadata.insertContext({
        contextId: record.contextId,
        workspaceId: record.workspaceId,
        sessionId: record.sessionId,
        contentHash: record.contentHash,
        contentType: record.contentType,
        source: record.source,
        sizeBytes,
        createdAt: this.now(),
        expiresAt: record.expiresAt,
        blobRef,
        inlineContent: blobRef === null ? record.content : null,
      });
    } catch (error) {
      if (blobRef !== null && !this.metadata.isBlobReferenced(blobRef)) this.blobs.delete(blobRef);
      throw wrap(error, "Could not store the original", record.contextId);
    }
    if (this.metadata.totalSizeBytes() > this.quotaBytes)
      this.#release(this.#evict(record.contextId));
  }

  async putVariant(record: Parameters<StoragePort["putVariant"]>[0]): Promise<void> {
    try {
      this.metadata.insertVariant(
        {
          variantId: record.variantId,
          contextId: record.contextId,
          strategy: record.strategy,
          strategyVersion: record.strategyVersion,
          optimizedContent: record.optimizedContent,
          originalTokens: record.originalTokens,
          optimizedTokens: record.optimizedTokens,
          tokenizer: record.tokenizer,
          createdAt: this.now(),
        },
        record.omittedSegments,
      );
    } catch (error) {
      throw wrap(error, "Could not store the optimized variant", record.contextId);
    }
  }

  async getContext(contextId: string): Promise<StoredContext | null> {
    const record = this.metadata.getContext(contextId);
    return record ? toStoredContext(record) : null;
  }

  async getOriginal(contextId: string): Promise<string> {
    const record = this.metadata.getContext(contextId);
    if (!record) throw new AgentContextError("NOT_FOUND", "Context not found", { contextId });
    const content =
      record.blobRef !== null ? this.blobs.get(record.blobRef) : (record.inlineContent ?? "");
    if (sha256Hex(content) !== record.contentHash) {
      throw new AgentContextError("INTEGRITY_ERROR", "Stored original does not match its hash", {
        contextId,
      });
    }
    return content;
  }

  async getSegments(contextId: string): Promise<OmittedSegment[]> {
    return this.metadata.getLatestSegments(contextId);
  }

  async recordEvent(event: OptimizationEvent): Promise<void> {
    this.metadata.insertEvent(event);
  }

  /**
   * Remove expired contexts, evict the oldest contexts while over quota, then
   * delete blobs no context references and stale temp files (older than
   * `orphanGraceMs`). Returns counts and freed bytes (inline content plus blob
   * files actually deleted).
   */
  async cleanup(now: Date): Promise<CleanupReport> {
    const expired = this.metadata.deleteContexts(this.metadata.expiredContextIds(now));
    const evicted = this.#evict();
    let freedBytes = this.#release([...expired, ...evicted]);

    let orphanBlobsRemoved = 0;
    let tempFilesRemoved = 0;
    const cutoff = now.getTime() - this.orphanGraceMs;
    const referenced = this.metadata.referencedBlobRefs();
    const { refs, temps } = this.blobs.list();
    for (const blob of refs) {
      if (!referenced.has(blob.ref) && blob.modifiedAt.getTime() <= cutoff) {
        freedBytes += this.blobs.delete(blob.ref);
        orphanBlobsRemoved++;
      }
    }
    for (const temp of temps) {
      try {
        if (statSync(temp).mtime.getTime() <= cutoff) {
          freedBytes += statSync(temp).size;
          rmSync(temp, { force: true });
          tempFilesRemoved++;
        }
      } catch {
        // already gone
      }
    }

    return {
      removedContexts: expired.length + evicted.length,
      freedBytes,
      expiredContexts: expired.length,
      evictedContexts: evicted.length,
      orphanBlobsRemoved,
      tempFilesRemoved,
    };
  }

  /** Delete oldest contexts (never `keep`) until within quota. Callers release their blobs. */
  #evict(keep?: string): ContextRecord[] {
    let total = this.metadata.totalSizeBytes();
    if (total <= this.quotaBytes) return [];
    const victims: string[] = [];
    for (const context of this.metadata.contextsByAge()) {
      if (total <= this.quotaBytes) break;
      if (context.id === keep) continue;
      victims.push(context.id);
      total -= context.sizeBytes;
    }
    return this.metadata.deleteContexts(victims);
  }

  /** Delete blobs no longer referenced by any context; returns freed bytes. */
  #release(removed: readonly ContextRecord[]): number {
    let freed = 0;
    for (const record of removed) {
      if (record.blobRef === null) {
        freed += record.sizeBytes;
      } else if (!this.metadata.isBlobReferenced(record.blobRef)) {
        freed += this.blobs.delete(record.blobRef);
      }
    }
    return freed;
  }

  close(): void {
    this.db.close();
  }
}

function toStoredContext(record: ContextRecord): StoredContext {
  const { blobRef: _blob, inlineContent: _inline, ...stored } = record;
  return stored;
}

function wrap(error: unknown, message: string, contextId: string): AgentContextError {
  if (isAgentContextError(error)) return error;
  return new AgentContextError("STORAGE_ERROR", message, { contextId }, { cause: error });
}

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

export interface SqliteStorageOptions {
  /** Directory holding `agentcontext.db` and `blobs/`. Created if missing. */
  directory: string;
  /** Originals larger than this are stored as blobs; smaller ones inline. */
  inlineThresholdBytes?: number;
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
  protected readonly now: () => Date;

  constructor(options: SqliteStorageOptions) {
    this.directory = options.directory;
    this.blobs = new BlobStore(join(options.directory, "blobs"));
    this.db = openDatabase(join(options.directory, "agentcontext.db"));
    this.metadata = new MetadataStore(this.db);
    this.inlineThresholdBytes = options.inlineThresholdBytes ?? DEFAULT_INLINE_THRESHOLD_BYTES;
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

  async cleanup(_now: Date): Promise<{ removedContexts: number; freedBytes: number }> {
    // Expiry, quota and orphan-blob cleanup are implemented in AC-026.
    return { removedContexts: 0, freedBytes: 0 };
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

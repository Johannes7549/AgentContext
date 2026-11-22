import {
  AgentContextError,
  type OmittedSegment,
  type OptimizationEvent,
  type StoragePort,
  type StoredContext,
  sha256Hex,
} from "@agentcontext/shared";

type PutOriginal = Parameters<StoragePort["putOriginal"]>[0];
type PutVariant = Parameters<StoragePort["putVariant"]>[0];

export interface MemoryStorageFaults {
  failPutOriginal?: boolean;
  failPutVariant?: boolean;
  /** Return different bytes from getOriginal (simulates corruption). */
  corrupt?: boolean;
}

/** In-memory StoragePort for tests. Mirrors the hash-verifying contract of getOriginal. */
export class MemoryStorage implements StoragePort {
  readonly contexts = new Map<string, StoredContext & { content: string }>();
  readonly variants = new Map<string, PutVariant>();
  readonly events: OptimizationEvent[] = [];
  faults: MemoryStorageFaults;

  constructor(faults: MemoryStorageFaults = {}) {
    this.faults = faults;
  }

  async putOriginal(record: PutOriginal): Promise<void> {
    if (this.faults.failPutOriginal) throw new AgentContextError("STORAGE_ERROR", "disk full");
    this.contexts.set(record.contextId, {
      contextId: record.contextId,
      workspaceId: record.workspaceId,
      sessionId: record.sessionId,
      contentHash: record.contentHash,
      contentType: record.contentType,
      source: record.source,
      sizeBytes: Buffer.byteLength(record.content),
      createdAt: new Date(),
      expiresAt: record.expiresAt,
      content: record.content,
    });
  }

  async putVariant(record: PutVariant): Promise<void> {
    if (this.faults.failPutVariant) throw new AgentContextError("STORAGE_ERROR", "write failed");
    this.variants.set(record.contextId, record);
  }

  async getContext(contextId: string): Promise<StoredContext | null> {
    const found = this.contexts.get(contextId);
    if (!found) return null;
    const { content: _content, ...context } = found;
    return context;
  }

  async getOriginal(contextId: string): Promise<string> {
    const found = this.contexts.get(contextId);
    if (!found) throw new AgentContextError("NOT_FOUND", "missing");
    return this.faults.corrupt ? `${found.content}x` : found.content;
  }

  async getSegments(contextId: string): Promise<OmittedSegment[]> {
    return this.variants.get(contextId)?.omittedSegments ?? [];
  }

  async recordEvent(event: OptimizationEvent): Promise<void> {
    this.events.push(event);
  }

  async cleanup(): Promise<{ removedContexts: number; freedBytes: number }> {
    return { removedContexts: 0, freedBytes: 0 };
  }

  hashOf(contextId: string): string | undefined {
    const found = this.contexts.get(contextId);
    return found ? sha256Hex(found.content) : undefined;
  }
}

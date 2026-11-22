/**
 * @agentcontext/storage — node:sqlite metadata store and content-addressed
 * blob store (ADR-0002).
 */
export const packageName = "@agentcontext/storage" as const;

export { type BlobInfo, BlobStore } from "./blob-store.js";
export { type Database, migrate, openDatabase, transaction } from "./database.js";
export {
  type ContextRecord,
  type EventFilter,
  MetadataStore,
  type VariantRecord,
} from "./metadata-store.js";
export { MIGRATIONS, type Migration } from "./migrations.js";

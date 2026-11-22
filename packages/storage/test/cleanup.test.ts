import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@agentcontext/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStorage, type SqliteStorageOptions } from "../src/index.js";

const open: SqliteStorage[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let clock = 0;
function storage(options: Partial<SqliteStorageOptions> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "agentcontext-cleanup-"));
  dirs.push(directory);
  clock = 1_000;
  const s = new SqliteStorage({
    directory,
    inlineThresholdBytes: 100,
    now: () => new Date(clock++),
    ...options,
  });
  open.push(s);
  return s;
}

async function put(s: SqliteStorage, id: string, content: string, expiresAt = 1_000_000) {
  await s.putOriginal({
    contextId: id,
    workspaceId: "w",
    sessionId: "s",
    content,
    contentHash: sha256Hex(content),
    contentType: "text",
    source: "t",
    expiresAt: new Date(expiresAt),
  });
}

describe("SqliteStorage.cleanup — expiry", () => {
  it("removes expired contexts and their unshared blobs", async () => {
    const s = storage();
    await put(s, "inline-expired", "short", 10);
    await put(s, "blob-expired", "b".repeat(500), 10);
    await put(s, "alive", "c".repeat(500));
    const report = await s.cleanup(new Date(10));
    expect(report).toMatchObject({ removedContexts: 2, expiredContexts: 2, evictedContexts: 0 });
    expect(report.freedBytes).toBe(5 + 500);
    expect(await s.getContext("inline-expired")).toBeNull();
    expect(await s.getContext("blob-expired")).toBeNull();
    expect(await s.getOriginal("alive")).toBe("c".repeat(500));
    expect(s.blobs.list().refs).toHaveLength(1);
  });

  it("keeps a blob that another live context still references", async () => {
    const s = storage();
    const shared = "s".repeat(500);
    await put(s, "old", shared, 10);
    await put(s, "new", shared);
    await s.cleanup(new Date(10));
    expect(await s.getOriginal("new")).toBe(shared);
  });

  it("is a no-op when nothing has expired", async () => {
    const s = storage();
    await put(s, "a", "x");
    expect(await s.cleanup(new Date(5))).toEqual({
      removedContexts: 0,
      freedBytes: 0,
      expiredContexts: 0,
      evictedContexts: 0,
      orphanBlobsRemoved: 0,
      tempFilesRemoved: 0,
    });
  });
});

describe("SqliteStorage quota", () => {
  it("rejects a single original larger than the quota", async () => {
    const s = storage({ quotaBytes: 100 });
    await expect(put(s, "huge", "x".repeat(101))).rejects.toMatchObject({ code: "STORAGE_ERROR" });
  });

  it("evicts the oldest contexts on write, never the new one", async () => {
    const s = storage({ quotaBytes: 1_000 });
    await put(s, "first", "a".repeat(400));
    await put(s, "second", "b".repeat(400));
    await put(s, "third", "c".repeat(400));
    expect(await s.getContext("first")).toBeNull();
    expect(await s.getOriginal("second")).toBe("b".repeat(400));
    expect(await s.getOriginal("third")).toBe("c".repeat(400));
    expect(s.metadata.totalSizeBytes()).toBeLessThanOrEqual(1_000);
    expect(s.blobs.list().refs).toHaveLength(2);
  });

  it("evicts during cleanup when the quota was lowered", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentcontext-cleanup-"));
    dirs.push(directory);
    const big = new SqliteStorage({
      directory,
      inlineThresholdBytes: 100,
      now: () => new Date(clock++),
    });
    await put(big, "one", "1".repeat(300));
    await put(big, "two", "2".repeat(300));
    big.close();
    const small = new SqliteStorage({ directory, inlineThresholdBytes: 100, quotaBytes: 300 });
    open.push(small);
    const report = await small.cleanup(new Date(0));
    expect(report).toMatchObject({ evictedContexts: 1, removedContexts: 1 });
    expect(await small.getContext("one")).toBeNull();
    expect(await small.getContext("two")).not.toBeNull();
  });
});

describe("SqliteStorage.cleanup — orphans", () => {
  it("deletes unreferenced blobs and stale temp files after the grace period only", async () => {
    const s = storage({ orphanGraceMs: 60_000 });
    const orphan = s.blobs.put("orphaned content ".repeat(20));
    await put(s, "kept", "k".repeat(500), Date.UTC(2100, 0, 1));
    const prefixDir = join(s.blobs.root, orphan.ref.slice(0, 2));
    const temp = join(prefixDir, ".tmp-abcdef12-000000");
    writeFileSync(temp, "partial write");

    const now = Date.now();
    const fresh = await s.cleanup(new Date(now));
    expect(fresh).toMatchObject({ orphanBlobsRemoved: 0, tempFilesRemoved: 0 });

    const old = new Date(now - 120_000);
    utimesSync(join(s.blobs.root, ...orphan.ref.split("/")), old, old);
    utimesSync(temp, old, old);
    const stale = await s.cleanup(new Date(now));
    expect(stale).toMatchObject({ orphanBlobsRemoved: 1, tempFilesRemoved: 1 });
    expect(s.blobs.has(orphan.ref)).toBe(false);
    expect(await s.getOriginal("kept")).toBe("k".repeat(500));
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OmittedSegment, sha256Hex } from "@agentcontext/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStorage } from "../src/index.js";

const open: SqliteStorage[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function storage(directory?: string, inlineThresholdBytes = 1024) {
  const dir = directory ?? mkdtempSync(join(tmpdir(), "agentcontext-store-"));
  if (!directory) dirs.push(dir);
  const s = new SqliteStorage({ directory: dir, inlineThresholdBytes, now: () => new Date(5_000) });
  open.push(s);
  return s;
}

const tokenizer = { id: "fallback-estimator", version: "1.0.0", isExact: false };
const original = (content: string, contextId = "ctx_01") => ({
  contextId,
  workspaceId: "ws",
  sessionId: "s1",
  content,
  contentHash: sha256Hex(content),
  contentType: "logs" as const,
  source: "command:test",
  expiresAt: new Date(100_000),
});
const segments: OmittedSegment[] = [
  {
    id: "s1",
    type: "log_group",
    location: "lines:2-3",
    reason: "repeated_log_line",
    recoverable: true,
    occurrences: 3,
  },
];

describe("SqliteStorage", () => {
  it("stores small originals inline and returns them verified", async () => {
    const s = storage();
    await s.putOriginal(original("small content\r\n"));
    expect(s.metadata.getContext("ctx_01")).toMatchObject({
      blobRef: null,
      inlineContent: "small content\r\n",
    });
    expect(await s.getOriginal("ctx_01")).toBe("small content\r\n");
    expect(await s.getContext("ctx_01")).toEqual({
      contextId: "ctx_01",
      workspaceId: "ws",
      sessionId: "s1",
      contentHash: sha256Hex("small content\r\n"),
      contentType: "logs",
      source: "command:test",
      sizeBytes: 15,
      createdAt: new Date(5_000),
      expiresAt: new Date(100_000),
    });
  });

  it("stores large originals as blobs", async () => {
    const s = storage();
    const big = "x".repeat(5_000);
    await s.putOriginal(original(big));
    const record = s.metadata.getContext("ctx_01");
    expect(record?.inlineContent).toBeNull();
    expect(record?.blobRef).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/);
    expect(await s.getOriginal("ctx_01")).toBe(big);
  });

  it("rejects content that does not match the supplied hash", async () => {
    const s = storage();
    await expect(
      s.putOriginal({ ...original("a"), contentHash: sha256Hex("b") }),
    ).rejects.toMatchObject({
      code: "INTEGRITY_ERROR",
    });
    expect(await s.getContext("ctx_01")).toBeNull();
  });

  it("detects corrupted blobs and tampered inline content", async () => {
    const s = storage();
    await s.putOriginal(original("y".repeat(5_000), "ctx_blob"));
    const ref = s.metadata.getContext("ctx_blob")?.blobRef as string;
    writeFileSync(join(s.blobs.root, ...ref.split("/")), "corrupt");
    await expect(s.getOriginal("ctx_blob")).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });

    await s.putOriginal(original("inline", "ctx_inline"));
    s.db.prepare("UPDATE contexts SET inline_content = 'changed' WHERE id = 'ctx_inline'").run();
    await expect(s.getOriginal("ctx_inline")).rejects.toMatchObject({ code: "INTEGRITY_ERROR" });
  });

  it("reports unknown contexts", async () => {
    const s = storage();
    expect(await s.getContext("nope")).toBeNull();
    await expect(s.getOriginal("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("wraps metadata failures as STORAGE_ERROR and removes the orphaned blob", async () => {
    const s = storage();
    const big = "z".repeat(5_000);
    await s.putOriginal(original(big));
    await expect(s.putOriginal(original(`${big}!`))).rejects.toMatchObject({
      code: "STORAGE_ERROR",
    });
    expect(s.blobs.list().refs).toHaveLength(1);
  });

  it("stores variants and returns the latest segments", async () => {
    const s = storage();
    await s.putOriginal(original("content"));
    await s.putVariant({
      variantId: "var_1",
      contextId: "ctx_01",
      strategy: "log-compressor",
      strategyVersion: "1.0.0",
      optimizedContent: "compact",
      originalTokens: 10,
      optimizedTokens: 4,
      tokenizer,
      omittedSegments: segments,
    });
    expect(await s.getSegments("ctx_01")).toEqual(segments);
    await expect(
      s.putVariant({
        variantId: "var_2",
        contextId: "missing",
        strategy: "x",
        strategyVersion: "1",
        optimizedContent: "",
        originalTokens: 0,
        optimizedTokens: 0,
        tokenizer,
        omittedSegments: [],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
  });

  it("persists across reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcontext-store-"));
    dirs.push(dir);
    const first = new SqliteStorage({ directory: dir, inlineThresholdBytes: 10 });
    await first.putOriginal(original("persisted across restarts"));
    first.close();
    const second = storage(dir);
    expect(await second.getOriginal("ctx_01")).toBe("persisted across restarts");
  });

  it("records events", async () => {
    const s = storage();
    await s.recordEvent({
      contextId: null,
      eventType: "skipped",
      strategy: "passthrough",
      originalTokens: 5,
      optimizedTokens: 5,
      recoveredTokens: 0,
      tokenizer,
      processingTimeMs: 0.5,
      createdAt: new Date(1),
    });
    expect(s.metadata.listEvents()).toHaveLength(1);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "@agentcontext/core";
import { CompressionResultSchema, type RetrievalScope } from "@agentcontext/shared";
import { SqliteStorage } from "@agentcontext/storage";
import { codeExtractor, logCompressor } from "@agentcontext/strategies";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { afterEach, describe, expect, it } from "vitest";

const scope: RetrievalScope = { workspaceId: "w", sessionId: "s1", mode: "session" };
const terminalLog = readFileSync(
  new URL("../../packages/strategies/test/fixtures/terminal.log", import.meta.url),
  "utf8",
);
const bigLog = terminalLog.repeat(60); // well above the 64 KiB inline threshold

const open: SqliteStorage[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(
  directory?: string,
  policy: "return_original" | "non_recoverable" = "return_original",
) {
  const dir = directory ?? mkdtempSync(join(tmpdir(), "agentcontext-it-"));
  if (!directory) dirs.push(dir);
  const storage = new SqliteStorage({ directory: dir });
  open.push(storage);
  const engine = createEngine({
    tokenizer: new FallbackEstimator(),
    strategies: [logCompressor, codeExtractor],
    storage,
    config: { storageFailurePolicy: policy },
  });
  return { dir, storage, engine };
}

describe("pipeline backed by SqliteStorage", () => {
  it.each([
    ["inline", terminalLog],
    ["blob", bigLog],
  ])("persists, verifies and recovers a %s original", async (kind, content) => {
    const { engine, storage } = setup();
    const result = await engine.optimize({ content, source: "command:test" }, {}, scope);
    expect(CompressionResultSchema.safeParse(result).success).toBe(true);
    expect(result.recoveryAvailable).toBe(true);
    const record = storage.metadata.getContext(result.contextId as string);
    expect(kind === "blob" ? record?.blobRef : record?.inlineContent).not.toBeNull();
    expect(await storage.getSegments(result.contextId as string)).toEqual(result.omittedSegments);
    const recovered = await engine.retrieve({ contextId: result.contextId as string }, scope);
    expect(recovered.status === "OK" && recovered.content).toBe(content);
  });

  it("recovers after a restart within the same workspace", async () => {
    const first = setup();
    const result = await first.engine.optimize({ content: terminalLog, source: "s" }, {}, scope);
    first.storage.close();
    open.splice(open.indexOf(first.storage), 1);

    const second = setup(first.dir);
    const newSession: RetrievalScope = { ...scope, sessionId: "s2" };
    const blocked = await second.engine.retrieve(
      { contextId: result.contextId as string },
      newSession,
    );
    expect(blocked.status).toBe("UNAUTHORIZED");
    const allowed = await second.engine.retrieve(
      { contextId: result.contextId as string },
      { ...newSession, mode: "workspace" },
    );
    expect(allowed.status === "OK" && allowed.content).toBe(terminalLog);
  });

  it("reports INTEGRITY_ERROR when a stored blob is corrupted", async () => {
    const { engine, storage } = setup();
    const result = await engine.optimize({ content: bigLog, source: "s" }, {}, scope);
    const ref = storage.metadata.getContext(result.contextId as string)?.blobRef as string;
    writeFileSync(join(storage.blobs.root, ...ref.split("/")), "corrupted");
    const recovered = await engine.retrieve({ contextId: result.contextId as string }, scope);
    expect(recovered.status).toBe("INTEGRITY_ERROR");
  });

  it("returns the original (never a false recovery claim) when storage is unavailable", async () => {
    const { engine, storage } = setup();
    storage.close();
    open.splice(open.indexOf(storage), 1);
    const result = await engine.optimize({ content: terminalLog, source: "s" }, {}, scope);
    expect(result).toMatchObject({
      content: terminalLog,
      strategy: "passthrough",
      recoveryAvailable: false,
      contextId: null,
    });
    expect(result.warnings.map((w) => w.code)).toEqual(["STORAGE_FAILED"]);
  });

  it("marks omissions non-recoverable under the non_recoverable policy", async () => {
    const { engine, storage } = setup(undefined, "non_recoverable");
    storage.close();
    open.splice(open.indexOf(storage), 1);
    const result = await engine.optimize({ content: terminalLog, source: "s" }, {}, scope);
    expect(result.strategy).toBe("log-compressor");
    expect(result.recoveryAvailable).toBe(false);
    expect(result.omittedSegments.every((s) => !s.recoverable)).toBe(true);
  });
});

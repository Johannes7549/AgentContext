import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "@agentcontext/core";
import type { RetrievalScope } from "@agentcontext/shared";
import { SqliteStorage } from "@agentcontext/storage";
import { logCompressor } from "@agentcontext/strategies";
import { FallbackEstimator } from "@agentcontext/tokenization";
import { afterEach, describe, expect, it } from "vitest";

const scope: RetrievalScope = { workspaceId: "w", sessionId: "s", mode: "session" };
const log = readFileSync(
  new URL("../../packages/strategies/test/fixtures/terminal.log", import.meta.url),
  "utf8",
).repeat(60);

const cleanupFns: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanupFns.splice(0)) fn();
});

describe("storage lifecycle", () => {
  it("expires, then removes contexts and their blobs on cleanup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentcontext-lifecycle-"));
    let now = new Date("2026-11-23T00:00:00Z");
    const storage = new SqliteStorage({ directory, now: () => now });
    cleanupFns.push(() => {
      storage.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const engine = createEngine({
      tokenizer: new FallbackEstimator(),
      strategies: [logCompressor],
      storage,
      config: { ttlMs: 60_000, now: () => now },
    });

    const result = await engine.optimize({ content: log, source: "s" }, {}, scope);
    const contextId = result.contextId as string;
    expect(result.recoveryAvailable).toBe(true);
    expect(storage.blobs.list().refs).toHaveLength(1);

    now = new Date(now.getTime() + 61_000);
    expect((await engine.retrieve({ contextId }, scope)).status).toBe("EXPIRED");

    const report = await storage.cleanup(now);
    expect(report).toMatchObject({ expiredContexts: 1, removedContexts: 1 });
    expect(report.freedBytes).toBeGreaterThan(64 * 1024);
    expect(storage.blobs.list().refs).toHaveLength(0);
    expect((await engine.retrieve({ contextId }, scope)).status).toBe("NOT_FOUND");
  });
});

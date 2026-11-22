import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "@agentcontext/core";
import {
  aggregateStats,
  createLogger,
  createPersistentEventSink,
} from "@agentcontext/observability";
import type { RetrievalScope } from "@agentcontext/shared";
import { SqliteStorage } from "@agentcontext/storage";
import { logCompressor } from "@agentcontext/strategies";
import { FallbackEstimator, tokenizerInfo } from "@agentcontext/tokenization";
import { describe, expect, it } from "vitest";

const log = readFileSync(
  new URL("../../packages/strategies/test/fixtures/terminal.log", import.meta.url),
  "utf8",
);

describe("observability with persistent storage", () => {
  it("persists content-free events per session and aggregates them after a restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentcontext-obs-"));
    const tokenizer = new FallbackEstimator();
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });

    try {
      for (const sessionId of ["s1", "s2"]) {
        const storage = new SqliteStorage({ directory });
        const scope: RetrievalScope = { workspaceId: "w", sessionId, mode: "session" };
        const engine = createEngine({
          tokenizer,
          strategies: [logCompressor],
          storage,
          events: createPersistentEventSink({ store: storage.metadata, sessionId, logger }),
        });
        const result = await engine.optimize({ content: log, source: "s" }, {}, scope);
        await engine.retrieve({ contextId: result.contextId as string }, scope);
        storage.close();
      }

      const reopened = new SqliteStorage({ directory });
      const info = tokenizerInfo(tokenizer);
      const all = aggregateStats(reopened.metadata.listEvents(), info);
      const s1 = aggregateStats(reopened.metadata.listEvents({ sessionId: "s1" }), info);
      reopened.close();

      expect(all).toMatchObject({ optimizations: 2, retrievals: 2 });
      expect(s1).toMatchObject({ optimizations: 1, retrievals: 1 });
      expect(all.recoveredTokens).toBe(2 * s1.recoveredTokens);
      expect(all.netSavedTokens).toBe(
        all.originalTokens - all.optimizedTokens - all.recoveredTokens,
      );

      const logged = lines.join("");
      expect(lines.length).toBeGreaterThan(0);
      expect(logged).not.toContain("connection refused");
      expect(logged).not.toContain("GET /health");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

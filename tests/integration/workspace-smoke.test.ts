import { packageName as core } from "@agentcontext/core";
import { packageName as mcpServer } from "@agentcontext/mcp-server";
import { packageName as observability } from "@agentcontext/observability";
import { packageName as retrieval } from "@agentcontext/retrieval";
import { packageName as shared } from "@agentcontext/shared";
import { packageName as storage } from "@agentcontext/storage";
import { packageName as strategies } from "@agentcontext/strategies";
import { packageName as tokenization } from "@agentcontext/tokenization";
import { describe, expect, it } from "vitest";

describe("workspace smoke", () => {
  it("resolves every workspace package from source", () => {
    expect([
      shared,
      tokenization,
      strategies,
      storage,
      retrieval,
      observability,
      core,
      mcpServer,
    ]).toEqual([
      "@agentcontext/shared",
      "@agentcontext/tokenization",
      "@agentcontext/strategies",
      "@agentcontext/storage",
      "@agentcontext/retrieval",
      "@agentcontext/observability",
      "@agentcontext/core",
      "@agentcontext/mcp-server",
    ]);
  });
});

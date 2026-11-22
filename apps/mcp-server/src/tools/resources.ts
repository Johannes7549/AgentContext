import { CONTEXT_ID_PATTERN } from "@agentcontext/shared";
import { ResourceNotFoundError, ResourceTemplate } from "@modelcontextprotocol/server";
import type { Registrar } from "../server.js";
import { collectStats } from "./stats.js";

/**
 * Read-only resources (no raw content is ever exposed through them):
 * - agentcontext://stats — session and all-time stats as JSON;
 * - agentcontext://context/{contextId}/metadata — stored metadata and the
 *   omission map of a context in the current scope.
 */
export const registerResources: Registrar = (server, runtime) => {
  server.registerResource(
    "stats",
    "agentcontext://stats",
    {
      title: "AgentContext statistics",
      description: "Optimization statistics for this session and all stored events (JSON).",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            { session: collectStats(runtime, "session"), all: collectStats(runtime, "all") },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "context-metadata",
    new ResourceTemplate("agentcontext://context/{contextId}/metadata", { list: undefined }),
    {
      title: "Context metadata",
      description: "Metadata and omitted segments of an optimized context (no content).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const contextId = String(variables.contextId ?? "");
      const notFound = () => new ResourceNotFoundError(uri.href);
      if (!CONTEXT_ID_PATTERN.test(contextId)) throw notFound();
      const stored = await runtime.storage.getContext(contextId);
      const { scope } = runtime;
      const visible =
        stored !== null &&
        stored.workspaceId === scope.workspaceId &&
        (scope.mode === "workspace" || stored.sessionId === scope.sessionId);
      if (!visible) throw notFound();
      const segments = await runtime.storage.getSegments(contextId);
      const metadata = {
        contextId,
        contentType: stored.contentType,
        source: stored.source,
        sizeBytes: stored.sizeBytes,
        createdAt: stored.createdAt.toISOString(),
        expiresAt: stored.expiresAt.toISOString(),
        expired: stored.expiresAt.getTime() <= Date.now(),
        omittedSegments: segments,
      };
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(metadata, null, 2) },
        ],
      };
    },
  );
};

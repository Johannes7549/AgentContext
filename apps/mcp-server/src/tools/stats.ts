import { aggregateStats } from "@agentcontext/observability";
import { type OptimizationStats, TokenizerInfoSchema } from "@agentcontext/shared";
import { tokenizerInfo } from "@agentcontext/tokenization";
import * as z from "zod";
import type { Runtime } from "../runtime.js";
import type { Registrar } from "../server.js";
import { errorResult, type ToolResult, toolError } from "./results.js";

export const STATS_DESCRIPTION =
  "Report AgentContext optimization statistics (token counts are estimates unless marked exact): " +
  "optimizations, skips, fallbacks, retrievals, and net tokens saved including recovered content.";

const InputSchema = z.object({
  scope: z
    .enum(["session", "all"])
    .optional()
    .describe('"session" (default): this server session; "all": every stored event.'),
  since: z.string().optional().describe("ISO 8601 timestamp; only count events at or after it."),
});

const OutputSchema = z.object({
  scope: z.enum(["session", "all"]),
  since: z.string().nullable(),
  optimizations: z.number(),
  skipped: z.number(),
  fallbacks: z.number(),
  retrievals: z.number(),
  originalTokens: z.number(),
  optimizedTokens: z.number(),
  recoveredTokens: z.number(),
  netSavedTokens: z.number(),
  tokenizer: TokenizerInfoSchema,
});

/** Stats from persisted events (survive restarts); tokens only from this server's tokenizer. */
export function collectStats(
  runtime: Runtime,
  scope: "session" | "all",
  since?: Date,
): OptimizationStats {
  const events = runtime.storage.metadata.listEvents({
    ...(since ? { since } : {}),
    ...(scope === "session" ? { sessionId: runtime.scope.sessionId } : {}),
  });
  return aggregateStats(events, tokenizerInfo(runtime.tokenizer));
}

export function formatStats(stats: OptimizationStats): string {
  const label = stats.tokenizer.isExact ? "exact" : `estimated with ${stats.tokenizer.id}`;
  return [
    `Optimizations: ${stats.optimizations} (skipped ${stats.skipped}, fallbacks ${stats.fallbacks}); retrievals: ${stats.retrievals}`,
    `Tokens (${label}): original ${stats.originalTokens}, returned ${stats.optimizedTokens}, recovered ${stats.recoveredTokens}`,
    `Net saved: ${stats.netSavedTokens} tokens`,
  ].join("\n");
}

export const registerStats: Registrar = (server, runtime) => {
  server.registerTool(
    "get_optimization_stats",
    {
      title: "Optimization stats",
      description: STATS_DESCRIPTION,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async (args): Promise<ToolResult> => {
      try {
        let since: Date | undefined;
        if (args.since !== undefined) {
          since = new Date(args.since);
          if (Number.isNaN(since.getTime()))
            return errorResult("INVALID_INPUT", "since must be an ISO 8601 timestamp");
        }
        const scope = args.scope ?? "session";
        const stats = collectStats(runtime, scope, since);
        return {
          content: [{ type: "text", text: formatStats(stats) }],
          structuredContent: { scope, since: since?.toISOString() ?? null, ...stats },
        };
      } catch (error) {
        return toolError(error, runtime, "get_optimization_stats");
      }
    },
  );
};

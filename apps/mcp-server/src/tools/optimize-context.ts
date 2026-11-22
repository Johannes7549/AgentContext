import {
  CompressionOptionsSchema,
  type CompressionResult,
  ContentTypeSchema,
  OmittedSegmentSchema,
  TokenizerInfoSchema,
  WarningSchema,
} from "@agentcontext/shared";
import * as z from "zod";
import type { Registrar } from "../server.js";
import { type ToolResult, toolError } from "./results.js";

export const OPTIMIZE_CONTEXT_DESCRIPTION =
  "Compress large text (logs, JSON, Markdown, code, diffs) to save context. Deterministic, no LLM. " +
  "The original is stored locally; omitted parts appear as [... sN: ...] markers and can be recovered " +
  "exactly with retrieve_context. Use options.selection to extract specific fields, sections, lines or log levels.";

const InputSchema = z.object({
  content: z.string().describe("The text to optimize (e.g. tool or command output)."),
  contentType: ContentTypeSchema.exclude(["mcp_content"])
    .optional()
    .describe("Optional; detected automatically."),
  source: z
    .string()
    .min(1)
    .max(1_000)
    .optional()
    .describe('Where the content came from, e.g. "command:pnpm test".'),
  taskContext: z
    .string()
    .max(10_000)
    .optional()
    .describe("What you are trying to do (informational)."),
  options: CompressionOptionsSchema.optional(),
});

const OutputSchema = z.object({
  contextId: z.string().nullable(),
  recoveryAvailable: z.boolean(),
  strategy: z.string(),
  metrics: z.object({
    originalTokens: z.number(),
    optimizedTokens: z.number(),
    savedTokens: z.number(),
    reductionPercentage: z.number(),
    tokenCountIsExact: z.boolean(),
    tokenizer: TokenizerInfoSchema,
    processingTimeMs: z.number(),
  }),
  omittedSegments: z.array(OmittedSegmentSchema),
  warnings: z.array(WarningSchema),
});

export const registerOptimizeContext: Registrar = (server, runtime) => {
  server.registerTool(
    "optimize_context",
    {
      title: "Optimize context",
      description: OPTIMIZE_CONTEXT_DESCRIPTION,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: false },
    },
    async (args): Promise<ToolResult> => {
      try {
        const result = await runtime.engine.optimize(
          {
            content: args.content,
            source: args.source ?? "tool:optimize_context",
            ...(args.contentType ? { contentType: args.contentType } : {}),
            ...(args.taskContext ? { taskContext: args.taskContext } : {}),
          },
          args.options ?? {},
          runtime.scope,
        );
        return formatOptimizeResult(result);
      } catch (error) {
        return toolError(error, runtime, "optimize_context");
      }
    },
  );
};

/**
 * Text block: the (possibly) optimized content followed by a short footer with
 * recovery instructions. Structured content: metadata only — the content is
 * not duplicated there so it reaches the model once.
 */
export function formatOptimizeResult(result: CompressionResult): ToolResult {
  const body = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
  const footer = optimizeFooter(result);
  return {
    content: [{ type: "text", text: footer ? `${body}\n${footer}` : body }],
    structuredContent: {
      contextId: result.contextId,
      recoveryAvailable: result.recoveryAvailable,
      strategy: result.strategy,
      metrics: result.metrics,
      omittedSegments: result.omittedSegments,
      warnings: result.warnings,
    },
  };
}

function optimizeFooter(result: CompressionResult): string {
  const lines: string[] = [];
  const m = result.metrics;
  if (result.strategy !== "passthrough") {
    const exact = m.tokenCountIsExact ? "" : " (estimated)";
    lines.push(
      `[agentcontext] ${result.strategy}: ${m.optimizedTokens}/${m.originalTokens} tokens${exact}, ${m.reductionPercentage}% saved.`,
    );
    if (result.recoveryAvailable && result.contextId) {
      const ids = result.omittedSegments.map((s) => s.id);
      const shown = ids.length > 8 ? `${ids.slice(0, 8).join(", ")}, ...` : ids.join(", ");
      lines.push(
        `Recover omitted parts (${shown}) with retrieve_context {"contextId":"${result.contextId}","selector":{"type":"segment_id","value":"<sN>"}}, or omit the selector for the full original.`,
      );
    } else if (result.omittedSegments.length > 0) {
      lines.push("Omitted parts are NOT recoverable for this result.");
    }
  }
  for (const warning of result.warnings)
    lines.push(`[agentcontext] ${warning.code}: ${warning.message}`);
  return lines.length ? `---\n${lines.join("\n")}` : "";
}

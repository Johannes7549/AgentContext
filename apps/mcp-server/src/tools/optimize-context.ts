import {
  CompressionOptionsSchema,
  type CompressionResult,
  ContentTypeSchema,
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

/** Omitted segment as shown to the model: compact; exact locations stay available via retrieval. */
const SegmentSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  reason: z.string(),
  recoverable: z.boolean(),
  occurrences: z.number().optional(),
  note: z.string().optional(),
});

/**
 * Structured result. Some clients (including Claude Code) show the model only
 * `structuredContent` when present, so it carries the content itself first,
 * followed by compact metadata.
 */
export const OptimizeOutputSchema = z.object({
  content: z.string(),
  contextId: z.string().nullable(),
  recoveryAvailable: z.boolean(),
  strategy: z.string(),
  metrics: z.object({
    originalTokens: z.number(),
    optimizedTokens: z.number(),
    savedTokens: z.number(),
    reductionPercentage: z.number(),
    tokenCountIsExact: z.boolean(),
  }),
  omittedSegments: z.array(SegmentSummarySchema),
  warnings: z.array(WarningSchema),
  recoveryHint: z.string().optional(),
});

export const registerOptimizeContext: Registrar = (server, runtime) => {
  server.registerTool(
    "optimize_context",
    {
      title: "Optimize context",
      description: OPTIMIZE_CONTEXT_DESCRIPTION,
      inputSchema: InputSchema,
      outputSchema: OptimizeOutputSchema,
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
 * Text block: the optimized content followed by a short footer. Structured
 * content: the same content plus compact metadata (clients show one or the
 * other; Claude Code shows the structured form).
 */
export function formatOptimizeResult(result: CompressionResult): ToolResult {
  const body = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
  const footer = optimizeFooter(result);
  const m = result.metrics;
  return {
    content: [
      {
        type: "text",
        text: footer
          ? `${body}
${footer}`
          : body,
      },
    ],
    structuredContent: {
      content: body,
      contextId: result.contextId,
      recoveryAvailable: result.recoveryAvailable,
      strategy: result.strategy,
      metrics: {
        originalTokens: m.originalTokens,
        optimizedTokens: m.optimizedTokens,
        savedTokens: m.savedTokens,
        reductionPercentage: m.reductionPercentage,
        tokenCountIsExact: m.tokenCountIsExact,
      },
      omittedSegments: result.omittedSegments.map((s) => ({
        id: s.id,
        type: s.type,
        reason: s.reason,
        recoverable: s.recoverable,
        ...(s.occurrences !== undefined ? { occurrences: s.occurrences } : {}),
        ...(s.note !== undefined ? { note: s.note } : {}),
      })),
      warnings: result.warnings,
      ...(result.recoveryAvailable && result.contextId && result.omittedSegments.length > 0
        ? {
            recoveryHint:
              'Call retrieve_context with this contextId and selector {"type":"segment_id","value":"sN"} for a marker, or no selector for the full original.',
          }
        : {}),
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

import { CompressionOptionsSchema } from "@agentcontext/shared";
import * as z from "zod";
import { FileAdapter } from "../adapters/file-adapter.js";
import type { Registrar } from "../server.js";
import { formatOptimizeResult, OptimizeOutputSchema } from "./optimize-context.js";
import { errorResult, type ToolResult, toolError } from "./results.js";

export const READ_FILE_DESCRIPTION =
  "Read a text file inside the allowed project roots and return it optimized (large files are compressed; " +
  "omitted parts are recoverable with retrieve_context). Use startLine/endLine to read only a line range.";

const InputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("File path, relative to the first allowed root or absolute inside a root."),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  contextLines: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .optional()
    .describe("Extra lines around the range."),
  options: CompressionOptionsSchema.optional(),
});

const OutputSchema = OptimizeOutputSchema.extend({ path: z.string() });

export const registerReadFile: Registrar = (server, runtime) => {
  const adapter = new FileAdapter({
    allowedRoots: runtime.config.files.allowedRoots,
    maxFileBytes: runtime.config.files.maxFileBytes,
  });

  server.registerTool(
    "read_file",
    {
      title: "Read file",
      description: READ_FILE_DESCRIPTION,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async (args): Promise<ToolResult> => {
      try {
        if (args.endLine !== undefined && args.startLine === undefined) {
          return errorResult("INVALID_INPUT", "endLine requires startLine");
        }
        const file = adapter.read(args.path);
        const options = { ...(args.options ?? {}) };
        let contentType = file.contentType;
        if (args.startLine !== undefined) {
          // Line ranges use the numbered line extractor for any text file.
          contentType = "code";
          options.selection = {
            ...(options.selection ?? {}),
            lines: {
              ranges: [{ start: args.startLine, end: args.endLine ?? args.startLine }],
              context: args.contextLines ?? 0,
            },
          };
          options.strategy = "code-extractor";
          options.minBenefitTokens ??= 0;
        }
        const result = await runtime.engine.optimize(
          {
            content: file.content,
            source: `file:${file.displayPath}`,
            ...(contentType !== "unknown" ? { contentType } : {}),
          },
          options,
          runtime.scope,
        );
        const formatted = formatOptimizeResult(result);
        return {
          ...formatted,
          structuredContent: { ...formatted.structuredContent, path: file.displayPath },
        };
      } catch (error) {
        return toolError(error, runtime, "read_file");
      }
    },
  );
};

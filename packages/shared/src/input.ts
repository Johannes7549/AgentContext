import * as z from "zod";
import { ContentBlockSchema, ContentTypeSchema } from "./content.js";

/** Log levels recognised by the analyzer and log strategy. */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export const LogLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevelSchema>;

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

/** 1-based inclusive line range. */
export const LineRangeSchema = z
  .strictObject({ start: positiveInt, end: positiveInt })
  .refine((r) => r.end >= r.start, { message: "end must be >= start", path: ["end"] });
export type LineRange = z.infer<typeof LineRangeSchema>;

const PathListSchema = z.array(z.string().min(1).max(1_000)).max(500);

/** Explicit, strategy-specific selections (CONTRACTS.md §2). */
export const SelectionOptionsSchema = z.strictObject({
  json: z.exactOptional(
    z.strictObject({
      include: z.exactOptional(PathListSchema),
      exclude: z.exactOptional(PathListSchema),
      maxArrayItems: z.exactOptional(nonNegativeInt),
      maxDepth: z.exactOptional(positiveInt),
    }),
  ),
  markdown: z.exactOptional(
    z.strictObject({
      sections: z.exactOptional(z.array(z.string().min(1).max(500)).max(500)),
    }),
  ),
  lines: z.exactOptional(
    z.strictObject({
      ranges: z.array(LineRangeSchema).min(1).max(500),
      context: z.exactOptional(nonNegativeInt.max(1_000)),
    }),
  ),
  logs: z.exactOptional(
    z.strictObject({
      levels: z.exactOptional(z.array(LogLevelSchema).min(1)),
      maxGroupExamples: z.exactOptional(positiveInt.max(100)),
    }),
  ),
});
export type SelectionOptions = z.infer<typeof SelectionOptionsSchema>;

export const CompressionOptionsSchema = z.strictObject({
  maxTokens: z.exactOptional(positiveInt),
  targetReduction: z.exactOptional(z.number().min(0).max(1)),
  preserveStructure: z.exactOptional(z.boolean()),
  preserveErrors: z.exactOptional(z.boolean()),
  allowLossy: z.exactOptional(z.boolean()),
  strategy: z.exactOptional(z.string().min(1).max(100)),
  minBenefitTokens: z.exactOptional(nonNegativeInt),
  selection: z.exactOptional(SelectionOptionsSchema),
});
export type CompressionOptions = z.infer<typeof CompressionOptionsSchema>;

export const ContextInputSchema = z
  .strictObject({
    content: z.union([z.string(), z.array(ContentBlockSchema).min(1)]),
    contentType: z.exactOptional(ContentTypeSchema),
    source: z.string().min(1).max(1_000),
    taskContext: z.exactOptional(z.string().max(10_000)),
    metadata: z.exactOptional(z.record(z.string(), z.unknown())),
  })
  .superRefine((input, ctx) => {
    const isBlocks = Array.isArray(input.content);
    if (isBlocks && input.contentType !== undefined && input.contentType !== "mcp_content") {
      ctx.addIssue({
        code: "custom",
        path: ["contentType"],
        message: 'content blocks require contentType "mcp_content" (or omit contentType)',
      });
    }
    if (!isBlocks && input.contentType === "mcp_content") {
      ctx.addIssue({
        code: "custom",
        path: ["contentType"],
        message: 'contentType "mcp_content" requires an array of content blocks',
      });
    }
  });
export type ContextInput = z.infer<typeof ContextInputSchema>;

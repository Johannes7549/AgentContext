import * as z from "zod";
import { ContentBlockSchema } from "./content.js";
import { OmittedSegmentSchema } from "./segments.js";

export const TokenizerInfoSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  isExact: z.boolean(),
});
export type TokenizerInfo = z.infer<typeof TokenizerInfoSchema>;

export const TokenCountSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  tokenizer: TokenizerInfoSchema,
});
export type TokenCount = z.infer<typeof TokenCountSchema>;

export const WARNING_CODES = [
  "NO_SUPPORTED_STRATEGY",
  "BELOW_THRESHOLD",
  "NO_BENEFIT",
  "VALIDATION_FAILED",
  "BUDGET_EXCEEDED",
  "STORAGE_FAILED",
  "CONTENT_TYPE_UNCERTAIN",
  "LOSSY_OMISSION",
] as const;
export const WarningCodeSchema = z.enum(WARNING_CODES);
export type WarningCode = z.infer<typeof WarningCodeSchema>;

/** Warning messages must never contain raw content. */
export const WarningSchema = z.strictObject({
  code: WarningCodeSchema,
  message: z.string().max(500),
});
export type Warning = z.infer<typeof WarningSchema>;

export const CompressionMetricsSchema = z.strictObject({
  originalTokens: z.number().int().nonnegative(),
  optimizedTokens: z.number().int().nonnegative(),
  savedTokens: z.number().int().nonnegative(),
  reductionPercentage: z.number().min(0).max(100),
  tokenCountIsExact: z.boolean(),
  tokenizer: TokenizerInfoSchema,
  processingTimeMs: z.number().nonnegative(),
});
export type CompressionMetrics = z.infer<typeof CompressionMetricsSchema>;

/** "ctx_" + 26-character Crockford base32 ULID. */
export const CONTEXT_ID_PATTERN = /^ctx_[0-9A-HJKMNP-TV-Z]{26}$/;
export const ContextIdSchema = z.string().regex(CONTEXT_ID_PATTERN, "invalid context id");

export const CompressionResultSchema = z
  .strictObject({
    contextId: ContextIdSchema.nullable(),
    content: z.union([z.string(), z.array(ContentBlockSchema)]),
    metrics: CompressionMetricsSchema,
    strategy: z.string().min(1),
    recoveryAvailable: z.boolean(),
    omittedSegments: z.array(OmittedSegmentSchema),
    warnings: z.array(WarningSchema),
  })
  .refine((r) => !r.recoveryAvailable || r.contextId !== null, {
    message: "recoveryAvailable requires a contextId",
    path: ["recoveryAvailable"],
  })
  .refine((r) => r.metrics.tokenCountIsExact === r.metrics.tokenizer.isExact, {
    message: "tokenCountIsExact must equal tokenizer.isExact",
    path: ["metrics", "tokenCountIsExact"],
  });
export type CompressionResult = z.infer<typeof CompressionResultSchema>;

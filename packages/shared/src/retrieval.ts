import * as z from "zod";
import { ContextIdSchema, type TokenCount } from "./results.js";
import type { SegmentLocation } from "./segments.js";

export const RetrievalSelectorSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("line_range"),
    value: z.string().regex(/^[1-9]\d*-[1-9]\d*$/, 'line ranges have the form "<start>-<end>"'),
  }),
  z.strictObject({ type: z.literal("json_path"), value: z.string().min(1).max(1_000) }),
  z.strictObject({ type: z.literal("keyword"), value: z.string().min(1).max(1_000) }),
  z.strictObject({ type: z.literal("segment_id"), value: z.string().regex(/^s[1-9]\d*$/) }),
]);
export type RetrievalSelector = z.infer<typeof RetrievalSelectorSchema>;

export const RetrievalRequestSchema = z.strictObject({
  contextId: ContextIdSchema,
  selector: z.exactOptional(RetrievalSelectorSchema),
  contextLines: z.exactOptional(z.number().int().min(0).max(50)),
  maxTokens: z.exactOptional(z.number().int().positive()),
});
export type RetrievalRequest = z.infer<typeof RetrievalRequestSchema>;

/** Supplied by the server from its configuration/session — never from agent input (ADR-0006). */
export const RetrievalScopeSchema = z.strictObject({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  mode: z.enum(["session", "workspace"]),
});
export type RetrievalScope = z.infer<typeof RetrievalScopeSchema>;

export const RETRIEVAL_FAILURE_STATUSES = [
  "NOT_FOUND",
  "EXPIRED",
  "UNAUTHORIZED",
  "TOO_LARGE",
  "INTEGRITY_ERROR",
  "INVALID_SELECTOR",
] as const;
export type RetrievalFailureStatus = (typeof RETRIEVAL_FAILURE_STATUSES)[number];

export type RetrievalResult =
  | {
      status: "OK";
      contextId: string;
      content: string;
      matches?: { location: SegmentLocation; text: string }[];
      /** True if limited by maxTokens/size cap; never silent. */
      truncated: boolean;
      tokens: TokenCount;
    }
  | {
      status: RetrievalFailureStatus;
      contextId: string;
      message: string;
    };

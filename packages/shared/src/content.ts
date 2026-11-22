import * as z from "zod";

/** Supported content types (CONTRACTS.md §1). */
export const CONTENT_TYPES = [
  "json",
  "text",
  "logs",
  "markdown",
  "code",
  "mcp_content",
  "unknown",
] as const;

export const ContentTypeSchema = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof ContentTypeSchema>;

/**
 * Minimal, MCP-independent content block. Mirrors MCP content blocks without
 * importing the SDK. Extra fields are preserved verbatim (loose objects).
 */
export const TextBlockSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
});

export const MediaBlockSchema = z.looseObject({
  type: z.enum(["image", "audio"]),
  data: z.string(),
  mimeType: z.string(),
});

export const ResourceBlockSchema = z.looseObject({
  type: z.enum(["resource", "resource_link"]),
});

export const ContentBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  MediaBlockSchema,
  ResourceBlockSchema,
]);

export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

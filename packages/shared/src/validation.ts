import type * as z from "zod";
import { AgentContextError } from "./errors.js";

const MAX_ISSUES = 10;

/**
 * Validate `value` against `schema`. On failure throws `AgentContextError`
 * ("INVALID_INPUT") whose details list issue paths and messages only — never
 * the rejected values themselves.
 */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, MAX_ISSUES).map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    code: issue.code,
    message: issue.message.slice(0, 200),
  }));
  throw new AgentContextError("INVALID_INPUT", `Invalid ${what}`, {
    issues,
    issueCount: result.error.issues.length,
  });
}

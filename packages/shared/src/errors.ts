export const ERROR_CODES = [
  "INVALID_INPUT",
  "INPUT_TOO_LARGE",
  "UNSUPPORTED_JSONPATH",
  "STORAGE_ERROR",
  "INTEGRITY_ERROR",
  "NOT_FOUND",
  "EXPIRED",
  "UNAUTHORIZED",
  "TOO_LARGE",
  "PATH_NOT_ALLOWED",
  "BINARY_FILE",
  "COMMAND_DISABLED",
  "COMMAND_NOT_ALLOWED",
  "COMMAND_TIMEOUT",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Base error for all AgentContext failures. `message` and `details` must never
 * contain raw content (only identifiers, sizes, codes, and locations).
 */
export class AgentContextError extends Error {
  override readonly name = "AgentContextError";
  readonly code: ErrorCode;
  /** Declared (not initialised) so the property is absent unless details are given. */
  declare readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON(): { name: string; code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function isAgentContextError(value: unknown, code?: ErrorCode): value is AgentContextError {
  return value instanceof AgentContextError && (code === undefined || value.code === code);
}

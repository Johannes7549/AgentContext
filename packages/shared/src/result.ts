import type { AgentContextError } from "./errors.js";

/** Explicit success/failure value for operations where failure is expected. */
export type Result<T, E = AgentContextError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

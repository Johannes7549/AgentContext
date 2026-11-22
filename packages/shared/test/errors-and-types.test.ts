import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AgentContextError,
  type CompressionOptions,
  type ContextInput,
  err,
  isAgentContextError,
  ok,
  type Result,
  type RetrievalResult,
} from "../src/index.js";

describe("AgentContextError", () => {
  it("carries a code, details and cause", () => {
    const cause = new Error("disk full");
    const error = new AgentContextError(
      "STORAGE_ERROR",
      "Could not persist",
      { bytes: 10 },
      { cause },
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AgentContextError");
    expect(error.code).toBe("STORAGE_ERROR");
    expect(error.details).toEqual({ bytes: 10 });
    expect(error.cause).toBe(cause);
    expect(error.toJSON()).toEqual({
      name: "AgentContextError",
      code: "STORAGE_ERROR",
      message: "Could not persist",
      details: { bytes: 10 },
    });
  });

  it("omits details when none are given", () => {
    const error = new AgentContextError("INTERNAL", "boom");
    expect("details" in error).toBe(false);
    expect(error.toJSON()).not.toHaveProperty("details");
  });

  it("is narrowed by isAgentContextError", () => {
    const error: unknown = new AgentContextError("NOT_FOUND", "missing");
    expect(isAgentContextError(error)).toBe(true);
    expect(isAgentContextError(error, "NOT_FOUND")).toBe(true);
    expect(isAgentContextError(error, "EXPIRED")).toBe(false);
    expect(isAgentContextError(new Error("x"))).toBe(false);
  });
});

describe("Result helpers", () => {
  it("build success and failure values", () => {
    const good: Result<number> = ok(1);
    const bad: Result<number> = err(new AgentContextError("INTERNAL", "x"));
    expect(good).toEqual({ ok: true, value: 1 });
    expect(bad.ok).toBe(false);
  });
});

describe("contract types", () => {
  it("use exact optional properties", () => {
    expectTypeOf<ContextInput["taskContext"]>().toEqualTypeOf<string | undefined>();
    // exactOptional: `undefined` must not be assignable as an explicit value.
    expectTypeOf<{
      source: string;
      content: string;
      taskContext: undefined;
    }>().not.toExtend<ContextInput>();
    expectTypeOf<{ maxTokens: number }>().toExtend<CompressionOptions>();
  });

  it("discriminate retrieval results by status", () => {
    const result = { status: "NOT_FOUND", contextId: "c", message: "m" } as RetrievalResult;
    if (result.status === "OK") {
      expectTypeOf(result.content).toEqualTypeOf<string>();
    } else {
      expectTypeOf(result.message).toEqualTypeOf<string>();
    }
  });
});

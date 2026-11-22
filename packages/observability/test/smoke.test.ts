import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.js";

describe("@agentcontext/observability smoke", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@agentcontext/observability");
  });
});

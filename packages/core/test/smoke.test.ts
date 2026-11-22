import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.js";

describe("@agentcontext/core smoke", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@agentcontext/core");
  });
});

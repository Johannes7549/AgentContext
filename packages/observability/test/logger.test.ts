import { describe, expect, it } from "vitest";
import { createLogger, redact, redactString, silentLogger } from "../src/index.js";

function capture(level?: "debug" | "info" | "warn" | "error") {
  const lines: string[] = [];
  const logger = createLogger({
    ...(level ? { level } : {}),
    write: (line) => lines.push(line),
    now: () => new Date("2026-11-23T00:00:00Z"),
  });
  const records = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { logger, lines, records };
}

describe("createLogger", () => {
  it("writes one JSON record per line with time, level and message", () => {
    const { logger, lines, records } = capture();
    logger.info("server started", { tools: 5 });
    expect(lines[0]?.endsWith("\n")).toBe(true);
    expect(records()).toEqual([
      { time: "2026-11-23T00:00:00.000Z", level: "info", msg: "server started", tools: 5 },
    ]);
  });

  it("filters by level", () => {
    const { logger, records } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(records().map((r) => r.level)).toEqual(["warn", "error"]);
  });

  it("adds child fields", () => {
    const { logger, records } = capture();
    logger.child({ component: "storage" }).info("x");
    expect(records()[0]).toMatchObject({ component: "storage", msg: "x" });
  });

  it("never throws when the sink fails", () => {
    const logger = createLogger({
      write: () => {
        throw new Error("stderr closed");
      },
    });
    expect(() => logger.error("x")).not.toThrow();
    expect(() => silentLogger.child({}).info("x")).not.toThrow();
  });
});

describe("redaction — no raw content in logs", () => {
  const secretContent = "TOP SECRET customer data line\nanother line";

  it("replaces content-like fields with their size", () => {
    const { logger, lines } = capture();
    logger.info("optimized", {
      content: secretContent,
      original: secretContent,
      nested: { text: secretContent, optimizedContent: secretContent },
      blocks: [{ type: "text", text: secretContent }],
      args: ["--token", "x"],
      env: { HOME: "/home/user" },
    });
    const output = lines.join("");
    expect(output).not.toContain("TOP SECRET");
    expect(output).not.toContain("/home/user");
    expect(output).toContain(`[content: ${secretContent.length} chars]`);
  });

  it("masks secret-named fields and secret-looking values", () => {
    const { logger, lines } = capture();
    const values = [
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "AKIAABCDEFGHIJKLMNOP",
      "Bearer abc.def.ghijklmnopqrstuv",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ];
    logger.warn(`request failed with ${values[0]}`, {
      apiKey: "plain-value",
      password: "hunter2",
      url: "https://example.com/x?token=abc123&page=2",
      list: values,
    });
    const output = lines.join("");
    for (const value of [...values, "plain-value", "hunter2", "abc123"]) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain("page=2");
  });

  it("summarizes errors by name and code only", () => {
    const error = Object.assign(new Error(`failed reading ${secretContent}`), { code: "ENOENT" });
    expect(redact({ error })).toEqual({ error: { name: "Error", code: "ENOENT" } });
  });

  it("truncates long strings and deep objects", () => {
    expect(redactString("x".repeat(1000))).toBe(`${"x".repeat(300)}…[+700 chars]`);
    expect(redact({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({
      a: { b: { c: { d: "[truncated]" } } },
    });
  });
});

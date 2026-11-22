import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { logCompressor, messageKey } from "../src/index.js";
import { makeContext, recover, run } from "./helpers/context.js";

const log = readFileSync(new URL("./fixtures/terminal.log", import.meta.url), "utf8");
const health = "INFO GET /health 200 2ms";

describe("messageKey", () => {
  it.each([
    ["2026-11-22T10:00:00Z INFO x", "INFO x"],
    ["2026-11-22 10:00:00.123+02:00 WARN y  ", "WARN y"],
    ["[10:00:01] step", "step"],
    ["Nov 22 10:00:00 host sshd: ok", "host sshd: ok"],
    ["no timestamp", "no timestamp"],
  ])("%j → %j", (line, key) => {
    expect(messageKey(line)).toBe(key);
  });
});

describe("log-compressor — safe policy (no selection)", () => {
  it("groups identical messages and keeps everything else in order", async () => {
    const { output, issues, estimate } = await run(logCompressor, log, "logs");
    expect(issues).toEqual([]);
    expect(estimate.applicable).toBe(true);
    const lines = output.content.split("\n");
    expect(lines.filter((l) => l.endsWith(health))).toHaveLength(1);
    expect(lines).toContain("[... s1: repeated 74 more times (lines 5-43, 46-70, 75-84)]");
    expect(lines).toContain("2026-11-22T10:01:00Z DEBUG cache warm");
    expect(lines).toContain("2026-11-22T10:01:01Z WARN slow query took 1200ms");
    expect(lines).toContain("[... s2: repeated 1 more time (lines 85)]");
  });

  it("records groups with counts and exact recoverable locations", async () => {
    const { output, context } = await run(logCompressor, log, "logs");
    expect(output.omittedSegments).toEqual([
      {
        id: "s1",
        type: "log_group",
        location: "lines:5-43;lines:46-70;lines:75-84",
        reason: "repeated_log_line",
        recoverable: true,
        occurrences: 75,
        note: "identical message repeated 75 times",
      },
      expect.objectContaining({ id: "s2", location: "lines:85-85", occurrences: 2 }),
    ]);
    const recovered = recover(context, output.omittedSegments[0]?.location ?? "")
      .join("\n")
      .split("\n");
    expect(recovered).toHaveLength(74);
    expect(recovered.every((l) => messageKey(l) === health)).toBe(true);
  });

  it("never groups stack frames or blank lines", async () => {
    const { output } = await run(logCompressor, log, "logs");
    const frames = output.content.split("\n").filter((l) => l.includes("node:internal/process"));
    expect(frames).toHaveLength(2);
    expect(output.content.startsWith("> app@1.0.0 test\n> vitest run\n\n")).toBe(true);
  });

  it("skips logs without repetition", async () => {
    const { estimate, output } = await run(logCompressor, "INFO a\nWARN b\nERROR c\n", "logs");
    expect(estimate.applicable).toBe(false);
    expect(output.omittedSegments).toEqual([]);
  });

  it("supports logs only", () => {
    const text = makeContext("INFO a\nINFO a", "text");
    expect(logCompressor.supports(text, {} as never)).toBe(false);
  });
});

describe("log-compressor — level policy (explicit selection.logs)", () => {
  it("omits runs below the kept levels and keeps errors, frames and warnings", async () => {
    const { output, issues, context } = await run(logCompressor, log, "logs", {
      selection: { logs: {} },
    });
    expect(issues).toEqual([]);
    const lines = output.content.split("\n");
    expect(lines.some((l) => l.endsWith(health))).toBe(false);
    expect(lines).toContain(
      "[... s1: 41 lines below kept levels omitted (info x40, debug x1; lines 4-44)]",
    );
    expect(lines).toContain("2026-11-22T10:01:01Z WARN slow query took 1200ms");
    expect(lines).toContain("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(lines).toContain("    at handler (src/routes/users.ts:42:17)");
    expect(lines).toContain(" FAIL  src/users.test.ts > returns user by id");
    expect(lines).toContain("Tests  1 failed | 41 passed (42)");
    for (const segment of output.omittedSegments) {
      expect(segment.recoverable).toBe(true);
      expect(recover(context, segment.location).length).toBeGreaterThan(0);
    }
    expect(output.omittedSegments.map((s) => s.reason)).toEqual([
      "below_log_level",
      "below_log_level",
      "repeated_log_line",
      "below_log_level",
    ]);
  });

  it("respects custom levels and example counts", async () => {
    const content = Array.from(
      { length: 6 },
      (_, i) => `2026-01-01T00:00:0${i}Z WARN disk 91%`,
    ).join("\n");
    const { output } = await run(logCompressor, content, "logs", {
      selection: { logs: { levels: ["warn"], maxGroupExamples: 2 } },
    });
    expect(output.content.split("\n")).toEqual([
      "2026-01-01T00:00:00Z WARN disk 91%",
      "2026-01-01T00:00:01Z WARN disk 91%",
      "[... s1: repeated 4 more times (lines 3-6)]",
    ]);
  });

  it("keeps lines before the first level", async () => {
    const { output } = await run(logCompressor, "header\nINFO a\nINFO b\n", "logs", {
      selection: { logs: { levels: ["error"] } },
    });
    expect(output.content.split("\n")[0]).toBe("header");
  });
});

describe("log-compressor — validation", () => {
  it("reports dropped error events", () => {
    const context = makeContext("INFO ok\nERROR boom\n", "logs");
    const issues = logCompressor.validate?.(context, {
      content: "INFO ok",
      omittedSegments: [],
      warnings: [],
    });
    expect(issues).toEqual([
      {
        code: "LOG_ERROR_DROPPED",
        message: "Error event at line 2 is missing from the output",
        location: "lines:2-2",
      },
    ]);
  });

  it("is deterministic", async () => {
    const a = await run(logCompressor, log, "logs", { selection: { logs: {} } });
    const b = await run(logCompressor, log, "logs", { selection: { logs: {} } });
    expect(a.output).toEqual(b.output);
  });
});

describe("log-compressor — stack frames under level-less exception lines", () => {
  it("keeps frames that follow an exception line even when the last explicit level is filtered", async () => {
    const content = [
      "2026-01-01T00:00:00Z INFO starting",
      "2026-01-01T00:00:01Z INFO working",
      "AssertionError: expected 1 to be 2",
      "    at src/a.test.ts:42:19",
      "    at run (src/runner.ts:10:5)",
      "2026-01-01T00:00:02Z INFO done",
    ].join("\n");
    const { output, issues } = await run(logCompressor, content, "logs", {
      selection: { logs: {} },
    });
    expect(issues).toEqual([]);
    const lines = output.content.split("\n");
    expect(lines).toContain("AssertionError: expected 1 to be 2");
    expect(lines).toContain("    at src/a.test.ts:42:19");
    expect(lines).toContain("    at run (src/runner.ts:10:5)");
    expect(lines.some((l) => l.includes("INFO done"))).toBe(false);
  });
});

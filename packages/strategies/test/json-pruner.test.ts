import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jsonPruner, MAX_CHILD_SEGMENTS_PER_CONTAINER } from "../src/index.js";
import { makeAnalysis, makeContext, recover, run } from "./helpers/context.js";

const api = readFileSync(new URL("./fixtures/api-response.json", import.meta.url), "utf8");
const parsed = (content: string) => JSON.parse(content) as unknown;

describe("json-pruner — applicability", () => {
  it("supports parsed JSON only", () => {
    const json = makeContext('{"a":1}', "json");
    const broken = makeContext('{"a":', "json");
    const text = makeContext('{"a":1}', "text");
    expect(jsonPruner.supports(json, makeAnalysis(json))).toBe(true);
    expect(jsonPruner.supports(broken, makeAnalysis(broken))).toBe(false);
    expect(jsonPruner.supports(text, makeAnalysis(text))).toBe(false);
  });

  it("does nothing without an explicit selection (R5)", async () => {
    const { estimate, output } = await run(jsonPruner, api, "json");
    expect(estimate.applicable).toBe(false);
    expect(estimate.reason).toContain("requires selection.json");
    expect(output.content).toBe(api);
    expect(output.omittedSegments).toEqual([]);
  });

  it.each([
    [{ include: ["$.nothing"] }, "matched nothing"],
    [{ exclude: ["$"] }, "entire document"],
    [{ exclude: ["$.missing"] }, "omits nothing"],
  ])("skips %j", async (json, reason) => {
    const { estimate } = await run(jsonPruner, api, "json", { selection: { json } });
    expect(estimate.applicable).toBe(false);
    expect(estimate.reason).toContain(reason);
  });
});

describe("json-pruner — include", () => {
  it("keeps only selected fields and their ancestors", async () => {
    const { output, issues, context } = await run(jsonPruner, api, "json", {
      selection: { json: { include: ["$.data.customers[*].email", "$.meta.total"] } },
    });
    expect(issues).toEqual([]);
    expect(parsed(output.content)).toEqual({
      data: {
        customers: [
          { email: "ada@example.com" },
          { email: "alan@example.com" },
          { email: "grace@example.com" },
        ],
      },
      meta: { total: 3 },
    });
    const locations = output.omittedSegments.map((s) => s.location);
    expect(locations).toContain("json:$['data']['customers'][0]['id']");
    expect(locations).toContain("json:$['meta']['request_id']");
    expect(locations).toContain("json:$['debug']");
    for (const segment of output.omittedSegments) {
      expect(segment.recoverable).toBe(true);
      expect(segment.reason).toBe("not_selected");
      expect(recover(context, segment.location)[0]).not.toBe(undefined);
    }
  });

  it("keeps a matched subtree whole", async () => {
    const { output } = await run(jsonPruner, api, "json", {
      selection: { json: { include: ["$.meta"] } },
    });
    expect(parsed(output.content)).toEqual({ meta: (parsed(api) as { meta: unknown }).meta });
  });

  it("keeps the whole document when $ is included", async () => {
    const { estimate } = await run(jsonPruner, api, "json", {
      selection: { json: { include: ["$"] } },
    });
    expect(estimate.applicable).toBe(false);
  });
});

describe("json-pruner — exclude, depth and arrays", () => {
  it("drops excluded nodes and records them", async () => {
    const { output } = await run(jsonPruner, api, "json", {
      selection: { json: { exclude: ["$.debug", "$.data.customers[*].address"] } },
    });
    const result = parsed(output.content) as {
      debug?: unknown;
      data: { customers: { address?: unknown }[] };
    };
    expect(result.debug).toBeUndefined();
    expect(result.data.customers.every((c) => c.address === undefined)).toBe(true);
    expect(output.omittedSegments.map((s) => [s.location, s.reason])).toEqual([
      ["json:$['data']['customers'][0]['address']", "excluded_by_selection"],
      ["json:$['data']['customers'][1]['address']", "excluded_by_selection"],
      ["json:$['data']['customers'][2]['address']", "excluded_by_selection"],
      ["json:$['debug']", "excluded_by_selection"],
    ]);
  });

  it("drops containers beyond maxDepth", async () => {
    const content = '{"a":{"b":{"c":{"d":1}}},"x":1}';
    const { output } = await run(jsonPruner, content, "json", {
      selection: { json: { maxDepth: 2 } },
    });
    expect(parsed(output.content)).toEqual({ a: {}, x: 1 });
    expect(output.omittedSegments).toMatchObject([
      { location: "json:$['a']['b']", reason: "depth_limit", type: "json_value" },
    ]);
  });

  it("limits array items and records the remainder at the array path", async () => {
    const content = JSON.stringify({ items: Array.from({ length: 10 }, (_, i) => ({ i })) });
    const { output } = await run(jsonPruner, content, "json", {
      selection: { json: { maxArrayItems: 3 } },
    });
    expect((parsed(output.content) as { items: unknown[] }).items).toEqual([
      { i: 0 },
      { i: 1 },
      { i: 2 },
    ]);
    expect(output.omittedSegments).toEqual([
      {
        id: "s1",
        type: "array_items",
        location: "json:$['items']",
        reason: "array_limit",
        recoverable: true,
        note: "7 items after the first 3 kept items (array length 10)",
      },
    ]);
  });

  it("collapses many omitted children into one container-level segment", async () => {
    const wide = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const content = JSON.stringify({ keep: 1, wide });
    const { output } = await run(jsonPruner, content, "json", {
      selection: { json: { include: ["$.keep", "$.wide.k0"] } },
    });
    expect(parsed(output.content)).toEqual({ keep: 1, wide: { k0: 0 } });
    expect(output.omittedSegments).toEqual([
      expect.objectContaining({ location: "json:$['wide']", note: "49 of 50 members omitted" }),
    ]);
    expect(49).toBeGreaterThan(MAX_CHILD_SEGMENTS_PER_CONTAINER);
  });
});

describe("json-pruner — output", () => {
  it("pretty-prints when the original was multi-line and stays compact otherwise", async () => {
    const pretty = await run(jsonPruner, api, "json", {
      selection: { json: { exclude: ["$.debug"] } },
    });
    expect(pretty.output.content).toContain("\n  ");
    const compact = await run(jsonPruner, '{"a":1,"b":2}', "json", {
      selection: { json: { exclude: ["$.b"] } },
    });
    expect(compact.output.content).toBe('{"a":1}');
  });

  it("estimates savings and is deterministic", async () => {
    const options = { selection: { json: { include: ["$.meta.total"] } } };
    const first = await run(jsonPruner, api, "json", options);
    const second = await run(jsonPruner, api, "json", options);
    expect(first.output).toEqual(second.output);
    expect(first.estimate.applicable).toBe(true);
    expect(first.estimate.estimatedSavedTokens).toBeGreaterThan(0);
  });

  it("flags invalid JSON output in validate()", () => {
    const context = makeContext("{}", "json");
    expect(
      jsonPruner.validate?.(context, { content: "{", omittedSegments: [], warnings: [] }),
    ).toEqual([
      { code: "JSON_OUTPUT_INVALID", message: "json-pruner output does not parse as JSON" },
    ]);
  });
});

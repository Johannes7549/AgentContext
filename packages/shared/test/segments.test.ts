import { describe, expect, it } from "vitest";
import {
  blockLocation,
  joinLocations,
  jsonLocation,
  linesLocation,
  offsetLocation,
  parseLocations,
} from "../src/index.js";

describe("location builders", () => {
  it("format canonical locations", () => {
    expect(linesLocation(3, 9)).toBe("lines:3-9");
    expect(offsetLocation(0, 12)).toBe("offset:0-12");
    expect(jsonLocation("$['items'][3]")).toBe("json:$['items'][3]");
    expect(blockLocation(2, "lines:1-4")).toBe("block:2/lines:1-4");
    expect(joinLocations(["lines:1-1", "lines:5-5"])).toBe("lines:1-1;lines:5-5");
  });

  it.each([
    () => linesLocation(0, 1),
    () => linesLocation(5, 4),
    () => offsetLocation(-1, 2),
    () => linesLocation(1.5, 2),
    () => jsonLocation("items[0]"),
    () => blockLocation(-1, "lines:1-1"),
    () => blockLocation(0, "block:1/lines:1-1"),
    () => joinLocations([]),
  ])("reject invalid input %#", (fn) => {
    expect(fn).toThrow(RangeError);
  });
});

describe("parseLocations", () => {
  it("round-trips every location kind", () => {
    const joined = joinLocations([
      linesLocation(1, 2),
      offsetLocation(10, 20),
      jsonLocation("$['a'][0]"),
      blockLocation(1, jsonLocation("$['b']")),
    ]);
    expect(parseLocations(joined)).toEqual([
      { kind: "lines", start: 1, end: 2 },
      { kind: "offset", start: 10, end: 20 },
      { kind: "json", path: "$['a'][0]" },
      { kind: "block", index: 1, inner: { kind: "json", path: "$['b']" } },
    ]);
  });

  it("does not split on semicolons inside quoted member names", () => {
    expect(parseLocations("json:$['a;b'];lines:4-4")).toEqual([
      { kind: "json", path: "$['a;b']" },
      { kind: "lines", start: 4, end: 4 },
    ]);
    expect(parseLocations("json:$['it\\'s;x']")).toEqual([{ kind: "json", path: "$['it\\'s;x']" }]);
  });

  it.each([
    "",
    "lines",
    "lines:5-2",
    "lines:0-3",
    "lines:a-b",
    "json:items",
    "file:1-2",
    "lines:1-2;;lines:3-4",
    "json:$['open",
    "block:x/lines:1-1",
    "block:1/block:2/lines:1-1",
  ])("rejects %j", (value) => {
    expect(() => parseLocations(value)).toThrow(RangeError);
  });
});

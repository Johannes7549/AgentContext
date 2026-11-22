import { describe, expect, it } from "vitest";
import {
  AgentContextError,
  jsonPathResolves,
  normalizedPath,
  parseJsonPath,
  queryJsonPath,
  resolveNormalizedPath,
} from "../src/index.js";

const values = (root: unknown, path: string) => queryJsonPath(root, path).map((m) => m.value);
const paths = (root: unknown, path: string) => queryJsonPath(root, path).map((m) => m.path);

// RFC 9535 §1.5 example document.
const store = {
  store: {
    book: [
      { category: "reference", author: "Nigel Rees", title: "Sayings of the Century", price: 8.95 },
      { category: "fiction", author: "Evelyn Waugh", title: "Sword of Honour", price: 12.99 },
      {
        category: "fiction",
        author: "Herman Melville",
        title: "Moby Dick",
        isbn: "0-553-21311-3",
        price: 8.99,
      },
      {
        category: "fiction",
        author: "J. R. R. Tolkien",
        title: "The Lord of the Rings",
        price: 22.99,
      },
    ],
    bicycle: { color: "red", price: 399 },
  },
};

describe("parseJsonPath", () => {
  it("parses every supported form", () => {
    expect(parseJsonPath(`$.a['b']["c"][0][-1][1:3][::2][*].*.ünï_1`)).toEqual([
      { type: "name", name: "a" },
      { type: "name", name: "b" },
      { type: "name", name: "c" },
      { type: "index", index: 0 },
      { type: "index", index: -1 },
      { type: "slice", start: 1, end: 3 },
      { type: "slice", step: 2 },
      { type: "wildcard" },
      { type: "wildcard" },
      { type: "name", name: "ünï_1" },
    ]);
    expect(parseJsonPath("$")).toEqual([]);
    expect(parseJsonPath("$[ 1 : 2 ]")).toEqual([{ type: "slice", start: 1, end: 2 }]);
  });

  it("decodes string escapes", () => {
    expect(parseJsonPath(`$['it\\'s']["say \\"hi\\""]['\\u00e9\\n\\t\\\\']`)).toEqual([
      { type: "name", name: "it's" },
      { type: "name", name: 'say "hi"' },
      { type: "name", name: "é\n\t\\" },
    ]);
  });

  it.each([
    ["$..author", "descendant"],
    ["$.book[?@.price<10]", "filter"],
    ["$.book[(@.length-1)]", "script"],
    ["$['a','b']", "union"],
    ["$[0,1]", "union"],
    ["$.length()", "unexpected"],
    ["a.b", "must start with $"],
    ["$.", "member name"],
    ["$.1abc", "member name"],
    ["$[", "selector"],
    ["$[1", "']'"],
    ["$['open", "unterminated"],
    ["$['bad\\q']", "escape"],
    ["$['\\u12']", "\\u escape"],
    ["$[-0]", "-0"],
    ["$[01]", "']'"],
    ["$[1:2:3:4]", "']'"],
    ["$ .a", "unexpected"],
    ["$[99999999999999999999]", "out of range"],
  ])("rejects %j (%s)", (path, fragment) => {
    let caught: unknown;
    try {
      parseJsonPath(path);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentContextError);
    expect((caught as AgentContextError).code).toBe("UNSUPPORTED_JSONPATH");
    expect((caught as AgentContextError).message).toContain(fragment);
  });

  it("rejects overly long or deep paths", () => {
    expect(() => parseJsonPath(`$${".a".repeat(600)}`)).toThrow(AgentContextError);
    expect(() => parseJsonPath(`$${"[0]".repeat(65)}`)).toThrow(AgentContextError);
  });
});

describe("queryJsonPath — RFC 9535 behaviour", () => {
  it("selects members and indices", () => {
    expect(values(store, "$.store.book[0].title")).toEqual(["Sayings of the Century"]);
    expect(values(store, "$.store.book[-1].author")).toEqual(["J. R. R. Tolkien"]);
    expect(values(store, "$.store.bicycle['color']")).toEqual(["red"]);
  });

  it("applies wildcards to arrays and objects in order", () => {
    expect(values(store, "$.store.book[*].author")).toEqual([
      "Nigel Rees",
      "Evelyn Waugh",
      "Herman Melville",
      "J. R. R. Tolkien",
    ]);
    expect(paths(store, "$.store.*")).toEqual(["$['store']['book']", "$['store']['bicycle']"]);
  });

  it("returns nothing for missing members, out-of-range indices and type mismatches", () => {
    expect(values(store, "$.store.book[4]")).toEqual([]);
    expect(values(store, "$.store.book[-5]")).toEqual([]);
    expect(values(store, "$.store.bicycle[0]")).toEqual([]);
    expect(values(store, "$.store.book.color")).toEqual([]);
    expect(values(store, "$.store.missing")).toEqual([]);
    expect(values({ a: 1 }, "$.a.b")).toEqual([]);
  });

  it("does not select inherited properties", () => {
    expect(values({}, "$.toString")).toEqual([]);
    expect(values({}, "$['__proto__']")).toEqual([]);
  });

  // RFC 9535 §2.3.4.3 examples.
  const letters = ["a", "b", "c", "d", "e", "f", "g"];
  it.each([
    ["$[1:3]", ["b", "c"]],
    ["$[5:]", ["f", "g"]],
    ["$[1:5:2]", ["b", "d"]],
    ["$[5:1:-2]", ["f", "d"]],
    ["$[::-1]", ["g", "f", "e", "d", "c", "b", "a"]],
    ["$[:2]", ["a", "b"]],
    ["$[-2:]", ["f", "g"]],
    ["$[::0]", []],
    ["$[10:20]", []],
    ["$[-100:2]", ["a", "b"]],
  ])("slices %s", (path, expected) => {
    expect(values(letters, path)).toEqual(expected);
  });

  it("returns normalized paths with escaping", () => {
    const doc = { "it's": { "a\\b": { "line\nbreak": [{ "\u0001": true }] } } };
    expect(paths(doc, "$.*.*.*[0].*")).toEqual([
      "$['it\\'s']['a\\\\b']['line\\nbreak'][0]['\\u0001']",
    ]);
  });

  it("limits the number of selected nodes", () => {
    const big = Array.from({ length: 50 }, (_, i) => i);
    expect(() => queryJsonPath(big, "$[*]", { maxResults: 10 })).toThrow(
      expect.objectContaining({ code: "TOO_LARGE" }),
    );
    expect(queryJsonPath(big, "$[*]", { maxResults: 50 })).toHaveLength(50);
  });

  it("accepts pre-parsed segments", () => {
    expect(
      queryJsonPath({ a: [1, 2] }, [
        { type: "name", name: "a" },
        { type: "index", index: 1 },
      ]),
    ).toEqual([{ path: "$['a'][1]", value: 2 }]);
  });
});

describe("normalized paths", () => {
  it("round-trips through parse and resolve", () => {
    for (const match of queryJsonPath(store, "$.store.book[*].*")) {
      expect(resolveNormalizedPath(store, match.path)).toEqual({ found: true, value: match.value });
    }
  });

  it("builds paths from parts", () => {
    expect(normalizedPath([])).toBe("$");
    expect(normalizedPath(["a", 0, "b'c"])).toBe("$['a'][0]['b\\'c']");
  });

  it("resolves only singular, existing paths", () => {
    expect(resolveNormalizedPath(store, "$['store']['bicycle']['price']")).toEqual({
      found: true,
      value: 399,
    });
    expect(resolveNormalizedPath({ a: null }, "$['a']")).toEqual({ found: true, value: null });
    expect(resolveNormalizedPath(store, "$['store']['book'][*]")).toEqual({ found: false });
    expect(resolveNormalizedPath(store, "$['store']['book'][-1]")).toEqual({ found: false });
    expect(resolveNormalizedPath(store, "$['nope']")).toEqual({ found: false });
    expect(resolveNormalizedPath(store, "not a path")).toEqual({ found: false });
    expect(jsonPathResolves(store, "$['store']")).toBe(true);
    expect(jsonPathResolves(store, "$['x']")).toBe(false);
  });
});

describe("robustness", () => {
  it("never throws anything but AgentContextError on random input", () => {
    const alphabet = "$.[]'\"*:?()-0123456789ab\\u, \n";
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let n = 0; n < 2_000; n++) {
      const length = Math.floor(random() * 20);
      let path = "$";
      for (let i = 0; i < length; i++) path += alphabet[Math.floor(random() * alphabet.length)];
      try {
        queryJsonPath(store, path);
      } catch (error) {
        expect(error).toBeInstanceOf(AgentContextError);
      }
    }
  });
});

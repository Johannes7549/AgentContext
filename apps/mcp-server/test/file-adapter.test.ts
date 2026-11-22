import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentTypeFor, FileAdapter } from "../src/index.js";
import { tempDir } from "./helpers.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function sandbox() {
  const { dir, remove } = tempDir("agentcontext-files-");
  cleanups.push(remove);
  const root = join(dir, "project");
  const outside = join(dir, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "notes.md"), "# Notes\n");
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
  const adapter = new FileAdapter({ allowedRoots: [root], maxFileBytes: 1024 });
  return { root, outside, adapter };
}

const code = (fn: () => unknown) => {
  try {
    fn();
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe("FileAdapter — allowed reads", () => {
  it("reads files relative to the first root and absolute paths inside a root", () => {
    const { root, adapter } = sandbox();
    expect(adapter.read("src/app.ts")).toMatchObject({
      displayPath: "src/app.ts",
      content: "export const a = 1;\n",
      contentType: "code",
      sizeBytes: 20,
    });
    expect(adapter.read(join(root, "notes.md")).contentType).toBe("markdown");
    expect(adapter.read("./src/../notes.md").displayPath).toBe("notes.md");
  });

  it("supports several roots", () => {
    const { root, outside } = sandbox();
    const adapter = new FileAdapter({ allowedRoots: [root, outside], maxFileBytes: 1024 });
    expect(adapter.read(join(outside, "secret.txt")).content).toBe("TOP SECRET");
  });
});

describe("FileAdapter — sandbox escapes are rejected", () => {
  it.each(["../outside/secret.txt", "src/../../outside/secret.txt", ".."])(
    "rejects traversal %j",
    (path) => {
      const { adapter } = sandbox();
      expect(code(() => adapter.read(path))).toBe("PATH_NOT_ALLOWED");
    },
  );

  it("rejects absolute paths outside the roots", () => {
    const { adapter, outside } = sandbox();
    expect(code(() => adapter.read(join(outside, "secret.txt")))).toBe("PATH_NOT_ALLOWED");
    expect(code(() => adapter.read(resolve("/")))).toBe("PATH_NOT_ALLOWED");
  });

  it("rejects a directory junction / symlink that points outside", () => {
    const { root, outside, adapter } = sandbox();
    symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    expect(code(() => adapter.read("link/secret.txt"))).toBe("PATH_NOT_ALLOWED");
  });

  it("rejects a file symlink that points outside (where symlinks are permitted)", () => {
    const { root, outside, adapter } = sandbox();
    try {
      symlinkSync(join(outside, "secret.txt"), join(root, "secret-link.txt"), "file");
    } catch {
      return; // creating file symlinks needs extra privileges on some Windows setups
    }
    expect(code(() => adapter.read("secret-link.txt"))).toBe("PATH_NOT_ALLOWED");
  });

  it("allows symlinks that stay inside the root", () => {
    const { root, adapter } = sandbox();
    symlinkSync(
      join(root, "src"),
      join(root, "src-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(adapter.read("src-link/app.ts").displayPath).toBe("src/app.ts");
  });

  it.each([
    ["NUL byte", "src/app.ts\0.md"],
    ["empty path", ""],
  ])("rejects %s", (_name, path) => {
    const { adapter } = sandbox();
    expect(code(() => adapter.read(path))).toBe("PATH_NOT_ALLOWED");
  });

  it.each([
    "\\\\server\\share\\file.txt",
    "//server/share/file.txt",
    "\\\\?\\C:\\Windows\\win.ini",
    "\\\\.\\pipe\\x",
    "notes.md:hidden",
    "src\\app.ts::$DATA",
    "CON",
    "src/nul.txt",
    "COM1",
    "aux .txt",
  ])("rejects Windows-specific path %j", (path) => {
    const { root } = sandbox();
    const windows = new FileAdapter({
      allowedRoots: [root],
      maxFileBytes: 1024,
      platform: "win32",
    });
    expect(code(() => windows.resolvePath(path))).toBe("PATH_NOT_ALLOWED");
  });
});

describe("FileAdapter — content checks", () => {
  it("reports missing files, directories and oversized files", () => {
    const { root, adapter } = sandbox();
    expect(code(() => adapter.read("missing.txt"))).toBe("NOT_FOUND");
    expect(code(() => adapter.read("src"))).toBe("INVALID_INPUT");
    writeFileSync(join(root, "big.txt"), "x".repeat(2048));
    expect(code(() => adapter.read("big.txt"))).toBe("INPUT_TOO_LARGE");
  });

  it("rejects binary and non-UTF-8 files", () => {
    const { root, adapter } = sandbox();
    writeFileSync(join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    writeFileSync(join(root, "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    expect(code(() => adapter.read("image.png"))).toBe("BINARY_FILE");
    expect(code(() => adapter.read("latin1.txt"))).toBe("BINARY_FILE");
  });

  it("requires existing roots", () => {
    expect(code(() => new FileAdapter({ allowedRoots: [], maxFileBytes: 1 }))).toBe(
      "INVALID_INPUT",
    );
    expect(
      code(() => new FileAdapter({ allowedRoots: ["/definitely/missing/root"], maxFileBytes: 1 })),
    ).toBe("INVALID_INPUT");
  });
});

describe("contentTypeFor", () => {
  it.each([
    ["a.json", "json"],
    ["README.md", "markdown"],
    ["server.log", "logs"],
    ["main.py", "code"],
    ["change.patch", "code"],
    ["config.yaml", "code"],
    ["notes.txt", "text"],
    ["LICENSE", "unknown"],
  ])("%s → %s", (path, type) => {
    expect(contentTypeFor(path)).toBe(type);
  });
});

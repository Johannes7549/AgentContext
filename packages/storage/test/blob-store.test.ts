import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentContextError, sha256Hex } from "@agentcontext/shared";
import { afterEach, describe, expect, it } from "vitest";
import { BlobStore } from "../src/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function store() {
  const dir = mkdtempSync(join(tmpdir(), "agentcontext-blobs-"));
  dirs.push(dir);
  return new BlobStore(join(dir, "blobs"));
}

const content = "line one\r\nline two ✓ 😀\n".repeat(1000);

describe("BlobStore", () => {
  it("stores content under its hash and reads it back exactly", () => {
    const blobs = store();
    const info = blobs.put(content);
    const hash = sha256Hex(content);
    expect(info).toEqual({
      ref: `${hash.slice(0, 2)}/${hash}`,
      hash,
      sizeBytes: Buffer.byteLength(content),
    });
    expect(blobs.get(info.ref)).toBe(content);
    expect(blobs.has(info.ref)).toBe(true);
    expect(readFileSync(join(blobs.root, ...info.ref.split("/")))).toEqual(
      Buffer.from(content, "utf8"),
    );
  });

  it("deduplicates identical content and leaves no temp files", () => {
    const blobs = store();
    const a = blobs.put(content);
    const b = blobs.put(content);
    expect(b).toEqual(a);
    expect(blobs.list()).toEqual({
      refs: [expect.objectContaining({ ref: a.ref, sizeBytes: a.sizeBytes })],
      temps: [],
    });
  });

  it("detects corrupted blobs on read", () => {
    const blobs = store();
    const { ref } = blobs.put(content);
    writeFileSync(join(blobs.root, ...ref.split("/")), "tampered");
    expect(() => blobs.get(ref)).toThrow(expect.objectContaining({ code: "INTEGRITY_ERROR" }));
  });

  it("repairs a corrupted blob when the same content is stored again", () => {
    const blobs = store();
    const { ref } = blobs.put(content);
    writeFileSync(join(blobs.root, ...ref.split("/")), "tampered");
    blobs.put(content);
    expect(blobs.get(ref)).toBe(content);
  });

  it("reports missing blobs and rejects malformed refs", () => {
    const blobs = store();
    const hash = sha256Hex("never stored");
    expect(() => blobs.get(`${hash.slice(0, 2)}/${hash}`)).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    for (const ref of ["../etc/passwd", "zz/abc", `ab/${hash}`, `${hash.slice(0, 2)}/../${hash}`]) {
      expect(() => blobs.get(ref)).toThrow(AgentContextError);
    }
  });

  it("deletes blobs and reports freed bytes", () => {
    const blobs = store();
    const { ref, sizeBytes } = blobs.put(content);
    expect(blobs.delete(ref)).toBe(sizeBytes);
    expect(blobs.has(ref)).toBe(false);
    expect(blobs.delete(ref)).toBe(0);
  });

  it("lists leftover temp files from interrupted writes", () => {
    const blobs = store();
    const { ref } = blobs.put(content);
    const prefixDir = join(blobs.root, ref.slice(0, 2));
    writeFileSync(join(prefixDir, ".tmp-deadbeef-000000"), "partial");
    writeFileSync(join(prefixDir, "not-a-blob.txt"), "ignored");
    const listed = blobs.list();
    expect(listed.refs.map((r) => r.ref)).toEqual([ref]);
    expect(listed.temps).toEqual([join(prefixDir, ".tmp-deadbeef-000000")]);
    expect(readdirSync(prefixDir)).toHaveLength(3);
  });

  it("stores the empty string", () => {
    const blobs = store();
    const info = blobs.put("");
    expect(blobs.get(info.ref)).toBe("");
    expect(info.sizeBytes).toBe(0);
  });
});

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { AgentContextError, sha256Hex } from "@agentcontext/shared";

const HASH = /^[0-9a-f]{64}$/;

export interface BlobInfo {
  /** Relative reference stored in metadata: "<hash[0:2]>/<hash>". */
  ref: string;
  hash: string;
  sizeBytes: number;
}

/**
 * Content-addressed blob store (ADR-0002): `<root>/<hash[0:2]>/<hash>`.
 *
 * Writes are atomic — temp file in the target directory → fsync → rename —
 * and every write and read is verified against the SHA-256 of the content.
 * Identical content is stored once.
 */
export class BlobStore {
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  static refFor(hash: string): string {
    if (!HASH.test(hash)) throw new RangeError("invalid blob hash");
    return `${hash.slice(0, 2)}/${hash}`;
  }

  /** Store `content` (UTF-8) and return its reference. Verified after writing. */
  put(content: string): BlobInfo {
    const bytes = Buffer.from(content, "utf8");
    const hash = sha256Hex(content);
    const ref = BlobStore.refFor(hash);
    const target = this.#path(ref);

    if (existsSync(target) && this.#verify(target, hash)) {
      return { ref, hash, sizeBytes: bytes.length };
    }

    const dir = join(this.root, hash.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    const temp = join(dir, `.tmp-${hash.slice(0, 8)}-${randomBytes(6).toString("hex")}`);
    try {
      const fd = openSync(temp, "wx");
      try {
        let offset = 0;
        while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      try {
        renameSync(temp, target);
      } catch (error) {
        // Another writer may have stored the same content concurrently (Windows: EPERM/EEXIST).
        if (!(existsSync(target) && this.#verify(target, hash))) throw error;
      }
      syncDirectory(dir);
    } catch (error) {
      rmSync(temp, { force: true });
      throw new AgentContextError(
        "STORAGE_ERROR",
        "Could not write blob",
        { ref },
        { cause: error },
      );
    } finally {
      rmSync(temp, { force: true });
    }

    if (!this.#verify(target, hash)) {
      throw new AgentContextError("INTEGRITY_ERROR", "Blob failed verification after write", {
        ref,
      });
    }
    return { ref, hash, sizeBytes: bytes.length };
  }

  /** Read and verify a blob. Throws NOT_FOUND or INTEGRITY_ERROR. */
  get(ref: string): string {
    const hash = hashOf(ref);
    const path = this.#path(ref);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      throw new AgentContextError("NOT_FOUND", "Blob not found", { ref }, { cause: error });
    }
    const content = bytes.toString("utf8");
    if (sha256Hex(content) !== hash || !Buffer.from(content, "utf8").equals(bytes)) {
      throw new AgentContextError("INTEGRITY_ERROR", "Blob content does not match its hash", {
        ref,
      });
    }
    return content;
  }

  has(ref: string): boolean {
    return existsSync(this.#path(ref));
  }

  /** Delete a blob; returns the number of bytes freed (0 if it did not exist). */
  delete(ref: string): number {
    const path = this.#path(ref);
    try {
      const size = statSync(path).size;
      unlinkSync(path);
      return size;
    } catch {
      return 0;
    }
  }

  /** All stored blob refs and leftover temp files (for cleanup). */
  list(): { refs: { ref: string; sizeBytes: number; modifiedAt: Date }[]; temps: string[] } {
    const refs: { ref: string; sizeBytes: number; modifiedAt: Date }[] = [];
    const temps: string[] = [];
    for (const prefix of safeReaddir(this.root)) {
      if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
      for (const name of safeReaddir(join(this.root, prefix))) {
        const path = join(this.root, prefix, name);
        if (name.startsWith(".tmp-")) {
          temps.push(path);
        } else if (HASH.test(name) && name.startsWith(prefix)) {
          const stat = statSync(path);
          refs.push({ ref: `${prefix}/${name}`, sizeBytes: stat.size, modifiedAt: stat.mtime });
        }
      }
    }
    return { refs, temps };
  }

  #path(ref: string): string {
    hashOf(ref);
    return join(this.root, ...ref.split("/"));
  }

  #verify(path: string, hash: string): boolean {
    try {
      const bytes = readFileSync(path);
      const content = bytes.toString("utf8");
      return sha256Hex(content) === hash && Buffer.from(content, "utf8").equals(bytes);
    } catch {
      return false;
    }
  }
}

function hashOf(ref: string): string {
  const match = /^([0-9a-f]{2})\/([0-9a-f]{64})$/.exec(ref);
  if (!match?.[2]?.startsWith(match[1] as string)) {
    throw new AgentContextError("INTEGRITY_ERROR", "Invalid blob reference", { ref });
  }
  return match[2];
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** fsync a directory so the rename is durable. Not supported on Windows (no-op). */
function syncDirectory(dir: string): void {
  if (process.platform === "win32") return;
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch {
    // best effort: some filesystems do not support directory fsync
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

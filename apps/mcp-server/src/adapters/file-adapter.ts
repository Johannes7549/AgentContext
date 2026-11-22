import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { AgentContextError, type ContentType } from "@agentcontext/shared";

export interface FileAdapterOptions {
  allowedRoots: readonly string[];
  maxFileBytes: number;
  platform?: NodeJS.Platform;
}

export interface FileReadResult {
  /** Real (symlink-resolved) absolute path. */
  path: string;
  /** Path relative to the allowed root that contains it, with "/" separators. */
  displayPath: string;
  content: string;
  sizeBytes: number;
  contentType: ContentType;
}

/** Reserved device names; Windows ignores the extension and trailing spaces of the stem. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;
const BINARY_SNIFF_BYTES = 8 * 1024;

const EXTENSION_TYPES: Record<string, ContentType> = {
  ".json": "json",
  ".jsonl": "logs",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".log": "logs",
  ".txt": "text",
  ".diff": "code",
  ".patch": "code",
};
const CODE_EXTENSIONS = new Set(
  ".ts .tsx .mts .cts .js .jsx .mjs .cjs .py .go .rs .java .kt .kts .scala .c .h .cc .cpp .hpp .cs .rb .php .swift .m .sh .bash .zsh .ps1 .sql .lua .r .dart .ex .exs .erl .hs .ml .clj .vue .svelte .css .scss .less .html .xml .yaml .yml .toml .ini .gradle .tf .proto".split(
    " ",
  ),
);

/**
 * Sandboxed, read-only file access (ARCHITECTURE.md §9).
 *
 * A path is accepted only if, after resolving symlinks and Windows junctions,
 * it lies inside one of the (also resolved) allowed roots. UNC and device
 * paths, NTFS alternate data streams, reserved device names and NUL bytes are
 * rejected before touching the filesystem. Only regular files up to
 * `maxFileBytes` are read, and only if they are valid UTF-8 text.
 */
export class FileAdapter {
  readonly #roots: { lexical: string; real: string }[];
  readonly #maxFileBytes: number;
  readonly #windows: boolean;

  constructor(options: FileAdapterOptions) {
    if (options.allowedRoots.length === 0) {
      throw new AgentContextError("INVALID_INPUT", "At least one allowed root is required");
    }
    this.#windows = (options.platform ?? process.platform) === "win32";
    this.#maxFileBytes = options.maxFileBytes;
    this.#roots = options.allowedRoots.map((root) => {
      const lexical = resolve(root);
      let real: string;
      try {
        real = realpathSync.native(lexical);
      } catch (error) {
        throw new AgentContextError(
          "INVALID_INPUT",
          "Allowed root does not exist",
          { root: lexical },
          { cause: error },
        );
      }
      return { lexical, real };
    });
  }

  /** Resolve and authorize a requested path. Throws PATH_NOT_ALLOWED / NOT_FOUND. */
  resolvePath(requested: string): { path: string; displayPath: string } {
    this.#checkSyntax(requested);
    const base = (this.#roots[0] as { lexical: string }).lexical;
    const lexical = isAbsolute(requested) ? resolve(requested) : resolve(base, requested);
    if (
      !this.#roots.some(
        (root) => this.#inside(root.lexical, lexical) || this.#inside(root.real, lexical),
      )
    ) {
      throw notAllowed();
    }
    let real: string;
    try {
      real = realpathSync.native(lexical);
    } catch {
      throw new AgentContextError("NOT_FOUND", "File not found");
    }
    const root = this.#roots.find((r) => this.#inside(r.real, real));
    if (!root) throw notAllowed();
    const displayPath = relative(root.real, real).split(sep).join("/") || basename(real);
    return { path: real, displayPath };
  }

  read(requested: string): FileReadResult {
    const { path, displayPath } = this.resolvePath(requested);
    const stat = statSync(path);
    if (!stat.isFile()) throw new AgentContextError("INVALID_INPUT", "Path is not a regular file");
    if (stat.size > this.#maxFileBytes) {
      throw new AgentContextError("INPUT_TOO_LARGE", "File exceeds the configured size limit", {
        sizeBytes: stat.size,
        maxFileBytes: this.#maxFileBytes,
      });
    }
    const bytes = readBounded(path, stat.size);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      throw new AgentContextError("BINARY_FILE", "File appears to be binary");
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new AgentContextError("BINARY_FILE", "File is not valid UTF-8 text");
    }
    return {
      path,
      displayPath,
      content,
      sizeBytes: bytes.length,
      contentType: contentTypeFor(path),
    };
  }

  #checkSyntax(requested: string): void {
    if (requested.length === 0 || requested.length > 4096) throw notAllowed();
    if (requested.includes("\0")) throw notAllowed();
    if (!this.#windows) return;
    const normalized = requested.replace(/\//g, "\\");
    if (normalized.startsWith("\\\\")) throw notAllowed(); // UNC, \\?\ and \\.\ device paths
    const withoutDrive = /^[a-zA-Z]:/.test(normalized) ? normalized.slice(2) : normalized;
    if (withoutDrive.includes(":")) throw notAllowed(); // alternate data streams
    for (const part of normalized.split("\\")) {
      const stem = (part.split(".")[0] ?? "").replace(/[ ]+$/, "");
      if (WINDOWS_DEVICE.test(stem)) throw notAllowed();
    }
  }

  #inside(root: string, candidate: string): boolean {
    const a = this.#windows ? root.toLowerCase() : root;
    const b = this.#windows ? candidate.toLowerCase() : candidate;
    const rel = (this.#windows ? win32.relative : relative)(a, b);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }
}

export function contentTypeFor(path: string): ContentType {
  const ext = extname(path).toLowerCase();
  if (EXTENSION_TYPES[ext]) return EXTENSION_TYPES[ext];
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "unknown";
}

function notAllowed(): AgentContextError {
  return new AgentContextError(
    "PATH_NOT_ALLOWED",
    "Path is outside the allowed roots or not permitted",
  );
}

/** Read at most `size` bytes (the size checked earlier), so a growing file cannot exceed the limit. */
function readBounded(path: string, size: number): Buffer {
  const buffer = Buffer.alloc(size);
  const fd = openSync(path, "r");
  try {
    let offset = 0;
    while (offset < size) {
      const read = readSync(fd, buffer, offset, size - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

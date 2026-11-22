import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, delimiter, extname, isAbsolute, join } from "node:path";
import { AgentContextError } from "@agentcontext/shared";
import type { FileAdapter } from "./file-adapter.js";

export interface CommandAdapterOptions {
  enabled: boolean;
  /** Executable names (looked up on PATH) or absolute paths that may be run. */
  allowlist: readonly string[];
  /** Used to confine the working directory to the allowed roots. */
  files: FileAdapter;
  timeoutMs: number;
  maxOutputBytes: number;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface CommandRequest {
  command: string;
  args?: readonly string[];
  /** Directory inside an allowed root; defaults to the first root. */
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  /** Output exceeded maxOutputBytes; the process was stopped and output cut. */
  truncated: boolean;
  durationMs: number;
}

/** Environment variables passed to commands (everything else is dropped). */
const ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LANGUAGE",
  "TZ",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "TERM",
  "NO_COLOR",
  "CI",
];
const SECRET_ENV = /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE|CREDENTIAL|AUTH/i;
const SHELL_SCRIPT_EXT = new Set([".cmd", ".bat", ".ps1", ".vbs", ".js", ".wsf"]);
const MAX_ARGS = 200;
const MAX_ARG_LENGTH = 8 * 1024;

/**
 * Opt-in command execution (ARCHITECTURE.md §9, ADR-0010).
 *
 * - Disabled unless `enabled` is true.
 * - Only executables on the allowlist (exact name or absolute path) run, via
 *   `shell: false` with an argument array — no shell interpolation.
 * - Windows script shims (.cmd/.bat/...) are refused: they cannot be started
 *   without a shell, which would re-introduce command injection.
 * - The working directory must be inside an allowed root.
 * - Environment is reduced to a small allowlist with secret-looking names removed.
 * - Timeout, output cap and cancellation kill the whole process tree.
 * - Commands run with the user's operating-system permissions.
 */
export class CommandAdapter {
  readonly #options: CommandAdapterOptions;
  readonly #windows: boolean;

  constructor(options: CommandAdapterOptions) {
    this.#options = options;
    this.#windows = (options.platform ?? process.platform) === "win32";
  }

  get enabled(): boolean {
    return this.#options.enabled;
  }

  /** Resolve an allowlisted command to an executable path, or throw COMMAND_NOT_ALLOWED. */
  resolveExecutable(command: string): string {
    const shellLike = /[\s"'`$|&;<>(){}*?]/.test(command) && !isAbsolute(command);
    if (!command || command.includes("\0") || shellLike) throw notAllowed();
    const same = (a: string, b: string) =>
      this.#windows ? a.toLowerCase() === b.toLowerCase() : a === b;
    const entry = this.#options.allowlist.find((allowed) => same(allowed, command));
    if (!entry) throw notAllowed();

    const resolved = isAbsolute(entry) ? entry : this.#searchPath(entry);
    if (!resolved || !existsSync(resolved) || !statSync(resolved).isFile()) {
      throw new AgentContextError("NOT_FOUND", "Allowlisted command was not found", {
        command: basename(command),
      });
    }
    if (SHELL_SCRIPT_EXT.has(extname(resolved).toLowerCase()) && this.#windows) {
      throw new AgentContextError(
        "COMMAND_NOT_ALLOWED",
        "Windows script shims (.cmd/.bat/.ps1) cannot run without a shell and are refused; allowlist the real executable (for example node.exe) instead",
        { command: basename(command) },
      );
    }
    if ([".cmd", ".bat"].includes(extname(resolved).toLowerCase())) {
      throw new AgentContextError("COMMAND_NOT_ALLOWED", "Batch scripts are refused", {
        command: basename(command),
      });
    }
    return resolved;
  }

  async run(request: CommandRequest): Promise<CommandResult> {
    if (!this.#options.enabled) {
      throw new AgentContextError(
        "COMMAND_DISABLED",
        "Command execution is disabled in the configuration",
      );
    }
    const executable = this.resolveExecutable(request.command);
    const args = [...(request.args ?? [])];
    if (args.length > MAX_ARGS || args.some((a) => a.length > MAX_ARG_LENGTH || a.includes("\0"))) {
      throw new AgentContextError("INVALID_INPUT", "Too many or invalid command arguments");
    }
    const cwd = this.#resolveCwd(request.cwd);
    const timeoutMs = Math.min(
      request.timeoutMs ?? this.#options.timeoutMs,
      this.#options.timeoutMs,
    );
    const started = performance.now();

    return await new Promise<CommandResult>((resolvePromise, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(executable, args, {
          cwd,
          env: filterEnv(this.#options.env ?? process.env),
          shell: false,
          windowsHide: true,
          detached: !this.#windows,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(
          new AgentContextError("INTERNAL", "Could not start the command", undefined, {
            cause: error,
          }),
        );
        return;
      }

      const max = this.#options.maxOutputBytes;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let total = 0;
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const kill = () => killTree(child, this.#windows);
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        if (truncated) return;
        const room = max - total;
        if (chunk.length > room) {
          target.push(chunk.subarray(0, Math.max(0, room)));
          total = max;
          truncated = true;
          kill();
          return;
        }
        target.push(chunk);
        total += chunk.length;
      };
      child.stdout?.on("data", collect(stdout));
      child.stderr?.on("data", collect(stderr));

      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);
      const onAbort = () => {
        cancelled = true;
        kill();
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) onAbort();

      const finish = (exitCode: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        resolvePromise({
          command: basename(request.command),
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          timedOut,
          cancelled,
          truncated,
          durationMs: Math.round(performance.now() - started),
        });
      };
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new AgentContextError("INTERNAL", "Command failed to start", undefined, { cause: error }),
        );
      });
      child.on("close", (code, signal) => finish(code, signal));
    });
  }

  #resolveCwd(cwd: string | undefined): string {
    const { path } = this.#options.files.resolvePath(cwd ?? ".");
    if (!statSync(path).isDirectory()) {
      throw new AgentContextError("INVALID_INPUT", "Working directory is not a directory");
    }
    return path;
  }

  #searchPath(name: string): string | undefined {
    const env = this.#options.env ?? process.env;
    const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
    const exts = this.#windows
      ? extname(name)
        ? [""]
        : (env.PATHEXT ?? ".COM;.EXE")
            .split(";")
            .filter(Boolean)
            .map((e) => e.toLowerCase())
      : [""];
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, name + ext);
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      }
    }
    return undefined;
  }
}

export function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    const allowed = ENV_ALLOWLIST.includes(upper) || upper.startsWith("LC_");
    if (allowed && !SECRET_ENV.test(upper)) out[key] = value;
  }
  return out;
}

function killTree(child: ChildProcess, windows: boolean): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (windows) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already exited
    }
  }
}

function notAllowed(): AgentContextError {
  return new AgentContextError("COMMAND_NOT_ALLOWED", "Command is not on the allowlist");
}

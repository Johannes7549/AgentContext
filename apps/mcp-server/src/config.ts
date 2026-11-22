import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { AgentContextError, sha256Hex } from "@agentcontext/shared";
import * as z from "zod";

/**
 * Server configuration (ARCHITECTURE.md §10). Sources, lowest to highest
 * precedence: built-in defaults → JSON config file → environment variables.
 * The config file is given by `--config <path>` or AGENTCONTEXT_CONFIG.
 */
export const ConfigSchema = z.strictObject({
  storageDir: z.string().min(1),
  workspaceId: z.string().min(1).max(200),
  retrievalScope: z.enum(["session", "workspace"]),
  ttlHours: z
    .number()
    .positive()
    .max(24 * 365),
  quotaMb: z.number().positive(),
  maxInputBytes: z.number().int().positive(),
  minOptimizeTokens: z.number().int().nonnegative(),
  minBenefitTokens: z.number().int().nonnegative(),
  storageFailurePolicy: z.enum(["return_original", "non_recoverable"]),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  files: z.strictObject({
    allowedRoots: z.array(z.string().min(1)).min(1),
    maxFileBytes: z.number().int().positive(),
  }),
  commands: z.strictObject({
    enabled: z.boolean(),
    allowlist: z.array(z.string().min(1)),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(30 * 60 * 1000),
    maxOutputBytes: z.number().int().positive(),
  }),
});
export type ServerConfig = z.infer<typeof ConfigSchema>;

/** Partial config accepted from a file (same shape, every key optional). */
const FileConfigSchema = z
  .strictObject({
    ...ConfigSchema.shape,
    files: ConfigSchema.shape.files.partial(),
    commands: ConfigSchema.shape.commands.partial(),
  })
  .partial();

export interface ConfigSources {
  env?: NodeJS.ProcessEnv;
  argv?: readonly string[];
  cwd?: string;
  platform?: NodeJS.Platform;
  home?: string;
}

export function defaultStorageDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === "win32")
    return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "agentcontext");
  if (platform === "darwin") return join(home, "Library", "Application Support", "agentcontext");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "agentcontext");
}

export function defaultConfig(sources: ConfigSources = {}): ServerConfig {
  const cwd = resolve(sources.cwd ?? process.cwd());
  return {
    storageDir: defaultStorageDir(sources.env ?? process.env, sources.platform, sources.home),
    workspaceId: `ws_${sha256Hex(cwd).slice(0, 16)}`,
    retrievalScope: "session",
    ttlHours: 168,
    quotaMb: 500,
    // Below the MCP stdio transport's 10 MB message limit, so oversized input gets a clean INPUT_TOO_LARGE.
    maxInputBytes: 8 * 1024 * 1024,
    minOptimizeTokens: 500,
    minBenefitTokens: 50,
    storageFailurePolicy: "return_original",
    logLevel: "info",
    files: { allowedRoots: [cwd], maxFileBytes: 10 * 1024 * 1024 },
    commands: { enabled: false, allowlist: [], timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 },
  };
}

/** Load and validate configuration. Throws INVALID_INPUT with issue paths on failure. */
export function loadConfig(sources: ConfigSources = {}): ServerConfig {
  const env = sources.env ?? process.env;
  const argv = sources.argv ?? process.argv.slice(2);
  const cwd = resolve(sources.cwd ?? process.cwd());
  const base = defaultConfig({ ...sources, cwd });

  const configPath = argValue(argv, "--config") ?? env.AGENTCONTEXT_CONFIG;
  const file = configPath ? readConfigFile(resolve(cwd, configPath)) : {};
  const merged: Record<string, unknown> = {
    ...base,
    ...file,
    files: { ...base.files, ...(file.files ?? {}) },
    commands: { ...base.commands, ...(file.commands ?? {}) },
  };
  applyEnv(merged, env);

  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new AgentContextError("INVALID_INPUT", "Invalid AgentContext configuration", {
      issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  const config = parsed.data;
  config.storageDir = resolve(cwd, config.storageDir);
  config.files.allowedRoots = config.files.allowedRoots.map((root) =>
    isAbsolute(root) ? resolve(root) : resolve(cwd, root),
  );
  return config;
}

function readConfigFile(path: string): z.infer<typeof FileConfigSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new AgentContextError(
      "INVALID_INPUT",
      "Could not read the configuration file",
      { path },
      { cause: error },
    );
  }
  const parsed = FileConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentContextError("INVALID_INPUT", "Invalid configuration file", {
      path,
      issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  return parsed.data;
}

function applyEnv(target: Record<string, unknown>, env: NodeJS.ProcessEnv): void {
  const files = target.files as Record<string, unknown>;
  const commands = target.commands as Record<string, unknown>;
  const set = (name: string, apply: (value: string) => void) => {
    const value = env[name];
    if (value !== undefined && value !== "") apply(value);
  };
  set("AGENTCONTEXT_STORAGE_DIR", (v) => (target.storageDir = v));
  set("AGENTCONTEXT_WORKSPACE_ID", (v) => (target.workspaceId = v));
  set("AGENTCONTEXT_RETRIEVAL_SCOPE", (v) => (target.retrievalScope = v));
  set("AGENTCONTEXT_TTL_HOURS", (v) => (target.ttlHours = Number(v)));
  set("AGENTCONTEXT_QUOTA_MB", (v) => (target.quotaMb = Number(v)));
  set("AGENTCONTEXT_MAX_INPUT_BYTES", (v) => (target.maxInputBytes = Number(v)));
  set("AGENTCONTEXT_LOG_LEVEL", (v) => (target.logLevel = v));
  set(
    "AGENTCONTEXT_ALLOWED_ROOTS",
    (v) => (files.allowedRoots = v.split(delimiter).filter(Boolean)),
  );
  set(
    "AGENTCONTEXT_COMMANDS_ENABLED",
    (v) => (commands.enabled = v === "1" || v.toLowerCase() === "true"),
  );
  set(
    "AGENTCONTEXT_COMMAND_ALLOWLIST",
    (v) =>
      (commands.allowlist = v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)),
  );
}

function argValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index !== -1) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1);
}

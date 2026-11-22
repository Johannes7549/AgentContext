import { CompressionOptionsSchema } from "@agentcontext/shared";
import * as z from "zod";
import { CommandAdapter, type CommandResult } from "../adapters/command-adapter.js";
import { FileAdapter } from "../adapters/file-adapter.js";
import type { Registrar } from "../server.js";
import { formatOptimizeResult, OptimizeOutputSchema } from "./optimize-context.js";
import { type ToolResult, toolError } from "./results.js";

export const EXECUTE_COMMAND_DESCRIPTION =
  "Run an allowlisted command (no shell; arguments passed as an array) in a project directory and return its " +
  "output optimized, with omitted parts recoverable via retrieve_context. Only enabled when configured.";

const InputSchema = z.object({
  command: z.string().min(1).describe('Allowlisted executable, e.g. "git" or "node".'),
  args: z
    .array(z.string())
    .max(200)
    .optional()
    .describe("Arguments, passed literally (no shell expansion)."),
  cwd: z
    .string()
    .optional()
    .describe("Working directory inside an allowed root (default: first root)."),
  timeoutMs: z.number().int().positive().optional(),
  options: CompressionOptionsSchema.optional(),
});

const OutputSchema = OptimizeOutputSchema.extend({
  command: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  cancelled: z.boolean(),
  outputTruncated: z.boolean(),
  durationMs: z.number(),
});

/** Registered only when commands are enabled (disabled by default). */
export const registerExecuteCommand: Registrar = (server, runtime) => {
  const { commands, files } = runtime.config;
  if (!commands.enabled) return;
  const adapter = new CommandAdapter({
    enabled: true,
    allowlist: commands.allowlist,
    files: new FileAdapter({ allowedRoots: files.allowedRoots, maxFileBytes: files.maxFileBytes }),
    timeoutMs: commands.timeoutMs,
    maxOutputBytes: commands.maxOutputBytes,
  });

  server.registerTool(
    "execute_command",
    {
      title: "Execute command",
      description: EXECUTE_COMMAND_DESCRIPTION,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false,
      },
    },
    async (args, ctx): Promise<ToolResult> => {
      try {
        const signal = (ctx as { signal?: AbortSignal } | undefined)?.signal;
        const result = await adapter.run({
          command: args.command,
          ...(args.args ? { args: args.args } : {}),
          ...(args.cwd ? { cwd: args.cwd } : {}),
          ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
          ...(signal ? { signal } : {}),
        });
        const optimized = await runtime.engine.optimize(
          { content: commandTranscript(result), source: `command:${result.command}` },
          args.options ?? {},
          runtime.scope,
        );
        const formatted = formatOptimizeResult(optimized);
        const status = statusLine(result);
        return {
          content: [{ type: "text", text: `${status}\n${formatted.content[0]?.text ?? ""}` }],
          structuredContent: {
            ...formatted.structuredContent,
            command: result.command,
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
            cancelled: result.cancelled,
            outputTruncated: result.truncated,
            durationMs: result.durationMs,
          },
        };
      } catch (error) {
        return toolError(error, runtime, "execute_command");
      }
    },
  );
};

/** Text that is optimized and stored: stdout, then stderr (when present). */
export function commandTranscript(result: CommandResult): string {
  if (!result.stderr) return result.stdout;
  if (!result.stdout) return result.stderr;
  return `${result.stdout}${result.stdout.endsWith("\n") ? "" : "\n"}--- stderr ---\n${result.stderr}`;
}

function statusLine(result: CommandResult): string {
  const parts = [
    `exit ${result.exitCode ?? result.signal ?? "unknown"}`,
    `${result.durationMs} ms`,
  ];
  if (result.timedOut) parts.push("TIMED OUT (process tree killed)");
  if (result.cancelled) parts.push("CANCELLED");
  if (result.truncated) parts.push("OUTPUT TRUNCATED at the configured limit (process stopped)");
  return `[${result.command}: ${parts.join(", ")}]`;
}

# Configuration

AgentContext works without configuration. Settings come from, in increasing
precedence:

1. built-in defaults,
2. a JSON config file given by `--config <path>` or `AGENTCONTEXT_CONFIG`,
3. `AGENTCONTEXT_*` environment variables.

Invalid values or unknown keys stop the server at startup with a message on
stderr listing the problems.

## Settings

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `storageDir` | `AGENTCONTEXT_STORAGE_DIR` | Windows: `%LOCALAPPDATA%\agentcontext`; macOS: `~/Library/Application Support/agentcontext`; Linux: `$XDG_DATA_HOME/agentcontext` or `~/.local/share/agentcontext` | Where originals and metadata are stored |
| `workspaceId` | `AGENTCONTEXT_WORKSPACE_ID` | derived from the working directory | Isolates projects that share a storage directory |
| `retrievalScope` | `AGENTCONTEXT_RETRIEVAL_SCOPE` | `session` | `session`: only this server session can retrieve its contexts; `workspace`: any session of the same workspace (e.g. after a restart) |
| `ttlHours` | `AGENTCONTEXT_TTL_HOURS` | `168` (7 days) | How long originals are kept |
| `quotaMb` | `AGENTCONTEXT_QUOTA_MB` | `500` | Maximum total size of stored originals; oldest are evicted first |
| `maxInputBytes` | `AGENTCONTEXT_MAX_INPUT_BYTES` | `8388608` (8 MiB) | Largest single input accepted |
| `minOptimizeTokens` | — | `500` | Smaller inputs are returned unchanged (unless a selection or strategy is given) |
| `minBenefitTokens` | — | `50` | Minimum estimated saving before a strategy is used |
| `storageFailurePolicy` | — | `return_original` | If storing fails: return the original, or `non_recoverable` (return the optimized output marked not recoverable) |
| `logLevel` | `AGENTCONTEXT_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` (logs go to stderr, never content) |
| `files.allowedRoots` | `AGENTCONTEXT_ALLOWED_ROOTS` (path-delimiter separated) | the working directory | Directories `read_file` and `execute_command` may use |
| `files.maxFileBytes` | — | `10485760` (10 MiB) | Largest file `read_file` reads |
| `commands.enabled` | `AGENTCONTEXT_COMMANDS_ENABLED` (`true`/`1`) | `false` | Registers the `execute_command` tool |
| `commands.allowlist` | `AGENTCONTEXT_COMMAND_ALLOWLIST` (comma separated) | empty | Executables that may run (names on PATH or absolute paths) |
| `commands.timeoutMs` | — | `30000` | Maximum run time; the process tree is killed after it |
| `commands.maxOutputBytes` | — | `1048576` (1 MiB) | Output cap; the process is stopped when exceeded |

Relative paths in `storageDir` and `files.allowedRoots` are resolved against
the server's working directory.

## Example config file

```json
{
  "retrievalScope": "workspace",
  "ttlHours": 24,
  "quotaMb": 200,
  "files": { "allowedRoots": [".", "../shared-docs"] },
  "commands": { "enabled": true, "allowlist": ["git"], "timeoutMs": 60000 }
}
```

```sh
node apps/mcp-server/dist/cli.js --config ./agentcontext.json
```

## Enabling commands safely

`execute_command` is off by default. When you enable it:

- allowlist only the executables you need (for example `git`);
- on Windows, script shims such as `npm.cmd` or `pnpm.cmd` are refused because
  they cannot run without a shell — allowlist the real executable instead
  (see [ADR-0010](decisions/0010-command-adapter-no-shell.md));
- commands run with your operating-system permissions, inside the allowed
  roots only, with a filtered environment and a timeout.

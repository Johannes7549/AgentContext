# Claude Code integration

## Add the server

User-wide (available in every project):

```sh
claude mcp add agentcontext -- npx -y @agentcontext/mcp-server
```

Project-wide, shared with your team through a committed `.mcp.json`:

```sh
claude mcp add --scope project agentcontext -- npx -y @agentcontext/mcp-server
```

which writes:

```json
{
  "mcpServers": {
    "agentcontext": {
      "command": "npx",
      "args": ["-y", "@agentcontext/mcp-server"],
      "env": {
        "AGENTCONTEXT_RETRIEVAL_SCOPE": "workspace"
      }
    }
  }
}
```

On **Windows**, `npx` is a script shim; run it through `cmd /c`:

```json
{ "command": "cmd", "args": ["/c", "npx", "-y", "@agentcontext/mcp-server"] }
```

From a source checkout (before the npm release), point at the built CLI:

```sh
claude mcp add agentcontext -- node /absolute/path/to/AgentContext/apps/mcp-server/dist/cli.js
```

A ready-to-copy configuration is in
[`examples/claude-code`](../../examples/claude-code/).

## Tell Claude when to use it

Add guidance to your project's `CLAUDE.md`, for example:

```markdown
When a command or tool produces long output (test runs, builds, large JSON,
long files), pass it through the agentcontext `optimize_context` tool, or use
its `read_file` tool for large files. Use `retrieve_context` with the
contextId when you need an omitted part.
```

The `agentcontext_guidelines` prompt contains the full usage rules.

## Verify

```sh
claude mcp list                 # agentcontext should be listed and connected
```

Then ask Claude to call `get_optimization_stats`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Server fails to start, "invalid configuration" on stderr | An `AGENTCONTEXT_*` variable or config file key is invalid; the message lists the problem keys. |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` or engine error | Node.js older than 22.13. Upgrade Node. |
| Windows: server not found / `spawn npx ENOENT` | Use `cmd /c npx …` as shown above. |
| `NOT_FOUND` when retrieving after restarting Claude Code | Retrieval is session-scoped by default. Set `AGENTCONTEXT_RETRIEVAL_SCOPE=workspace` to allow later sessions of the same project. |
| `PATH_NOT_ALLOWED` from `read_file` | The file is outside the allowed roots (the directory Claude Code started the server in). Add roots with `AGENTCONTEXT_ALLOWED_ROOTS`. |
| `execute_command` missing | Commands are disabled by default; set `AGENTCONTEXT_COMMANDS_ENABLED=true` and an allowlist. |
| `COMMAND_NOT_ALLOWED` for `npm`/`pnpm` on Windows | Script shims are refused (no shell). Allowlist `node` and run the tool's JS entry point, or run the command yourself and use `optimize_context`. |
| Output unchanged with no footer | The content was small (under 500 estimated tokens) or nothing could be omitted safely; this is expected. |
| Need more detail | Set `AGENTCONTEXT_LOG_LEVEL=debug`; logs go to Claude Code's MCP log (stderr) and never include content. |

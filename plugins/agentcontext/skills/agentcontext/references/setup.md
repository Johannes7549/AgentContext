# Setting up the AgentContext MCP server

The skill needs the AgentContext MCP server (npm package
`@agentcontext/mcp-server`, Node.js 22.13 or later). Tell the user how to
connect it if the tools are missing.

## Claude Code

Recommended — the plugin installs the server and this skill together:

```text
/plugin marketplace add Johannes7549/AgentContext
/plugin install agentcontext@agentcontext
```

Server only:

```sh
claude mcp add agentcontext -- npx -y @agentcontext/mcp-server
# Windows
claude mcp add agentcontext -- cmd /c npx -y @agentcontext/mcp-server
```

## Other MCP clients (Cursor, VS Code / Copilot, Codex, …)

Add a stdio server with command `npx` and arguments
`-y @agentcontext/mcp-server` (on Windows: command `cmd`, arguments
`/c npx -y @agentcontext/mcp-server`). Consult the client's MCP documentation for
where the configuration lives.

## Useful settings (environment variables)

| Variable | Effect |
|---|---|
| `AGENTCONTEXT_RETRIEVAL_SCOPE=workspace` | Recover content stored earlier in the same project after a restart |
| `AGENTCONTEXT_ALLOWED_ROOTS` | Extra directories `read_file` may read (path-separator separated) |
| `AGENTCONTEXT_COMMANDS_ENABLED=true` + `AGENTCONTEXT_COMMAND_ALLOWLIST=git` | Enable `execute_command` for listed executables |
| `AGENTCONTEXT_LOG_LEVEL=debug` | More detail in the server log (never includes content) |

## Common problems

| Symptom | Fix |
|---|---|
| Tools missing | Server not connected or failed to start; check the client's MCP status (`/mcp` in Claude Code) |
| `node:sqlite` / engine error | Upgrade Node.js to 22.13 or later |
| `NOT_FOUND` after restarting | Set `AGENTCONTEXT_RETRIEVAL_SCOPE=workspace` |
| `PATH_NOT_ALLOWED` | The file is outside the allowed roots; add the directory to `AGENTCONTEXT_ALLOWED_ROOTS` |

Full documentation: https://github.com/Johannes7549/AgentContext

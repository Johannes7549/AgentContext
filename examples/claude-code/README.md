# Claude Code example

Copy these files into your project:

| File | Purpose |
|---|---|
| `.mcp.json` | Project MCP configuration (macOS / Linux) |
| `.mcp.windows.json` | Same for Windows — rename to `.mcp.json` (`npx` must run through `cmd /c`) |
| `CLAUDE.md` | Instructions telling Claude when to use AgentContext (append to your own `CLAUDE.md`) |

Or add the server with the CLI instead of copying `.mcp.json`:

```sh
claude mcp add --scope project agentcontext -- npx -y @agentcontext/mcp-server
```

Before the npm release, point at a source checkout instead:

```json
{ "command": "node", "args": ["/absolute/path/to/AgentContext/apps/mcp-server/dist/cli.js"] }
```

`AGENTCONTEXT_RETRIEVAL_SCOPE=workspace` lets Claude recover content stored
earlier in the same project after a restart. All settings:
[configuration reference](../../docs/configuration.md). Troubleshooting:
[Claude Code integration](../../docs/integrations/claude-code.md).

These files are validated by `tests/e2e/examples.test.ts`, which also starts
the server with the same environment and checks that the tools are available.

# Examples

Run `pnpm install && pnpm build` first.

| Example | What it shows | Run |
|---|---|---|
| [`claude-code/`](claude-code/) | `.mcp.json` for macOS/Linux and Windows, and a `CLAUDE.md` snippet | copy into your project |
| [`basic-mcp-client/`](basic-mcp-client/) | An MCP client starting the server over stdio: optimize, recover a segment, read stats | `node examples/basic-mcp-client/client.mjs` |
| [`custom-agent/`](custom-agent/) | Using the engine directly (no MCP): JSON field selection, JSONPath recovery, session scope | `node examples/custom-agent/agent.mjs` |

All examples are executed by `tests/e2e/examples.test.ts`, so they stay in
sync with the code.

# Getting started

AgentContext is a local MCP server. Your agent calls its tools instead of
pasting large outputs into the conversation; AgentContext returns a smaller,
structured version and keeps the original on your machine so any omitted part
can be recovered exactly.

No API key, account or network access is needed.

## Requirements

- Node.js **22.13 or later** (AgentContext uses the built-in `node:sqlite`)
- An MCP client such as Claude Code

## Install

From npm (after the v0.1.0 release):

```sh
npx -y @agentcontext/mcp-server --help   # nothing to install globally; npx fetches it
```

From source (now):

```sh
git clone https://github.com/Johannes7549/AgentContext.git
cd AgentContext
pnpm install
pnpm build
# the server is apps/mcp-server/dist/cli.js
```

## Connect Claude Code

```sh
# published package
claude mcp add agentcontext -- npx -y @agentcontext/mcp-server

# from source (use the absolute path to your checkout)
claude mcp add agentcontext -- node /path/to/AgentContext/apps/mcp-server/dist/cli.js
```

On Windows, wrap `npx` with `cmd /c`:

```sh
claude mcp add agentcontext -- cmd /c npx -y @agentcontext/mcp-server
```

See [Claude Code integration](../integrations/claude-code.md) for project-level
configuration (`.mcp.json`), environment variables and troubleshooting.

## First use

Ask your agent to run something noisy and pass the output through AgentContext,
for example:

> Run the test suite, then call `optimize_context` on the output and tell me
> which tests failed and why.

A result for a 1,000-line test run looks like this (abridged real output from
the `terminal-large` benchmark):

```text
2026-11-23T10:00:00Z INFO [db] pool size=10 idle=8
[... s1: repeated 719 more times (lines 7-11, 14-19, 22-27, ... (+117 more))]
2026-11-23T10:00:06Z INFO [http] GET /health 200 2ms
[... s2: repeated 119 more times (lines 20, 28, 37, ... (+116 more))]
 ✓ src/module001.test.ts (11 tests) 10ms
...
 FAIL  src/billing/invoice.test.ts > computes totals with tax
AssertionError: expected 118.5 to be 118.05 // Object.is equality
    at src/billing/invoice.test.ts:42:19
...
---
[agentcontext] log-compressor: 2734/22049 tokens (estimated), 87.6% saved.
Recover omitted parts (s1, s2, s3, s4) with retrieve_context {"contextId":"ctx_01M8...","selector":{"type":"segment_id","value":"<sN>"}}, or omit the selector for the full original.
```

If the agent needs something that was omitted, it calls `retrieve_context`
with the `contextId` and a segment id, a line range, a JSONPath, a keyword, or
no selector for the full original.

Check what you have saved so far with `get_optimization_stats`.

## Next steps

- [Concepts](../concepts/README.md): markers, recovery, selections and budgets
- [Tools reference](../tools.md)
- [Configuration](../configuration.md)
- [Strategies](../strategies/README.md)
- [Privacy and data handling](../security/privacy.md)
- [Limitations](../limitations.md)

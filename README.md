# AgentContext

**Reversible context optimization for AI agents.** AgentContext is a
local-first MCP server that turns oversized tool output — long test logs,
large JSON responses, whole files, diffs, repeated content — into smaller,
structured results, while keeping the original on your machine so the agent
can recover any omitted part exactly.

- **Deterministic** — no LLM calls, no API key; same input, same output.
- **Reversible** — every omission is recorded and recoverable byte-for-byte.
- **Conservative** — nothing is judged irrelevant unless you ask; when in doubt the original is returned.
- **Local** — no telemetry, no network; data stays in your user profile.
- **Measured** — token counts are labelled as estimates; benchmarks include the cost of recovery.

> Status: **v0.1.0 release candidate.** See [limitations](docs/limitations.md).

## Quick start

Requires Node.js ≥ 22.13.

```sh
# Claude Code (after the npm release)
claude mcp add agentcontext -- npx -y @agentcontext/mcp-server

# from a source checkout
pnpm install && pnpm build
claude mcp add agentcontext -- node /absolute/path/to/AgentContext/apps/mcp-server/dist/cli.js
```

Then ask your agent to pass long outputs through `optimize_context`, or to read
large files with `read_file`. Full guide: [Getting started](docs/getting-started/README.md).

## What it looks like

Real output for the `terminal-large` benchmark input (a 1,000-line test run), abridged:

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

## Tools

| Tool | Purpose |
|---|---|
| `optimize_context` | Compress text; optional selections (JSON paths, Markdown sections, line ranges, log levels) and token budgets |
| `retrieve_context` | Recover the full original, a line range, a JSONPath, keyword matches, or a segment |
| `read_file` | Read and optimize a file inside the allowed project roots |
| `execute_command` | Run an allowlisted command (no shell) and optimize its output — **disabled by default** |
| `get_optimization_stats` | Tokens saved, including what was recovered |

Plus the resources `agentcontext://stats` and
`agentcontext://context/{id}/metadata`, and the `agentcontext_guidelines`
prompt. Reference: [docs/tools.md](docs/tools.md).

## Benchmarks

On seven reproducible scenarios (test logs, API responses, duplicate-heavy
text, documentation, source code, diffs), counting recovered content:

| Median reduction | Extraction accuracy | Recovery integrity | Unrecoverable omissions |
|---|---|---|---|
| 86.6% | 100% | 100% | 0 |

Synthetic datasets, estimated tokens and a deterministic oracle — see the
[full report](benchmarks/reports/latest.md) and [methodology](docs/benchmarking/README.md).
Run them yourself with `pnpm bench`.

## Documentation

| Guide | Reference | Design |
|---|---|---|
| [Getting started](docs/getting-started/README.md) | [Tools](docs/tools.md) | [Product spec](docs/product/PRODUCT_SPEC.md) |
| [Concepts](docs/concepts/README.md) | [Configuration](docs/configuration.md) | [Architecture](docs/architecture/ARCHITECTURE.md) |
| [Strategies](docs/strategies/README.md) | [Limitations](docs/limitations.md) | [Contracts](docs/architecture/CONTRACTS.md) |
| [Claude Code](docs/integrations/claude-code.md) | [Privacy](docs/security/privacy.md) | [Decisions (ADRs)](docs/decisions/README.md) |
| [Examples](examples/) | [Security checklist](docs/security/SECURITY_CHECKLIST.md) | [Benchmarking](docs/benchmarking/README.md) |

## Development

```sh
pnpm install
pnpm check      # lint + typecheck + test + build
pnpm bench      # benchmarks and reports
```

Monorepo: `apps/mcp-server` (the only package that imports the MCP SDK),
`packages/{shared,core,strategies,tokenization,storage,retrieval,observability}`,
`benchmarks/`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE).

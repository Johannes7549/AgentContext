# AgentContext

**Reversible context optimization for AI agents.** AgentContext is a local-first,
MCP-native engine that turns oversized tool output — long logs, large JSON, whole
files, repeated content — into smaller, structured results, while keeping the
original on your machine so the agent can recover any omitted part on demand.

> **Status: pre-release (v0.1.0 in development).** Nothing is published yet and
> the APIs below are not final. See the [roadmap scope](docs/product/PRODUCT_SPEC.md).

## Why

Agents often receive far more context than they need. AgentContext reduces that
without silently losing information:

- **Deterministic-first** — no LLM calls in the default engine.
- **Reversible** — every omission is recorded and recoverable.
- **Conservative** — when in doubt, the original is returned.
- **Local-first** — no telemetry, no remote calls, no API key needed.
- **Measured** — savings are reported with the tokenizer used and whether counts are exact.

## Planned v0.1 features

| Capability | Description |
|---|---|
| JSON pruning | Explicit field selection, restricted JSONPath, array pagination |
| Log compression | Error/warning extraction, exact repeat grouping with counts and line references |
| Duplicate elimination | Exact duplicate blocks collapsed with all original locations |
| Text / Markdown | Section extraction with heading hierarchy preserved |
| Code | Line ranges and unified-diff hunk extraction |
| Recovery | Full original, line range, JSONPath, keyword, or segment ID |
| MCP server (stdio) | `optimize_context`, `read_file`, `execute_command` (opt-in), `retrieve_context`, `get_optimization_stats` |

## Development

Requirements: **Node.js ≥ 22.13** and **pnpm 10**.

```sh
pnpm install
pnpm check          # lint + typecheck + test + build
```

| Script | Purpose |
|---|---|
| `pnpm build` | Build all workspaces |
| `pnpm typecheck` | Type-check sources and tests |
| `pnpm test` | Unit tests per workspace, then integration and e2e |
| `pnpm test:coverage` | All tests with V8 coverage |
| `pnpm lint` / `pnpm lint:fix` | Biome lint and format check / fix |

## Repository layout

```
apps/mcp-server     MCP server (the only workspace that imports the MCP SDK)
packages/           shared · core · strategies · tokenization · storage · retrieval · observability
tests/              cross-package integration and e2e tests
docs/               product spec, architecture, contracts, ADRs
```

## Documentation

- [Product specification](docs/product/PRODUCT_SPEC.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Domain contracts](docs/architecture/CONTRACTS.md)
- [Architecture decision records](docs/decisions/README.md)
- [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

## License

[Apache License 2.0](LICENSE).

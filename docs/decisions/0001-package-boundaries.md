# ADR-0001: Package boundaries and MCP-independent core

- **Status:** Accepted
- **Date:** 2026-11-22
- **Task:** AC-002

## Context

The roadmap requires a framework-independent core (principle P5) so the same
engine can later back an MCP gateway (v0.2), a direct TypeScript API, and other
integrations. It proposes a pnpm/Turborepo monorepo with seven packages and one
app.

## Options

1. **Single package** with internal folders. Simple, but boundaries are not enforced and the MCP SDK would leak into the core.
2. **Monorepo with fine-grained packages** (roadmap proposal). Enforced boundaries, independent tests, more config.
3. **Two packages** (`core`, `mcp-server`). Fewer packages, but storage/tokenizers become hard to swap and test in isolation.

## Decision

Option 2:

| Package | Depends on |
|---|---|
| `@agentcontext/shared` | — (external: `zod`) |
| `@agentcontext/tokenization` | shared |
| `@agentcontext/strategies` | shared |
| `@agentcontext/storage` | shared (Node built-ins) |
| `@agentcontext/retrieval` | shared, storage |
| `@agentcontext/observability` | shared |
| `@agentcontext/core` | shared, tokenization, strategies, storage *(interfaces only at runtime via injection)*, retrieval, observability |
| `apps/mcp-server` | core and all of the above; `@modelcontextprotocol/server` |

Rules:

1. Only `apps/mcp-server` may import `@modelcontextprotocol/*`. Enforced by a lint/boundary check added in AC-004.
2. `core` talks to storage, tokenizers, strategies and event sinks through interfaces defined in `shared` (see [CONTRACTS.md](../architecture/CONTRACTS.md)); concrete implementations are injected by the app.
3. Strategies are pure: no filesystem, network, clock, or randomness.
4. No circular package dependencies.
5. The JSONPath subset and hashing helpers live in `shared` because strategies and retrieval must share identical semantics.
6. `@agentcontext/*` is a placeholder scope until open question Q2 is resolved.

## Consequences

- + Core can be embedded without MCP; gateway in v0.2 reuses it unchanged.
- + Each package is testable in isolation with fakes.
- − More workspace configuration and build ordering (handled by Turborepo).
- − Public API surface must be curated before publishing (AC-041).

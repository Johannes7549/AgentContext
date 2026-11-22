# ADR-0004: MCP — wrapped tools over stdio using TypeScript SDK v2

- **Status:** Accepted
- **Date:** 2026-11-22
- **Task:** AC-002

## Context

AgentContext's primary interface is an MCP server. Two choices are needed: the
integration mode, and which official TypeScript SDK line to use.

Facts verified during planning (npm registry and https://ts.sdk.modelcontextprotocol.io/v2/, 22 Nov 2026):

- v1: `@modelcontextprotocol/sdk` 1.32.2 (single package).
- v2: split packages; `@modelcontextprotocol/server` 2.4.0 (deps: `zod ^4.2.0`, `@modelcontextprotocol/core`; engines `node >=20`), `@modelcontextprotocol/client` 2.4.0. v2 is the stable line and implements the 2026-07-28 spec.
- v2 stdio entry point: `serveStdio(factory)` from `@modelcontextprotocol/server/stdio`.
- v2 tools: `server.registerTool(name, { description, inputSchema, outputSchema, annotations }, handler)` with Zod v4 object schemas; `structuredContent` is validated against `outputSchema`; argument validation failures return `isError: true` tool results.
- stdout is the JSON-RPC channel; logs must go to stderr.

## Options

**Mode:** (a) wrapped tools — AgentContext exposes its own tools; (b) gateway — proxy and transform other MCP servers.

**SDK:** (i) v1 `@modelcontextprotocol/sdk`; (ii) v2 split packages.

## Decision

- **Mode (a), wrapped tools**, for v0.1. Gateway deferred to v0.2.
- **SDK (ii), v2**: `@modelcontextprotocol/server` (server) and `@modelcontextprotocol/client` (tests/examples only). Exact versions pinned in AC-029; APIs re-verified against official docs at that time.
- **Transport:** stdio only in v0.1.
- Every tool defines a Zod v4 `inputSchema` and `outputSchema`, returns `structuredContent` **and** a text content block.
- Domain failures (not found, expired, unauthorized, too large) are tool results with `isError: true` and a typed `code`; malformed requests are left to the SDK's protocol errors.
- Only `apps/mcp-server` imports the SDK (ADR-0001).

## Consequences

- + Current, supported SDK line and spec revision.
- + Structured output validated by the SDK.
- − v2 is newer; fewer community examples. Mitigated by integration tests over real stdio (AC-032).
- − Clients on older protocol revisions may need compatibility checks; verified with Claude Code in AC-040.

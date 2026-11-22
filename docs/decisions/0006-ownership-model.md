# ADR-0006: Ownership model — workspace + session scope

- **Status:** Accepted
- **Date:** 2026-11-22
- **Task:** AC-002

## Context

The roadmap requires that an opaque context ID is **not** authorization and that
retrieval enforces session/owner boundaries. v0.1 is a local stdio server: one
process per client connection, no accounts. Stored records persist on disk and
may be shared by several server processes (e.g. several projects, several agent
sessions) using the same storage directory.

## Options

1. **No scoping** — any process can read any record by ID. Violates the requirement.
2. **Per-process session only** — safe, but records become unreachable after a restart.
3. **Workspace + session scope with configurable cross-session access.**

## Decision

Option 3:

- **`workspaceId`** — from configuration; default derived deterministically from the server's resolved working directory (hash of the absolute path).
- **`sessionId`** — generated randomly per server process; may be overridden by configuration/client-supplied value where supported.
- Every stored context records both.
- **Scope is supplied by the server, never by the agent's tool arguments.** The retrieval API takes `(request, scope)` separately ([CONTRACTS.md](../architecture/CONTRACTS.md) §7).
- Default policy `retrievalScope: "session"` — same workspace **and** same session.
- Option `retrievalScope: "workspace"` — same workspace, any session (off by default). Useful after a server restart.
- A record outside scope returns `UNAUTHORIZED` (not `NOT_FOUND`) in internal results; the MCP layer may present both as "not available" to avoid leaking existence — decided in AC-030.
- Records persist until TTL expiry or quota eviction, regardless of session.

## Consequences

- + Satisfies "ID is not authorization" for a local, account-less tool.
- + Different projects sharing a storage directory are isolated.
- − Local OS users with filesystem access can still read the database directly; documented as out of the threat model (same-user local access).

# Security checklist (v0.1)

Each item from the roadmap's security checklist (§9) and release gate, with
where it is enforced and which tests verify it. Threat model and reporting:
[SECURITY.md](../../SECURITY.md).

| # | Requirement | Enforced in | Verified by |
|---|---|---|---|
| 1 | No raw content in logs by default | `@agentcontext/observability` logger: content-like fields replaced by their size, secret-looking values masked, errors reduced to name/code | `packages/observability/test/logger.test.ts`, `tests/integration/observability.test.ts`, `tests/integration/security.test.ts` ("never writes content or secrets to logs"), `tests/integration/mcp-tools.test.ts` |
| 2 | No remote telemetry | No network code in any package; events are stored locally only | Code review; `rg "fetch\(|http"` finds no outbound calls in `packages/` and `apps/` |
| 3 | Configurable local retention and cleanup | TTL (`ttlHours`), quota (`quotaMb`), startup + hourly `cleanup()` | `packages/storage/test/cleanup.test.ts`, `tests/integration/storage-lifecycle.test.ts` |
| 4 | Session ownership and retrieval authorization | Scope supplied by the server only (ADR-0006); retrieval checks workspace and session; UNAUTHORIZED shown as NOT_FOUND | `packages/retrieval/test/retrieve.test.ts`, `apps/mcp-server/test/tools.test.ts`, `apps/mcp-server/test/resources-prompts.test.ts`, `tests/integration/security.test.ts` (workspace isolation) |
| 5 | Path traversal | `FileAdapter`: lexical and symlink/junction-resolved containment; UNC/device paths, alternate data streams, reserved names, NUL bytes rejected | `apps/mcp-server/test/file-adapter.test.ts`, `apps/mcp-server/test/read-file.test.ts`, `tests/integration/security.test.ts` |
| 6 | Command injection | `CommandAdapter`: disabled by default, exact allowlist, `shell: false`, argument arrays, script shims refused (ADR-0010) | `apps/mcp-server/test/command-adapter.test.ts` (hostile arguments passed literally), `apps/mcp-server/test/execute-command.test.ts`, `tests/integration/security.test.ts` |
| 7 | Malformed input | Zod validation of every tool input, config and stored-data contract; malformed JSON-RPC handled by the SDK | `packages/shared/test/schemas.test.ts`, `apps/mcp-server/test/tools.test.ts`, `tests/integration/security.test.ts` ("survives malformed and hostile JSON-RPC") |
| 8 | Oversized payloads | `maxInputBytes` (default 8 MiB, below the 10 MB stdio message limit), `files.maxFileBytes`, per-original quota check | `packages/core/test/normalizer.test.ts`, `apps/mcp-server/test/file-adapter.test.ts`, `packages/storage/test/cleanup.test.ts`, `tests/integration/security.test.ts` |
| 9 | Resource exhaustion | Retrieval: 1 MB response cap, `maxTokens`, keyword match limit; JSONPath result limit; command timeout, output cap and process-tree kill | `packages/retrieval/test/retrieve.test.ts`, `packages/shared/test/jsonpath.test.ts`, `apps/mcp-server/test/command-adapter.test.ts`, `tests/integration/security.test.ts` |
| 10 | Tool output is untrusted data | Content is never interpreted; guidelines prompt and tool descriptions state it | `tests/integration/security.test.ts` ("treats prompt-injection text as data"), `apps/mcp-server/test/resources-prompts.test.ts` |
| 11 | No false recovery claims | Recoverable only after verified persistence; retrieval re-verifies hashes | `packages/core/test/engine.test.ts`, `tests/integration/storage-backed-pipeline.test.ts`, `tests/integration/recovery.test.ts` |
| 12 | Secrets kept out of commands | Command environment reduced to an allowlist; secret-looking names removed | `apps/mcp-server/test/command-adapter.test.ts` |
| 13 | Dependency scanning; no secrets in repository/CI | `pnpm audit --audit-level high` job in CI; `.gitignore` excludes `.env*` and local data | `.github/workflows/ci.yml` |

## Known limitations

- A local user with access to the storage directory (or the same OS account)
  can read stored originals directly; this is outside the v0.1 threat model.
- Messages larger than 10 MB are rejected by the MCP stdio transport, which
  closes the connection; inputs between `maxInputBytes` and that limit receive
  a clean `INPUT_TOO_LARGE` error.
- `execute_command` runs with the user's operating-system permissions; only
  enable it with a minimal allowlist.

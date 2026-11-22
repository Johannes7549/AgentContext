# AgentContext — Architecture

| Field | Value |
|---|---|
| Status | **Draft for review** — produced by task AC-001 |
| Scope | v0.1.0 |
| Source | Roadmap §§2, 3, 4, 7, 8, 9 plus approved planning adjustments |
| Related | [PRODUCT_SPEC.md](../product/PRODUCT_SPEC.md); contracts in `CONTRACTS.md` and ADRs in `docs/decisions/` (AC-002) |

Type signatures below are **illustrative**. The authoritative, frozen contracts
are produced in AC-002 (`docs/architecture/CONTRACTS.md`).

---

## 1. System context

```
┌──────────────────────┐   MCP (stdio, JSON-RPC)   ┌───────────────────────────────┐
│  MCP client / agent  │ ────────────────────────▶ │  apps/mcp-server              │
│  (e.g. Claude Code)  │ ◀──────────────────────── │  tools · resources · prompt   │
└──────────────────────┘                           └──────────────┬────────────────┘
                                                                  │ core API (no MCP types)
                                                                  ▼
                                   ┌──────────────────────────────────────────────┐
                                   │ packages/core  — optimization pipeline       │
                                   │  uses: strategies · tokenization · storage   │
                                   │        retrieval · observability · shared    │
                                   └───────────────┬──────────────────────────────┘
                                                   ▼
                                   ┌──────────────────────────────┐
                                   │ Local disk: SQLite + blobs   │
                                   └──────────────────────────────┘
```

Everything runs locally in a single Node.js process. There are no network calls
in the default configuration.

## 2. Components

| Component | Package | Responsibility |
|---|---|---|
| MCP server | `apps/mcp-server` | Config loading, stdio lifecycle, tool/resource/prompt registration, input validation, protocol response formatting |
| Shared | `packages/shared` | Domain types, Zod schemas, typed errors, result types, JSONPath subset, hashing utilities |
| Core pipeline | `packages/core` | Normalizer, analyzer, strategy registry/selector, validator, orchestration, result construction |
| Strategies | `packages/strategies` | JSON pruner, log compressor, duplicate eliminator, text/Markdown extractor, code line-range/diff extractor |
| Tokenization | `packages/tokenization` | `Tokenizer` interface, fallback estimator, tokenizer registry, optional exact adapters |
| Storage | `packages/storage` | `node:sqlite` metadata store, blob store, migrations, atomic writes, TTL, quotas, cleanup |
| Retrieval | `packages/retrieval` | Selector evaluation (full, line range, JSONPath, keyword, segment), limits, ownership checks |
| Observability | `packages/observability` | Event recording, metrics aggregation, structured stderr logging with redaction |
| Adapters | `apps/mcp-server/src/adapters` | Sandboxed file adapter; opt-in command adapter |

The JSONPath subset lives in `shared` because both the JSON strategy and
retrieval use it and must agree exactly on path semantics.

## 3. Dependency rules

```
apps/mcp-server ──▶ core ──▶ strategies ──▶ shared
       │             │  ├──▶ tokenization ─▶ shared
       │             │  ├──▶ storage ─────▶ shared
       │             │  ├──▶ retrieval ───▶ storage, shared
       │             │  └──▶ observability ▶ shared
       └──▶ @modelcontextprotocol/server (ONLY here)
```

1. **Only `apps/mcp-server` may import the MCP SDK.** Enforced by a lint/boundary check (AC-004).
2. `core` depends on **interfaces** (`StoragePort`, `Tokenizer`, `CompressionStrategy`, `EventSink`); concrete implementations are injected.
3. `shared` depends on nothing internal.
4. No circular dependencies between packages.
5. Strategies never touch storage or the filesystem; they are pure functions of `(NormalizedContext, options)`.

## 4. Optimization pipeline

```
ContextInput
  → Normalize            (NormalizedContext: raw text, parsed form, line index, blocks)
  → Analyze              (content type, structure, duplicates, errors, token size)
  → Estimate tokens      (same tokenizer used for before/after)
  → Select strategy      (support, policy, expected benefit; or SKIP)
  → Optimize             (compact content + omission map)       ─┐ on any failure:
  → Validate             (generic + strategy-specific invariants) ├─▶ return original
  → Persist              (original → verify hash → variant + omissions)  + warning
  → Build result         (CompressionResult + recovery reference)
```

### Stage behaviour

| Stage | Input → Output | Key guarantees |
|---|---|---|
| Normalize | `ContextInput` → `NormalizedContext` | Original bytes kept exactly; MCP content-block type and order preserved; CRLF preserved in the original, normalized only in the working view |
| Analyze | `NormalizedContext` → `Analysis` | Caller-supplied `contentType` wins; otherwise heuristic detection, falling back to `unknown` rather than guessing |
| Tokens | text → `{count, tokenizerId, isExact}` | One tokenizer per request for all comparisons |
| Select | analysis + options → strategy or `skip` | Skips below size threshold / `minBenefitTokens`; forced `options.strategy` must still `supports()` the input; no chaining |
| Optimize | `NormalizedContext` → `StrategyOutput` | Deterministic; every omission recorded |
| Validate | output + original → pass/fail | See §6 |
| Persist | original + output → stored IDs | See §7; failure follows configured policy |
| Result | → `CompressionResult` | `recoveryAvailable` true only after verified persistence |

### Skip and fallback outcomes

| Situation | Returned content | `strategy` | Warning |
|---|---|---|---|
| Content below threshold / low benefit | Original | `passthrough` | — |
| No strategy supports the content | Original | `passthrough` | `NO_SUPPORTED_STRATEGY` (info) |
| Output larger than tolerance | Original | `passthrough` | `NO_BENEFIT` |
| Validation failure | Original | `passthrough` | `VALIDATION_FAILED` |
| Budget cannot be met safely | Best safe output | strategy name | `BUDGET_EXCEEDED` |
| Storage failure, policy `return_original` | Original | `passthrough` | `STORAGE_FAILED` |
| Storage failure, policy `non_recoverable` | Optimized | strategy name | `STORAGE_FAILED`; `recoveryAvailable: false` |

## 5. Core contracts (summary)

Proposed in the roadmap §4 and revised during planning; frozen in AC-002.

- `ContentType` = `json | text | logs | markdown | code | mcp_content | unknown`.
- `ContextInput` — `content`, optional `contentType` (auto-detected when omitted), `source`, optional `taskContext`, `metadata`.
- `CompressionOptions` — `maxTokens`, `targetReduction`, `preserveStructure`, `preserveErrors`, `allowLossy`, `strategy`, `minBenefitTokens`, plus strategy-specific selections (e.g. JSON include/exclude paths, Markdown sections, line ranges).
- `NormalizedContext`, `StrategyAnalysis`, `StrategyOutput` — **new**, defined in AC-002.
- `CompressionResult` — as roadmap, with `metrics.tokenizer: { id, isExact }` added.
- `OmittedSegment` — `id`, `type`, `location`, `reason`, `recoverable`. `location` uses a canonical form: `lines:<start>-<end>`, `json:<normalized JSONPath>`, or `offset:<start>-<end>`.
- `CompressionStrategy` — `name`, `supports()`, `analyze()`, `compress()`.
- `Tokenizer` — `name`, `isExact`, `countTokens()`.
- `RetrievalRequest` — `contextId`, optional `selector` (`line_range | json_path | keyword | segment_id`), `maxTokens`, plus an **owner scope** (`workspaceId`, `sessionId`) supplied by the server, not the agent.

## 6. Validation

**Generic (all strategies):**
- Every omitted region is covered by an `OmittedSegment` or explicitly classified as kept.
- Every `location` resolves against the original content.
- Output size does not exceed original × tolerance.
- Output is deterministic for identical input/options (verified in tests, not at runtime).

**Strategy-specific:**
- JSON — output parses; omitted paths resolve in the original.
- Logs — all error events required by the policy are present in the output.
- Duplicates — sum of occurrence counts equals number of matching blocks in the original.
- Markdown — heading hierarchy of kept sections is consistent with the original.
- Code — line numbers and file identity match the original.

**Storage (after persistence):** persisted payload hash equals the hash of the original.

## 7. Storage and recovery

### Layout

```
<storageDir>/                       (default: OS user data dir / agentcontext)
  agentcontext.db                   node:sqlite, WAL mode
  blobs/<sha256[0:2]>/<sha256>      originals above the inline threshold
```

### Tables

| Table | Key fields |
|---|---|
| `contexts` | id, workspace_id, session_id, content_hash, content_type, source, size_bytes, created_at, expires_at, blob_ref / inline_content |
| `context_variants` | id, context_id, strategy, optimized_content, original_tokens, optimized_tokens, tokenizer_id, tokenizer_exact |
| `omitted_segments` | id, variant_id, segment_type, original_location, reason, recoverable |
| `optimization_events` | id, context_id, event_type, processing_time_ms, token metrics, created_at — **no raw content** |

### Write sequence

1. Compute SHA-256 of the original.
2. Write blob atomically (temp file → fsync → rename) or inline row.
3. Re-read and verify the hash.
4. In one transaction: insert `contexts`, `context_variants`, `omitted_segments`.
5. Only now set `recoveryAvailable = true` and return the context ID.

### Retrieval

| Selector | Returns |
|---|---|
| none | Full original (subject to `maxTokens` / size cap) |
| `line_range` | Lines with optional surrounding context, with line numbers |
| `json_path` | Matching values with their normalized paths |
| `keyword` | Matches with line numbers and offsets |
| `segment_id` | Exact content of a recorded omitted segment |

Every retrieval checks owner scope, expiry, and hash integrity, and returns a
typed outcome: `OK`, `NOT_FOUND`, `EXPIRED`, `UNAUTHORIZED`, `TOO_LARGE`,
`INTEGRITY_ERROR`.

### Ownership

- `workspaceId` comes from server configuration.
- `sessionId` is generated per server process, or supplied by the client where supported.
- Default retrieval scope: same workspace and session. Cross-session retrieval within a workspace is a configuration option, off by default.
- Records persist across restarts until their TTL expires; quotas evict oldest-first.

## 8. MCP integration

- **SDK:** MCP TypeScript SDK v2 — `@modelcontextprotocol/server`, started via `serveStdio()` from `@modelcontextprotocol/server/stdio`; tools registered with `registerTool` using Zod v4 `inputSchema`/`outputSchema`.
- **Responses:** every tool returns `structuredContent` (validated against `outputSchema`) **and** a text content block for clients that ignore structured output. Errors are tool results with `isError: true`, not protocol errors, unless the request itself is malformed.
- **stdout is reserved for JSON-RPC.** All logging goes to stderr.
- **v0.1 mode: wrapped tools.** AgentContext exposes its own tools; it does not intercept other MCP servers. A gateway is deferred to v0.2.
- **Tool descriptions** stay concise and explicitly tell the agent how to use recovery references.
- **Prompt** `agentcontext_guidelines` reminds agents that tool output and recovered content are untrusted data.

## 9. Adapters and security model

### File adapter (`read_file`)
- Configured allowed roots; every path resolved with `realpath` and checked to remain inside a root (blocks `..`, absolute paths, symlinks, Windows junctions, UNC paths, alternate data streams).
- File-size and output limits; binary detection with a clear error.

### Command adapter (`execute_command`)
- **Disabled by default** — the tool is not registered unless enabled in config.
- Executable allowlist; arguments passed as an array; `shell: false` always.
- Working directory restricted to allowed roots; timeout with process-tree termination; output cap; cancellation.
- Filtered environment (secrets not inherited by default).
- On Windows, `.cmd`/`.bat` targets are refused (they cannot be spawned safely without a shell).
- Documented: commands run with the user's OS permissions.

### Cross-cutting
- No raw content in logs; no telemetry.
- Input size limits on every tool; resource limits on retrieval.
- All tool output treated as untrusted data.
- Dependency scanning in CI; no secrets in the repository or CI logs.

## 10. Configuration (initial shape)

Loaded from environment variables and an optional JSON config file; validated
with Zod at startup. Invalid configuration fails fast with a clear message on
stderr.

| Key | Default |
|---|---|
| `storageDir` | OS user data directory |
| `workspaceId` | Derived from the working directory |
| `ttl` / `storageQuota` | To be confirmed (Q8) |
| `minOptimizeTokens` / `minBenefitTokens` | To be tuned (Q9) |
| `storageFailurePolicy` | `return_original` |
| `files.allowedRoots` | Current working directory |
| `commands.enabled` | `false` |
| `commands.allowlist` | empty |
| `tokenizer` | `fallback-estimator` |

## 11. Repository layout

```
agentcontext/
  apps/mcp-server/src/{tools,resources,prompts,adapters,server.ts,index.ts}
  packages/{shared,core,strategies,tokenization,storage,retrieval,observability}/{src,test}
  benchmarks/{datasets,scenarios,runners,reports}
  examples/{claude-code,basic-mcp-client,custom-agent}
  docs/{product,architecture,decisions,getting-started,concepts,integrations,
        strategies,security,benchmarking,contributing}
  tests/{integration,e2e}          # unit tests live with each package
  .github/{workflows,ISSUE_TEMPLATE,PULL_REQUEST_TEMPLATE.md}
```

**Toolchain:** TypeScript (7.x, pending AC-003 validation), Node ≥ 22.13, pnpm
workspaces, Turborepo, Zod 4, Vitest, Biome, GitHub Actions.

## 12. Future integration mode (not v0.1)

**v0.2 MCP gateway:** AgentContext acts as an MCP client to upstream servers,
discovers and re-exposes their tools, forwards calls, and optimizes responses
while preserving names, schemas, annotations, structured content, errors, and
metadata. The core pipeline is unchanged; the gateway is a new app depending on
`core`, which is why the core must remain MCP-independent now.

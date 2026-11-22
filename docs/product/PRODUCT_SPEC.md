# AgentContext — Product Specification

| Field | Value |
|---|---|
| Product | AgentContext |
| Category | Reversible context optimization infrastructure for AI agents |
| Target release | v0.1.0 (public MVP) |
| Status | **Draft for review** — produced by task AC-001 |
| Source | *AgentContext Complete Product & Engineering Roadmap* v1.0 (22 Nov 2026), §§1, 6, 10, 11, 17 |
| Related | [ARCHITECTURE.md](../architecture/ARCHITECTURE.md), ADRs in `docs/decisions/` (AC-002) |

---

## 1. Problem

AI agents routinely receive more tool output than they need:

- long test and build logs where only a few lines are failures;
- terminal output with heavily repeated lines;
- oversized JSON API responses where only a few fields matter;
- whole files when only one section or line range is relevant;
- the same content repeated within one output.

This consumes context window, increases latency and cost, and can push relevant
information out of the agent's attention.

## 2. Product promise

> Reduce unnecessary agent context consumption while preserving information
> fidelity, recoverability, and task performance.

AgentContext is a **local-first, MCP-native context optimization engine**. It
transforms oversized tool output into a smaller, structured representation,
**stores the original locally**, records exactly what was omitted, and lets the
agent **selectively recover** any omitted part.

## 3. Core principles

| # | Principle | Meaning in practice |
|---|---|---|
| P1 | **Deterministic-first** | The default engine never calls an LLM. The same input and configuration always yield the same output. |
| P2 | **Reversible by design** | The original is preserved; every omission is recorded with a reason and a location. |
| P3 | **Conservative** | When safe optimization is uncertain, return the original or clearly mark the result as incomplete. |
| P4 | **Local-first** | Raw content stays on the user's machine. No telemetry and no remote model calls by default. |
| P5 | **Framework-independent core** | MCP is an interface. The optimization engine does not depend on the MCP SDK. |
| P6 | **Evidence over claims** | Savings are measured (total tokens including recovery, latency, task success), never asserted. |

## 4. Users and primary workflow

**Primary user:** a developer running an MCP-capable coding agent (first
supported client: **Claude Code**) who wants tool outputs to consume less
context without losing information.

**Secondary user:** a developer embedding the TypeScript core API directly in a
custom agent.

### Workflow

1. The agent invokes an AgentContext MCP tool (e.g. `optimize_context`, `read_file`).
2. AgentContext receives (or, via an approved adapter, produces) the original output.
3. The **normalizer** converts it to a common internal representation without discarding content types or order.
4. The **analyzer** identifies content type, structure, duplicates, errors, and size.
5. The **strategy selector** picks a safe deterministic strategy — or skips optimization.
6. The **strategy** produces a compact representation plus an **omission map**.
7. The **original and metadata are persisted** and their integrity verified.
8. The **validator** checks integrity and strategy-specific invariants.
9. The tool returns compact content, metrics, and recovery instructions.
10. If needed, the agent calls `retrieve_context` to recover a segment or the full original.

> **Critical rule:** a result is never reported as recoverable until the original
> has been durably stored and its integrity hash verified.

## 5. v0.1 scope

### Included

| Area | v0.1 capability |
|---|---|
| JSON | Explicit field inclusion/exclusion, JSONPath selection (restricted RFC 9535 subset), controlled array pagination, nested objects |
| Logs | Level detection, grouping of exact repeated messages, error/warning and stack-trace extraction, original line references |
| Duplicates | Exact normalized-block hashing with occurrence counts and all original locations |
| Text / Markdown | Explicit section extraction, heading hierarchy preserved, exact repeated paragraphs collapsed |
| Code | Line-range extraction and unified-diff (hunk) extraction from supplied diff text |
| Tokens | Pluggable tokenizer adapters; deterministic fallback estimator; estimates clearly labelled; budgets and minimum-benefit threshold |
| Storage | SQLite metadata (Node built-in `node:sqlite`) + local filesystem blobs; atomic writes, hashes, TTL, quotas, cleanup |
| Recovery | Full original, line range, JSONPath, keyword, segment ID — size-limited and scoped to owner |
| MCP | stdio server exposing five tools, read-only resources, and a guidelines prompt |
| Adapters | Sandboxed file reading; command execution **disabled by default** |
| Benchmarks | Reproducible per-scenario fixtures and reports (total context including recovery) |

### Explicit non-goals for v0.1

- No universal automatic interception of arbitrary MCP servers (gateway is v0.2).
- No mandatory LLM provider, paid API, or remote tokenizer.
- No semantic / LLM-based compression or summarization.
- No cloud-hosted service, accounts, or team features.
- No promise of a fixed percentage of token savings.
- No destructive compression without a recovery record.
- No unrestricted shell execution.
- No cross-session semantic memory or broad memory-management product.
- No full AST/symbol support across languages.
- No guaranteed provider billing calculations.
- No Python SDK or broad framework adapters.

## 6. MCP surface (v0.1)

| Tool | Purpose | Notes |
|---|---|---|
| `optimize_context` | Optimize content supplied by the agent | Returns compact content, context ID, metrics, omissions |
| `read_file` | Read and optimize a file inside allowed roots | Optional line range and output budget |
| `execute_command` | Run an allowlisted command and optimize its output | **Disabled by default**; not registered unless enabled |
| `retrieve_context` | Recover original content | Selector + `maxTokens`; owner-scoped |
| `get_optimization_stats` | Aggregate metrics | Counts and savings, labelled exact/estimated |

Resources: `agentcontext://stats`, `agentcontext://context/{contextId}/metadata`.
Prompt: `agentcontext_guidelines` — explains recovery references, safe use of
optimized results, and that tool/retrieved output is **untrusted data**.

## 7. Behavioural requirements

### Optimization

- R1. Optimization is skipped when content is already small or expected benefit is below `minBenefitTokens`.
- R2. Optimization is skipped (original returned) when output would grow beyond the configured tolerance.
- R3. Strategies are not chained in v0.1.
- R4. If validation fails, the original is returned with a warning; unsafe transformed content is never returned.
- R5. No field, section, or line is considered irrelevant without an explicit policy or selection.
- R6. Every omitted segment has an ID, type, location, reason, and recoverability flag.

### Tokens and budgets

- R7. Original and optimized content are measured with the same tokenizer.
- R8. Every metric records the tokenizer identity and whether counts are exact.
- R9. If a budget cannot be met safely, a `BUDGET_EXCEEDED` warning is returned instead of deleting critical information.
- R10. No claim of exact provider billing or whole-conversation savings.

### Storage and recovery

- R11. Persist original atomically → verify hash → persist variant and omission map → only then return a recovery reference.
- R12. On persistence failure, follow the configured policy: return the original, or return a result explicitly marked non-recoverable.
- R13. Retrieval enforces workspace/session ownership; a context ID alone is not authorization.
- R14. Retrieval returns explicit `NOT_FOUND`, `EXPIRED`, `UNAUTHORIZED`, or `TOO_LARGE` results.

### Security and privacy

- R15. No raw content in logs by default; no remote telemetry.
- R16. File access is confined to configured allowed roots (traversal, symlink, and junction escapes blocked).
- R17. Command execution is opt-in, allowlisted, argument-array based, never via a shell, with timeouts and output caps.
- R18. All tool output and recovered content is treated as untrusted data and never promoted to instructions.
- R19. Local data retention (TTL, quota, cleanup) is configurable.

## 8. Success metrics

Engineering targets for v0.1 — **targets, not guarantees**. Actual results,
including regressions, will be published.

| Metric | Definition | Initial target |
|---|---|---|
| Median input reduction | (baseline − (optimized + recovered)) / baseline, same tokenizer | ≥ 40% on supported fixtures where safe optimization is possible |
| Extraction accuracy | Ground-truth facts present in optimized + recovered output | ≥ 95% on defined structured extraction tests |
| Recovery integrity | Hash verification pass rate for successfully stored records | 100% |
| Unrecoverable omissions | Omissions not recoverable while `recoveryAvailable = true` | 0 |
| Task success | Agent completes the predefined task correctly | No material degradation vs. baseline |
| Latency | Optimization processing time (excluding agent reasoning) | p50/p95 measured and published; hard limits set after profiling |

Token reduction alone is **not** a success metric: a smaller output that causes
task failure is a failed optimization.

## 9. Release gates (v0.1.0)

| Gate | Must pass |
|---|---|
| Core | Standalone engine, tested strategies, safe fallback, no MCP dependency |
| Recovery | Original stored, integrity verified, selectors work, access scoped |
| MCP | Five tools work; structured content/errors handled; Claude Code example verified |
| Security | Command disabled by default; file sandbox; safe logging; input/resource limits |
| Benchmarks | ≥ 4 reproducible scenarios; total context includes recovery; task quality measured |
| Release | Docs complete, CI green, clean install tested, release notes and license present |

## 10. Post-v0.1 roadmap (out of scope here)

- **v0.2 — MCP gateway:** upstream server connections, tool discovery/forwarding, response optimization, per-tool policies.
- **v0.3 — Intelligent context management:** task-aware selection, adaptive budgets, cross-call dedup/caching, optional semantic ranking (never mandatory remote LLM calls).
- **v1.0 — Ecosystem:** Python SDK, LangGraph/custom integrations, plugin strategies, optional hosted observability.

## 11. Approved planning decisions

The following adjustments to the roadmap were approved during planning and are
recorded formally as ADRs in AC-002:

1. Use the MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`, `serveStdio`, Zod v4 schemas) — only in `apps/mcp-server`.
2. Use Node's built-in **`node:sqlite`** instead of a native SQLite module; minimum Node **22.13**.
3. Implement the tokenizer interface and fallback estimator **early** (before the pipeline); budgets remain in the tokens phase.
4. Implement an in-house **restricted JSONPath subset** (RFC 9535: `$`, `.name`, `['name']`, `[n]`, `[a:b]`, `*`; no filter/script expressions).
5. Revise contracts: optional `contentType` with auto-detection; define `NormalizedContext`, `StrategyAnalysis`, `StrategyOutput`; tokenizer identity in metrics; owner scope on retrieval; canonical omission location format.
6. Ownership model: `workspaceId` (config) + `sessionId` (per server process or client-supplied); records persist across restarts until TTL.
7. Code strategy parses **supplied** unified-diff text; it does not invoke `git`.
8. Unit tests co-located per package; integration/e2e tests in root `tests/`.
9. Windows: the command adapter refuses `.cmd`/`.bat` targets rather than falling back to a shell.
10. Validate TypeScript 7 compatibility in AC-003; fall back to TypeScript 6.x via ADR if needed.

## 12. Assumptions

- A1. Users run Node ≥ 22.13 on Windows, macOS, or Linux.
- A2. MCP clients support stdio transport and `structuredContent`; text content is always also provided for clients that ignore structured output.
- A3. One AgentContext server process serves one client connection (stdio).
- A4. No exact local tokenizer exists for Claude models; default counts are estimates.
- A5. Agents will call `retrieve_context` when guided by clear tool descriptions and the guidelines prompt (validated by benchmarks).
- A6. Typical single tool outputs fit in memory (inputs are size-capped; streaming is post-MVP).

## 13. Open questions

| ID | Question | Blocks | Default if unanswered |
|---|---|---|---|
| Q1 | ~~Confirm Apache-2.0 license~~ **Resolved (AC-006): Apache-2.0** | — | — |
| Q2 | ~~npm scope for published packages~~ **Resolved: `@agentcontext/*`** (requires the free npm organization `agentcontext` before publishing) | — | — |
| Q3 | ~~Is the deterministic oracle sufficient for "task quality measured"?~~ **Resolved: yes — deterministic oracle only for v0.1; live model runs (AC-038) deferred** | — | — |
| Q6 | Location of the roadmap PDF in the repo | AC-003 | Leave in repo root, excluded from git |
| Q7 | Will there be a GitHub remote? | AC-007 | CI validated syntactically until a remote exists |
| Q8 | Default TTL and storage quota values | AC-026 | 7 days, 500 MB (to be confirmed) |
| Q9 | Default size threshold below which optimization is skipped | AC-012/021 | ~500 estimated tokens (to be tuned by benchmarks) |

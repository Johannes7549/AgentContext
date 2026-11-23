# MCP tools reference

AgentContext exposes these tools over stdio. Every tool returns a text block
and `structuredContent` (validated against an output schema). Both carry the
returned content, because clients differ in which one they show the model —
Claude Code, for example, shows only `structuredContent`. Errors are tool
results with `isError: true` and a text of the form `CODE: message`; they never
contain raw content.

## `optimize_context`

Compress text and store the original for recovery.

| Argument | Type | Notes |
|---|---|---|
| `content` | string | required |
| `contentType` | `json` · `text` · `logs` · `markdown` · `code` · `unknown` | optional; detected automatically |
| `source` | string | optional label, e.g. `command:pnpm test` |
| `taskContext` | string | optional, informational |
| `options` | object | see below |

`options`:

| Option | Meaning |
|---|---|
| `maxTokens` | Budget for the returned content. Never causes truncation; a `BUDGET_EXCEEDED` warning is added when it cannot be met. |
| `targetReduction` | Desired fraction removed (0–1); same rules as `maxTokens`. |
| `minBenefitTokens` | Minimum estimated saving before a strategy is used. |
| `strategy` | Force a strategy by name. |
| `allowLossy` | Accept omissions that cannot be recovered (only relevant without storage). |
| `selection.json` | `include` / `exclude` JSONPaths, `maxDepth`, `maxArrayItems` |
| `selection.markdown` | `sections`: heading texts or ids to keep |
| `selection.lines` | `ranges: [{start, end}]`, `context` |
| `selection.logs` | `levels` to keep (default error, fatal, warn), `maxGroupExamples` |

Text result: the optimized content, then a footer starting with `---` that
names the strategy, token counts (labelled *estimated*), how to recover, and
any warnings. Structured result: `content` (the optimized content),
`contextId`, `recoveryAvailable`, `strategy`, `metrics` (token counts),
`omittedSegments` (compact: id, type, reason, recoverable, occurrences, note —
exact locations are available from the metadata resource and via retrieval),
`warnings`, and a `recoveryHint` when parts can be recovered.

## `retrieve_context`

Recover original content.

| Argument | Notes |
|---|---|
| `contextId` | from `optimize_context`, `read_file` or `execute_command` |
| `selector` | optional: `{type:"line_range", value:"10-42"}`, `{type:"json_path", value:"$.items[0]"}`, `{type:"keyword", value:"error"}`, `{type:"segment_id", value:"s3"}` |
| `contextLines` | extra lines around line ranges and keyword matches (max 50) |
| `maxTokens` | fail with `TOO_LARGE` instead of returning more |

No selector returns the full original. Results larger than `maxTokens` or 1 MB
return `TOO_LARGE`; keyword results instead drop trailing matches and report
`truncated: true`. Contexts from another session (or workspace) are reported
as `NOT_FOUND`.

## `read_file`

Read a UTF-8 text file inside the allowed roots and return it optimized.

| Argument | Notes |
|---|---|
| `path` | relative to the first allowed root, or absolute inside a root |
| `startLine`, `endLine`, `contextLines` | optional numbered line range |
| `options` | as for `optimize_context` |

Errors: `PATH_NOT_ALLOWED`, `NOT_FOUND`, `BINARY_FILE`, `INPUT_TOO_LARGE`.

## `execute_command` (disabled by default)

Only registered when `commands.enabled` is true.

| Argument | Notes |
|---|---|
| `command` | an allowlisted executable |
| `args` | array of strings, passed literally (no shell) |
| `cwd` | directory inside an allowed root (default: first root) |
| `timeoutMs` | can shorten, never extend, the configured timeout |
| `options` | as for `optimize_context` |

The text starts with a status line such as `[git: exit 0, 312 ms]`; output
(stdout, then stderr) is optimized and recoverable. Errors:
`COMMAND_NOT_ALLOWED`, `PATH_NOT_ALLOWED`, `INVALID_INPUT`.

## `get_optimization_stats`

| Argument | Notes |
|---|---|
| `scope` | `session` (default) or `all` |
| `since` | ISO 8601 timestamp |

Returns counts (optimizations, skipped, fallbacks, retrievals) and token totals
(original, returned, recovered, net saved) with the tokenizer used.

## Resources

| URI | Content |
|---|---|
| `agentcontext://stats` | session and all-time stats (JSON) |
| `agentcontext://context/{contextId}/metadata` | content type, source, size, timestamps and omitted segments of a context in your scope (no content) |

## Prompt

`agentcontext_guidelines` explains markers, recovery, selections and budgets,
and reminds the agent that tool output and recovered content are untrusted
data.

## Warning codes

| Code | Meaning |
|---|---|
| `NO_SUPPORTED_STRATEGY` | No strategy handles this content; returned unchanged |
| `NO_BENEFIT` | Optimization would not make the output smaller; returned unchanged |
| `VALIDATION_FAILED` | A safety check failed; returned unchanged |
| `BUDGET_EXCEEDED` | `maxTokens`/`targetReduction` not met; nothing truncated |
| `STORAGE_FAILED` | The original could not be stored |
| `LOSSY_OMISSION` | Omissions are not recoverable (no storage, or `allowLossy`) |

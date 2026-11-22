# Concepts

## What happens to a tool output

```
content ─► normalize ─► analyze ─► select strategy ─► compress ─► validate ─► store original ─► result
                                       │ (or skip)                  │ fails               │ fails
                                       ▼                            ▼                     ▼
                                original unchanged          original + warning     original + warning
```

1. **Normalize** — the exact bytes are kept (line endings, BOM, Unicode).
2. **Analyze** — content type (JSON, logs, Markdown, code, text), size,
   duplicates, log levels, headings.
3. **Select** — at most one strategy is chosen; small inputs and low expected
   savings are skipped.
4. **Compress** — deterministic, no LLM; every omission is recorded with its
   original location.
5. **Validate** — omissions must point at real content, nothing may be dropped
   silently, the output must be smaller, and strategy checks must pass (for
   example, no error line may disappear from a log).
6. **Store** — the original is written locally and its hash re-verified
   **before** the result claims it can be recovered.

Every failure path returns the original with a warning. AgentContext never
returns transformed content it could not validate.

## Markers and segments

Omitted parts are replaced by markers:

```text
[... s3: 12 lines below kept levels omitted (info x12; lines 40-51)]
[... s1: repeated 74 more times (lines 5-43, 46-70, 75-84)]
[... s2: section "## Configuration" omitted (lines 21-24)]
```

Each marker id (`s1`, `s2`, …) matches an **omitted segment** in the
structured result: its type, reason, exact original location (`lines:40-51`,
`json:$['items'][3]`, …) and whether it is recoverable.

## Recovery

Call `retrieve_context` with the `contextId` and:

- a **segment id** — exactly what a marker replaced;
- a **line range** — original bytes of those lines;
- a **JSONPath** — values from JSON originals (restricted, safe subset);
- a **keyword** — matching lines with their offsets;
- **nothing** — the full original.

Recovered content is byte-for-byte identical to the original. Retrieval is
scoped: by default only the session that stored a context can read it.

## Selections: telling AgentContext what you need

Without a selection AgentContext only collapses **exact repeats** (identical
log messages, duplicate paragraphs, long unchanged diff context). It never
decides on its own that a field, section or line is irrelevant.

With a selection you choose what to keep:

| Content | Selection | Example |
|---|---|---|
| JSON | `selection.json` | `{"include": ["$.data[*].id", "$.data[*].email"]}` |
| Markdown | `selection.markdown` | `{"sections": ["Installation", "troubleshooting"]}` |
| Any text / code | `selection.lines` | `{"ranges": [{"start": 120, "end": 180}], "context": 5}` |
| Logs | `selection.logs` | `{}` (warn and above) or `{"levels": ["error"]}` |

## Budgets

`maxTokens` and `targetReduction` steer strategy choice and are checked on the
result. A budget **never** causes truncation: if it cannot be met safely, the
result carries `BUDGET_EXCEEDED` and you can add a selection or retrieve parts
on demand. Content already within `maxTokens` is returned unchanged.

## Token counts

Counts come from a deterministic estimator and are labelled *estimated*. Use
them to compare before and after; they are not billing figures.

## Storage and retention

Originals live in a local SQLite database plus content-addressed files under
the storage directory. They expire after 7 days by default, the oldest are
evicted beyond the quota (500 MB), and cleanup runs at startup and hourly. See
[Privacy](../security/privacy.md).

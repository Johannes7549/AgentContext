# Strategies

All strategies are deterministic and pure: no network, no LLM, same input and
options → same output. Each records every omission with its original location.

| Strategy | Content | Without a selection | With a selection |
|---|---|---|---|
| `log-compressor` | logs | Groups lines whose message is identical apart from a leading timestamp; keeps the first occurrence and a marker with count and line numbers. Stack frames and blank lines are never grouped. | `selection.logs`: omits runs of lines below the kept levels (default `error`, `fatal`, `warn`). Error lines, exceptions, test failures and their stack frames are always kept. |
| `json-pruner` | JSON | Nothing | `include`/`exclude` JSONPaths, `maxDepth`, `maxArrayItems`. Output stays valid JSON; omitted paths are recorded. |
| `duplicate-eliminator` | text, Markdown, logs | Collapses exact duplicate paragraphs (text, Markdown) or lines (logs) of 40+ characters; the first occurrence stays. | — |
| `section-extractor` | Markdown | Nothing | `selection.markdown.sections`: keeps matching sections (with subsections); every other section becomes a one-line marker, so the output doubles as an outline. |
| `code-extractor` | code | Unified diffs: a per-file `+/−` summary and unchanged context runs longer than 6 lines collapsed (3 kept next to each change). Plain code: nothing. | `selection.lines`: keeps the ranges with original line numbers (`  42 \| code`). |

When several strategies apply, the one expected to meet the budget wins, then
the higher confidence, then the larger saving. Strategies are never chained.

## Examples

Keep only failing output from a long build log:

```json
{ "content": "<build log>", "options": { "selection": { "logs": { "levels": ["error"] } } } }
```

Extract two fields from a large API response:

```json
{ "content": "<json>", "options": { "selection": { "json": { "include": ["$.items[*].id", "$.items[*].status"] } } } }
```

Read one section of a long README:

```json
{ "content": "<markdown>", "options": { "selection": { "markdown": { "sections": ["Configuration"] } } } }
```

Look at a function and its surroundings:

```json
{ "path": "src/billing.ts", "startLine": 120, "endLine": 160, "contextLines": 5 }
```

(the last example is a `read_file` call).

## Safety checks per strategy

- **json-pruner** — output parses; omitted paths resolve in the original.
- **log-compressor** — every error event in the original is still present.
- **duplicate-eliminator** — grouped content is identical and counts match.
- **section-extractor** — omitted sections do not overlap.
- **code-extractor** — numbered lines match the original; other lines appear in
  original order.

Design decisions: [ADR-0005](../decisions/0005-jsonpath-subset.md) (JSONPath
subset), [ADR-0009](../decisions/0009-code-strategy-diff-text.md) (diffs).

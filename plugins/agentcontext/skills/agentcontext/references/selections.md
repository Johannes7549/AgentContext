# Selections and options cookbook

Each example shows the arguments for one tool call. Selections tell AgentContext
what to keep; everything else becomes a recoverable marker.

## Logs: keep only warnings and errors

`optimize_context`:

```json
{ "content": "<log text>", "source": "command:npm run build", "options": { "selection": { "logs": {} } } }
```

`{}` keeps `error`, `fatal` and `warn` lines. Errors, exceptions, test failures
and their stack frames are always kept. Only errors:

```json
{ "content": "<log text>", "options": { "selection": { "logs": { "levels": ["error"] } } } }
```

## JSON: keep a few fields

```json
{ "content": "<json>", "source": "tool:list_orders", "options": { "selection": { "json": { "include": ["$.orders[*].id", "$.orders[*].status"] } } } }
```

Drop noisy parts instead of picking fields, and cap long arrays:

```json
{ "content": "<json>", "options": { "selection": { "json": { "exclude": ["$.debug", "$.meta.trace"], "maxArrayItems": 20 } } } }
```

JSONPath subset: `$`, `.name`, `['name']`, `[0]`, `[-1]`, `[1:5]`, `[*]`, `.*`.
Filters (`?()`), recursive descent (`..`) and unions are not supported.

## Markdown: keep sections

```json
{ "content": "<markdown>", "source": "file:README.md", "options": { "selection": { "markdown": { "sections": ["Installation", "Configuration"] } } } }
```

Sections match heading text (case-insensitive) or the heading slug, and include
their subsections. Other sections become one-line markers, giving you an outline.

## Any text or code: keep line ranges

```json
{ "content": "<text>", "options": { "selection": { "lines": { "ranges": [{ "start": 120, "end": 160 }], "context": 5 } } } }
```

For files, `read_file` is simpler:

```json
{ "path": "src/billing/invoice.ts", "startLine": 120, "endLine": 160, "contextLines": 5 }
```

## Budgets

```json
{ "content": "<text>", "options": { "maxTokens": 2000 } }
```

`maxTokens` and `targetReduction` (0–1) steer which strategy is used. They never
truncate; if they cannot be met you get a `BUDGET_EXCEEDED` warning. Content that
already fits `maxTokens` is returned unchanged.

## Recovery examples

`retrieve_context`:

```json
{ "contextId": "ctx_01JD0000000000000000000000", "selector": { "type": "segment_id", "value": "s2" } }
```

```json
{ "contextId": "ctx_01JD0000000000000000000000", "selector": { "type": "keyword", "value": "connection refused" }, "contextLines": 3 }
```

```json
{ "contextId": "ctx_01JD0000000000000000000000", "selector": { "type": "json_path", "value": "$.orders[41]" } }
```

```json
{ "contextId": "ctx_01JD0000000000000000000000", "selector": { "type": "line_range", "value": "200-240" } }
```

Results larger than about 1 MB (or `maxTokens`) return `TOO_LARGE` — use a
narrower selector. Keyword results are capped and marked as truncated.

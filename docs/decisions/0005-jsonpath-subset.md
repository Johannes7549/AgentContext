# ADR-0005: In-house restricted JSONPath subset

- **Status:** Accepted
- **Date:** 2026-11-22
- **Task:** AC-002

## Context

JSONPath is used by the JSON pruner (selection, omission locations) and by
retrieval (`json_path` selector). Both must agree exactly on semantics, and
paths come from untrusted agent input. Some widely used JSONPath libraries have
had code-execution vulnerabilities through filter/script expressions, and
implementations historically disagree on edge cases.

## Options

1. **Popular third-party library** — full feature set; larger attack surface; semantics vary.
2. **Full RFC 9535 implementation** (own or third-party) — standard, but filter expressions add complexity and evaluation cost.
3. **In-house restricted RFC 9535 subset.**

## Decision

Option 3. Supported syntax (RFC 9535 semantics):

| Syntax | Meaning |
|---|---|
| `$` | Root |
| `.name` / `['name']` | Member (bracket form allows any key) |
| `[n]` | Array index (negative allowed) |
| `[start:end]` / `[start:end:step]` | Array slice |
| `.*` / `[*]` | Wildcard (members or elements) |

Not supported (rejected with `UNSUPPORTED_JSONPATH`): filter `?()`, script `()`,
descendant `..`, functions, unions with multiple selectors.

- Evaluation returns **normalized paths** (RFC 9535 §2.7 form, e.g. `$['users'][0]['email']`), which are the canonical `json:` locations in omission records.
- No `eval`, no dynamic code; bounded path length and result count.
- Lives in `@agentcontext/shared`.

## Consequences

- + Small, auditable, identical semantics in pruning and retrieval.
- − Users cannot filter by value in v0.1; documented. Descendant/filter support can be added later by a superseding ADR.

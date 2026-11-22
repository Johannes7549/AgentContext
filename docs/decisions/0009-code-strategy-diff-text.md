# ADR-0009: Code strategy works on supplied text and never invokes git

- **Status:** Accepted
- **Date:** 2026-11-23
- **Task:** AC-020

## Context

The roadmap asks for "line ranges and Git diff extraction" in the code
strategy. Strategies must be pure — no I/O, processes, clock or randomness
(ADR-0001) — and command execution is an opt-in adapter with its own security
controls (AC-034).

## Options

1. **Run `git diff` from the strategy** — convenient, but adds process
   execution and repository access to a pure component and bypasses the
   command adapter's allowlist and sandbox.
2. **Parse diff text the caller supplies** — the agent (or the opt-in command
   adapter) produces the diff; the strategy only transforms text.

## Decision

Option 2. The `code-extractor` strategy:

- detects unified diff text (`diff --git` header, or `---`/`+++` headers
  followed by an `@@` hunk header) and tracks hunk boundaries using the line
  counts in each `@@` header, so a removed line beginning with `--` is never
  mistaken for a file header;
- adds a one-line per-file `+/-` summary and collapses unchanged context runs
  longer than 2 × 3 lines, keeping 3 lines next to each change; changed lines,
  file headers and hunk headers are always kept;
- in line-range mode (explicit `selection.lines`) keeps the requested ranges
  with optional context, prefixing each kept line with its original number;
- performs no symbol or AST parsing in v0.1.

## Consequences

- + The strategy stays pure, deterministic and testable from fixtures.
- + Diffs from any source (git, `diff -u`, code review tools) are supported.
- − Obtaining a diff requires a separate step (agent-supplied text, or
  `execute_command` with `git` on its allowlist).

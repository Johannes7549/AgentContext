# ADR-0007: Test layout — co-located unit tests, root integration/e2e

- **Status:** Accepted
- **Date:** 2026-11-22
- **Task:** AC-002

## Context

The roadmap shows all tests under a root `tests/` tree. Turborepo caches tasks
per package; tests living outside their package do not participate in that
caching and blur package boundaries.

## Options

1. **All tests in root `tests/`** (roadmap layout).
2. **All tests co-located** in each package.
3. **Hybrid:** unit tests co-located; cross-package integration and e2e tests at the root.

## Decision

Option 3:

```
packages/<name>/test/**/*.test.ts      unit tests for that package
apps/mcp-server/test/**/*.test.ts      unit tests for tool handlers/adapters
tests/integration/*.test.ts            cross-package (pipeline, recovery, mcp-tools, storage-lifecycle)
tests/e2e/*.test.ts                    full agent workflows
packages/<name>/test/fixtures/         per-package fixtures
benchmarks/datasets/                   benchmark fixtures (shared)
```

- Vitest with a root config using projects; `pnpm test` runs everything, `pnpm --filter <pkg> test` runs one package.
- Fixtures contain no real secrets or personal data.

## Consequences

- + Per-package Turborepo caching and isolation.
- + Integration tests still exercise real package boundaries.
- − Slight deviation from the roadmap layout; documented here.

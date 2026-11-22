# Contributing to AgentContext

Thanks for your interest in improving AgentContext. This guide covers how to set
up the repository, the project's engineering rules, and how changes are reviewed.

## Setup

Requirements: **Node.js ≥ 22.13** and **pnpm 10**.

```sh
pnpm install
pnpm check        # lint + typecheck + test + build — must pass before every PR
```

Useful commands:

```sh
pnpm --filter @agentcontext/core test     # one package's unit tests
pnpm test:integration                     # cross-package tests in tests/integration
pnpm test:coverage                        # everything, with coverage
pnpm lint:fix                             # apply Biome formatting and safe fixes
```

## Before you start

- Read the [product spec](docs/product/PRODUCT_SPEC.md) and [architecture](docs/architecture/ARCHITECTURE.md).
- For anything beyond a small fix, open an issue first so scope can be agreed.
- Features listed as **non-goals** for v0.1 (spec §5) will not be merged into v0.1.

## Engineering rules

1. **Core stays MCP-independent.** Only `apps/mcp-server` may import `@modelcontextprotocol/*`. A lint rule enforces this ([ADR-0001](docs/decisions/0001-package-boundaries.md)).
2. **Contracts are frozen.** Changes to [CONTRACTS.md](docs/architecture/CONTRACTS.md) need an issue, explicit maintainer approval, and an updated document.
3. **Significant decisions get an ADR** in `docs/decisions/` (context → options → decision → consequences).
4. **Deterministic by default.** Strategies are pure: no I/O, clock, randomness, or LLM calls.
5. **Never drop content silently.** Every omission must be recorded with a reason and a location.
6. **No raw content in logs**, and no real secrets or personal data in fixtures.
7. **No unsupported claims.** Savings and accuracy claims must come from the benchmark suite.

## Tests

- Unit tests live next to their package in `packages/<name>/test/` ([ADR-0007](docs/decisions/0007-test-layout.md)).
- Cross-package tests live in `tests/integration/`; full workflows in `tests/e2e/`.
- New behaviour needs tests; bug fixes need a regression test.

## Code style

Formatting and linting are handled by [Biome](https://biomejs.dev/); run
`pnpm lint:fix`. TypeScript runs in strict mode with `noUncheckedIndexedAccess`
and `exactOptionalPropertyTypes`.

## Commits and pull requests

- Keep each pull request focused on one change; avoid unrelated refactors.
- Use clear, imperative commit messages (e.g. `Add JSONPath slice support`).
- Fill in the pull request template, including how you tested the change.
- CI (lint, typecheck, tests, build on Linux and Windows) must pass.

## Reporting security issues

Do **not** open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).

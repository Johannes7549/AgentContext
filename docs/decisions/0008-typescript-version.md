# ADR-0008: TypeScript version

- **Status:** Accepted — confirmed in AC-003 (see Validation below)
- **Date:** 2026-11-22
- **Task:** AC-002

## Context

The npm `latest` tag for `typescript` is **7.0.2** (verified 22 Nov 2026).
TypeScript 7 is the native (Go-based) compiler. Tooling that embeds the
TypeScript compiler API (some lint, test, or declaration-bundling tools) may
not yet be fully compatible.

## Options

1. **TypeScript 7.x** — current, much faster type checking.
2. **TypeScript 6.x** — last JavaScript-based line; maximum tool compatibility.

## Decision

- Target **TypeScript 7.x**.
- AC-003 validates it with the chosen toolchain (Biome, Vitest, Turborepo, declaration emit, project references).
- If any required tool is incompatible, pin the latest **6.x** and record the reason in a superseding ADR.
- Compiler settings (both versions): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module`/`moduleResolution: NodeNext`, ES2023+ target, declaration output.

## Validation (AC-003, 22 Nov 2026)

TypeScript **7.0.2** validated on Node 26.13.1 / Windows 11 with the
`tsconfig.base.json` settings above:

- `tsc -b` on a solution config with project references and `composite` projects — PASS.
- Declaration (`.d.ts`) and declaration-map emit — PASS.
- Strict flags enforced (e.g. `noUncheckedIndexedAccess` error reported) — PASS.
- `node:sqlite` and `node:crypto` types resolve via `@types/node` 22 — PASS.
- Vitest 5.1.1 runs TypeScript test files — PASS.
- Biome 2.6.8 lints and formats TypeScript — PASS.

Note: TS 7 reports `TS18002` for a solution `tsconfig.json` with an empty
`files` list **and no references**; this resolves once package references are
added in AC-004.

No fallback to 6.x needed.

## Consequences

- + Fast type checking on a growing monorepo.
- − Possible ecosystem friction; contained by the AC-003 validation and fallback.

# ADR-0002: Storage — `node:sqlite` metadata + filesystem blobs

- **Status:** Accepted
- **Date:** 2026-11-22
- **Task:** AC-002

## Context

Originals must be stored durably and verifiably before a result claims
recoverability. The roadmap recommends SQLite for metadata and local blobs for
large payloads. The development machine is Windows without native build tools
(no MSVC on PATH); native modules rely on prebuilt binaries.

## Options

1. **`better-sqlite3`** — mature, fast, synchronous; native addon (prebuilds, else needs a C++ toolchain).
2. **`node:sqlite`** (Node built-in) — no dependency, no native build; available unflagged from Node 22.13; verified working without an experimental warning on Node 26.13.1.
3. **WASM SQLite** (e.g. sql.js) — portable but in-memory by default; durability is awkward.
4. **JSON files only** — no query capability, hard to make transactional.

## Decision

- Use **`node:sqlite`** (`DatabaseSync`) for metadata and small payloads, with WAL journal mode.
- Store originals above an inline threshold (initially 64 KiB, tunable) as **content-addressed blobs**: `blobs/<sha256[0:2]>/<sha256>`.
- Blob writes are atomic: write to a temp file in the same directory → fsync → rename. The hash is re-verified after write.
- Metadata rows for a context, its variant, and omissions are written in **one transaction**, after the blob is verified.
- All storage access goes through the `StoragePort` interface ([CONTRACTS.md](../architecture/CONTRACTS.md) §9) so other backends can be added later.
- Minimum Node version: **22.13**.

## Consequences

- + Zero native dependencies; clean installs on Windows without build tools.
- + Content addressing deduplicates identical originals for free.
- − Requires Node ≥ 22.13; users on older Node get a clear engine error.
- − `node:sqlite` API may evolve; storage tests pin behaviour and run on Node 22, 24 and 26 in CI.
- − Blob dedup means deletion must reference-count (handled in AC-026 cleanup).

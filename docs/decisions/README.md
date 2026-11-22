# Architecture Decision Records

Each ADR records one significant decision, the options considered, and its
consequences. ADRs are immutable once **Accepted**; a later ADR may supersede
an earlier one (the old one is then marked **Superseded by ADR-XXXX**).

Format: context → options → decision → consequences.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-package-boundaries.md) | Package boundaries and MCP-independent core | Accepted |
| [0002](0002-storage-node-sqlite-and-blobs.md) | Storage: `node:sqlite` metadata + filesystem blobs | Accepted |
| [0003](0003-tokenization-strategy.md) | Tokenization: pluggable adapters, labelled estimator default | Accepted |
| [0004](0004-mcp-mode-and-sdk-v2.md) | MCP: wrapped tools over stdio using TypeScript SDK v2 | Accepted |
| [0005](0005-jsonpath-subset.md) | In-house restricted JSONPath subset | Accepted |
| [0006](0006-ownership-model.md) | Ownership model: workspace + session scope | Accepted |
| [0007](0007-test-layout.md) | Test layout: co-located unit tests, root integration/e2e | Accepted |
| [0008](0008-typescript-version.md) | TypeScript version (7.x, validated in AC-003) | Accepted |

Two further approved planning decisions will receive ADRs in the tasks that
implement them:

- Code strategy parses supplied unified-diff text and never invokes `git` — AC-020.
- Windows command adapter refuses `.cmd`/`.bat` targets instead of using a shell — AC-034.

Both are already recorded in [PRODUCT_SPEC.md §11](../product/PRODUCT_SPEC.md#11-approved-planning-decisions).

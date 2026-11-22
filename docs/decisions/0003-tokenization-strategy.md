# ADR-0003: Tokenization — pluggable adapters, labelled estimator default

- **Status:** Accepted
- **Date:** 2026-11-22
- **Task:** AC-002

## Context

Token counts are model/provider dependent. The roadmap forbids a mandatory
remote tokenizer or LLM call and forbids presenting estimates as exact or as
billing figures. The core pipeline needs token counts for strategy selection, so
a tokenizer must exist before the pipeline (moved earlier than the roadmap's
Phase 5; approved during planning).

No exact, local, officially published tokenizer is available for current Claude
models.

## Options

1. **Character-based estimator only.** Simple, deterministic, inexact.
2. **Bundle an exact tokenizer (e.g. js-tiktoken)** as default. Exact only for OpenAI encodings; misleading for other models; adds size.
3. **Remote token-counting API.** Violates local-first and no-mandatory-API principles.
4. **Pluggable interface, estimator default, optional exact adapters.**

## Decision

Option 4:

- `Tokenizer` interface with `id`, `version`, `isExact`, `countTokens()` ([CONTRACTS.md](../architecture/CONTRACTS.md) §8).
- Default **`fallback-estimator`**: deterministic heuristic based on character classes (word characters, whitespace, punctuation, non-ASCII) with a documented formula; always `isExact: false`.
- Optional adapters (e.g. js-tiktoken, AC-022) are opt-in peer dependencies, `isExact: true` only for the encodings they implement.
- Each request uses **one** tokenizer for original, optimized, and recovered measurements.
- Every metric carries `tokenizer: { id, version, isExact }`.

## Consequences

- + No network, no API key, deterministic counts.
- + Honest labelling; no billing claims.
- − Estimates can be off by a meaningful margin; benchmark reports state the tokenizer used and the estimator's measured error against a reference set.

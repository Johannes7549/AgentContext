# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). All public `@agentcontext/*`
packages share one version.

## [0.1.0] - 2026-11-23

First public release.

### Added

- **MCP server** (`@agentcontext/mcp-server`, command `agentcontext-mcp`) over
  stdio with the tools `optimize_context`, `retrieve_context`, `read_file`,
  `execute_command` (disabled by default) and `get_optimization_stats`, the
  resources `agentcontext://stats` and
  `agentcontext://context/{contextId}/metadata`, and the
  `agentcontext_guidelines` prompt.
- **Optimization engine** (`@agentcontext/core`): normalize → analyze → select
  → compress → validate → persist, returning the original with a warning on
  every failure path; token budgets (`maxTokens`, `targetReduction`) that never
  truncate.
- **Strategies** (`@agentcontext/strategies`): log compressor, JSON pruner,
  duplicate eliminator, Markdown section extractor and code line-range / diff
  extractor — deterministic, with every omission recorded and recoverable.
- **Storage** (`@agentcontext/storage`): local SQLite metadata (`node:sqlite`)
  plus content-addressed, hash-verified blobs; TTL, quota and cleanup.
- **Retrieval** (`@agentcontext/retrieval`): full original, line range,
  restricted JSONPath, keyword and segment-id recovery, scoped by workspace and
  session, with size limits.
- **Tokenization** (`@agentcontext/tokenization`): deterministic estimator,
  labelled as an estimate.
- **Observability** (`@agentcontext/observability`): content-free structured
  logging with secret masking, persisted per-session statistics.
- **Security**: file access confined to allowed roots (symlink/junction, UNC,
  device-name and alternate-data-stream protection); command execution opt-in,
  allowlisted, without a shell; filtered environment; timeouts, output caps and
  process-tree termination.
- **Benchmarks**: seven reproducible scenarios with a deterministic oracle;
  median reduction 86.6% including recovered content, 100% extraction accuracy,
  100% recovery integrity, 0 unrecoverable omissions.
- Documentation, examples (Claude Code, MCP client, direct API) and CI on
  Linux and Windows with Node 22, 24 and 26.

### Fixed (during development)

- Log compressor: stack frames under exception lines without a level keyword
  were omitted when a level policy was set (found by the benchmark suite).

[0.1.0]: https://github.com/Johannes7549/AgentContext/releases/tag/v0.1.0

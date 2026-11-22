# Known limitations (v0.1)

- **Estimated token counts.** Counts come from a deterministic estimator, not
  your model's tokenizer. They are labelled as estimates and are not billing
  figures.
- **No automatic interception.** AgentContext only optimizes what is passed to
  its own tools; it does not sit in front of other MCP servers (planned for
  v0.2 as a gateway).
- **Agents must use the tools.** Savings depend on the agent calling
  `optimize_context`/`read_file` and retrieving omitted parts when needed. Add
  guidance to your project instructions (see the Claude Code guide).
- **Conservative by default.** Without a selection only exact repeats are
  collapsed; inputs under ~500 estimated tokens are returned unchanged.
- **MCP content blocks** passed as structured block arrays are returned
  unchanged in v0.1 (text passed as a string is optimized normally).
- **JSONPath subset.** Filters (`?()`), recursive descent (`..`) and unions are
  not supported.
- **No code understanding.** The code strategy works on line ranges and diffs;
  there is no symbol or AST parsing.
- **Message size.** Inputs above `maxInputBytes` (8 MiB) return
  `INPUT_TOO_LARGE`; MCP messages above 10 MB are rejected by the stdio
  transport, which closes the connection.
- **Commands on Windows.** `.cmd`/`.bat` shims (npm, pnpm, …) cannot be run
  through `execute_command` because no shell is used.
- **Local storage is not encrypted**; it relies on your OS account permissions.
- **Benchmarks** use synthetic datasets and a deterministic oracle rather than
  live model runs; see [Benchmarking](benchmarking/README.md).

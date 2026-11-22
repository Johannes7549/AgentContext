# Benchmarking

AgentContext's benchmark suite measures **total context** (optimized output
plus anything recovered later), **task success**, **recovery integrity** and
**latency** on reproducible scenarios. The latest results are in
[`benchmarks/reports/latest.md`](../../benchmarks/reports/latest.md)
(machine-readable: `latest.json`).

## Running

```sh
pnpm bench                          # build, run all scenarios (10 iterations), write reports
node benchmarks/dist/run.js --iterations 50 --out ./my-report
pnpm --filter @agentcontext/benchmarks generate   # regenerate datasets (after a build)
```

`pnpm bench` exits with status 1 if any v0.1 target is missed. The same gate
runs in CI through `benchmarks/test/runner.test.ts`.

## Scenarios

Datasets are synthetic, generated deterministically from a seed
(`benchmarks/src/generate.ts`) and committed under `benchmarks/datasets/`. A
test verifies that the committed files equal freshly generated ones.

| Scenario | Input | Options an agent would use | Ground truth |
|---|---|---|---|
| `terminal-large` | ~1,000-line test run with noise, warnings and 2 failures | none (safe policy) | failing tests, errors, locations, summary |
| `terminal-large-levels` | same | `selection.logs` (warn and above) + keyword retrieval | same + the slowest test (an INFO line that must be recovered) |
| `api-responses` | 200-customer JSON response | `selection.json.include` id/email/plan | email of two specific customers |
| `duplicate-heavy` | incident digest with repeated boilerplate | none | 12 unique events, disclaimer count (24) |
| `documentation` | ~30-section handbook | `selection.markdown.sections` + keyword retrieval | default port, EACCES fix, Node version (recovered) |
| `source-code` | 550-line module | `selection.lines` around a known function | signature, tax line, return line |
| `source-diff` | 4-file diff with 20 lines of context per side | none (diff mode) | every changed line |

## Methodology

1. Load the scenario input and options; optimize with the full strategy set
   and local storage, exactly as the MCP server does.
2. Run the scenario's scripted retrieval calls (what an agent would request
   for facts it expects to be omitted) and count the recovered tokens.
3. **Reduction** = 1 − (optimized + recovered) / baseline, using one
   tokenizer for every count.
4. **Task success / extraction accuracy**: a deterministic oracle checks that
   every required fact is present in what the agent saw (optimized output plus
   recovered content). Fact kinds: exact text, a JSON record with expected
   values, or an occurrence count reported by an omission record.
5. **Recovery integrity**: every omitted segment is retrieved by id and
   compared byte-for-byte with an independent slice of the original.
6. **Latency**: optimization time over N iterations; p50 and p95 per scenario.

## Targets (v0.1)

| Target | Goal |
|---|---|
| Median input reduction (including recovery) | ≥ 40% |
| Extraction accuracy | ≥ 95% |
| Recovery integrity | 100% |
| Unrecoverable omissions | 0 |
| Task success, latency | reported, no fixed target |

These are engineering targets, not guarantees. Results — including failures
and regressions — are published as measured.

## Limitations

- Token counts come from the deterministic fallback estimator, not a provider
  tokenizer. They are estimates and are labelled as such.
- Task quality is measured by a deterministic oracle, not by a live model
  (decision Q3). Live-model runs are deferred.
- Retrieval calls are scripted; real agents may retrieve more or less.
- Datasets are synthetic; real-world outputs vary.
- Latency depends on the machine that ran the benchmark.

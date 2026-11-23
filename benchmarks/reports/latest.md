# AgentContext benchmark report

Version 0.1.0 · 2026-11-23T09:28:21.554Z · Node v26.13.1 on win32/x64 · tokenizer `fallback-estimator` (estimated) · 10 iterations per scenario

## Summary

| Target | Goal | Actual | Met |
|---|---|---|---|
| Median input reduction (incl. recovery) | >= 40% | 86.6% | yes |
| Extraction accuracy | >= 95% | 100% | yes |
| Recovery integrity | 100% | 100% | yes |
| Unrecoverable omissions | 0 | 0 | yes |
| Task success rate | (reported) | 100% | — |
| Latency p50 / worst p95 | (reported) | 3.2 ms / 42.1 ms | — |

## Scenarios

Tokens: baseline = original input; optimized = returned content; recovered = content fetched by scripted retrieval calls. Reduction includes recovered tokens.

| Scenario | Strategy | Baseline | Optimized | Recovered | Reduction | Facts | Segments verified | Latency p50/p95 (ms) |
|---|---|---|---|---|---|---|---|---|
| terminal-large | log-compressor | 22049 | 2734 | 0 | 87.6% | 7/7 | 4/4 | 10.8 / 28.7 |
| terminal-large-levels | log-compressor | 22049 | 1085 | 40 | 94.9% | 8/8 | 15/15 | 8.6 / 11.2 |
| api-responses | json-pruner | 42192 | 7902 | 0 | 81.3% | 2/2 | 1002/1002 | 25.2 / 42.1 |
| duplicate-heavy | duplicate-eliminator | 2079 | 1107 | 0 | 46.8% | 13/13 | 3/3 | 1.7 / 2.6 |
| documentation | section-extractor | 10425 | 1367 | 33 | 86.6% | 3/3 | 26/26 | 3.2 / 5.5 |
| source-code | code-extractor | 5376 | 231 | 0 | 95.7% | 3/3 | 2/2 | 2.4 / 6.1 |
| source-diff | code-extractor | 2496 | 1025 | 0 | 58.9% | 4/4 | 8/8 | 1.8 / 3.9 |

## Failures and regressions

None.

## Limitations

- Token counts use the deterministic fallback estimator, not a provider tokenizer; they are estimates.
- Task success is measured by a deterministic oracle (required facts present in what the agent saw), not by a live model.
- Retrieval calls are scripted per scenario to model what an agent would request; real agents may retrieve more or less.
- Datasets are synthetic and generated deterministically; real-world outputs vary.
- Latency covers optimization in-process (including local storage) on the machine that ran the benchmark.

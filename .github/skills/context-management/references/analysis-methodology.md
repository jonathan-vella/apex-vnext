<!-- ref:analysis-methodology-v1 -->

# Context Diagnostics

## Inspect Evidence

1. Establish the requested session, client version and symptom. Inspect only relevant logs and current source.
2. Use [log profiling](log-profiling.md) for measured token counters and tool payload sizes. Use
   `scripts/parse-chat-logs.py` for supported text logs; confirm its command options with `--help`.
3. Trace repeated reads, oversized task responses, missing required input and unexpected model/tool routing to their owner.
4. Separate observations from hypotheses. Latency alone does not identify context size, truncation or model quality.
5. Propose the smallest change with an owner and a falsifying test. Apply changes only within the authorized scope.

## Useful Findings

- Repeated unchanged reads within one task: reuse the current authorized result without weakening freshness checks.
- Duplicate guidance: retain the rule at its existing owner and link consumers to it.
- Overbroad instruction globs or tools: narrow only after checking required client and role behavior.
- Oversized task context: preserve required evidence and use the kernel's selective read operations.
- Incorrect routing: compare observed client/tool behavior with the current manifest, not elapsed time or model stereotypes.

Do not recommend additional workers, model downgrades, persistent caches or automatic snapshots from token counts alone.
Follow the current PRD and roadmap for those decisions. Do not attribute client transport bytes directly to model tokens.

## Report

For each finding, record the observed behavior, relevant source or redacted evidence, impact, proposed change and test.
Mark missing evidence explicitly. Comparisons require comparable workloads and recorded versions; no default benchmark
campaign or automatic before/after capture is required.

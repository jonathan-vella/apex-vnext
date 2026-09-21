<!-- ref:log-profiling-v1 -->

# Log Profiling

Use `tools/scripts/profile_debug_log.py` only on user-selected Copilot Chat OpenTelemetry exports. Output is diagnostic
evidence, not a workflow gate, compliance verdict or approval to change the system.

## Commands

Replace the example path with the selected file:

```sh
python3 tools/scripts/profile_debug_log.py path/to/selected-log.json
python3 tools/scripts/profile_debug_log.py path/to/selected-log.json --json
```

The profiler reports recorded token counters, call durations, model usage, tool payload bytes, repeated reads and errors.
Missing or invalid counters must not be represented as measured zero usage. Some fields may contain paths or selected
log content: review output locally and redact it before sharing. Do not commit raw logs or secrets.

Use `--help` for supported options. Threshold warnings are informational, not requirements to reset chat or batch user
questions. Use observed tokens where present; do not infer tokens or truncation from latency. No multi-session baseline
is required by this procedure.

## Focused Test

```sh
python3 -m pytest tools/tests/test_profile_debug_log.py -q
```

The test uses `tools/tests/fixtures/otel-log-min.json` with redacted paths and deterministic counters. It does not call
models or require access to a real user's logs.

## Client Context And Cache Baseline

This document defines the Milestone O measurement boundary for GitHub Copilot in VS Code and GitHub Copilot CLI. The
repository has fixture-qualified normalization and aggregation. It does not yet contain representative live samples for
either client, so no context reduction or cache improvement claim is permitted.

## Evidence Boundary

The normalized contract is
[`client-context-sample.schema.json`](../../tools/registry/schemas/client-context-sample.schema.json). A sample records:

- supported client ID and observed client version;
- scenario ID, complexity tier, IaC track, and retry state;
- exact input-token, output-token, chat-call, and available cache counters;
- whether the source is a fixture or live operator capture; and
- a deterministic SHA-256 sample ID.

Prompts, responses, messages, transcripts, tool arguments, tool results, credentials, and secrets are prohibited.
Content capture remains disabled. Missing cache counters are `unavailable`; they are never inferred from latency,
token totals, or repeated calls. Aggregates publish totals and averages only when every sample in a group measured
that counter.

## Adapter Status

| Client                 | Raw source status                                                            | Normalized contract |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------- |
| GitHub Copilot VS Code | Existing OTel profiler recognizes exact input-token and output-token fields. | Fixture-qualified   |
| GitHub Copilot CLI     | No raw telemetry shape is characterized in this repository.                  | Fixture-qualified   |

Fixture qualification proves schema, privacy rejection, unavailable handling, and deterministic aggregation. It is not
evidence that either client emitted those measurements. A Copilot CLI adapter must remain unavailable until a supported
local client produces a documented, redacted source shape.

## Operator Procedure

1. Record the installed client ID and version. Do not install or update a client as part of measurement.
2. Run an approved representative scenario with OpenTelemetry content capture disabled.
3. For a characterized VS Code OTel export, create an aggregate-only profile:

   ```bash
   npm run --silent profile:debug-log -- path/to/redacted-otel.json --json --metrics-only > tmp/vscode-profile.json
   ```

4. Inspect the profile for the `apex-debug-profile` format and confirm it contains only `schemaVersion`, `format`, and
   allowlisted aggregate counters under `totals`.
5. Normalize one sample with explicit scenario metadata:

   ```bash
   npm run normalize:client-context-sample -- \
     --source tmp/vscode-profile.json \
     --client github-copilot-vscode \
     --client-version VERSION \
     --scenario-id requirements-standard-bicep \
     --tier standard \
     --iac-track bicep \
     --evidence-kind live \
     --output tmp/vscode-sample.json
   ```

6. Repeat across the approved scenario matrix, retries, tiers, tracks, and both clients. If a client has no
   characterized raw adapter or a metric is absent, record the evidence as unavailable rather than translating or
   estimating it.
7. Aggregate normalized samples deterministically:

   ```bash
   npm run aggregate:client-context-samples -- tmp/*-sample.json --output tmp/client-context-baseline.json
   ```

8. Review normalized output before moving bounded evidence into a candidate dossier. Raw exports and profiles remain
   local and must not be committed.

## Validation

Run `npm run test:client-context-samples`. The suite covers both supported client IDs, schema conformance, deterministic
sample IDs and aggregates, unavailable cache metrics, duplicate samples, invalid counters, unknown clients, and
content-bearing input rejection.

Issue [#121](https://github.com/jonathan-vella/apex-vnext/issues/121) owns this slice. The context baseline remains a gap
until representative live samples exist for both supported clients.

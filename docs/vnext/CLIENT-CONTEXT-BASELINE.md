## Client Context And Cache Baseline

This document defines the Milestone O measurement boundary for GitHub Copilot in VS Code and GitHub Copilot CLI. The
repository has fixture-qualified normalization and aggregation. It does not yet contain representative live samples for
either client, so no context reduction or cache improvement claim is permitted.

## Evidence Boundary

The normalized contract is
[`client-context-sample.schema.json`](../../tools/registry/schemas/client-context-sample.schema.json). A sample records:

- supported client ID and observed client version, plus the Copilot Chat extension version for VS Code;
- scenario ID, complexity tier, IaC track, and retry state;
- exact input-token, output-token, chat-call, and available cache counters;
- the SHA-256 digest of each VS Code source snapshot and the characterized Copilot Chat producer version;
- whether the source is a fixture or live operator capture; and
- a deterministic SHA-256 sample ID.

Prompts, responses, messages, transcripts, tool arguments, tool results, credentials, and secrets are prohibited.
Content capture remains disabled and every aggregate-only profile must carry an explicit operator attestation of that
setting. Missing cache counters are `unavailable`; they are never inferred from latency, token totals, or repeated
calls. Aggregates publish totals and averages only when every sample in a group measured that counter.

## Adapter Status

| Client                 | Raw source status                                  | Contract           |
| ---------------------- | -------------------------------------------------- | ------------------ |
| GitHub Copilot VS Code | Versions `1.130.0` / `0.58.0` JSONL characterized. | Live-characterized |
| GitHub Copilot CLI     | Version `1.0.73` local JSONL characterized.        | Live-characterized |

Fixture qualification proves schema, privacy rejection, unavailable handling, and deterministic aggregation. A bounded
live Copilot CLI sample additionally proves that version `1.0.73` emits exact input, output, and cache-creation token
counters with content capture disabled. It does not provide representative matrix coverage or satisfy the VS Code gate.

## Operator Procedure

1. Record the installed client ID and version. Do not install or update a client as part of measurement.
2. For VS Code, set these application-scoped values in **User Settings (JSON)**. Use a new output filename for each
   scenario; workspace settings are ignored for these values.

   ```jsonc
   "github.copilot.chat.otel.enabled": true,
   "github.copilot.chat.otel.captureContent": false,
   "github.copilot.chat.otel.outfile": "/workspaces/apex-vnext/tmp/vscode-SCENARIO-otel.jsonl"
   ```

3. Confirm the destination is under ignored `tmp/` and does not already exist, then run **Developer: Reload Window**.
   Run only the approved scenario in a fresh chat. Set `github.copilot.chat.otel.enabled` to `false` and reload again to
   flush and stop the exporter before profiling. Do not append another scenario to the same file.
4. Copy the stopped file to an immutable ignored snapshot and record its SHA-256. Raw exports and snapshots remain local.
5. Create an aggregate-only profile with the client-specific adapter:

   ```bash
    # VS Code 1.130.0 / Copilot Chat 0.58.0 local JSONL export
    npm run --silent profile:vscode-otel -- \
       --source tmp/vscode-SCENARIO-otel.snapshot.jsonl \
       --content-capture false \
       --producer-version COPILOT_CHAT_VERSION \
       --output tmp/vscode-SCENARIO-profile.json

   # Copilot CLI 1.0.73 local JSONL export
   npm run --silent profile:copilot-cli-otel -- \
     --source tmp/copilot-cli-otel.jsonl \
     --content-capture false \
     --output tmp/copilot-cli-profile.json
   ```

6. Inspect the profile for the `apex-debug-profile` format and confirm it contains only `schemaVersion`, `format`,
   `content_capture: false`, `source_sha256`, the characterized producer identity, and allowlisted aggregate counters
   under `totals`.
7. Normalize one sample with explicit scenario metadata:

   ```bash
    npm run --silent normalize:client-context-sample -- \
       --source tmp/vscode-SCENARIO-profile.json \
     --client github-copilot-vscode \
       --client-version VS_CODE_VERSION \
       --extension-version COPILOT_CHAT_VERSION \
     --scenario-id requirements-standard-bicep \
     --tier standard \
     --iac-track bicep \
     --evidence-kind live \
       --output tmp/vscode-SCENARIO-sample.json
   ```

8. Repeat across the approved scenario matrix, retries, tiers, tracks, and both clients. If a client has no
   characterized raw adapter or a metric is absent, record the evidence as unavailable rather than translating or
   estimating it.
9. Aggregate normalized samples deterministically:

   ```bash
   npm run aggregate:client-context-samples -- tmp/*-sample.json --output tmp/client-context-baseline.json
   ```

10. Review normalized output before moving bounded evidence into a candidate dossier. Raw exports and profiles remain
    local and must not be committed.

## Validation

Run `npm run test:client-context-samples`. The suite covers both supported client IDs, schema conformance, deterministic
sample IDs and aggregates, unavailable cache metrics, duplicate samples, invalid counters, unknown clients, and
content-bearing input rejection.

Issue [#126](https://github.com/jonathan-vella/apex-vnext/issues/126) owns live collection.
The context baseline remains a gap until representative live samples exist for both supported clients.

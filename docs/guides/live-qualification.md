---
title: "Record vNext Live Qualification"
description: "Bind manual VS Code, GitHub, and Azure qualification evidence to one exact vNext candidate."
---

Use the live qualification record only after deterministic qualification passes. The record binds manual and
cloud-backed results to one repository commit, package lock, release manifest, runtime bundle, and evidence manifest.
The command creates and validates evidence files; it does not invoke VS Code, approve a gate, or call a cloud provider.

> [!IMPORTANT]
> The current record schema reflects the implemented VS Code-era ceremony. It remains useful for characterization, but a
> final `0.10.0` record must also cover Copilot CLI parity and every re-baselined dependency boundary.

## Prepare the Candidate

Install dependencies and produce the release package set from the exact commit under test:

```bash
npm ci
npm run qualify:vnext
npm run pack:vnext
```

Create the template only from a clean Git worktree. The command rejects tracked or untracked files because they are not
represented by the candidate commit.

Before opening either client, generate the exact candidate receipt. This derives repository, branch, commit, package
lock, release manifest, runtime bundle, and customization bundle bindings without creating scenario evidence:

```bash
npm run live:vnext -- candidate \
  --release-manifest dist/vnext-packages/release-manifest.json \
  --output dist/live-qualification/client-candidate.json
```

The command refuses to overwrite its output. On detached `HEAD`, pass `--branch` explicitly; on a named branch, a
different `--branch` value is rejected. The receipt is preparation input only and does not qualify a client scenario.

Candidate repository identity is immutable too. The release manifest must name the same repository as the package
metadata, allowing equivalent HTTPS and SSH Git URL forms. For this release, the live launcher and workflow accept only
`jonathan-vella/apex-vnext`; copying the workflow or a release manifest into another repository does not produce valid
qualification evidence.

Export runtime facts only after the named APEX run exists:

```bash
npm run live:vnext -- runtime \
  --project release-qualification \
  --run candidate-1 \
  --output dist/live-qualification/runtime-evidence.json
```

The runtime adapter verifies the journal chain, embedded project/run identity, owner epochs, regular-file paths, and
content-addressed approval objects. It emits only source-bound task, gate, artifact, accepted-evidence, deployment, and
writer-transfer facts. Unknown payload fields are not copied, and the command refuses to overwrite its output.

This output is adapter evidence, not a client outcome or collector receipt. It cannot prove picker visibility, agent or
skill discovery, MCP inventory, interactive questions, restart behavior, denial responses, or other client-surface
facts. Exact-client adapters and interactive checkpoints must supply those records before scenario composition.

For a consumer workspace initialized with the Copilot CLI projection, bind the executable and installed managed files:

```bash
npm run live:vnext -- cli \
  --workspace ../qualification-consumer \
  --binary /absolute/path/to/copilot \
  --output dist/live-qualification/cli-surface.json
```

The adapter hashes the executable, compares its version and binary digest with the selected CLI inventory, verifies the
CLI customization lock and every managed file byte, and records only MCP server names plus a digest of the bounded JSON
inventory. A version or binary mismatch emits `unavailable` and does not run MCP inspection. Managed-file drift emits
`fail` and also prevents MCP inspection. Raw command output, MCP configuration values, lock source paths, prompts, and
responses are never included.

This adapter does not prove agent-picker visibility, `task.agent_type` membership, interactive `ask_user`, restart, or
model behavior. Those remain explicit later adapters or interactive checkpoints.

For a consumer workspace initialized with the VS Code projection, bind the host, Copilot Chat extension, and managed
files without opening the UI:

```bash
npm run live:vnext -- vscode \
  --workspace ../qualification-consumer \
  --host /absolute/path/to/code \
  --output dist/live-qualification/vscode-surface.json
```

The adapter compares `code --version` and the `github.copilot-chat` entry from
the bounded extension inventory with the selected toolchain, then verifies the
VS Code customization lock and every managed file byte. It records only the
selected and observed host versions, host digest, selected and observed Copilot
Chat versions, and command-output digests. Unrelated extension names and lock
source paths are not emitted. Host, missing-extension, or extension-version
mismatches emit distinct `unavailable` results.

This command does not open VS Code, invoke a model, inspect pickers or question
panels, prove MCP startup, or establish restart/resume behavior. Those remain
explicit interactive checkpoints.

After both consumer projections and the APEX run exist, create one durable
guided checkpoint by re-running every adapter from its authoritative source:

```bash
npm run live:vnext -- checkpoint \
  --release-manifest dist/vnext-packages/release-manifest.json \
  --project release-qualification \
  --run candidate-1 \
  --cli-workspace ../qualification-cli \
  --cli-binary /absolute/path/to/copilot \
  --vscode-workspace ../qualification-vscode \
  --vscode-host /absolute/path/to/code \
  --output dist/live-qualification/guided-checkpoint.json
```

Use separate consumer workspaces because APEX installs exactly one selected
client projection per workspace. Initialize `../qualification-cli` with
`--client github-copilot-cli` and `../qualification-vscode` with
`--client github-copilot-vscode`; do not reuse or switch one workspace between
the paired observations.

The composer does not ingest previously generated adapter JSON. It re-derives
the candidate, runtime, CLI, and VS Code records, validates adapter identities,
and binds them with canonical digests and a deterministic checkpoint ID. Client
failure blocks interaction; unavailable clients block interaction until the
named environment action is complete. Exact adapters produce explicit pending
interactive checkpoints.

The checkpoint never accepts assertions, marks scenarios passed, qualifies
client parity, or qualifies a release. CLI `CLIENT-005` remains an explicit
capability blocker under ADR-0006 even when all automated adapters pass.

To resume preparation later, verify the durable checkpoint while re-running all
sources:

```bash
npm run live:vnext -- checkpoint \
  --release-manifest dist/vnext-packages/release-manifest.json \
  --project release-qualification \
  --run candidate-1 \
  --cli-workspace ../qualification-cli \
  --cli-binary /absolute/path/to/copilot \
  --vscode-workspace ../qualification-vscode \
  --vscode-host /absolute/path/to/code \
  --previous dist/live-qualification/guided-checkpoint.json \
  --output dist/live-qualification/guided-checkpoint-verified.json
```

Resume verifies the prior self-hash and requires its candidate, corpus,
toolchain, project/run, adapter outputs, and canonical adapter digests to match
freshly collected sources exactly. Tampered, stale, or mixed checkpoints are
rejected. Resume does not advance interactive status; an exact resume emits the
same checkpoint ID. Omit `--output` to inspect the verified checkpoint on
standard output without overwriting the prior file.

When the public npm registry is unavailable locally, use an approved registry proxy as a process-scoped override:

```bash
npm_config_registry="$APPROVED_NPM_PROXY" npm ci
```

Do not commit a machine-specific registry in `.npmrc` or rewrite `package-lock.json` to the proxy. The committed lock
remains normalized to the public npm registry so CI and other consumers use the same content-addressed dependencies.

## Create the Evidence Files

Choose the timestamp before creating the template. Reusing the same inputs produces the same JSON bytes except for the
Git commit and artifact hashes that intentionally identify the candidate.

```bash
npm run live:vnext -- template \
  --release-manifest dist/vnext-packages/release-manifest.json \
  --created-at 2026-07-15T08:00:00.000Z \
  --actor maintainer \
  --environment sandbox \
  --target-scope subscription/sandbox \
  --project release-qualification \
  --run candidate-1 \
  --evidence-manifest dist/live-qualification/evidence-manifest.json \
  --output dist/live-qualification/live-qualification.json
```

The command refuses to overwrite either output. Every scenario starts as `unavailable` with an explicit owner and next
action. This prevents an unexecuted scenario from appearing successful. Top-level `createdAt` records template creation;
each scenario records an actual `startedAt` and `completedAt` at or after that instant.

## Execute Human-Owned Scenarios

Update one scenario only after its evidence has been captured and hashed into `evidence-manifest.json`.

| Scenario                      | Required execution and approval boundary                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `vscode-experience`           | A maintainer uses a supported VS Code release to verify discovery, handoffs, questions, hidden workers, and MCP startup.                 |
| `restart-cross-device`        | The user restarts and resumes on another device, then explicitly accepts writer transfer.                                                |
| `github-oidc-writer-transfer` | A maintainer approves the exact preview locally before OIDC CI writer acceptance and apply.                                              |
| `bicep-lifecycle`             | An authorized maintainer approves an isolated sandbox before preview, apply, inventory, diagnosis, recovery, and destroy.                |
| `terraform-lifecycle`         | An authorized maintainer approves the backend and sandbox before exact-plan preview, apply, inventory, diagnosis, recovery, and destroy. |
| `promotion`                   | A reviewer approves the linked environment run and its refreshed Deployment Preview gate.                                                |

For `pass` or `fail`, provide at least one `evidenceRefs[]` hash that exists in the evidence manifest. For
`unavailable`, retain `reason`, `owner`, and `nextAction`. Record actual start/completion timestamps and tool versions.
Never place credentials, tokens, state, saved plans, or raw secret-bearing logs in either JSON file.

The GitHub scenario must prove separate writers: writer A creates and approves the exact preview at epoch $N$, then
creates one transfer claim; writer B accepts at epoch $N+1$ and deploys only that imported approved preview. Capture the
preview hash, transfer claim hash, both epochs, approval hash, recipient-bound provider transfer, and operation
result. A deterministic test pass does not qualify this live boundary, and production workflow enablement remains
blocked until this scenario passes on the release candidate.

## Validate and Render

Validation compares the record with the current Git commit and current artifact bytes. It rejects missing scenarios,
duplicates, invalid timestamps, stale hashes, unknown evidence references, and secret-shaped fields or values.

```bash
npm run live:vnext -- validate \
  --file dist/live-qualification/live-qualification.json \
  --evidence-manifest dist/live-qualification/evidence-manifest.json \
  --release-manifest dist/vnext-packages/release-manifest.json

npm run live:vnext -- render \
  --file dist/live-qualification/live-qualification.json \
  --output dist/live-qualification/live-qualification.md
```

Store accepted evidence only in the approved private evidence boundary. Publication, deployment, approval, and merge to
`main` remain separate maintainer-authorized operations.

The rendered Markdown identifies the project/run and candidate, summarizes outcome counts, and lists each scenario with
its environment, target, and evidence count. It is a review view only; the validated JSON remains authoritative.

## Related

- [Qualify the vNext Preview](testing.md) — run deterministic lanes and the supported manual checklist
- [Operate the vNext Preview](operations.md) — inspect state, transfer writers, and reconcile operations
- [vNext Security](security.md) — preserve authorization, secret handling, and evidence boundaries

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

Prepare fresh, separate consumer workspaces for both selected client projections:

```bash
npm run live:vnext -- prepare \
  --release-manifest dist/vnext-packages/release-manifest.json \
  --root /absolute/path/to/qualification-workspaces \
  --output dist/live-qualification/workspace-preparation.json
```

The preparation command requires a clean Git worktree and a nonexistent absolute root. When `--output` is provided, it
must be outside that root; omit it to emit the receipt to standard output. The command binds the exact candidate,
initializes `cli/` and `vscode/` with their selected projections, verifies each customization lock and managed file, and
records the generated project/run identity plus content-free lock metadata. The successful workspaces remain available
for real client execution. If initialization or receipt emission fails, the command removes the entire preparation root
so a retry cannot inherit mixed state.

The preparation receipt is self-hashed but does not prove client behavior, qualify parity, or qualify a release. Do not
move, reuse, or switch either prepared workspace between client observations.

After qualification evidence has been collected, remove the paired workspaces through the bound cleanup command:

```bash
npm run live:vnext -- cleanup \
  --root /absolute/path/to/qualification-workspaces \
  --preparation dist/live-qualification/workspace-preparation.json
```

Cleanup is not a generic recursive-delete command. It requires the exact self-hashed preparation receipt and the marker
written inside its root. Before deletion it verifies the root has only the marker plus the `cli/` and `vscode/`
workspaces, both selections retain their prepared project/run identities, and every managed projection file still
matches the recorded lock. Outside the reserved `.apex/` runtime namespace, the workspace tree may contain only those
managed files and their parent directories. Substituted receipts, symlinked paths, changed selections, drift, and
unrelated files or directories at any depth all block cleanup without deleting the root.

The command atomically renames the verified root to a same-parent quarantine, verifies the same inode and complete
workspace state again, and only then removes it. A late mutation leaves the quarantine intact; a removal failure
preserves any remaining quarantine data. The command reports that path for manual recovery. Successful cleanup emits a
self-hashed, content-free receipt to standard output; it never qualifies client parity or release.

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

After a real client requests or records typed requirements input, export only the resulting kernel journal facts from
that prepared workspace:

```bash
npm run live:vnext -- input \
  --workspace /absolute/path/to/qualification-workspaces/cli \
  --output dist/live-qualification/cli-input.json
```

Run the same command against the prepared `vscode/` workspace for the paired observation. The adapter verifies the
selected client projection, persisted project/run selection, journal chain and identity, owner epochs, request
supersession, and exact request-to-recorded pairing. It validates question and answer shapes in memory but emits only
client/project/run identity, customization-lock metadata, event and payload hashes, and `pending` or `recorded`
interaction states. Prompts, options, question IDs, answer values, and transcripts are never copied.

This evidence proves that the kernel emitted a typed input request and, when recorded, accepted one exact answer set. It
does not prove that VS Code displayed `vscode/askQuestions` or that Copilot CLI invoked `ask_user`; those client-surface
actions remain user-owned interactive checkpoints. The adapter never qualifies parity or release.

Verify that persisted APEX state survives service reconstruction in either prepared workspace:

```bash
npm run live:vnext -- restart \
  --workspace /absolute/path/to/qualification-workspaces/cli \
  --output dist/live-qualification/cli-restart.json
```

Run the same command against the prepared `vscode/` workspace. The adapter verifies the selected projection and managed
files, creates two distinct `ApexService` instances over the same workspace, and requires their bounded status
projections to match exactly. The journal head and event count are pinned directly before and after both reads, so any
status-side mutation blocks evidence. It emits only client/project/run identity, lock metadata, journal head and event
count, owner epoch, and a digest of task/blocker state. Task names and blocker text are hashed rather than copied.

This evidence proves repository-backed APEX service reconstruction. It does not restart VS Code or Copilot CLI, prove
that either client restored its UI session, or complete the `restart-resume` interactive checkpoint. Those client actions
remain user-owned. The adapter never qualifies parity or release.

Export source-bound writer-transfer state from a prepared workspace after a real transfer request or acceptance:

```bash
npm run live:vnext -- transfer \
  --workspace /absolute/path/to/qualification-workspaces/cli \
  --output dist/live-qualification/cli-transfer.json
```

The adapter verifies the selected projection, persisted run, journal chain, latest transfer request, immutable claim,
accepted run transaction, ownership record, and exact owner-epoch transition. It emits only client/project/run identity,
lock metadata, event and payload hashes, claim hash, owner epochs, status, and an ownership digest. Repository, branch,
commit, workflow, sender, recipient, and approval-environment values are validated in memory but never copied.

This evidence reports `pending` or `accepted` kernel transfer state. It does not perform a transfer, prove which Copilot
client initiated or accepted it, or prove stale-writer denial because rejected attempts are not journaled. Those
cross-client actions remain user-owned interactive checkpoints. The adapter never qualifies parity or release.

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

Run the managed customization lifecycle in fresh disposable workspaces for both
client projections:

```bash
npm run live:vnext -- lifecycle \
  --root /absolute/path/to/disposable-lifecycle \
  --output dist/live-qualification/lifecycle-evidence.json
```

The lifecycle adapter requires a nonexistent absolute root, creates separate CLI
and VS Code workspaces, and exercises init, update, rollback, uninstall, and
reinstall. It verifies selected-client locks, unrelated-file preservation, and
conflict-free rollback/uninstall, then removes the entire disposable root in a
`finally` path. Output must be outside that root. The evidence is deterministic,
content-free, and never qualifies parity or release.

After both consumer projections and the APEX run exist, create one durable
guided checkpoint by re-running every adapter from its authoritative source:

```bash
npm run live:vnext -- checkpoint \
  --release-manifest dist/vnext-packages/release-manifest.json \
  --project release-qualification \
  --run candidate-1 \
  --cli-workspace /absolute/path/to/qualification-workspaces/cli \
  --cli-binary /absolute/path/to/copilot \
  --lifecycle-root /absolute/path/to/disposable-lifecycle \
  --vscode-workspace /absolute/path/to/qualification-workspaces/vscode \
  --vscode-host /absolute/path/to/code \
  --output dist/live-qualification/guided-checkpoint.json
```

Use the `cli/` and `vscode/` directories produced by `prepare`, or independently initialized equivalent workspaces.
APEX installs exactly one selected client projection per workspace; do not reuse or switch one workspace between the
paired observations.

The composer does not ingest previously generated adapter JSON. It re-derives
the candidate, runtime, CLI, VS Code, input-journal, restart, writer-transfer,
and lifecycle records, validates adapter identities, and binds them with
canonical digests and a deterministic checkpoint ID. Client failure blocks
interaction; unavailable clients block interaction until the named environment
action is complete. Exact adapters produce explicit pending interactive
checkpoints. CLIENT-009 is automated and no longer appears as an interactive
wait.

For the CLI and VS Code input checkpoints, `kernelStatus` reports whether the
bound journal is still `pending` or has a `recorded` answer event. The checkpoint
status remains `pending` in both cases because journal evidence does not prove
that the corresponding client UI interaction occurred. A newly recorded event
changes the checkpoint ID and makes an older resume checkpoint stale.

The central runtime adapter and the two prepared client workspaces intentionally
use separate run identities. Each input run is bound through its workspace's
persisted selection, exact qualification project/client identity, and the same
customization-lock digest verified by that client's surface adapter. The
composer must not require the three generated run IDs to be equal.

The paired `restart-resume` checkpoint includes `serviceStatus: observed` only
when both prepared workspaces pass fresh APEX service reconstruction evidence.
Its interaction `status` remains `pending`: service reconstruction does not prove
that VS Code or Copilot CLI restarted or restored a UI session. Any changed
restart state digest changes the checkpoint ID and invalidates an older resume.

The paired `writer-transfer` checkpoint includes `transferStatus: accepted` only
when both prepared client runs contain fresh, accepted transfer evidence. Each
adapter must share the exact run identity and customization lock of that client's
input, restart, and surface adapters, and its accepted owner epoch must increment
the request epoch by one. A pending transfer in either workspace keeps the paired
status pending. The interaction `status` also remains `pending`: kernel transfer
state does not prove which client initiated or accepted the transfer, or that the
stale writer was rejected. Any changed transfer state changes the checkpoint ID
and invalidates an older resume.

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
  --cli-workspace /absolute/path/to/qualification-workspaces/cli \
  --cli-binary /absolute/path/to/copilot \
  --lifecycle-root /absolute/path/to/disposable-lifecycle \
  --vscode-workspace /absolute/path/to/qualification-workspaces/vscode \
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

After the authoritative collector has produced one live outcome for each client
and scenario, create a strict path manifest relative to its own directory:

```json
{
  "schemaVersion": "1.0.0",
  "outcomes": [
    {
      "scenarioId": "CLIENT-001",
      "clientId": "github-copilot-vscode",
      "outcomePath": "outcomes/CLIENT-001-vscode.json"
    }
  ]
}
```

The real manifest must contain exactly one VS Code and one Copilot CLI outcome
for every scenario. Compose the comparison and aggregate closure into a new
directory:

```bash
npm run compose:vnext-client-closure -- \
  dist/live-qualification/client-closure \
  dist/live-qualification/client-outcomes.json
```

The composer accepts only path-contained, collector-generated live outcomes. It
rejects incomplete, duplicate, fixture-mixed, unavailable, failed, mismatched,
or preexisting output before publishing. It generates canonical outcome copies,
one comparison per scenario, the verified parity qualification, and a self-hashed
`closure.json` index. The output remains parity-only:
`qualifiesClientParity` is true and `qualifiesRelease` is false.

This closure is not yet an evidence manifest. Final binding must also supply and
validate every immutable runtime journal, attestation, artifact, and evidence
payload referenced by the outcomes. Do not add the client qualification to live
release evidence until `validate` accepts that complete payload closure.

To bind that complete payload set, create a path-contained binding manifest:

```json
{
  "schemaVersion": "1.0.0",
  "candidatePath": "client-candidate.json",
  "evidenceManifestPath": "evidence-manifest.json",
  "evidencePayloadPaths": ["runtime/journal-source.json"],
  "clientClosurePath": "client-closure/closure.json"
}
```

The base evidence manifest must not already contain client outcomes,
comparisons, or a client qualification. List every payload declared by that base
manifest. Bind into a new private directory:

```bash
npm run bind:vnext-client-evidence -- \
  dist/live-qualification/bound-client-evidence \
  dist/live-qualification/evidence-binding.json
```

The binder verifies the candidate shape, base manifest schema, closure self-hash,
canonical qualification bytes, every declared hash and size, full comparison and
outcome closure, exact project/candidate binding, and all independently supplied
runtime payloads. It publishes only after `validateEvidencePayloads` returns no
findings. The output contains the combined `evidence-manifest.json`, immutable
payloads named by SHA-256, and a self-hashed `binding.json` index.

Binding proves complete client-parity evidence but still sets
`qualifiesRelease: false`. Release qualification, deployment, publication, tags,
and cutover remain separate maintainer-authorized operations.

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

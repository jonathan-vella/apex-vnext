---
title: "vNext CLI and MCP Reference"
description: "Use every implemented APEX vNext CLI command and narrow MCP tool with stable JSON handling."
---

Run `apex <command> --json` for automation. Success is written to stdout as
`{"ok":true,"result":...}`. Failure is written to stderr as
`{"ok":false,"error":{"code":"...","message":"...","details":...}}`.

## Handle Stable Errors

| Exit | Error code           | Meaning                                                                |
| ---- | -------------------- | ---------------------------------------------------------------------- |
| `0`  | Success              | The command completed.                                                 |
| `2`  | `APEX_USAGE`         | A command, flag, or input shape is invalid.                            |
| `3`  | `APEX_NOT_FOUND`     | The selected resource or artifact does not exist.                      |
| `4`  | `APEX_CONFLICT`      | A managed file or staged output conflicts with current content.        |
| `5`  | `APEX_VALIDATION`    | A schema, policy, provider, or task constraint failed.                 |
| `6`  | `APEX_STALE`         | A hash, task, preview, lease, epoch, or Git head is no longer current. |
| `7`  | `APEX_AUTHORIZATION` | The requested transition lacks an approval or capability grant.        |
| `10` | `APEX_INTERNAL`      | An unexpected failure was normalized at the CLI boundary.              |

## Use Implemented CLI Commands

| Command                           | Required or notable flags                                     | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apex version`                    | `--json`                                                      | Report CLI, customization bundle, and config versions.                   |
| `apex init`                       | `--project`; see initialization flags below                   | Initialize project state and customizations.                             |
| `apex update`                     | Optional `--customizations-source`                            | Three-way update managed workspace files.                                |
| `apex setup`                      | Optional `--live`                                             | Run readiness checks; live mode checks Azure CLI authentication.         |
| `apex doctor`                     | Optional `--fix --yes`                                        | Diagnose setup and optionally repair managed files and the runtime lock. |
| `apex capability list`            | Optional `--manifest`                                         | List capability-pack availability and installation state.                |
| `apex capability status`          | `--pack`; optional `--manifest`                               | Show one capability pack's actionable state.                             |
| `apex capability install`         | `--pack --yes`; optional `--manifest --cache`                 | Install and verify a digest-pinned pack.                                 |
| `apex capability update`          | `--pack --yes`; optional `--manifest --cache`                 | Transactionally replace a pack.                                          |
| `apex capability verify`          | `--pack`; optional `--manifest`                               | Verify installed files, locks, and entrypoints.                          |
| `apex capability rollback`        | `--pack --yes`; optional `--manifest`                         | Restore the previously verified pack.                                    |
| `apex capability uninstall`       | `--pack --yes`; optional `--manifest`                         | Remove current and rollback copies.                                      |
| `apex project list`               | None                                                          | List initialized projects.                                               |
| `apex project use`                | `--project`; optional `--run`                                 | Select a project and run.                                                |
| `apex project show`               | Optional `--project`                                          | Show a project or the current project and run.                           |
| `apex project search`             | `--query`                                                     | Search project identity and journal event content.                       |
| `apex project history`            | Optional `--limit`                                            | Read recent selected-run events.                                         |
| `apex state transfer-export`      | `--claim --file --recipient --ttl-seconds --yes`              | Encrypt selected state.                                                  |
| `apex state transfer-import`      | `--file --recipient --yes`                                    | Validate and import selected state.                                      |
| `apex provider transfer-export`   | `--preview --provider --file --recipient --ttl-seconds --yes` | Encrypt exact provider authority.                                        |
| `apex provider transfer-import`   | `--file --recipient --yes`                                    | Validate and import exact provider authority.                            |
| `apex status`                     | None                                                          | Read selected-run state, journal head, task, and blockers.               |
| `apex task next`                  | None                                                          | Request the next constrained task or required input.                     |
| `apex task context`               | `--task`                                                      | Read a task envelope, accepted inputs, staging root, and blockers.       |
| `apex task complete`              | `--task --file`; see output flags below                       | Accept one output or repeated files.                                     |
| `apex task complete-bundle`       | `--task --file`                                               | Accept `outputs[]` from one JSON bundle.                                 |
| `apex task cancel`                | `--task`                                                      | Cancel an issued task.                                                   |
| `apex task stage-file`            | `--task --path --file`; optional `--sha`                      | Stage an allowed code-generation file.                                   |
| `apex task generate-iac`          | `--task`                                                      | Generate the selected IaC track in the bounded staging tree.             |
| `apex review resolve`             | `--file`                                                      | Record a review-finding resolution from JSON.                            |
| `apex gate decide`                | `--gate --decision --actor`; optional Gate 4 `--recipient`    | Approve or reject an open gate.                                          |
| `apex validate`                   | None                                                          | Validate and cache the current journal/runtime-lock result.              |
| `apex preview`                    | `--operation --provider`; optional `--recipient`              | Create a bound preview and open Gate 4.                                  |
| `apex approval show`              | None                                                          | Read the current Gate 4 approval as structured JSON.                     |
| `apex deploy`                     | Optional `--preview`                                          | Execute the current approved preview and collect inventory.              |
| `apex reconcile`                  | None                                                          | Reconcile the recorded deployment from inventory.                        |
| `apex inventory`                  | None                                                          | Read the latest deployment inventory.                                    |
| `apex diagnose`                   | None                                                          | Return selected-run status and doctor results.                           |
| `apex render`                     | `--kind`; see values below                                    | Render a deterministic Markdown view.                                    |
| `apex promote`                    | `--environment --target`                                      | Create and select a linked environment run.                              |
| `apex writer transfer-create`     | See writer flags below                                        | Create a bound writer-transfer claim.                                    |
| `apex writer transfer-accept`     | `--claim --recipient --head`                                  | Accept a current writer-transfer claim.                                  |
| `apex writer show`                | None                                                          | Show current writer ownership.                                           |
| `apex evidence accept`            | `--kind --content-type`; see input flags below                | Validate and accept evidence.                                            |
| `apex telemetry consent`          | `--value` true/false                                          | Set optional telemetry consent.                                          |
| `apex telemetry export`           | None                                                          | Export accepted telemetry or `null`.                                     |
| `apex telemetry delete`           | None                                                          | Delete optional telemetry.                                               |
| `apex cache status`               | None                                                          | Count deterministic cache entries.                                       |
| `apex cache clear`                | None                                                          | Invalidate the deterministic cache.                                      |
| `apex quality evaluate`           | `--measurements`; optional `--scorecard`                      | Evaluate measurements against a scorecard.                               |
| `apex quality status`             | None                                                          | Read the latest quality evaluation.                                      |
| `apex quality observe`            | `--file` or `--value`                                         | Submit one structured, redacted observation.                             |
| `apex quality scan`               | None                                                          | Detect recurring patterns and write inert proposals.                     |
| `apex quality observations`       | None                                                          | Read observations for the selected project.                              |
| `apex quality proposals`          | None                                                          | Read inert proposals for the selected project.                           |
| `apex quality decide`             | Proposal, actor, decision, rationale, and `--yes`             | Record a human accept/reject/defer decision.                             |
| `apex quality delete-observation` | Observation and `--yes`                                       | Delete one observation by ID.                                            |
| `apex quality prune`              | `--yes`                                                       | Apply policy retention to observations and decisions.                    |
| `apex mcp serve`                  | None                                                          | Serve the APEX MCP protocol over standard input/output.                  |

The compact rows above expand to these exact accepted flags and values:

```text
init: --project; optional --name, --environment, --target, --iac, --customizations-source
task complete: --task, --file; single output also needs --kind; optional --summary
review resolve: --file
gate decide: --gate --decision --actor; optional --mechanism tty and Gate 4 --recipient
preview: --operation apply|destroy --provider fake|bicep|terraform; optional --recipient
render: --kind status|requirements|preview|approval|inventory
capability install/update: --pack --yes; optional --manifest, --cache
capability status/verify: --pack; optional --manifest
capability rollback/uninstall: --pack --yes; optional --manifest
quality evaluate: --measurements; optional --scorecard
quality observe: exactly one of --file or --value
quality decide: --proposal --actor --decision accepted|rejected|deferred --rationale --yes; optional --external-ref
quality delete-observation: --observation --yes
quality prune: --yes
writer transfer-create: --repo --branch --commit --workflow --sender --recipient --head --ttl; optional --environment
state transfer-export: --claim --file --recipient --ttl-seconds --yes
state transfer-import: --file --recipient --yes
provider transfer-export: --preview --provider bicep|terraform --file --recipient --ttl-seconds --yes
provider transfer-import: --file --recipient --yes
evidence accept: --kind --content-type and exactly one of --file or --value; optional --required
```

## Operate Bounded Improvement

Observations are structured JSON. `evidenceRefs` contains existing SHA-256 evidence identifiers, not raw logs or
secrets. The selected run supplies `projectId` and `runId`.

```json
{
  "source": "validation-failure",
  "category": "correctness",
  "severity": "medium",
  "statement": "Validator command ownership was duplicated.",
  "evidenceRefs": ["0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]
}
```

```bash
apex quality observe --file observation.json --json
apex quality scan --json
apex quality proposals --json
apex quality decide \
  --proposal "$PROPOSAL_ID" \
  --actor local-maintainer \
  --decision rejected \
  --rationale "The pattern is valid but the proposed target is too broad." \
  --yes --json
```

Scanning creates only inert proposal records. Accepting a proposal records human intent; it does not edit a file,
create an issue or pull request, inject model context, approve a gate, or deploy. Use the normal reviewed contribution
workflow for any follow-up implementation.

Run `apex quality delete-observation --observation "$OBSERVATION_ID" --yes --json` for an explicit deletion. Run
`apex quality prune --yes --json` to enforce policy retention. These operations are intentionally absent from MCP.

State transfer export packages only the current selection, its project and run, top-level runtime JSON, the runtime
lock, and transitively referenced content-addressed objects. It excludes local keys, work/cache data, provider config,
capability-pack source, other projects, and other runs. Import validates and preflights the entire encrypted bundle
before writing mode-`0600` files. It refuses differing destinations and permits byte-identical idempotent retries.

Import does not accept writer authority. After reviewing the imported claim, run `apex writer transfer-accept` with the
claim hash, recipient, and current Git head.

Provider transfer export packages only `bindings/<preview-hash>.json` and, for Terraform, the encrypted artifact whose
path is derived from the binding's `artifactRef` plus its generated local plan key. It excludes latest pointers,
plaintext plans, and all unrelated runtime files. Import validates the bound bundle, exact authority bindings, file
hashes, and binding/artifact cross-links before atomic mode-`0600` writes under `.apex/local/provider-runtime/`. It does
not approve Gate 4 or deploy. Separate-job Terraform apply and destroy transport passed live qualification.

Gate 4 is approved locally for the exact intended execution recipient before writer transfer:

```bash
apex gate decide \
  --gate 4 \
  --decision approved \
  --actor local-maintainer \
  --recipient "$RECIPIENT" \
  --json
```

CI imports this approval with state and exact provider authority. `apex approval show --json` verifies the imported
decision, preview, recipient, epoch, and expiry. CI does not expose a command path that creates or replaces approval in
the qualification workflow.

For separate Terraform preview and apply writers, pass the intended apply identity during preview:

```bash
apex preview --operation apply --provider terraform --recipient "$APPLY_RECIPIENT" --json
```

The preview writer may create one transfer claim only after local approval. The recipient accepts it at the next owner
epoch, and deploy proves the exact preview, approval, and one-hop lineage. A claim created before approval, a second
transfer, a nonconsecutive epoch, or a different claim remains stale. Ownership-only transfer does not change the
dependency revision; target, runtime lock, or accepted artifact changes do.

## Use Narrow MCP Tools

The managed agents receive only tools declared in their definitions. The MCP server implements these exact names:

| Tool                      | Input                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| `status`                  | None                                                                          |
| `nextTask`                | None                                                                          |
| `taskContext`             | `taskId`                                                                      |
| `recordRequirementsInput` | `value`                                                                       |
| `stageArtifact`           | `taskId` plus `kind`/`value` or `outputs[]`; optional summaries               |
| `stageFile`               | `taskId`, safe relative `path`, and `content`; optional `expectedSha`         |
| `generateIac`             | `taskId`; optional existing resources, provider constraints, and lock content |
| `validateTask`            | `taskId`; optional single output or `outputs[]`                               |
| `completeTask`            | `taskId` plus a single output or `outputs[]`                                  |
| `reviewResolve`           | `reviewId`, `resolution`                                                      |
| `gateDecide`              | `gate`, approved/rejected decision, and `actor`                               |
| `preview`                 | apply/destroy operation and fake/bicep/terraform provider                     |
| `deploy`                  | Optional `previewHash`                                                        |
| `reconcile`               | None                                                                          |
| `inventory`               | None                                                                          |
| `diagnose`                | None                                                                          |
| `render`                  | status/requirements/preview/approval/inventory kind                           |
| `promote`                 | `environment`, `target`                                                       |
| `doctor`                  | Optional `fix`, `yes`                                                         |
| `submitEvidence`          | `taskId`, `kind`, JSON object `value`; optional `required`                    |
| `improvementObserve`      | Structured source, category, severity, statement, and evidence references     |
| `improvementObservations` | None                                                                          |
| `improvementProposals`    | None                                                                          |

Tool results contain both JSON text content and structured content. Agents should pass hashes and task IDs exactly as
returned rather than reconstructing them from prose.

## Follow Safe Examples

```bash
apex status --json
apex task next --json
apex preview --operation apply --provider fake --json
apex gate decide --gate 4 --decision approved --actor local-user --json
apex deploy --preview "$PREVIEW_HASH" --json
```

See [operations](operations.md) for native provider configuration and [security](security.md) before deployment.

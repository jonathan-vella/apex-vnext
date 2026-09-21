# CLI Commands

> [Current Version](../../VERSION.md) | Implemented APEX vNext command groups and error behavior.

The packaged executable is `apex`. Human `status` and `doctor` output is concise by default. Add `--verbose` for full
human-readable detail or `--json` to receive `{ "ok": true, "result": ... }` or a structured error.
Commands that change installation, capability, transfer, or improvement state may require `--yes`.

## Lifecycle

| Command                         | Required or notable flags                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apex version`                  | None                                                                                                       |
| `apex init`                     | `--project`; optional `--name --environment --target --iac --client --customizations-source`               |
| `apex bootstrap`                | `--project` or `--file`; `--yes`; optional client, name, environment, target, IaC, and repo creation flags |
| `apex profile status`           | Optional VS Code client selection                                                                          |
| `apex profile install`          | `--yes`; optional VS Code client selection                                                                 |
| `apex profile update`           | `--yes`; optional VS Code client selection                                                                 |
| `apex profile uninstall`        | `--yes`; optional VS Code client selection                                                                 |
| `apex project create`           | `--project`; optional `--name --environment --target --iac`                                                |
| `apex project promote`          | `--environment --target`                                                                                   |
| `apex update`                   | Optional `--customizations-source`                                                                         |
| `apex setup`                    | Optional `--live`                                                                                          |
| `apex doctor`                   | Optional `--fix --yes`                                                                                     |
| `apex customizations rollback`  | None                                                                                                       |
| `apex customizations uninstall` | None                                                                                                       |
| `apex customizations reinstall` | Optional `--customizations-source`                                                                         |

`--client` accepts the bundled VS Code or Copilot CLI projection ID. `--iac terraform` selects Terraform; otherwise
initialization selects Bicep.

`apex bootstrap` is the end-user entry point. It requires confirmation, creates a Git repository only with
`--create-repo`, installs the exact CLI as a workspace `devDependency`, and then delegates projection and state setup
to `apex init`. Supply either command flags or a strict onboarding configuration file. Profile commands manage only
the optional VS Code user-profile bootstrap agent; GitHub Copilot CLI uses `apex bootstrap` directly.

Initialize a customer workspace once, then create additional independently governed workloads with
`apex project create`. The shared client projection is installed only by `apex init`; project creation adds a project,
its first run, and its selected IaC track under the existing `.apex` state.

Each project can have multiple environment-scoped runs. Use `apex project promote` after Gates 1 through 3 are approved
to create a linked run for the next environment. It inherits only still-valid upstream proof and always requires a
new preview and Gate 4 approval.

## Archetype Source Reuse

`apex archetype list --repository LOCAL_GIT_ROOT --revision FULL_COMMIT_ID --path CATALOG_DIRECTORY --json`
lists immediate candidate directories at an exact local commit. The catalog is bounded to 256 entries, excludes hidden
authority directories, returns no file contents, and does not fetch remote objects. Every candidate still requires
inspection; directory discovery does not establish workload completeness or safe reusable content.

`apex archetype inspect --repository LOCAL_GIT_ROOT --revision FULL_COMMIT_ID --path ARCHETYPE_DIRECTORY --json`
reads one committed subtree without checkout, hooks, filters, remote fetches or source execution. Missing local Git
objects cause inspection to fail. It returns a typed proposal with
relative paths, content hashes, exclusion reasons and a `contentHash`; it does not return file contents or mutate state.

After reviewing that selection, use:

```bash
apex archetype import --repository LOCAL_GIT_ROOT --revision FULL_COMMIT_ID --path ARCHETYPE_DIRECTORY \
  --destination NEW_DIRECTORY --expected-hash PROPOSAL_HASH --yes --json
```

The destination is a new top-level directory in the current workspace, named with lowercase letters, digits and hyphens.
The source is reinspected and must match the confirmed proposal. Exclusive directory creation prevents replacement of
an existing destination. Concurrent APEX imports are serialized; an interrupted import lock requires inspection, not
automatic deletion. Failed or interrupted copies remain in place for inspection and are not overwritten on retry.
The origin record is written only after all selected files have been copied successfully.

The copy includes an inert `.apex-origin.json` provenance record and requires consumer review. Source `.apex` history,
Terraform state/saved plans, credential files and agent instructions are excluded. Supported reusable files are
non-executable UTF-8 Markdown, Bicep, Terraform and JSON, bounded to 256 tree entries, 1 MiB per file and 8 MiB total.
Known credential patterns and JSON authority fields are rejected; this screening is not an exhaustive secret scanner.
Review all exclusions and content before use. Source prose remains untrusted design input, never execution authority.

This initial path requires a local Git repository and exact commit. It does not clone or discover remote catalogs,
synchronize updates, recover confirmed decisions automatically, or refresh consumer governance. Do not use state
transfer as a substitute for archetype import. See [project operation](../how-to/operate-project.md#reuse-a-local-archetype).

## Requirements Adoption And Change

Use a consumer-scoped `requirements-v1` JSON document to recover decisions from imported or manually copied code and
documents. Review that document before confirmation; source statements are design input, not consumer approval or
deployment evidence. After initializing the consumer run:

```bash
apex requirements preview-adoption --file requirements.json --reason "Recover workload decisions" --json
apex requirements adopt --file requirements.json --reason "Recover workload decisions" --expected-hash PROPOSAL_HASH --yes --json
```

For a run with accepted requirements, use `requirements preview-change` and `requirements revise` with the same flags.
The preview reports changed and retained requirement IDs, affected workflow stages and gates, and areas requiring
reassessment. It does not calculate revised costs or claim policy compliance. Confirmation binds the exact candidate,
reason, run, journal head and writer epoch. In-flight or indeterminate deployments block revision.

Confirmed decisions become the next Requirements task template without repeating the original intake. Task acceptance
must match that candidate and still routes through Requirements review. Downstream reviews, governance, preview and
approvals must be regenerated where the locked workflow invalidates them. Confirmation never authorizes deployment.

Generated review documents and diagrams retain their last generated bytes. Unchanged outputs are not rewritten;
manual edits or missing generation baselines block replacement. Resolve conflicts explicitly before retrying: preserve
the edited document separately and incorporate its decisions into a newly confirmed candidate, or deliberately restore
the prior generated content. Regeneration also verifies the previous accepted IaC tree before staging or accepting a
replacement; changed, missing or unsafe source files block the operation. Existing task-specific source directories
remain intact. APEX does not automatically merge prose into requirements or synchronize arbitrary code.

## Workflow

| Command                     | Required or notable flags                                     |
| --------------------------- | ------------------------------------------------------------- |
| `apex status`               | None                                                          |
| `apex task next`            | None                                                          |
| `apex task context`         | `--task`                                                      |
| `apex task complete`        | `--task --file`; each output file contains `kind` and `value` |
| `apex task complete-bundle` | `--task --file`                                               |
| `apex task cancel`          | `--task`                                                      |
| `apex task stage-file`      | `--task --path --file`; optional `--sha`                      |
| `apex task generate-iac`    | `--task`                                                      |
| `apex review resolve`       | `--file`                                                      |
| `apex gate decide`          | `--gate --decision --actor`; optional `--recipient`           |
| `apex validate`             | None                                                          |

## Projects And Operations

| Command                | Required or notable flags                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `apex project list`    | None                                                                                             |
| `apex project use`     | `--project`; optional `--run`                                                                    |
| `apex project show`    | Optional `--project`                                                                             |
| `apex project search`  | `--query`                                                                                        |
| `apex project history` | Optional `--limit`                                                                               |
| `apex preview`         | `--operation` with apply/destroy; `--provider` with fake/Bicep/Terraform; optional `--recipient` |
| `apex approval show`   | None                                                                                             |
| `apex deploy`          | Optional `--preview`                                                                             |
| `apex reconcile`       | None                                                                                             |
| `apex inventory`       | None                                                                                             |
| `apex diagnose`        | None                                                                                             |
| `apex render`          | `--kind` with status, requirements, preview, approval, inventory, deployment-summary, architecture-decisions, or operations-runbook |

Only a human-authorized operator should run gate or deployment mutations. A preview must match the selected IaC track.

`apex render --kind deployment-summary` projects the latest completed operation with its exact inventory and approval
bindings. It labels simulated and native-adapter evidence separately, omits arbitrary resource properties, and reports
operational evidence gaps. It does not query Azure, establish live execution independently, or authorize another operation.

`apex render --kind architecture-decisions` renders explicit `decisionRecords` from accepted Architecture data, including
requirement links, alternatives, consequences, WAF impacts and implementation notes. Missing structured records return
an unavailable error. Acceptance as an Architecture artifact is not Gate 2 approval or proof of implementation.

`apex render --kind operations-runbook` projects optional `operationalHandoff` data from accepted Diagnosis: ownership,
escalation, access prerequisites, configuration references, health checks, monitoring, incident response, rollback,
recovery and limitations. Health checks must reference the recorded inventory and only task-pinned evidence.
Procedures are explicitly untested, or not applicable with a rationale. Rendering neither runs procedures nor establishes
that checks passed. Submit handoff data through the existing diagnosis task's typed output; missing data remains unavailable.

## Capabilities, Transfers, Evidence, And Quality

Capability commands are `list`, `status`, `install`, `update`, `rollback`, `verify`, and `uninstall`. Mutating commands
require `--pack` and confirmation. Optional packs remain outside the core runtime until a declared workflow needs them.

State and provider transfer commands use explicit files, recipients, claims or previews, and positive TTLs. Writer
commands create, accept, and show single-writer transfer claims. Evidence, telemetry, cache, and quality command groups
provide their named bounded operations.

## Exit Codes

| Code | Error                |
| ---: | -------------------- |
|    0 | Success              |
|    2 | `APEX_USAGE`         |
|    3 | `APEX_NOT_FOUND`     |
|    4 | `APEX_CONFLICT`      |
|    5 | `APEX_VALIDATION`    |
|    6 | `APEX_STALE`         |
|    7 | `APEX_AUTHORIZATION` |
|   10 | `APEX_INTERNAL`      |

## Authority

- [`packages/cli/src/cli.ts`](../../packages/cli/src/cli.ts)
- [`packages/cli/src/errors.ts`](../../packages/cli/src/errors.ts)
- [Generated command inventory](cli-commands.generated.md)

## Related

- [MCP tools](mcp.md)
- [Complete the first local run](../tutorials/first-run.md)
- [Operate a project](../how-to/operate-project.md)

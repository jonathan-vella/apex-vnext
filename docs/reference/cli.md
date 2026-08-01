# CLI Commands

> [Current Version](../../VERSION.md) | Implemented APEX vNext command groups and error behavior.

The packaged executable is `apex`. Add `--json` to receive `{ "ok": true, "result": ... }` or a structured error.
Commands that change installation, capability, transfer, or improvement state may require `--yes`.

## Lifecycle

| Command                         | Required or notable flags                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `apex version`                  | None                                                                                         |
| `apex init`                     | `--project`; optional `--name --environment --target --iac --client --customizations-source` |
| `apex project create`           | `--project`; optional `--name --environment --target --iac`                                  |
| `apex project promote`          | `--environment --target`                                                                     |
| `apex update`                   | Optional `--customizations-source`                                                           |
| `apex setup`                    | Optional `--live`                                                                            |
| `apex doctor`                   | Optional `--fix --yes`                                                                       |
| `apex customizations rollback`  | None                                                                                         |
| `apex customizations uninstall` | None                                                                                         |
| `apex customizations reinstall` | Optional `--customizations-source`                                                           |

`--client` accepts the bundled VS Code or Copilot CLI projection ID. `--iac terraform` selects Terraform; otherwise
initialization selects Bicep.

Initialize a customer workspace once, then create additional independently governed workloads with
`apex project create`. The shared client projection is installed only by `apex init`; project creation adds a project,
its first run, and its selected IaC track under the existing `.apex` state.

Each project can have multiple environment-scoped runs. Use `apex project promote` after Gates 1 through 3 are approved
to create a linked run for the next environment. It inherits only still-valid upstream proof and always requires a
new preview and Gate 4 approval. `apex promote` remains available as a compatibility alias.

## Workflow

| Command                     | Required or notable flags                                    |
| --------------------------- | ------------------------------------------------------------ |
| `apex status`               | None                                                         |
| `apex task next`            | None                                                         |
| `apex task context`         | `--task`                                                     |
| `apex task complete`        | `--task --kind --file`; repeat `--file` for multiple outputs |
| `apex task complete-bundle` | `--task --file`                                              |
| `apex task cancel`          | `--task`                                                     |
| `apex task stage-file`      | `--task --path --file`; optional `--sha`                     |
| `apex task generate-iac`    | `--task`                                                     |
| `apex review resolve`       | `--file`                                                     |
| `apex gate decide`          | `--gate --decision --actor`; optional `--recipient`          |
| `apex validate`             | None                                                         |

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
| `apex render`          | `--kind` with status, requirements, preview, approval, or inventory                              |
| `apex promote`         | `--environment --target`                                                                         |

Only a human-authorized operator should run gate or deployment mutations. A preview must match the selected IaC track.

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

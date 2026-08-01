# Configuration And Contracts

> [Current Version](../../VERSION.md) | Versioned inputs that define APEX vNext runtime behavior.

## Shipped Configuration

| Path | Ownership |
| --- | --- |
| `config/workflow.v1.json` | Nodes, gates, dependencies, invalidation, and Bicep/Terraform routing |
| `config/defaults.v1.json` | Security invariants, evidence budgets, task limits, preview TTLs, and telemetry defaults |
| `config/toolchain.v1.json` | Supported toolchain selection and client qualification policy |
| `config/capability-packs.v1.json` | Lazy optional runtime packs and absent behavior |
| `config/runtime-bundle.v1.json` | Runtime bundle identity and source composition |
| `config/quality-scorecard.v1.json` | Deterministic quality measurements and thresholds |
| `config/improvement-policy.v1.json` | Bounded observation and proposal policy |

The packaged CLI embeds verified copies under `packages/cli/assets/config/`. Source and packaged assets must match.

## Persisted Contracts

Versioned JSON Schemas live under `packages/contracts/schemas/`. Persisted runtime objects reject unknown or malformed
shapes, stale evidence, unsafe paths, and unsupported contract versions.

Important families include project/run state, task envelopes, requirements, architecture, governance, implementation
intent, IaC binding, previews, approvals, operations, inventory, diagnosis, quality, and evidence manifests.

## Project State

A consumer project stores runtime state under `.apex/`. Treat it as kernel-owned state:

- use CLI or MCP operations rather than editing files directly;
- do not commit credentials, Terraform state, saved plans, or secret values;
- preserve runtime locks when moving a project between devices;
- use bounded transfer commands for writer or provider handoff.

## Authority

- [`packages/contracts/schemas`](../../packages/contracts/schemas/)
- [`config`](../../config/)

## Related

- [Runtime architecture](../explanation/runtime-architecture.md)
- [Workflow and gates](../explanation/workflow-and-gates.md)
- [Qualification reference](qualification.md)

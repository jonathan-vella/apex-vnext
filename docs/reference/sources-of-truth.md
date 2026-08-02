# Sources Of Truth

> [Current Version](../../VERSION.md) | Authority boundaries for the APEX repository and consumer workspaces.

Use the authority that owns the concern. Source code and versioned configuration override prose. Chat, rendered views,
generated summaries, and historical evidence do not create authority.

## Authority Matrix

| Concern                          | Authoritative owner                                                                      | Derived or non-authoritative views                  | Update and proof                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Product scope                    | [PRD](../vnext/PRD.md)                                                                   | Issues, plans, and chat                             | Update requirements and acceptance evidence together.                              |
| Decisions                        | [Decision register](../vnext/DECISIONS.md) and [ADRs](../vnext/adrs/README.md)           | Architecture prose and discussion                   | Record the decision and prove its implementation.                                  |
| Risks and delivery               | [Risk register](../vnext/REGISTER.md), [roadmap](../vnext/ROADMAP.md), and GitHub Issues | Checkpoints and dashboards                          | Issues own actionable work; controls own durable status.                           |
| Runtime behavior                 | `packages/` and kernel-managed `.apex/` state                                            | CLI, MCP, renderers, and chat                       | Mutate only through authorized CLI or MCP operations.                              |
| Contracts                        | `packages/contracts/src/` and generated `packages/contracts/schemas/`                    | Type declarations, fixtures, and rendered artifacts | Change schema, metadata, consumer, and contract tests together.                    |
| Runtime configuration            | `config/*.v1.json`                                                                       | Packaged CLI assets and documentation               | Regenerate assets and validate the workflow/configuration.                         |
| Managed clients                  | `customizations/manifest.json` and `customizations/.github/`                             | Client projections and installed files              | Regenerate projections; lifecycle and client qualification prove behavior.         |
| IaC intent and bindings          | Accepted kernel artifacts for the selected project and run                               | Generated Bicep/Terraform trees and rendered plans  | Planner/code generation, validation, and preview bind the accepted hashes.         |
| Preview, approval, and operation | Kernel-accepted preview, approval, operation, inventory, and evidence in `.apex/`        | CI protection, portal state, and rendered views     | Fresh, exact evidence must pass target, hash, recipient, epoch, and expiry checks. |
| Qualification                    | Candidate-bound qualification scripts and project controls                               | Fixtures, logs, and historical dossiers             | Run deterministic qualification; authorize live and release evidence separately.   |

## Consumer Workspace Boundary

Repository controls govern the APEX product, release, and distribution. They do not change a customer's project state.
In a consumer workspace, accepted artifacts are immutable content-addressed objects under `.apex/objects`; the active
run journal under `.apex/projects/<project>/runs/<run>/` binds their hashes to the project and run. The physical object
path is a storage detail, not part of an artifact contract.

Consumer state cannot change product requirements, release status, or npm distribution authority. Repository prose
cannot override a consumer run's accepted evidence, gates, or approvals.

## Workload Decision Manifest

`workload-decision-manifest-v1` is the active workload decision SSOT. Its contents are:

- requirement traceability for every confirmed must requirement;
- selected Azure service and SKU decisions with sparse environment overrides;
- workload SLOs: availability, RTO, RPO, support window, and compliance scopes;
- hashes binding accepted requirements, architecture, and cost evidence;
- revision metadata.

The contract is run-bound through `projectId`, `runId`, and accepted artifact hashes. The architecture stage owns its
production because it has the requirements, resource design, cost evidence, and governance context needed to make these
decisions.

## Cutover Policy

When the workload decision manifest becomes active, a run containing only the retired SKU artifact must fail closed. It
must not synthesize SLOs, reinterpret historical evidence, or silently re-approve artifacts. Recovery requires a new
run that regenerates required decisions and receives fresh validation and approval.

## Related

- [Configuration and contracts](configuration.md) - versioned runtime inputs and persisted schemas.
- [Runtime architecture](../explanation/runtime-architecture.md) - kernel, CLI, and client authority boundaries.
- [Workflow and gates](../explanation/workflow-and-gates.md) - accepted artifact and approval lifecycle.
- [Project controls](../vnext/README.md) - repository product and release authorities.

# Sources Of Truth

> [Current Version](../../VERSION.md) | Authority boundaries for the APEX repository and consumer workspaces.

Use the authority that owns the concern. Source code and versioned configuration establish implemented behavior; the
PRD establishes target requirements. A mismatch needs an explicit tested implementation change, not a claim that prose
changed the runtime. Chat, rendered views and historical evidence do not create execution authority.

## Authority Matrix

- **Product scope:** [PRD](../vnext/PRD.md). Issues, plans, and chat are derived views; update requirements and
  acceptance evidence together.
- **Decisions:** [Decision register](../vnext/DECISIONS.md) and [ADRs](../vnext/adrs/README.md). Architecture prose
  and discussion are derived; record the decision and prove its implementation.
- **Risks and delivery:** [Risk register](../vnext/REGISTER.md), [roadmap](../vnext/ROADMAP.md), and GitHub Issues.
  Issues own actionable work; controls own durable status.
- **Runtime behavior:** `packages/` and kernel-managed `.apex/` state. CLI, MCP, renderers, and chat are views;
  mutate only through authorized CLI or MCP operations.
- **Contracts:** `packages/contracts/src/` and generated `packages/contracts/schemas/`. Types, fixtures, and rendered
  artifacts are derived; change schema, metadata, consumer, and contract tests together.
- **Runtime configuration:** `config/*.v1.json`. Packaged CLI assets and documentation are derived; regenerate assets
  and validate workflow/configuration.
- **Managed clients:** `customizations/manifest.json` and `customizations/.github/`. Projections and installed files
  are derived; lifecycle and client qualification prove behavior.
- **IaC intent and bindings:** accepted kernel artifacts for the selected project/run. Generated trees and rendered
  plans are derived; planner, validation, and preview bind accepted hashes.
- **Preview, approval, and operation:** accepted kernel evidence in `.apex/`. CI protection, portal state, and rendered
  views are derived; fresh evidence must bind target, hash, recipient, epoch, and expiry.
- **Qualification:** candidate-bound qualification scripts and project controls. Fixtures, logs, and historical dossiers
  are derived; authorize live and release evidence separately.

## Consumer Workspace Boundary

Repository controls govern the APEX product, release, and distribution. They do not change a customer's project state.
In a consumer workspace, accepted artifacts are immutable content-addressed objects under `.apex/objects`; the active
run journal under `.apex/projects/<project>/runs/<run>/` binds their hashes to the project and run. The physical object
path is a storage detail, not part of an artifact contract.

Consumer state cannot change product requirements, release status, or the selected distribution authority. Repository prose
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

## Planned Portable Intent And Editing

The [COE and change requirements](../vnext/PRD.md#req-reuse-001-coe-archetype-import) extend this ownership model, not
replace it with another project-definition format. Use the existing owner for each fact and derive other views:

| Concern                                             | Intended ownership                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Business/compliance requirements                    | Accepted requirements, referenced by design and review                           |
| Service/SKU choices and rationale                   | Accepted architecture and workload decisions                                     |
| Environment values and supplied-resource references | Existing environment inputs and IaC bindings/parameters                          |
| Target constraints                                  | Reviewed policy baseline (or ALZ Corp reference) and the Architecture policy map |
| Documents and diagrams                              | Derived from those accepted sources and observed deployment evidence             |

COE imports create independent projects with origin/revision, not inherited writer or approval authority. Legacy files
may be inspected once to recover proposed intent, then confirmed; they are not executable runtime state. Manual edits
require detection and reconciliation before an affected file is overwritten. This conflict-aware adaptation is planned
work; current rendered review packages can still overwrite local edits, as documented in the workflow guide.

## Cutover Policy

When the workload decision manifest becomes active, a run containing only the retired SKU artifact must fail closed. It
must not synthesize SLOs, reinterpret historical evidence, or silently re-approve artifacts. Recovery requires a new
run that regenerates required decisions and receives fresh validation and approval.

## Related

- [Configuration and contracts](configuration.md) - versioned runtime inputs and persisted schemas.
- [Runtime architecture](../explanation/runtime-architecture.md) - kernel, CLI, and client authority boundaries.
- [Workflow and gates](../explanation/workflow-and-gates.md) - accepted artifact and approval lifecycle.
- [Project controls](../vnext/README.md) - repository product and release authorities.

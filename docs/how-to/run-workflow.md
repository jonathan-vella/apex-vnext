# Run The Workflow

> [Current Version](../../VERSION.md) | Move one environment and IaC track through typed tasks and human gates.

## Select The Project

The commands below describe current runtime behavior. The [planned COE import and change experience](../explanation/workflow-and-gates.md#planned-coe-reuse-and-change)
is a target requirement, not a new CLI command advertised by this guide. Use Windows via WSL2 without a devcontainer.

```bash
apex project list --json
apex project use --project PROJECT_ID --json
apex status --json
apex task next --json
```

## Add A Project

After initializing the customer workspace, add each additional workload without reinstalling the shared client
projection:

```bash
apex project create \
  --project payments \
  --name "Payments platform" \
  --environment dev \
  --target local \
  --iac bicep \
  --json
```

Project creation selects the new project's first run. Use `apex project use` to return to another workload.

## Promote A Project Environment

Each workload has one run per environment. After Gates 1 through 3 for the selected run are approved, create the next
environment run:

```bash
apex project promote \
  --environment test \
  --target resource-group:payments-test \
  --json
```

The promoted run remains in the same project and is selected automatically. It inherits only applicable upstream
evidence; it always needs its own code generation, validation, preview, and Gate 4 approval. Repeat for production
with its production target. Return to a prior environment with `apex project use --project payments --run RUN_ID`.

Use the visible APEX coordinator in VS Code or Copilot CLI as the normal interactive entry point. Direct CLI commands
remain useful for inspection and bounded operations.

## Handle Input Before Tasks

`nextTask` begins requirements with three adaptive panels: business discovery, combined workload and service
preferences, and security and compliance. Answer the exact pending request through the supported client. The client
submits a typed input object through MCP `recordInput`, including the request ID, expected head, owner epoch, and
nonempty answers.

Call `nextTask` again after every accepted round. Continue until it returns `status=task`; request context only for that
result. Recommendations are visible defaults or non-binding candidates and enter the journal only after confirmation.
Architecture selection, SKU decisions, and implementation stay with later workflow stages.

## Complete Creative Stages

The coordinator hands work to interactive specialists:

1. Requirements gathers workload outcomes and constraints.
2. Architect resolves design, cost, governance, assumptions and risk decisions.
3. Planner produces track-neutral implementation intent, binding, and environment inputs.
4. Operator handles preview, approval, deployment, recovery, and evidence.

Specialists delegate bounded code generation, review, and validation tasks when supported. Review findings return as a
single decision panel; permitted risk acceptance is time-bound, while revision creates a fresh artifact and review.

## Governance Freshness

Before planning, import the reviewed JSON snapshot for the run's target through the governance-discovery task. Azure
Policy remains authoritative; a snapshot is evidence, not permission to override a policy. The consumer owns the
collection workflow and its GitHub configuration; do not commit Azure credentials.

Imported snapshots less than 30 days old can be reused. Refresh is optional, including before deployment. The runtime
measures age from successful Azure collection, not file download, import or commit time. At exactly 30 days, imported
evidence blocks new planning, preview and deployment approval until refreshed evidence is accepted. Missing, incomplete,
future-dated or wrong-scope evidence remains blocked independently of age; existing preview expiry rules still apply.

The intended selection prompt shows the age and offers Use existing snapshot (default) or Refresh from Azure once per
run. Durable choice recording and automatic consumer refresh orchestration are not yet implemented. Refresh through the
consumer collection workflow, not an invented local discovery command. Import a successfully refreshed JSON file with:

```bash
apex governance import --path .github/data/governance-policy-baseline.json --json
```

After initial import, the same operation accepts a newer observation only when the complete selected subscription
content is unchanged, excluding collection timestamps and legacy TTL fields. It records a separate observation receipt
and preserves accepted governance, policy, plan and gate hashes. Material differences block renewal and require explicit
governance reconciliation; unrelated subscription data is not copied into run state. A replay of the exact accepted
renewal is idempotent. The journal head advances, so active tasks may need reissuing; preview expiry and writer authority
are not extended. Legacy snapshots without a content digest require migration/reconciliation instead of inferred equality.

## Decide Gates

Inspect accepted artifacts and validation before each decision:

```bash
apex render --kind requirements
apex gate decide --gate 1 --decision approved --actor USER_ID --json
```

Requirements acceptance also materializes a read-only Gate 1 review package at
`agent-output/<project>/<run>/`. Review `01-requirements.md`, `README.md`,
`service-recommendations.md`, `sku-preferences.md`, and `challenger-findings.md`
before approving Gate 1. These documents are derived from accepted APEX state;
regeneration overwrites local edits.

Conflict-aware selective updates are planned under `REQ-CHANGE-001`; until implemented, do not treat manual edits to
these generated packages as persistent project intent. Ask APEX to revise accepted decisions through supported tasks.

Architecture acceptance materializes `agent-output/<project>/<run>/architecture/` with authoritative assessment, cost,
SKU, and challenger Markdown. It also includes editable Python, SVG, and PNG views for Architecture topology,
qualitative WAF status, priced monthly cost breakdown, and lower/base/upper cost uncertainty. Unpriced items remain
listed separately and are excluded from cost diagrams and the priced subtotal. Diagram failures are visible but do not
replace or block typed review evidence.

Architecture assumes regional service/SKU availability and sufficient quota. Regional, zonal, deployment, restore,
failover, and capacity details may appear as descriptive assumptions, but APEX does not request, validate, or gate them.

Repeat the inspection and decision ceremony for architecture/cost and implementation plan. Gate 4 is decided only after
an exact provider preview exists. Rejection or upstream changes reopen the earliest affected work.

## Generate And Validate IaC

When the kernel issues a generation task, a supported worker or bounded operator uses `generateIac`. The selected run
chooses Bicep or Terraform; outputs for the other track are invalid.

```bash
apex validate --json
apex status --json
```

## Legacy Promotion Alias

```bash
apex promote --environment test --target TARGET_SCOPE --json
```

Promotion creates a linked run. Only dependency-matching upstream attestations can carry forward. Every environment
requires a fresh preview, Gate 4 decision, operation, inventory, and evidence.

## Related

- [Workflow and gates](../explanation/workflow-and-gates.md)
- [Maintain requirements intake](maintain-requirements-intake.md)
- [Operate a project](operate-project.md)
- [MCP tools](../reference/mcp.md)

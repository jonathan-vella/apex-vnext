# Run The Workflow

> [Current Version](../../VERSION.md) | Move one environment and IaC track through typed tasks and human gates.

## Select The Project

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
2. Architect resolves design, cost, availability, governance, and risk decisions.
3. Planner produces track-neutral implementation intent, binding, and environment inputs.
4. Operator handles preview, approval, deployment, recovery, and evidence.

Specialists delegate bounded code generation, review, and validation tasks when supported. Review findings return as a
single decision panel; permitted risk acceptance is time-bound, while revision creates a fresh artifact and review.

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

Architecture acceptance materializes `agent-output/<project>/<run>/architecture/` with authoritative assessment, cost,
SKU, and challenger Markdown. It also includes editable Python, SVG, and PNG views for Architecture topology,
qualitative WAF status, priced monthly cost breakdown, and lower/base/upper cost uncertainty. Unpriced items remain
listed separately and are excluded from cost diagrams and the priced subtotal. Diagram failures are visible but do not
replace or block typed review evidence.

When qualified regional, zonal, or quota evidence is unavailable, Architecture records an explicit WAF concern and
pre-deployment validation recommendation. Supplied availability evidence is still rejected if stale or scope-mismatched.

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

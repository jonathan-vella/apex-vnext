# Run The Workflow

> [Current Version](../../VERSION.md) | Move one environment and IaC track through typed tasks and human gates.

## Select The Project

```bash
apex project list --json
apex project use --project PROJECT_ID --json
apex status --json
apex task next --json
```

Use the visible APEX coordinator in VS Code or Copilot CLI as the normal interactive entry point. Direct CLI commands
remain useful for inspection and bounded operations.

## Handle Input Before Tasks

`nextTask` can return `needs_input`. Answer the exact pending request through the supported client. The client submits a
typed input object through MCP `recordInput`, including the request ID, expected head, owner epoch, and nonempty answers.

Call `nextTask` again after input is accepted. Request context only for a result with `status=task`.

## Complete Creative Stages

The coordinator hands work to interactive specialists:

1. Requirements gathers workload outcomes and constraints.
2. Architect resolves design, cost, availability, governance, and risk decisions.
3. Planner produces track-neutral implementation intent, binding, and environment inputs.
4. Operator handles preview, approval, deployment, recovery, and evidence.

VS Code specialists may delegate bounded code generation, review, and validation tasks. Copilot CLI specialists do not
have those autonomous workers and must stay within their supported projection.

## Decide Gates

Inspect accepted artifacts and validation before each decision:

```bash
apex render --kind requirements
apex gate decide --gate 1 --decision approved --actor USER_ID --json
```

Repeat the inspection and decision ceremony for architecture/cost and implementation plan. Gate 4 is decided only after
an exact provider preview exists. Rejection or upstream changes reopen the earliest affected work.

## Generate And Validate IaC

When the kernel issues a generation task, a supported worker or bounded operator uses `generateIac`. The selected run
chooses Bicep or Terraform; outputs for the other track are invalid.

```bash
apex validate --json
apex status --json
```

## Promote An Environment

```bash
apex promote --environment test --target TARGET_SCOPE --json
```

Promotion creates a linked run. Only dependency-matching upstream attestations can carry forward. Every environment
requires a fresh preview, Gate 4 decision, operation, inventory, and evidence.

## Related

- [Workflow and gates](../explanation/workflow-and-gates.md)
- [Operate a project](operate-project.md)
- [MCP tools](../reference/mcp.md)

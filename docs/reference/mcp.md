# MCP Tools

> [Current Version](../../VERSION.md) | Read and bounded-write tools exposed by the APEX MCP server.

Run `apex mcp serve` over standard input/output. Client projections configure this server; users should not add a second
APEX server with independent state.

## Workflow Tools

| Tool            | Purpose                                                               |
| --------------- | --------------------------------------------------------------------- |
| `status`        | Read selected project and run status.                                 |
| `nextTask`      | Get the next requirements input round, a task, or terminal status.    |
| `taskContext`   | Read context for the exact task ID returned by `nextTask`.            |
| `recordInput`   | Submit answers for the exact pending requirements input request.      |
| `stageArtifact` | Stage one or more typed outputs for a task.                           |
| `stageFile`     | Stage a bounded file for a task, optionally with an expected SHA-256. |
| `generateIac`   | Generate the selected task's Bicep or Terraform batch.                |
| `validateTask`  | Validate staged or supplied task outputs without completion.          |
| `completeTask`  | Validate and complete a task with typed outputs.                      |

Handle `needs_input` before requesting task context. Only a `nextTask` result with `status=task` provides a valid task
ID. Requirements intake returns four ordered `needs_input` rounds before the requirements task: business discovery,
workload pattern, service preferences, and security and compliance. After recording each round, call `nextTask` again.
The returned request ID, expected head, and owner epoch are required for `recordInput`.

## Read And Operations Tools

| Tool               | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `capabilityList`   | Read capability-pack availability.                                     |
| `capabilityStatus` | Read one pack's state.                                                 |
| `preview`          | Read the current operator-created preview; it does not create one.     |
| `reconcile`        | Reconcile selected-run state.                                          |
| `inventory`        | Read the accepted resource inventory.                                  |
| `diagnose`         | Produce bounded diagnostic state.                                      |
| `render`           | Render status, requirements, preview, approval, or inventory Markdown. |
| `promote`          | Create a linked environment run.                                       |
| `doctor`           | Check or repair local managed state.                                   |
| `submitEvidence`   | Submit bounded JSON evidence for an active task.                       |

## Improvement Tools

`improvementObserve`, `improvementObservations`, and `improvementProposals` record and read bounded improvement data.
Proposals are inert: they do not mutate instructions, policy, or runtime behavior automatically.

## Authority

[`packages/cli/src/mcp.ts`](../../packages/cli/src/mcp.ts) is the executable tool inventory.
The [generated tool inventory](mcp-tools.generated.md) detects source drift.

## Related

- [CLI commands](cli.md)
- [Run the workflow](../how-to/run-workflow.md)
- [Maintain requirements intake](../how-to/maintain-requirements-intake.md)
- [Security and authority](../explanation/security-and-authority.md)

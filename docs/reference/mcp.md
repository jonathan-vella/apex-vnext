# MCP Tools

> [Current Version](../../VERSION.md) | Read and bounded-write tools exposed by the APEX MCP server.

Run `apex mcp serve` over standard input/output. Client projections configure this server; users should not add a second
APEX server with independent state.

## Workflow Tools

| Tool                   | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `status`               | Read selected project and run status.                                                         |
| `nextTask`             | Get the next input, review decision, task, or terminal status.                                |
| `taskContext`          | Read context for the exact task ID returned by `nextTask`.                                    |
| `readTaskInput`        | Read externalized active-task context in bounded chunks.                                      |
| `recordInput`          | Submit answers for the exact pending requirements input request.                              |
| `stageArtifact`        | Stage one or more typed outputs for a task.                                                   |
| `stageFile`            | Stage a bounded file for a task, optionally with an expected SHA-256.                         |
| `generateIac`          | Generate the selected task's Bicep or Terraform batch.                                        |
| `validateTask`         | Validate staged or supplied task outputs without completion.                                  |
| `completeTask`         | Atomically accept a complete typed output bundle.                                             |
| `requirementsComplete` | Complete Requirements without constructing a generic bundle.                                  |
| `architectureComplete` | Complete Architecture, cost, and decisions atomically.                                        |
| `reviewComplete`       | Complete a review with APEX-derived identity and evidence binding.                            |
| `reviewDecide`         | Revise, acknowledge obligations, or accept risk with project owner and 90-day default expiry. |
| `planComplete`         | Complete a plan with an APEX-derived intent binding.                                          |

Handle `needs_input` before requesting task context. Only a `nextTask` result with `status=task` provides a valid task
ID. New Requirements runs return three adaptive panels before the task. Handle `needs_review` through the returned
finding actions and `reviewDecide`.
The returned request ID, expected head, and owner epoch are required for `recordInput`.
`projectCreate` requires `riskOwner` (`partner` or `customer`). `reviewDecide` accept-risk decisions derive owner from
that project value; omit `expiresAt` to use the 90-day default.

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

## Response Contracts

APEX currently pins TypeScript SDK 1.29.0, supporting MCP versions through 2025-11-25. It does not claim support for
the 2026-07-28 protocol. Initialization/version negotiation is handled by the SDK; stdio stdout is protocol-only.

Successful responses include an object in `structuredContent` and the same JSON serialized in a text content block.
Existing object results are unchanged. Non-object service results use these envelopes:

| Tool                           | Structured result        |
| ------------------------------ | ------------------------ |
| `render`                       | `{ "markdown": "..." }`  |
| `preview`                      | `{ "markdown": "..." }`  |
| `capabilityList`               | `{ "packs": [] }`        |
| `improvementObservations`      | `{ "observations": [] }` |
| `improvementProposals`         | `{ "proposals": [] }`    |
| `stageArtifact` with `outputs` | `{ "artifacts": [] }`    |

Single-artifact staging still returns its existing artifact object. Bundle staging is not an atomic completion;
use `completeTask` for atomic output acceptance. All 34 tools advertise output schemas derived from the canonical
contracts and explicit adapter envelopes. Success and structured error branches are validated, including by SDK clients.
See [REQ-MCP-001](../vnext/PRD.md#req-mcp-001-predictable-tool-contracts) for acceptance.

Handler failures return `isError: true` with `{ "error": { "code": "APEX_STALE", "message": "..." } }` in both
structured and text content. Messages are allowlisted recovery guidance, not raw exception messages. The exception is
an `APEX_VALIDATION` failure raised by the kernel service: its authored reason, plus up to five schema issue paths,
truncated to 1,000 characters, is returned so the agent can correct the typed input. Reasons that look like secrets
stay generic. Stacks and causes are omitted. Tool
argument-validation failures use the generic sanitized envelope; malformed JSON-RPC
requests and unknown methods remain SDK concerns. Clients must inspect `isError`,
refresh stale state and avoid blindly retrying mutations; an error does not imply that all side effects were rolled back.

## Inputs And Lifecycle

Tool arguments are strict objects: unknown fields and ambiguous staging forms are rejected before service invocation.
Parameterless tools accept omitted arguments or `{}`. Stage a single `kind`/`value` or a nonempty `outputs` bundle,
never both. Bundle kinds must be unique; bundles have at most 32 items. Validation-only calls may omit both forms.

The adapter limits argument and structured-result JSON to 4 MiB, depth 64 and 100,000 nodes. These are transport-facing
safeguards, not replacements for smaller locked task/evidence budgets. Each server permits 240 tool calls per minute
and at most 32 active/queued calls; excess work returns a conflict without executing. Dispatch is serialized per server.
Queued calls expire after 30 seconds and cancellation/disconnect reclaims their slots before execution.

An active mutation is allowed to settle; cancellation is not rollback. Staging/validation bundles check cancellation
between items and preserve already-written items on later failure. The adapter never retries mutations automatically.
Long-running underlying operations retain their own bounded process/provider timeouts. After interruption, reconnect
and inspect authoritative state before deciding whether to resubmit; do not treat a missing reply as proof of no commit.

`status` and `projectList` are read-only and carry corresponding read-only/idempotent hints. Status refuses pending
transaction recovery instead of writing it. Explicit advancement/final completion owns terminal bookkeeping. Other
tools are conservatively marked non-read-only/non-idempotent because even read-like service paths can recover state.
`nextTask` explicitly warns that issuance writes state and is not retry-safe. Tool metadata and host permission prompts
do not replace kernel authorization. The fixed, deterministically ordered catalog does not change with workflow state.

## Authority

[`packages/cli/src/mcp.ts`](../../packages/cli/src/mcp.ts) is the executable tool inventory.
The [generated tool inventory](mcp-tools.generated.md) detects source drift.

## Related

- [CLI commands](cli.md)
- [Run the workflow](../how-to/run-workflow.md)
- [Maintain requirements intake](../how-to/maintain-requirements-intake.md)
- [Security and authority](../explanation/security-and-authority.md)

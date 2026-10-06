# MCP Tools

> [Current Version](../../VERSION.md) | Read and bounded-write tools exposed by the APEX MCP server.

Run `apex mcp serve` over standard input/output. Client projections configure this server; users should not add a second
APEX server with independent state.

## Server Instructions

The server sends compact session instructions during MCP initialization. They identify APEX as the governed Azure
workload lifecycle server, require the absolute `workspace` path on every tool call, direct clients to call `status`
first, preserve kernel ownership of state/gates/authorization/evidence, warn against blind mutation retries after
timeouts or cancellations, route human decisions through `ask_user`, and explain that large read results continue with
`nextCursor` on the same tool and workspace. The canonical text lives in
[`packages/cli/src/mcp.ts`](../../packages/cli/src/mcp.ts).

## Workflow Tools

| Tool                   | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `status`               | Read selected project and run status.                                                         |
| `releaseWriter`        | Release this workspace's writer lease for the selected run.                                   |
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

APEX pins TypeScript SDK 1.32.1 (`@modelcontextprotocol/sdk`, v1 line), supporting MCP versions through 2025-11-25.
It does not claim support for the 2026-07-28 protocol, which ships in the separate v2 packages
`@modelcontextprotocol/server` and `@modelcontextprotocol/client`. Initialization/version negotiation is handled by the
SDK; stdio stdout is protocol-only.

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
use `completeTask` for atomic output acceptance. All 35 tools advertise output schemas derived from the canonical
contracts and explicit adapter envelopes. Success and structured error branches are validated, including by SDK clients.
See [REQ-MCP-001](../vnext/PRD.md#req-mcp-001-predictable-tool-contracts) for acceptance.

Handler failures return `isError: true` with
`{ "error": { "code": "APEX_STALE", "message": "...", "remediation": "..." } }` in both structured and text content.
Messages are allowlisted recovery guidance, not raw exception messages. `remediation` is a structured hint derived from
the stable APEX error class; internal and unknown failures use a generic safe hint. The exception is an
`APEX_VALIDATION` failure raised by the kernel service: its authored reason, plus up to five schema issue paths,
truncated to 1,000 characters, is returned so the agent can correct the typed input. Reasons that look like secrets
stay generic. Stacks and causes are omitted. Tool argument-validation failures use the generic sanitized envelope;
malformed JSON-RPC requests and unknown methods remain SDK concerns. Clients must inspect `isError`, follow
`remediation`, refresh stale state and avoid blindly retrying mutations; an error does not imply that all side effects
were rolled back.

Read tools that can return large collections or documents cap serialized responses at 64 KiB. The cap leaves room under
common host/client message budgets while preventing token-heavy accidental full-document transfers. Paging-capable tools
return the normal result shape with a partial top-level field plus `nextCursor`; call the same tool with the same
`workspace` and `cursor` until `nextCursor` is absent, appending the paged string or array field in order. Cursors are
opaque, signed for the server process, and bound to tool, workspace, result path, and a hash of the source result. A
tampered, cross-tool, cross-workspace, or stale cursor fails closed with a stable APEX error and remediation. Mutation
results are never paged; an oversized non-pageable result fails with `APEX_RESULT_TOO_LARGE` instead of silent
truncation.

| Tool                      | Paged field    |
| ------------------------- | -------------- |
| `taskContext`             | `inputs`       |
| `readTaskInput`           | `content`      |
| `projectList`             | `projects`     |
| `preview`                 | `markdown`     |
| `inventory`               | `resources`    |
| `improvementObservations` | `observations` |
| `improvementProposals`    | `proposals`    |
| `render`                  | `markdown`     |

## Inputs And Lifecycle

Tool arguments are strict objects: unknown fields and ambiguous staging forms are rejected before service invocation.
Every tool requires `workspace`, an absolute path to the current checkout or git worktree. The server resolves git
worktrees through their common directory so they share the main checkout's `.apex/` state; non-git folders keep the
nearest existing `.apex/` ancestor behavior. Stage a single `kind`/`value` or a nonempty `outputs` bundle, never both.
Bundle kinds must be unique; bundles have at most 32 items. Validation-only calls may omit both forms. Only the
paging-capable read tools listed above accept `cursor`; strict input validation rejects `cursor` on every other tool.

The adapter limits argument JSON to 4 MiB, depth 64 and 100,000 nodes, and limits serialized MCP results to the 64 KiB
cap described above. These are transport-facing safeguards, not replacements for smaller locked task/evidence budgets.
Each server permits 240 tool calls per minute and at most 32 active/queued calls; excess work returns a conflict without
executing. Dispatch is serialized per server. Queued calls expire after 30 seconds and cancellation/disconnect reclaims
their slots before execution.

An active mutation is allowed to settle; cancellation is not rollback. Staging/validation bundles check cancellation
between items and preserve already-written items on later failure. The adapter never retries mutations automatically.
Long-running underlying operations retain their own bounded process/provider timeouts. After interruption, reconnect
and inspect authoritative state before deciding whether to resubmit; do not treat a missing reply as proof of no commit.
The first worktree to write a run holds a short run-writer lease. Other worktrees may read, but writes return
`APEX_WRITER_CONFLICT` naming the owning worktree until the owner releases the lease with `releaseWriter`, the run
reaches a terminal state, or the lease expires (default 2 minutes after the owner's last write).

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

# MCP Tools

> [Current Version](../../VERSION.md) | Read and bounded-write tools exposed by the APEX MCP server.

The `apex` plugin starts this server as `apex` with `node ${PLUGIN_ROOT}/mcp/apex.mjs`, the bundled `@apexops/cli`
runtime. `apex mcp serve` runs the same server over standard input/output from the terminal CLI for scripts and tests.
Do not register it as a second MCP server in a client that already loads the plugin; one APEX server per session
avoids duplicate tools and independent state.

The `apex` plugin also declares `apex-azure-pricing`, the remote Azure Resource Manager MCP server with the
`CostManagement` and `Pricing` toolsets. Agents reference its tools as `apex-azure-pricing/<tool>`. A managed
`preToolUse` hook allows only the read-only tools in `managedPolicy.candidateReadAllowlist` of
[`arm-mcp-cost-pricing.v1.json`](../../tools/registry/arm-mcp-cost-pricing.v1.json) and denies writes such as
`create_budget`, operation tools and unknown tools on that server.

## Server Instructions

The server sends compact session instructions in its `server/discover` result (and in the `initialize` result for
2025-era clients). They identify APEX as the governed Azure
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

| Tool               | Purpose                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `capabilityList`   | Read capability-pack availability.                                           |
| `capabilityStatus` | Read one pack's state.                                                       |
| `preview`          | Read the current operator-created preview; it does not create one.           |
| `reconcile`        | Reconcile selected-run state.                                                |
| `inventory`        | Read the accepted resource inventory.                                        |
| `diagnose`         | Produce bounded diagnostic state.                                            |
| `render`           | Render status, requirements, preview, approval, or inventory Markdown.       |
| `promote`          | Create a linked environment run.                                             |
| `doctor`           | Check or repair local managed state; returns a bounded summary.              |
| `doctorChecks`     | Read every doctor check without repairing; `failedOnly` lists failures only. |
| `submitEvidence`   | Submit bounded JSON evidence for an active task.                             |

`doctor` (with or without `fix`/`yes`) and the `doctor` field of `diagnose` return a bounded summary rather than one
check per managed file, which would exceed the result cap in an initialized workspace. The summary carries `healthy`,
`nextAction`, deduplicated `remedies`, `counts` (`total`, `passed`, `failed`), and up to 32 `checks`: failing checks
first, then passing checks other than per-file `managed:` hashes. `omitted` counts the passed and failed checks left out
of the list, and `truncated` is `true` whenever any check is omitted. Call `doctorChecks` (paged on `checks`) for the
complete list. A repair result is never paged. `apex doctor` and `apex doctor --json` still print the full report.

## Improvement Tools

`improvementObserve`, `improvementObservations`, and `improvementProposals` record and read bounded improvement data.
Proposals are inert: they do not mutate instructions, policy, or runtime behavior automatically.

## Response Contracts

APEX pins the v2 TypeScript server SDK `@modelcontextprotocol/server` 2.3.1 exactly and targets MCP protocol
`2026-07-28`. The server is a low-level SDK `Server` with explicit `tools/list` and `tools/call` handlers, so the
advertised tool names, descriptions, input/output schemas and annotations come from APEX's own tool table rather
than SDK schema conversion. `apex mcp serve` uses the SDK `serveStdio` entry with `legacy: 'serve'`: it answers
`server/discover` with `supportedVersions: ["2026-07-28"]` and the server instructions, and still serves a 2025-era
`initialize` handshake (for example `2025-11-25`), including a client that sends `server/discover` first and then
falls back to `initialize` on the same connection after a discovery timeout. Each connection gets a fresh, cheap
`Server` instance; the queue, rate limit, cursor key and service resolver are shared per process. The server exits
when stdin closes and closes cleanly on `SIGINT` or `SIGTERM`; stdio stdout is protocol-only.

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
use `completeTask` for atomic output acceptance. Every tool advertises output schemas derived from the canonical
contracts and explicit adapter envelopes. Success and structured error branches are validated, including by SDK clients.
See [REQ-MCP-001](../vnext/PRD.md#req-mcp-001-predictable-tool-contracts) for acceptance.

Handler failures return `isError: true` with
`{ "error": { "code": "APEX_STALE", "message": "...", "remediation": "..." } }` in both structured and text content.
Messages are allowlisted recovery guidance, not raw exception messages. `remediation` is a structured hint derived from
the stable APEX error class; internal and unknown failures use a generic safe hint. The exception is an
`APEX_VALIDATION` failure raised by the kernel service: its authored reason, plus up to five schema issue paths,
truncated to 1,000 characters, is returned so the agent can correct the typed input. Reasons that look like secrets
stay generic. Stacks and causes are omitted. Tool argument-validation failures use the generic sanitized envelope;
unknown tool names return the same `isError: true` envelope with `APEX_USAGE`, preserving the v1-era tool-result
shape instead of a JSON-RPC error. Malformed JSON-RPC requests and unknown methods remain SDK concerns. Clients must
inspect `isError`, follow `remediation`, refresh stale state and avoid blindly retrying mutations; an error does not
imply that all side effects were rolled back.

Read tools that can return large collections or documents cap the complete serialized MCP result envelope at 64 KiB.
The cap leaves room under common host/client message budgets while preventing token-heavy accidental full-document
transfers. Paging-capable tools return the normal result shape with a partial top-level field plus `nextCursor`; call the
same tool with the same `workspace` and `cursor` until `nextCursor` is absent, appending the paged string or array field
in order. Cursors are opaque, HMAC-signed with a random secret generated when the server starts, and bound to tool,
workspace, result path, and a hash of the source result. The secret is never persisted, so cursors do not survive an
`apex mcp serve` restart or a client reconnect that starts a new server process. Mutation results are never paged; an
oversized non-pageable result fails instead of being silently truncated. Every cursor failure is fail-closed:

| Condition                                                                           | Code                    | Remediation                                                             |
| ----------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| Malformed, tampered, cross-tool, cross-workspace, or issued before a server restart | `APEX_CURSOR_INVALID`   | Discard the cursor and call the same tool without it to restart paging. |
| Source result changed between pages                                                 | `APEX_STALE`            | Call `status`, then restart paging without a cursor.                    |
| `cursor` sent to a tool that is not paging-capable                                  | `APEX_VALIDATION`       | Remove `cursor`; only the tools below accept it.                        |
| Non-pageable result, or a single item/page, exceeds 64 KiB                          | `APEX_RESULT_TOO_LARGE` | Request a smaller bounded result or use a paging-capable read tool.     |

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
| `doctorChecks`            | `checks`       |

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

An active mutation is allowed to settle; cancellation is not rollback. When a connection closes, the SDK aborts
in-flight handlers and drops their late responses, but a mutation that has already started still completes and
persists. Staging/validation bundles check cancellation
between items and preserve already-written items on later failure. The adapter never retries mutations automatically.
Long-running underlying operations retain their own bounded process/provider timeouts. After interruption, reconnect
and inspect authoritative state before deciding whether to resubmit; do not treat a missing reply as proof of no commit.
If the interrupted mutation committed and nothing has changed the run since, an identical resubmission returns its
original result under the [repeat rules](#repeat-safety) instead of applying it twice.
The first worktree to write a run holds a short run-writer lease. Other worktrees may read, but writes return
`APEX_WRITER_CONFLICT` naming the owning worktree until the owner releases the lease with `releaseWriter`, the run
reaches a terminal state, or the lease expires (default 2 minutes after the owner's last write).

`status` and `projectList` are read-only and carry corresponding read-only/idempotent hints. Status refuses pending
transaction recovery instead of writing it. Explicit advancement/final completion owns terminal bookkeeping. Other
tools are conservatively marked non-read-only/non-idempotent because even read-like service paths can recover state.
Repeat suppression is bounded by run state, time and storage, so it does not make any state-changing tool idempotent.
`nextTask` explicitly warns that issuance writes state and is not retry-safe. Tool metadata and host permission prompts
do not replace kernel authorization. The fixed, deterministically ordered catalog does not change with workflow state.

## Repeat Safety

Session models can issue the same tool call twice. Every tool has an effect class in `MCP_TOOL_EFFECTS` in
[`packages/cli/src/mcp.ts`](../../packages/cli/src/mcp.ts), and a test fails when a state-changing tool lacks a
duplicate-call case:

| Class            | Tools                                   | Repeat behavior                                        |
| ---------------- | --------------------------------------- | ------------------------------------------------------ |
| `read-only`      | `status`, `projectList`, `doctorChecks` | Never writes.                                          |
| `read`           | The read tools listed below             | Always executes; may only finish a committed recovery. |
| `repeat-guarded` | Every other tool except `doctor`        | The kernel repeat guard below decides.                 |
| `convergent`     | `doctor`                                | Always executes; a repeat re-applies the same repair.  |

The `read` tools are `capabilityList`, `capabilityStatus`, `taskContext`, `readTaskInput`, `preview`, `inventory`,
`diagnose`, `render`, `improvementObservations` and `improvementProposals`.

`doctor` repairs workspace installation files outside the run, so a run-scoped record could hide a newly broken file.
It is not deduplicated; a repair that reproduces the current customization lock keeps the existing rollback chain.

For a `repeat-guarded` tool, the kernel identifies a call by the tool name, the canonical worktree (real path,
case-folded on Windows) and the validated arguments as canonical JSON with sorted keys and undefined members dropped.
`governanceImport` and `governanceSelect` add the SHA-256 of the referenced file, so an edited baseline is a new call;
a result is not stored when that file changed while the call ran.
The run state is a hash of the selection, the project set, the selected run document, its journal head and the writer
lease holder (lease renewals do not change it). The recorded fingerprint binds the call to the state it applied to.

An identical call is answered from the original result only when all of these hold:

1. The original call succeeded and its result passed the output contract and size checks. Failures are not stored, so
   a repeat re-runs validation and stale-state checks, and a failure after a partial commit, such as bundle staging, is
   not deduplicated.
2. The run state equals the state right after the original call. Any change to that state, whether from another tool,
   the CLI or another worktree, makes the call a new request that normal kernel checks decide and may reject as stale.
3. Fewer than 10 minutes have passed, and a returned task has not reached its `expiresAt`.
4. No other worktree holds a live writer lease. The check never renews the lease. Because the worktree is part of the
   call identity, a repeat from another worktree is a new request and meets `APEX_WRITER_CONFLICT` while the lease is
   held.

An answered repeat returns the original `structuredContent` byte for byte, changes no run state and no run journal
head, records no new gate decision or evidence, and appends a hash-chained `call.repeated` audit event to the run's
separate `repeats/` journal. Records live in the run's `.repeat-guard.json`, written atomically, so they survive an
`apex mcp serve` restart. The file holds at most 16 records with results of at most 64 KiB each; records whose post-call
state differs from the current state are dropped on every write because they can never match again. A malformed record
file disables replay instead of returning a forged result. State transfer excludes the record file and carries the
audit journal.

## Authority

[`packages/cli/src/mcp.ts`](../../packages/cli/src/mcp.ts) is the executable tool inventory.
The [generated tool inventory](mcp-tools.generated.md) detects source drift.

## Related

- [CLI commands](cli.md)
- [Run the workflow](../how-to/run-workflow.md)
- [Maintain requirements intake](../how-to/maintain-requirements-intake.md)
- [Security and authority](../explanation/security-and-authority.md)

# Supported Client Qualification

This control defines release-blocking evidence for GitHub Copilot in VS Code Local and standalone Copilot CLI.
Generated projection tests are necessary but do not replace live client interaction.

Both clients use Windows via WSL2/Ubuntu, without Docker or a devcontainer. Required outcomes follow the
[PRD](PRD.md), including both environment profiles, COE reuse and conversational changes. Basic interaction checks
accompany feature delivery; final installation qualification follows the distribution decision. No token baseline is
required now. Existing executable gate alignment must be completed before affected scenarios; do not bypass it.

## Candidate Binding

Before interaction, record the exact source commit, package and runtime locks, managed projection digests, client
versions, executable hashes, MCP inventory, and clean consumer workspace identity. An update during a run invalidates
that client result.

Desktop-app work is deferred. Preserve its historical receipts separately; do not count them as evidence for either
active client. No third-client schema or acceptance expansion is required for the current two-client release.

## Scenario Matrix

| ID           | Shared required outcome                                                  | VS Code               | Copilot CLI                         |
| ------------ | ------------------------------------------------------------------------ | --------------------- | ----------------------------------- |
| `CLIENT-001` | Candidate versions and hashes are bound before work.                     | Required              | Required                            |
| `CLIENT-002` | Instructions, target projection, agents, and skills are discovered once. | Required              | Required                            |
| `CLIENT-003` | Missing input creates one kernel request and one typed answer event.     | `vscode/askQuestions` | Interactive `ask_user`              |
| `CLIENT-004` | APEX MCP starts with the exact managed allowlist.                        | Required              | Required                            |
| `CLIENT-005` | Specialists route correctly and kernel worker boundaries hold.           | Workers delegated     | Actual worker qualification pending |
| `CLIENT-006` | Gates, stale-state rejection, and operation denial match.                | Required              | Required                            |
| `CLIENT-007` | Restart resumes the same journal head without chat history.              | Required              | Required                            |
| `CLIENT-008` | Writer conflict and accepted transfer preserve owner epochs.             | Required              | Required                            |
| `CLIENT-009` | Init, update, conflict, rollback, uninstall, and reinstall are atomic.   | Required              | Required                            |
| `CLIENT-010` | Shared fake-provider workflow outcomes normalize equally.                | Required              | Required                            |
| `CLIENT-011` | Bootstrap installs the exact local runtime and selected projection.      | Profile or CLI route  | CLI route                           |

Unavailable client mechanics remain unavailable; they are not inferred as passing. Copilot CLI autonomous workers
remain absent from the shipped projection pending qualification under revised ADR-0006. Direct-selection visibility
is not a security pass/fail criterion; worker permissions remain unchanged.

That omission is a current qualification status, not permission to omit generation, review or validation. Demonstrate a
supported bounded path for every required outcome. These additional acceptance scenarios are planned requirements,
not assertions that corresponding runtime or registry coverage already exists:

| ID           | Required outcome in both clients                                                              |
| ------------ | --------------------------------------------------------------------------------------------- |
| `CLIENT-012` | WSL2 clean consumer setup and use without a devcontainer or APEX source checkout              |
| `CLIENT-013` | Explicit ALZ/lab profile selection and correct supplied-versus-owned resource handling        |
| `CLIENT-014` | COE discovery, one-archetype selection, independent import and recorded source revision       |
| `CLIENT-015` | Manually copied project adoption without importing secrets, state or approval authority       |
| `CLIENT-016` | Relevant change questions, consequences and confirmation; unchanged decisions are reused      |
| `CLIENT-017` | Affected outputs refresh, unrelated files remain unchanged and manual conflicts are confirmed |
| `CLIENT-018` | Target-subscription policy import; full baseline never enters model-facing context            |
| `CLIENT-019` | Complete design and operational handoff reviewed against the PRD quality reference            |
| `CLIENT-020` | Final distribution starts the correct APEX MCP and preserves active runs across updates       |

Exercise both IaC tracks and both profiles with representative cases in the existing tests. Reuse fixtures and helpers;
do not build a separate benchmark harness. Record explicit gaps until implemented.

## Execution Rules

1. Use clean independent consumer workspaces for each client.
2. Install the same exact package candidate and one selected projection.
3. Trust only the qualification workspace. A disposable, isolated profile root may be mutated solely for the managed
   VS Code bootstrap agent scenario; do not mutate a real user profile or global MCP configuration.
4. Use explicit tool grants. Broad allow-all or remote delegation modes are prohibited.
5. Record structured outcomes and content-free provenance, not raw chat or secrets.
6. Repeat affected scenarios in both clients after release-relevant runtime, contract, projection, MCP,
   skill or toolchain changes; retain exact candidate binding for cross-client comparisons.

## CLI Worker Qualification

Use an isolated candidate projection of the canonical CodeGen, Reviewer and Validator profiles. Preserve their exact
models, scoped tools and workflow instructions; verify candidate hashes and permission parity before model execution.
Do not enable shipped workers merely because a diagnostic worker can call one MCP tool.

- CodeGen must use a current code-generation task, produce an accepted source tree/handoff, and preserve unrelated files.
- Reviewer must read the bound task inputs, submit the required criteria/findings for each review stage, and preserve
  blocker handling. Role separation is orchestration, not authenticated independent reviewer identity.
- Validator must request deterministic validation and completion; native checks and runtime-owned receipts cannot be
  replaced by model assertions. Offline tests use injected providers; live planning/deployment requires separate authority.
- Missing, foreign, wrong-type, completed, stale and expired tasks must be rejected without accepted-output or gate
  advancement. Compare journal, run state, accepted artifacts and affected files; model refusal alone is insufficient.
- Direct invocation may complete a valid task but must not approve gates, deploy or acquire extra tools. Exercise actual
  parent routing and restart as workflow functionality, without treating profile visibility as authentication.

Record each role's exact client/model/profile, tool calls, accepted hashes and negative outcomes. A model-access or
client-capability failure is an explicit qualification gap, not permission to substitute models or broaden tools.

### Current Worker Attempt

On 2026-09-21, isolated CLI candidates rendered from the canonical worker profiles retained their exact tool lists and
`GPT-5.6 Terra` model selection. CLI `1.0.86` rejected the Reviewer attempt before execution with
`Model "GPT-5.6 Terra" from --model flag is not available.` Source/candidate hashes were unchanged; the server recorded
zero worker calls, no accepted review and no approved gate. The installed CLI's `help config` subsequently established
`gpt-5.6-terra` and `gpt-5.6-sol` as the exact IDs for the configured models. Adapter `1.3.0` maps those display names
without changing model choice or permissions; the prior failed candidate remains preserved.

With the corrected Terra ID, the canonical Reviewer read its Requirements task and submitted one bound medium-severity
finding, leaving gates unapproved. CodeGen initially generated successfully but called `completeTask` again and reported
the resulting stale rejection as failure. Clarified worker/skill/tool guidance now states that `generateIac` already
completes the task. Fresh Bicep and Terraform CLI probes each generated and accepted exactly one tree/handoff and stopped.
Independent checks verified source bytes, accepted hashes and unchanged user canaries.

The first Validator probes exposed a real contract gap: an empty `validateTask` request returned only a staging/check
acknowledgement. The runtime now executes native source checks for task-only IaC validation requests and returns an
`execution` record plus typed `outputs` containing actual receipt references. It returns `valid: false` with exact
`blockedValidatorIds` when required checks remain unexecuted; submitted artifacts still use the staging/check path.

Fresh CLI probes on both tracks called task context and validation, reported the executed command IDs and receipt
hashes, and stopped without attempting completion when blocked. Independent audit verified three mocked native commands
per track, valid stored receipts, unchanged journal/run/canary and closed Gate 4. Expiry during execution and incomplete
bundle submission also fail in deterministic tests. This qualifies blocked-result handling, not a successful validation
workflow: executable security-baseline and logical-parity evidence remains missing, and empty policy maps are not
reported as executed policy checks. No placeholder hashes or simulated checks fill those gaps.

Native completion now rejects caller-supplied entries for required checks without executed receipts. Native preview
also rejects stored simulated required evidence before any provider command. Imported-policy preview tests explicitly
label their business-check adapter simulation after asserting the production rejection. Successful native validation
and preview remain unqualified until the missing executors exist; no worker enablement is implied by these checks.

The renderer also retains `disable-model-invocation: true` for these candidates. Parent routing therefore still needs
qualification as client functionality; the flag is not treated as a security boundary. No shipped target membership,
model substitution or worker permission change was made. Local candidate metadata is retained under
`dist/cli-worker-qualification-04` through `dist/cli-worker-qualification-07`.
Other review stages, parent routing and full worker qualification remain incomplete.

## Multiple-Selection Input

Keep native multi-select in VS Code and wherever the exposed question-tool schema supports it. When a standalone CLI session
exposes only single-choice and free-text input, collect the exact option values through the native tool's free-text
field, then show the proposed array and obtain explicit confirmation through that tool before `recordInput`.
Preserve the kernel option order, allowed values, request identity, typed arrays and user stop boundary. Never invent a
`multiSelect` parameter, silently reduce the question to one choice, infer aliases or record recommended defaults.
Invalid, empty or ambiguous input requires correction; corrected selections require confirmation again. Cancellation
records nothing. If free-text input or confirmation is unavailable, stop and report the limitation.

CLIENT-003 requires evidence for two selections, a single selection retained as an array, invalid-value correction,
confirmation rejection/correction and cancellation without submission. Verify one accepted answer event only after
confirmation, and fresh confirmation after a stale request. Use a disposable run, not an already accepted request.
Projection tests verify the instructions, not model compliance or UI capability. Record the actual input mechanism;
a confirmed free-text fallback can satisfy typed selection semantics but is not native checkbox qualification.

## Deferred Desktop Qualification

Desktop qualification is parked, not passed or waived for a claimed supported client. Its M1/M2/M3 milestones and
remaining worker, worktree, native Windows and model-routing concerns are retained in the
[deferred backlog](ROADMAP.md#deferred-standalone-copilot-desktop-app). They do not block this two-client release.
No desktop-specific transfer exception changes CLIENT-008 for the active VS Code and standalone CLI clients.
Confirmed-selection fallback observations from the app do not qualify the current standalone CLI candidate.

## Acceptance

A client passes only when every applicable blocking scenario has current evidence and all normalized comparisons verify.
The aggregate cannot grant release authority; it becomes one input to the final release receipt.

## VS Code Installation Lifecycle

The [VS Code installation lifecycle matrix](../../tools/registry/vscode-installation-lifecycle.v1.json) defines the
bootstrap, reload, update, rollback, uninstall, and reinstall scenarios required for end-user lifecycle qualification.
Its deterministic evidence is committed; live scenarios remain `not-run` until executed in a clean supported profile.

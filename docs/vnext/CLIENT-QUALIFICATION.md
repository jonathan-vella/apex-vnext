# Supported Client Qualification

This control defines release-blocking evidence for GitHub Copilot in VS Code Local and standalone Copilot CLI.
Generated projection tests are necessary but do not replace live client interaction.

[DECISION-029](DECISIONS.md#decision-029-ship-one-copilot-cli-projection) replaces VS Code Local with the VS Code
Copilot harness running the single CLI projection. Until that change ships, the VS Code column below describes the
current Local projection; afterwards it applies to the Copilot harness, and the
[planned CLI-only scenarios](#planned-cli-only-scenarios) become blocking.

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

## Planned CLI-Only Scenarios

These scenarios belong to the [CLI-only projection plan](ROADMAP.md#cli-only-projection). They are planned acceptance,
not evidence that the behavior exists.

| ID           | Required outcome                                                                                | Standalone CLI | VS Code Copilot harness |
| ------------ | ----------------------------------------------------------------------------------------------- | -------------- | ----------------------- |
| `CLIENT-021` | `apex-next` names the kernel-selected owner, then delegates it or prints `/agent` and a prompt  | Required       | Required                |
| `CLIENT-022` | The context sidekick loads, reads only status and next task, and changes no state               | Required       | Required                |
| `CLIENT-023` | Numbered multi-choice resolves in kernel order; invalid numbers are corrected before recording  | Required       | Required                |
| `CLIENT-024` | Built-in helper output alone cannot complete a task, create evidence or open a gate             | Required       | Required                |
| `CLIENT-025` | Workers run their required models and effort without launch flags or user overrides             | Required       | Required                |
| `CLIENT-026` | `init` and `update` reject the retired VS Code client; archived files are never installed       | Required       | Not applicable          |
| `CLIENT-027` | `.mcp.json` starts APEX MCP in interactive sessions and, when enabled, in `-p` sessions         | Required       | Required                |

## CLI-Only Projection Probes

Slice 1 of the [CLI-only projection plan](ROADMAP.md#cli-only-projection) ran local probes on 2026-09-23 at source
checkpoint `dc289ab`. Standalone runs used Copilot CLI `1.0.88` (`linux-arm64`) with an isolated `COPILOT_HOME`,
disposable Git fixtures under `dist/cli-probes`, explicit tool grants, synthetic agents and a fake `apex` MCP server
that logs every call. The VS Code run used VS Code `1.139.0` (`2242ebbb`) over WSL with the Copilot harness, Agent Host
protocol `0.9.0` and `@github/copilot-sdk` `1.0.15-unstable.35393089353.gfc44743`. These results characterize the
clients; they are not APEX projection or scenario evidence.

- **Model fields.** `.agent.md` frontmatter honors `model` (a string or an ordered list), `model-policy` and
  `reasoning-effort`. The documented `models`, `modelPolicy` and `reasoningEffort` spellings were ignored; that child
  ran on the session model at medium effort.
- **Worker settings.** `model: [gpt-6-luna, gpt-5.6-luna]` with `model-policy: required` and `reasoning-effort: max`
  ran through `task` on `gpt-6-luna` at max. A per-call `task` model was replaced by the required model with a notice.
  Direct `--agent` selection also sent max. A user `subagents` override could not change a required model but did
  lower its effort to low; under `preferred` it changed both. Ordered lists fall back only under `required`: otherwise
  an unavailable first entry failed `task` dispatch, and direct selection fell back to the session default model.
  Effort `max` on `gpt-5.4-mini` failed dispatch.
- **Tool lists.** `task` subagents received no tools beyond those declared. A directly selected agent with `tools: []`
  also received `skill` and `sql`.
- **Workspace MCP.** A trusted folder loaded `.mcp.json` in interactive and `-p` sessions without
  `GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP`. An untrusted folder loaded it in `-p` only with that variable set to
  `true`. `${VAR}` expanded in `env`. Relative `args` resolve against the session directory, so the server failed when
  a session started in a subdirectory.
- **`ask_user`.** Interactive sessions use the structured form. An `array` field with `items.enum` rendered checkboxes
  (Space toggles, Enter accepts, Ctrl+D declines, Esc cancels) plus an "Other" free-text entry, but the model received
  flattened text (`User responded: red, blue`), not an array. `task` subagents never receive `ask_user`, even when
  declared; the runtime sent the child an empty tool list.
- **`/agent` context.** `/agent <name>` switched agent and model and kept the conversation; the new agent recalled a
  code word from an earlier turn.
- **Sidekick.** Project and user agents with a `sidekick:` block loaded only as ordinary selectable agents. They never
  launched in `-p`, `-p --experimental` or interactive sessions. Selected directly, `send_inbox` returned "this session
  is not a sidekick agent".
- **Built-in helpers.** Helpers get only tools the calling agent holds; with a `task`-only caller, Explore had no file
  reader. With read tools and shell on the caller, glob search skipped the gitignored `.apex/work/` staging path, but
  explicit-path reads worked. Code-review and Security-review reviewed the staged file without a diff and cited correct
  lines. Rubber-duck on `claude-haiku-4.5` cited wrong lines, and built-in Task ran `bicep build` under
  `shell(bicep:*)`. Helpers inherit `task`; in the `task`-only run they spawned general-purpose agents until the depth
  limit of 4, while the runtime blocked review-to-review delegation.
- **VS Code Copilot harness.** The Agent Host discovered the workspace agents, flagged the `user-invocable: false`
  worker as not user-invocable, and exposed `.mcp.json` tools from the second turn. The sidekick showed no activity.
  Picking the agent did not apply it: each turn named it by a `vscode-remote://wsl%2Bubuntu/` URI, the host indexed
  `file://` URIs, and the runtime deselected it before every turn. `/agent` is not a harness command; the default
  agent ran the named agent through `task` instead. There the model list and efforts applied (`gpt-5.6-luna` high,
  worker `gpt-6-luna` max) and `ask_user` was unavailable. The worker's empty tool list arrived as `null`, and its
  prompt still carried `task` guidance.

Standalone sessions `60de3415`, `973b27ef`, `531d4b2a`, `b7cd037a` and `e37cc4bc` cover model settings. `dc91aa77`,
`e717ed91`, `3a1f34a5`, `a11b5bbf`, `366fe888` and `42e4f63e` cover workspace MCP; `bd350038`, `f14677a5`, `bfff54a8`
and `976871e9` cover the sidekick. `b3808832` covers `ask_user` and `/agent`, `dc3278a2` covers subagent input, and
`a2a3b50d` and `9502efed` cover helpers. The harness runtime session is `a3253c03-533b-4779-9544-7818e113abb6`. The
results select these options:

1. Slice 3 uses `model`, `model-policy` and `reasoning-effort`. Every listed model must support the declared effort.
   User effort overrides remain a CLIENT-025 gap.
2. Slice 4 renders `.mcp.json` with a server command that does not depend on the session directory.
3. Slice 5 collects required input in the foreground before delegation; `/agent` with a prompt remains the fallback.
   The sidekick needs a maintainer decision because this CLI build does not launch custom sidekicks.
4. Slice 6 passes explicit staging paths, relies on the owning agent's read tools and verifies helper line references.
   Task pre-checks add shell to the caller, and a `task` grant also exposes general-purpose delegation; both need a
   maintainer decision.
5. Slice 7 chooses between native checkboxes, whose answer returns as text, and numbered selection. Either way, the
   kernel validates the values.
6. Slice 11 cannot qualify the VS Code Copilot harness on WSL until picked agents apply, through an upstream fix or a
   verified workaround.

## Execution Rules

The clean-install package regression now exercises local archetype listing, exact-commit inspection, independent copy,
source-instruction exclusion, destination conflicts, hash-confirmed decision adoption and restart in both installed
client projections. It invokes the packaged CLI from independent consumer directories and verifies that Requirements
review remains next and no gate is approved. This is package/command-path evidence for parts of CLIENT-014 through
CLIENT-017, not live VS Code or Copilot CLI agent interaction and not complete acceptance of those scenarios.

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

On 2026-09-23, the maintainer authorized qualifying, enabling and shipping all three workers for personal candidate
testing. Adapter `1.6.0` includes CodeGen, Reviewer and Validator in standalone CLI and combined installations without
adding worker tools. All three profiles select `gpt-6-luna` and retain `reasoning-effort: max`; owning parents use
`gpt-6-sol`. The earlier attempts below remain historical evidence, not the current shipping decision.

CLI `1.0.87` session `993f7d6e-1914-4dab-8006-fbc3192a8f9a` delegated from Planner to CodeGen and Validator on Luna.
The installed Bicep compiler executed all six required checks for the storage-only fixture; generation and validation
each completed once. Independent receipt, source-hash, canary, journal and restart assertions passed with no approvals
or deployment and Gate 4 closed. Evidence is retained in `dist/cli-luna-qualification`.

Eight additional sessions reviewed Requirements, Architecture, Governance and Plan on both tracks. Each delegated to
Luna Reviewer at max effort, accepted one subject-bound review and preserved canaries and restart state. Findings
remained open; a clean Governance review could open a human gate but did not approve it. Fixture audits were corrected
to bind the freshly issued task and distinguish gate opening from approval; original session evidence was retained.
Stage-specific results are retained in `dist/cli-luna-review-*`.

Combined-profile Terraform session `6b540f4e-864b-4891-a24e-dc0adb6e6370` selected `APEX CLI CodeGen` and
`APEX CLI Validator` on Luna/max despite the VS Code profiles also being present. Generation completed once;
validation reported security-baseline and logical-resource-parity blockers without completing. Mocked Terraform
commands, bound receipts, generated bytes, restart state and closed Gate 4 were verified independently. Evidence is
retained in `dist/cli-luna-terraform-2`. This is blocked-result qualification, not native Terraform acceptance.

Launch with `copilot --reasoning-effort max` for this candidate. Tool-free direct-profile session
`c0de743e-da20-4ca9-8e22-c265dece2d89` used Luna but reported medium effort despite the frontmatter setting.
Explicit launch effort produced max in actual delegated worker configuration events. VS Code effort enforcement,
full paired-client workflows, review quality across real workloads and broader native validation remain to be tested.
No live Azure provisioning, authenticated Terraform planning, deployment or package publication was performed.

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

Adapter `1.4.0` no longer derives `disable-model-invocation` from `user-invocable`. Hidden discovery and delegation are
independent settings; an explicit invocation-disable flag remains honored. Canonical model/tool lists and shipped target
membership are unchanged. The isolated candidate enabled only existing declared parent-to-Reviewer routes.

Actual CLI probes routed Requirements, Architecture, Governance and Plan review through the canonical owning parents
to `APEX Reviewer` on both tracks. CLI traces identify the named child and `gpt-5.6-terra` model. Independent checks
verified one accepted review per case, exact subject/task bindings, open findings, all five required Architecture pillar
receipts, preserved user canaries and restart state, and no new gate decisions. Governance initially exposed a kernel
template alias mismatch; using `policy-property-map` instead of the workflow node name fixed completion in fresh probes.

These are bounded synthetic routing results, not full client or review-quality acceptance. Rejected submissions remain
recorded, and some non-Architecture reviews supplied optional pillar receipts. No authenticated independent reviewer
identity is claimed. The full workload lifecycle and both-track native Validator acceptance remain unqualified, so
shipped CLI workers are still absent.

Subsequent isolated Planner-to-CodeGen and Planner-to-Validator probes succeeded as routing checks on both tracks.
CodeGen accepted exactly one source tree/handoff per track; a fresh parent session delegated validation to the named
Validator, which reported exact runtime blockers without completing. Audit checks verified source hashes, native mock
command receipts, unchanged canaries, no new approvals/deployments and restart state. Evidence is retained under
`dist/cli-worker-routing-11`. This covers delegated blocked handling, not successful native validation.

The refreshed `dist/cli-worker-routing-12` probe used source checkpoint
`9e86b311d86fdc2b1c8424b61224eba5b42e10e2`, CLI `1.0.86`, canonical Planner `gpt-5.6-sol` and delegated Validator
`gpt-5.6-terra` selected from its agent definition. Bicep session `2371f739-b264-4f0f-8da5-8a0cb980b518` and Terraform
session `c0fc6cbb-3a7b-46ac-ab20-f32677b0e9cf` each made one validation call and no completion call. Both reported the
new map-bound empty-policy applicability check as executed and security/parity as blocked. Bicep's mocked empty compiler
output intentionally failed resource parity; this is not evidence that a real matching compiler output fails.
Independent audit verified receipts, the three fixed commands, unchanged validation head, closed Gate 4, preserved
canaries and restart state. Fixtures had simulated prerequisite approvals only; no new approvals or deployments were
issued. Parked Windows-only worktree edits remained outside this checkpoint. Shipped worker membership is unchanged.

The subsequent `dist/cli-worker-routing-13` probe used source checkpoint
`ca23ad5fdadb319d1946f47f0457187be2f310b1` and CLI `1.0.86`. Session
`4479a245-2dba-4ad2-b8f4-e7a02131b854` routed canonical Planner `gpt-5.6-sol` to `APEX Validator` using its configured
`gpt-5.6-terra`. The nine-resource Bicep storage fixture used ordinary `generateIac` and the installed Bicep compiler,
not mocked command output. One validation request returned all six required validator IDs with no blockers; one
completion reexecuted format/build/lint and accepted the source-bound native receipts. Independent audit verified exact
command arguments, receipt and source hashes, unchanged canary, restart state, no new approvals/deployments and closed
Gate 4. Prerequisite design/review approvals were synthetic fixture setup, not live workload acceptance. Parked Windows
edits remained in the source worktree and were excluded from the published checkpoint. This proves the bounded
`bicep-storage-only-baseline-v1` Validator path, not Terraform, mixed-service baseline coverage, a live Azure deployment,
or a clean packaged-client lifecycle. Shipped worker membership remains unchanged.

The follow-up `dist/cli-worker-routing-14/run-2` probe extended that path to actual delegated generation at source
checkpoint `152531d54135457fbc18e40f026369904643726a`, CLI `1.0.86`. Session
`7b4e74a8-f86d-4e58-9cbd-01a00ac07e56` routed Planner to CodeGen and then Validator; both children used
`gpt-5.6-terra` from their agent definitions. CodeGen called ordinary `generateIac` once and returned without duplicate
completion. Validator accepted all six native checks using the installed compiler. Independent audit verified exactly
one completion per stage, six fixed compiler commands, source hashes, canary preservation, restart state and closed
Gate 4, with no new approvals or deployments. The first setup attempt failed a canonical-tool assertion before runtime
creation; corrected setup preserved CodeGen's declared delegation capability and used a fresh directory. The same
storage-only, synthetic-prerequisite and unpackaged-client limitations apply; no worker membership changed.

Local evidence is retained under `dist/cli-worker-qualification-04` through `dist/cli-worker-qualification-07`,
`dist/cli-parent-qualification-08`, the `dist/cli-review-qualification-09-*` fixtures, and
`dist/cli-governance-qualification-10`. Failed probes are not replaced by the later successful receipts.

## Dual-Client Discovery Probe

At source checkpoint `678270277cab50e805482b14bdacea5c55f038c5`, Copilot CLI `1.0.86` explicitly selected both a
`target: github-copilot` profile and a `target: vscode` profile from one disposable workspace. Tool-free Terra sessions
`b7011ecc-be2a-4f13-bbb6-f87fd7880084` and `02f60ff6-2a28-4deb-8859-1bab0cef845a` returned their respective profile markers
with no tool requests or file changes. Evidence remains in `logs/dual-client-target-{cli,vscode}.jsonl` and
`dist/dual-client-target-probe`. Thus `target` alone does not prevent explicit cross-client selection in this CLI build.
This does not test automatic delegation, name collisions or VS Code filtering, and does not establish an authorization
failure. Simultaneous client packaging must preserve exact models/tools without relying on this unproven isolation.

The added-root follow-up at source `aade16e0b319e9a0ff3d74768da5309086e4a070` also retained the workspace profile rather
than overriding it. Baseline session `6224c6e3-c8bc-4c4b-a92f-865d2dd95f34` and added-root session
`b3d30b0c-c1cb-4e2a-8d20-ea8e8db728d3` both returned the workspace marker, with no tool requests or file changes.
Evidence remains under `dist/dual-client-added-root-probe`; this is a same-name precedence observation, not a trust boundary.

A subsequent routing-only fixture used the working-tree name-mapping adapter based on that commit. CLI session
`1cb50f1d-2f7b-41f8-bf24-e4fbe2afa036` delegated from `APEX CLI Planner` on Sol to `APEX CLI Validator` on its configured
Terra model while a separate VS Code Validator profile was present. Only the namespaced marker was returned. The parent
had delegation only and the child had no tools; no kernel workflow or cloud authority was available. Evidence remains in
`dist/dual-client-namespaced-probe`. This supports distinct CLI names, not full combined-profile or VS Code acceptance.

## Multiple-Selection Input

Keep native multi-select in VS Code and wherever the exposed question-tool schema supports it. When a standalone CLI session
exposes only single-choice and free-text input, collect the exact option values through the native tool's free-text
field, then show the proposed array and obtain explicit confirmation through that tool before `recordInput`.
Under the [CLI-only projection plan](ROADMAP.md#cli-only-projection), this becomes numbered selection: present the
options numbered in kernel order, accept the user's numbers, resolve them to option values and let the kernel validate
the array. Out-of-range, duplicate or non-numeric entries require correction. Confirmation is still required.
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

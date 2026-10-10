# Supported Client Qualification

This control defines release-blocking evidence for the three supported clients under
[DECISION-033](DECISIONS.md#decision-033-support-native-windows-clients-and-deliver-apex-as-an-agent-plugin): the VS
Code Copilot harness and the GitHub Copilot app on native Windows, and GitHub Copilot CLI on Linux and WSL2.
Generated projection and plugin tests are necessary but do not replace live client interaction.

The release target is the [client pivot scenarios](#client-pivot-scenarios) plus the shared matrix below. The plugin
and thin workspace projection are shipped in the `0.11.0-next.2` preview; live qualification remains pending.
The slice results below are exploratory history, not current release evidence. Use the
[human-run qualification kit](../how-to/qualify-live-clients.md) to freeze a candidate, prepare each host and record
scenario applicability and bounded evidence. Published `0.11.0-next.2` does not include #431; a source build at
`a4bc16fbe4eadea48902ab054ea7f02a8bdd008a` after #454 must not be identified by that version alone.
The earlier #431 source candidate and its exploratory results remain historical; the current candidate needs fresh
affected-scenario evidence without restoring retired root guidance.

Each client runs on its supported host with client local sandboxing on, without Docker or a devcontainer. Required
outcomes follow the [PRD](PRD.md), including both environment profiles, COE reuse and conversational changes. Basic
interaction checks accompany feature delivery; final installation qualification uses the APEX plugin. No token baseline
is required now. Existing executable gate alignment must be completed before affected scenarios; do not bypass it.

## Candidate Binding

Before interaction, record the exact source commit, package and runtime locks, managed projection digests, client
versions, executable hashes, MCP inventory, and clean consumer workspace identity. An update during a run invalidates
that client result.

The GitHub Copilot app is a supported client again. Its historical desktop receipts are provenance only and do not
count as current evidence. The app needs its own evidence identity alongside `github-copilot-cli` and
`github-copilot-vscode`. Also record the Windows build, whether local sandboxing is on, and the session model.
The current typed client-outcome contract accepts only those CLI/VS Code identities; app typed export/closure remains
a tooling gap. Keep an app-specific human worksheet; never relabel its evidence as another client.

## Scenario Matrix

| ID           | Shared required outcome                                                                  | VS Code (Windows) | Copilot app (Windows) | Copilot CLI (Linux/WSL2) |
| ------------ | ---------------------------------------------------------------------------------------- | ----------------- | --------------------- | ------------------------ |
| `CLIENT-001` | Candidate versions and hashes are bound before work.                                     | Required          | Required              | Required                 |
| `CLIENT-002` | Instructions, plugin agents, skills and hooks are discovered once.                       | Required          | Required              | Required                 |
| `CLIENT-003` | Missing input creates one kernel request and one typed answer event.                     | `ask_user`        | `ask_user`            | `ask_user`               |
| `CLIENT-004` | APEX MCP starts with the exact managed allowlist.                                        | Required          | Required              | Required                 |
| `CLIENT-005` | The APEX agent routes each stage and kernel worker boundaries hold.                      | Required          | Required              | Required                 |
| `CLIENT-006` | Gates, stale-state rejection, and operation denial match.                                | Required          | Required              | Required                 |
| `CLIENT-007` | Restart resumes the same journal head without chat history.                              | Required          | Required              | Required                 |
| `CLIENT-008` | Writer conflict and accepted transfer preserve owner epochs.                             | Required          | Required              | Required                 |
| `CLIENT-009` | Init, update, conflict, rollback, uninstall, and reinstall are atomic.                   | Required          | Required              | Required                 |
| `CLIENT-010` | Shared fake-provider workflow outcomes normalize equally.                                | Required          | Required              | Required                 |
| `CLIENT-011` | Bootstrap writes the thin projection and plugin settings at the runtime's exact version. | Required          | Required              | Required                 |

Unavailable client mechanics remain unavailable; they are not inferred as passing. CodeGen and Validator remain hidden
workers under revised ADR-0006, and rubber-duck replaces the Reviewer (DECISION-031); current-candidate qualification
is pending.
Direct-selection visibility is not a security pass/fail criterion; worker permissions remain unchanged.

That omission is a current qualification status, not permission to omit generation, review or validation. Demonstrate a
supported bounded path for every required outcome. These additional acceptance scenarios are planned requirements,
not assertions that corresponding runtime or registry coverage already exists:

| ID           | Required outcome in every supported client                                                      |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `CLIENT-012` | Clean consumer setup on the client's host, without WSL on Windows, a devcontainer or a checkout |
| `CLIENT-013` | Explicit ALZ/lab profile selection and correct supplied-versus-owned resource handling          |
| `CLIENT-014` | COE discovery, one-archetype selection, independent import and recorded source revision         |
| `CLIENT-015` | Manually copied project adoption without importing secrets, state or approval authority         |
| `CLIENT-016` | Relevant change questions, consequences and confirmation; unchanged decisions are reused        |
| `CLIENT-017` | Affected outputs refresh, unrelated files remain unchanged and manual conflicts are confirmed   |
| `CLIENT-018` | Target-subscription policy import; full baseline never enters model-facing context              |
| `CLIENT-019` | Complete design and operational handoff reviewed against the PRD quality reference              |
| `CLIENT-020` | The plugin starts the bundled APEX MCP and preserves active runs across plugin updates          |

`CLIENT-012` follows the [clean-host checklist](../how-to/manage-installation.md#verify-a-clean-host) on each host in
[CP-20](https://github.com/jonathan-vella/apex-vnext/issues/386); automated tests cover only the doctor rules with fake
hosts.

Exercise both IaC tracks and both profiles with representative cases in the existing tests. Reuse fixtures and helpers;
do not build a separate benchmark harness. Record explicit gaps until implemented.

## Planned CLI-Only Scenarios

These scenarios belong to the [CLI-only projection plan](ROADMAP.md#cli-only-projection), closed on 2026-10-05.
DECISION-032 retires CLIENT-021 (agent selection and scope prompts) and DECISION-033 retires CLIENT-025 (pinned worker
models); CLIENT-031 and CLIENT-037 replace them. CLIENT-027 now applies to the plugin's `mcp.json`. CLIENT-023,
CLIENT-024, CLIENT-026 and CLIENT-027 stay release-blocking in every supported client alongside the client pivot
scenarios; CLIENT-022 stays deferred.

| ID           | Required outcome                                                                                              | Standalone CLI | VS Code Copilot harness |
| ------------ | ------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------- |
| `CLIENT-021` | `apex-next` names the kernel-selected owner, then delegates it or prints its client selection step and prompt | Required       | Required                |
| `CLIENT-022` | Deferred with the context sidekick until a CLI release launches custom sidekicks                              | Deferred       | Deferred                |
| `CLIENT-023` | Multi-choice uses checkboxes or numbered fallback in kernel order; invalid entries are corrected first        | Required       | Required                |
| `CLIENT-024` | Built-in helper output alone cannot complete a task, create evidence or open a gate                           | Required       | Required                |
| `CLIENT-025` | Workers run their required models and effort without launch flags or user overrides                           | Required       | Required                |
| `CLIENT-026` | `init` and `update` reject the retired VS Code client; archived files are never installed                     | Required       | Not applicable          |
| `CLIENT-027` | `.mcp.json` starts APEX MCP in interactive sessions and, when enabled, in `-p` sessions                       | Required       | Required                |

The selection step is `/agent <name>` in standalone CLI and the Agent picker in the VS Code Copilot harness, where
`/agent` is not a command. Harness scenarios that need a selected agent, including CLIENT-021, depend on picked agents
applying; the [slice 1 probe](#cli-only-projection-probes) found that they do not over WSL.

## Client Pivot Scenarios

These scenarios belong to the [client pivot](ROADMAP.md#client-pivot). They are planned acceptance, not evidence that
the behavior exists. Each is required in the VS Code Copilot harness and the GitHub Copilot app on Windows and in
Copilot CLI on Linux and WSL2, unless noted.

| ID           | Required outcome                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLIENT-028` | The plugin installs through the Copilot CLI store; its agents, skills, hooks and MCP server load once in each client                                   |
| `CLIENT-029` | Plugin MCP starts with `node` from the plugin folder without registry access and receives the workspace explicitly                                     |
| `CLIENT-030` | Plugin update and rollback preserve an active run; on Windows the update follows the documented VS Code steps                                          |
| `CLIENT-031` | One APEX agent completes every stage without agent switches; it reuses stated project values and stops at human gates (Gate 1, Gate 4)                 |
| `CLIENT-032` | Hidden workers never ask questions, and the hook denies the APEX agent as a `task` target                                                              |
| `CLIENT-033` | Review findings come only from captured rubber-duck output bound to the prompt and artifact; tampering fails closed                                    |
| `CLIENT-034` | Sessions in app-created worktrees share the main checkout's `.apex/`, and a second writer is rejected (app, CLI)                                       |
| `CLIENT-035` | With local sandboxing on, the workflow completes, including Azure CLI sign-in, pricing and native validation                                           |
| `CLIENT-036` | A duplicated state-changing tool call, as HydraFusion can produce, has no extra effect                                                                 |
| `CLIENT-037` | Agents without model pins run under the user-selected session model                                                                                    |
| `CLIENT-038` | APEX MCP answers `server/discover`, the client negotiates `2026-07-28`, and the session records the negotiated version                                 |
| `CLIENT-039` | Non-production uses azd/Bicep or native Terraform; confirmed intent and final preview approval retain reviews, target binding and native safety        |
| `CLIENT-040` | Production CI owns its run and preview and verifies an actual human review receipt before applying the bound candidate; no developer authority handoff |
| `CLIENT-041` | Purpose is confirmed independently of ALZ/standalone foundation; changed purpose/target cannot reuse lab deployment authority                          |
| `CLIENT-042` | Optional production setup inspects, generates, explicitly configures and verifies; unavailable approval features or partial setup stay blocked         |

CLIENT-039 through CLIENT-042 are DECISION-036 target acceptance, not implemented client or live deployment evidence.
CP-26/CP-27 own the non-production path; CP-28/CP-29 own production execution/setup; CP-30 owns deployment qualification.
CP-20 may qualify current client mechanics independently. Deferred production outcomes are not passing evidence and
are not required to claim the initial non-production milestone complete.

The lab approval flow (CP-27) is implemented in the kernel and guidance, but no client has been qualified against it.
`CLIENT-006` and `CLIENT-031` should observe it per client now; `CLIENT-039` and `CLIENT-041` add it to their own
outcomes once they become runnable:

- **Purpose.** A new run reports purpose `lab`; `production` is rejected with a stable error. The Gate 1 confirmation
  states the purpose, target and requirements it binds, and a different purpose needs a new run. Promotion to a
  different target reopens Gate 1 and redoes the requirements review in the new run; same-target promotion inherits it.
- **One intent confirmation.** Gate 1 is the only intent decision the agent asks for, through the kernel-routed
  `gateDecide` with the user's explicit confirmation.
- **No Gate 2/3 prompts.** After the Architecture and Plan reviews and deterministic checks pass, the kernel records
  Gate 2 and 3 as `ready` (with `readyAt` and a `gate.readiness-recorded` event) with no approval evidence or actor, and
  the agent neither asks for them nor calls `gateDecide`. `gateDecide` or `gate decide` for a lab Gate 2 or 3 is refused
  with reason `GATE_READINESS_AUTOMATIC`. Until readiness is recorded, `nextTask` reports
  `Gate N readiness checkpoint is not recorded: <reason>` and the agent relays that blocker instead of asking for
  approval. `ready` never satisfies Gate 1, Gate 4 or production.
- **Final approval.** Gate 4 remains the single final approval and is decided only in the trusted terminal. Its
  `operations/deployment-preview.md` Approval Context shows purpose, target, gate provenance, architecture, cost
  estimate and accepted risks; its tamper check is best-effort and local (immutable binding is
  [#466](https://github.com/jonathan-vella/apex-vnext/issues/466)). Apply and destroy each need their own preview and
  approval; changed requirements, a new risk acceptance or a stale preview need a new confirmation.

A readiness checkpoint recorded as, or counted as, human approval fails these scenarios.

`CLIENT-039` through `CLIENT-042` are **planned and not runnable**: CP-26 to CP-30 have not delivered the azd/Bicep,
purpose-bound, CI-owned production or setup paths. Do not run these scenarios through direct azd commands or claim
readiness from the shipped skill guidance. `CLIENT-012` still needs live clean-host evidence even though implementation
issue #378 is closed. The qualification kit records actual Windows host/client sandbox observations without changing
DECISION-033's recorded 25H2/24H2 support assumption based on vendor-documentation differences alone.

### CLIENT-038 Offline Transport Evidence

On 2026-10-09, offline installed-plugin probes passed for source
`7fbb02e1593a26ee710e6735df1ac21641efcee4` and published `0.11.0-next.2`. The published install preserved tree SHA-256
`93407061c09f00cc1251a582a16840547a6c7bbe256c468aba0c4d2c4f15df22`, advertised
`supportedVersions: ["2026-07-28"]`, listed 37 tools, and returned initialized status equal to the CLI. The source
installed-plugin smoke and two focused modern lifecycle tests also passed. Private evidence locators are
`client038-marketplace-evidence.json`, `client038-smoke.log`, `client038-lifecycle-tests.log` and probe source
`client038-marketplace-probe.mjs` in the CP-20 session evidence.

The earlier manual probe omitted modern `params._meta` and was interpreted as legacy. The existing smoke helper
sends protocol version, clientInfo and clientCapabilities metadata correctly; no product regression or decision
change is indicated. These are offline transport/package results only. No live harness, app or CLI agent run
occurred, so CLIENT-038 remains **not run per client** until the human records actual session negotiation.

## CLI-Only Projection Probes

Historical probe receipts are preserved in the [archive catalog](../../.archive/CATALOG.json) (entry `docs/vnext/CLIENT-QUALIFICATION.md`).
These results characterize the clients; they are not APEX projection or scenario evidence and do not qualify
the current candidate. Follow the current scenario matrices, execution rules and worker acceptance constraints.
Restoration is historical inspection only; see the [restore guide](../../.archive/RESTORE.md).

### Slice 5 Probes

Historical receipts are in the catalog entry above; current candidate qualification remains pending.

### Slice 6 Probes

Historical receipts are in the catalog entry above; current candidate qualification remains pending.

### Slice 7 Probes

Historical receipts are in the catalog entry above; current candidate qualification remains pending.

### Slice 11 Standalone Attempt

Historical receipts are in the catalog entry above; current candidate qualification remains pending.

### Slice 11 Re-Run On A Subscription

Historical receipts are in the catalog entry above; current candidate qualification remains pending.

## Execution Rules

The clean-install package regression now exercises local archetype listing, exact-commit inspection, independent copy,
source-instruction exclusion, destination conflicts, hash-confirmed decision adoption and restart in both installed
client projections. It invokes the packaged CLI from independent consumer directories and verifies that Requirements
review remains next and no gate is approved. This is package/command-path evidence for parts of CLIENT-014 through
CLIENT-017, not live VS Code or Copilot CLI agent interaction and not complete acceptance of those scenarios.

1. Use clean independent consumer workspaces for each client.
2. Install the same exact plugin and package candidate through one channel.
3. Trust only the qualification workspace. A disposable, isolated profile root may be mutated solely for the managed
   VS Code bootstrap agent scenario; do not mutate a real user profile or global MCP configuration.
4. Turn on client local sandboxing and record the client-reported sandbox state in the candidate binding. Allow All
   tool permissions are allowed only when the client reports sandboxing on; otherwise use explicit tool grants. Remote
   delegation modes stay prohibited, and gate decisions still come from the maintainer.
5. Record structured outcomes and content-free provenance, not raw chat or secrets.
6. Repeat affected scenarios in every supported client after release-relevant runtime, contract, plugin, MCP, skill or
   toolchain changes; retain exact candidate binding for cross-client comparisons.

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
adding worker tools. At that time all three profiles selected `gpt-6-luna` with `reasoning-effort: max`, and owning
parents used `gpt-6-sol`. DECISION-033 later removed these model pins; workers now run on the session model the user
picks. This attempt qualified the pinned profiles only. The earlier attempts below remain historical evidence, not the
current shipping decision.

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
Under the [CLI-only projection plan](ROADMAP.md#cli-only-projection), use `ask_user` checkboxes where the tool offers an
array field and map the returned text back to exact option values. Otherwise present the options numbered in kernel
order, accept the user's numbers and resolve them to option values. The kernel validates the array either way.
Out-of-range, duplicate, non-numeric or unmatched entries require correction. Checkbox answers that map exactly need
no extra question; resolved numbers or free text still require explicit confirmation.
Preserve the kernel option order, allowed values, request identity, typed arrays and user stop boundary. Never invent a
`multiSelect` parameter, silently reduce the question to one choice, infer aliases or record recommended defaults.
Invalid, empty or ambiguous input requires correction; corrected selections require confirmation again. Cancellation
records nothing. If free-text input or confirmation is unavailable, stop and report the limitation.

CLIENT-003 requires evidence for two selections, a single selection retained as an array, invalid-value correction,
confirmation rejection/correction and cancellation without submission. Verify one accepted answer event only after
confirmation, and fresh confirmation after a stale request. Use a disposable run, not an already accepted request.
Projection tests verify the instructions, not model compliance or UI capability. Record the actual input mechanism;
a confirmed free-text fallback can satisfy typed selection semantics but is not native checkbox qualification.

## Copilot App Qualification

DECISION-033 makes the GitHub Copilot app a supported client, so desktop qualification is no longer parked. The app
runs the same scenarios as the other clients, plus CLIENT-034 for app-created worktrees. Turn on local sandboxing in
the app's project settings before a run. The parked M1/M2/M3 milestones in the
[desktop plan](../../.archive/CATALOG.json) (entry `docs/vnext/COPILOT-DESKTOP-PLAN.md`) are design history;
their receipts and confirmed-selection observations do not
qualify the current candidate.

## Acceptance

A client passes only when every applicable blocking scenario has current evidence and all normalized comparisons verify.
The aggregate cannot grant release authority; it becomes one input to the final release receipt.

## VS Code Installation Lifecycle

The [VS Code installation lifecycle matrix](../../tools/registry/vscode-installation-lifecycle.v1.json) defines the
bootstrap, reload, update, rollback, uninstall, and reinstall scenarios for the VS Code Copilot harness, which runs the
CLI projection. Its deterministic evidence is committed; live scenarios remain `not-run` until executed in a clean
supported profile. Slice 8 retired the profile bootstrap agent scenario with the VS Code Local projection.

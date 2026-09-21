# Plan: Native Windows Copilot App Support

**PARKED - 2026-09-21.** The maintainer deferred all standalone desktop-app work and native Windows qualification.
Active work now targets VS Code Local and standalone Copilot CLI on WSL2 only. Do not execute the phases below unless
the maintainer explicitly reactivates this plan after those clients' required workflows are confirmed.
Preserve probe state and evidence. Upstream issues [github/app#4097](https://github.com/github/app/issues/4097) and
[github/app#4098](https://github.com/github/app/issues/4098) are retained follow-up items; their resolution alone does
not authorize resuming this plan. The current [PRD](PRD.md) and [roadmap](ROADMAP.md) supersede its release scope.

Owner: client experience maintainers. This document preserves historical implementation planning; it is not a binding
release control, executable prompt, qualification receipt or independent workflow authority. Reactivation is governed
by the [deferred backlog](ROADMAP.md#deferred-standalone-copilot-desktop-app).

## Historical Plan

Build on **`feat/copilot-desktop-app`**, using the existing APEX runtime and custom agents.
Desktop support was mandatory when this plan was approved; that release requirement is now deferred.
Implementation, adapter qualification and complete product qualification are separate claims.
This is a plan, not evidence that any new capability works.

## Agreed Scope

- Native Windows first, with source repositories normally under `C:\ghapp`.
- Observe where the app actually creates worktrees; their location is not assumed to be under `C:\ghapp`.
- Target the latest stable app, recording the exact installed app build for every qualification run.
- User-reported starting version is `1.1.123`; verify it rather than silently substituting a public release label.
- Use local Interactive sessions with APEX custom agents, including in app-created worktrees.
- Each worktree has an independent APEX run. Manual foreground specialist switching is acceptable.
- Use Windows CI plus guided app tests on the user's machine. Show prerequisite installation details before installing.
- Preserve existing VS Code and CLI behavior. App WSL hosting, other desktop operating systems, cross-client run transfer,
  and concurrent writers to one run are outside this initial delivery.
- Do not enable cloud sessions, Autopilot, app automations or Agent Merge as part of qualification.
- No authenticated Azure operations, deployment, publication or release without separate approval.

## Custom Agents, Not Built-In Plan Mode

APEX Planner is not the app's built-in Plan mode. It needs authorized write operations such as `apex/planComplete`.
Retain each custom agent's declared tools and kernel authorization boundaries.
Built-in Plan-mode qualification and a mode-specific read-only MCP mechanism are not required.
Correct the earlier WSL-first requirement wording and remove any contrary app-mode assumptions during phase 1.

## Milestones

| Milestone                                            | Required proof                                                            | Does not establish                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| M1: Native Windows runtime verified                  | Installed-package runtime and lifecycle tests on Windows CI               | Desktop UI compatibility                 |
| M2: Desktop adapter and local interactions qualified | Real app discovery, input, continuation, isolation and lifecycle evidence | Complete product workflows               |
| M3: Required product workflows qualified             | Both IaC tracks and profiles, with all applicable workflow outcomes       | Cloud qualification or release authority |

Earlier milestones may be delivered explicitly as partial progress. Only M3 satisfies the mandatory local desktop
workflow target. Missing governance, COE or worker capabilities remain named blockers to applicable product acceptance;
they are neither silently waived nor automatically added as unrelated implementation work to this branch.

## Implementation Phases

### 1. Align Requirements And Acceptance

Update the pending PRD, roadmap, checkpoint, support matrix and client qualification documents to native Windows first,
custom agents in Interactive sessions, independent worktree runs, and the three milestones above.
Preserve the existing clients' supported host paths and safety requirements.
Keep desktop work separate from governance issue #344, but identify shared product dependencies explicitly.

**Exit:** scope and scenario ownership agree; no document equates a projection, connectivity test or intake check with
complete desktop support.

### 2. Prove A Thin App Workflow Before Full Integration

Record the actual app build, observable embedded-engine version, Windows version/architecture, toolchain, package hashes,
projection digest and workspace identity. If the embedded-engine version cannot be observed, record that limitation;
do not infer it from the standalone CLI or claim complete engine binding.

Use a disposable consumer repository with an installed APEX package, outside the source checkout:

- Discover and select a custom APEX agent; verify assigned model, skills, explicit grants and packaged MCP startup.
- Run read-only status, obtain one kernel-owned input request, ask a native question and record the user's real answer.
- Treat successful `recordInput` as the bounded authorized local state transition; no gate approval is needed for this probe.
- Switch to an appropriate specialist manually, carry the exact stop scope, and resume from persisted state.
- Relaunch the app/session and confirm the same worktree, run and expected journal state.
- Repeat the bounded probe in an actual app-created worktree, using an independent run.

Identify an executable, authority-preserving path for code generation, review and validation now. Manual foreground
routing alone is not proof of worker support. Use the smallest non-cloud fixture-backed invocation needed to test
caller/task identity and tool boundaries; do not impersonate workers through generic tasks or shell wrappers.

**Gate:** native questions, authorized writes, specialist continuation, worktree binding and a viable required-worker
path have evidence, or an explicit blocker with a reproduction. Stop broad adapter investment on an unavailable mechanism.
Minimal phase-3 portability fixes may unblock this probe; label modified probe candidates precisely and rerun it.

### 3. Verify Native Windows Runtime And Add CI

Add a focused Windows CI lane during this phase, not only at final integration. Reuse existing tests and package tooling.
Start with demonstrated managed-path and process-launch failures; do not make speculative platform-wide changes.

- Define portable serialized paths separately from native filesystem paths. Exercise install/update/doctor/rollback/
  uninstall/reinstall round trips, including managed-file paths, base references and conflict detection.
- Test native executables and command shims, executable paths with spaces, shell-sensitive arguments and the environment
  inherited by a GUI-launched app. A successful PowerShell invocation alone does not prove GUI launch compatibility.
- Keep argument-based process execution. Do not enable shell execution globally to make Windows shims work.
- Verify timeout and cancellation cleanup, including descendant processes, without terminating unrelated processes.
- Test atomic replacement, crash recovery, live/dead lock owners, contention, path casing, traversal and junction/reparse
  boundaries on real Windows. WSL execution against `/mnt/c` is not native Windows evidence.
- Run a packed installation outside the source checkout without development dependencies or unpublished runtime state.
- Preserve Linux regressions and update the existing workflow integrity contracts for any CI changes.

**Exit (M1):** Windows runtime and installed-package lifecycle checks pass; skipped security scenarios remain gaps.

### 4. Implement Desktop Identity, Projection And Evidence Contracts

After the feasibility gate, add a distinct desktop client identity to onboarding, manifest, projection, selection,
lock/provenance and bootstrap validation. Reuse CLI rendering only for verified compatible mechanics; do not alias
desktop evidence to CLI evidence or invent an unverified agent target label.

Separate per-client qualification from cross-client equivalence. Replace active pair-only assumptions where needed
with explicit required-client aggregation, preserving historical receipts as historical evidence.
Test rejection of absent desktop results, duplicate/mismatched client IDs, stale candidates, incompatible projections,
unsupported app builds and missing required provenance. Do not turn unknown data into a passing default.

Bind source/package/runtime/projection hashes, app build, observable engine identity and actual workspace identity.
An app or embedded-engine update invalidates affected evidence; repeat affected checks before acceptance.
No extra independently editable customization tree or workflow engine is introduced.

**Exit:** desktop installs under its own identity; qualification cannot mistake two-client evidence for three-client success.

### 5. Qualify Worktree Isolation, Lifecycle And Agent Behavior

Distinguish tracked managed files from worktree-local installation metadata, runtime generations and run state.
Bootstrap at the actual worktree root through existing lifecycle APIs; never silently copy `.apex` state from a parent
or resolve through Git's common directory to share writable APEX state.

Require tests proving:

- Every MCP instance binds to its selected worktree, not the parent checkout or another session.
- Two independent worktrees can operate concurrently without sharing run identity or writer authority.
- Parent or sibling approvals and receipts cannot authorize another run; parent and sibling state remain unchanged.
- Restart reconnects to the same intended worktree/run; a wrong or missing binding fails closed.
- Removal and recreation at the same path cannot silently resume an unrelated run or reuse its authority.
- Missing local runtime/metadata produces an actionable bootstrap requirement, not fallback to another installation.
- Worktree deletion has a documented state-retention/export procedure; Git commits do not preserve ignored runtime state.
- Native questions, exactly recorded answers, scoped specialist continuation, denial, cancellation and recovery work.
- Required generation/review/validation mechanisms preserve caller identity and bounded task permissions.

**Exit (M2):** actual app interactions and worktree/lifecycle tests pass on one exact candidate. Windows CI alone does
not qualify the UI. Missing safe worker execution remains a blocker, not an accepted omission inherited from the CLI.

### 6. Qualify The Complete Local Workflow Matrix

Exercise Bicep and Terraform across ALZ-backed and standalone profiles. Cover intake, architecture, governance import,
planning, generation, review/revision, validation and restart with explicit human decisions in disposable test runs.
Use real local build/format/lint/validate tools where applicable, plus clearly identified fixture evidence and mocked
provider execution. Do not trigger authenticated provider calls or fabricate real pricing, governance or deployment proof.

Check required installation and state lifecycle scenarios, cross-client normalized outcomes and regressions in the
existing supported clients. Record user-observed UI steps separately from automatically captured runtime evidence.
Missing upstream app mechanics and separate product dependencies each need an owner, reproduction and disposition.

**Exit (M3):** every applicable local product scenario passes for the exact desktop candidate, with existing-client
regressions clean. Otherwise report the highest achieved milestone and retain outstanding blockers explicitly.

### 7. Integrate, Review And Hand Off

Run owning-package builds and focused tests after each slice, then `npm run qualify:vnext` at the integration checkpoint
and the required Windows suite. Do not overlap asset generation or builds with packaging qualification.
Keep hooks and CI enabled; review through a PR before marking support complete.

Provide a PowerShell/app runbook with prerequisites, installation, project/worktree selection, Interactive mode,
`/agent` selection, model/MCP checks, bounded test prompts, expected receipts and restart verification.
Document how to identify the actual worktree, inspect pending state, recover from a failed setup and preserve evidence.
Do not publish, merge, deploy or change real global settings as an implicit consequence of passing tests.

## Key Implementation Areas

- [service.ts](../../packages/cli/src/service.ts): bootstrap, managed paths, Git boundaries and installation lifecycle.
- [process-runner.ts](../../packages/capabilities/src/process-runner.ts): safe native launching and process cleanup.
- [files.ts](../../packages/kernel/src/files.ts) and [run-repository.ts](../../packages/kernel/src/run-repository.ts):
  atomic writes and Windows locking semantics, changed only for demonstrated defects.
- [prepare-assets.mjs](../../packages/cli/scripts/prepare-assets.mjs) and [assets.ts](../../packages/cli/src/assets.ts):
  projection generation, client identity and provenance.
- [onboarding.ts](../../packages/contracts/src/onboarding.ts), [evidence.ts](../../packages/contracts/src/evidence.ts) and
  [manifest.json](../../customizations/manifest.json): explicit desktop contracts and strict declarations.
- [live-qualification.mjs](../../tools/scripts/live-qualification.mjs),
  [compare-client-outcomes.mjs](../../tools/scripts/compare-client-outcomes.mjs) and
  [compose-client-outcome-closure.mjs](../../tools/scripts/compose-client-outcome-closure.mjs):
  per-client evidence and aggregation.
- [ci.yml](../../.github/workflows/ci.yml) and
  [github-workflow-contract.json](../../tools/registry/github-workflow-contract.json): bounded Windows coverage and CI integrity.
- [CLIENT-QUALIFICATION.md](CLIENT-QUALIFICATION.md): explicit scenario and milestone acceptance.

## Evidence Sources And Limits

- [Official app repository](https://github.com/github/app).
- [Official session documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions).
- [Official slash-command reference](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/slash-commands).
- [WSL preview article](https://www.michaelscollier.com/enabling-wsl-support-for-the-github-copilot-app/): background for
  deferred WSL hosting, not evidence of current APEX compatibility or current app defects.

Documentation and repository inspection inform hypotheses; actual native Windows and app execution establish support.
This saved plan preserves historical intent, not execution status. Consult the current PRD and backlog before resuming.

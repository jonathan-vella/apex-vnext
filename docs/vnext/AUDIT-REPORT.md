# APEX vNext — End-to-End Project Audit Report

> [Current Version](../../VERSION.md) | Zero-trust, first-principles audit of runtime packages, workflow contracts,
> artifacts, customizations, tooling, documentation, and validation coverage.

- **Audited Commit:** `871be4f0f99767dd4e63b515b142fbbcc0ffeb90` (`main`)
- **Audit Date:** 2026-10-19
- **Execution Mode:** `mode=full` (zero-skill, zero-instruction isolation; 7 parallel tracks + `rubber-duck`
  challenger pass)
- **Remediation Status:** **Remediated** under [CP-32](https://github.com/jonathan-vella/apex-vnext/issues/495) on
  branch `fix/cp-32-audit-remediation` (`c49fb45d`, `9a2bd31c`, `304372cb`, and documentation closure slice)

## Executive Summary And Health Scorecard

The executable TypeScript runtime (`packages/kernel`, `packages/contracts`, `packages/capabilities`,
`packages/renderers`, `packages/cli`, `packages/testkit`), JSON schemas, MCP server (`@modelcontextprotocol/server`
v2), and managed plugin hooks (`plugin/hooks/apex-hook.mjs`) demonstrate strong fail-closed engineering across journal
hash-chaining, single-writer epochs, task/subject binding, `azd` version/environment pinning, and `preToolUse`
command/parameter enforcement.

No critical (`🔴 CRITICAL`) security or governance bypasses were found in the executable runtime. The audit identified
**6 High (`🟠 HIGH`)**, **11 Medium (`🟡 MEDIUM`)**, and **5 Low (`⚪ LOW`)** findings spanning runtime lock/state
edge cases, workflow manifest-to-engine drift, validator blind spots, and cross-document drift in `README.md`,
`AGENTS.md`, `docs/vnext/*`, and `docs/reference/*`. All 22 findings have been remediated and verified under
[CP-32](https://github.com/jonathan-vella/apex-vnext/issues/495).

| Track | Surface                                                                          | Status        | Critical | High | Medium | Low | Key Assessment                                                                                                                  |
| ----- | -------------------------------------------------------------------------------- | ------------- | -------: | ---: | -----: | --: | ------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Runtime Packages (`packages/*`)                                                  | 🟢 Remediated |        0 |    2 |      2 |   1 | Remediated in `c49fb45d`: guarded asset-lock quarantine, central MCP review-pending guard, `ProcessRunner` & `lstat` hardening  |
| 2     | Workflow & Shipped Configs (`config/*.v1.json`)                                  | 🟢 Remediated |        0 |    1 |      1 |   0 | Remediated in `c49fb45d`: rejected gates map to `approval-rejected`; conditional refresh edges and `WorkflowEngine` checks      |
| 3     | Artifacts, Schemas & Renderers (`packages/contracts`, `renderers`)               | 🟢 Remediated |        0 |    1 |      2 |   1 | Remediated in `9a2bd31c`: duplicate scorecard rejection, binding guard, brace escaping, keyed array diffing, and numeric guards |
| 4     | Managed Customizations & Plugin (`customizations/`, `plugin/`)                   | 🟢 Remediated |        0 |    0 |      1 |   1 | Remediated in `9a2bd31c` & `304372cb`: `apex-next` `user-invocable: true` declared; baseline cleared; plugin version/digest     |
| 5     | Repo Governance, Prompts, CI & Tooling (`.github/`, `tools/`)                    | 🟢 Remediated |        0 |    1 |      2 |   2 | Remediated in `304372cb`: non-zero exit & fallback metadata in `fetch-azure-deprecations.mjs`; repoRoot & authoring ref updates |
| 6     | Spec, Architecture & Documentation Drift (`docs/`, `README.md`, `AGENTS.md`)     | 🟢 Remediated |        0 |    1 |      2 |   0 | Remediated in Slice 4 (`CP-32`): reconciled `README.md`, `AGENTS.md`, `PROJECT.md`, `REGISTER.md`, `PRD.md`, and reference docs |
| 7     | Test Coverage & Validator Blind Spots (`tools/scripts/validate-*.mjs`, `tests/`) | 🟢 Remediated |        0 |    0 |      1 |   0 | Remediated in `304372cb`: YAML-parsed CI consumer checks, reverse `package.json` checks, and fenced-code stripping              |

### Baseline Verification Commands Executed

- `npm run build:vnext` — Passed (`exit 0`)
- `npm run validate:vnext` — Passed (`exit 0`)
- `npm run test --workspaces --if-present` — Passed (`exit 0`, including 547 capability tests and all
  kernel/contracts/renderers/cli suites)
- `npm run test:vnext-validator` — Passed (`exit 0`)
- `npm run test:vnext-pack` — Passed (`exit 0`)
- `npm run validate:_node-core` — Passed (`exit 0`)
- `npm run lint:md` — Passed (`exit 0`)
- `npm run validate:_node` — Failed (`exit 1` in `validate:tool-versions` solely because the external `terraform`
  binary is not installed on this Linux host; `bicep`, `az`, and `node` pins passed)

### CI Follow-Up For PR #496

The baseline results above describe the audited commit, not every subsequent remediation head. CI on `a9c15483`
failed in the Linux qualification job and Windows CLI shards 1 and 2: the new duplicate-measurement rejection
(`F-004`) threw an untyped evaluator error before the workflow could report its normal `APEX_VALIDATION` diagnostic.
The Windows package aggregate failed because those shards failed; its package tests did not run.

The repair preserves rejection of duplicate rules and measurements, invalid samples/values, and non-zero `exact`
tolerance. Expected scorecard input failures now carry typed paths and are translated into issues by
`quality:scorecard-decidable`; unexpected errors still propagate. Regressions cover both logical IaC lifecycles,
typed error details, unchanged run/journal state after rejection, and successful completion after corrected evidence.
Hosted Linux and Windows results must be verified on the repaired PR head before claiming CI acceptance.

---

## Findings Summary Table

| ID      | Severity  | Surface                    | File(s) & Line(s)                                                                                                                                                                                                 | Category                | Summary                                                                                                                                                                                                                | Proof / Verification              |
| ------- | --------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `F-001` | 🟠 HIGH   | Runtime / CLI              | `packages/cli/scripts/prepare-assets.mjs:53-76`                                                                                                                                                                   | Concurrency / TOCTOU    | `acquireAssetGenerationLock()` deletes expired lock directories without atomic quarantine or token recheck, allowing a contender to delete a newly acquired lock.                                                      | Code trace & challenger confirmed |
| `F-002` | 🟠 HIGH   | Workflow / Kernel / CLI    | `packages/kernel/src/gates.ts:24-36`, `packages/cli/src/service.ts:6841-6859`, `9753-9761`, `9952-9967`, `config/workflow.v1.json:915-926`                                                                        | State Machine / Routing | Rejected human gates record `state: "rejected"` but never map to `WorkflowState.state = "approval-rejected"`, leaving `approval-rejected` dormant and reporting `"Gate N approval is required"`.                       | Code trace & challenger confirmed |
| `F-003` | 🟠 HIGH   | CLI / MCP                  | `packages/cli/src/mcp-tool-effects.ts:77-108`, `packages/cli/src/mcp.ts:692-720`, `packages/cli/src/service.ts:5328-5350`                                                                                         | Guard Enforcement       | `MCP_TOOL_REVIEW_GUARDS` is declarative only; `mcp.ts` does not invoke `assertNoPendingReview()` centrally, relying on manual calls scattered across `service.ts`.                                                     | Code trace & challenger confirmed |
| `F-004` | 🟠 HIGH   | Renderers / Contracts      | `packages/renderers/src/scorecard.ts:25-35`, `packages/contracts/src/evidence.ts:376-416`                                                                                                                         | Data Integrity          | `evaluateQualityScorecard()` indexes measurements by `metric + "\0" + scenario` in a `Map`, silently overwriting duplicate entries in array order.                                                                     | Code trace & challenger confirmed |
| `F-005` | 🟠 HIGH   | Tooling / CI               | `tools/scripts/fetch-azure-deprecations.mjs:30-46`, `224-225`, `.github/workflows/weekly-maintenance.yml:83-112`                                                                                                  | Silent Failure          | `main().catch(console.error)` does not set `process.exitCode = 1`, allowing scheduled runs to succeed on failure; fallback list contains past 2025 sunset dates.                                                       | Code trace & challenger confirmed |
| `F-006` | 🟠 HIGH   | Docs / Controls            | `README.md:96`, `AGENTS.md:67`, `docs/vnext/PROJECT.md`, `docs/vnext/REGISTER.md`, `docs/vnext/CLIENT-QUALIFICATION.md:134-160`, `docs/vnext/LIVE-QUALIFICATION.md:9-14`, `docs/vnext/PRD.md:394,718`             | Spec / Docs Drift       | Contradictory implementation claims across authoritative project controls and user docs regarding CP-26 (`azd`), CP-27 (`lab` gates), CP-16 (`rubber-duck`), CP-23 (MCP v2), CP-31 (Azure MCP 3), and plugin delivery. | Direct cross-file comparison      |
| `F-007` | 🟡 MEDIUM | Kernel / Workflow          | `packages/kernel/src/workflow-engine.ts:74-111`, `218-229`, `config/workflow.v1.json:640-772`, `900-914`                                                                                                          | Contract Drift          | `WorkflowEngine.parseEdge()` silently drops `event` properties on edges and ignores `edgeSelection` / `multipleEligibleEdges` metadata, routing by node manifest order instead.                                        | Code trace & challenger confirmed |
| `F-008` | 🟡 MEDIUM | Capabilities               | `packages/capabilities/src/process-runner.ts:58-62`, `84-107`                                                                                                                                                     | Boundary Validation     | `ProcessRunner.run()` does not validate that `timeoutMs` and `maxOutputBytes` are positive safe integers (`NaN` disables output cap or causes immediate timeout).                                                      | Code trace & challenger confirmed |
| `F-009` | 🟡 MEDIUM | Capabilities               | `packages/capabilities/src/native-iac-providers.ts:818-820`                                                                                                                                                       | API Contract            | `BicepNativeProvider.validate()` compiles the template and returns `[]`, relying on external callers in `service.ts` to run policy/parity checks.                                                                      | Code trace confirmed              |
| `F-010` | 🟡 MEDIUM | Renderers                  | `packages/renderers/src/renderers.ts:125-135`, `146-153`                                                                                                                                                          | Defensive Coding        | `renderDeploymentGuide()` dereferences `binding.resourceBindings[resource.id]!` without a local guard, throwing an uninformative `TypeError` if called outside `ApexService`.                                          | Code trace & challenger confirmed |
| `F-011` | 🟡 MEDIUM | Renderers                  | `packages/renderers/src/document-registry.ts:118-126`                                                                                                                                                             | Template Parsing        | Requirements template slot parser treats any `{[a-z][a-z-]*}` token as a required slot and rejects templates with literal brace tokens or duplicate slot references.                                                   | Code trace confirmed              |
| `F-012` | 🟡 MEDIUM | Renderers / Contracts      | `packages/renderers/src/scorecard.ts:4-9`, `38`, `58`                                                                                                                                                             | Validation              | `evaluateQualityScorecard()` does not validate non-negative integer `samples` or enforce `tolerance === 0` when `direction === "exact"`.                                                                               | Code trace confirmed              |
| `F-013` | 🟡 MEDIUM | Renderers                  | `packages/renderers/src/semantic-diff.ts:42-57`                                                                                                                                                                   | Diff Accuracy           | `semantic-diff.ts` compares arrays strictly by index rather than semantic key (`id` or `metric + scenario`), reporting reordered items as field mutations.                                                             | Code trace confirmed              |
| `F-014` | 🟡 MEDIUM | Customizations / Skills    | `customizations/.github/skills/apex-next/SKILL.md:1-4`, `tools/registry/skill-validation-baseline.json:5-13`                                                                                                      | Policy Debt             | `apex-next/SKILL.md` omits explicit `user-invocable: true` in YAML frontmatter and relies on a shrink-only baseline suppression with no expiry date.                                                                   | `npm run validate:skills` output  |
| `F-015` | 🟡 MEDIUM | Validators / CI            | `tools/scripts/validate-repository-validator-graph.mjs:118-127`, `194-205`                                                                                                                                        | Validator Blind Spot    | Consumer evidence uses raw `.includes()` substring checks on workflow YAML instead of AST/job parsing, and `package.json` script membership is only checked one-way.                                                   | Code trace & challenger confirmed |
| `F-016` | 🟡 MEDIUM | Validators                 | `tools/scripts/validate-vnext-project-controls.mjs:32-34`, `tools/scripts/validate-vnext.mjs:1250-1253`                                                                                                           | Validator Precision     | Project-control ID extraction uses raw regex across unparsed Markdown (including code fences), and `validate-vnext.mjs` enforces key insertion order on `plugin/mcp.json`.                                             | Code trace confirmed              |
| `F-017` | 🟡 MEDIUM | Docs / Reference           | `docs/reference/client-support.md:67-88`, `docs/how-to/run-workflow.md:8,69,140`, `docs/reference/sources-of-truth.md:66-67`, `docs/reference/configuration.md:7-15`                                              | Documentation Drift     | Reference and how-to guides contain duplicate pre-pivot paragraphs, stale overwrite claims, retired specialist terminology, and omit 2 of 9 `config/*.v1.json` files.                                                  | Direct file inspection            |
| `F-018` | ⚪ LOW    | CLI                        | `packages/cli/src/workspace-root.ts:54-55`                                                                                                                                                                        | Error Handling          | `lstat` probes for `.apex` and `.git` catch and ignore all errors (`() => undefined`) instead of ignoring only `ENOENT`.                                                                                               | Code trace confirmed              |
| `F-019` | ⚪ LOW    | Renderers                  | `packages/renderers/src/diagrams.ts:174-178`, `207-212`                                                                                                                                                           | Boundary Hardening      | Cost diagram width calculations do not guard against `NaN`/`Infinity` if called directly with unvalidated runtime numbers.                                                                                             | Code trace confirmed              |
| `F-020` | ⚪ LOW    | Plugin                     | `plugin/plugin.json:1-17`                                                                                                                                                                                         | Provenance Metadata     | `plugin/plugin.json` carries static version metadata without embedding the source customization digest inside the manifest file itself (tracked externally via `.sha256` sidecar).                                     | Direct file inspection            |
| `F-021` | ⚪ LOW    | Validators / Tooling       | `tools/scripts/validate-workflow-graph.mjs:7`, `validate-optimization-gate.mjs:73-76`, `validate-guidance-delivery.mjs:207`, `validate-repository-validator-graph.mjs:210-213`                                    | CWD Coupling            | Four validator scripts resolve repository paths relative to `process.cwd()` instead of deriving `repoRoot` from `import.meta.url`.                                                                                     | Code trace & challenger confirmed |
| `F-022` | ⚪ LOW    | Authoring Guidance / Hooks | `.github/skills/github-operations/references/branch-strategy.md:6`, `.github/skills/vendor-prompting/references/*`, `.github/instructions/references/governance-discovery-reference.md:3-4`, `lefthook.yml:10-13` | Authoring Hygiene       | Stale `scripts/validate-branch-*.sh` path (missing `tools/`), retired role names (`03-Architect`, `Planner agents`) in authoring examples, and `or-true` pipeline masking in `lefthook.yml`.                           | Direct file inspection            |

---

## Detailed Findings By Track

### Track 1 — Runtime Packages (`packages/*`)

#### `F-001` (🟠 HIGH): Stale Asset-Lock Cleanup TOCTOU Race in `prepare-assets.mjs`

- **Location:** `packages/cli/scripts/prepare-assets.mjs:53-76`
- **Root Cause & Evidence:** When `mkdir(lockPath)` fails with `EEXIST`, `acquireAssetGenerationLock()` reads
  `metadata.json`, checks whether `Date.parse(metadata.expiresAt ?? "") <= Date.now()`, and then removes `lockPath`
  directly:

  ```js
  expired = Date.parse(metadata.expiresAt ?? "") <= Date.now();
  ...
  if (expired) {
    await rm(lockPath, { recursive: true, force: true });
    continue;
  }
  ```

  Similarly, the release function at lines `53-62` reads `metadata.json` to compare `token` and then calls
  `rm(lockPath, { recursive: true, force: true })`.

- **Impact:** If two processes concurrently observe an expired lock directory, Process A can delete it and create a
  fresh lock, after which Process B executes `await rm(lockPath, { recursive: true, force: true })` and deletes
  Process A's active lock. Mutual exclusion is broken during parallel test/build invocations (`prepare:vnext-assets`).
- **Recommended Fix:** Atomically rename (`rename(lockPath,`${lockPath}.stale.${token}`)`) the expired lock directory
  before deleting the quarantined path, so only the contender whose `rename` succeeds removes the directory. Apply the
  same atomic rename-before-delete pattern on lock release after verifying the owner token.

#### `F-003` (🟠 HIGH): `MCP_TOOL_REVIEW_GUARDS` Is Not Enforced Centrally at the MCP Dispatch Boundary

- **Location:** `packages/cli/src/mcp-tool-effects.ts:77-108`, `packages/cli/src/mcp.ts:692-720`,
  `packages/cli/src/service.ts:2157, 2960, 5328-5350, 6434, 6745, 7748, 8114`
- **Root Cause & Evidence:** `MCP_TOOL_REVIEW_GUARDS` maps every `McpStateChangingTool` to
  `"approve" | "delete" | "publish" | null`, and `ReviewGuardedTool` derives the 6 guarded tools (`projectDelete`,
  `recordInput`, `gateDecide`, `reviewDecide`, `promote`, `submitEvidence`). However,
  `packages/cli/src/mcp.ts:692-720` dispatches tool handlers using only `MCP_TOOL_EFFECTS` and never consults
  `MCP_TOOL_REVIEW_GUARDS`. Instead, `await this.assertNoPendingReview(...)` is manually called inside 6 separate
  methods in `packages/cli/src/service.ts`. Furthermore, `assertNoPendingReview()` runs before the operation's journal
  CAS write rather than being checked under a single uniform mutation wrapper.
- **Impact:** Any new tool marked non-null in `MCP_TOOL_REVIEW_GUARDS` (or any refactored service entry point) will
  compile cleanly under TypeScript's `satisfies` check without runtime enforcement unless a developer also remembers
  to add a manual `this.assertNoPendingReview(...)` call inside `service.ts`.
- **Recommended Fix:** Enforce `MCP_TOOL_REVIEW_GUARDS[name]` centrally in the MCP tool wrapper in
  `packages/cli/src/mcp.ts` (while retaining the service-level calls for direct CLI invocations) and add a
  table-driven test iterating over `Object.entries(MCP_TOOL_REVIEW_GUARDS)` to verify that every non-null tool throws
  `APEX_REVIEW_PENDING` when a review capture is pending.

#### `F-008` (🟡 MEDIUM): `ProcessRunner.run()` Does Not Validate `timeoutMs` or `maxOutputBytes`

- **Location:** `packages/capabilities/src/process-runner.ts:58-62`, `84-107`
- **Root Cause & Evidence:** `ProcessRunner.run(request)` validates `if (!Array.isArray(request.args))` at line 59,
  but passes `request.timeoutMs` directly to `setTimeout(..., request.timeoutMs)` (line 75) and computes
  `const remaining = request.maxOutputBytes - stdout.length - stderr.length` (line 88).
- **Impact:** Passing `NaN`, `0`, negative numbers, or `Infinity` for `maxOutputBytes` or `timeoutMs` bypasses
  output-size capping (`remaining < 0` evaluates to `false` when `remaining` is `NaN`) or triggers immediate/unbounded
  timer behavior.
- **Recommended Fix:** Validate `Number.isSafeInteger(request.timeoutMs) && request.timeoutMs > 0` and
  `Number.isSafeInteger(request.maxOutputBytes) && request.maxOutputBytes > 0` at the top of `ProcessRunner.run()`.

#### `F-009` (🟡 MEDIUM): `BicepNativeProvider.validate()` Performs Compilation Only

- **Location:** `packages/capabilities/src/native-iac-providers.ts:818-820`
- **Root Cause & Evidence:**

  ```ts
  async validate(): Promise<readonly string[]> {
    await this.#compiledTemplate();
    return [];
  }
  ```

- **Impact:** While `ApexService` orchestrates policy-map evaluation and resource parity separately during
  `validateTask` and `createPreview`, the provider's public `validate()` method returns an empty blocker array (`[]`)
  after compilation alone. Any caller invoking `provider.validate()` directly can mistake compilation success for
  complete native validation.
- **Recommended Fix:** Document or rename the method to reflect template-compilation scope, or return a structured
  result indicating which validation layers ran.

#### `F-018` (⚪ LOW): `workspace-root.ts` Suppresses Non-`ENOENT` Filesystem Errors

- **Location:** `packages/cli/src/workspace-root.ts:54-55`
- **Root Cause & Evidence:** `lstat(join(directory, ".apex")).catch(() => undefined)` and
  `lstat(join(directory, ".git")).catch(() => undefined)` swallow `EACCES`/`EIO` errors instead of rethrowing
  non-`ENOENT` errors as `findGitDirectory()` does.
- **Impact:** Permission or I/O failures on an existing `.apex` or `.git` directory cause `resolveWorkspaceRoot` to
  silently walk up to a parent directory.
- **Recommended Fix:** Catch and ignore only `(error as NodeJS.ErrnoException).code === "ENOENT"`, rethrowing other
  filesystem errors.

---

### Track 2 — APEX Workflow & Shipped Configs (`config/*.v1.json`)

#### `F-002` (🟠 HIGH): Rejected Gates Do Not Transition to the Configured `approval-rejected` Blocked State

- **Location:** `config/workflow.v1.json:865-871`, `915-926`, `packages/kernel/src/gates.ts:24-36`,
  `packages/cli/src/service.ts:6841-6859`, `9753-9761`, `9952-9967`
- **Root Cause & Evidence:** `config/workflow.v1.json:918-926` declares `"approval-rejected"` as a distinct blocked
  state. However:
  1. `decideGate()` in `packages/kernel/src/gates.ts:24-36` sets `gate.state = "rejected"`.
  2. `ApexService.route()` (`packages/cli/src/service.ts:9753-9761`) checks only whether required gates are satisfied
     and, when a gate is `"rejected"`, returns the generic blocker `"Gate N approval is required"`—even though
     `openGate()` / `decideGate()` cannot re-approve a `"rejected"` gate without invalidation/reopening.
  3. When `ApexService` invokes `WorkflowEngine.route()` (`packages/cli/src/service.ts:9952-9967`), it passes
     `gateStates` without setting `state: "approval-rejected"`, and `WorkflowEngine.route()`
     (`packages/kernel/src/workflow-engine.ts:74-88`) never infers `"approval-rejected"` from
     `gateStates[n] === "rejected"`.
- **Impact:** The `"approval-rejected"` blocked state in `config/workflow.v1.json` is unreachable in normal gate
  decision flows, and users/agents receive a misleading `"Gate N approval is required"` message after explicitly
  rejecting a gate instead of a rejection blocker directing them to revise/invalidate upstream artifacts.
- **Recommended Fix:** In `WorkflowEngine.route()` and `ApexService.route()`, detect when a required gate is in state
  `"rejected"`, surface `blockedState: "approval-rejected"`, and emit a specific diagnostic indicating which upstream
  artifact must be revised to reopen the rejected gate.

#### `F-007` (🟡 MEDIUM): `WorkflowEngine` Ignores Edge `event` and `edgeSelection` Rules

- **Location:** `packages/kernel/src/workflow-engine.ts:74-111`, `218-229`, `config/workflow.v1.json:640-772`,
  `900-914`
- **Root Cause & Evidence:** `config/workflow.v1.json` defines `"event": "approved"` / `"event": "completed"` on every
  edge and declares `"edgeSelection": "manifest-order"` and `"multipleEligibleEdges": "error-unless-fanout"`. In
  `packages/kernel/src/workflow-engine.ts:218-229`, `parseEdge()` strips `event` and keeps only
  `{ from, to, condition, fanout }`. Furthermore, `WorkflowEngine.route()` (`:74-111`) selects the next node by
  scanning `manifest.nodes` in array order for the first node whose conditions and dependencies are met, using `edges`
  only to check if an unsatisfied node has a satisfied predecessor (`hasActiveIncomingEdge`). Because routing is
  node-order-driven rather than edge-driven, the unconditional edges `gate-2 -> plan` (`workflow.v1.json:640-644`) and
  `gate-2 -> governance-refresh -> policy-refresh -> plan` (`workflow.v1.json:758-772`) do not dead-end at runtime
  when `governanceRefreshRequired` or `policyRefreshRequired` is `false` (since `WorkflowEngine` and
  `ApexService.route()` skip ineligible conditional nodes), **but** the edge graph in `workflow.v1.json` does not
  accurately express the bypass edges (`gate-2 -> plan` when `governanceRefreshRequired == false`, and
  `governance-refresh -> plan` when `policyRefreshRequired == false`), and
  `multipleEligibleEdges: "error-unless-fanout"` is never enforced.
- **Impact:** Maintainers and external graph tools reading `config/workflow.v1.json` see an incomplete edge transition
  graph around `governance-refresh` / `policy-refresh` and unenforced `edgeSelection` / `event` semantics.
- **Recommended Fix:** Add explicit conditional edges for the `governanceRefreshRequired === false` and
  `policyRefreshRequired === false` bypass paths in `config/workflow.v1.json`, and either validate/enforce `event` and
  `multipleEligibleEdges` in `WorkflowEngine` or document that `edges` are dependency/predecessor declarations rather
  than an event-driven FSM.

---

### Track 3 — APEX Artifacts, Contracts & Renderers (`packages/contracts`, `packages/renderers`)

#### `F-004` (🟠 HIGH): `evaluateQualityScorecard()` Silently Overwrites Duplicate `(metric, scenario)` Measurements

- **Location:** `packages/renderers/src/scorecard.ts:25-35`, `packages/contracts/src/evidence.ts:376-416`
- **Root Cause & Evidence:** In `packages/renderers/src/scorecard.ts:28`:

  ```ts
  const indexed = new Map(measurements.map((item) => [`${item.metric}\u0000${item.scenario}`, item]));
  ```

  Neither `QualityMeasurementsV1Schema` (`packages/contracts/src/evidence.ts:400-416`) nor
  `evaluateQualityScorecard()` checks for duplicate `(metric, scenario)` entries.

- **Impact:** If a measurement bundle contains two entries for the same `(metric, scenario)` (for example, a failing
  measurement followed by a passing measurement), the later entry silently overwrites the earlier entry, making
  release scorecard evaluation order-dependent.
- **Recommended Fix:** Throw a deterministic error in `evaluateQualityScorecard()` (and add a business validator
  check) whenever duplicate `${item.metric}\u0000${item.scenario}` keys appear in `measurements` or `scorecard.rules`.

#### `F-010` (🟡 MEDIUM): Unguarded `binding.resourceBindings[resource.id]!` Dereference in `renderDeploymentGuide()`

- **Location:** `packages/renderers/src/renderers.ts:125-135`, `146-153`
- **Root Cause & Evidence:**

  ```ts
  const bound = binding.resourceBindings[resource.id]!;
  ```

  Followed immediately by `bound.implementation`, `bound.version`, and `bound.scopeLogicalId`. While `ApexService`
  validates binding coverage at `packages/cli/src/service.ts:8198-8235` before calling the renderer,
  `ImplementationIntentV1Schema` and `IacBindingV1Schema` are separate schemas that cannot enforce cross-object key
  equality at the JSON Schema layer.

- **Impact:** Direct callers of `@apexops/renderers` passing schema-valid but mismatched `intent` and `binding`
  objects receive an uncaught `TypeError: Cannot read properties of undefined (reading 'implementation')` instead of
  an actionable error naming the unbound `resource.id`.
- **Recommended Fix:** Check `if (bound === undefined) throw new Error(\`Missing IaC binding for logical resource
  '\${resource.id}'\`)`inside`renderDeploymentGuide()`.

#### `F-011` (🟡 MEDIUM): Brittle Brace-Token Matching in `document-registry.ts`

- **Location:** `packages/renderers/src/document-registry.ts:118-126`
- **Root Cause & Evidence:**

  ```ts
  const slots = [...template.matchAll(/\{([a-z][a-z-]*)\}/gu)].map((match) => match[1]!);
  if (
    slots.length !== expectedSlots.length ||
    new Set(slots).size !== expectedSlots.length ||
    expectedSlots.some((slot) => !slots.includes(slot))
  ) {
    throw new Error("Requirements document template has invalid slots");
  }
  ```

- **Impact:** Any lowercase `{token}` in template prose or code examples is parsed as a template slot and causes
  template validation to fail.
- **Recommended Fix:** Restrict slot parsing or provide an escape mechanism, and include the unexpected/missing slot
  names in the error message.

#### `F-012` (🟡 MEDIUM): Scorecard Sample Count and `exact` Tolerance Validation Gaps

- **Location:** `packages/renderers/src/scorecard.ts:4-9`, `38`, `58`
- **Root Cause & Evidence:** `evaluateQualityScorecard()` checks `measurement.samples < rule.minimumSamples` without
  verifying `Number.isSafeInteger(measurement.samples) && measurement.samples >= 0`, and evaluates
  `direction === "exact"` via `Math.abs(measurement.value - rule.target) <= rule.tolerance` without asserting
  `rule.tolerance === 0`.
- **Impact:** `NaN` sample counts bypass `measurement.samples < rule.minimumSamples` (`NaN < n` is `false`), and a
  non-zero `tolerance` on an `exact` rule silently turns exact matching into range matching.
- **Recommended Fix:** Validate `Number.isSafeInteger(measurement.samples) && measurement.samples >= 0` and enforce
  `rule.tolerance === 0` when `rule.direction === "exact"`.

#### `F-013` (🟡 MEDIUM): Positional Array Diffing in `semantic-diff.ts`

- **Location:** `packages/renderers/src/semantic-diff.ts:42-57`
- **Root Cause & Evidence:** `semantic-diff.ts` compares arrays solely by numeric index (`0..sharedLength - 1`).
- **Impact:** Reordering elements in keyed contract arrays (such as `requirements[]` or `resources[]`) produces noisy
  field-by-field diffs across every subsequent index instead of identifying the added/removed/reordered entity by
  `id`.
- **Recommended Fix:** Support keyed array matching for objects carrying a string `id` (or `metric` + `scenario`)
  while falling back to positional comparison for primitive/unkeyed arrays.

#### `F-019` (⚪ LOW): Cost Diagram Numeric Guarding in `diagrams.ts`

- **Location:** `packages/renderers/src/diagrams.ts:174-178`, `207-212`
- **Root Cause & Evidence:** Cost diagram bar calculations divide by `max` and call `.toFixed(2)` without asserting
  finite non-negative numbers at the function boundary.
- **Impact:** Calling diagram renderers with unvalidated `NaN`/`Infinity` values emits invalid SVG attributes.
- **Recommended Fix:** Guard numeric inputs with `Number.isFinite(value) && value >= 0` before computing SVG
  coordinates.

---

### Track 4 — Managed Customizations & Plugin Projection (`customizations/`, `plugin/`)

#### `F-014` (🟡 MEDIUM): `apex-next/SKILL.md` Missing Explicit `user-invocable: true` Frontmatter

- **Location:** `customizations/.github/skills/apex-next/SKILL.md:1-4`,
  `tools/registry/skill-validation-baseline.json:5-13`
- **Root Cause & Evidence:** `customizations/.github/skills/apex-next/SKILL.md:1-4` contains:

  ```yaml
  ---
  name: apex-next
  description:
    "Routes the next APEX kernel step inside the same APEX agent by mapping owner roles to stage skills, hidden
    workers or captured rubber-duck reviews."
  ---
  ```

  All other 31 shipped skills explicitly declare `user-invocable`. `npm run validate:skills` passes only because
  `tools/registry/skill-validation-baseline.json:5-13` suppresses `skill-user-invocable-explicit` for `apex-next`
  (recorded `2026-10-08`, tracking `#401`) with no expiration date.

- **Impact:** Leaving `user-invocable` implicit on a shipped routing skill requires a permanent baseline suppression
  entry in `tools/registry/skill-validation-baseline.json`.
- **Recommended Fix:** Add explicit `user-invocable: true` to `customizations/.github/skills/apex-next/SKILL.md` and
  remove the entry from `tools/registry/skill-validation-baseline.json`.

#### `F-020` (⚪ LOW): `plugin/plugin.json` Does Not Embed Source Customization Digest Metadata

- **Location:** `plugin/plugin.json:1-17`
- **Root Cause & Evidence:** `plugin/plugin.json` contains static `name`, `description`, `version` (`0.11.0-next.5`),
  `author`, `license`, `agents`, `skills`, `hooks`, and `mcpServers` fields, while the tree hash is written to an
  external `dist/apex-plugin.sha256` sidecar by `tools/scripts/build-plugin.mjs`.
- **Impact:** An installed plugin directory (`~/.copilot/plugins/apex`) does not self-identify its exact source commit
  or tree hash inside `plugin.json` without running `build-plugin.mjs`'s `hashTree` helper externally.
- **Recommended Fix:** If permitted by the Agent Plugins 1.0 schema, include build provenance metadata (or a generated
  provenance file inside the plugin root) during `build-plugin.mjs`.

---

### Track 5 — Repo Governance, Prompts, Workflows, Hooks & Tooling (`.github/`, `tools/`)

#### `F-005` (🟠 HIGH): `fetch-azure-deprecations.mjs` Exits `0` on Unhandled Errors and Contains Past Fallback Dates

- **Location:** `tools/scripts/fetch-azure-deprecations.mjs:30-46`, `224-225`,
  `.github/workflows/weekly-maintenance.yml:83-112`
- **Root Cause & Evidence:** Line 225 ends with:

  ```js
  main().catch(console.error);
  ```

  When `main()` rejects, the error is logged to stderr, the promise rejection is considered handled, and Node.js exits
  with status code `0`. In addition, `KNOWN_DEPRECATIONS` (`:30-46`, used when the RSS fetch fails) includes entries
  with `sunsetDate: "2025-09-30"` (more than a year in the past relative to October 2026) without a staleness
  indicator.

- **Impact:** In `.github/workflows/weekly-maintenance.yml`, a top-level failure in `fetch-azure-deprecations.mjs`
  still exits `0` and allows the workflow to proceed to PR creation or report green status.
- **Recommended Fix:** Replace line 225 with:

  ```js
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
  ```

  and mark or fail on fallback entries whose `sunsetDate` or verification timestamp is stale.

#### `F-021` (⚪ LOW): Validator Scripts Rely on `process.cwd()` Instead of Repository Root

- **Location:**
  - `tools/scripts/validate-workflow-graph.mjs:7`
  - `tools/scripts/validate-optimization-gate.mjs:10-11`, `72-76`
  - `tools/scripts/validate-guidance-delivery.mjs:202-210`
  - `tools/scripts/validate-repository-validator-graph.mjs:209-213`
- **Root Cause & Evidence:** Each script reads relative paths such as `"config/workflow.v1.json"` or `"package.json"`
  directly from `process.cwd()`.
- **Impact:** Invoking these scripts from a subdirectory or editor task with a non-root working directory fails with
  `ENOENT` or inspects the wrong directory.
- **Recommended Fix:** Resolve repository-relative paths against
  `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")`.

#### `F-022` (⚪ LOW): Stale Script Path and Retired Role Names in Authoring Guidance & `lefthook.yml`

- **Location:**
  - `.github/skills/github-operations/references/branch-strategy.md:6`
  - `.github/skills/vendor-prompting/references/cross-model-rules.md:33-45`
  - `.github/skills/vendor-prompting/references/claude-best-practices.md:43-45`
  - `.github/skills/docs-writer/references/doc-standards.md:151-158`
  - `.github/instructions/references/governance-discovery-reference.md:3-4`
  - `lefthook.yml:10-13`
- **Root Cause & Evidence:**
  1. `branch-strategy.md:6` states
     `Validated by scripts/validate-branch-naming.sh and scripts/validate-branch-scope.sh` (missing the `tools/`
     prefix; lines 60–61 use `tools/scripts/...`).
  2. Authoring reference examples still show retired `handoffs: - agent: 03-Architect`,
     `Loaded on-demand by Planner agents`, `Architect, IaC Planner, Context Optimizer`, and codename tables
     (`Oracle | Architect`, `Daedalus | Bicep Specialist`).
  3. `lefthook.yml:10-13` pipes `git diff --cached ... | grep '\.md$' || true`, which masks `git diff` failures
     alongside empty grep matches.
- **Impact:** Contributors or authoring skills reading these examples can emit retired multi-agent handoff patterns or
  invoke a nonexistent `scripts/` path.
- **Recommended Fix:** Update `branch-strategy.md:6` to `tools/scripts/...`, replace retired agent examples in
  `.github/skills/**` and `.github/instructions/references/**` with current vNext agent/skill examples, and separate
  `git diff` execution from `grep` matching in `lefthook.yml`.

---

### Track 6 — Spec, Architecture & Documentation Drift (`docs/`, `README.md`, `AGENTS.md`)

#### `F-006` (🟠 HIGH): Cross-Document Contradictions in Authoritative Project Controls and Root Documentation

- **Location:**
  1. `README.md:96` vs `docs/vnext/PROJECT.md:15`, `docs/vnext/DECISIONS.md:424-427`, `docs/vnext/PRD.md:346`
  2. `AGENTS.md:67` vs `docs/vnext/DECISIONS.md:187-197` (`DECISION-029`)
  3. `docs/vnext/CLIENT-QUALIFICATION.md:155-156` vs `docs/vnext/CLIENT-QUALIFICATION.md:134-136` and
     `docs/vnext/PROJECT.md:14-16`
  4. `docs/vnext/LIVE-QUALIFICATION.md:9-14` & `docs/reference/iac-tracks.md:16-18` vs `docs/vnext/PROJECT.md:14-16` &
     `docs/explanation/workflow-and-gates.md:32`
  5. `docs/vnext/REGISTER.md:111` (`RISK-009`), `:133` (`RISK-012`), `:150` (`RISK-013`), `:176-181` (`RISK-015`),
     `:211-216` (`ASSUMPTION-001`)
  6. `docs/vnext/PROJECT.md:23-25`, `44-88`, `255-257`, `297`, `308`, `310-316`, `328-333`, `359`, `378`, `444`
  7. `docs/vnext/PRD.md:394-396`, `718` vs `docs/vnext/DECISIONS.md:455-496` (`DECISION-038`)
- **Root Cause & Evidence:** Chronological updates for `DECISION-029` through `DECISION-038` (CP-06..CP-16, CP-23,
  CP-26, CP-27, CP-31) were prepended or added to individual sections without reconciling earlier paragraphs in the
  same or sibling control documents:
  - **Bicep `azd` executor status (`CP-26`)**: `PROJECT.md:15`, `ROADMAP.md:40`, `DECISIONS.md:424`, and `PRD.md:346`
    confirm that `azd` provisioning and destroy are implemented and the old `az deployment`/`az stack` path is
    removed. Yet `README.md:96` still states `"Bicep moves to an azd executor in a coming release"`,
    `CLIENT-QUALIFICATION.md:155` states
    `"CP-26 to CP-30 have not delivered the azd/Bicep, purpose-bound, CI-owned production or setup paths"`, and
    `LIVE-QUALIFICATION.md:13-14` refers to `"the future azd/Bicep lab executor"`.
  - **Purpose-bound lab gate flow (`CP-27`)**: `CLIENT-QUALIFICATION.md:134` states
    `"The lab approval flow (CP-27) is implemented in the kernel and guidance"`, but 21 lines below (`:155`) states
    `"CP-26 to CP-30 have not delivered the azd/Bicep, purpose-bound..."`. Similarly, `LIVE-QUALIFICATION.md:9-10` and
    `docs/reference/iac-tracks.md:16-18` still say the non-production purpose/approval behaviors are
    `"planned, not implemented"`.
  - **Plugin & Projection status (`DECISION-029`, `DECISION-031`, `DECISION-032`, `DECISION-033`, `DECISION-034`)**:
    - `AGENTS.md:67` still states `customizations/ owns managed VS Code and Copilot CLI projections` even though VS
      Code Local is retired and archived.
    - `REGISTER.md:111` (`RISK-009`) states `Open; plugin delivery selected, not yet implemented`; `REGISTER.md:133`
      (`RISK-012`) refers to `all four review passes ... in both projections`; `REGISTER.md:150` (`RISK-013`) states
      `Protocol migration is separately pending`; `REGISTER.md:176` (`RISK-015`) states
      `Rubber-duck ... stay out until the CLI scopes helper tools`; and `REGISTER.md:211-214` (`ASSUMPTION-001`)
      states `until it ships, apex init installs the CLI projection` and
      `CLI CodeGen, Reviewer and Validator ship since adapter 1.6.0`.
    - `PROJECT.md` contains superseded paragraphs in present tense claiming
      `the current package still uses WSL2 and the CLI projection` (`:25`),
      `Combined local installation now selects both client projections` (`:255`),
      `Shipped CLI workers remain disabled` (`:297, 308`),
      `July 2026 protocol migration ... remain separate design work` (`:314`),
      `Evaluate Agent Plugins ... npm remains the current implementation` (`:331`), and
      `All four reviewer passes remain required` (`:444`).
  - **Azure MCP Server 3 vs ARM Pricing (`DECISION-038` / `CP-31`)**: `PRD.md:394-396` (`REQ-CAPABILITY-001`) and
    `PRD.md:718` (`Cutover Acceptance`) still refer only to direct Microsoft ARM MCP and
    `"ARM pricing and Python diagram replacements"`, omitting the `DECISION-038` migration of retail pricing and
    general Azure reads to `apex-azure` (`@azure/mcp@3.0.0`).
- **Impact:** Directly violates `RISK-004` (_Documentation Can Overstate Support_) and `RISK-010` (_Revised Plans Can
  Outrun Executable Controls_). Contributors, release reviewers, or agents reading `README.md`, `PROJECT.md`,
  `REGISTER.md`, `CLIENT-QUALIFICATION.md`, or `PRD.md` encounter contradictory statements about which features and
  security boundaries are currently implemented.
- **Recommended Fix:** Reconcile `README.md`, `AGENTS.md`, `PROJECT.md`, `REGISTER.md`, `CLIENT-QUALIFICATION.md`,
  `LIVE-QUALIFICATION.md`, and `PRD.md` so historical paragraphs are either removed (per the repository's
  no-historical-cruft rule) or explicitly scoped to their current implementation state (`CP-26` provisioning/destroy
  implemented, `CP-27` lab gates implemented, `CP-28/29/30` open, `CP-31` implemented locally, 3 rubber-duck review
  passes, 1 plugin/thin-CLI projection, MCP SDK v2 `2026-07-28` implemented).

#### `F-017` (🟡 MEDIUM): Stale and Duplicated Content in `docs/reference/*` and `docs/how-to/*`

- **Location:**
  - `docs/reference/client-support.md:67-88`
  - `docs/how-to/run-workflow.md:8`, `69`, `140`
  - `docs/reference/sources-of-truth.md:66-67`
  - `docs/reference/configuration.md:7-15`
  - `docs/vnext/README.md:34`
- **Root Cause & Evidence:**
  1. `docs/reference/client-support.md:67-88` retains three pre-pivot paragraphs beneath the updated Client Pivot
     section that repeat and contradict lines 34–65: line 68 references `"the canonical parent-to-Reviewer path"`,
     lines 78–83 claim standalone CLI collects multi-select via `"the question tool's free-text field"` and
     `"VS Code retains native multi-select"` (contradicting lines 43–48's checkbox/numbered-order contract).
  2. `docs/how-to/run-workflow.md` states `"Use Windows via WSL2 without a devcontainer"` (`:8`),
     `"Specialists delegate bounded code generation, review, and validation tasks"` (`:69`), and
     `"in both supported client projections"` (`:140`).
  3. `docs/reference/sources-of-truth.md:66-67` states
     `"This conflict-aware adaptation is planned work; current rendered review packages can still overwrite local edits"`,
     contradicting `PROJECT.md:213, 274` where generated review documents, diagrams, and guides reject manual
     conflicts.
  4. `docs/reference/configuration.md:7-15` lists 7 shipped `config/*.v1.json` files, omitting
     `config/governance-reference.v1.json` and `config/recipe-packs.v1.json`.
  5. `docs/vnext/README.md:34` still describes `"both-client WSL2 workflows"`.
- **Impact:** User-facing reference and how-to documentation misstates supported hosts, multi-select behavior,
  manual-edit conflict protection, and configuration inventory.
- **Recommended Fix:** Delete the duplicated pre-pivot paragraphs in `docs/reference/client-support.md:67-88`, update
  `run-workflow.md`, `sources-of-truth.md`, and `docs/vnext/README.md` to match current behavior, and add
  `config/governance-reference.v1.json` and `config/recipe-packs.v1.json` to `docs/reference/configuration.md`.

---

### Track 7 — Test Coverage & Validator Blind Spots (`tools/scripts/validate-*.mjs`, `tools/tests/*`)

#### `F-015` (🟡 MEDIUM): `validate-repository-validator-graph.mjs` Substring Consumer and One-Way Checks

- **Location:** `tools/scripts/validate-repository-validator-graph.mjs:118-127`, `194-205`
- **Root Cause & Evidence:** `collectConsumerEvidence()` (`:194-201`) checks whether a workflow file consumes a script
  using raw string `.includes()`:

  ```js
  const hasName = content.includes(`name: ${consumer.name}`) || content.includes(`${consumer.name}:`);
  const hasScript = content.includes(`npm run ${consumer.script}`);
  ```

  Additionally, lines `118-127` verify that every command in `validator-graph.v1.json` exists in `package.json`, but
  never verify the reverse (that `validate:*` / `lint:*` scripts in `package.json` are registered in
  `validator-graph.v1.json`).

- **Impact:** A commented-out step or an `npm run` mention in an unrelated job satisfies `collectConsumerEvidence()`,
  and newly added `validate:*` scripts in `package.json` can be omitted from the validator graph and CI without
  failing `validate:repository-validator-graph`.
- **Recommended Fix:** Parse workflow YAML with `js-yaml` to verify that the target job exists and contains an active
  `run` step invoking `npm run ${consumer.script}`, and add a reverse check asserting that all `validate:*` and
  `lint:*` scripts in `package.json` (except an explicit allowlist of internal helpers) belong to
  `validator-graph.v1.json`.

#### `F-016` (🟡 MEDIUM): Unscoped Regex ID Extraction and Key-Order Sensitivity in Validators

- **Location:** `tools/scripts/validate-vnext-project-controls.mjs:32-34`,
  `tools/scripts/validate-vnext.mjs:1250-1253`
- **Root Cause & Evidence:**
  1. `validate-vnext-project-controls.mjs:32-34` extracts `REQ-*`, `DECISION-*`, and `RISK-*` IDs using
     `content.matchAll(pattern)` across raw Markdown text without stripping fenced code blocks or verifying heading
     levels.
  2. `validate-vnext.mjs:1250-1253` checks
     `JSON.stringify(Object.keys(servers)) !== JSON.stringify(["apex", "apex-azure", ARM_MCP_SERVER])`, making
     validation sensitive to JSON key order.
- **Impact:** Mentioning an ID pattern inside a fenced example can be counted as a control declaration or duplicate
  ID, and formatting changes that reorder JSON keys in `plugin/mcp.json` fail validation.
- **Recommended Fix:** Strip fenced code blocks and require heading anchors (`^##+`) when extracting control IDs in
  `validate-vnext-project-controls.mjs`, and compare `Object.keys(servers)` as a set in `validate-vnext.mjs`.

---

## Cross-Layer Drift Matrix

| Source Authority                                                                      | Downstream Consumer / Target                                                                                                 | Observed Drift                                                                                                                                                                 | Finding ID       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `config/workflow.v1.json` (`blockedStates: ["approval-rejected"]`)                    | `packages/kernel/src/gates.ts` & `packages/cli/src/service.ts`                                                               | Gate rejection sets `gate.state = "rejected"`, but `ApexService` never sets `WorkflowState.state = "approval-rejected"` and reports `"Gate N approval is required"`.           | `F-002`          |
| `config/workflow.v1.json` (`edges[].event`, `edgeSelection`, `multipleEligibleEdges`) | `packages/kernel/src/workflow-engine.ts` (`parseEdge`, `route`)                                                              | `WorkflowEngine` drops `event` properties during parsing and routes by node array order rather than enforcing edge-selection rules.                                            | `F-007`          |
| `packages/cli/src/mcp-tool-effects.ts` (`MCP_TOOL_REVIEW_GUARDS`)                     | `packages/cli/src/mcp.ts` & `packages/cli/src/service.ts`                                                                    | Review-pending guard classification is centralized in `mcp-tool-effects.ts`, but runtime `assertNoPendingReview()` calls are manually distributed in `service.ts`.             | `F-003`          |
| `config/quality-scorecard.v1.json` & `packages/contracts/src/evidence.ts`             | `packages/renderers/src/scorecard.ts`                                                                                        | `evaluateQualityScorecard()` overwrites duplicate `(metric, scenario)` entries in `Map` construction without schema or business rejection.                                     | `F-004`, `F-012` |
| `packages/contracts/src/artifacts.ts` (`ImplementationIntentV1`, `IacBindingV1`)      | `packages/renderers/src/renderers.ts` (`renderDeploymentGuide`)                                                              | `renderDeploymentGuide()` assumes `binding.resourceBindings[resource.id]` is always defined without a local check.                                                             | `F-010`          |
| `tools/scripts/validate-skills.mjs` (`skill-user-invocable-explicit`)                 | `customizations/.github/skills/apex-next/SKILL.md`                                                                           | `apex-next` omits explicit `user-invocable: true` and relies on `tools/registry/skill-validation-baseline.json`.                                                               | `F-014`          |
| `DECISION-029..038` & `packages/*` implementation                                     | `README.md`, `AGENTS.md`, `docs/vnext/{PROJECT,REGISTER,CLIENT-QUALIFICATION,LIVE-QUALIFICATION,PRD}.md`, `docs/reference/*` | Stale claims regarding `azd` Bicep executor, `CP-27` lab readiness checkpoints, `rubber-duck` reviews, `MCP 2026-07-28`, `apex-azure` pricing, and retired projections/agents. | `F-006`, `F-017` |

---

## Prioritized Remediation Plan And Closure Proof

All four remediation slices have been executed and verified under
[CP-32](https://github.com/jonathan-vella/apex-vnext/issues/495):

1. **Slice 1 — Runtime, Kernel, Workflow & Capability Hardening (`c49fb45d` — `F-001`, `F-002`, `F-003`, `F-007`,
   `F-008`, `F-009`, `F-018`)**:
   - Implemented a guarded quarantine/fencing lock protocol in `packages/cli/scripts/prepare-assets.mjs` and verified
     stale-reclaim and late-release interleaving in `tools/tests/vnext/prepare-assets.test.mjs` (`F-001`).
   - Mapped rejected gates (`gate.state === "rejected"`) to `currentNode: "approval-rejected"` in
     `packages/kernel/src/workflow-engine.ts` and `packages/cli/src/service.ts` with actionable upstream-revision
     blocker diagnostics (`F-002`).
   - Enforced `MCP_TOOL_REVIEW_GUARDS` centrally at the MCP adapter boundary in `packages/cli/src/mcp.ts` before
     `repeatSafe` (`F-003`).
   - Replaced unconditional refresh edges in `config/workflow.v1.json` with mutually exclusive conditional edges and
     enforced edge `event` and non-ambiguous outgoing conditions in `packages/kernel/src/workflow-engine.ts`
     (`F-007`).
   - Validated positive safe integers for `timeoutMs` and `maxOutputBytes` in
     `packages/capabilities/src/process-runner.ts` (`F-008`), clarified `BicepNativeProvider.validate()` compilation
     scope (`F-009`), and preserved non-`ENOENT` errors in `packages/cli/src/workspace-root.ts` (`F-018`).
2. **Slice 2 — Renderers, Scorecard, Semantic Diff & Plugin Provenance (`9a2bd31c` — `F-004`, `F-010`, `F-011`,
   `F-012`, `F-013`, `F-019`, `F-020`)**:
   - Switched `packages/renderers/src/scorecard.ts` to collision-safe `JSON.stringify([metric, scenario])` keys,
     rejected duplicate `(metric, scenario)` rules and measurements, validated non-negative integer `samples` and
     finite `value`, and enforced `tolerance === 0` on `exact` rules (`F-004`, `F-012`).
   - Guarded `binding.resourceBindings[resource.id]` in `packages/renderers/src/renderers.ts` (`F-010`), added escaped
     brace support and detailed slot diagnostics in `packages/renderers/src/document-registry.ts` (`F-011`),
     implemented collision-safe keyed array diffing in `packages/renderers/src/semantic-diff.ts` (`F-013`), guarded
     finite non-negative cost diagram values in `packages/renderers/src/diagrams.ts` (`F-019`), and verified
     `plugin.json` version sync and `customizationManifestSha256` provenance in `tools/scripts/build-plugin.mjs`
     (`F-020`).
3. **Slice 3 — Customizations, Authoring Guidance, Tooling & Validators (`304372cb` — `F-005`, `F-014`, `F-015`,
   `F-016`, `F-021`, `F-022`)**:
   - Added explicit `user-invocable: true` to `customizations/.github/skills/apex-next/SKILL.md` and cleared
     `tools/registry/skill-validation-baseline.json` to zero entries (`F-014`, #401).
   - Set `process.exitCode = 1` on error and added fallback staleness metadata in
     `tools/scripts/fetch-azure-deprecations.mjs` (`F-005`).
   - Parsed workflow YAML structurally in `tools/scripts/validate-repository-validator-graph.mjs`, added reverse
     `package.json` script coverage checks (`F-015`), stripped fenced code blocks in
     `tools/scripts/validate-vnext-project-controls.mjs`, made `plugin/mcp.json` server key checks order-independent
     in `tools/scripts/validate-vnext.mjs` (`F-016`), resolved default repository paths via `import.meta.url` across
     validators (`F-021`), and updated authoring guidance references and `lefthook.yml` (`F-022`).
4. **Slice 4 — Project Controls & Documentation Reconciliation (`CP-32` — `F-006`, `F-017`)**:
   - Reconciled `README.md`, `AGENTS.md`, `docs/vnext/PROJECT.md`, `docs/vnext/REGISTER.md`,
     `docs/vnext/CLIENT-QUALIFICATION.md`, `docs/vnext/LIVE-QUALIFICATION.md`, `docs/vnext/PRD.md`,
     `docs/vnext/ROADMAP.md`, `docs/vnext/README.md`, `docs/reference/client-support.md`,
     `docs/reference/iac-tracks.md`, `docs/how-to/run-workflow.md`, `docs/reference/sources-of-truth.md`,
     `docs/reference/configuration.md`, and `docs/vnext/documentation-inventory.v1.json`.

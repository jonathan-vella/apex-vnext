# APEX vNext Roadmap

The [PRD](PRD.md) owns scope and acceptance; [PROJECT.md](PROJECT.md) owns the current checkpoint. This is delivery order,
not another runtime workflow or set of human gates. Each slice includes focused tests and relevant documentation.
Preserve working safety mechanisms; do not rebuild the runtime or create a general platform framework.

## Delivery Order

| Phase | Outcome                                      | Primary acceptance                                                       |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------ |
| 1     | Correct and compact task inputs and guidance | First optimization batch passes; controls stay aligned and enforced      |
| 2     | Complete governance baseline import          | Subscription policy reaches review, Gate 2, planning and code validation |
| 3     | Support both profiles and COE adaptation     | Independent import and conversational changes reuse accepted decisions   |
| 4     | Complete design and operational output       | Useful, consistent documents and handoff match the quality reference     |
| 5     | Complete the three supported clients         | VS Code and the app on Windows and the CLI on Linux/WSL2 finish the flow |
| 6     | Deliver APEX as an Agent Plugin              | Plugin install/update/rollback with the bundled runtime in every client  |
| 7     | Qualify and release the final candidate      | Current evidence and explicit release authority                          |

## Current Completion Order

As of 2026-10-05, follow the [client pivot](#client-pivot) under
[DECISION-031](DECISIONS.md#decision-031-replace-the-apex-reviewer-with-captured-rubber-duck-reviews),
[DECISION-032](DECISIONS.md#decision-032-use-one-interactive-apex-agent) and
[DECISION-033](DECISIONS.md#decision-033-support-native-windows-clients-and-deliver-apex-as-an-agent-plugin):
VS Code (Copilot harness) and the GitHub Copilot app on native Windows, Copilot CLI on Linux and WSL2, one APEX agent,
and an Agent Plugin plus `apex init` onboarding. The slice 11 fixes are merged (#356 to #366).

1. Deliver the client pivot workstreams in the order of the [backlog](#client-pivot-backlog). Task, evidence,
   ownership and approval checks stay authoritative.
2. Finish acceptance for issue #344. Offline coverage now includes Bicep source-policy evidence, Terraform saved-plan
   evidence, nonempty imports, identity/isolation rejection and bounded module-child bindings. Confirm the same
   candidate in supported clients; actual AVM-version/workload and cloud evidence require separate qualification.
   Unresolved ARM expressions remain unsupported rather than being treated as compliant.
3. Reconcile and finish COE/profile/change and artifact-output requirements; reuse implemented controls. Include the
   first-time install/bootstrap acceptance agreed on 2026-09-22 under `REQ-ONBOARDING-001`.
4. Qualify complete workflows and the plugin lifecycle in all three clients on the same candidate, then obtain
   separately authorized cloud and release evidence. Preserve all review, freshness, ownership and human approval
   gates.

Use narrow regression-first slices and integration checks at checkpoints. No new optimization campaign, broad rewrite
or optional feature expansion is needed to follow this order.

## Development Diagnostics

Separately authorized on 2026-09-18 under
[REQ-DEV-DIAGNOSTICS-001](PRD.md#req-dev-diagnostics-001-opt-in-development-evidence), not an expansion of the
optimization first batch or its deferred telemetry recommendation:

- Implement workspace registration/disable, isolated VS Code settings, process-scoped CLI launch, and a Linux/WSL
  collector using Azure CLI credentials. Preserve consumer packaging and existing service-principal credentials.
- Supply bounded, provenance-bearing local/Azure evidence for agent-led analysis. Missing capture remains a gap,
  never a passing workflow outcome. No unattended model invocation or automatic improvement application.
- Verify synthetic ingestion and local regressions first; retain real VS Code/CLI custom-agent session coverage as
  a separate pending qualification item. No desktop-app export claim.

See [current checkpoint](PROJECT.md#development-diagnostics-checkpoint) and
[operator commands](../how-to/debug-local.md#command-driven-session-assessment).

## CLI-Only Projection

Owner: managed customization, CLI lifecycle and client experience maintainers. Decision:
[DECISION-029](DECISIONS.md#decision-029-ship-one-copilot-cli-projection). Acceptance:
[REQ-CUSTOMIZATION-001](PRD.md#req-customization-001-managed-copilot-experiences) and the planned [CLI-only
scenarios](CLIENT-QUALIFICATION.md#planned-cli-only-scenarios). Branch: `feat/cli-projection`, PR #350; the plan and
slice 1 merged in #347. Tracking: [issue #348](https://github.com/jonathan-vella/apex-vnext/issues/348). Status: closed
on 2026-10-05. Slices 1 to 10 and 12 are done; slice 11 ran on 2026-10-02 against a real subscription and stopped at
Gate 2 ([results](CLIENT-QUALIFICATION.md#slice-11-re-run-on-a-subscription)). Its fixes merged
in #356 to #366. The [client pivot](#client-pivot) replaces the remaining plan: the VS Code harness now targets native
Windows instead of WSL, and CLIENT-021 and CLIENT-025 retire with agent switching and model pins.

Managed agents target Copilot CLI only. Users may still run them in VS Code through its Copilot harness, which must
pass the same qualification. Builder-only VS Code tooling for this repository stays.

| #   | Slice                         | Main scope                                                                                     | Done when                                                                                                                                                                                                                                               | Checks                                                                      |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0   | Merge #346                    | PR #346                                                                                        | #346 is merged; #347 is rebased onto `main` and retargeted                                                                                                                                                                                              | #346 CI passes                                                              |
| 1   | Local CLI probes              | Disposable workspaces under `dist/`                                                            | Dated results for model lists, effort field, `ask_user` multi-select and subagent use, `/agent` context, sidekick loading, `.mcp.json` in interactive and `-p` sessions, helper staging access and VS Code Copilot harness loading                      | Results recorded in CLIENT-QUALIFICATION                                    |
| 2   | Contracts                     | `packages/contracts`                                                                           | `github-copilot-cli` is the only installable projection; `github-copilot-vscode` means VS Code running CLI agents; the retired projection fails with a stable error code                                                                                | Contracts build and tests                                                   |
| 3   | CLI-format agents             | `customizations/.github/agents`, manifest, CLI tool inventory                                  | CLI frontmatter only; no model pins (DECISION-033); no VS Code-only fields                                                                                                                                                                              | `validate:agents`, customization tests                                      |
| 4   | Renderer and lifecycle        | `prepare-assets.mjs`, `assets.ts`, `service.ts`, `cli.ts`, `bootstrap-wizard.ts`               | One projection and `.mcp.json`; no combined mode or `apex-cli-*` names; `init` and `update` stop VS Code installs and say to run `apex init --client github-copilot-cli`                                                                                | CLI build; assets, adapters, customizations and bootstrap-wizard tests      |
| 5   | `apex-next`                   | Routing skill and APEX body                                                                    | APEX routes through `apex-next`; CP-13 removes the temporary specialist selection prompt                                                                                                                                                                | Skill and agent validators, routing regression, CLI probe                   |
| 6   | Advisory built-in helpers     | Planner, Operator, Architect, Reviewer and Validator                                           | Planner and Operator get read-only file tools for Explore; other helpers wait for helper tool scoping; Validator gets no shell; agents with `task` exclude other built-ins                                                                              | Grant tests, no-shell test, helper-only negative test, CLI probe per helper |
| 7   | Multi-choice input            | Kernel input validation, interactive agent bodies                                              | Native checkboxes where offered, numbered fallback otherwise; values map to kernel order; invalid, duplicate and out-of-range entries are rejected; confirmation stays                                                                                  | Kernel and service tests, CLIENT-023 probe                                  |
| 8   | Retire the VS Code projection | `.archive/vscode-projection/`, `retired-paths.v1.json`, projection-only scripts and registries | VS Code agents, `.vscode/mcp.json`, the renderer path and Local-only tests are archived with rollback notes; retired paths are enforced; lifecycle and client-comparison tooling target the VS Code Copilot harness; builder-only VS Code tooling stays | `test:retired-automation`, pack test, `validate:all`                        |
| 9   | Documentation                 | Explanation, reference, how-to, tutorials, `copilot-instructions.md`, generated references     | Docs describe shipped behavior only, including `/review` and `/security-review`                                                                                                                                                                         | `lint:md`, `validate:docs`, `validate:docs-reference`                       |
| 10  | Integration                   | Whole repository                                                                               | `npm run qualify:vnext` passes once                                                                                                                                                                                                                     | Full suite                                                                  |
| 11  | Client qualification          | Candidate-bound evidence                                                                       | CLIENT-001 to CLIENT-027, except deferred CLIENT-022, pass in standalone CLI and the VS Code Copilot harness; RISK-014 and RISK-015 closure proof is met                                                                                                | CLIENT-QUALIFICATION evidence                                               |
| 12  | Close out                     | PROJECT, REGISTER, ROADMAP                                                                     | #350 is ready for review                                                                                                                                                                                                                                | Maintainer review                                                           |

Each slice is one commit, or a small set, on `feat/cli-projection`. Slices 5 to 7 may run in any order after slice 4;
slice 8 follows them.

- **Slice 1:** done on 2026-09-23; the VS Code Copilot harness probe failed. The
  [probe results](CLIENT-QUALIFICATION.md#cli-only-projection-probes) select the frontmatter and MCP options and name
  the decisions that slices 5 to 7 and 11 need.
- **Slices 2 and 4:** done on 2026-09-23 in one push so CI stayed green. Workspace MCP moved to `.mcp.json` with a
  directory-independent `npx --no apex mcp serve` launch. VS Code profile commands and the VS Code render branch stayed
  until slice 8 archived them.
- **Slice 3:** remove `vscode/askQuestions`, handoffs, argument hints, agent allowlists and VS Code client mechanics.
  Workers use kernel task context, not repository instructions.
- **Slice 5:** `apex-next` centralizes routing from kernel state. CP-13 changes that routing to load same-agent stage
  skills for interactive work and delegate only hidden workers. APEX may also monitor and steer delegated workers.
- **Slice 6:** Explore for Planner and Operator only. Rubber-duck, Code-review and Security-review inherit the
  caller's full tool set, including APEX completion and disposition tools, and `task` cannot narrow it, so they wait
  until the CLI scopes helper tools. Users can still run `/review` and `/security-review` themselves. Agent
  frontmatter cannot limit shell commands, so Validator gets no shell and no built-in Task pre-checks.

| Retired mechanic                   | Replacement                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| handoff buttons and `send: true`   | `apex-next` delegation, or agent selection plus printed scope prompt           |
| `vscode/askQuestions` multi-select | `ask_user` checkboxes or numbered fallback, kernel validation and confirmation |
| per-parent `agents` allowlists     | kernel task ownership, `user-invocable: false`, scoped tools                   |
| `argument-hint`                    | agent `description`                                                            |
| VS Code model fallback arrays      | session model selection; agents carry no model pins (DECISION-033)             |
| `.vscode/mcp.json`, `${input:...}` | `.mcp.json` with environment variables                                         |
| VS Code Local harness              | VS Code Copilot harness                                                        |

General-purpose delegation, `/fleet`, `/delegate`, `/pr automerge` and plan mode are out of scope; see
[excluded CLI helpers](#excluded-cli-helpers).

## Client Pivot

Owner: client experience, CLI lifecycle and managed customization maintainers. Decisions:
[DECISION-031](DECISIONS.md#decision-031-replace-the-apex-reviewer-with-captured-rubber-duck-reviews),
[DECISION-032](DECISIONS.md#decision-032-use-one-interactive-apex-agent) and
[DECISION-033](DECISIONS.md#decision-033-support-native-windows-clients-and-deliver-apex-as-an-agent-plugin). Tracking:
[epic #387](https://github.com/jonathan-vella/apex-vnext/issues/387). The separate apex-jon modernization already proved
the client mechanics in a spike (8 of 8 checks in all three clients); vNext ports its helpers into the TypeScript
packages with tests rather than copying files. No separate Windows probe runs; everything is proven in final
qualification.

### Client Pivot Traceability

| Decision                           | Requirement                                         | Backlog                      | Qualification                                                |
| ---------------------------------- | --------------------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| DECISION-031 rubber-duck review    | `REQ-CUSTOMIZATION-001`                             | CP-16                        | CLIENT-033                                                   |
| DECISION-032 one APEX agent        | `REQ-CUSTOMIZATION-001`, `REQ-WORKFLOW-001`         | CP-13, CP-14, CP-15          | CLIENT-031, CLIENT-032, CLIENT-037                           |
| DECISION-033 hosts and sandbox     | `REQ-HOST-001`, `REQ-COPILOT-APP-001`               | CP-01 to CP-04, CP-12, CP-20 | CLIENT-012, CLIENT-035                                       |
| DECISION-033 plugin and onboarding | `REQ-DIST-001`, `REQ-ONBOARDING-001`, `REQ-MCP-001` | CP-05 to CP-11, CP-19, CP-22 | CLIENT-009, CLIENT-011, CLIENT-020, CLIENT-028 to CLIENT-030 |
| DECISION-034 MCP SDK v2            | `REQ-MCP-001`, `REQ-DIST-001`                       | CP-06, CP-09, CP-23          | CLIENT-038                                                   |
| DECISION-035 azd and pipelines     | `REQ-DIST-001`, `REQ-SECURITY-001`                  | CP-18, CP-26                 | CLIENT-035                                                   |
| DECISION-033 models and worktrees  | `REQ-CUSTOMIZATION-001`, `REQ-STATE-001`            | CP-05, CP-10, CP-14          | CLIENT-034, CLIENT-036, CLIENT-037                           |
| Governance and content follow-ups  | `REQ-GOV-001`, `REQ-GUIDANCE-001`                   | CP-17, CP-18, CP-21          | CLIENT-018                                                   |

### Client Pivot Backlog

| ID                                                               | Workstream      | Item                                                                                                                                                                                                                 | Done when                                                                                         |
| ---------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [CP-01](https://github.com/jonathan-vella/apex-vnext/issues/367) | Windows runtime | Resolve executables with `PATHEXT` and run `.cmd` shims safely                                                                                                                                                       | `az`, `npm` and `npx` launch and `doctor` finds tools on native Windows                           |
| [CP-02](https://github.com/jonathan-vella/apex-vnext/issues/368) | Windows runtime | Retry atomic renames on `EPERM`, `EACCES` and `EBUSY`                                                                                                                                                                | Kernel and CLI writes survive transient Windows sharing violations                                |
| [CP-03](https://github.com/jonathan-vella/apex-vnext/issues/369) | Windows runtime | Run kernel, capabilities and CLI tests on a Windows runner                                                                                                                                                           | A `windows-2025` CI job is required and green                                                     |
| [CP-04](https://github.com/jonathan-vella/apex-vnext/issues/370) | Windows runtime | Lower the Node minimum to 24 LTS                                                                                                                                                                                     | Engines, toolchain and doctor agree on Node 24                                                    |
| [CP-05](https://github.com/jonathan-vella/apex-vnext/issues/371) | Plugin          | Explicit workspace path on every MCP tool; shared `.apex/` via the git common directory                                                                                                                              | Worktree sessions share one run state; a second writer is rejected                                |
| [CP-06](https://github.com/jonathan-vella/apex-vnext/issues/372) | Plugin          | Agent Plugins 1.0 package build with a bundled MCP runtime and assets                                                                                                                                                | Deterministic build; `node ${PLUGIN_ROOT}/...` starts APEX MCP offline                            |
| [CP-07](https://github.com/jonathan-vella/apex-vnext/issues/373) | Plugin          | Separate vNext marketplace repository and a dry-run-first publish script                                                                                                                                             | A release publishes pinned to a commit SHA with a matching changelog                              |
| [CP-08](https://github.com/jonathan-vella/apex-vnext/issues/374) | Plugin          | CI smoke test that installs the packed plugin with Copilot CLI                                                                                                                                                       | The installed MCP server starts with only `PLUGIN_ROOT` set                                       |
| [CP-09](https://github.com/jonathan-vella/apex-vnext/issues/375) | Plugin          | MCP server instructions, remediation field and a result size cap with cursors                                                                                                                                        | Agents get remediation text; large results page instead of failing                                |
| [CP-10](https://github.com/jonathan-vella/apex-vnext/issues/376) | Plugin          | Repeat-safe state-changing MCP tools                                                                                                                                                                                 | A duplicated call has no extra effect, with a test per tool                                       |
| [CP-11](https://github.com/jonathan-vella/apex-vnext/issues/377) | Onboarding      | Thin `apex init` projection with plugin settings; retire copied agents and skills                                                                                                                                    | `.github/copilot/settings.json` installs the plugin; DECISION-015 gates pass                      |
| [CP-12](https://github.com/jonathan-vella/apex-vnext/issues/378) | Onboarding      | `apex-install` and setup/doctor per host (Windows 11; Linux or WSL2)                                                                                                                                                 | A clean host reaches a ready state without WSL on Windows                                         |
| [CP-13](https://github.com/jonathan-vella/apex-vnext/issues/379) | Agents          | Merge coordinator, Requirements, Architect, Planner and Operator into one APEX agent                                                                                                                                 | One agent runs every stage; R1 to R3 routing fixes included                                       |
| [CP-14](https://github.com/jonathan-vella/apex-vnext/issues/380) | Agents          | Remove model pins; validate tool names, `ask_user` arguments and self-contained worker prompts                                                                                                                       | Validators enforce the agent rules in `REQ-CUSTOMIZATION-001`                                     |
| [CP-15](https://github.com/jonathan-vella/apex-vnext/issues/381) | Agents          | Managed hooks with bash and PowerShell commands; deny the APEX agent as a `task` target                                                                                                                              | Hook tests pass on Linux and Windows                                                              |
| [CP-16](https://github.com/jonathan-vella/apex-vnext/issues/382) | Review          | Rubber-duck capture bound in the kernel journal; deny APEX mutations during rubber-duck calls; retire the APEX Reviewer                                                                                              | Findings come only from captured output; tampering and reviewer mutations fail closed             |
| [CP-17](https://github.com/jonathan-vella/apex-vnext/issues/383) | Governance      | Shrink the governance baseline format                                                                                                                                                                                | A management-group baseline with descendants fits the 20 MB import limit                          |
| [CP-18](https://github.com/jonathan-vella/apex-vnext/issues/384) | Content         | Re-port the current `jonathan-vella/apex` Azure skills into the shipped `apex-azure-*` skills, keeping vNext kernel rules; record source commits in an upstream-pins ledger; delete the stale repository-root copies | Shipped skills carry the improved guidance and their lineage; no stale copies remain              |
| [CP-19](https://github.com/jonathan-vella/apex-vnext/issues/385) | Docs            | Install, update and reset docs per host                                                                                                                                                                              | One channel per machine, Agent Host restart, Windows update lock and sandbox steps are documented |
| [CP-20](https://github.com/jonathan-vella/apex-vnext/issues/386) | Qualification   | Three-client qualification, including sandbox, Azure sign-in, bubblewrap on WSL2 and app worktrees                                                                                                                   | CLIENT-001 to CLIENT-038 pass in their applicable clients                                         |
| [CP-21](https://github.com/jonathan-vella/apex-vnext/issues/401) | Content         | Review the shipped skills against Anthropic's Agent Skills best practices, together with CP-18                                                                                                                       | Each guideline has a disposition; `validate:skills` checks the shipped skills                     |
| [CP-22](https://github.com/jonathan-vella/apex-vnext/issues/402) | Plugin          | Upgrade the MCP TypeScript SDK on the v1 line; keep protocol `2025-11-25`                                                                                                                                            | SDK pin is current and MCP tests pass                                                             |
| [CP-23](https://github.com/jonathan-vella/apex-vnext/issues/407) | Plugin          | Migrate APEX MCP to the TypeScript SDK v2 with a low-level `Server`; target protocol `2026-07-28`; drop v1                                                                                                           | `tools/list` unchanged; MCP tests pass on `2026-07-28`; v1 SDK removed                            |
| [CP-24](https://github.com/jonathan-vella/apex-vnext/issues/412) | Plugin          | Ship pinned native PNG rendering in the plugin bundle (`win32-x64`, `linux-x64` glibc)                                                                                                                               | PNG diagrams render from the built plugin on Linux and Windows                                    |
| [CP-25](https://github.com/jonathan-vella/apex-vnext/issues/425) | Plugin          | Fail closed when the MCP runtime version differs from the workspace lock                                                                                                                                             | `APEX_RUNTIME_MISMATCH` on every tool; `status` reports it read-only                              |
| [CP-26](https://github.com/jonathan-vella/apex-vnext/issues/443) | Deploy          | azd deployment track for labs and `azd pipeline config` GitHub Actions pipelines for production                                                                                                                      | azd preview bound to Gate 4; pipeline evidence through `submitEvidence`                           |

Order: CP-01 to CP-04 and CP-17 and CP-18 can start now. CP-05 precedes CP-06 to CP-11. CP-09, then CP-23, precede
CP-06, CP-08, CP-10 and CP-15. CP-13 and CP-14 precede CP-15 and CP-16. CP-21 runs with CP-18. CP-25 precedes the
first plugin release. CP-26 follows CP-12 and informs the CP-18 deploy skills. CP-19 and CP-20 come last.

## Phase 1: Align Without Rebuilding

**Requirements:** `REQ-MAINTAINABILITY-001`, `REQ-OPTIMIZATION-001`, `REQ-WORKFLOW-001`, `REQ-GUIDANCE-001`, `REQ-DOCS-001`.

Start with the first batch below. This is bounded implementation work, not a prerequisite optimization campaign for
every other feature. Existing governance work retains its owner; coordinate shared service and test edits rather than
restarting or overwriting that work. All batch items remain planned until implementation and checks provide evidence.

- Keep goals and the quality checklist in the PRD; other documents link to them.
- Identify code, registry or validator contracts enforcing superseded assumptions. Reconcile them in focused tested
  changes; documentation alone does not disable a check or mint qualification evidence.
- Do not introduce token-baseline work, telemetry infrastructure, broad cleanup or another planning layer.
- Keep existing state, preview binding, security, release checks and frozen evidence intact.

### First Batch: Input Correctness And Scope

Implement these slices in order, validating each before moving on. Canonical acceptance is
[REQ-OPTIMIZATION-001](PRD.md#req-optimization-001-bounded-input-efficiency).

1. **Fix review reads and current-revision selection.** Owner: CLI/kernel maintainers. Repair plan-review's
   `implementation-intent` lookup and select current accepted task dependencies instead of historical completion lists.
   Add regressions for superseded/invalidated inputs, every review subject, pagination and both IaC generation tracks.
   Anchors: `readTaskInput`, `inputRefs`, `generateIac` in `packages/cli/src/service.ts`. Addresses R-13 and prerequisites
   for R-12/R-20. Do not weaken invalidation or approval checks.
2. **Bound context and all reviewer packs.** Owner: CLI/kernel and contracts maintainers. Build task-specific projections,
   enforce locked byte budgets, preserve compact templates and offer selective authoritative reads. Remove redundant
   full-context loading for subject-only reads. Test large/multibyte fixtures, missing dependencies, stale ownership and
   expiry, review criteria/dispositions and required retrieval coverage. Addresses R-12/R-13/R-16/R-20 without new caches.
3. **Correct routing guidance and narrow tools.** Owner: managed customization and MCP maintainers. Handle `needs_review`,
   describe every registered tool and remove demonstrably irrelevant role grants. Preserve Architect pricing and needed
   Operator cost paths. Test both generated projections for required-tool coverage and forbidden-tool exclusion, plus
   `needs_input`/`needs_review`/`task` behavior. Addresses R-01/R-02/R-06; no new worker or client authority.
4. **Remove proven prompt duplication.** Owner: managed customization maintainers. Consolidate repeated sequencing and
   use compact domain references only where they reduce actual duplicate guidance. Keep essential worker rules and
   distinct operational checklists. Test guidance consumers, installed references, delegation boundaries and output
   contracts in both projections. Addresses R-03/R-04 and useful R-09 ordering; no broad bundle deletion.

For each slice, run its focused regression or contract check first, then relevant documentation and projection checks.
Use existing CLI workflow, adapter, dependency-revision and customization tests rather than a new measurement harness.
Run `npm run qualify:vnext` for product changes. Client behavior changes require separately authorized exact-client
qualification before parity claims. Preserve all four review passes, deterministic rich output and human approval.

### MCP Contract Follow-Up

Owner: CLI adapter maintainers; acceptance: [REQ-MCP-001](PRD.md#req-mcp-001-predictable-tool-contracts).
Implement before claiming paired-client readiness, in bounded slices:

1. Fix string/list response envelopes and sanitized execution errors. Run SDK in-memory regressions first.
2. Add canonical output schemas, strict arguments and staging-form validation; cover all registered tool results.
3. Audit side effects, annotations and status purity; add mutation-aware retries, cancellation and disconnect tests.
4. Run stdio/package checks and exact-client validation. DECISION-034 moves APEX MCP to the SDK v2 and protocol
   `2026-07-28` (CP-23). Do not build host discovery/code-mode infrastructure.

Kernel-enforced user stop scopes require a separate explicit authorization design, not an MCP metadata shortcut.

Implementation checkpoint: slices 1-3 have server code and focused regressions, including all 34 actual handlers,
canonical output schemas, strict staging forms, omitted-argument compatibility, read-only status and cancellation
before/after mutation. CP-23 replaced the v1 SDK `2025-11-25` stdio test with a `2026-07-28` discovery test, a
discover-then-`initialize` fallback test and a `tools/list` equality check against the v1 baseline. Slice 4 still
requires exact supported-client evidence; no client-parity claim follows from automated checks.

### Optimization Recommendation Dispositions

R-IDs refer to the token, quality and latency brief reviewed on 2026-09-15. This register owns delivery disposition;
the PRD owns acceptance. Applicable follow-ons belong in existing phases, not a second roadmap.

| Recommendation             | Disposition and delivery                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| R-01: ARM grants           | Adapt in first batch 3: scope per role, including legitimate Operator cost needs.            |
| R-02: Tool metadata        | First batch 3: descriptions and client coverage checks before allowlist changes.             |
| R-03: Prompt ownership     | Adapt in first batch 4: remove duplicates without losing worker safety rules.                |
| R-04: Skill index          | Adapt in first batch 4: compact references, no mandatory extra read per task.                |
| R-05: Bundle removal       | Phase 4: assess dormant/reference-only consumers; retire only with replacement proof.        |
| R-06: Next-task outcomes   | First batch 3: document and test `needs_review` alongside other outcomes.                    |
| R-07: Model tiers          | Deferred: require review-quality and delegation-boundary evidence before routing changes.    |
| R-08: Intake prose         | No standalone work: already concise; preserve recommendation provenance in Phase 3.          |
| R-09: Prompt ordering      | First batch 4 where useful: stable-first guidance, no cache-saving claim.                    |
| R-10: Pricing reuse        | Phase 4: reuse exact matching evidence rows; batching requires provider support.             |
| R-11: MCP duplication      | Deferred: prove compatibility in both clients before changing response representation.       |
| R-12: Context budgets      | Adapt in first batch 2: locked limits, compact inline content and selective retrieval.       |
| R-13: Input filtering      | First batch 1 then 2: accepted revisions and task dependencies, not kind filtering alone.    |
| R-14: Requirements delta   | Phase 3: base-bound amendments, stable IDs, merged validation and full-submit fallback.      |
| R-15: Network decision     | Phase 3: reuse confirmed intent when sufficient; retain necessary Architecture confirmation. |
| R-16: Replay reduction     | First batch 2: remove redundant request-local work; defer cross-call caching.                |
| R-17: Deferred rendering   | Deferred: require durable retry/recovery and package readiness before review or approval.    |
| R-18: Journal snapshots    | Deferred: demonstrate need and preserve journal integrity, expiry and ownership checks.      |
| R-19: New telemetry        | Not current scope under DECISION-025; preserve utilities and reconcile executable gates.     |
| R-20: Reviewer packs       | First batch 2: bounded evidence and exact criteria for all four unchanged review passes.     |
| R-21: Parallel reviews     | Deferred: scheduler and head/commit semantics need a separate correctness design.            |
| R-22: CLI workers          | Shipped in CLI; requalify in the CLI-only projection on the user-selected session model.     |
| R-23: Partial invalidation | Reject ID-only invalidation; Phase 3 reuses unchanged decisions with conservative proof.     |
| R-24: Recommendations      | Phase 3: recommend permitted choices; never record or accept risk without confirmation.      |

Deferred mechanisms are not authorized implementation work. Reconsider only with a concrete functional need, named
owner, compatibility and security design, focused tests and the required client evidence. Do not introduce model
benchmarks or telemetry to unlock them under this plan. Neither tool wire bytes nor bundle bytes prove model-token cost.

## Phase 2: Finish Governance

**Requirements:** `REQ-GOV-001`, `REQ-PLAN-001`, `REQ-IAC-001`, `REQ-CAPABILITY-001`.

- Complete [issue #344](https://github.com/jonathan-vella/apex-vnext/issues/344) with its current implementation owner.
- Reuse the collector/schema/parser and import only the active subscription from a reviewed committed baseline.
- Deliver consumer-owned scheduled/manual collection and OIDC configuration before expanding local policy emulation.
- Enforce the PRD's 30-day UTC age boundary at import, planning and new deployment approval. Retain a per-run optional
  reuse/refresh choice below 30 days; test exact expiry, future time, failed refresh and restart behavior.
- Renew observation time on every successful collection, including unchanged content. Separate observation receipts
  from semantic policy identity before claiming timestamp-only refresh preserves planning and approval dependencies.
- Package and qualify the consumer collect/import/plan path, then native validation and deployment enforcement.
- Discover governance before Architecture and map policy inside it ([DECISION-030](DECISIONS.md)); no new agent,
  gate or delivery infrastructure. Default to the ALZ Corp reference baseline until a reviewed subscription baseline
  replaces it after Gate 2 through `governance-refresh` and `policy-refresh`, which carry matching mappings and reopen
  Gate 2 only on `blocked`.
- Include effective-policy and evidenced-empty cases for standalone labs as well as management-group inheritance.
- Test paging, exemptions, ordering, errors and full-baseline exclusion from model-facing surfaces. Carry mappings
  through both IaC tracks, preview and deployment tests. Azure Policy always wins.

Consumer-governance implementation checkpoint: the 30-day guards, unchanged-observation renewal, typed persisted
reuse/refresh selection and explicit reconsideration are implemented. Both client bundles include the single-source
collector, schema and disabled-by-default GitHub workflow with normal update-conflict handling. Consumer identity and
environment setup, live collection, exact-client choice interaction, material-policy reconciliation, and the remaining
both-track policy/ownership qualification are still required; packaging tests do not establish those outcomes.

## Phase 3: Profiles, Import And Change

**Requirements:** `REQ-REUSE-001`, `REQ-CHANGE-001`, `REQ-REQUIREMENTS-001`, `REQ-STATE-001`, `REQ-CONTRACT-001`,
`REQ-ONBOARDING-001`.

- Represent ALZ-backed and standalone lab/demo profiles using existing project contracts and resource ownership.
- Ask for a remote COE during bootstrap, select one or more workload archetypes and create independent copies in separate
  folders with exact-commit provenance and separate project state. Do not compose workloads or import authority.
- Support manually copied projects by bounded inspection and confirmation, not full-history import.
- Reuse contracts and parameter files; clarify missing facts once. Exclude source secrets, state and approval authority.
- Ask relevant change questions, show consequences, confirm conflicts and update affected outputs only.
- Implement the applicable requirements follow-ons R-14/R-15/R-24 after the first batch: validated amendments,
  confirmed-decision reuse and permitted recommendations. Preserve old intake requests and full-document submission.
- Test profile changes, SKU/service/region/address/compliance/budget changes, manual edits, unrelated-file preservation,
  stale evidence and supplied-resource protection. Do not add cross-archetype composition or synchronization engines.

## Phase 4: Complete Useful Output

**Requirements:** `REQ-ARCH-001`, `REQ-OUTPUT-001`, `REQ-HANDOFF-001`, `REQ-OPS-001`, `REQ-QUALITY-001`.

- Reuse accepted rationale and facts for ADRs, design/cost/implementation documents and diagrams.
- Complete deployment and as-built documents, runbook, backup/DR guidance, compliance, costs and inventory.
- Deliver infrastructure outputs, deployment guidance and operational readiness for separately developed applications.
- Review selected artifacts against the [quality reference](PRD.md#output-quality-reference), not file size or volume.
- Improve navigation, tables and diagram semantics within existing renderers. Distinguish assumptions and proposed
  procedures from observations and tested outcomes. Refresh only affected content.
- Apply R-10 pricing-row reuse with exact evidence matching. Assess R-05 reference-only assets against their actual
  consumers and planned output needs; preserve domain-specific checklists and prove replacements before retirement.

## Phase 5: Complete The Three Supported Clients

**Requirements:** `REQ-HOST-001`, `REQ-COPILOT-APP-001`, `REQ-CUSTOMIZATION-001`, `REQ-GUIDANCE-001`,
`REQ-WORKFLOW-001`.

- Run basic client checks during earlier slices; use this phase to close end-to-end gaps, not first discover them.
- Scope this phase to the VS Code Copilot harness and the GitHub Copilot app on native Windows and Copilot CLI on Linux
  and WSL2, all running the APEX plugin and one APEX agent.
- Prove greenfield, COE import, changes, review, generation, validation and resume in both profiles.
- Preserve kernel authority and existing worker grants while qualifying required outcomes; profile visibility is not
  an authentication or security gate.
- Address R-22's outcome-parity goal without assuming a terminal invocation authenticates a worker's caller. Do not add
  a review command, broaden worker visibility or delegate generic tasks without proving the authority boundary.
- Validate setup/doctor on each host, least-privilege prerequisites and the selected IaC tool without Docker or a
  source checkout.
- Use compact inputs, scoped skills and deterministic filtering throughout; no current token benchmark is required.

### First-Time Setup Delivery

Owner: CLI lifecycle and managed customization maintainers. Acceptance: `REQ-ONBOARDING-001`, agreed on 2026-09-22.
These are planned additions, not capabilities established by existing bootstrap or clean-install tests.

1. Record a bounded install/setup plan with readiness, conflicts and approval boundaries; reuse setup/doctor and the
   canonical toolchain. Deliver `apex-install` on each supported host without requiring Node/APEX first, covering the
   plugin, the three supported clients and both IaC tracks. Verify installations and preserve compatible tools.
2. Extend repository bootstrap to resumable new/existing/cloned-repo setup that writes the thin projection and plugin
   settings.
   Retain one managed ownership/update path, conflict preservation and explicit partial outcomes.
3. Add remote-only COE selection during setup, independent multi-archetype copies and confirmed defaults/decision
   adoption. Reuse bounded import validation and provenance; never execute imported instructions or copy approvals.
4. Offer reviewed GitHub repository creation/push and policy-discovery OIDC setup with identity reuse or confirmed
   dedicated creation. Keep Azure read roles separate from deployment authority; preserve administrator handoffs.
5. Verify repository/client health and create the first collection review PR, or verify/import an existing central
   reviewed baseline. Preserve human review and report governance pending where appropriate.
6. Qualify reruns, interruption, missing permissions, conflicts, each supported client on its host, and secret-safe
   authentication.
   Live identity, federation, role and repository changes require separate explicit authorization during qualification.

## Phase 6: Deliver APEX As An Agent Plugin

**Requirements:** `REQ-DIST-001`, `REQ-ONBOARDING-001`, `REQ-HOST-001`, `REQ-SECURITY-001`, `REQ-DETERMINISM-001`.

- Build one Agent Plugins 1.0 package with the bundled `@apexops/cli` runtime, with the MCP server as one esbuild bundle
  on the SDK v2 (DECISION-034), and publish it from the separate vNext marketplace repository, pinned to a commit SHA.
  Keep `@apexops/cli` on npm at the same exact version.
- Install through one channel, the Copilot CLI store, which VS Code reads. `apex init` writes the thin projection and
  plugin settings.
- Prove workspace selection, prerequisites, version compatibility, updates, rollback, uninstall and active-run
  preservation in all three clients. Avoid duplicate discovery and competing file owners or updaters.
- Retire the copied agents and skills through the DECISION-015 gates. Do not create a hosted control plane or custom
  installer framework. Requalify changed delivery boundaries.

## Phase 7: Final Qualification And Release

**Requirements:** `REQ-APPROVAL-001`, `REQ-BICEP-001`, `REQ-TERRAFORM-001`, `REQ-IMPROVE-001` and all requirements above.

- Freeze the candidate and run required validation, deterministic qualification, package, security and client checks.
- Run separately authorized Bicep/Terraform apply, inventory, diagnosis, reconciliation and destroy scenarios with
  isolated targets and cleanup. Include both profiles and protect platform-owned resources.
- Treat quota and availability as assumptions, not evidence gates; report native failures without bypasses.
- Retain writer-transfer and approval guarantees, scorecard checks and privacy boundaries. No advanced safety
  requirement is silently removed by the new delivery order.
- Disposition risks, verify rollback, and obtain authorization for publication, tags and cutover.

## Later Work And Non-Goals

### Superseded: Standalone Copilot Desktop Plan

DECISION-033 makes the GitHub Copilot app a supported client again, so the separate desktop backlog parked on
2026-09-21 is closed. The [desktop implementation plan](COPILOT-DESKTOP-PLAN.md) is design history. Its native Windows
findings (process launching, newline checkout, worktree binding, worker authorization) feed the
[client pivot backlog](#client-pivot-backlog); its probe receipts are provenance, not qualification evidence.
github/app#4097 and github/app#4098 no longer block: APEX stops pinning models, and a managed hook denies the APEX agent
as a subagent target.

### Excluded CLI Helpers

On 2026-09-23 the maintainer moved advisory built-in helpers into the active [CLI-only
projection](#cli-only-projection): Explore, Rubber-duck, Code-review, Security-review, Validator `bicep` and `terraform`
pre-checks and user-invoked Research. They remain advisory and never replace APEX CodeGen or Validator contracts, create
validation receipts or approve gates. DECISION-031 later made rubber-duck the managed reviewer, with kernel-captured
output. The slice 6 probes kept only Explore in managed agents; the other helpers and Validator pre-checks wait for
helper tool scoping and a CLI-enforced shell limit.

General-purpose delegation, `/fleet`, `/delegate`, `/pr automerge` and plan mode stay out of managed workflows.
General-purpose delegation defeats bounded least-privilege roles, `/fleet` bypasses kernel batch control, `/delegate`
and `/pr automerge` leave kernel gates, and plan mode duplicates Planner without adding authority. Revisit only with a
named need, an authority design, focused tests and client evidence.

### Other Deferred Work

Application deployment pipelines and application-specific configuration are optional after the core product works.
Token benchmarking is not current work. Continuous COE synchronization, multi-archetype composition, hosts beyond
`REQ-HOST-001`, ALZ foundation deployment, application development and generic orchestration/synchronization frameworks
are not initial scope. Existing advanced capabilities need no expansion or deletion merely to simplify this plan.
The read-only context sidekick waits until a Copilot CLI release launches custom sidekicks; the slice 1 probe found
that CLI `1.0.88` does not.

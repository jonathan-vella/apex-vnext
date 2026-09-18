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
| 5     | Close WSL2 and paired-client workflow gaps   | Both clients complete the lifecycle without a devcontainer               |
| 6     | Finalize distribution and APEX MCP delivery  | Easy install/update/upgrade/rollback with compatible runtime versions    |
| 7     | Qualify and release the final candidate      | Current evidence and explicit release authority                          |

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

### Optimization Recommendation Dispositions

R-IDs refer to the token, quality and latency brief reviewed on 2026-09-15. This register owns delivery disposition;
the PRD owns acceptance. Applicable follow-ons belong in existing phases, not a second roadmap.

| Recommendation             | Disposition and delivery                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| R-01: ARM grants           | Adapt in first batch 3: scope per role, including legitimate Operator cost needs.              |
| R-02: Tool metadata        | First batch 3: descriptions and client coverage checks before allowlist changes.               |
| R-03: Prompt ownership     | Adapt in first batch 4: remove duplicates without losing worker safety rules.                  |
| R-04: Skill index          | Adapt in first batch 4: compact references, no mandatory extra read per task.                  |
| R-05: Bundle removal       | Phase 4: assess dormant/reference-only consumers; retire only with replacement proof.          |
| R-06: Next-task outcomes   | First batch 3: document and test `needs_review` alongside other outcomes.                      |
| R-07: Model tiers          | Deferred: require review-quality and delegation-boundary evidence before routing changes.      |
| R-08: Intake prose         | No standalone work: already concise; preserve recommendation provenance in Phase 3.            |
| R-09: Prompt ordering      | First batch 4 where useful: stable-first guidance, no cache-saving claim.                      |
| R-10: Pricing reuse        | Phase 4: reuse exact matching evidence rows; batching requires provider support.               |
| R-11: MCP duplication      | Deferred: prove compatibility in both clients before changing response representation.         |
| R-12: Context budgets      | Adapt in first batch 2: locked limits, compact inline content and selective retrieval.         |
| R-13: Input filtering      | First batch 1 then 2: accepted revisions and task dependencies, not kind filtering alone.      |
| R-14: Requirements delta   | Phase 3: base-bound amendments, stable IDs, merged validation and full-submit fallback.        |
| R-15: Network decision     | Phase 3: reuse confirmed intent when sufficient; retain necessary Architecture confirmation.   |
| R-16: Replay reduction     | First batch 2: remove redundant request-local work; defer cross-call caching.                  |
| R-17: Deferred rendering   | Deferred: require durable retry/recovery and package readiness before review or approval.      |
| R-18: Journal snapshots    | Deferred: demonstrate need and preserve journal integrity, expiry and ownership checks.        |
| R-19: New telemetry        | Not current scope under DECISION-025; preserve utilities and reconcile executable gates.       |
| R-20: Reviewer packs       | First batch 2: bounded evidence and exact criteria for all four unchanged review passes.       |
| R-21: Parallel reviews     | Deferred: scheduler and head/commit semantics need a separate correctness design.              |
| R-22: CLI workers          | Reject terminal-wrapper shortcut; Phase 5 delivers a supported path retaining ADR-0006 bounds. |
| R-23: Partial invalidation | Reject ID-only invalidation; Phase 3 reuses unchanged decisions with conservative proof.       |
| R-24: Recommendations      | Phase 3: recommend permitted choices; never record or accept risk without confirmation.        |

Deferred mechanisms are not authorized implementation work. Reconsider only with a concrete functional need, named
owner, compatibility and security design, focused tests and the required client evidence. Do not introduce model
benchmarks or telemetry to unlock them under this plan. Neither tool wire bytes nor bundle bytes prove model-token cost.

## Phase 2: Finish Governance

**Requirements:** `REQ-GOV-001`, `REQ-PLAN-001`, `REQ-IAC-001`, `REQ-CAPABILITY-001`.

- Complete [issue #344](https://github.com/jonathan-vella/apex-vnext/issues/344) with its current implementation owner.
- Reuse the collector/schema/parser and import only the active subscription from a reviewed committed baseline.
- Preserve discovery, reconciliation, governance review and Gate 2; no new agent, gate or delivery infrastructure.
- Include effective-policy and evidenced-empty cases for standalone labs as well as management-group inheritance.
- Test paging, exemptions, ordering, errors and full-baseline exclusion from model-facing surfaces. Carry mappings
  through both IaC tracks, preview and deployment tests. Azure Policy always wins.

## Phase 3: Profiles, Import And Change

**Requirements:** `REQ-REUSE-001`, `REQ-CHANGE-001`, `REQ-REQUIREMENTS-001`, `REQ-STATE-001`, `REQ-CONTRACT-001`.

- Represent ALZ-backed and standalone lab/demo profiles using existing project contracts and resource ownership.
- Let the user identify a COE, select one workload archetype and create an independent copy with source provenance.
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

## Phase 5: Complete Both WSL2 Client Experiences

**Requirements:** `REQ-HOST-001`, `REQ-CUSTOMIZATION-001`, `REQ-GUIDANCE-001`, `REQ-WORKFLOW-001`.

- Run basic client checks during earlier slices; use this phase to close end-to-end gaps, not first discover them.
- Prove greenfield, COE import, changes, review, generation, validation and resume in both profiles.
- Preserve the CLI hidden-worker boundary while providing every required outcome through supported mechanisms.
- Address R-22's outcome-parity goal without assuming a terminal invocation authenticates a worker's caller. Do not add
  a review command, broaden worker visibility or delegate generic tasks without proving the authority boundary.
- Validate WSL2 setup/doctor, least-privilege prerequisites and the selected IaC tool without Docker or source checkout.
- Use compact inputs, scoped skills and deterministic filtering throughout; no current token benchmark is required.

## Phase 6: Distribution Last

**Requirements:** `REQ-DIST-001`, `REQ-HOST-001`, `REQ-SECURITY-001`, `REQ-DETERMINISM-001`.

- Keep npm functional until this phase. Evaluate Agent Plugins and APEX MCP redistribution after features work.
- Compare npm-only, plugin plus npm runtime and bundled runtime using existing builds and canonical customizations.
- Prove workspace selection, authentication, prerequisites, version compatibility, upgrades, rollback, uninstall and
  active-run preservation in both clients. Avoid duplicate discovery and competing file owners/updaters.
- Record the decision before changing distribution authority. Do not create a hosted control plane or custom installer
  framework merely to package the runtime. Requalify changed delivery boundaries.

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

Application deployment pipelines and application-specific configuration are optional after the core product works.
Token benchmarking is not current work. Continuous COE synchronization, multi-archetype composition, native Windows
qualification, ALZ foundation deployment, application development and generic orchestration/synchronization frameworks
are not initial scope. Existing advanced capabilities need no expansion or deletion merely to simplify this plan.

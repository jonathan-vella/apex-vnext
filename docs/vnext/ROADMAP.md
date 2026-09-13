# APEX vNext Roadmap

The [PRD](PRD.md) owns scope and acceptance; [PROJECT.md](PROJECT.md) owns the current checkpoint. This is delivery order,
not another runtime workflow or set of human gates. Each slice includes focused tests and relevant documentation.
Preserve working safety mechanisms; do not rebuild the runtime or create a general platform framework.

## Delivery Order

| Phase | Outcome                                       | Primary acceptance                                                       |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------ |
| 1     | Align controls and implementation obligations | Planned versus implemented behavior is explicit; checks are not bypassed |
| 2     | Complete governance baseline import           | Subscription policy reaches review, Gate 2, planning and code validation |
| 3     | Support both profiles and COE adaptation      | Independent import and conversational changes reuse accepted decisions   |
| 4     | Complete design and operational output        | Useful, consistent documents and handoff match the quality reference     |
| 5     | Close WSL2 and paired-client workflow gaps    | Both clients complete the lifecycle without a devcontainer               |
| 6     | Finalize distribution and APEX MCP delivery   | Easy install/update/upgrade/rollback with compatible runtime versions    |
| 7     | Qualify and release the final candidate       | Current evidence and explicit release authority                          |

## Phase 1: Align Without Rebuilding

**Requirements:** `REQ-MAINTAINABILITY-001`, `REQ-OPTIMIZATION-001`, `REQ-DOCS-001`.

- Keep goals and the quality checklist in the PRD; other documents link to them.
- Identify code, registry or validator contracts enforcing superseded assumptions. Reconcile them in focused tested
  changes; documentation alone does not disable a check or mint qualification evidence.
- Do not introduce token-baseline work, telemetry infrastructure, broad cleanup or another planning layer.
- Keep existing state, preview binding, security, release checks and frozen evidence intact.

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

## Phase 5: Complete Both WSL2 Client Experiences

**Requirements:** `REQ-HOST-001`, `REQ-CUSTOMIZATION-001`, `REQ-GUIDANCE-001`, `REQ-WORKFLOW-001`.

- Run basic client checks during earlier slices; use this phase to close end-to-end gaps, not first discover them.
- Prove greenfield, COE import, changes, review, generation, validation and resume in both profiles.
- Preserve the CLI hidden-worker boundary while providing every required outcome through supported mechanisms.
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

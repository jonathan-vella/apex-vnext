# APEX vNext Checkpoint

- **Updated:** 2026-09-16
- **Repository:** `jonathan-vella/apex-vnext`
- **Integration branch:** `main`
- **Product status:** Pre-release
- **Release candidate:** None selected

## Current State

The approved direction is a COE workload factory with independent archetype reuse and conversational changes.
Both ALZ-backed workloads and standalone single-subscription labs/demos are day-one requirements. Windows users run
through WSL2 without a devcontainer. [PRD.md](PRD.md) is the canonical scope and quality reference.

The standalone vNext repository owns a deterministic TypeScript runtime, versioned contracts, bounded capabilities,
renderers, CLI/MCP lifecycle, managed VS Code and Copilot CLI projections, and deterministic qualification.

Repository modernization has retired original automation, prompts, compatibility utilities, duplicate workflows and npm
scripts, stale root configuration, and unneeded development-container tooling. The active documentation has been rebuilt
around vNext source authorities and Diátaxis navigation.

## Open Release Work

- Complete the [first optimization batch](ROADMAP.md#first-batch-input-correctness-and-scope): revision-safe reads,
  bounded context/reviewer packs and routing/tool scope have implementation and focused tests. Complete reviewer
  evidence/disposition coverage and exact-client checks. Scoped prompt inspection found no further safe deletion.
- Complete issue #344's nonempty-policy enforcement through planning and native code validation. Path-only import,
  standalone collection and evidenced-empty import-to-simulated-deployment tests exist for both tracks. Native apply
  previews check concrete policy values against compiled Bicep/saved Terraform plans with source-bound receipts;
  physical-identity ownership and earlier code-validation integration remain open.
- Implement and qualify COE import, provenance, relevant change questions, manual-edit conflicts and selective
  regeneration using existing contracts and parameters.
- Complete design/ADR and operational/as-built output against the PRD quality checklist.
- Close both-client lifecycle gaps on WSL2 in both profiles; generated projections do not prove complete outcomes.
- Evaluate Agent Plugins and APEX MCP redistribution after features work; npm remains the current implementation.
- Complete exact-candidate live qualification for supported client interactions.
- Complete separately authorized Bicep and Terraform cloud qualification.
- Bind target governance, pricing, security and cleanup evidence. Quota and availability remain assumptions.
- Select an exact release candidate only after all blocking evidence is current.
- Publication, tags, releases, deployment and cutover have conditional maintainer authorization as recorded below;
  required evidence, protected checks and operation-specific approval contracts remain mandatory.

GitHub Issues and the repository project own day-to-day work selection. [ROADMAP.md](ROADMAP.md) owns dependency order;
[REGISTER.md](REGISTER.md) owns unresolved risks; [PRD.md](PRD.md) owns acceptance.

## Evidence Status

| Evidence                                                       | Status                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| Contract, kernel, capability, renderer, CLI, and package tests | Required on every candidate                               |
| Clean package installation                                     | Required and deterministic                                |
| Managed projection generation and lifecycle                    | Implemented and tested                                    |
| VS Code live client outcomes                                   | Current candidate pending                                 |
| Copilot CLI live client outcomes                               | Current candidate pending with autonomous-worker omission |
| Bicep live Azure outcomes                                      | Current candidate pending                                 |
| Terraform live Azure outcomes                                  | Current candidate pending                                 |
| Release authority                                              | Conditional authorization; acceptance evidence pending    |

Only exact-candidate evidence satisfies current gates.

## Active Delivery Authorization

On 2026-09-16 the maintainer authorized autonomous roadmap delivery, takeover of issue #344, commits, PRs, protected
merges and publication after release acceptance. No protections, approval contracts or credential permissions may be
bypassed. Manual VS Code and Copilot CLI/app tests remain maintainer actions. Live qualification is limited to isolated
run-owned resources in the authenticated non-production `apex-shared` subscription; pre-existing resources are protected.

The authorized spending window is 2026-09-16 00:00 UTC through 2026-09-30 00:00 UTC, with a USD 2,000 total-subscription
ceiling and USD 400 reserve. Stop new provisioning at USD 1,600 estimated accrued spend or earlier projected overrun.
Both requested email recipients are configured on the qualification budget, with actual thresholds 50/75/80/90/100%
and forecast thresholds 80/100%. Email receipt is unverified. Azure requires a month-start budget; its September scope
is more conservative than the authorized window. Budget alerts are not hard spending caps.

No billable qualification resources have been provisioned. The initial existing-budget read reported USD 1,000.60
September accrued and USD 1,539.88 monthly forecast; exact-window cost queries were rate-limited. These figures are
historical observations, not current deployment headroom. Refresh actual and projected costs before provisioning.

The active worktree adds current-dependency task inputs, UTF-8 input/output budgets, selective authorized reads,
review pagination/expiry checks, narrow role grants, and governance import/collector safeguards. An experimental local
archetype copy capability was removed after adversarial review found filesystem-race and secret-detection defects.
COE import remains unimplemented; no release candidate has been selected.

Draft [PR #345](https://github.com/jonathan-vella/apex-vnext/pull/345) contains the implementation checkpoint and prior
cleanup/dependency work. The native-policy follow-up adds a typed digest-only receipt, bounded property comparison,
exact generated-source verification, persisted preview binding and rejection of missing or altered evidence before
Gate 4. Unsupported expressions, missing values and unverified exemptions fail closed. This is concrete-property
preflight, not an Azure Policy interpreter or proof that supplied platform resources cannot be changed.

PR feedback identified path containment, a weekly baseline TTL mismatch and management-group ID validation; these have
focused fixes. Reported literal authorization placeholders were review redaction artifacts, verified against local and
GitHub source; tests now assert Bearer-header construction. Catalog generation excludes Python caches to match clean CI.

A read-only repository collector check against the authorized subscription succeeded on 2026-09-16: nine assignments,
six retained, three Defender-filtered, and 48 actionable findings (13 blockers and 35 auto-remediation findings).
Schema validation and selected-subscription import passed. Temporary baseline data was deleted; no Azure resources or
policies were changed. Audit-only classifications remain visible summary evidence, not fabricated property mappings.

Final `npm run qualify:vnext` passed after repairing two stale guidance/tool inventory assertions, including
143 validator tests and 29 packaging tests. Repository Node checks passed after regenerating public references.
The external validation stage initially used system Python without pytest; rerunning with the existing virtual
environment passed, including 16 Python tests and four optional skips. No live client or cloud proof is inferred.

## Planning Checkpoint

On 2026-09-13, [PR #343](https://github.com/jonathan-vella/apex-vnext/pull/343) was verified merged, delivering the
creative-workflow changes. [Issue #344](https://github.com/jonathan-vella/apex-vnext/issues/344) was open with no comments
or linked completion evidence in the inspected timeline. It is the governance plan, not an implementation receipt.
The authorized delivery session has taken over that work and posted implementation progress on the issue.

COE import/adaptation, explicit profile behavior, full output parity and final distribution remain target requirements
until backed by implementation and tests. Existing code supports parts of these outcomes; this revision does not mark
them complete. Registry/validator alignment, including the existing optimization gate, is a focused follow-up rather
than permission to bypass checks. No token baseline is planned now.

On 2026-09-15, a source review at `0615bbe` assessed the external token, quality and latency recommendations. Isolated
in-memory probes reproduced historical input selection after invalidation and plan-review's incorrect artifact lookup;
these are findings, not full integration-test or client qualification receipts. The reviewed worktree included existing
service and test edits. Refresh the head, local changes and issue ownership before implementation.

The approved next work is the roadmap's ordered first batch, beginning with `readTaskInput`, `inputRefs` and their
workflow/dependency-revision regressions. All four reviewer passes remain required. Applicable requirements, pricing,
bundle and client follow-ons have named phases in the
[recommendation dispositions](ROADMAP.md#optimization-recommendation-dispositions). Deferred mechanisms, new telemetry,
model downgrades and unsupported CLI worker shortcuts are not authorized by this planning update.

## Resume Protocol

1. Verify the current `main` head and protected check state.
2. Review open issues and the roadmap dependency order.
3. Select one bounded item with an owner and acceptance evidence.
4. Keep live operations separate unless the item carries explicit authorization.
5. Update this checkpoint only when the durable release boundary changes.

# APEX vNext Checkpoint

- **Updated:** 2026-09-15
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
  bounded context/reviewer packs, routing/tool scope, then proven prompt deduplication. All items are planned, not done.
- Complete governance baseline import and standalone-subscription coverage with the owner of issue #344.
- Implement and qualify COE import, provenance, relevant change questions, manual-edit conflicts and selective
  regeneration using existing contracts and parameters.
- Complete design/ADR and operational/as-built output against the PRD quality checklist.
- Close both-client lifecycle gaps on WSL2 in both profiles; generated projections do not prove complete outcomes.
- Evaluate Agent Plugins and APEX MCP redistribution after features work; npm remains the current implementation.
- Complete exact-candidate live qualification for supported client interactions.
- Complete separately authorized Bicep and Terraform cloud qualification.
- Bind target governance, pricing, security and cleanup evidence. Quota and availability remain assumptions.
- Select an exact release candidate only after all blocking evidence is current.
- Keep package publication, tags, releases, deployment, and cutover explicitly unauthorized until final approval.

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
| Release authority                                              | Not granted                                               |

Historical candidate dossiers are archived and do not satisfy current gates.

## Planning Checkpoint

On 2026-09-13, [PR #343](https://github.com/jonathan-vella/apex-vnext/pull/343) was verified merged, delivering the
creative-workflow changes. [Issue #344](https://github.com/jonathan-vella/apex-vnext/issues/344) was open with no comments
or linked completion evidence in the inspected timeline. It is the governance plan, not an implementation receipt.
Refresh GitHub and the implementation branch before acting; another session owns that work.

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

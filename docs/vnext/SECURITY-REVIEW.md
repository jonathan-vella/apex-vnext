# Independent Security Review Evidence

## Status

This document records read-only independent review evidence. It does not authorize deployment, publication, tagging, or
cutover and does not substitute for the CodeQL-or-explicitly-approved-equivalent requirement in the
[product requirements](PRD.md#cutover-acceptance).

## Reviews

### Exact-main baseline

- **Candidate:** `e5509097aa7a1b9c389673a79ee7fbf7110de678`
- **Date:** 2026-07-20
- **Method:** Separate read-only review agent examining trust boundaries, subprocess use, local state, package evidence,
  and live handoff authority.
- **Result:** No critical or high finding. One medium finding remained: caller-provided Azure resource-group and
  storage-account names reached generated Terraform backend HCL without prior name validation.

### Remediation follow-up

- **Candidate:** `860bb459f9ac2d5db1423f400382e0d9ebc8fd12`, based on the exact-main baseline above.
- **Date:** 2026-07-20
- **Method:** Separate adversarial read-only review of the complete diff plus focused local tests.
- **Result:** The review confirmed that Azure names are validated before HCL generation, CLI calls use argument arrays,
  the 100-case scorecard collectors execute real validators/loaders/cache operations, task context bytes measure the
  actual serialized `ApexService.taskContext()` projection, and derived evidence carries deterministic provenance.

The follow-up raised a semantic concern that task context might mean staged artifact bytes. The frozen scorecard scenario
is `largest-bounded-task-projection`, so the measured service projection is the intended quantity.
Staged artifacts are a different bounded surface. Suggestions to add cache sleeps were not accepted because the collector
is sequential.
Suggestions to reject resource-group hyphens were not accepted because Azure naming rules permit them. No valid critical
or high finding remains from the follow-up review.

## Remediation

The [live handoff launcher](../../tools/scripts/vnext-live-handoff.mjs) now validates resource-group names against the
Azure 1-90 character contract with no trailing period and validates storage-account names as 3-24 lowercase
alphanumerics. Focused mutations in the
[live workflow tests](../../tools/tests/vnext-live-workflow.test.mjs) reject quote/newline injection, trailing-period
resource groups, and invalid storage-account casing and punctuation.

The [scorecard collectors](../../packages/testkit/src/scorecard-samples.ts) execute 100 uniquely identified contract,
capability, and cache cases. The [qualification harness](../../packages/testkit/src/qualification.ts) records replayed
gate revisions and actual serialized task-context projection sizes for each Bicep and Terraform run.

## Limitations

- GitHub code scanning is disabled, so a supported current CodeQL result and alert #34 closure receipt are unavailable.
- The follow-up is bound to `860bb459f9ac2d5db1423f400382e0d9ebc8fd12`. Later release-automation changes require a
  final review and required checks on the eventual immutable candidate commit.
- No new Azure or GitHub Actions deployment was dispatched. Existing cloud evidence predates these source changes and is
  historical only.
- Manual VS Code, cross-device, OIDC writer-transfer, dual-track cloud lifecycle, and promotion scenarios remain
  unavailable for the final candidate.

The evidence and blocker split are also recorded on destination issue `#13`.

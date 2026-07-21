# Independent Security Review Evidence

## Status

This document records read-only independent review evidence. The maintainer accepted this method on destination issue
`#13` as the CodeQL equivalent while the repository was private. Public conversion will enable native CodeQL, which must
pass before publication or cutover. This evidence does not authorize deployment, publication, tagging, or cutover.

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

### Final exact-main repeat

- **Candidate:** `1f8db536fe0398f6575775d7794ba718234d3ef1`
- **Date:** 2026-07-21
- **Method:** Separate read-only review of the final dependency delta, parser and subprocess boundaries, local Gate 4 and
  OIDC handoff authority, release workflow permissions and exact-head binding, package contents and provenance settings,
  and committed `.apex/` evidence.
- **Result:** No critical, high, actionable release-blocking, or authorization-bypass finding. Production lockfile audit
  reported zero vulnerabilities. Full lockfile audit reported two accepted moderate findings in the development-only
  Markdown lint path.

The review confirmed that no non-`.apex/` file changed after the final dependency remediation commit
`8c672d76cb2c2028131fcb93bb023ba9327d256b`. It identified one non-blocking hardening item: the development-only nested
`js-yaml@4.3.0` lock entry is resolved through the approved npm mirror with legacy SHA-1 integrity metadata. This is
tracked as `RISK-006` in the [release register](REGISTER.md).

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

- Native CodeQL remains pending until the authorized public visibility transition completes.
- The committed-state secret review is pattern-based and cannot prove the absence of every possible encoded secret.
- The approved equivalent review must repeat after any release-relevant source, workflow, generated-asset, or dependency
  change.
- The maintainer-selected unified `0.10.0` version amendment supersedes the final exact-main review above. A repeated
  read-only review of PR `#85` candidate `465c89b4cee7bdb4f99e9122253f67d48ca2c766` found no critical, high,
  authorization-bypass, or release-blocking issue and confirmed that the prior cloud evidence remains behaviorally
  equivalent because no workflow, IaC, or authority path changed. Later PR commits are limited to this finding's
  documentation remediation and deterministic formatting; GitHub checks identify the final exact head.
- Manual supported VS Code, cross-device, and final promotion scenarios remain outstanding. Both dual-track cloud
  lifecycles and OIDC writer transfers completed against the same non-`.apex/` source boundary as final `main`.

The evidence and blocker split are also recorded on destination issue `#13`.

## APEX vNext Register

This register contains high-signal release and project concerns. GitHub Issues own executable work state. Replace
`Pending` related-issue values with issue links during the GitHub bootstrap, and add closure proof before closing an
entry.

Allowed entry types are `RISK`, `ASSUMPTION`, `ISSUE`, `DEPENDENCY`, `DEFECT`, and `REGRESSION`.

## Open Entries

### RISK-001: Final Promotion Evidence And Authorization Are Incomplete

- **Type:** `RISK`
- **Owner:** Release engineering
- **Impact:** Package publication, release tags, and cutover remain blocked.
- **Evidence:** Exact-main CI run `29822326665` and release-qualification run `29822400861` passed on
  `1f8db536fe0398f6575775d7794ba718234d3ef1`. All nine scorecard rules passed, the downloaded artifact verified through
  `SHA256SUMS`, the explicitly approved CodeQL-equivalent review was repeated on that exact commit, and both live cloud
  tracks completed. The later maintainer-selected unified `0.10.0` version amendment is locally qualified but
  uncommitted, so the prior exact-head evidence is historical. Supported VS Code evidence, npm publication authority,
  final tags, and cutover authorization remain outstanding.
- **Related issue:** Destination issue `#13`.
- **Mitigation:** Commit and qualify the unified version amendment, repeat the approved security-equivalent review,
  confirm cloud-evidence equivalence, complete the supported VS Code and cross-device checklist, configure trusted
  publishers, then obtain a separate explicit promotion decision.
- **State:** Open
- **Closure proof:** Versioned supported-host evidence plus the final maintainer promotion decision.

### RISK-003: GitHub Project Access Is Unavailable To The Current Token

- **Type:** `RISK`
- **Owner:** Repository maintainer
- **Impact:** The `APEX vNext` planning view, fields, and views cannot be inspected or created in this execution.
- **Evidence:** `gh project list --owner jonathan-vella` returned `Resource not accessible by personal access token` on
  2026-07-14.
- **Related issue:** [#541](https://github.com/jonathan-vella/apex/issues/541)
- **Mitigation:** Grant the token Projects read/write scope or create the project through an authorized maintainer session.
- **State:** Blocked
- **Closure proof:** Project URL and verified field and view inventory.

### RISK-005: Markdown Linter Carries A Moderate Parser Denial-Of-Service Advisory

- **Type:** `RISK`
- **Owner:** Release engineering
- **Impact:** Adversarial Markdown could consume excess CI CPU during linting; shipped runtime packages are unaffected.
- **Evidence:** `markdownlint-cli2@0.23.0` pins `js-yaml@5.2.0`, which is affected by the moderate `!!omap`
  quadratic-complexity advisory. `npm audit --omit=dev` reports zero vulnerabilities, and the high-severity 4.x
  merge-key advisory is removed by pinning the compatible `xmlbuilder2` branch to `js-yaml@4.3.0`.
- **Related issue:** Dependabot alert `#1`.
- **Mitigation:** Accept for the private trusted-contributor release line, retain bounded CI job timeouts, and update
  `markdownlint-cli2` when an upstream release consumes `js-yaml@5.2.1` or newer.
- **State:** Accepted
- **Closure proof:** Full audit contains no critical or high finding; production-only audit contains no finding.

### RISK-006: A Development Lock Entry Uses Mirror-Resolved SHA-1 Metadata

- **Type:** `RISK`
- **Owner:** Release engineering
- **Impact:** Reproducing the development-only `xmlbuilder2` validation path depends on the approved npm proxy retaining
  the exact `js-yaml@4.3.0` tarball identified by legacy SHA-1 lock metadata. Published runtime packages are unaffected.
- **Evidence:** The nested lock entry is marked `dev: true`; `npm audit --package-lock-only --omit=dev` reports zero
  vulnerabilities, and the exact-main independent review found no release-blocking supply-chain issue.
- **Related issue:** Destination issue `#13`.
- **Mitigation:** Retain lockfile and package-artifact SHA-256 qualification, then normalize this entry to canonical
  registry metadata with SHA-512 integrity when the approved proxy emits it without changing the resolved dependency.
- **State:** Accepted
- **Closure proof:** A regenerated lock entry uses canonical registry metadata and SHA-512 integrity, with exact-head CI
  and release qualification passing.

### ASSUMPTION-001: VS Code Handoff Topology Is Supported

- **Type:** `ASSUMPTION`
- **Owner:** VS Code experience
- **Impact:** Failure would require more agents to remain picker-visible and would change the intended user experience.
- **Evidence:** The managed customization manifest validates invocation edges, but no fresh supported VS Code evidence is
  bound to the current candidate.
- **Related issue:** Destination issue `#9`.
- **Mitigation:** Run direct handoff, hidden worker, model-tier, and `askQuestions` scenarios in a clean supported VS Code.
- **State:** Open
- **Closure proof:** Versioned manual qualification evidence on the exact candidate head.

### DEPENDENCY-001: Phase 0A Evidence Remains Frozen

- **Type:** `DEPENDENCY`
- **Owner:** Product governance
- **Impact:** Editing the baseline would invalidate approved compatibility and defect dispositions.
- **Evidence:** [Phase 0A baseline](phase-0a/README.md) and its sealed evidence manifest.
- **Related issue:** Not applicable
- **Mitigation:** Treat `docs/vnext/phase-0a/**` as read-only and express later decisions in this project document set.
- **State:** Active
- **Closure proof:** Retained through cutover; no closure expected before archival.

### DEPENDENCY-002: Dedicated Repository Supersedes The Integration Branch

- **Type:** `DEPENDENCY`
- **Owner:** Repository maintainer
- **Impact:** Delivery topology differs from the Phase 0A sequencing note while preserving source provenance and release
  gates.
- **Evidence:** [Repository migration](../MIGRATION.md) and
  [DECISION-008](DECISIONS.md#decision-008-extract-vnext-to-a-dedicated-repository).
- **Related issue:** [#536](https://github.com/jonathan-vella/apex/issues/536)
- **Mitigation:** Use issue branches and pull requests into this repository's `main`; keep the original APEX `main`
  untouched as the v1 line.
- **State:** Accepted
- **Closure proof:** Destination root commit, transferred issues, and source pull-request closure receipts.

### REGRESSION-001: Former CodeQL Parser Finding Uses An Approved Equivalent Review

- **Type:** `REGRESSION`
- **Owner:** Capabilities and security
- **Impact:** Native CodeQL evidence remains unavailable on the private GitHub Free repository; any new critical or high
  finding still blocks release.
- **Evidence:** The vulnerable expression was replaced by a bounded line-oriented parser with adversarial dual-track
  coverage. The maintainer explicitly accepted an independent exact-head review as the CodeQL equivalent on issue `#13`.
  That review was repeated after the final dependency change on
  `1f8db536fe0398f6575775d7794ba718234d3ef1` and found no critical, high, or release-blocking issue.
- **Related issue:** [#537](https://github.com/jonathan-vella/apex/issues/537)
- **Mitigation:** Preserve the bounded parser regression tests and repeat the approved equivalent review after any
  release-relevant source, workflow, generated-asset, or dependency change.
- **State:** Accepted
- **Closure proof:** Exact-main independent review, parser mutation tests, CI run `29822326665`, and the issue `#13`
  approval record.

### ISSUE-001: Supported VS Code Qualification Evidence Is Pending

- **Type:** `ISSUE`
- **Owner:** Release qualification
- **Impact:** Final promotion remains blocked even though the automated and cloud qualification gates have passed.
- **Evidence:** Bicep apply/destroy runs `29816381757` and `29817534614` and Terraform apply/destroy runs `29820944300`
  and `29821615776` all succeeded on attempt one with local exact-preview Gate 4, GitHub OIDC, one-hop authority transfer,
  returned authority, empty final inventories, and a restored `Disabled`/`Deny` backend. Fresh supported VS Code and
  cross-device evidence has not yet been recorded.
- **Related issue:** Destination issue `#9`.
- **Mitigation:** Run the supported-host handoff, question, hidden-worker, MCP startup, restart, and cross-device writer
  transfer checklist and bind the result to the final release-equivalent source boundary.
- **State:** Open
- **Closure proof:** Versioned manual qualification evidence with VS Code and extension versions, scenario outcomes, and
  evidence hashes.

## Closed Or Historical Entries

### ISSUE-002: Scorecard Sample Requirements Were Satisfied

- **Type:** `ISSUE`
- **Owner:** Quality engineering
- **Disposition:** Closed after release sampling collected 30 dual-track reports, 100 validation-mutation cases, 100
  capability cases, and 100 cache cases. Every frozen scorecard rule passed. The release-candidate workflow now reruns
  and compacts this evidence automatically whenever candidate inputs change.
- **Related issue:** [#542](https://github.com/jonathan-vella/apex/issues/542)
- **State:** Closed
- **Closure proof:** Candidate `860bb459f9ac2d5db1423f400382e0d9ebc8fd12`; qualification artifact SHA-256
  `00e6cc140eb9a221a7a47ea068f246498f7345de1614c83f41c217545619f769`; evaluation artifact SHA-256
  `c2bc086ab0014716ddfc02b8ca5ed86c8cb1169b3c5f1e38d17b535b534d5a3d`.

### DEFECT-001: CI Lint Resolved Unbuilt Generated Packages

- **Type:** `DEFECT`
- **Owner:** Validation and CI
- **Disposition:** Closed after CI build ordering and generated-import validation were aligned.
- **State:** Closed
- **Closure proof:** Exact-main CI run `29760571466` passed build, lint, validators, and deterministic tests on
  `e5509097aa7a1b9c389673a79ee7fbf7110de678`.

### DEFECT-002: vNext Documentation Broken Links Were Corrected

- **Type:** `DEFECT`
- **Owner:** Documentation
- **Disposition:** Closed after strict relative-link validation passed on the exact main candidate.
- **State:** Closed
- **Closure proof:** Exact-main docs run `29760571448` completed successfully on
  `e5509097aa7a1b9c389673a79ee7fbf7110de678`.

### DEFECT-003: Package Timeout Cleanup And Clean Install Were Repaired

- **Type:** `DEFECT`
- **Owner:** Release engineering
- **Disposition:** Closed after abort-aware process-tree termination, bounded diagnostics, and deterministic package
  installation coverage landed.
- **State:** Closed
- **Closure proof:** `npm run qualify:vnext` and all five package qualification tests passed on
  `e5509097aa7a1b9c389673a79ee7fbf7110de678`, including timeout cleanup and offline clean install.

### RISK-002: Terraform CI Plan Transport Is Not Qualified

- **Type:** `RISK`
- **Owner:** Terraform runtime
- **Disposition:** Closed after live encrypted apply and destroy through separate GitHub Actions jobs.
- **State:** Closed
- **Closure proof:** Destination issue `#10`; apply run `29583857856`; destroy run `29584406631`; exact recipient,
  digest, lineage, serial, owner epoch, expiry, authority return, and cleanup evidence.

### RISK-004: Required Environment Reviewers Were Unavailable On The Current GitHub Plan

- **Type:** `RISK`
- **Owner:** Repository maintainer
- **Evidence:** GitHub returned HTTP 422 for required-reviewer protection on the private repository.
- **Disposition:** Closed by [DECISION-010](DECISIONS.md#decision-010-keep-deployment-approval-in-apex-gate-4).
  External Environment review is not an APEX requirement; local Gate 4 owns exact-preview approval.
- **State:** Closed
- **Closure proof:** ADR-0002, rejection of CI-created approval, and exact post-approval transfer tests.

The approved v1 defect ledger remains in [phase-0a/v1-known-defects.md](phase-0a/v1-known-defects.md). Do not duplicate
or renumber those historical entries here. New vNext defects use this register and a linked GitHub issue.

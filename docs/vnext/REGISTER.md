## APEX vNext Register

This register contains high-signal release and project concerns. GitHub Issues own executable work state. Replace
`Pending` related-issue values with issue links during the GitHub bootstrap, and add closure proof before closing an
entry.

Allowed entry types are `RISK`, `ASSUMPTION`, `ISSUE`, `DEPENDENCY`, `DEFECT`, and `REGRESSION`.

## Open Entries

### RISK-001: Exact-Head Integration And Security Evidence Is Incomplete

- **Type:** `RISK`
- **Owner:** Release engineering
- **Impact:** Cutover and any baseline tag remain blocked.
- **Evidence:** Branch Enforcement run `29808356400`, docs run `29808356315`, CI run `29808356346`, and all frozen
  scorecard rules passed on `860bb459f9ac2d5db1423f400382e0d9ebc8fd12`. Later release-automation changes require a
  new exact-head run. Code scanning is disabled, so required CodeQL evidence is unavailable; the bounded independent
  review in [SECURITY-REVIEW.md](SECURITY-REVIEW.md) is not an approved substitute.
- **Related issue:** Destination issue `#13`.
- **Mitigation:** The release-candidate workflow now reruns deterministic, package, and scorecard qualification after
  every release-relevant candidate change. Complete a final security review and enable CodeQL or record an explicitly
  approved equivalent review before cutover.
- **State:** Open
- **Closure proof:** Required-check URLs showing success on the candidate SHA.

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

### REGRESSION-001: CodeQL Detects Polynomial ReDoS In IaC Generation

- **Type:** `REGRESSION`
- **Owner:** Capabilities and security
- **Impact:** High-severity security finding blocks cutover.
- **Evidence:** The vulnerable expression was replaced by a bounded line-oriented parser with adversarial dual-track
  coverage. Exact-main CI passes and the independent review found no unresolved high or critical issue, but code scanning
  is now disabled and alert #34 cannot be re-verified through a supported CodeQL run.
- **Related issue:** [#537](https://github.com/jonathan-vella/apex/issues/537)
- **Mitigation:** Enable CodeQL and verify alert closure, or obtain explicit maintainer approval for an equivalent review.
- **State:** Blocked
- **Closure proof:** Regression test, closed alert #34, and successful CodeQL check on the fixing SHA.

### ISSUE-001: Live Qualification Evidence Is Unavailable

- **Type:** `ISSUE`
- **Owner:** Release qualification
- **Impact:** VS Code, GitHub OIDC/transfer, Azure Bicep, and Azure Terraform release claims remain unavailable.
- **Evidence:** Azure bootstrap resources and secretless destination OIDC federation are deployed. The unprotected
  `vnext-qualification` Environment intentionally scopes OIDC/configuration only. Local exact-preview Gate 4 approval
  and imported CI apply are implemented but have no accepted exact-head live evidence.
- **Related issue:** Destination issue `#9`.
- **Mitigation:** Configure the remaining destination controls and follow
  [LIVE-QUALIFICATION.md](LIVE-QUALIFICATION.md). Record local approval, OIDC, one-hop authority transfer, exact apply,
  cleanup, and return evidence without claiming Environment review.
- **State:** Open
- **Closure proof:** Evidence index with candidate and dependency hashes for every required scenario.

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

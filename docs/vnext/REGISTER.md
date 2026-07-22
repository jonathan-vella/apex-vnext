## APEX vNext Register

This register contains high-signal release and project concerns. GitHub Issues own executable work state. Replace
`Pending` related-issue values with issue links during the GitHub bootstrap, and add closure proof before closing an
entry.

Allowed entry types are `RISK`, `ASSUMPTION`, `ISSUE`, `DEPENDENCY`, `DEFECT`, and `REGRESSION`.

## Open Entries

### RISK-001: Re-Baselined Promotion Evidence Is Incomplete

- **Type:** `RISK`
- **Owner:** Release engineering
- **Impact:** No prior receipt can authorize package publication, release tags, or cutover for the expanded contract.
- **Evidence:** Candidate `25530c339410e9758ae34538427f24bddfd83e1d` and its exact-main automation qualified the
  earlier contract. Current characterization base `1a1de02a3a17f496c713dd3c4e425c8df8d30d0e` follows the legacy-agent
  archive and the approved client, MCP, diagram, improvement, and bundle re-baseline.
- **Related issue:** Pending Milestone H issue.
- **Mitigation:** Select a new candidate only after Milestones H through O, then bind all deterministic, client,
  package, security, and live evidence to that exact commit and dependency set.
- **State:** Open
- **Closure proof:** A new exact-candidate dossier, passing receipt, and separate maintainer promotion decision.

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

### RISK-007: Public Visibility Exposes Operational Qualification Metadata

- **Type:** `RISK`
- **Owner:** Repository maintainer
- **Impact:** Git history, issues, pull requests, Actions logs, Azure subscription identifiers, resource names, policy
  evidence, and author email metadata become publicly readable and forkable.
- **Evidence:** A history-wide Gitleaks scan found no secret, but the repository intentionally retains canonical
  qualification journals and governance evidence. The maintainer reviewed and accepted this noncredential disclosure.
- **Related issue:** Destination issue `#13`.
- **Mitigation:** Delete transient live return/evidence artifacts before conversion, publish a confidential reporting
  policy, restrict Actions and fork execution, protect `main`, enable secret scanning and push protection, and run native
  CodeQL immediately after conversion.
- **State:** Accepted
- **Closure proof:** Public visibility, verified repository security settings, zero transient live artifacts, and native
  CodeQL run `29830116910` passing all configured languages with zero open alerts.

### RISK-008: Supported Copilot Clients Could Diverge

- **Type:** `RISK`
- **Owner:** Client experience
- **Impact:** VS Code and Copilot CLI could produce different workflow outcomes or expose different authority.
- **Evidence:** The previous contract qualified VS Code only. Copilot CLI `1.0.73` is selected and the shared matrix is
  defined, but neither client has run the re-baselined corpus.
- **Related issue:** [#91](https://github.com/jonathan-vella/apex-vnext/issues/91)
- **Mitigation:** Generate thin projections from one bundle contract and compare normalized typed outcomes,
  authorization denials, restart/resume behavior, and evidence hashes rather than UI mechanics.
- **State:** Open
- **Closure proof:** A passing two-client matrix on supported, version-recorded clients and the exact release candidate.

### RISK-009: ARM MCP Trust And Tool Shapes Could Drift

- **Type:** `RISK`
- **Owner:** Azure capabilities
- **Impact:** Authentication, tool-name, or response-shape drift could contaminate managed evidence or bypass policy.
- **Evidence:** Azure Resource Manager MCP is selected for bounded read evidence but has no qualified APEX adapter or
  pinned toolchain entry.
- **Related issue:** Pending Milestones I and K issues.
- **Mitigation:** Use typed read-allowlisted adapters, normalize versioned fixtures, reject unknown tools and shapes,
  and keep native Azure and IaC paths authoritative for mutation.
- **State:** Open
- **Closure proof:** Clean-environment startup, authentication, schema, fault, allowlist, and denial tests on the exact
  selected ARM MCP version.

### RISK-010: Replacement Surfaces Could Be Removed Too Early

- **Type:** `RISK`
- **Owner:** Runtime integration
- **Impact:** Removing Astro, Azure Pricing, Terraform, or Draw.io MCP surfaces before replacement proof could break
  supported workflows, packaging, documentation, or tests.
- **Evidence:** Retirement is approved in the roadmap, but replacement behavior is not yet implemented.
- **Related issue:** Pending Milestones I, K, and L issues.
- **Mitigation:** Inventory references and retire one surface at a time only after its named replacement gate passes;
  verify package contents and a clean consumer after each removal.
- **State:** Open
- **Closure proof:** Zero active references, passing replacement tests, and clean package/install evidence for every
  retired surface.

### RISK-011: Improvement Measurements Could Be Misleading

- **Type:** `RISK`
- **Owner:** Quality engineering
- **Impact:** Unbounded, sensitive, duplicated, or weakly attributed outcomes could create noisy proposals or false
  claims of improvement.
- **Evidence:** Existing observe-and-propose behavior is inert and characterized; structured outcome ingestion and
  comparative measurement are not implemented.
- **Related issue:** Pending Milestone M issue.
- **Mitigation:** Accept bounded structured outcomes only, retain provenance and redaction, define denominators and
  confidence explicitly, and keep all proposals human-decided.
- **State:** Open
- **Closure proof:** Passing redaction, deduplication, provenance, precision, recurrence, and no-mutation tests with a
  reviewed measurement report.

### RISK-012: Client Bundle Projections Could Drift

- **Type:** `RISK`
- **Owner:** Release engineering
- **Impact:** npm artifacts could diverge from `customizations/manifest.json` or generate unequal client capabilities.
- **Evidence:** npm remains the selected distribution channel, but the expanded two-client bundle has not been
  generated or qualified.
- **Related issue:** Pending Milestone N issue.
- **Mitigation:** Keep one canonical manifest, generate both projections deterministically, and test reproducibility,
  clean install, update, rollback, uninstall, package inventory, SBOM, and provenance.
- **State:** Open
- **Closure proof:** Byte-reproducible exact-candidate packages whose client projections pass parity and lifecycle tests.

### RISK-013: Guidance And Automation Consolidation Could Change Enforcement

- **Type:** `RISK`
- **Owner:** Developer experience and validation engineering
- **Impact:** Deduplication could change agent discovery, effective instructions, Markdown/artifact contracts, validator
  diagnostics or exits, hook failure propagation, required checks, workflow permissions, or release evidence.
- **Evidence:** [GUIDANCE-AUTOMATION-CHARACTERIZATION.md](GUIDANCE-AUTOMATION-CHARACTERIZATION.md) maps the distributed
  owners and reproduces the Markdown pre-commit wrapper reporting missing tooling while exiting successfully.
- **Related issue:** [#93](https://github.com/jonathan-vella/apex-vnext/issues/93)
- **Mitigation:** Complete the four-surface characterization before implementation; migrate independently by owner and
  require behavior, diagnostic, security, timing/context, rollback, and hosted-check parity.
- **State:** Open
- **Closure proof:** Issue #93 provides complete maps and gates; later Milestone N/O slices pass their characterized
  parity and removal tests on the exact candidate.

### ASSUMPTION-001: Both Copilot Clients Can Project One Workflow Contract

- **Type:** `ASSUMPTION`
- **Owner:** Client experience
- **Impact:** Failure would require a product-contract or projection redesign before release.
- **Evidence:** VS Code supports direct handoffs and `askQuestions`; Copilot CLI uses different delegation and input
  mechanics. Typed kernel outcomes and authority boundaries are intended to remain shared.
- **Related issue:** [#91](https://github.com/jonathan-vella/apex-vnext/issues/91)
- **Mitigation:** Characterize real supported clients, preserve client-specific interaction mechanics, and compare their
  normalized outcomes using one scenario corpus.
- **State:** Open
- **Closure proof:** Versioned two-client qualification evidence on the exact candidate head.

### ASSUMPTION-002: ARM MCP Can Supply Selected Read-Only Azure Evidence

- **Type:** `ASSUMPTION`
- **Owner:** Azure capabilities
- **Impact:** Unsupported evidence would remain on existing trusted CLI or provider paths rather than block all ARM MCP
  adoption.
- **Evidence:** The upstream integration is selected conceptually; its exact qualified version and usable tool set are
  not yet recorded.
- **Related issue:** Pending Milestone K issue.
- **Mitigation:** Discover and qualify only the evidence calls required by typed APEX contracts; do not expose direct
  upstream tools to managed creative agents.
- **State:** Open
- **Closure proof:** An approved adapter inventory with passing availability, authentication, schema, and fault tests.

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

### REGRESSION-001: Former CodeQL Parser Finding Is Clear In Native Analysis

- **Type:** `REGRESSION`
- **Owner:** Capabilities and security
- **Impact:** Any new critical or high native CodeQL finding blocks release.
- **Evidence:** The vulnerable expression was replaced by a bounded line-oriented parser with adversarial dual-track
  coverage. The approved equivalent review found no critical, high, or release-blocking issue. After public conversion,
  native CodeQL run `29830116910` passed all configured languages with no open alert.
- **Related issue:** [#537](https://github.com/jonathan-vella/apex/issues/537)
- **Mitigation:** Preserve the bounded parser regression tests and required native CodeQL checks on `main`.
- **State:** Accepted
- **Closure proof:** Parser mutation tests, exact-main CI, native CodeQL run `29830116910`, and zero open alerts.

### ISSUE-001: Supported Client Qualification Evidence Is Pending

- **Type:** `ISSUE`
- **Owner:** Release qualification
- **Impact:** Final promotion remains blocked until VS Code and Copilot CLI pass the expanded contract.
- **Evidence:** Earlier live Azure and package results remain historical. Copilot CLI `1.0.73` and the normalized matrix
  are recorded, but no parity result exists and the CLI is not globally installed in the current container.
- **Related issue:** [#91](https://github.com/jonathan-vella/apex-vnext/issues/91)
- **Mitigation:** Select real supported client versions, run the shared workflow and denial corpus, and bind outcomes to
  the new exact candidate and generated bundle hashes.
- **State:** Open
- **Closure proof:** Versioned VS Code and Copilot CLI evidence with scenario outcomes and evidence hashes.

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

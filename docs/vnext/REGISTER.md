# APEX vNext Risk And Assumption Register

Only unresolved or release-relevant items belong in this register. Closed implementation history is preserved by Git
and the repository archives.

## RISK-001: Client Behavior Can Drift Between Candidates

- **Owner:** Client experience
- **Impact:** Managed agents, input handling, MCP discovery, or routing may differ from deterministic projections.
- **Mitigation:** Bind observed client versions and hashes; run the complete client matrix on the exact candidate.
- **State:** Open
- **Closure proof:** Current VS Code and Copilot CLI evidence satisfies [CLIENT-QUALIFICATION.md](CLIENT-QUALIFICATION.md).

## RISK-002: Live Cloud Behavior Can Differ From Deterministic Providers

- **Owner:** Platform operations
- **Impact:** Bicep or Terraform could fail policy, provider, state, preview, apply, inventory, or cleanup checks.
- **Mitigation:** Use isolated targets, current governance and availability evidence, exact previews, bounded credentials,
  and owned cleanup.
- **State:** Open
- **Closure proof:** Candidate-bound Bicep and Terraform live qualification both pass.

## RISK-003: Package Or Supply-Chain Drift Can Invalidate Qualification

- **Owner:** Release engineering
- **Impact:** Registry, lockfile, generated assets, SBOM, or package contents may differ from reviewed source.
- **Mitigation:** Exact locks, reproducible pack tests, clean installation, source/generated validation, CodeQL, secret
  scanning, SBOM, and provenance.
- **State:** Open until release
- **Closure proof:** Exact-head package and security evidence is included in the release receipt.

## RISK-004: Documentation Can Overstate Support

- **Owner:** Documentation and product maintainers
- **Impact:** Users may treat implementation, historical evidence, or local tests as production qualification.
- **Mitigation:** Generate support/reference data where possible; distinguish implemented, deterministic, client, live,
  and release evidence; validate navigation and stale references.
- **State:** Open until release
- **Closure proof:** Documentation inventory is complete and every blocking claim links to current authority.

## RISK-005: Approval Or Handoff Evidence Can Become Stale

- **Owner:** Kernel and operations
- **Impact:** A changed dependency, writer, recipient, target, plan, or TTL could authorize the wrong operation.
- **Mitigation:** Fail closed on hash, epoch, recipient, sequence, expiry, and dependency mismatch; regenerate and
  reapprove stale previews.
- **State:** Open by design
- **Closure proof:** Deterministic adversarial tests and live transfer scenarios pass on the candidate.

## ASSUMPTION-001: Supported Clients Can Share Typed Outcomes

- **Owner:** Client experience
- **Assumption:** VS Code and Copilot CLI can produce equivalent kernel outcomes for their shared supported interactions.
- **Constraint:** Copilot CLI autonomous workers remain omitted and unavailable scenarios cannot be inferred as passing.
- **State:** Pending current-candidate proof

## ASSUMPTION-002: Equal IaC Support Means Equivalent Governed Outcomes

- **Owner:** IaC maintainers
- **Assumption:** Bicep and Terraform can share requirements, intent, gates, evidence, and inventory contracts while using
  different native mechanics.
- **Constraint:** Equality does not require identical commands, state models, preview TTLs, or provider metadata.
- **State:** Deterministically supported; live proof pending

## Release Rule

No open risk is silently waived. A release-blocking item must be closed by evidence or accepted through an explicit,
auditable maintainer decision that names scope, rationale, owner, expiry, and rollback.

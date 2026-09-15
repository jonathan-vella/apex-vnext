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
- **Mitigation:** Use isolated targets, target governance, exact previews, bounded credentials and owned cleanup.
  Quota and availability remain assumptions; report native failures and obtain approval for corrections.
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

## RISK-006: Imported Material Can Carry Wrong Authority

- **Owner:** COE reuse and kernel maintainers
- **Impact:** Copied policy, approvals, state, secrets or instructions could be mistaken for consumer authority.
- **Mitigation:** Record origin/revision, import selected reusable content only, confirm recovered intent, and refresh
  target governance and approval. Do not execute repository content during discovery.
- **State:** Open
- **Closure proof:** Import/adaptation tests reject source authority and preserve independent consumer ownership.

## RISK-007: Profiles Can Confuse Resource Ownership

- **Owner:** Workload planning and operations
- **Impact:** A workload could modify shared ALZ resources or a lab could bypass policy by assuming an empty baseline.
- **Mitigation:** Explicit profiles, supplied-resource defaults outside labs, evidenced policy results and owned cleanup.
- **State:** Open
- **Closure proof:** Both tracks protect platform references and support standalone policies through the same workflow.

## RISK-008: Reuse Can Lose Quality Or User Edits

- **Owner:** Artifacts and project adaptation
- **Impact:** Generated documents become shallow, contradictory, stale or overwrite manually maintained content.
- **Mitigation:** One owner per fact, retained decision rationale, affected-output regeneration and conflict confirmation.
- **State:** Open
- **Closure proof:** Human review against the PRD quality reference plus selective-update and conflict tests.

## RISK-009: Distribution Can Split Runtime And Guidance

- **Owner:** Release engineering and client experience
- **Impact:** A plugin update could launch the wrong MCP runtime, select the wrong workspace or alter an active run.
- **Mitigation:** Evaluate distribution last; pin compatible components, preserve state and avoid competing updaters.
- **State:** Open; final distribution option not selected
- **Closure proof:** Final delivery lifecycle passes in both clients on WSL2, including rollback and uninstall.

## RISK-010: Revised Plans Can Outrun Executable Controls

- **Owner:** Repository maintainers
- **Impact:** Older optimization, guidance or release validators may block the new delivery order or overstate support.
- **Mitigation:** Keep current checks intact; align affected owners in focused tested changes, not fabricated receipts.
- **State:** Open
- **Closure proof:** Required checks reflect the accepted scope and documentation distinguishes targets from implementation.

## RISK-011: Task Context Can Select Obsolete Or Incomplete Inputs

- **Owner:** CLI/kernel and contracts maintainers
- **Impact:** Historical completion hashes can precede replacement intent, while a review-subject alias mismatch can
  reject a valid bounded read. Unscoped context also adds irrelevant evidence and repeated loading.
- **Mitigation:** Complete the first roadmap batch using accepted-revision selection, canonical review-kind mapping,
  bounded task/reviewer packs and request-local reuse without weakening integrity or freshness checks.
- **State:** Open; source review and isolated probes identified the defects, implementation remains pending
- **Closure proof:** Workflow, dependency-revision and reader tests cover invalidation, replacement intent in both IaC
  tracks, all review subjects, large/multibyte inputs and stale ownership/expiry; deterministic qualification passes.

## RISK-012: Optimization Can Weaken Review Or Client Boundaries

- **Owner:** Managed customization and client experience maintainers
- **Impact:** Tool removal, shared-only safety guidance, unsupported MCP representation or worker shortcuts can lose
  required outcomes. Smaller prompts or files alone do not demonstrate preserved reasoning or reduced model cost.
- **Mitigation:** Follow the roadmap dispositions, retain all four review passes and domain-specific checklists, and
  verify required-tool coverage in both projections. Preserve compatible responses and the CLI hidden-worker boundary.
- **State:** Open
- **Closure proof:** Changed guidance and projections pass consumer/contract tests; behavior changes have authorized
  exact-client evidence, and no unsupported token-saving, review-completion or parity claim is made.

## ASSUMPTION-001: Supported Clients Can Share Typed Outcomes

- **Owner:** Client experience
- **Assumption:** VS Code and Copilot CLI can produce equivalent kernel outcomes for their shared supported interactions.
- **Constraint:** Copilot CLI autonomous workers remain omitted; required generation/review/validation outcomes still
  need a supported path. Unavailable mechanics cannot be inferred as passing.
- **State:** Pending current-candidate proof

## ASSUMPTION-002: Equal IaC Support Means Equivalent Governed Outcomes

- **Owner:** IaC maintainers
- **Assumption:** Bicep and Terraform can share requirements, intent, gates, evidence, and inventory contracts while using
  different native mechanics.
- **Constraint:** Equality does not require identical commands, state models, preview TTLs, or provider metadata.
- **State:** Deterministically supported; live proof pending

## ASSUMPTION-003: Quota And Regional Availability

- **Owner:** Workload architect and consumer
- **Assumption:** Selected services/SKUs are available with sufficient quota in the requested region.
- **Constraint:** This is intentional, not an Architecture evidence gate. Policy still wins, and actual deployment
  failures require visible recovery or approved design changes. No successful deployment or capacity claim is inferred.
- **State:** Accepted product behavior

## Release Rule

No open risk is silently waived. A release-blocking item must be closed by evidence or accepted through an explicit,
auditable maintainer decision that names scope, rationale, owner, expiry, and rollback.

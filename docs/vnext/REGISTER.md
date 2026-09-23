# APEX vNext Risk And Assumption Register

Only unresolved or release-relevant items belong in this register. Closed implementation history is preserved by Git
and the repository archives.

## RISK-001: Client Behavior Can Drift Between Candidates

- **Owner:** Client experience
- **Impact:** Managed agents, input handling, MCP discovery, or routing may differ from deterministic projections.
- **Mitigation:** Bind observed client versions and hashes; run the complete client matrix on the exact candidate.
- **State:** Open
- **Closure proof:** Exact-candidate standalone Copilot CLI and VS Code Copilot harness evidence satisfies
  [CLIENT-QUALIFICATION.md](CLIENT-QUALIFICATION.md). The slice 1 probes only characterize the clients, and the harness
  cannot qualify until picked agents apply.

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

### Governance Snapshot Freshness

- **Owner:** Governance and kernel maintainers
- **Impact:** Azure policy can change while a snapshot remains eligible for reuse below 30 days; collection failures or
  timestamp churn can also masquerade as fresh policy or invalidate unchanged plans unnecessarily.
- **Mitigation:** Apply [REQ-GOV-001](PRD.md#req-gov-001-governance-and-policy), display observation age, separate content
  identity from freshness, fail closed at 30 days, and preserve live enforcement without bypassing policy on denial.
- **State:** Open; distribution, persisted choices and unchanged renewal have deterministic coverage; consumer OIDC
  setup, live collection, material reconciliation and exact-client interaction still require qualification
- **Closure proof:** Both tracks cover exact age boundaries, unchanged refresh, material drift and delayed outcomes.

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
  verify required-tool coverage in both projections. Preserve compatible responses, kernel authority and scoped worker
  grants; hidden-profile flags are not authentication.
- **State:** Open
- **Closure proof:** Changed guidance and projections pass consumer/contract tests; behavior changes have authorized
  exact-client evidence, and no unsupported token-saving, review-completion or parity claim is made.

## RISK-013: MCP Wire Contracts Can Hide Recovery Or Reject Results

- **Owner:** CLI adapter and client experience maintainers
- **Impact:** SDK-incompatible results fail after work runs; missing error codes impede safe recovery. A protocol
  upgrade or misleading read-only metadata can change permission, retry and freshness behavior.
- **Mitigation:** Implement [REQ-MCP-001](PRD.md#req-mcp-001-predictable-tool-contracts) in the roadmap order. Preserve
  stdio, explicit tools, stable errors and kernel authority; migrate protocol versions separately.
- **State:** Open for exact-client evidence; all-tool schema, safe-error, input-boundary, queue/cancellation and real
  stdio regressions cover the current SDK. Protocol migration is separately pending.
- **Closure proof:** All registered results validate, cancellation/retry tests preserve committed-state semantics,
  and both supported clients have evidence for the exact negotiated protocol and candidate.

## RISK-014: Retiring The VS Code Local Projection Can Strand Consumers Or Lose Mechanics

- **Owner:** Client experience and CLI lifecycle maintainers
- **Impact:** Existing VS Code installations lose their managed agents. Handoff buttons, native multi-select, per-parent
  agent allowlists and `.vscode/mcp.json` servers disappear, and the VS Code Agent Host does not forward servers that
  need interactive `${input:...}` values.
- **Mitigation:** Apply [DECISION-029](DECISIONS.md#decision-029-ship-one-copilot-cli-projection) through DECISION-015
  gates. Retired client values fail normal validation; per maintainer direction there is no migration path. Replace
  handoffs with `apex-next`, multi-select with native checkboxes or kernel-validated numbered selection, and allowlists
  with kernel task ownership and scoped tools. The archive under `.archive/vscode-projection/` records rollback notes,
  stays out of packaging, and `retired-paths.v1.json` keeps the former live paths absent.
- **State:** Open; in progress on `feat/cli-projection`
- **Closure proof:** Rejection and reintroduction tests pass, archive provenance and rollback notes are recorded, and
  standalone CLI and VS Code Copilot harness qualification passes on the same candidate.

## RISK-015: Built-In Helper Output Can Be Mistaken For Evidence

- **Owner:** Managed customization and kernel maintainers
- **Impact:** Explore, Rubber-duck, Code-review, Security-review, built-in Task or Research output could be treated as
  review completion, validation evidence or approval. Built-in models are set per user and add cost.
- **Mitigation:** Keep helpers advisory. Managed agents use only Explore, which receives just `view`, `glob` and
  `rg`. Rubber-duck, Code-review and Security-review inherit the caller's APEX completion and disposition tools, so
  they stay out until the CLI scopes helper tools. Validator has no shell. The owning APEX agent restates findings as
  typed kernel input with verified file and line references. The kernel continues to reject unexecuted or simulated
  evidence. Document per-user model overrides.
- **State:** Open; in progress on `feat/cli-projection`
- **Closure proof:** Projection tests cover helper grants, negative tests show helper output alone cannot complete a
  task or open a gate, and CLI probes cover each granted helper path. Slice 6 covers Explore; the other helpers need
  CLI tool scoping first.

## ASSUMPTION-001: Supported Clients Can Share Typed Outcomes

### Active Scope And CLI Worker Evidence

As of 2026-09-23, DECISION-029 makes standalone Copilot CLI and the VS Code Copilot harness the target release clients,
both running one CLI projection. Since slice 4, `apex init` installs only that projection. Desktop-app
work is [deferred](ROADMAP.md#deferred-standalone-copilot-desktop-app); preserve its evidence without inferring CLI
parity. CLI CodeGen, Reviewer and Validator ship since adapter `1.6.0` under revised ADR-0006; kernel checks, not
profile visibility, remain the security boundary. This does not authenticate independent reviewers or qualify every
production worker path.
Owner: client experience and kernel maintainers. Closure requires actual generation/review/validation and parent-routing
evidence with unchanged scoped permissions. Generic delegation and visibility-only probes are not closure.

- **Owner:** Client experience
- **Assumption:** Standalone Copilot CLI and the VS Code Copilot harness produce equivalent kernel outcomes from the same
  CLI-format agents.
- **Constraint:** Shared agent format does not prove Agent Host behavior; the VS Code Copilot harness is qualified
  separately. Unavailable mechanics cannot be inferred as passing.
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

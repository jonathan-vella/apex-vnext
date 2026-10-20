# APEX vNext Risk And Assumption Register

Only unresolved or release-relevant items belong in this register. Closed implementation history is preserved by Git
and the repository archives.

## RISK-001: Client Behavior Can Drift Between Candidates

- **Owner:** Client experience
- **Impact:** Managed agents, input handling, MCP discovery, or routing may differ from deterministic projections.
- **Mitigation:** Bind observed client versions and hashes; run the complete client matrix on the exact candidate.
- **State:** Open
- **Closure proof:** Exact-candidate standalone Copilot CLI and VS Code Copilot harness evidence satisfies
  [CLIENT-QUALIFICATION.md](CLIENT-QUALIFICATION.md). The slice 1 probes only characterize the clients, and the
  harness cannot qualify until picked agents apply.

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
- **Mitigation:** Exact locks, reproducible pack tests, clean installation, source/generated validation, CodeQL,
  secret scanning, SBOM, and provenance.
- **State:** Open until release
- **Closure proof:** Exact-head package and security evidence is included in the release receipt.

## RISK-004: Documentation Can Overstate Support

- **Owner:** Documentation and product maintainers
- **Impact:** Users may treat implementation, historical evidence, or local tests as production qualification, or read
  contradictory status claims across root and project-control documents.
- **Mitigation:** Generate support/reference data where possible; distinguish implemented, deterministic, client,
  live, and release evidence; validate navigation and stale references; reconcile cross-document drift identified in
  [AUDIT-REPORT.md](AUDIT-REPORT.md) (`F-006`, `F-017`).
- **State:** Open until release
- **Closure proof:** Documentation inventory is complete, cross-document contradictions (`F-006`, `F-017`) are
  resolved, and every blocking claim links to current authority.

## RISK-005: Approval Or Handoff Evidence Can Become Stale

- **Owner:** Kernel and operations
- **Impact:** A changed dependency, writer, recipient, target, plan, or TTL could authorize the wrong operation.
- **Mitigation:** Fail closed on hash, epoch, recipient, sequence, expiry, and dependency mismatch; regenerate and
  reapprove stale previews.
- **State:** Open by design
- **Closure proof:** Deterministic adversarial tests and live transfer scenarios pass on the candidate.

### Purpose-Bound Approval Transition

- **Owner:** Kernel, product and operations maintainers
- **Impact:** A lab purpose could authorize a production target, a CI triggering identity could be mistaken for an
  approving human, or a generated setup kit could be mislabeled production-ready.
- **Mitigation:** Implement ADR-0007 through CP-26 to CP-30; keep current checks until replacements pass. Confirm
  purpose independently of foundation, validate candidate-bound human approval before apply and protect CI artifacts.
  Unsupported consumer approval controls block production with guidance.
- **State:** Accepted design; implementation and qualification pending
- **Closure proof:** Wrong-purpose, wrong-reviewer/run/attempt/target, replay, expiry and artifact-substitution tests,
  plus exact-candidate separately authorized live readiness and cleanup evidence. Non-production release claims remain
  distinct from deferred production acceptance.

### Governance Snapshot Freshness

- **Owner:** Governance and kernel maintainers
- **Impact:** Azure policy can change while a snapshot remains eligible for reuse below 30 days; collection failures
  or timestamp churn can also masquerade as fresh policy or invalidate unchanged plans unnecessarily.
- **Mitigation:** Apply [REQ-GOV-001](PRD.md#req-gov-001-governance-and-policy), display observation age, separate
  content identity from freshness, fail closed at 30 days, and preserve live enforcement without bypassing policy on
  denial.
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
- **Mitigation:** Explicit profiles, supplied-resource defaults outside labs, evidenced policy results and owned
  cleanup.
- **State:** Open
- **Closure proof:** Both tracks protect platform references and support standalone policies through the same
  workflow.

## RISK-008: Reuse Can Lose Quality Or User Edits

- **Owner:** Artifacts and project adaptation
- **Impact:** Generated documents become shallow, contradictory, stale or overwrite manually maintained content.
- **Mitigation:** One owner per fact, retained decision rationale, affected-output regeneration and conflict
  confirmation.
- **State:** Open
- **Closure proof:** Human review against the PRD quality reference plus selective-update and conflict tests.

## RISK-009: Distribution Can Split Runtime And Guidance

- **Owner:** Release engineering and client experience
- **Impact:** A plugin update could launch the wrong MCP runtime, select the wrong workspace or alter an active run.
- **Mitigation:** DECISION-033 selects one Agent Plugin with the bundled runtime, pinned to a commit SHA and installed
  through one channel; `apex init` writes only the thin projection. Preserve state and avoid competing updaters.
- **State:** Open; plugin package and thin `apex init` projection implemented (`0.11.0-next.5`); supported-client
  lifecycle qualification pending
- **Closure proof:** The plugin lifecycle (install, update, rollback, uninstall) passes in all three supported clients
  on their hosts without disturbing an active run.

## RISK-010: Revised Plans Can Outrun Executable Controls

- **Owner:** Repository maintainers
- **Impact:** Older optimization, guidance or release validators may block the new delivery order or overstate
  support.
- **Mitigation:** Keep current checks intact; align affected owners in focused tested changes, not fabricated
  receipts.
- **State:** Open
- **Closure proof:** Required checks reflect the accepted scope and documentation distinguishes targets from
  implementation.

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
- **Mitigation:** Implement [REQ-MCP-001](PRD.md#req-mcp-001-predictable-tool-contracts) in the roadmap order.
  Preserve stdio, explicit tools, stable errors and kernel authority; migrate protocol versions separately.
- **State:** Open for exact-client evidence; SDK v2 and `2026-07-28` protocol migration (`DECISION-034`, `CP-23`) are
  implemented with all-tool schema, safe-error, input-boundary, queue/cancellation and real stdio regressions.
- **Closure proof:** All registered results validate, cancellation/retry tests preserve committed-state semantics, and
  all three supported clients have evidence for the exact negotiated protocol and candidate.

## RISK-014: Retiring The VS Code Local Projection Can Strand Consumers Or Lose Mechanics

- **Owner:** Client experience and CLI lifecycle maintainers
- **Impact:** Existing VS Code installations lose their managed agents. Handoff buttons, native multi-select,
  per-parent agent allowlists and `.vscode/mcp.json` servers disappear, and the VS Code Agent Host does not forward
  servers that need interactive `${input:...}` values.
- **Mitigation:** Apply [DECISION-029](DECISIONS.md#decision-029-ship-one-copilot-cli-projection) through DECISION-015
  gates. Retired client values fail validation with reason `CLIENT_PROJECTION_RETIRED`; there is no automatic
  migration, and only an explicit `apex init --client github-copilot-cli` swaps the managed files. Replace handoffs
  with `apex-next`, multi-select with native checkboxes or kernel-validated numbered selection, and allowlists with
  kernel task ownership and scoped tools. The archive under [archive catalog](../../.archive/CATALOG.json) (entry
  `.archive/vscode-projection/ROLLBACK.md`) records rollback notes, stays out of packaging, and
  `retired-paths.v1.json` keeps the former live paths absent.
- **State:** Open; standalone CLI partially qualified in slice 11; VS Code harness blocked on WSL
- **Closure proof:** Rejection and reintroduction tests pass, archive provenance and rollback notes are recorded, and
  standalone CLI and VS Code Copilot harness qualification passes on the same candidate.

## RISK-015: Built-In Helper Output Can Be Mistaken For Evidence

- **Owner:** Managed customization and kernel maintainers
- **Impact:** Explore, Rubber-duck, Code-review, Security-review, built-in Task or Research output could be treated as
  review completion, validation evidence or approval. Built-in models are set per user and add cost.
- **Mitigation:** Keep general helpers advisory. Under
  [DECISION-031](DECISIONS.md#decision-031-replace-the-apex-reviewer-with-captured-rubber-duck-reviews) (`CP-16`),
  `rubber-duck` performs the requirements, architecture and plan reviews with `postToolUse` output capture,
  `preToolUse` mutation denial, and kernel `APEX_REVIEW_PENDING` guards (`F-003` tracks centralizing the MCP dispatch
  guard). Explore remains read-only (`view`, `glob`, `rg`); Code-review and Security-review stay out of managed
  workflows. Validator has no shell. The kernel continues to reject unexecuted or simulated evidence.
- **State:** Open; deterministic hook/capture/guard tests pass; supported-client qualification pending (`CLIENT-024`,
  `CLIENT-033`)
- **Closure proof:** Projection and hook tests cover helper grants and rubber-duck capture/denial, negative tests show
  uncaptured helper output alone cannot complete a task or open a gate, and supported-client qualification passes on
  the exact candidate.

## RISK-016: External Azure MCP Server Dependency Can Weaken Offline Guarantees Or Pricing Completeness

- **Owner:** MCP adapter and managed customization maintainers
- **Impact:** Introducing the official Azure MCP Server
  ([DECISION-038](DECISIONS.md#decision-038-introduce-azure-mcp-server-3-as-a-managed-azure-tool-provider),
  [CP-31](https://github.com/jonathan-vella/apex-vnext/issues/489)) adds an external, separately versioned dependency
  whose `npx` cold install may download/cache platform packages, which could be confused with or silently weaken
  APEX's own bundled-plugin offline-startup guarantee (`CLIENT-029`). Separately, its GA pricing capability silently
  caps results at 5,000 rows with no continuation or completeness field, so a capped response could be mislabeled
  complete. A floating `@azure/mcp@latest`/`@3`/`@3.x` dependency could also drift behavior/schemas without a
  corresponding APEX release.
- **Mitigation:** Document and qualify the external server's install/cache/discovery lifecycle separately from
  CLIENT-029 per supported client. Record and test an exact pinned `3.y.z` version in a tracked dependency manifest
  rather than a floating range; require focused discovery/schema/grant tests on updates. Never report a capped pricing
  response as complete; preserve timestamps, source and uncertainty on every pricing result.
- **State:** Open; IMPLEMENTED LOCAL with local qualification stages passing after restoring jq; final-head CI and
  human client/authenticated Azure qualification pending
- **Closure proof:** CP-31 ships discovered real tool/schema evidence, an exact version pin in a tracked manifest,
  cap-aware pricing handling with a passing regression, and per-client dependency-lifecycle documentation distinct
  from CLIENT-029, before any qualification or release claim.

## RISK-017: Runtime, Workflow, Renderer, And Validator Edge-Case Gaps Identified In End-To-End Audit

- **Owner:** Kernel, CLI, renderer and tooling maintainers
- **Impact:** Concurrent `prepare-assets.mjs` runs can delete a newly acquired lock after an expired-lock TOCTOU race
  (`F-001`); rejected human gates record `state: "rejected"` without mapping to the workflow's `approval-rejected`
  blocked state (`F-002`); `MCP_TOOL_REVIEW_GUARDS` relies on manual `service.ts` calls rather than central MCP
  dispatch enforcement (`F-003`); duplicate `(metric, scenario)` scorecard measurements overwrite silently (`F-004`);
  `fetch-azure-deprecations.mjs` exits `0` on unhandled rejections (`F-005`); `WorkflowEngine` ignores edge `event`
  and `edgeSelection` metadata (`F-007`); `apex-next` omits explicit `user-invocable` frontmatter (`F-014`); and
  validator-graph CI consumer checks rely on substring matching (`F-015`). See [AUDIT-REPORT.md](AUDIT-REPORT.md).
- **Mitigation:** Execute the four remediation slices in
  [AUDIT-REPORT.md](AUDIT-REPORT.md#prioritized-remediation-plan-and-closure-proof): atomic lock quarantine in
  `prepare-assets.mjs`, explicit `approval-rejected` routing, centralized MCP review-pending enforcement,
  duplicate-measurement rejection in `scorecard.ts`, non-zero error exit in `fetch-azure-deprecations.mjs`, explicit
  `user-invocable: true` on `apex-next`, and YAML-parsed validator consumer checks.
- **State:** Closed for this audit scope: remediation merged in
  [#496](https://github.com/jonathan-vella/apex-vnext/pull/496) at `4ccd5d80` and post-merge hosted checks passed.
  [CP-32](https://github.com/jonathan-vella/apex-vnext/issues/495) is closed; live-client and release acceptance remain
  separate.
- **Closure proof:** Focused unit/validator regressions, `npm run validate:_node-core`, and `npm run qualify:vnext`
  pass with all 22 findings in [AUDIT-REPORT.md](AUDIT-REPORT.md) resolved and the `skill-validation-baseline.json`
  suppression removed.

## ASSUMPTION-001: Supported Clients Can Share Typed Outcomes

### Active Scope And CLI Worker Evidence

As of 2026-10-05, DECISION-033 makes the VS Code Copilot harness and the GitHub Copilot app on native Windows and
Copilot CLI on Linux and WSL2 the target release clients, delivered as one Agent Plugin with a thin `apex init`
workspace projection (`0.11.0-next.5`). Historical desktop probes remain provenance
([superseded plan](ROADMAP.md#superseded-standalone-copilot-desktop-plan)) and do not show CLI parity. One foreground
`APEX` agent and hidden `APEX CodeGen` and `APEX Validator` workers ship under DECISION-032 and revised ADR-0006,
while captured `rubber-duck` reviews replace `APEX Reviewer` (DECISION-031); kernel checks, not profile visibility,
remain the security boundary. This does not authenticate independent reviewers or qualify every production worker
path. Owner: client experience and kernel maintainers. Closure requires actual generation/review/validation and
parent-routing evidence with unchanged scoped permissions. Generic delegation and visibility-only probes are not
closure.

- **Owner:** Client experience
- **Assumption:** The VS Code Copilot harness and the GitHub Copilot app on native Windows and Copilot CLI on Linux
  and WSL2 produce equivalent kernel outcomes from the same plugin agents.
- **Constraint:** A shared plugin does not prove per-client behavior; each client and host is qualified separately.
  Unavailable mechanics cannot be inferred as passing.
- **State:** Pending current-candidate proof

## ASSUMPTION-002: Equal IaC Support Means Equivalent Governed Outcomes

- **Owner:** IaC maintainers
- **Assumption:** Bicep and Terraform can share requirements, intent, gates, evidence, and inventory contracts while
  using different native mechanics.
- **Constraint:** Equality does not require identical commands, state models, preview TTLs, or provider metadata.
- **State:** Deterministically supported; live proof pending

## ASSUMPTION-003: Quota And Regional Availability

- **Owner:** Workload architect and consumer
- **Assumption:** Selected services/SKUs are available with sufficient quota in the requested region.
- **Constraint:** This is intentional, not an Architecture evidence gate. Policy still wins, and actual deployment
  failures require visible recovery or approved design changes. No successful deployment or capacity claim is
  inferred.
- **State:** Accepted product behavior

## Release Rule

No open risk is silently waived. A release-blocking item must be closed by evidence or accepted through an explicit,
auditable maintainer decision that names scope, rationale, owner, expiry, and rollback.

Historical archive entries are indexed in the [catalog](../../.archive/CATALOG.json); the
[restore guide](../../.archive/RESTORE.md) grants no runtime, release or deployment authority.

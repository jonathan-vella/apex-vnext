# APEX vNext Checkpoint

- **Updated:** 2026-09-16
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

- Complete the [MCP contract follow-up](ROADMAP.md#mcp-contract-follow-up). The 2026-09-18 review reproduced invalid
  string/list results under SDK 1.29.0 and loss of stable error codes. All 34 tools now have output contracts, strict
  arguments and conservative annotations. Read-only status, bounded serialized dispatch, cancellation/expiry recovery,
  all-handler tests and real stdio negotiation are implemented. Exact VS Code/Copilot CLI validation remains pending;
  July 2026 protocol migration and kernel-enforced user stop scopes remain separate design work.
- The completed MCP server follow-up passed `qualify:vnext` on 2026-09-18, including 143 validator tests and
  29 packaging tests. Focused tests cover every registered handler and real stdio initialization/status/exit. This
  evidence does not replace manual interaction tests in the supported clients, whose installed candidates are unchanged.
- Complete the [first optimization batch](ROADMAP.md#first-batch-input-correctness-and-scope): revision-safe reads,
  bounded context/reviewer packs, stage criteria/dispositions and routing/tool scope have implementation and focused
  tests. Exact-client checks remain pending. Scoped prompt inspection found no further safe deletion.
- Complete issue #344's nonempty-policy enforcement through planning and native code validation. Path-only import,
  standalone collection and evidenced-empty import-to-simulated-deployment tests exist for both tracks. Native apply
  previews check concrete policy values against compiled Bicep/saved Terraform plans with source-bound receipts;
  native top-level ownership checks reject foreign mutations; AVM child-resource identity and earlier code-validation
  integration remain open.
- Implement and qualify COE import, provenance, relevant change questions, manual-edit conflicts and selective
  regeneration using existing contracts and parameters.
- Complete design/ADR and operational/as-built output against the PRD quality checklist.
- Close both-client lifecycle gaps on WSL2 in both profiles; generated projections do not prove complete outcomes.
- Evaluate Agent Plugins and APEX MCP redistribution after features work; npm remains the current implementation.
- Complete exact-candidate live qualification for supported client interactions.
- Complete separately authorized Bicep and Terraform cloud qualification.
- Bind target governance, pricing, security and cleanup evidence. Quota and availability remain assumptions.
- Select an exact release candidate only after all blocking evidence is current.
- Publication, tags, releases, deployment and cutover have conditional maintainer authorization as recorded below;
  required evidence, protected checks and operation-specific approval contracts remain mandatory.

GitHub Issues and the repository project own day-to-day work selection. [ROADMAP.md](ROADMAP.md) owns dependency order;
[REGISTER.md](REGISTER.md) owns unresolved risks; [PRD.md](PRD.md) owns acceptance.

## Evidence Status

On 2026-09-18, candidate `2e5d004` completed a bounded VS Code Local intake/context/stop and reload/status check.
Local and Azure telemetry matched the tool sequence and the journal preserved the stop boundary; the run used
Allow all, so this is not evidence for manual permission prompts or full lifecycle parity. The paired CLI test
invoked Requirements through background `task` delegation but neither asked native questions nor recorded answers.
That failed workspace's first request remains pending and is preserved as reproduction evidence. The CLI projection
now routes interactive roles through foreground selection.

Candidate `379ed96` passed the bounded foreground CLI retry: native questions, three uniquely recorded intake panels,
one Requirements task and a final task-context read, with no completion/review/approval afterward. The user confirmed
the first repeated question followed an accidental cancellation. Restart produced one status call and preserved run
`542a9681-4ee2-4932-8ae3-94ea6f956d9f`, owner epoch 1 and journal head
`cf87a2d45439a0bbde131f7cfe4e4309874c8fa0a7b2a4c53be3a05c672e1173`; all gates remained closed. Local and Azure
records corroborated intake; the restart trace was local-only at assessment time. Telemetry lacks explicit APEX
run/task attributes, so journal checks supply those identities. An additional final-panel question was observed;
its content was not captured and is not classified as a defect. These different VS Code/CLI candidates do not establish
same-candidate parity, manual permission prompting, automatic CLI handoff, or complete lifecycle qualification.

| Evidence                                                       | Status                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| Contract, kernel, capability, renderer, CLI, and package tests | Required on every candidate                               |
| Clean package installation                                     | Required and deterministic                                |
| Managed projection generation and lifecycle                    | Implemented and tested                                    |
| VS Code live client outcomes                                   | Current candidate pending                                 |
| Copilot CLI live client outcomes                               | Current candidate pending with autonomous-worker omission |
| Bicep live Azure outcomes                                      | Current candidate pending                                 |
| Terraform live Azure outcomes                                  | Current candidate pending                                 |
| Release authority                                              | Conditional authorization; acceptance evidence pending    |

Only exact-candidate evidence satisfies current gates.

## Active Delivery Authorization

On 2026-09-16 the maintainer authorized autonomous roadmap delivery, takeover of issue #344, commits, PRs, protected
merges and publication after release acceptance. No protections, approval contracts or credential permissions may be
bypassed. Manual VS Code and Copilot CLI/app tests remain maintainer actions. Live qualification is limited to isolated
run-owned resources in the authenticated non-production `apex-shared` subscription; pre-existing resources are protected.

The authorized spending window is 2026-09-16 00:00 UTC through 2026-09-30 00:00 UTC, with a USD 2,000 total-subscription
ceiling and USD 400 reserve. Stop new provisioning at USD 1,600 estimated accrued spend or earlier projected overrun.
Both requested email recipients are configured on the qualification budget, with actual thresholds 50/75/80/90/100%
and forecast thresholds 80/100%. Email receipt is unverified. Azure requires a month-start budget; its September scope
is more conservative than the authorized window. Budget alerts are not hard spending caps.

No billable qualification resources have been provisioned. The initial existing-budget read reported USD 1,000.60
September accrued and USD 1,539.88 monthly forecast; exact-window cost queries were rate-limited. These figures are
historical observations, not current deployment headroom. Refresh actual and projected costs before provisioning.

The active worktree adds current-dependency task inputs, UTF-8 input/output budgets, selective authorized reads,
review pagination/expiry checks, narrow role grants, and governance import/collector safeguards. An experimental local
archetype copy capability was removed after adversarial review found filesystem-race and secret-detection defects.
COE import remains unimplemented; no release candidate has been selected.

Draft [PR #345](https://github.com/jonathan-vella/apex-vnext/pull/345) contains the implementation checkpoint and prior
cleanup/dependency work. The native-policy follow-up adds a typed digest-only receipt, bounded property comparison,
exact generated-source verification, persisted preview binding and rejection of missing or altered evidence before
Gate 4. Unsupported expressions, missing values and unverified exemptions fail closed. This is concrete-property
preflight, not an Azure Policy interpreter or proof that supplied platform resources cannot be changed.

PR feedback identified path containment, a weekly baseline TTL mismatch and management-group ID validation; these have
focused fixes. Reported literal authorization placeholders were review redaction artifacts, verified against local and
GitHub source; tests now assert Bearer-header construction. Catalog generation excludes Python caches to match clean CI.

A read-only repository collector check against the authorized subscription succeeded on 2026-09-16: nine assignments,
six retained, three Defender-filtered, and 48 actionable findings (13 blockers and 35 auto-remediation findings).
Schema validation and selected-subscription import passed. Temporary baseline data was deleted; no Azure resources or
policies were changed. Audit-only classifications remain visible summary evidence, not fabricated property mappings.

The maintainer clarified that all generated code must comply with target Azure Policy. Unknown checks are deployment
blockers to resolve, not accepted compliance exceptions. Native Terraform previews now compare material changes with
exact emitted managed addresses. Native Bicep previews resolve literal top-level IDs from accepted bindings and reject
foreign mutations and existing-resource updates/deletes. AVM child ownership remains unresolved and blocked.

The September 18 follow-up blocks explicitly incomplete Terraform plans and malformed change arrays, actions and
status fields. Native-provider tests confirm incomplete saved plans cannot apply with or without policy mappings.
Absent optional fields remain compatible with older Terraform JSON. Plan acceptance on both tracks now rejects
policy mappings to absent resources and unresolved blocked controls before recording completion or opening Gate 3.
These checks do not implement AVM child ownership or full effective-policy evaluation during code validation.
The integration checkpoint passed `qualify:vnext`: 232 capability, 217 CLI, 20 contract, 45 kernel, 13 renderer,
20 testkit, 144 validator and 29 packaging tests. A subsequent optional-field compatibility assertion passed its
focused test; no production behavior changed after the checkpoint.

Reviewer context includes locked stage criteria and current matching dispositions, with selective bounded retrieval
for oversized metadata. The ownership/reviewer batch passed a dedicated final `qualify:vnext` run. An earlier run was
interrupted and is not used as passing evidence. External checks passed with the existing Python virtual environment.

The latest cost refresh still returned HTTP 429 for exact-window actuals. A partial September 17-29 forecast of
USD 503.08 excludes September 16, and the new budget's zero accrued value conflicts with the earlier budget read.
Do not infer usable deployment headroom from these incomplete values; no billable resources have been provisioned.

Final `npm run qualify:vnext` passed after repairing two stale guidance/tool inventory assertions, including
143 validator tests and 29 packaging tests. Repository Node checks passed after regenerating public references.
The external validation stage initially used system Python without pytest; rerunning with the existing virtual
environment passed, including 16 Python tests and four optional skips. No live client or cloud proof is inferred.

## Planning Checkpoint

On 2026-09-13, [PR #343](https://github.com/jonathan-vella/apex-vnext/pull/343) was verified merged, delivering the
creative-workflow changes. [Issue #344](https://github.com/jonathan-vella/apex-vnext/issues/344) was open with no comments
or linked completion evidence in the inspected timeline. It is the governance plan, not an implementation receipt.
The authorized delivery session has taken over that work and posted implementation progress on the issue.

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

## Development Diagnostics Checkpoint

On 2026-09-18, separately authorized development tooling added workspace registration/disable, generated VS Code
workspace settings, CLI capture launch, host Azure CLI authentication, and bounded local/Azure evidence packets.
The user approved Monitoring Metrics Publisher for their Azure user at the dedicated Application Insights component
scope. The host collector was verified by a synthetic log/trace round trip and the evidence reader retrieved both
local and Azure records. Existing service-principal credentials remain untouched; Key Vault remains private.

This does not qualify real client routing, custom-agent handoffs, desktop-app export, or unattended assessment.
The next client proof is one real registered session per supported client, with tool/subagent activity and attributable
evidence. No manual findings report should be required when the registered sources contain the necessary data.
See [acceptance](PRD.md#req-dev-diagnostics-001-opt-in-development-evidence) and
[setup and limitations](../how-to/debug-local.md#command-driven-session-assessment).

## Resume Protocol

1. Verify the current `main` head and protected check state.
2. Review open issues and the roadmap dependency order.
3. Select one bounded item with an owner and acceptance evidence.
4. Keep live operations separate unless the item carries explicit authorization.
5. Update this checkpoint only when the durable release boundary changes.

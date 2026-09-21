# APEX vNext Checkpoint

- **Updated:** 2026-09-21
- **Repository:** `jonathan-vella/apex-vnext`
- **Integration branch:** `main`
- **Product status:** Pre-release
- **Release candidate:** None selected

## Current State

The approved direction is a COE workload factory with independent archetype reuse and conversational changes.
Both ALZ-backed workloads and standalone single-subscription labs/demos are day-one requirements. Windows users run
through WSL2 for VS Code Local and standalone CLI. Neither requires a devcontainer. Desktop-app work is parked.
[PRD.md](PRD.md) is the canonical scope and quality reference.

The standalone vNext repository owns a deterministic TypeScript runtime, versioned contracts, bounded capabilities,
renderers, CLI/MCP lifecycle, managed VS Code and Copilot CLI projections, and deterministic qualification.

Repository modernization has retired original automation, prompts, compatibility utilities, duplicate workflows and npm
scripts, stale root configuration, and unneeded development-container tooling. The active documentation has been rebuilt
around vNext source authorities and Diátaxis navigation.

## Active Completion Focus

The maintainer parked all standalone desktop-app work on 2026-09-21. The active release targets only VS Code Local
and standalone Copilot CLI on WSL2. Preserve desktop probes, Windows fixes and upstream findings without additional
app tests, adapter implementation, native Windows CI or host setup. The
[desktop backlog](ROADMAP.md#deferred-standalone-copilot-desktop-app) owns reactivation; built-in helpers remain deferred.

PR #345 merged as `afca69ee4318052550d4993145e896329827a5fd`; its post-merge CI and release qualification passed.
Candidate `67fefa2` has bounded user-confirmed VS Code/CLI intake and restart observations, not full workflow parity.
The development desktop probes are separate evidence and must not be used to qualify these clients.

The 2026-09-21 standalone CLI `1.0.86` recheck executed a tool-free worker through direct `--agent` selection despite
`user-invocable: false`; see [ADR-0006](adrs/03-des-adr-0006-omit-cli-autonomous-workers.md).
The maintainer-approved ADR revision removes visibility as a security blocker. Runtime authority tests and an isolated
CLI-to-MCP probe reject invalid/stale work and accept a valid task without approving gates. Qualify actual CodeGen,
Reviewer and Validator profiles next, preserving models, tool grants and kernel safeguards. Shipped worker membership
remains unchanged pending that evidence; same-client review is not authenticated independent identity.
The model identifier issue is resolved: CLI adapter `1.3.0` maps the same configured GPT models to documented CLI IDs.
The actual Reviewer accepted a bound Requirements finding; corrected CodeGen guidance produced one accepted tree on
each track. Task-only IaC `validateTask` requests now execute native checks and return runtime-owned evidence with
explicit unexecuted-validator blockers. Fresh CLI Validator probes on both tracks report those blockers and stop without
completion or Gate 4 changes. Required executable security-baseline/logical-parity evidence remains an implementation
gap; command receipts must not be used to claim those checks passed. See the
[worker matrix](CLIENT-QUALIFICATION.md#cli-worker-qualification).
Complete the remaining product and paired-client matrix. Do not restart completed cleanup
or add optional agent helpers, telemetry or orchestration infrastructure to accelerate delivery.

Pending branch changes must be separated by relevance before integration: retain and qualify shared CLI guidance only
where needed for the active clients; park desktop-only runtime changes and evidence without deleting or shipping them
as an implied support promise. Do not reset the dirty branch or overwrite prior test workspaces.

### Governance Native Validation Checkpoint

The current working-tree slice passes the accepted nonempty policy map and generated managed-resource execution
bindings into native source validation on both IaC tracks, reusing preview's binding construction. Bicep now evaluates
mapped properties from the existing build command's output and includes source-bound policy evidence in its native
validation receipt. Validation acceptance and preview require complete, passing evidence for the accepted mappings.
The business policy validator is recorded as native only when that evaluation ran. Empty maps and Terraform's
command-only validation do not claim policy execution.

Regressions cover Deny, Modify and DeployIfNotExists, receipt tampering, stale inputs, input mutation during commands,
missing bindings and rejected values. Rejection preserves the journal and closed Gate 4. Installed-Bicep tests verify
matching and mismatched properties using symbolic-name compiler output. Unresolved expressions and unsupported
resource bindings fail closed; this does not establish full AVM coverage or deployed-resource compliance.

The Bicep evidence slice passed `qualify:vnext`. Terraform already evaluates saved-plan properties during native
preview before Gate 4; its source-validation commands alone do not resolve planned values. A subsequent provider fix
bounds and snapshots policy inputs before preview awaits, preventing caller mutation from changing expected values,
removing mappings or replacing resource bindings during commands. All 285 provider tests and both focused Terraform
saved-plan service tests passed after that fix. No authenticated planning was run or added to source validation.

Both tracks now have nonempty management-group-baseline import through reconciliation, review, planning, code
acceptance, restart and simulated deployment coverage. Tests retain Deny, Modify and DeployIfNotExists identities,
reject missing/substituted/exempt mappings without changing the journal or opening Gate 2, and exclude unrelated
subscription data from the selected snapshot and metadata sentinels from persisted runtime files.

The same imported-baseline fixture now also uses production native providers with mocked external commands and
file-backed runtime stores. Bicep rejects mismatched properties during source validation; both tracks reject mismatched
preview properties without journal changes or opening Gate 4. After service restart, passing previews persist evidence
bound to the accepted source, policy identities and exact mocked compiler/plan output. Terraform source validation
remains command-only. These cases stop before native apply; simulated deployment and mocked output are not live
compliance evidence.

Bicep policy lookup now traverses embedded deployment templates using qualified `module::child` symbols, preserving
parent conditions and loop restrictions. Installed-Bicep tests cover matching and mismatched local-module properties.
Imported-policy workflows cover Bicep AVM-style bindings with explicit physical ownership and Terraform exact
child-resource addresses. Both preview providers snapshot bounded policy inputs before awaited commands. Unresolved
ARM expressions, missing symbols, ambiguous resources and unbound module containers remain fail-closed, not compliant.

The combined governance changes passed `npm run qualify:vnext` on 2026-09-21 with exit code 0, including package tests,
runtime validators, packaging and clean installation. Focused checks also passed all 336 provider/evaluator tests and
13 imported-policy/ownership workflow tests. This is working-tree qualification, not a published release or client/cloud
acceptance result.

The remaining acceptance boundary is exact-candidate client and separately authorized cloud evidence, including actual
AVM versions and parameterized workloads. Keep Terraform's earlier command-only evidence distinct from saved-plan
policy evidence. Issue #344 remains open pending that acceptance; desktop work remains parked.

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
  standalone collection and empty/nonempty import-to-simulated-deployment tests exist for both tracks. Native apply
  previews check concrete policy values against compiled Bicep/saved Terraform plans with source-bound receipts;
  native top-level ownership checks reject foreign mutations. Combined imported-baseline/native-provider tests reach
  preview with mocked commands, including qualified Bicep module children and resolved Terraform child resources.
  Actual AVM-version/workload acceptance remains unverified; Terraform source validation is still command-only.
- Implement and qualify COE import, provenance, relevant change questions, manual-edit conflicts and selective
  regeneration using existing contracts and parameters.
- Complete design/ADR and operational/as-built output against the PRD quality checklist.
- Close VS Code and standalone CLI lifecycle gaps on WSL2 in both profiles; projections do not prove outcomes.
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

The September 19 consumer clarification prioritizes collect/import/plan/deploy governance over broader local policy
emulation. [REQ-GOV-001](PRD.md#req-gov-001-governance-and-policy) now requires optional refresh below 30 days and
mandatory refresh at 30 days, measured from successful collection. Consumer workflow assets are now included in both
client installations but remain disabled pending consumer OIDC/environment configuration. Live collection and exact-client
qualification remain pending, not implied by packaging tests.
The initial implementation enforces the fixed age at import, plan issuance/context/completion, preview and new Gate 4
approval for imported snapshots. Collection renews observation timestamps even without policy changes and publishes
atomically; failed publication preserves the prior authoritative file. The full integration checkpoint passed before
focused resume/timestamp and atomic-publication follow-ups, which have their own regression checks.

Unchanged renewal now reuses the path-only import operation after initial discovery. It compares complete selected
subscription content, excluding only collection timestamps and legacy TTL fields, and records a typed observation
receipt bound to the accepted governance and target. Accepted artifact hashes, approval dependencies and gates stay
unchanged. Changed content, legacy snapshots without content digests, stale or future observations and wrong scope
are rejected; active-task CAS, preview expiry and writer authority remain intact. Both tracks have restart, replay,
drift-rejection and concurrency regression coverage.

The path-only `governance select` / `governanceSelect` operation now issues a bounded age-and-choice request through
the existing input contract. `recordInput` persists the exact answer with head/epoch checks. Reuse and refresh choices
survive restart; reuse expires at 30 days, and refresh never fabricates collection. Pending choices block bypass through
preview or new approval. CLI/MCP schemas, managed Operator grants and both client projections are covered by tests;
real client interaction and consumer collection dispatch remain separate qualification work. Explicit `--reopen` permits
reconsidering a pending optional refresh without losing the original answer; it never permits stale reuse. Collection
workflow, collector and schema ship from single canonical sources with verified hashes and existing update conflict handling.

Material policy changes now have a confirmed CLI-only `governance revise` path. It binds the replacement file digest,
atomically invalidates the locked governance dependency closure and Gates 2-4, retains requirements/architecture and
history, and requires separate re-import and renewed reviews. In-flight or indeterminate deployment blocks revision.
Dependency hashing consumes invalidation events so superseded artifacts cannot retain deployment authority.

Collector and importer preserve assignment enforcement modes independently of policy effects. `DoNotEnforce` retains
desired compliance constraints without claiming Azure will deny the request; unsupported modes fail collection.
Legacy absence remains unknown. Mode changes participate in the selected content digest and require reconciliation.

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
foreign mutations and existing-resource updates/deletes. Unresolved AVM child ownership remains blocked.

The September 19 ownership follow-up carries Bicep resolver failures into preview coverage and explicitly blocks
unresolved Terraform module descendants or missing managed execution addresses. Empty and no-op previews cannot hide
those failures; workflow regressions retain the journal head and closed Gate 4. Terraform coverage also rejects
foreign material changes labelled no-op. These are safety fixes, not completed AVM support. Current Bicep evidence
binds source and physical what-if IDs but does not attribute each ID to an accepted logical module. Terraform plan
module metadata likewise needs a source-bound ownership contract before descendant operations can be authorized.

A subsequent Bicep slice adds exact intended `physicalResources` to the accepted IaC binding. Plan validation rejects
scope/type mismatches and physical collisions; the Gate 3 document displays the scope. Native request, what-if and
observed inventory checks enforce that exact managed-ID set, including ancillary resources, while protecting existing
IDs. This is authorization scope, not observed module attribution. Full AVM policy-property evaluation and Terraform
module ownership remain open. See [the track contract](../reference/iac-tracks.md#exact-bicep-module-scope).

Validation follow-up adds the accepted policy-property map to both validation nodes' declared inputs and makes
generated-tree validation reject unsuccessful, interrupted or truncated command results. A subsequent receipt slice
connects configured native providers to validation-task completion: fixed local commands run against isolated source
copies, and runtime-owned digest receipts bind the accepted handoff, tree, intent and policy map. Native preview checks
the recorded receipts; label-only adapters require explicit simulation mode. `validateTask` remains artifact staging.
Reports label unexecuted checks simulated. Bicep receipts now require format/build/lint, with scratch-only formatting
and byte comparison to reject drift; Terraform receipts prove init/format/validate. Real local Bicep tests cover nested
files, formatting drift and error-level lint findings without changing accepted source. Historical build-only receipts
must be regenerated. Earlier security/policy evaluation remains open, not inferred from receipt input hashes.
The validation-input/verdict checkpoint passed `qualify:vnext` with 233 capability and 235 CLI tests, plus the remaining
contract, kernel, renderer, testkit, validator and packaging suites. A subsequent focused ownership regression also
blocks delete/replace of managed ancestors containing protected existing children, including extension resources.

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

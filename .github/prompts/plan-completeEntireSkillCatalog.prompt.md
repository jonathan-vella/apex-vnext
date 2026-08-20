---
description: "Deliver complete APEX skill parity with capability ownership, rendering, packaging, and qualification."
agent: agent
model: "Claude Opus 4.7"
argument-hint: "Optional: begin with a specific PR stage or review the complete catalog plan."
tools: [vscode/askQuestions, execute/runInTerminal, read, search, edit, todo, agent]
---

# Complete The Entire Skill Catalog

<investigate_before_answering>
Treat current repository and GitHub state as authoritative. Before executing a PR stage, verify the latest `main`, dirty
worktrees, merged predecessors, applicable instructions, open review threads, and required checks. Preserve work that
was not created by the current execution. Do not infer implementation or qualification from this plan.
</investigate_before_answering>

<output_contract>
Complete one independently mergeable PR stage at a time. Report its exact head, changed files, disposition progress,
tests, unsupported capability status, review blockers, and next dependency. Do not claim live provider or client
qualification from deterministic fixtures.
</output_contract>

Complete every skill-related migration and runtime ownership gap across all legacy-mapped consumer skills and the six
native vNext skills. Preserve every valuable legacy resource through an exhaustive disposition ledger, deepen all
guidance, implement missing capability code without claiming live qualification, make every valuable artifact template
renderable through typed producers, package the Azure Prepare template corpus as a lazy recipe pack, and finish with a
catalog-wide review and supported-client evaluations.

The current branch contains an uncommitted partial batch touching artifact, defaults, ADR, RBAC, Mermaid, and Microsoft
Docs guidance. Preserve that work, repair its known inconsistencies, and partition it into the PR sequence below. Pull
request 267's Bicep restoration remains the completed reference pattern.

**Confirmed scope decisions**

- Include all 25 legacy consumer mappings and the six native vNext skills.
- Implement missing capability interfaces, contracts, authorization, dispatch, and provider adapter code, but do not
  perform live Azure or external-service qualification in this work.
- Classify capabilities as `active`, `implemented-unqualified`, or `external-trusted`. Remote capability code remains
  unavailable to workflow grants until separate provider evidence qualifies it.
- Implement producers and deterministic renderers for every valuable artifact template. Producers emit honest typed
  unknown, deferred, unavailable, or not-applicable states and never fabricate data.
- Package the Azure Prepare Functions template, specification, and evaluation corpus as a typed, versioned, lazily
  loaded recipe pack rather than model-loaded guidance.
- Deliver through seven reviewable PRs. Each PR must pass focused tests and `npm run qualify:vnext` before merge.
- Preserve direct-operation authority: deployments, destroy, Terraform import apply, quota increases, budget writes,
  Entra consent or credential changes, RBAC mutation, pack lifecycle, and release actions remain trusted CLI or
  separately authorized operations.

**Catalog coverage**

- Legacy mappings: Azure ADR, artifacts, Bicep patterns, cloud migration, compliance, compute, cost optimization,
  defaults, deploy, diagnostics, governance discovery, Kusto, Prepare, quotas, RBAC, resources, storage, validation,
  Entra registration, IaC common, Mermaid, Microsoft Docs, Terraform patterns, Terraform import, and Terraform test.
- Native vNext skills: workflow, requirements, architecture, planning, CodeGen, and operations.
- Source corpus: 468 descendant resources comprising references, templates, scripts, and assets. Every resource requires
  exactly one reviewed disposition.

## PR 1: Ledger, Lifecycle Foundations, And Safe Baseline

**Purpose:** establish truthful accounting, stable capability and presentation lifecycle contracts, and a safe baseline
before domain content moves.

1. Preserve the current dirty work before creating clean PR branches:
   - inventory every modified and untracked path;
   - create one local checkpoint commit on the current feature branch containing the complete dirty worktree;
   - record its commit hash and path-to-PR assignment;
   - create each delivery branch from the latest merged `main` in a clean worktree;
   - restore only that PR's assigned paths from the checkpoint commit;
   - do not push or merge the checkpoint branch as product work.
2. Repair current partial regressions before staging:
   - restore the requirements template to runtime-supported slots until PR 2 replaces the renderer path;
   - label unsupported artifact templates reference-only until PR 2 activates them;
   - remove duplicate deployment-summary sections;
   - align Mermaid's claimed diagram types with its references;
   - state that Microsoft Docs remains unavailable until its capability is activated;
   - remove defaults claims that imply runtime projection not present in task context.
3. Extend `tools/registry/guidance-migration.v1.json` using the existing structure, not a second catalog:
   - add mapping lifecycle `planned` and `complete`;
   - require `resourceDispositions` for every consumer mapping, including explicit empty arrays for source skills with
     no descendants;
   - support `adapt`, `already-owned`, `exclude-unsafe`, and `defer-capability`;
   - record target or planned target, canonical owner, reason, replacement proof, rollback or removal gate, capability
     owner where deferred, and scenario IDs.
4. Populate all 468 source-resource dispositions, preserving the eight existing Bicep rows. Mark unfinished mappings
   `planned`; do not pretend future targets already exist.
5. Strengthen `validate-guidance-migration.mjs` to prove exact source-set equality, duplicate rejection, valid owners,
   and complete planning metadata. Enforce target existence, packaging, replacement proof, and scenarios only when a
   mapping becomes `complete`.
6. Add mutation tests for missing rows, bad targets, malformed entries, unsafe executable retention, unknown owners,
   and source drift.
7. Add shared capability lifecycle contracts and disabled dispatch foundations:
   - `active`: deterministic or local capability with passing integration tests and an authorized workflow grant;
   - `implemented-unqualified`: code exists, but dispatch returns a stable unavailable result and no workflow grant;
   - `external-trusted`: operation remains owned by a trusted CLI or provider lifecycle.
8. Add shared presentation lifecycle contracts for producer and renderer registration without introducing domain
   producers in this PR.
9. Reconcile the five current manifest omissions for artifact/default references, regenerate assets, and prove both
   client projections contain every currently declared consumer resource.

**Owned files:** migration registry, validator and tests; capability/presentation lifecycle contracts; current partial
skill files only where needed to restore a safe baseline; manifest entries for existing files; package script and
validator graph registration.

**Exit:** every source descendant has a machine-validated planned or complete disposition; lifecycle foundations are
stable; no partial template or capability claim can break current runtime behavior.

## PR 2: Renderer Framework, Core Producers, And Diagram Skills

**Purpose:** establish deterministic rendering and complete artifact/Mermaid content while leaving domain-specific
producers to their owning PRs.

1. Add presentation contracts for document kind, typed source references, slot values and unavailable states, template
   hash, rendered document, and render receipt.
2. Add or refine source artifact contracts and producers that are already owned by core workflow state:
   - requirements;
   - run status;
   - deployment preview and approval evidence;
   - resource inventory;
   - project/documentation index derived from existing journal and receipt metadata.
3. Define producer interfaces for architecture, cost, governance, compliance, implementation, deployment, operations,
   recovery, and improvement documents. Keep them unregistered until PRs 3–5 provide typed producers.
4. Register active templates in one renderer registry. A registered template may render unavailable sections, but it
   must not imply that an absent domain producer has run.
5. Replace requirements-specific substitution in `ApexService` with the registry path. Persist canonical Markdown plus
   typed receipts when a state-changing workflow produces a document; on-demand render remains read-only.
6. Derive CLI/MCP render enums from the registry and preserve existing aliases (`status`, `preview`, `approval`, and
   `inventory`).
7. Complete `apex-artifacts` and `apex-mermaid` content parity, including all source template/reference dispositions,
   syntax/styling coverage, inline-diagram validation, and explicit standalone-diagram boundaries.
8. Add golden tests for each renderer available in this PR and contract tests proving absent domain producers render
   honest unavailable states.

**Owned files:** `packages/contracts` presentation/artifact schemas, `packages/renderers`, render-related
CLI/service/MCP code and tests, `apex-artifacts/**`, `apex-mermaid/**`, and related template manifest entries.

**Exit:** the renderer framework and core producers are deterministic; artifact and Mermaid mappings are complete; no
template claims a domain producer that has not yet been registered.

## PR 3: Design, Defaults, Identity, And Documentation Skills

**Purpose:** complete architecture-facing knowledge and read-only advisory capability code.

1. Deepen the listed skills and change their migration mappings from `planned` to `complete`:
   - `apex-azure-defaults`;
   - `apex-azure-adr`;
   - `apex-azure-rbac`;
   - `apex-azure-compute`;
   - `apex-azure-storage`;
   - `apex-entra-app-registration`;
   - `apex-microsoft-docs`.
2. Preserve source-derived network planning, cost monitoring, security, tags, naming, deprecations, service/WAF
   selection, identity resolution, ADR alternatives/review, role selection, VM/VMSS guidance, storage decisions,
   OAuth/permissions/troubleshooting, and documentation research behavior.
3. Add typed capability code and design-document producers for:
   - Microsoft Docs search/fetch/code-sample retrieval;
   - RBAC role-catalog lookup;
   - compute/region evidence normalization;
   - Entra application read/intent validation.
   - architecture assessment and design document;
   - design cost estimate;
   - ADR and identity decision presentations.
4. Mark remote capability implementations `implemented-unqualified`. They receive no workflow grants and return stable
   unavailable results until separately qualified. Do not implement app creation, consent, credentials, role
   assignment, or cloud mutation.
5. Add deterministic unit tests for request validation, host/scope restrictions, output limits, redaction,
   serialization, stable receipts, and unavailable dispatch. Provider/fake integration qualification remains outside
   this scope.
6. Register and test the domain producers added by this PR.
7. Complete role wiring and nearest-neighbor discovery boundaries for architecture/planning consumers.

**Owned files:** listed consumer skill directories; design/identity/docs contracts and capability modules; focused
adapters and tests; role wiring limited to these skills.

**Exit:** all design-domain source resources are dispositioned and meaningful knowledge is restored. Capability code
exists but remains explicitly unqualified for live use.

## PR 4: Governance, Operations, Cost, Diagnostics, And Deployment Skills

**Purpose:** complete evidence/operations guidance and bounded read capability code.

1. Deepen the listed skills and change their migration mappings from `planned` to `complete`:
   - `apex-azure-governance`;
   - `apex-azure-compliance`;
   - `apex-azure-quotas`;
   - `apex-azure-resources`;
   - `apex-azure-diagnostics`;
   - `apex-azure-kusto`;
   - `apex-azure-cost-optimization`;
   - `apex-azure-validate`;
   - `apex-azure-deploy`, including all `iac-common` resources.
2. Restore governance L0/resume/effect handling, policy prechecks, inventory patterns, quota mapping, KQL/query gotchas,
   service diagnostics, compliance/azqr/Key Vault review, cost analysis, native validation, deployment
   verification/recovery, circuit breaker, drift routing, and known deploy issues.
3. Implement typed capability code and domain producers for governance, compliance, observed cost, deployment summary,
   operations guide, recovery plan, inventory, diagnosis, and validation evidence.
4. Mark remote Azure capability implementations `implemented-unqualified`. Do not grant or execute them in production
   workflow paths. Governance pack execution remains unavailable until its provider boundary is separately qualified.
5. Activate only deterministic local validation code with passing integration tests. Keep preview, apply, destroy, and
   reconciliation in trusted native provider paths.
6. Register and test the domain producers added by this PR.
7. Add deterministic tests for contracts, grants, scopes, stale/partial evidence, pagination, query/result limits, KQL
   guards, redaction, stable unavailable behavior, and producer output. No live Azure qualification.

**Owned files:** listed consumer skill directories; operations evidence contracts/capabilities; governance pack
execution; validation dispatch; operation-focused tests and docs.

**Exit:** operational skills provide restored expertise and executable bounded code paths without granting mutation
authority or live support claims.

## PR 5: Prepare, IaC, Terraform, And Migration Skills

**Purpose:** complete generation/testing/import/migration knowledge and lazy recipe ownership.

1. Deepen the listed skills and change their migration mappings from `planned` to `complete`:
   - `apex-azure-prepare`;
   - `apex-azure-cloud-migrate`;
   - `apex-terraform-patterns`;
   - `apex-terraform-test`;
   - `apex-terraform-import`;
   - verify the completed `apex-bicep-patterns` ledger remains exact.
2. Restore Terraform module/back-end/refactor/plan/AzureAD/private-endpoint patterns, test syntax/mocks/examples, import
   assessment/mapping, Prepare service-selection/runtime/recipe behavior, and Lambda-to-Functions
   assessment/runtime/code-migration knowledge.
3. Convert the complete Azure Prepare Functions specs/templates/evals into a versioned lazy recipe pack:
   - pack manifest and digest;
   - typed recipe selection and composition contracts;
   - language/runtime prerequisites;
   - template materialization into authorized staging only;
   - bundled eval fixtures and deterministic validation;
   - no bulk model loading of the template tree.
4. Implement capability code and domain producers for recipe resolution/materialization, Terraform import planning,
   Terraform test generation, source inventory, Lambda-to-Functions local transformation, implementation plan,
   preflight evidence, and implementation reference.
5. Activate deterministic local recipe/test/transformation capabilities only after integration tests pass. Keep remote
   source inventory `implemented-unqualified` when no qualified provider exists.
6. Keep Terraform import apply, apply-mode tests, Functions/AZD publishing, source-cloud reads, and migration cutover
   outside model authority.
7. Register and test the domain producers added by this PR.
8. Add path traversal, immutable-source, deterministic tree, secret, unsupported recipe/runtime, state mutation denial,
   and rollback tests.

**Owned files:** listed consumer skill directories; recipe capability pack; IaC/migration contracts/capabilities; and
related deterministic fixtures/tests.

**Exit:** the largest source corpus has complete dispositions and an executable lazy owner. No executable template or
import/migration action remains hidden in prose.

## PR 6: Native vNext Skills, Qualified Integration, And Packaging

**Purpose:** make the whole catalog coherent, reachable, and correctly authorized.

1. Review and update all six native skills:
   - `apex-workflow`: typed branches for input/task/gate/trusted CLI/unavailable/stale/wrong-project states;
   - `apex-requirements`: correct role/task checks, typed unknown/deferred examples, stage/repair/review/Gate 1 flow;
   - `apex-architecture`: accepted-evidence, requirement/SLO/SKU/cost traceability, full-bundle review;
   - `apex-planning`: source hashes, canonical intent, acyclic dependencies, binding/track/secret checks;
   - `apex-codegen`: exactly one issued generation task and receipt; no post-completion staging;
   - `apex-operations`: separate taskless preview/inventory/reconciliation from task-backed diagnosis.
2. Set explicit invocation visibility and precise descriptions for every skill. Resolve collisions using tested
   nearest-neighbor boundaries.
3. Replace invalid specialist handoffs with return-to-APEX/review flow and preserve intentional Copilot CLI worker
   omissions.
4. Add runtime role-to-skill validation, task-role aliases, client route checks, and skill ownership references without
   creating a second catalog.
5. Activate the capability registry in `ApexService` and expose one task-bound dispatch path through CLI/MCP. Validate
   capability ID, lifecycle, role, task, grant, scope, effect, expiry, input hash, output limits, and receipt before
   journal acceptance.
6. Grant only `active` capabilities. An `implemented-unqualified` capability must return a stable unavailable result and
   must not receive a workflow grant. Preserve the four human gates and existing trusted deployment providers.
7. Fix optional pack locking so optional capabilities do not become global required-pack dependencies.
8. Verify every legacy mapping is `complete`, every domain producer required by a packaged template is registered, and
   no planned target remains.
9. Reconcile `customizations/manifest.json`, role wiring, both client projections, generated assets, package contents,
   locks, update/rollback/uninstall behavior, docs, and changelog.
10. Add full-tree package assertions rather than sampling only selected references.

**Owned files:** native skill directories, managed agents, manifest/schema, workflow/capability configuration,
CLI/MCP/service integration, asset generator and lifecycle tests, client projection docs, and changelog.

**Exit:** all skills are reachable only in supported roles/clients, every declared capability has an authorized dispatch
path, and package lifecycle proves exact catalog delivery.

## PR 7: Catalog Review, Evaluations, And Closure Evidence

**Purpose:** prove the migration adds domain value without authority regressions.

1. Generate one catalog-wide review artifact containing every mapped source resource, disposition, target/canonical
   owner, transformation rationale, capability status, renderer status, deferred live qualification, and unresolved
   gap.
2. Human-review all 25 mappings and six native skills. Any meaningful loss returns to its owning domain PR; no silent
   exclusions.
3. Add compact evaluations per coherent skill/workflow:
   - positive and near-miss discovery prompts;
   - two or three realistic behavior prompts;
   - at least one edge/unavailable/stale-evidence case;
   - direct-operation and authority-adversarial cases;
   - representative reference-read and output assertions.
4. Reuse existing client-outcome and qualification infrastructure; do not create a parallel evaluation platform.
5. Compare the candidate against the merged pre-restoration baseline for domain correctness, restored-knowledge use,
   blocker correctness, authority safety, context/read cost, and routing collisions.
6. Run deterministic evaluation fixtures for both client projections. Live client execution and live Azure/external
   provider qualification remain separate required evidence and are reported unavailable, not inferred.
7. Run the final repository gates:
   - `npm run validate:guidance-migration`;
   - managed/root skill and orphan-content validation;
   - package-level contract/capability/renderer/CLI tests;
   - `npm run test:vnext-pack`;
   - `npm run validate:docs`;
   - `npm run validate:all`;
   - `npm run qualify:vnext`.
8. Produce the issue 219 closure dossier, but do not close the issue while candidate-bound paired-client or
   optimization-gate evidence remains blocked by issues 220 and 161. State precisely which implementation work is
   complete and which live qualification remains.

**Owned files:** evaluation scenarios/fixtures, catalog review artifact, qualification integration, and final docs. No
runtime feature fixes belong in this PR.

**Cross-PR rules**

- Start each PR from the latest merged `main`; do not stack long-lived dirty branches.
- Restore assigned files from the recorded local checkpoint commit into each clean PR branch. Never reapply the whole
  checkpoint to a later branch.
- PR 1 owns migration/capability/presentation lifecycle foundations. PR 2 owns renderer infrastructure. PRs 3–5 own
  their domain skills, capability implementations, producers, and migration completion. PR 6 owns final integration.
- Shared manifest/assets/docs are updated only when that PR's files must ship; PR 6 performs final reconciliation.
- Generated assets are regenerated from canonical sources, never edited directly.
- Every PR must keep unsupported live claims explicit and pass focused tests plus `npm run qualify:vnext`.
- No PR changes live Azure resources, publishes packages, deploys workloads, closes release gates, or grants model-side
  mutation authority.

**Completion definition**

- All 468 legacy descendant resources have reviewed, validator-enforced dispositions.
- Every mapping is `complete`; no planned target remains.
- Every valuable adapted item exists in a packaged consumer skill, typed producer/renderer, capability, or recipe pack.
- All 25 legacy mappings and six native skills meet the repository skill-authoring rubric and have correct role/client
  wiring.
- Every packaged artifact template has a typed producer and deterministic renderer.
- Every executable behavior has an `active`, `implemented-unqualified`, or `external-trusted` owner. No hidden shell or
  cloud authority remains in skills.
- Deterministic tests and qualification pass, the catalog review reports no meaningful loss, and remaining live
  qualification is explicitly tracked rather than claimed.

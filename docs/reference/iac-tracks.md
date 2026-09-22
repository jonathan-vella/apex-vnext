# Bicep And Terraform Tracks

> [Current Version](../../VERSION.md) | Equivalent governed outcomes with track-specific execution mechanics.

## Shared Contract

Each run selects exactly one IaC track. Both tracks consume the same approved requirements, architecture, governance,
policy map, and implementation intent. Both must produce typed bindings, generated files, validation evidence, an exact
preview, approval evidence, an operation record, and inventory.

A track cannot reuse the other track's preview or approval.

## Resource Ownership

The logical-resource manifest distinguishes `existing` from `managed` ownership. Artifact staging and acceptance reject
contradictory declarations with `APEX_VALIDATION`: existing resources use Bicep `existing` declarations or Terraform
`data` sources, while managed resources use `resource` or `module` implementations. Cross-track reference kinds are
rejected. The owning predicate is
[`hasValidLogicalResourceReferences`](../../packages/contracts/src/targets.ts).

Code-generation acceptance also matches each manifest resource's ID, type, implementation descriptor and dependency
set to the approved intent and binding. Rehashing an altered manifest does not authorize additional or substituted
resources. These artifact-consistency checks do not prove compiled-resource parity.

Preview requires a valid accepted manifest covering every intent resource. Only `managed` entries enter APEX's provider
apply/destroy request resource lists and simulated changes/inventory. Existing references remain in the accepted intent
and its hash binding. An all-existing workload has no simulated changes but still requires fresh deployment approval.

This check validates manifest consistency, not the truth of an ownership claim or the generated code. Binding supplied
platform resource identities to approved intent, native preview changes and cleanup remains follow-on work. An accepted
manifest does not grant authority to modify shared platform resources or bypass deployment approval.

### Exact Bicep Module Scope

Bicep AVM bindings can declare `physicalResources` as intended authorization scope. Each entry contains an exact
`resourceId`, ARM `type`, `ownership` (`managed` or `existing`), and `role` (`primary` or `ancillary`). A map contains
1-128 entries and exactly one managed primary matching the logical resource type. IDs must be within the run's exact
subscription/resource group; case-insensitive duplicates, collisions with native resources, expressions and wildcards
are rejected. Native bindings and Terraform bindings cannot use this field.

The Gate 3 binding document displays this scope. Native Bicep requests include only approved managed IDs, and material
what-if changes outside that exact set block preview. Observed deployment-stack inventory must contain only unique
approved managed IDs before deployment completion is recorded. Protected existing IDs are never added to the managed
set. Ancillary inventory entries retain distinct identities under their accepted logical parent.
Delete and replace previews are also rejected when an approved managed ID is an ancestor of a protected existing ID;
omitting the protected child from what-if does not authorize its implicit removal.

This declaration is not proof of resource existence, AVM expansion or policy compliance. Unknown child resources block
preview instead of inheriting permission from their parent. Nonempty policy maps still require source-bound native
property receipts; declaring physical IDs does not resolve module property expressions. Terraform module containers
with unresolved descendants and full AVM expression evaluation remain unsupported. No live Azure qualification is
implied by offline tests.

### Policy Execution Addresses

Managed manifest entries use `executionAddress` to bind policy observations to generated resources. Bicep uses the
exact compiled symbolic key, or `module::child` for a resource inside an embedded deployment template. Deeper templates
extend that path, for example `outer::inner::storage`. Symbol paths are case-sensitive; resource names and unqualified
child basenames are not substitutes. Compilation must preserve symbolic names. This policy address does not replace
the exact physical-resource ownership map required for Bicep modules.

Terraform uses the full planned resource address, including module paths and instance keys, such as
`module.storage.azurerm_storage_account.main["east"]`. A resolved child resource is a `resource` entry; a module
container is not evidence of descendant ownership. The saved plan must contain matching known values and change
evidence for that address.

Missing or ambiguous bindings, unnamed nested resources, loops, unresolved conditions, linked templates and ARM
property expressions fail closed. The evaluator does not interpret ARM parameters, variables or deployment functions.
Local-module compiler tests and mocked native workflows establish these bounded mechanics, not compatibility with
every AVM version or live resource compliance.

## Differences

| Concern           | Bicep                                        | Terraform                                                      |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Validation        | Bicep format/build/lint; configured severity | `terraform init`, format, validate, and provider schema checks |
| Preview           | Azure CLI deployment what-if                 | Saved Terraform plan plus JSON rendering                       |
| Apply             | Azure deployment create                      | Apply the exact saved plan                                     |
| Preview lifetime  | Up to the configured Bicep TTL               | Up to the shorter configured Terraform TTL                     |
| State             | Azure deployment control plane               | Terraform backend; state must never be committed               |
| Provider metadata | Azure/Bicep schemas and AVM                  | Installed provider schema and bounded Registry client          |

The shipped defaults currently define a longer Bicep preview TTL than Terraform. Any dependency, target, owner,
recipient, generated IaC, or provider change invalidates stale proof.

## Support Boundary

### Native Validation Receipts

With an official native provider configured, validation-task completion executes fixed local checks against an isolated
copy of the accepted source. Bicep runs format across `**/*.bicep`, `build main.bicep --stdout`, then lint across
`**/*.bicep` with `--no-restore`. Formatting modifies only the scratch copy; any source-byte change fails validation
instead of repairing the accepted source. Lint follows configured diagnostic severity; error-level findings block.
Terraform runs `init -backend=false -input=false`,
`fmt -check`, and `validate`. Dependency downloads may occur, but these commands do not invoke Azure deployment or
Terraform plan/apply. Original and temporary source bytes are checked before and after commands, and temporary outputs
are removed. Failed, interrupted, truncated or stale results cannot complete the task.

The runtime stores a digest-only receipt bound to project, run, track, handoff, tree, intent and policy-map hashes.
Submitted evidence hashes do not replace this execution. Native preview requires the matching runtime-recorded receipt;
historical label-only validation must be invalidated and rerun before using an official native provider. Providers
with historical Bicep build-only receipts must likewise rerun validation to produce format/build/lint evidence. Providers
without source-validation support must explicitly declare simulated validation to remain usable as test adapters.

Validation reports distinguish `native` and `simulated` entries. Command results do not prove security checks or policy
compliance merely by including a policy-map hash. For nonempty Bicep maps, the runtime also evaluates properties from
the captured build output and requires complete passing policy evidence within the native receipt. It records the
policy validator as native only when that evaluation ran. Acceptance and subsequent preview check the accepted map,
resource bindings and every mapping's evidence.

For an accepted empty map, both source adapters record `policyApplicability` with
`status: no-actionable-mappings` and the exact policy-map content hash. The runtime credits the mapping applicability
check only with that bound receipt; omission, substitution and an applicability claim for a nonempty map are rejected.
This is not property evaluation, absence of audit policies, or full compliance. Security-baseline and logical-parity
validators remain independently required and blocked when their execution evidence is unavailable.

Terraform source property validation remains command-only: `terraform validate` does not resolve planned values.
Native preview evaluates its saved plan and requires passing source-bound policy evidence before Gate 4.
Both providers snapshot bounded policy inputs before awaited preview commands.
`validateTask` with supplied artifacts stages/checks them. With
only a task ID for an IaC validation task, it executes native checks and returns runtime-owned evidence plus executed
and blocked validator IDs, without completing the task. `valid: false` means required execution evidence is incomplete;
the worker must report the blockers rather than fabricate missing entries. Acceptance reexecutes current native checks.
No authenticated planning is implicitly added to source validation.

For managed storage accounts with accepted Bicep execution addresses, the receipt and task-only response include
`storageSecurity` diagnostics from the captured compiler output. Coverage is explicitly
`storage-account-property-hardening-v1`: minimum TLS, HTTPS-only, disabled public blob access and disabled shared-key
access. Results bind source/output/binding hashes and retain value digests, not raw observed values. Root and qualified
module-child symbols use the same exact-resource lookup; values on other resources cannot satisfy the check.

Every diagnostic declares `fullBaselineEvaluated: false`. Diagnostics, production network policy, identity/authorization,
other resource types and full resource parity are not covered by these four properties. Missing values fail; unresolved
expressions, ambiguous bindings and unsupported types remain unsupported. The capability can inspect the corresponding
AzureRM properties in supplied Terraform saved-plan JSON with known change evidence, but Terraform source validation
does not generate a plan or attach these diagnostics. Passing limited storage properties never credits the full
`business:security-baseline` validator or opens a gate.

Native task completion requires executed evidence for every required validator, not merely caller-supplied entries.
Native preview also rejects a prior completion containing required simulated or missing evidence, before provider
commands run. Explicit simulated adapters remain available for offline tests and cannot establish production readiness.
Because business security-baseline and full logical-parity executors remain incomplete, the production native workflow
currently stops at validation. Preview implementation tests use explicitly simulated business evidence where necessary;
their success is not evidence that this production prerequisite has been satisfied.

Deterministic and package qualification cover both tracks. Current-candidate live Azure qualification remains required
before claiming production readiness or release acceptance.

## Terraform Reference Operations

The Terraform Registry client performs bounded public metadata lookups with cache and status handling. Native provider
introspection reads installed provider schemas through Terraform; it does not grant deployment authority or replace
kernel validation.

## Authority

- [`config/workflow.v1.json`](../../config/workflow.v1.json)
- [`config/defaults.v1.json`](../../config/defaults.v1.json)
- [`packages/capabilities/src/command-plans.ts`](../../packages/capabilities/src/command-plans.ts)
- [`packages/capabilities/src/terraform-registry-client.ts`](../../packages/capabilities/src/terraform-registry-client.ts)

## Related

- [Operate a project](../how-to/operate-project.md)
- [Workflow and gates](../explanation/workflow-and-gates.md)
- [Qualification reference](qualification.md)

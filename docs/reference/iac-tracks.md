# Bicep And Terraform Tracks

> [Current Version](../../VERSION.md) | Equivalent governed outcomes with track-specific execution mechanics.

## Shared Contract

Current provider behavior is documented below.
[DECISION-036](../vnext/DECISIONS.md#decision-036-deliver-non-production-first-with-purpose-bound-approval) selects a
bounded azd executor for Bicep and retains native Terraform CLI. azd is not a third IaC language, and it is the only
Bicep executor: the native `az deployment` and Azure Deployment Stack paths are removed, with no fallback. CP-26
delivers it in three steps. The first added the typed `azd-binding-v1` contract, its deterministic inspection and the
azd prerequisite check. The second (the azd executor section below) runs Bicep previews, applies and destroys through
azd; it is implemented but not qualified, so Bicep live runs stay unavailable until CP-30
([#455](https://github.com/jonathan-vella/apex-vnext/issues/455)) qualifies it. The third, `azd deploy` application
packages, is not available.

Non-production purpose will use confirmed intent and final deployment approval with required reviews/checks retained.
Production will be opt-in, CI-owned and subject to verified human approval before apply. These purpose/approval
behaviors remain planned until their runtime and qualification work lands.

Each run selects exactly one IaC track. Both tracks consume the same approved requirements, architecture, governance,
policy map, and implementation intent. Both must produce typed bindings, generated files, validation evidence, an exact
preview, approval evidence, an operation record, and inventory.

A track cannot reuse the other track's preview or approval.

Generated Bicep trees are azd projects: `azure.yaml` (no hooks, extensions, layers or services), `infra/main.bicep` and
`infra/bicepconfig.json` with symbolic-name code generation enabled. The configuration participates in
the source tree hash, so compiled resource identity does not depend on an ambient workspace setting. A conflicting
staged configuration blocks generation rather than being overwritten. Native validation copies and verifies the same
configuration with the accepted source.

Native implementation descriptors accept nested ARM types such as
`native:Microsoft.Storage/storageAccounts/blobServices@2023-05-01`. Bicep bindings must supply the explicit full child
name; Terraform bindings supply the child name and parent ID. Generation does not infer symbolic parent/scope references.
Native Bicep ownership resolves explicitly named child types only when type and name segment counts match and the
parent scope is the selected resource group. IDs interleave type/name segments; declaring a child grants no authority
over its parent, siblings or undeclared descendants. Expression-based names and unresolved ownership still block preview.

Native Bicep diagnostic-settings bindings can additionally declare `scopeLogicalId` for one managed native resource in
the same accepted intent. The target must be a declared dependency; missing targets, modules, protected existing
resources, self-reference, chained extension scopes and competing raw scope/parent parameters are rejected. The generator
emits a symbolic `scope`, and ownership resolves only the diagnostic extension ID beneath that target. Terraform does
not accept this Bicep-only field. Plan review displays the scope reference; it is not evidence that diagnostics ran.

## azd Binding For Bicep

Implemented; the azd executor below runs on it. A Bicep azd project is described by the typed `azd-binding-v1`
artifact, produced by `inspectAzdBicepProject` from a project directory that holds `azure.yaml` and
`.azure/<environment>/`. azd recompiles Bicep and re-resolves parameters whenever it provisions, so the binding hashes
what that reads. Any change to any of these changes its `bindingHash`:

- the exact `azure.yaml` bytes (which contain every hook and extension declaration), the infrastructure tree of each root
  (one `default` root or each declared layer, with its dependencies, including `bicepconfig.json`) and the parameters
  after substitution;
- the azd environment: only azd-managed, non-secret keys (`AZURE_ENV_NAME`, `AZURE_LOCATION`,
  `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_PRINCIPAL_ID`, `AZURE_PRINCIPAL_TYPE`)
  are accepted and hashed together with the approved target, and any other key fails closed
  (`AZD_ENV_UNAPPROVED_KEY`) so a secret is never hashed or persisted. Custom values belong in the reviewed
  `main.parameters.json` or the typed environment inputs and secrets in Key Vault references. `${NAME}` in the parameter
  file may only name an allowlisted key. The per-environment `config.json` must be empty and `.azure/config.json` (the
  default-environment pointer) may only hold `version` and `defaultEnvironment`; both are hashed;
- the exact azd version and every remote Bicep module and template spec in the infrastructure trees, with its
  reference, registry, path and pin;
- the execution envelope: the environment name, the project root as working directory, no prompts and the approved
  cloud, tenant and subscription.

### Hooks And Extensions

Hooks and extensions are trusted (DECISION-037), not bound. They are listed so the approver can see them, exactly as
declared in `azure.yaml`: each hook with its scope (project, layer or service), event, order, platform variant, shell,
working directory, declared `run` text and `continueOnError`/`interactive` flags, plus the content hash of the file when
`run` is a plain project-relative script path; each extension with its id and declared version, from azd's default
registry. Nothing else about a hook is read: script bodies are not parsed, sourced files are not followed, and commands
are not rejected. The approval material that PR B shows must carry this warning:

> This project declares hooks/extensions. They run with your Azure credentials and are not described by the what-if
> preview.

Not bound: hook script contents beyond the declared path, extension binaries and sources, anything a hook or extension
reaches at run time, azd's own configuration and the user's Azure CLI sign-in. Azure Policy, RBAC and deny assignments
under an Azure Landing Zone are the compensating controls, and this covers non-production only: production (CP-28,
CP-29) must re-evaluate hook and extension controls first.

### Remote modules

Remote references are inventoried in every `.bicep` file (`module`, `extension`, `import`, `using`), resolving aliases
from the nearest `bicepconfig.json` in the bound tree. Only exact, immutable references are accepted: an exact `x.y.z`
tag on the Microsoft public registry (`br/public:` or `br:mcr.microsoft.com/bicep/...`, whose tags are immutable) or an
`@sha256:` digest on any registry. Floating or partial tags, a missing tag, a tag on any other registry, a template
spec without a version, URLs and undefined or redefined aliases fail with `AZD_MODULE_UNPINNED`. A template spec version
is not content-addressed, so the executor must verify the resolved artifact (digest) at preflight; the binding records
the reference, not the artifact, and does not verify it. Reference detection is regex-based rather than compiler-backed
and relies on the pinned Bicep and azd versions.

### Execution envelope

`buildAzdExecutionEnvelope` builds the envelope the binding carries. `buildAzdArguments` can express only
`provision --preview`, `provision` and `down`, always with an explicit `--environment` (the default-environment pointer
is never consulted), `--cwd` set to the absolute project root and `--no-prompt`; `azd up`, `azd deploy` and `--purge`
cannot be built. `provision` and `provision --preview` pass `--no-state`, so the approved Bicep is always deployed
instead of being skipped when azd's stored deployment state hash is unchanged. The preview passes `--output json`, and
`down` passes `--force` because the Gate 4 approval of the destroy preview replaces azd's prompt. The executor runs azd
from the project root. azd's own configuration and
extensions and the user's `az login` are left alone. `assertAzdIdentityMatchesBinding` is the preflight the executor
must pass before every provision: the active cloud, tenant, subscription and Azure CLI default subscription must equal
the approved target, and a missing or different value stops the run with `AZD_IDENTITY_MISMATCH` (identifiers are never
echoed). The approved target therefore requires `tenantId`.

### Unsupported surfaces

These fail closed with stable error codes: Terraform or extension `infra.provider`, `resources`, `platform`, `state`
and `cloud` in `azure.yaml`, `.bicepparam` and parameter substitution other than `${NAME}`, secret-like parameters, a
hook runner other than `sh`/`pwsh`, a hook script path that is missing, ambiguous, absolute or outside the project, an
`azure.yaml` `requiredVersions.azd` the bound azd does not meet or that uses more than simple comparators, environment
values that redirect the subscription, location, tenant, environment name or resource group, custom azd environment keys,
links, path traversal, YAML aliases and merge keys, local Bicep references that leave the bound tree, a root without its
own `bicepconfig.json` (so aliases and linter settings are never inherited from outside the tree) and oversize input.

### azd Prerequisite

Bicep runs require azd; Terraform runs do not. `config/toolchain.v1.json` pins the exact release (`core.azd`,
`compatibilitySet.azd`: 1.35.1, observed 2026-10-11) and `apex doctor`, including the MCP doctor, reports an
`executable:azd` check for Bicep runs. It fails with an install remedy when azd is missing, its version cannot be read,
or it differs from the pin in either direction, because the approved binding includes the azd version. The executor
enforces the same pin: a Bicep preview, apply or destroy stops with `AZD_NOT_FOUND`, `AZD_VERSION_UNAVAILABLE` or
`AZD_VERSION_MISMATCH` when azd is missing or is not exactly that release, and never falls back to another path.

## azd Bicep Executor

`AzdBicepProvider` is configured in `.apex/provider-config.json` with a `bicep` block of `cwd` (the generated azd
project root, which must be the accepted generated source), `environmentName`, `tenantId`, `location` and an optional
`cloud`. The subscription and resource group come from the run's exact resource-group target scope. Any other key,
including the retired `stackName`, `actionOnUnmanage`, `denySettingsMode`, `templateFile` and `resourceGroup` fields, is
rejected. When the project has no `.azure/<environment>/.env`, APEX writes the five allowlisted, non-secret keys from
the approved target; an existing file is bound as it is and never overwritten. The environment name must be a valid
APEX environment name (checked before any path is built), and an existing environment must itself name the approved
resource group in `AZURE_RESOURCE_GROUP` (`AZD_ENV_TARGET_MISMATCH` otherwise), so azd cannot derive another group.

| Operation | azd command               | Notes                                                                |
| --------- | ------------------------- | -------------------------------------------------------------------- |
| Preview   | `azd provision --preview` | azd's what-if, built on ARM what-if; a prediction against live Azure |
| Apply     | `azd provision`           | Needs its own current preview and Gate 4 approval                    |
| Destroy   | `azd down`                | Needs its own current destroy preview and approval; never `--purge`  |

Before every preview, apply and destroy the executor verifies the pinned azd version, re-inspects the azd binding and
runs the identity preflight (cloud, tenant and subscription from `az account show` and the bound azd environment). At
apply and destroy it additionally requires that the binding is unchanged, that the azd version equals the one bound at
preview, and that the owned state below is unchanged. Layered projects fail with `AZD_LAYER_UNSUPPORTED`, because azd
previews one layer at a time. The preview hash binds the azd binding hash, the owned-state hash and the policy
validation receipt, so reusing a preview across apply and destroy, an expired or superseded preview, a stale owner
epoch or recipient and a changed input all stop before azd runs.

### Preview format

`azd provision --preview --output json` prints newline-delimited console events. The preview is the single event whose
`data` is a list (or `null` when nothing would change) of `{ Operation, Type, Name, PropertyDeltas }`. It carries no
resource ID, so each change is resolved to an accepted resource ID by ARM type and name; a material change that does
not resolve to exactly one accepted resource blocks the preview. `Create` maps to create, `Modify` and `Deploy` to
update, `Delete` to delete, `NoChange` and `Ignore` to no-op, and `Unsupported` blocks. azd omits resources that have
neither a before nor an after state, and the JSON shape is not a documented azd contract, so a different azd release
needs requalification (the exact pin and CP-30 cover this).

### Ownership, inventory and destroy

Stacks give no ownership or deny settings. A resource belongs to the azd environment when it lives in the approved
resource group and that group carries the tag `azd-env-name` with the environment name, which is how azd itself finds
an environment's resources. The group must be tagged before provisioning, and no other group may carry that tag for the
environment; otherwise the preview carries a blocker. The kernel's logical-resource manifest still decides which
resources are managed, protected (`existing`) or unaccepted.

- **Inventory.** After apply, the executor lists the group's resources with read-only `az resource list` and reads each
  planned child or extension resource that the listing omits by exact ID with `az resource show`. The kernel requires
  every owned resource to match an accepted managed ID; protected `existing` resources are excluded rather than owned.
- **Destroy.** `azd down` has no preview of its own, and it deletes the whole resource group of the latest deployment.
  The destroy preview therefore lists every top-level resource Azure reports in the approved group, plus accepted child
  resources the listing omits (read by exact ID), as deletes. Unaccepted child or extension resources under a listed
  resource are deleted with it and cannot be enumerated, so the approval material says the list is not exhaustive. The
  existing coverage check blocks the preview when any listed resource is not accepted managed ownership or is a
  protected existing resource. The list is
  bound into the approval through the owned-state hash, and the destroy is refused when the group's tagging or contents
  changed after preview. `--purge` is never used, so soft-deleted resources such as Key Vaults stay recoverable and keep
  their names reserved; the approval material says so.
- **Not provided.** Deny settings, action-on-unmanage cleanup and stack-based unmanaged-resource detection do not exist.
  Azure Policy, RBAC and deny assignments from the landing zone are the compensating controls (DECISION-037).

Parameter values that azd resolves at provision time, for example `$(secretOrRandomPassword ...)` Key Vault functions in
`main.parameters.json`, are not part of the preview; the binding hashes the parameter file text only.

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

The Gate 3 binding document displays this scope. Bicep requests include only approved managed IDs, and material
azd preview changes outside that exact set block preview. Observed inventory of the azd environment's resource group
must contain only unique approved managed IDs before deployment completion is recorded. Protected existing IDs are
never added to the managed set. Ancillary inventory entries retain distinct identities under their accepted logical parent.
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
| Preview           | `azd provision --preview` (azd what-if)      | Saved Terraform plan plus JSON rendering                       |
| Apply             | `azd provision`; destroy with `azd down`     | Apply the exact saved plan                                     |
| Preview lifetime  | Up to the configured Bicep TTL               | Up to the shorter configured Terraform TTL                     |
| State             | Azure and the azd environment tag            | Terraform backend; state must never be committed               |
| Provider metadata | Azure/Bicep schemas and AVM                  | Installed provider schema and bounded Registry client          |

The shipped defaults currently define a longer Bicep preview TTL than Terraform. Any dependency, target, owner,
recipient, generated IaC, or provider change invalidates stale proof.

## Support Boundary

### Native Validation Receipts

With an official native provider configured, validation-task completion executes fixed local checks against an isolated
copy of the accepted source. Bicep runs format across `**/*.bicep`, `build infra/main.bicep --stdout`, then lint across
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

When accepted Bicep bindings identify one unambiguous literal Log Analytics workspace, `storageDiagnostics` reports
bounded storage-service routing checks. Targets come from explicit storage `diagnosticSettings` workspace references or
native diagnostic-resource bindings, not model assertions. The evaluator requires blob, file, queue and table service
settings, exact literal account/service scope expressions emitted by the compiler, matching symbolic dependencies,
enabled `allLogs` (or all three storage operation categories), and enabled `Transaction` metrics to that workspace.
Missing scopes, categories or mismatched workspaces fail; modules and unresolved expressions remain unsupported.
Ambiguous or absent workspace intent does not produce a diagnostic target. Receipts bind source, output and target
digests and declare `fullBaselineEvaluated: false`; these checks do not credit the full security-baseline validator.

Native task completion requires executed evidence for every required validator, not merely caller-supplied entries.
For Bicep manifests containing only managed native resources with unique top-level symbolic execution addresses,
`resourceParity` compares captured compiler output with the accepted manifest: exact resource coverage, ARM types and
dependency sets. Its receipt binds source, compiler output, manifest and accepted binding hashes; only `outcome: pass`
credits the parity validator. An explicit diagnostic `scopeLogicalId` is supported only when the compiler's literal
`resourceId` expression matches that accepted target's type and full name, and the dependency is present. The native
adapter snapshots the binding before command execution. Extra/missing resources, type changes, scope substitutions and
dependency mismatches fail. Modules, nested template objects, existing declarations, loops, conditions, other explicit
scopes and expression-based dependencies remain unsupported. This does not
evaluate security properties or establish Terraform parity; those checks remain independently required.

The `securityBaseline` receipt supports one bounded profile, `bicep-storage-only-baseline-v1`: every managed account
must have exactly four storage services and their four scoped diagnostics, with no other resource types. It requires
passing compiled parity, the four storage hardening properties, disabled public networking, OAuth by default, deny-only
network ACLs without bypass or IP/VNet allow rules, system-assigned identity, Microsoft-managed encryption with
infrastructure encryption, and blob/file encryption enabled. Diagnostic workspace references come from the accepted
binding. Missing controls, credential-like content and diagnostic mismatches fail; unsupported resource sets or
expressions cannot pass. The receipt binds source, compiler output, manifest and binding hashes. Only a passing result
credits validation for the supported configuration. Nonempty template parameters, variables and outputs, unknown template
sections, additional account controls, and nonempty storage-service configuration remain unsupported rather than ignored.
The supported property allowlist is intentionally closed until additional settings receive executable checks. A pass
credits the security validator. This deliberately strict profile does not implement arbitrary exceptions or mixed-service
baselines, prove RBAC/data-plane access, or establish live diagnostic delivery.

Native preview also rejects a prior completion containing required simulated or missing evidence, before provider
commands run. Explicit simulated adapters remain available for offline tests and cannot establish production readiness.
The complete storage-only profile can finish Bicep source validation without opening Gate 4. General Bicep workloads and
Terraform still lack complete baseline/parity execution and remain blocked when required evidence is unavailable.
Preview implementation tests use explicitly simulated business evidence where necessary; their success is not evidence
that a production prerequisite has been satisfied.

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

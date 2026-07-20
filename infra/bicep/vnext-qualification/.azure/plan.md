# Azure Deployment Plan

> **Status:** Planning
>
> **Architecture change:** GitHub Environment reviewer protection is no longer part of the APEX approval model. APEX
> Gate 4 remains the sole human approval and must be recorded locally against the exact rendered preview before CI
> handoff. The unprotected Environment scopes OIDC, variables, and secrets only.

Generated: 2026-07-20 UTC

---

## 1. Project Overview

**Goal:** Prepare the destination-owned `vnext-qualification` control plane for exact-head GitHub OIDC, writer-transfer,
Bicep, and Terraform live qualification under issue `#9`.

**Path:** Add Components

This plan prepares a non-production sandbox. It does not dispatch the live workflow, approve Gate 4, apply or destroy a
qualification workload, publish packages, or authorize production Terraform CI apply.

## 2. Requirements

| Attribute         | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| Classification    | Development sandbox                                                |
| Scale             | Small                                                              |
| Budget            | Cost-Optimized                                                     |
| **Subscription**  | `apex-shared` (`b47d2942-f5ad-4d3c-b28e-c23e4f83d97e`) - approved  |
| **Tenant**        | `30bac921-1547-4b1e-8445-72455da783f1`                             |
| **Location**      | `swedencentral` - approved                                         |
| Repository        | `jonathan-vella/apex-vnext`                                        |
| Candidate base    | `751a5fc2c94b49faad8e6e1eaff06c08f7317bae`                         |
| GitHub boundary   | Unprotected Environment `vnext-qualification` for OIDC/config only |
| Approval boundary | Local APEX Gate 4 decision bound to the exact preview              |

The provider metadata lists Sweden Central for Storage Accounts and Log Analytics. `Microsoft.Storage`,
`Microsoft.OperationalInsights`, and `Microsoft.Quota` were registered with explicit maintainer authorization and
verified through Azure Resource Manager on 2026-07-20. Storage quota discovery reports a 250-account limit with zero
accounts in use. Live policy discovery found no allowed-location list. Validation, what-if, bootstrap, identity, and
GitHub configuration remain outside the provider-registration authorization.

## 3. Components Detected

| Component                 | Type                 | Technology                       | Path                                              |
| ------------------------- | -------------------- | -------------------------------- | ------------------------------------------------- |
| Qualification bootstrap   | Control plane        | Subscription-scope Bicep + AVM   | `infra/bicep/vnext-qualification/bootstrap.bicep` |
| Bicep lifecycle workload  | Qualification target | Resource-group Bicep + AVM       | `infra/bicep/vnext-qualification/main.bicep`      |
| Terraform lifecycle       | Qualification target | Terraform + AVM                  | `infra/terraform/vnext-qualification/`            |
| GitHub protected workflow | Approval/CI boundary | GitHub Actions + Environment     | `.github/workflows/vnext-live-qualification.yml`  |
| Handoff launcher          | Writer transfer      | Node.js + Azure CLI + GitHub CLI | `tools/scripts/vnext-live-handoff.mjs`            |
| Evidence lifecycle        | Release evidence     | Versioned JSON contracts         | `tools/scripts/live-qualification.mjs`            |

## 4. Recipe Selection

**Selected:** Bicep for the Azure bootstrap, Azure CLI for Entra federation, and GitHub CLI/API for repository controls.

**Rationale:** The committed subscription-scope Bicep template is the reviewed source of truth for Azure resources and
least-privilege assignments. Microsoft Entra application and federated credential creation use Microsoft Graph rather
than ARM. GitHub Environment configuration is repository state and cannot be expressed by this Bicep deployment.
No `azure.yaml` is required because the qualification runtime intentionally uses native Bicep and Terraform operations.

## 5. Architecture

**Stack:** Entra-authenticated, default-deny qualification control plane

### Service Mapping

| Component                 | Azure Service                      | SKU / Configuration                      |
| ------------------------- | ---------------------------------- | ---------------------------------------- |
| Control resource group    | Microsoft.Resources/resourceGroups | `rg-vnext-qualification-control`         |
| Bicep resource group      | Microsoft.Resources/resourceGroups | `rg-vnext-qualification-bicep`           |
| Terraform resource group  | Microsoft.Resources/resourceGroups | `rg-vnext-qualification-terraform`       |
| Qualification diagnostics | Log Analytics workspace            | `PerGB2018`, 0.1-GB daily cap, 30 days   |
| Backend and handoff store | StorageV2                          | Standard LRS, TLS 1.2, HTTPS only        |
| Bicep workload marker     | StorageV2                          | Standard LRS, deployment-stack ownership |
| Terraform workload marker | StorageV2                          | Standard LRS, exact saved-plan ownership |
| Deployment identity       | Microsoft Entra service principal  | GitHub OIDC only; no client secret       |
| Approval boundary         | APEX Gate 4                        | Local exact-preview approval             |

### Supporting Services

| Service                         | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| Blob container `tfstate`        | Entra-authenticated Terraform state and lease locking                  |
| Blob container `handoff`        | Encrypted local-to-CI and CI-to-local authority envelopes              |
| Azure Monitor diagnostics       | Account and Blob logs/metrics without local authentication             |
| GitHub Actions artifact service | Encrypted imported provider authority and exact Terraform plan         |
| Federated identity credential   | Trust `repo:jonathan-vella/apex-vnext:environment:vnext-qualification` |

### Security Contract

- The backend has public network access `Disabled` at rest and a default-deny firewall.
- Shared-key authorization, anonymous Blob access, and client secrets remain disabled.
- The GitHub identity receives Contributor only on the two workload resource groups, Log Analytics Contributor on the
  qualification workspace, and storage roles at the backend account or container scopes defined by the template. The
  workspace role permits linked diagnostic settings without broadening access to either workload resource group.
- The local uploader receives backend firewall management plus data access on the `handoff` and `tfstate` containers.
  The `tfstate` assignment is required to create exact local Terraform previews and is not scoped to the account.
- Local APEX creates the native Bicep/Terraform preview, renders it for the maintainer, and records Gate 4 through the
  existing `tty` mechanism. The approval binds the preview hash, dependency revision, writer epoch, recipient, and
  expiry before any state or provider authority is exported to CI.
- CI is not permitted to create or replace Gate 4 approval. It imports the already-approved state and exact provider
  authority, accepts the one-hop writer transfer, and deploys only the imported approved preview.
- The GitHub Environment does not attest human review. It is only an OIDC subject and a scope for variables and secrets.
- The exact ten-tag project qualification contract is used for every resource group and resource even though current
  `apex-shared` policy requires no tags.
- No transient public-endpoint exception is authorized for `apex-shared`. Workflow dispatch remains blocked until
  Governance Discovery records a newly authorized, active exception with at least 75 minutes remaining.

## 6. Provisioning Limit Checklist

### Phase 1: Resource Inventory

The complete issue `#9` lifecycle includes the bootstrap plus one Bicep and one Terraform workload storage account.

| Resource Type                                 | Number to Deploy | Total After Deployment | Limit / Quota   | Notes                                                        |
| --------------------------------------------- | ---------------- | ---------------------- | --------------- | ------------------------------------------------------------ |
| Microsoft.Resources/resourceGroups            | 3                | 5                      | 980             | Current subscription count 2; official ARM limit             |
| Microsoft.Storage/storageAccounts             | 3                | 3                      | 250             | Current count 0; provider, quota, and usage APIs pass         |
| Microsoft.OperationalInsights/workspaces      | 1                | 1                      | No count limit  | Current count 0; provider registered                         |
| Microsoft.Authorization/roleAssignments       | 8                | 21                     | 4,000           | Current visible assignments 13; official RBAC limit          |
| Microsoft.Insights/diagnosticSettings         | 6                | 1 per target resource  | 5 per resource  | One account and one Blob-service setting per storage account |
| Microsoft Entra application/service principal | 1 pair           | 1 pair                 | Tenant governed | No matching application exists; no API permissions or secret |
| Microsoft Entra federated credentials         | 1                | 1                      | App governed    | One Environment-subject credential for protected jobs        |

### Phase 2: Quota and Capacity Sources

| Resource family | Primary result                                    | Fallback / source                                  | Capacity decision                                  |
| --------------- | ------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| Storage         | Quota limit 250; authoritative usage 0           | Azure Resource Graph count                         | Pass: 3 of 250                                     |
| Log Analytics   | Provider registered; no count-based quota exposed | Resource count and regional provider metadata      | Pass: 0 current; 1 planned                         |
| Resource groups | Quota API not applicable                          | Azure CLI count plus Azure Resource Manager limits | Pass: 5 of 980                                     |
| RBAC            | Quota API not applicable                          | Azure CLI count plus Azure RBAC limits             | Pass: 21 of 4,000                                  |
| Diagnostics     | Per-resource hard limit                           | Azure Monitor service limits                       | Pass: 1 setting on each diagnostic target, limit 5 |

**Status:** Capacity checks pass. Deployment remains blocked pending separately authorized policy-aware validation,
replacement Entra/OIDC and bootstrap preparation, a current governance exception, and exact-preview Gate 4 approval.

Official limit references:

- [Azure subscription and service limits](https://learn.microsoft.com/azure/azure-resource-manager/management/azure-subscription-service-limits)
- [Azure Monitor service limits](https://learn.microsoft.com/azure/azure-monitor/fundamentals/service-limits)

## 7. Execution Checklist

### Phase 1: Planning

- [x] Analyze workspace
- [x] Gather requirements from issue `#9`, the PRD, ADR, and live qualification procedure
- [x] Confirm subscription and location with the maintainer
- [x] Prepare the complete bootstrap and workload resource inventory
- [x] Fetch quotas and validate capacity after required providers are registered
- [x] Scan Bicep, Terraform, workflow, launcher, context validator, governance, and SKU inputs
- [x] Select native Bicep, Azure CLI, and GitHub API recipes
- [x] Plan identity, Azure, GitHub, evidence, and cleanup boundaries
- [x] Maintainer selected `apex-shared` as the replacement subscription

### Phase 2: Preparation

- [x] Research the Bicep, Terraform, Entra federation, GitHub Environment, and RBAC components
- [x] Confirm provisioning limits after provider registration
- [x] Verify the committed Bicep and Terraform artifacts need no generation changes
- [x] Review the committed templates against governance, AVM, identity, network, and secret-handling controls
- [x] Update this plan to `Ready for Validation`

### Phase 2B: Approval Model Replacement

- [x] Confirm that GitHub independent-reviewer protection is not required for APEX
- [x] Select local APEX Gate 4 as the sole human deployment approval
- [x] Allow real apply/destroy only in the isolated non-production qualification sandbox
- [x] Record the replacement in the append-only decision index and a superseding ADR
- [x] Move native preview creation and rendering to the local launcher
- [x] Require local Gate 4 approval before dispatch and bind the intended CI apply recipient
- [x] Export already-approved state and exact provider authority directly to the CI apply recipient
- [x] Remove in-workflow approval creation and the preview-to-apply writer hop
- [x] Make structural validation reject any CI-created Gate 4 approval
- [x] Add mutation tests for missing imported approval, changed preview, recipient mismatch, stale epoch, and expiry
- [x] Update workflow, security, testing, CLI, and live-qualification documentation
- [ ] Re-run `azure-validate` and return this plan to `Validated`

### Phase 3: Validation

- [ ] Invoke `azure-validate` against `apex-shared`
- [ ] Re-run Bicep build and lint
- [ ] Validate Terraform with backend disabled
- [ ] Run exact subscription template validation and policy-aware what-if
- [ ] Run the IaC security baseline and AVM pin validators
- [ ] Run `npm run validate:vnext-live-workflow`
- [ ] Run `npm run test:vnext-live-workflow`
- [ ] Create and confirm the replacement federated credential in the current tenant
- [ ] Update this plan to `Validated` and populate validation proof

### Phase 4: Deployment and Live Ceremony

- [ ] Invoke `azure-deploy` for an approved `apex-shared` bootstrap deployment
- [ ] Create the replacement single-tenant Entra application and service principal without client credentials
- [ ] Add the current maintainer as application owner
- [ ] Add one GitHub Environment federated identity credential
- [ ] Run subscription-scope Bicep what-if with the exact principals and ten-tag contract
- [ ] Deploy the reviewed qualification bootstrap only after a clean what-if
- [ ] Verify resource outputs, default-deny storage state, containers, diagnostics, and scoped RBAC
- [ ] Configure the existing unprotected `vnext-qualification` Environment for OIDC, variables, and secrets only
- [ ] Configure the remaining Environment secrets and nonsecret variables from verified deployment outputs
- [ ] Verify Environment names only; never read back or print secret values
- [ ] Record setup evidence and exact resource identifiers in issue `#9`
- [ ] Confirm backend public access is disabled, default action is deny, shared key is disabled, and no IP rules remain
- [ ] Confirm a newly authorized governance exception is active before any workflow dispatch
- [ ] Prepare an exact-head clean `main` consumer state for each IaC track
- [ ] Dispatch Bicep apply, retrieve authority, collect inventory/diagnosis, then separately approve destroy
- [ ] Dispatch Terraform apply using the exact encrypted saved plan, retrieve authority, then separately approve destroy
- [ ] Exercise failure recovery, cleanup verification, stale/wrong-recipient/expiry rejection, and promotion
- [ ] Validate and retain the final evidence manifest and rendered review view
- [ ] Update this plan to `Deployed` only after accepted apply/destroy/cleanup evidence exists

## 8. Validation Proof

The `azure-validate` workflow must replace this section with `apex-shared` evidence before the plan can be marked
`Validated`. The 2026-07-16 evidence for `noalz` is historical and does not authorize this subscription.

| Check                 | Command Run                                      | Result                                        | Timestamp            |
| --------------------- | ------------------------------------------------ | --------------------------------------------- | -------------------- |
| Azure authentication  | `az account show --subscription b47d2942-...`    | Pass                                          | 2026-07-20 UTC       |
| Live policy discovery | `discover.py --subscription b47d2942-... --refresh` | Pass: 6 assignments                        | 2026-07-20 UTC       |
| Resource inventory    | Explicit-subscription Azure CLI queries          | Pass: no qualification resources              | 2026-07-20 10:32 UTC |
| Provider readiness    | `az provider show`                               | Pass: all three required providers registered | 2026-07-20 10:32 UTC |
| Storage quota         | `az quota list`; `az storage account show-usage` | Pass: limit 250, current usage 0               | 2026-07-20 10:32 UTC |

**Validated by:** Pending

**Validation timestamp:** Pending

### Deployment Evidence

| Check                | Result                                                                       | Timestamp      |
| -------------------- | ---------------------------------------------------------------------------- | -------------- |
| Entra application    | No replacement application verified in the current tenant                    | Pending        |
| Federated credential | No replacement credential verified                                           | Pending        |
| Azure bootstrap      | No `apex-shared` bootstrap deployment exists                                 | Pending        |
| Azure resources      | No qualification resource groups or resources exist                          | 2026-07-20 UTC |
| Backend posture      | No replacement backend exists                                                | Pending        |
| GitHub configuration | Environment still contains retired-subscription outputs and must not be used | 2026-07-20 UTC |

## 9. Files to Generate or Update

| File                                              | Purpose                                                    | Status                       |
| ------------------------------------------------- | ---------------------------------------------------------- | ---------------------------- |
| `infra/bicep/vnext-qualification/.azure/plan.md`  | Setup, validation, deployment, and evidence plan           | Created                      |
| `infra/bicep/vnext-qualification/bootstrap.bicep` | Reviewed subscription bootstrap                            | Existing; no change expected |
| `infra/bicep/vnext-qualification/main.bicep`      | Bicep lifecycle workload                                   | Existing; no change expected |
| `infra/terraform/vnext-qualification/`            | Terraform lifecycle workload                               | Existing; no change expected |
| Local mode-0600 transport key outside Git         | Shared encrypted-envelope key material                     | Create only after approval   |
| GitHub Environment configuration                  | OIDC subject, secrets, and variables; no reviewer rule     | Pending implementation       |
| Entra application and federated credential        | Destination repository OIDC trust                          | Pending replacement          |
| Azure bootstrap resources                         | Backend, workspace, resource groups, diagnostics, and RBAC | Not deployed                 |

## 10. Rollback and Cleanup

- Preparation creates no client secret and grants no Microsoft Graph application permissions.
- Before a live workload exists, rollback can remove the GitHub Environment, federated credential, application, and
  bootstrap resource groups only through a separate destructive-action approval.
- During qualification, workload destroy uses a fresh exact preview and Gate 4 approval for each track.
- Backend and control-plane teardown is not implicit in workload destroy and requires a separate reviewed cleanup plan.
- A failed firewall session must remove the exact `/32`, restore public network access to `Disabled`, remove
  `SecurityControl=Ignore`, and verify both final states before the run can be accepted.

## 11. Replacement Approval Flow

```text
clean exact-head local checkout
  -> native preview under bounded backend firewall session
  -> deterministic preview rendering
  -> maintainer runs local APEX Gate 4 approve/reject
  -> approved state + exact provider authority encrypted for CI apply recipient
  -> unprotected GitHub Environment supplies OIDC/config only
  -> CI imports approval and authority; CI cannot create approval
  -> exact approved apply or destroy
  -> inventory, cleanup, evidence, and authority return
```

The local approval is valid only while the preview, writer lease, dependency revision, intended recipient, and transport
envelopes remain current. Any change requires a new preview and Gate 4 decision. A GitHub workflow dispatch is not itself
approval, and CI execution must fail when imported Gate 4 approval is missing or stale.

## 12. Next Steps

> Current: Provider registration and capacity checks complete; bootstrap remains unauthorized

1. Obtain separate explicit authorization before policy-aware validation/what-if, bootstrap, Entra/OIDC, or GitHub
  Environment mutation.
2. After authorization, run template validation and policy-aware what-if against `apex-shared`.
3. Deploy the approved bootstrap and create replacement Entra/OIDC configuration through the deployment workflow.
4. Replace all stale GitHub Environment outputs from verified bootstrap outputs.
5. Authorize a new bounded governance exception before any sandbox apply/destroy dispatch.

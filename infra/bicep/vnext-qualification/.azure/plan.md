# Azure Deployment Plan

> **Status:** Planning
>
> **Architecture change:** GitHub Environment reviewer protection is no longer part of the APEX approval model. APEX
> Gate 4 remains the sole human approval and must be recorded locally against the exact rendered preview before CI
> handoff. The unprotected Environment scopes OIDC, variables, and secrets only.

Generated: 2026-07-16 UTC

---

## 1. Project Overview

**Goal:** Prepare the destination-owned `vnext-qualification` control plane for exact-head GitHub OIDC, writer-transfer,
Bicep, and Terraform live qualification under issue `#9`.

**Path:** Add Components

This plan prepares a non-production sandbox. It does not dispatch the live workflow, approve Gate 4, apply or destroy a
qualification workload, publish packages, or authorize production Terraform CI apply.

## 2. Requirements

| Attribute        | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Classification   | Development sandbox                                                   |
| Scale            | Small                                                                 |
| Budget           | Cost-Optimized                                                        |
| **Subscription** | `noalz` (`00858ffc-dded-4f0f-8bbf-e17fff0d47d9`) - approved          |
| **Tenant**       | `Lord of the Cloud` (`2d04cb4c-999b-4e60-a3a7-e8993edc768b`)         |
| **Location**     | `swedencentral` - approved                                            |
| Repository       | `jonathan-vella/apex-vnext`                                           |
| Candidate base   | `436f3359f324400d3288b6b844ecb6b5a0e7e445`                            |
| GitHub boundary  | Unprotected Environment `vnext-qualification` for OIDC/config only    |
| Approval boundary | Local APEX Gate 4 decision bound to the exact preview                 |

The location supports Storage Accounts and Log Analytics, both providers are registered, and the inherited allowed
locations policy includes `swedencentral`.

## 3. Components Detected

| Component                 | Type                 | Technology                     | Path                                                   |
| ------------------------- | -------------------- | ------------------------------ | ------------------------------------------------------ |
| Qualification bootstrap   | Control plane        | Subscription-scope Bicep + AVM | `infra/bicep/vnext-qualification/bootstrap.bicep`      |
| Bicep lifecycle workload  | Qualification target | Resource-group Bicep + AVM     | `infra/bicep/vnext-qualification/main.bicep`           |
| Terraform lifecycle       | Qualification target | Terraform + AVM                | `infra/terraform/vnext-qualification/`                 |
| GitHub protected workflow | Approval/CI boundary | GitHub Actions + Environment   | `.github/workflows/vnext-live-qualification.yml`       |
| Handoff launcher          | Writer transfer      | Node.js + Azure CLI + GitHub CLI | `tools/scripts/vnext-live-handoff.mjs`               |
| Evidence lifecycle        | Release evidence     | Versioned JSON contracts       | `tools/scripts/live-qualification.mjs`                 |

## 4. Recipe Selection

**Selected:** Bicep for the Azure bootstrap, Azure CLI for Entra federation, and GitHub CLI/API for repository controls.

**Rationale:** The committed subscription-scope Bicep template is the reviewed source of truth for Azure resources and
least-privilege assignments. Microsoft Entra application and federated credential creation use Microsoft Graph rather
than ARM. GitHub Environment configuration is repository state and cannot be expressed by this Bicep deployment.
No `azure.yaml` is required because the qualification runtime intentionally uses native Bicep and Terraform operations.

## 5. Architecture

**Stack:** Entra-authenticated, default-deny qualification control plane

### Service Mapping

| Component                  | Azure Service                         | SKU / Configuration                      |
| -------------------------- | ------------------------------------- | ---------------------------------------- |
| Control resource group     | Microsoft.Resources/resourceGroups    | `rg-vnext-qualification-control`         |
| Bicep resource group       | Microsoft.Resources/resourceGroups    | `rg-vnext-qualification-bicep`           |
| Terraform resource group   | Microsoft.Resources/resourceGroups    | `rg-vnext-qualification-terraform`       |
| Qualification diagnostics  | Log Analytics workspace               | `PerGB2018`, 0.1-GB daily cap, 30 days   |
| Backend and handoff store  | StorageV2                             | Standard LRS, TLS 1.2, HTTPS only        |
| Bicep workload marker      | StorageV2                             | Standard LRS, deployment-stack ownership |
| Terraform workload marker  | StorageV2                             | Standard LRS, exact saved-plan ownership |
| Deployment identity        | Microsoft Entra service principal     | GitHub OIDC only; no client secret        |
| Approval boundary          | APEX Gate 4                            | Local exact-preview approval              |

### Supporting Services

| Service                         | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Blob container `tfstate`        | Entra-authenticated Terraform state and lease locking                        |
| Blob container `handoff`        | Encrypted local-to-CI and CI-to-local authority envelopes                    |
| Azure Monitor diagnostics       | Account and Blob logs/metrics without local authentication                   |
| GitHub Actions artifact service | Encrypted imported provider authority and exact Terraform plan               |
| Federated identity credential   | Trust `repo:jonathan-vella/apex-vnext:environment:vnext-qualification`        |

### Security Contract

- The backend has public network access `Disabled` at rest and a default-deny firewall.
- Shared-key authorization, anonymous Blob access, and client secrets remain disabled.
- The GitHub identity receives Contributor only on the two workload resource groups, Log Analytics Contributor on the
  qualification workspace, and storage roles at the backend account or container scopes defined by the template. The
  workspace role permits linked diagnostic settings without broadening access to either workload resource group.
- The local uploader receives only backend firewall management and `handoff` container data access.
- Local APEX creates the native Bicep/Terraform preview, renders it for the maintainer, and records Gate 4 through the
  existing `tty` mechanism. The approval binds the preview hash, dependency revision, writer epoch, recipient, and
  expiry before any state or provider authority is exported to CI.
- CI is not permitted to create or replace Gate 4 approval. It imports the already-approved state and exact provider
  authority, accepts the one-hop writer transfer, and deploys only the imported approved preview.
- The GitHub Environment does not attest human review. It is only an OIDC subject and a scope for variables and secrets.
- The exact ten-tag qualification contract is used for every resource group and resource.
- The current transient public-endpoint exception expired at `2026-07-16T12:50:34Z`. Bootstrap preparation may proceed,
  but workflow dispatch remains blocked until Governance Discovery records a newly authorized, active exception with at
  least 75 minutes remaining.

## 6. Provisioning Limit Checklist

### Phase 1: Resource Inventory

The complete issue `#9` lifecycle includes the bootstrap plus one Bicep and one Terraform workload storage account.

| Resource Type                                 | Number to Deploy | Total After Deployment | Limit / Quota | Notes |
| --------------------------------------------- | ---------------- | ---------------------- | ------------- | ----- |
| Microsoft.Resources/resourceGroups            | 3                | 17                     | 980           | Current Sweden Central count 14; official ARM limit |
| Microsoft.Storage/storageAccounts             | 3                | 6                      | 250           | Quota CLI `StorageAccounts`: usage 3, limit 250 |
| Microsoft.OperationalInsights/workspaces      | 1                | 7                      | No count limit | Current Sweden Central count 6; `PerGB2018` is not legacy Free |
| Microsoft.Authorization/roleAssignments       | 8                | 143                    | 4,000         | Current visible assignments 135; official RBAC limit |
| Microsoft.Insights/diagnosticSettings         | 6                | 1 per target resource  | 5 per resource | One account and one Blob-service setting per storage account |
| Microsoft Entra application/service principal | 1 pair           | 1 pair                 | Tenant governed | No matching application exists; no API permissions or secret |
| Microsoft Entra federated credentials         | 1                | 1                      | App governed  | One Environment-subject credential for protected jobs |

### Phase 2: Quota and Capacity Sources

| Resource family | Primary result | Fallback / source | Capacity decision |
| --------------- | -------------- | ----------------- | ----------------- |
| Storage         | Azure Quota CLI returned usage 3 and limit 250 | Microsoft Storage quota `StorageAccounts` | Pass: 6 of 250 |
| Log Analytics   | Azure Quota CLI returned `BadRequest` | Azure Resource Graph count plus Azure Monitor service limits | Pass: all nonlegacy tiers have no workspace count limit |
| Resource groups | Quota API not applicable | Azure CLI count plus Azure Resource Manager limits | Pass: 17 of 980 |
| RBAC            | Quota API not applicable | Azure CLI count plus Azure RBAC limits | Pass: 143 of 4,000 |
| Diagnostics     | Per-resource hard limit | Azure Monitor service limits | Pass: 1 setting on each diagnostic target, limit 5 |

**Status:** All planned resources are within published limits with substantial headroom.

Official limit references:

- [Azure subscription and service limits](https://learn.microsoft.com/azure/azure-resource-manager/management/azure-subscription-service-limits)
- [Azure Monitor service limits](https://learn.microsoft.com/azure/azure-monitor/fundamentals/service-limits)

## 7. Execution Checklist

### Phase 1: Planning

- [x] Analyze workspace
- [x] Gather requirements from issue `#9`, the PRD, ADR, and live qualification procedure
- [x] Confirm subscription and location with the maintainer
- [x] Prepare the complete bootstrap and workload resource inventory
- [x] Fetch quotas and validate capacity using Azure Quota CLI and documented fallbacks
- [x] Scan Bicep, Terraform, workflow, launcher, context validator, governance, and SKU inputs
- [x] Select native Bicep, Azure CLI, and GitHub API recipes
- [x] Plan identity, Azure, GitHub, evidence, and cleanup boundaries
- [x] Maintainer approved this plan

### Phase 2: Preparation

- [x] Research the Bicep, Terraform, Entra federation, GitHub Environment, and RBAC components
- [x] Confirm the approved Azure context and provisioning limits
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

- [x] Invoke `azure-validate`
- [x] Re-run Bicep build and lint
- [x] Validate Terraform with backend disabled
- [x] Run exact subscription template validation and policy-aware what-if
- [x] Run the IaC security baseline and AVM pin validators
- [x] Run `npm run validate:vnext-live-workflow`
- [x] Run `npm run test:vnext-live-workflow`
- [x] Confirm the federated credential has the exact destination Environment subject
- [x] Update this plan to `Validated` and populate validation proof

### Phase 4: Deployment and Live Ceremony

- [x] Invoke `azure-deploy` for the approved bootstrap deployment
- [x] Create the single-tenant Entra application and service principal without client credentials
- [x] Add the current maintainer as application owner
- [x] Add one GitHub Environment federated identity credential
- [x] Run subscription-scope Bicep what-if with the exact principals and ten-tag contract
- [x] Deploy the reviewed qualification bootstrap only after a clean what-if
- [x] Verify resource outputs, default-deny storage state, containers, diagnostics, and scoped RBAC
- [ ] Configure the existing unprotected `vnext-qualification` Environment for OIDC, variables, and secrets only
- [ ] Generate one mode-0600 transport key outside Git and install the same value as an Environment secret
- [ ] Configure the remaining Environment secrets and nonsecret variables from verified deployment outputs
- [ ] Verify Environment names only; never read back or print secret values
- [ ] Record setup evidence and exact resource identifiers in issue `#9`
- [x] Confirm backend public access is disabled, default action is deny, shared key is disabled, and no IP rules remain
- [ ] Confirm a newly authorized governance exception is active before any workflow dispatch
- [ ] Prepare an exact-head clean `main` consumer state for each IaC track
- [ ] Dispatch Bicep apply, retrieve authority, collect inventory/diagnosis, then separately approve destroy
- [ ] Dispatch Terraform apply using the exact encrypted saved plan, retrieve authority, then separately approve destroy
- [ ] Exercise failure recovery, cleanup verification, stale/wrong-recipient/expiry rejection, and promotion
- [ ] Validate and retain the final evidence manifest and rendered review view
- [ ] Update this plan to `Deployed` only after accepted apply/destroy/cleanup evidence exists

## 8. Validation Proof

The `azure-validate` workflow must populate this section before the plan can be marked `Validated`.

| Check | Command Run | Result | Timestamp |
| ----- | ----------- | ------ | --------- |
| Azure authentication | `az account get-access-token --resource https://management.azure.com/` | Pass | 2026-07-16T15:14:53Z |
| Bicep compilation and lint | `bicep build` and `bicep lint` for bootstrap and workload | Pass | 2026-07-16T15:14:53Z |
| ARM template validation | `az deployment sub validate` with exact principals and tags | Pass | 2026-07-16T15:14:53Z |
| ARM what-if | `az deployment sub what-if --result-format ResourceIdOnly` | Pass: 18 creates, no modifies or deletes | 2026-07-16T15:14:53Z |
| Terraform | `terraform fmt -check`, backend-disabled `init`, and `validate` | Pass | 2026-07-16T15:14:53Z |
| Security baseline | `npm run validate:iac-security-baseline` | Pass | 2026-07-16T15:14:53Z |
| AVM pins | `npm run validate:avm-versions:offline` | Pass | 2026-07-16T15:14:53Z |
| Live workflow structure | `npm run validate:vnext-live-workflow` | Pass | 2026-07-16T15:14:53Z |
| Live workflow mutations | `npm run test:vnext-live-workflow` | Pass: 51 tests | 2026-07-16T15:14:53Z |

**Validated by:** `azure-validate`

**Validation timestamp:** `2026-07-16T15:14:53Z`

### Deployment Evidence

| Check | Result | Timestamp |
| ----- | ------ | --------- |
| Entra application | Created `apex-vnext-qualification` without passwords or API permissions | 2026-07-16 UTC |
| Federated credential | Created for `repo:jonathan-vella/apex-vnext:environment:vnext-qualification` | 2026-07-16 UTC |
| Azure bootstrap | Deployment `vnext-qualification-bootstrap` succeeded | 2026-07-16T15:19:05Z |
| Azure resources | Three resource groups, workspace, backend account, containers, diagnostics, and RBAC verified | 2026-07-16 UTC |
| Backend posture | Public access Disabled, firewall Deny, no IP rules, shared key off, TLS 1.2, HTTPS only | 2026-07-16 UTC |
| GitHub protection | HTTP 422: current billing plan does not support required reviewers for this private repository | 2026-07-16 UTC |
| Approval decision | Required-reviewer protection deliberately removed from the APEX model; local Gate 4 retained | 2026-07-16 UTC |
| Partial GitHub state | Unprotected Environment exists with zero variables and zero secrets | 2026-07-16 UTC |

## 9. Files to Generate or Update

| File | Purpose | Status |
| ---- | ------- | ------ |
| `infra/bicep/vnext-qualification/.azure/plan.md` | Setup, validation, deployment, and evidence plan | Created |
| `infra/bicep/vnext-qualification/bootstrap.bicep` | Reviewed subscription bootstrap | Existing; no change expected |
| `infra/bicep/vnext-qualification/main.bicep` | Bicep lifecycle workload | Existing; no change expected |
| `infra/terraform/vnext-qualification/` | Terraform lifecycle workload | Existing; no change expected |
| Local mode-0600 transport key outside Git | Shared encrypted-envelope key material | Create only after approval |
| GitHub Environment configuration | OIDC subject, secrets, and variables; no reviewer rule | Pending implementation |
| Entra application and federated credential | Destination repository OIDC trust | Created and verified |
| Azure bootstrap resources | Backend, workspace, resource groups, diagnostics, and RBAC | Deployed and verified |

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

> Current: Approval-model replacement

1. Record the local-Gate-4 decision and superseding ADR.
2. Refactor launcher/workflow so local preview and approval precede direct CI apply handoff.
3. Validate the replacement and configure the unprotected Environment variables and secrets.
4. Refresh the expired governance exception before dispatching sandbox apply/destroy ceremonies.

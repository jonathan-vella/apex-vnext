<!-- ref:azuread-pattern-v1 -->

# `azuread_*` Pattern (Wave 2)

Records the **only** APEX-sanctioned shape for Microsoft Entra (Azure
AD) identities in Terraform: existing app registrations are the default,
new app-registration creation is opt-in behind a permission preflight,
and the committed `infra/terraform/{project}/` tree never embeds a GUID.

> Use for accepted Terraform intent involving Entra identities. Changes require explicit authorization and least privilege.

---

## Default: `entra_app_creation = existing` (LOW Graph blast radius)

```hcl
variable "deployer_object_id" {
  type        = string
  description = "objectId of the service principal running terraform apply (from 04-environment-manifest.json)."
  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.deployer_object_id))
    error_message = "deployer_object_id must be a GUID."
  }
}

variable "existing_api_app_object_id" {
  type        = string
  description = "Pre-created API app registration objectId (from 04-environment-manifest.json#environments.{env}.existing_app_reg_object_ids.api)."
  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.existing_api_app_object_id))
    error_message = "existing_api_app_object_id must be a GUID."
  }
}

data "azuread_application" "api" {
  object_id = var.existing_api_app_object_id
}

```

The deploy agent renders a per-environment `*.tfvars.json` from
`04-environment-manifest.json` and passes it via
`terraform apply -var-file=$(env)/main.tfvars.json`. The
`*.tfvars.json` files are NOT committed — they live in the deploy
agent's run directory and are written through
`validate-environment-manifest.mjs --redact` before any transcript
emits them.

---

## Opt-in: `entra_app_creation = create` (HIGH Graph blast radius)

Record explicit app-creation intent and identity prerequisites in the accepted requirements and plan before generating
an `azuread_application`. Confirm the least-privilege Microsoft Graph permissions for the requested operation. The
plan must not grant itself broader permissions or infer approval from an existing identity.

```hcl
resource "azuread_application" "api" {
  display_name = "${var.project}-${var.environment}-api"  # env scope baked into name
  owners = distinct(concat(
    [var.deployer_object_id],
    [for p in var.break_glass_object_ids : p]
  ))

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [owners]  # owners managed out-of-band by IAM team
  }
}

resource "azuread_service_principal" "api" {
  client_id = azuread_application.api.client_id

  lifecycle {
    prevent_destroy = true
  }
}
```

Hard requirements when `create` is in effect:

1. `lifecycle.prevent_destroy = true` on `azuread_application` AND
   `azuread_service_principal`.
2. `display_name` MUST embed the project + environment so cross-tenant
   ownership confusion is impossible.
3. `owners` MUST include the deployer object ID AND at least one
   break-glass principal from `environment-manifest.environments.{env}.principal_ids`.
4. The deploy agent's preflight calls
   `az ad signed-in-user show --query id` and an
   `az rest -m GET --uri https://graph.microsoft.com/v1.0/me/oauth2PermissionGrants`
   to validate `Application.ReadWrite.All` is granted. Missing → BLOCK.

---

## Anti-patterns (blocked by `validate:iac-security-baseline`)

```hcl
# ❌ NEVER — GUID literal in source.
data "azuread_application" "api" {
  object_id = "11111111-2222-3333-4444-555555555555"
}

# ❌ NEVER — silent app-reg creation without prevent_destroy.
resource "azuread_application" "api" {
  display_name = "api"
  # missing lifecycle block — Terraform can destroy + recreate on owner drift
}

# ❌ NEVER — env-aware ternary baked into module body.
locals {
  app_object_id = var.environment == "prod"
    ? "AAAA…"
    : "BBBB…"
}
```

---

## L2 attestation rows

For every Deny-effect policy that touches Entra (e.g. "Require app reg
naming convention", "Block default access grants"),
Terraform code generation must emit an attestation row in
`05-iac-handoff.json#governance_attestation.rows[]` pointing at the
exact `azuread_application` / `azuread_service_principal` block + line
that satisfies the policy. Deploy agent reads these instead of
re-walking the tree.

---

## Cross-references

- `tools/schemas/iac-contract.schema.json` → `identity.entra_app_creation`
- `tools/schemas/environment-manifest.schema.json` → `principal_ids`
- `customizations/.github/skills/apex-azure-defaults/references/security-baseline.md`
- `tools/scripts/validate-iac-handoff.mjs` (verifies attestation rows reference real lines)

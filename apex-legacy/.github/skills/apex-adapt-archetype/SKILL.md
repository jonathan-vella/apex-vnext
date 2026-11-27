---
name: apex-adapt-archetype
description: "Adapt the CoE archetype (Contoso University platform) project into the member's APEX repo, check the member's Azure Policy against the packaged set and preview the azd deployment. Use /apex-adapt-archetype in the built-in agent, not the Orchestrator. Never deploys."
argument-hint: "optional: tenant ID, subscription ID and suffix"
user-invocable: true
disable-model-invocation: true
---

# Adapt the CoE archetype

## Prerequisites

Run this skill in the built-in `agent` owner, not `01-Orchestrator`: the Orchestrator would route on to
`07b-Bicep Deploy`. A skill does not select the agent, model or tools. If the active owner is an APEX workflow
agent, **STOP** and ask the user to switch to the built-in agent. Do not widen tools to compensate.

The skill needs `execute`, `read` and `ask_user`. Use native `ask_user` for the inputs below. A declined or
cancelled question is not an answer, and nothing here counts as the user's approval to deploy.

## Inputs

The skill needs three values:

1. **Tenant ID**: the Entra tenant the workload subscription lives in.
2. **Subscription ID**: the workload subscription. It is already vended: it has `rg-spoke` with `vnet-spoke`,
   `snet-app`, `snet-pe` and `snet-sqlmi`.
3. **Suffix**: the member's 4 to 6 lowercase letters or digits, unique per member.

Get them in this order, and never ask for a value you already have:

1. Values already supplied in this conversation or in the argument.
2. `factory/.local/settings.json` (keys `tenantId`, `subscriptionId`, `suffix`). The file is gitignored, so the `read`
   tool may refuse it. Read it with `execute` instead: `cat factory/.local/settings.json`. Don't search for it in
   other places.
3. Ask with `ask_user` only for what is still missing, one question at a time.

If you found values in the file, show them once and ask a single yes/no question, "Use these?". Don't ask for
each value separately. Never write these values to a tracked file.

## Check before adapting

- `az account show --query tenantId -o tsv` matches the tenant ID. If not, run `az login --tenant <tenant-id>` and
  `az account set --subscription <subscription-id>`, and stop to tell the user if sign-in fails.
- `az group show -g rg-spoke --subscription <subscription-id>` succeeds, and
  `az network vnet subnet list -g rg-spoke --vnet-name vnet-spoke --subscription <subscription-id>` includes
  `snet-app`, `snet-pe` and `snet-sqlmi`. If the spoke is missing, stop and tell the user to ask the platform lead
  to run `scripts/Deploy-Vending.ps1` for their subscription. This skill never creates the spoke.
- `azd auth status` shows the user is signed in. azd keeps its own sign-in, separate from `az login`. If it is not
  signed in, run `azd auth login --use-device-code`, and stop to tell the user if sign-in fails.
- `az account show --subscription <subscription-id> --query user.type -o tsv` prints `user`. The SQL Managed
  Instance's Entra admin is the signed-in user, and `preflight.ps1` rejects a service principal.

## Lightweight governance check

The packaged `agent-output/university/04-governance-constraints.json` and `04-policy-property-map.json` are the CoE's
own review evidence from the build tenant. They are not a per-member deployment gate. This skill never overwrites
them, never runs APEX's drift routing and never triggers a Step 4 or Step 5 re-emission. The real gate for a
member's deployment is this check, the read-only `preflight.ps1` and `azd provision --preview`.

1. Run discovery against the member's tenant and subscription with the procedure in the
   [apex-azure-governance-discovery](../apex-azure-governance-discovery/SKILL.md) skill. Write the result only to
   `agent-output/university/tmp/`, which is gitignored. Never commit it and never write it to the tracked
   `04-governance-*` files.
2. Compare the discovery's Deny-effect findings with the packaged `04-governance-constraints.json` and
   `04-policy-property-map.json`, matched by policy definition ID and resource type.
3. If the member's tenant has a **new Deny-effect policy on a resource type this archetype deploys** that the packaged
   set doesn't account for, **stop and tell the user**. Name the policy and the resource type. Don't continue on a
   plan or Bicep that no longer matches what passed review.
4. Otherwise continue. Don't re-stamp, re-emit or hand-edit any hash or signature field (`l1m_ref.sha256`,
   `tree_hash`, `supporting_inputs` or `cache_inputs.artifact_sha` in any `challenge-findings-*.json`). They stay
   exactly as packaged.

This check is part of the skill. The contract stays three inputs.

## Set the azd environment and preview

1. From `infra/bicep/university/`, run `azd env new <suffix>`.
2. Set the azd environment values from the three inputs: tenant ID, subscription ID, suffix. Set no others by hand.
3. Derive the hub's region the way `preflight.ps1` does: the spoke VNet's `Connected` peering points at the hub, and
   the hub VNet's `location` is the region. Run `azd env set AZURE_LOCATION <that region>`. azd needs this core value
   before it will run provisioning on a fresh environment.
4. Run `./scripts/preflight.ps1` **in the same shell session**, right after step 3. It is read-only. It validates the
   prerequisites against the live subscription and sets `AZURE_LOCATION`, `LOG_ANALYTICS_WORKSPACE_ID`,
   `SQLMI_DIRECTORY_IDENTITY_ID`, `DEPLOYER_OBJECT_ID` and `DEPLOYER_UPN` as process environment variables for the
   next command. This step is required: `azd provision --preview` compiles `main.bicepparam`'s
   `readEnvironmentVariable()` calls before the `preprovision` hook runs, so skipping it fails with `BCP427`.
5. Run `azd provision --preview` **in that same shell session** and show the user the full output. Tell the user the
   preview lists only resource types azd has display names for. It omits the SQL Managed Instance, the UAMI, role
   assignments, diagnostic settings and the maintenance schedule, even though they are in the template and will be
   created. A missing row is expected.

## Stop here

This skill never runs `azd provision`, `azd down` or agent `07b-Bicep Deploy`, and nothing else that writes to Azure
beyond the preview above. Deployment is the member's own decision. Explain the preview, the cost while deployed
(see `archetype/README.md`) and the accepted lab risks in
[Accepted lab risks and adopter obligations](https://github.com/jonathan-vella/apex-factory-hackathon/blob/main/archetype/README.md#accepted-lab-risks-and-adopter-obligations),
then tell the user to run `azd provision` themselves when ready. azd stores the tenant and subscription IDs in the
gitignored `.azure/<env>/.env`. That is expected.

After `azd provision`, the `postprovision` hook runs `postdeploy-tests.ps1` and then `write-deployment-summary.ps1`,
which writes `agent-output/university/06-deployment-summary.md` from the live deployment record and tries to mark
Step 6 complete with `apex-recall`, because azd bypasses APEX Deploy (`07b`). The member's next step is
**As-Built** (agent `08-As-Built`, workflow Step 7).

Tell the user this adapts the archetype platform only (App Service, ACR, SQL MI, Storage, Service Bus, Key Vault and
Application Insights) into the existing spoke. It does not deploy or modernize the Contoso University app (that is
C6), and the SQL MI takes several minutes to provision once `azd provision` runs.

---
description: "Adapt the CoE archetype (Contoso University platform) project into the member's APEX repo and hand off to azd for deployment."
agent: agent
---

# Adapt the CoE archetype

This prompt runs in VS Code's built-in agent mode (not `01-Orchestrator`, which would
route on to `07b-Bicep Deploy`). It is self-contained: it asks for the three inputs,
runs a lightweight governance check directly, and sets up and previews the azd
deployment, all within this one prompt.

Ask the user for three inputs, in order, if not already supplied in this conversation.
If `factory/.local/settings.json` exists in the repo, read `tenantId`, `subscriptionId`
and `suffix` from it and show them for confirmation instead of asking:

1. **Tenant ID** — the Entra tenant the workload subscription lives in.
2. **Subscription ID** — the workload subscription (already vended: it has `rg-spoke`
   with `vnet-spoke`, `snet-app`, `snet-pe` and `snet-sqlmi`).
3. **Suffix** — the member's 4–6 lowercase letters/digits suffix, unique per member.

## Prerequisites to check before adapting

- `az account show --query tenantId -o tsv` matches the supplied tenant ID. If not, run
  `az login --tenant <tenant-id>` and `az account set --subscription <subscription-id>`
  first, and stop to tell the user if sign-in fails.
- `az group show -g rg-spoke --subscription <subscription-id>` succeeds, and
  `az network vnet subnet list -g rg-spoke --vnet-name vnet-spoke --subscription <subscription-id>`
  includes `snet-app`, `snet-pe` and `snet-sqlmi`. If the spoke is missing, stop and tell
  the user to ask their platform lead to run `scripts/Deploy-Vending.ps1` for their
  subscription (only the platform lead can; members can't) — this prompt never creates
  the spoke.
- `azd auth status` shows you're signed in. `azd` keeps its own sign-in, separate from
  `az login`; if it isn't signed in, run `azd auth login --use-device-code` and follow the
  prompt, and stop to tell the user if sign-in fails.
- `az account show --subscription <subscription-id> --query user.name -o tsv` is signed
  in interactively (not a service principal), because the SQL Managed Instance's Entra
  admin is the deploying user.

## Lightweight governance check before adapting

The packaged `agent-output/university/04-governance-constraints.json` and
`04-policy-property-map.json` are the CoE's own review evidence from the build
tenant — proof that the plan and Bicep in this archetype passed a real governance
review there. They are **not** a per-member deployment gate, and this prompt never
overwrites them, never runs APEX's drift routing, and never triggers a Step 4/5
re-emission. The real gate for a member's deployment is this check plus
`preflight.ps1` (read-only) and the `azd provision --preview` below.

1. Run discovery directly against the member's supplied tenant ID and subscription
   ID — the same ARM/Graph calls **04g-Governance** uses — and write the result only
   to `agent-output/university/tmp/` (gitignored; never commit it, never write it to
   the tracked `04-governance-*` files).
2. Compare the discovery's Deny-effect policy findings against the packaged
   `04-governance-constraints.json` and `04-policy-property-map.json`, matched by
   policy definition ID and resource type.
3. If the member's tenant has a **new Deny-effect policy on a resource type this
   archetype deploys** that isn't already accounted for in the packaged set, **stop
   and tell the user**: name the policy and the resource type, same as any other
   Stop-and-ask. Don't continue on a plan or Bicep that no longer matches what passed
   review.
4. Otherwise, continue straight to the azd steps below. Don't re-stamp, re-emit, or
   hand-edit any hash or signature field (`l1m_ref.sha256`, `tree_hash`,
   `supporting_inputs`/`cache_inputs.artifact_sha` in any `challenge-findings-*.json`)
   — those stay exactly as packaged.

This check is part of this prompt, not a separate step the member runs: the contract
stays three inputs (tenant ID, subscription ID, suffix).

## Set the azd environment and preview

Once the governance check and the prerequisites pass:

1. From `infra/bicep/university/`, run `azd env new <suffix>`.
2. Set the azd environment values from the three inputs: tenant ID, subscription ID,
   suffix. Set no other values by hand yet.
3. Derive the hub's region the same way `preflight.ps1` does (the spoke VNet's
   `Connected` peering points at the hub; read the hub VNet's `location`), then run
   `azd env set AZURE_LOCATION <that region>`. This has to happen before step 4:
   `AZURE_LOCATION` is a core azd environment value, and azd needs it present on a
   fresh environment before it will run provisioning at all, independent of anything
   `preflight.ps1` or `main.bicepparam` do with it later.
4. Run `./scripts/preflight.ps1` **in the same shell session**, right after step 3 and
   before the preview. It's read-only (creates nothing), validates the prerequisites
   again against the live subscription, and sets `AZURE_LOCATION` (reconfirming step 3),
   `LOG_ANALYTICS_WORKSPACE_ID`, `SQLMI_DIRECTORY_IDENTITY_ID`, `DEPLOYER_OBJECT_ID`
   and `DEPLOYER_UPN` as process environment variables that the next command inherits.
   This step is required: `azd provision --preview` compiles `main.bicepparam`'s
   `readEnvironmentVariable()` calls for these same five values *before* the
   `preprovision` hook that would otherwise derive them runs, so skipping this step
   fails with `BCP427` on a fresh azd environment (seen on the kit's validation run;
   it was worked around by running `azd hooks run
   preprovision` first — this step replaces that workaround with a documented one).
5. Run `azd provision --preview` **in that same shell session** and show the user the
   full output. Tell the user: this preview only lists resource types azd has display
   names for — on the kit's validation run it showed 12 creates and omitted the
   SQL Managed Instance, the UAMI, role assignments, diagnostic settings and the
   maintenance schedule, even though they are all in the template and will be created.
   Missing from the preview list is expected, not a sign the MI won't deploy.

**This prompt stops here.** It never runs `azd provision`, `azd down`, or agent
`07b-Bicep Deploy`, and never runs anything else that writes to Azure beyond the
`azd provision --preview` above. Deployment is the member's own decision: explain the
preview to the user (what it will create, the cost while deployed — see `README.md`),
and tell them to run `azd provision` themselves when ready. APEX Deploy (`07b`) stays
available as a separate, optional advanced path the member can choose to run instead —
this prompt does not hand off to it. `azd` stores the tenant and subscription IDs it
was given in the gitignored `.azure/<env>/.env` — expected, not a leak.

**Next step after the member runs `azd provision`:** the `postprovision` hook runs
`postdeploy-tests.ps1`, then `write-deployment-summary.ps1`, which writes
`agent-output/university/06-deployment-summary.md` from the live deployment record and
test results and tries to mark APEX Step 6 complete with `apex-recall` — because `azd`
bypasses APEX Deploy (`07b`), which would otherwise write that artifact. Tell the member
their next step is **As-Built** (agent `08-As-Built`, workflow step 7).

Tell the user: this adapts the CoE archetype platform only (App Service, ACR, SQL MI,
Storage, Service Bus, Key Vault, Application Insights) into the existing spoke. It does
not deploy or modernize the Contoso University app itself (that's a separate
modernization workstream, C6), and the SQL MI takes several minutes to
provision in the background once `azd provision` runs.

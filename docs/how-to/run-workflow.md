# Run The Workflow

> [Current Version](../../VERSION.md) | Move one environment and IaC track through typed tasks and human gates.

## Select The Project

The commands below describe current runtime behavior. The [planned COE import and change experience](../explanation/workflow-and-gates.md#planned-coe-reuse-and-change)
is a target requirement, not a new CLI command advertised by this guide. Use Windows via WSL2 without a devcontainer.

```bash
apex project list --json
apex project use --project PROJECT_ID --json
apex status --json
apex task next --json
```

## Add A Project

After initializing the customer workspace, add each additional workload without reinstalling the shared client
projection:

```bash
apex project create \
  --project payments \
  --name "Payments platform" \
  --environment dev \
  --target local \
  --iac bicep \
  --json
```

Project creation selects the new project's first run. Use `apex project use` to return to another workload.

## Promote A Project Environment

Each workload has one run per environment. After Gates 1 through 3 for the selected run are approved, create the next
environment run:

```bash
apex project promote \
  --environment test \
  --target resource-group:payments-test \
  --json
```

The promoted run remains in the same project and is selected automatically. It inherits only applicable upstream
evidence; it always needs its own code generation, validation, preview, and Gate 4 approval. Repeat for production
with its production target. Return to a prior environment with `apex project use --project payments --run RUN_ID`.

Use the APEX coordinator in Copilot CLI (`copilot --agent apex`) as the normal interactive entry point; the VS Code
Copilot harness runs the same agents. Ask it what is next: the `apex-next` skill names the owning agent and either
delegates a hidden worker or prints `/agent <name>` with a scope prompt. Direct CLI commands remain useful for
inspection and bounded operations.

## Handle Input Before Tasks

`nextTask` begins requirements with three adaptive panels: business discovery, combined workload and service
preferences, and security and compliance. Answer the exact pending request through the supported client. The client
submits a typed input object through MCP `recordInput`, including the request ID, expected head, owner epoch, and
nonempty answers.

Call `nextTask` again after every accepted round. Continue until it returns `status=task`; request context only for that
result. Recommendations are visible defaults or non-binding candidates and enter the journal only after confirmation.
Architecture selection, SKU decisions, and implementation stay with later workflow stages.

## Complete Creative Stages

The coordinator hands work to interactive specialists:

1. Requirements gathers workload outcomes and constraints.
2. Architect resolves design, cost, governance, assumptions and risk decisions.
3. Planner produces track-neutral implementation intent, binding, and environment inputs.
4. Operator handles preview, approval, deployment, recovery, and evidence.

Specialists delegate bounded code generation, review, and validation tasks when supported. Review findings return as a
single decision panel; permitted risk acceptance is time-bound, while revision creates a fresh artifact and review.

## Governance Freshness

### Consumer Collection Setup

Preview setup with `apex bootstrap governance-plan --file governance-setup.json --json`. The input uses the
`governance-setup-config-v1` contract:

```json
{
  "schemaVersion": "1.0.0",
  "repository": "OWNER/REPOSITORY",
  "tenantId": "11111111-1111-1111-1111-111111111111",
  "subscriptionId": "22222222-2222-2222-2222-222222222222",
  "identity": { "mode": "create", "displayName": "workload-policy-discovery" }
}
```

Replace example IDs with the target tenant and login/collection subscription. For an approved existing identity, use
`identity: { "mode": "reuse", "clientId": "...", "principalId": "..." }`. For management-group collection, also supply
`managementGroupId`; the subscription remains the login subscription. No credentials belong in this input.

The planner makes two bounded GitHub GETs for repository identity and OIDC subject settings. It binds the observed
subject prefix, including immutable owner/repository IDs when present, to the `governance` environment. Custom templates,
incomplete evidence or mismatched prefixes block planning instead of assuming an older name-only subject. See the
[GitHub OIDC subject reference](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims).

The result lists proposed Reader scope, variables with collection disabled, and pending identity/access, environment,
federation, workflow and review steps. `planHash` binds this view; it is not authorization. No files, identities, roles,
variables or workflows are changed. Live tenant/principal binding, effective permissions, environment protection and
OIDC login are not verified by this initial planner. The stricter existing-identity provisioning path is described below;
new identity creation and collection dispatch still require separate administrator actions. A central reviewed baseline
can use the existing import path without this setup.

For an existing approved application/service principal, preview the narrower provisioning step:

```bash
apex bootstrap governance-provision-plan --file governance-setup.json --json
apex bootstrap governance-provision --file governance-setup.json --expected-hash PLAN_HASH --yes --json
```

This executor supports `identity.mode: reuse` only. It verifies the active public-cloud tenant/subscription, single-tenant
application and enabled principal binding, live Reader definition, current federation/role inventory, and an existing
`governance` GitHub environment requiring reviewers, preventing self-review and allowing protected branches only.
Missing/inaccessible evidence, custom OIDC subjects, conflicting trust and constrained Reader assignments block writes.
The RBAC inventory includes inherited assignments at the collection scope; observed roles other than unconditional
Reader block federation rather than exposing existing write privileges. This is not a tenant-wide permissions audit:
other scopes, group-derived grants and Microsoft Graph application permissions remain unverified. Use a dedicated,
administrator-reviewed discovery identity; adding a Reader grant does not remove or limit other existing permissions.
Identity creation and environment protection setup still require an administrator; the executor does not weaken them.

After separate human confirmation of the exact plan, only missing exact federation and Reader assignment are created.
Fresh prerequisites and read-back checks surround each action; unchanged reruns do not create duplicates. Local
`.apex-governance-setup-*.json` receipts record verified or indeterminate actions. An uncertain outcome stops further work
and requires remote inspection and a new plan; no automatic rollback or retry is attempted. Retain those receipts.
GitHub variables, collection enablement/dispatch, baseline PR review/import and deployment authority remain unchanged.
Current executor qualification uses simulated command responses; no live provisioning was performed for this feature.

Installation includes the governance workflow, collector and schema in both supported client projections, copied from
the packaged canonical sources. The workflow is disabled by default. A consumer administrator configures the following
in the consumer GitHub repository; installing APEX does not provision identities, grant permissions or enable collection.

| Setting                                                       | Value                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GOVERNANCE_BASELINE_ENABLED`                                 | Repository or organization variable `true` to opt in.                                                          |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | OIDC client, tenant and login subscription IDs. Variables preferred; same-named secrets are supported for IDs. |
| `GOVERNANCE_MG_ID`                                            | Management-group root; leave empty for standalone collection.                                                  |
| `GOVERNANCE_SUBSCRIPTION_ID`                                  | Standalone target subscription; exactly one collection target must be set.                                     |
| `GOVERNANCE_MAX_SUBSCRIPTIONS`                                | Positive integer cap; default `100`. Incomplete coverage is not approval evidence.                             |

Create the protected GitHub environment `governance` and configure Entra workload identity federation for that repository
and environment. Grant the collection identity read access to the required policy scopes, separate from deployment
permissions. No client secret is required. Permit the workflow's token to create pull requests under repository policy.
Collection is scheduled weekly or started manually through GitHub Actions; the enable variable must be true for either.
Only baseline JSON is proposed in a review PR. No artifact upload or automatic merge is performed. After review and merge,
update the consumer checkout before selecting the file. Repository updates preserve local edits through normal managed-file
conflict handling; do not assume installing/updating APEX overwrites consumer workflow customizations.

### Select Or Renew

Before the discovery stage, `apex bootstrap baseline-check --path baseline.json --json` checks a reviewed central
baseline against the selected run's target and freshness rules. The wizard's central-baseline choice uses this same
read-only check after a project and target have been created. Workspace-only bootstrap defers this target-bound check.
A `ready` result includes the candidate hash and observation time but does not establish human review,
import the baseline, change the journal or approve a gate. Acceptance remains at the normal discovery stage below.

Governance discovery runs after Gate 1 and before Architecture. Import the reviewed JSON snapshot for the run's target
through the governance-discovery task. Azure Policy remains authoritative; a snapshot is evidence, not permission to
override a policy. The consumer owns the collection workflow and its GitHub configuration; do not commit Azure
credentials.

Without a reviewed subscription baseline, import the shipped ALZ Corp reference baseline instead. Local targets always
use it:

```bash
apex governance import --reference --json
```

The reference comes from a pinned Azure Landing Zones Library release (root, landing zones and corp archetypes). It is
an assumption, not your policy: a subscription target can design, price and pass Gate 2 on it, but planning requires
the reviewed subscription baseline. Replace it with `apex governance revise` (below) before Gate 3.

The Architect maps every enforcing policy (deny, modify, deployIfNotExists) to a designed component inside
Architecture. APEX marks policies whose resource types match no component `not-applicable`; every other
`not-applicable` needs a reason. The Architecture review checks the map before Gate 2.

Imported snapshots less than 30 days old can be reused. Refresh is optional, including before deployment. The runtime
measures age from successful Azure collection, not file download, import or commit time. At exactly 30 days, imported
evidence blocks new planning, preview and deployment approval until refreshed evidence is accepted. Missing, incomplete,
future-dated or wrong-scope evidence remains blocked independently of age; existing preview expiry rules still apply.

Select a reviewed candidate before import:

```bash
apex governance select --path .github/data/governance-policy-baseline.json --json
```

The kernel question shows collection age and date. Below 30 days it offers `reuse` (recommended) or `refresh`; at
30 days only `refresh` is permitted. The managed Operator submits your answer through `recordInput`; no default is
silently recorded. Pending questions and answers survive restart, and selecting the same answered candidate returns
the recorded choice rather than asking again. Questions expire after 24 hours; reuse is rechecked against snapshot age.

If an optional refresh fails and the same prior file is still usable, explicitly reconsider the decision with
`apex governance select --path .github/data/governance-policy-baseline.json --reopen --json`. This creates a new question;
it does not automatically choose reuse or erase the earlier answer. At 30 days, only refresh remains available.

Selection does not import or contact Azure. A pending refresh blocks progression, preview and new approval until a
newer complete collection replaces the selected file and is explicitly imported. Automatic collection dispatch is not
yet implemented: use the consumer collection workflow, not an invented local discovery command. Import with:

```bash
apex governance import --path .github/data/governance-policy-baseline.json --json
```

Import verifies the selected path and exact candidate bytes for reuse. Refresh requires a newer observation at that
path; changed files cannot silently replace a pending reuse decision. A direct import is permitted only at the active
governance-discovery task for bounded automation. Human gate approvals remain separate.

After initial import, the same operation accepts a newer observation only when the complete selected subscription
content is unchanged, excluding collection timestamps and legacy TTL fields. It records a separate observation receipt
and preserves accepted governance, policy, plan and gate hashes. Material differences block renewal; use the confirmed
revision process below, not `apex reconcile`, which handles deployment recovery. Unrelated subscription data is not copied
into run state. A replay of the exact accepted
renewal is idempotent. The journal head advances, so active tasks may need reissuing; preview expiry and writer authority
are not extended. Obsolete snapshots without a content digest are rejected; start a current run rather than inferring
equality or rewriting historical state.

### Changed Policy

After reviewing a changed, complete and fresh baseline, explicitly authorize reopening governance:

```bash
apex governance revise --path .github/data/governance-policy-baseline.json --reason "Reviewed Azure policy changes" --yes --json
apex governance import --path .github/data/governance-policy-baseline.json --json
```

Revision is a trusted CLI-only operation. It atomically invalidates the workflow's governance dependency closure and
Gates 2-4, preserving requirements, architecture and historical evidence. It does not import the replacement, approve
policy, or change Azure. The later import must match the exact confirmed path and bytes; a changed candidate requires
new confirmation. Architecture (including its policy map), its review, planning and affected approvals must run
again.

In-flight or indeterminate deployments block revision until their outcome is resolved. Do not bypass this by editing
journal/state files. Legacy snapshots without content digests still require a separately supported migration path.
The current deployment reconciliation path requires a recorded execution receipt. Without one, remain blocked for
operator/provider-supported resolution; repeating `apex reconcile` or deployment does not establish the missing outcome.

## Decide Gates

Inspect accepted artifacts and validation before each decision:

```bash
apex render --kind requirements
apex gate decide --gate 1 --decision approved --actor USER_ID --json
```

Requirements acceptance also materializes a read-only Gate 1 review package at
`agent-output/<project>/<run>/`. Review `01-requirements.md`, `README.md`,
`service-recommendations.md`, `sku-preferences.md`, and `challenger-findings.md`
before approving Gate 1. These documents are derived from accepted APEX state;
regeneration overwrites local edits.

Conflict-aware selective updates are planned under `REQ-CHANGE-001`; until implemented, do not treat manual edits to
these generated packages as persistent project intent. Ask APEX to revise accepted decisions through supported tasks.

Architecture acceptance materializes `agent-output/<project>/<run>/architecture/` with authoritative assessment, cost,
SKU, and challenger Markdown. It also includes editable Python, SVG, and PNG views for Architecture topology,
qualitative WAF status, priced monthly cost breakdown, and lower/base/upper cost uncertainty. Unpriced items remain
listed separately and are excluded from cost diagrams and the priced subtotal. Diagram failures are visible but do not
replace or block typed review evidence.

Architecture assumes regional service/SKU availability and sufficient quota. Regional, zonal, deployment, restore,
failover, and capacity details may appear as descriptive assumptions, but APEX does not request, validate, or gate them.

Repeat the inspection and decision ceremony for architecture/cost and implementation plan. Gate 4 is decided only after
an exact provider preview exists. Rejection or upstream changes reopen the earliest affected work.

## Generate And Validate IaC

When the kernel issues a generation task, a supported worker or bounded operator uses `generateIac`. The selected run
chooses Bicep or Terraform; outputs for the other track are invalid.

```bash
apex validate --json
apex status --json
```

## Legacy Promotion Alias

```bash
apex promote --environment test --target TARGET_SCOPE --json
```

Promotion creates a linked run. Only dependency-matching upstream attestations can carry forward. Every environment
requires a fresh preview, Gate 4 decision, operation, inventory, and evidence.

## Related

- [Workflow and gates](../explanation/workflow-and-gates.md)
- [Maintain requirements intake](maintain-requirements-intake.md)
- [Operate a project](operate-project.md)
- [MCP tools](../reference/mcp.md)

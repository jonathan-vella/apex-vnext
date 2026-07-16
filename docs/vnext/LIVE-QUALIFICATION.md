# vNext Live Qualification

This procedure prepares the local APEX Gate 4 and GitHub OIDC ceremony for the live qualification and encrypted
Terraform plan transport issues in this repository. It does not record live deployment proof. A run is evidence only
after the candidate-bound apply and destroy ceremonies complete and their outputs are accepted into the release evidence
index.

## Prerequisites

Bootstrap the committed control plane from `infra/bicep/vnext-qualification/bootstrap.bicep`. Supply the dedicated
GitHub deployment principal and the local handoff uploader principal at deployment time. Do not commit a parameter file.

Configure the unprotected `vnext-qualification` GitHub Environment with these secrets:

- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` for OIDC.
- `APEX_PLAN_TRANSPORT_KEY`, canonical base64 encoding of exactly 32 random bytes.

Configure these Environment variables from the bootstrap outputs and canonical governance contract:

- `APEX_CONTROL_RESOURCE_GROUP`, `APEX_BACKEND_STORAGE_ACCOUNT`, `APEX_BICEP_RESOURCE_GROUP`, and
  `APEX_TERRAFORM_RESOURCE_GROUP`.
- `APEX_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID`, `APEX_LOCATION`, and `APEX_PROJECT_NAME`.
- `APEX_QUALIFICATION_TAGS_JSON`, containing exactly the ten discovered tag keys enforced by the workflow validator.

The context validator requires subscription `00858ffc-dded-4f0f-8bbf-e17fff0d47d9`, project `vnext`, location
`swedencentral`, the `rg-vnext-qualification-*` resource groups, the bootstrap workspace/account naming contract, and
the exact approved tag values. A key-only or free-form tag object is rejected.

GitHub accepts `workflow_dispatch` only when the workflow file exists on the default branch. In this repository, the
dispatch-only workflow and candidate both live on `main`. The launcher verifies that the default-branch, requested-ref,
and local workflow blobs are byte-identical before dispatching the exact candidate SHA.

The launcher and workflow validation job also require repository `jonathan-vella/apex-vnext`. The evidence command
normalizes Git transport URL forms and requires the release manifest repository to match the candidate repository.
An identical workflow or manifest in another repository fails before any cloud mutation.

The Environment scopes OIDC, variables, and secrets only. It is not an approval authority. APEX Gate 4 is the sole
human deployment decision and must be approved locally against the exact native preview before dispatch.

## Dispatch

Build the vNext CLI locally, initialize or select the candidate state, and set `APEX_PLAN_TRANSPORT_KEY` in the current
process. First create the native preview locally. Terraform preview opens a bounded backend network session; Bicep
preview remains management-plane only. The launcher returns the handoff ID, stable CI recipient, preview hash, rendered
preview, and exact approval command.

```bash
npm run build:vnext
node tools/scripts/vnext-live-handoff.mjs preview --yes \
  --track bicep --operation apply \
  --resource-group <control-resource-group> --storage-account <backend-account>
```

Review the rendered preview, then approve Gate 4 for the exact recipient returned by the launcher:

```bash
apex gate decide --gate 4 --decision approved \
  --actor <maintainer> --recipient <handoff-recipient> --json
```

Dispatch with the same handoff ID. Dispatch verifies the current local TTY approval, creates one writer-transfer claim,
encrypts the already-approved run state and exact provider authority, uploads both envelopes, and starts the apply job.

```bash
node tools/scripts/vnext-live-handoff.mjs dispatch --yes \
  --track bicep --operation apply --ref main --handoff-id <uuid> \
  --resource-group <control-resource-group> --storage-account <backend-account>
```

Repeat for each track and operation. After retrieving apply authority, create and approve a new destroy preview from the
same selected run. The new preview supersedes the prior Gate 4 decision; CI cannot create or refresh approval.

Each dispatch is valid only for run attempt one. A retry requires a new dispatch and a new encrypted handoff.

## Retrieve

After the apply job returns authority, retrieve it into an exact-candidate checkout. A first retrieval requires no
conflicting `.apex` state; retries may reuse byte-identical imported state or an already accepted exact local return.
The blob is deleted only after import and exact writer-claim acceptance succeed.

```bash
node tools/scripts/vnext-live-handoff.mjs retrieve --yes \
  --handoff-id <uuid> --track bicep --operation apply \
  --resource-group <control-resource-group> --storage-account <backend-account> \
  --destination /absolute/path/to/clean-candidate
```

For preview recovery, add `--stage preview-failure`. If the return blob is unavailable, the launcher prints the exact
fallback artifact name; it does not download arbitrary workflow artifacts.

## Security Model

- The backend has public network access Disabled at rest and a default-deny firewall. A session is admitted only when
  the exact governance exception is active and has at least 75 minutes remaining. The caller applies the live policy's
  `SecurityControl=Ignore` tag, enables the endpoint, and adds only its observed public IPv4 `/32`. Cleanup removes the
  rule, restores Disabled, removes the tag, and verifies both final states. The tag is never persistent.
- Before CI apply opens its session, it verifies stale rules are absent. This preserves the exception's one-runner
  maximum even after a failed local preview cleanup.
- Azure access uses Entra authentication and GitHub OIDC. Shared keys, client secrets, plaintext plans, plaintext state,
  and the transport key are never artifacts.
- Local preview and CI apply have distinct writer epochs. Apply imports the already-approved encrypted state and exact
  provider authority, accepts the one-hop writer claim, validates the local TTY approval, and deploys only the imported
  preview hash.
- CI cannot run `apex preview` or `apex gate decide`. Evidence artifacts are nonsecret.
- The workflow returns writer authority to `local:<handoff-id>` after acceptance, including failure paths where possible.

## Local Validation

The structural validator parses YAML and checks trigger, permission, OIDC/configuration Environment, imported local
approval, recipient, transfer, cleanup, exact-preview, encrypted-artifact, return-path, and forbidden-command invariants.
Its mutation suite also tests the launcher's pure argument, recipient, workflow-reference, and transport-key helpers
without subprocess or network use.

```bash
npm run validate:vnext-live-workflow
npm run test:vnext-live-workflow
npm run test:vnext-validator
npm run qualify:vnext
```

Local success proves only that the prepared surface satisfies repository contracts. It does not prove OIDC, Azure RBAC
propagation, Bicep deployment-stack, Terraform backend, apply, destroy, or authority-return behavior.

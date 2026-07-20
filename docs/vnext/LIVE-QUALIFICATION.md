# vNext Live Qualification

This procedure prepares the local APEX Gate 4 and GitHub OIDC ceremony for live qualification. It does not record live
deployment proof. A run is evidence only
after the candidate-bound apply and destroy ceremonies complete and their outputs are accepted into the release evidence
index.

## Prerequisites

Bootstrap the committed control plane from `infra/bicep/vnext-qualification/bootstrap.bicep`. Supply the dedicated
GitHub deployment principal and the local handoff uploader principal at deployment time. Do not commit a parameter file.

Configure the unprotected `vnext-qualification` GitHub Environment with these OIDC settings:

- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`.

Configure these Environment variables from the bootstrap outputs and canonical governance contract:

- `APEX_CONTROL_RESOURCE_GROUP`, `APEX_BACKEND_STORAGE_ACCOUNT`, `APEX_BICEP_RESOURCE_GROUP`, and
  `APEX_TERRAFORM_RESOURCE_GROUP`.
- `APEX_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID`, `APEX_LOCATION`, and `APEX_PROJECT_NAME`.
- `APEX_QUALIFICATION_TAGS_JSON`, containing exactly the ten project qualification tags enforced by the workflow
  validator. The project contract remains stricter than subscriptions where Azure Policy requires no tags.

The context validator requires subscription `b47d2942-f5ad-4d3c-b28e-c23e4f83d97e`, project `vnext`, location
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

Prepare the selected track from the exact clean `main` candidate. The command queries current Azure Storage quota,
regional availability, and retail pricing; derives strict vNext artifacts from the committed qualification IaC and live
governance snapshot; runs native validators; records Gates 1–3 under the named local actor; and stops with Gate 4 closed.

```bash
npm run prepare:vnext-live -- --yes \
  --track bicep --actor <maintainer> \
  --subscription <subscription-id>
```

When reviewed qualification state already exists and its Gate 4 is closed, add `--replace-existing`. The command refuses
active writer ownership, keeps the prior `.apex` tree in a private backup, and restores it if any new task or validator
fails.

Review and merge the resulting repository-backed `.apex` state. Use a fresh exact `main` checkout for preview so the
candidate commit includes the journaled artifacts, validation evidence, and Gate 1–3 decisions. Create the native
preview locally. Terraform preview opens a
bounded backend network session; Bicep preview remains management-plane only. The launcher returns the handoff ID, stable
CI recipient, preview hash, rendered preview, and exact approval command.

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
packages the already-approved run state and exact provider authority, uploads both bundles, and starts the apply job.
The checkout must remain at exact `main`; only repository-backed `.apex/**` changes created by preview and approval are
permitted. Any source, workflow, or other workspace drift blocks dispatch.

```bash
node tools/scripts/vnext-live-handoff.mjs dispatch --yes \
  --track bicep --operation apply --ref main --handoff-id <uuid> \
  --resource-group <control-resource-group> --storage-account <backend-account>
```

Repeat for each track and operation. After retrieving apply authority, create and approve a new destroy preview from the
same selected run. The new preview supersedes the prior Gate 4 decision; CI cannot create or refresh approval.

Each dispatch is valid only for run attempt one. A retry requires a new dispatch and a new handoff.

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
  `SecurityControl=Ignore` tag, enables the endpoint, and temporarily sets firewall default action to `Allow`. Data-plane
  access remains Entra RBAC only; shared keys and anonymous Blob stay disabled. Cleanup restores `Deny`, then `Disabled`,
  removes the tag, and verifies all final states. The tag is never persistent.
- Azure access uses Entra authentication and GitHub OIDC. Shared keys, client secrets, and plaintext Terraform plans are
  never artifacts. APEX requires no operator-managed handoff secret.
- Local preview and CI apply have distinct writer epochs. Apply imports the already-approved state and exact
  provider authority, accepts the one-hop writer claim, validates the local TTY approval, and deploys only the imported
  preview hash.
- CI cannot run `apex preview` or `apex gate decide`. Evidence artifacts are nonsecret.
- The workflow returns writer authority to `local:<handoff-id>` after acceptance, including failure paths where possible.

## Local Validation

The structural validator parses YAML and checks trigger, permission, OIDC/configuration Environment, imported local
approval, recipient, transfer, cleanup, exact-preview, encrypted-artifact, return-path, and forbidden-command invariants.
Its mutation suite also tests the launcher's pure argument, recipient, and workflow-reference helpers
without subprocess or network use.

```bash
npm run validate:vnext-live-workflow
npm run test:vnext-live-workflow
npm run test:vnext-validator
npm run qualify:vnext
```

Local success proves only that the prepared surface satisfies repository contracts. It does not prove OIDC, Azure RBAC
propagation, Bicep deployment-stack, Terraform backend, apply, destroy, or authority-return behavior.

---
title: "Operate the vNext Preview"
description: "Configure, preview, apply, destroy, reconcile, diagnose, and recover local APEX vNext runs."
---

Run operations from the initialized consumer repository. Add `--json` whenever another process consumes the result.

## Triage Improvement Proposals

Use `apex quality observations --json` to inspect redacted evidence and `apex quality scan --json` to detect recurrence
under the runtime-locked policy. Review inert records with `apex quality proposals --json`. Record a decision only after
checking the cited evidence and pattern scope:

```bash
apex quality decide \
  --proposal "$PROPOSAL_ID" \
  --actor local-maintainer \
  --decision deferred \
  --rationale "Collect another independent run before changing the validator." \
  --yes --json
```

Acceptance is triage, not application. Create any resulting repository issue or change manually through the normal
review workflow. Periodically run `apex quality prune --yes --json`; use explicit observation deletion for data subject
or evidence-lifecycle requests. See the [security guide](security.md#bound-improvement-authority) for the trust boundary.

## Check Setup and Health

```bash
apex setup
apex setup --live --json
apex doctor --json
apex doctor --fix --yes --json
```

`setup --live` checks Azure CLI authentication. `doctor` checks Node.js, workspace state, required executables, managed
files, runtime compatibility, provider configuration, backend readiness, and the Terraform CI transport limitation.
Repair mode refreshes managed files and the runtime lock; it does not authenticate Azure or invent provider settings.

## Configure a Native Provider

Store nonsecret settings in a local JSON file and pass it once with `--provider-config`. A successful command persists
the validated settings to `.apex/provider-config.json`.

```json title="provider-config.bicep.json"
{
  "bicep": {
    "resourceGroup": "rg-apex-preview-dev",
    "deploymentName": "apex-preview-dev",
    "stackName": "apex-preview-dev",
    "templateFile": ".apex/work/RUN/TASK/code/main.bicep",
    "parametersFile": ".apex/work/RUN/TASK/code/main.parameters.json",
    "actionOnUnmanage": "deleteResources",
    "ownershipAuthorizesDeleteResources": true,
    "denySettingsMode": "denyDelete"
  }
}
```

```json title="provider-config.terraform.json"
{
  "terraform": {
    "cwd": ".apex/work/RUN/TASK/code",
    "target": "subscription-preview",
    "planDirectory": ".apex/local/terraform-plans",
    "lockfileHash": "REPLACE_WITH_CURRENT_SHA256"
  }
}
```

Do not add tokens, passwords, keys, credentials, backend secrets, or Terraform state to provider configuration. Use the
actual run and task paths returned by `apex task context`.

Bicep preview lists deployment stacks in the configured resource group and selects the exact `stackName` in process. A
missing exact stack is treated as an empty managed set, so the first cloud mutation remains the approved
`az stack group create`. Malformed, duplicate, or wrong-resource-group stack entries fail before Gate 4.

`lockfileHash` must equal the current raw SHA-256 of `.terraform.lock.hcl`. The CLI also hashes all `.tf`, `.tf.json`,
`.tfvars`, `.tfvars.json`, and lock files under `cwd`, excluding `.terraform/`. Preview and deploy recompute that tree;
source drift, variable drift, lock drift, or a symlink fails closed. `configHash` may pin an expected tree hash but is not
required because APEX always computes the current value.

APEX stores preview bindings and encrypted Terraform plan artifacts under `.apex/local/provider-runtime/`. Terraform
plan encryption uses an automatically generated mode-`0600` local key. Operators do not create, synchronize, or inject
a transport secret. Provider configuration never contains the local key.

## Transfer Repository State to CI

Create a writer-transfer claim first, then package only the selected repository-backed state for that claim:

```bash
apex state transfer-export \
  --claim "$CLAIM_HASH" \
  --file apex-state-transfer.json \
  --recipient "$RECIPIENT" \
  --ttl-seconds 1800 \
  --yes --json
```

The recipient imports the short-lived, recipient-bound bundle without a shared transport key:

```bash
apex state transfer-import \
  --file apex-state-transfer.json \
  --recipient "$RECIPIENT" \
  --yes --json
```

The import is staging-free but preflights every entry before any write. Existing byte-identical files make a retry
idempotent; any differing file, symlink ancestor, unsafe path, secret-bearing JSON, stale claim, or binding mismatch
fails closed. The command never writes `.apex/local/plan-transport.key` and never accepts writer authority. Run
`apex writer transfer-accept --claim "$CLAIM_HASH" --recipient "$RECIPIENT" --head "$COMMIT"` separately after the
existing approval ceremony.

The scanner recognizes only three exact secure assertions in `runtime/defaults.v1.json`, with their required boolean
values. A changed value or the same field name at any other path fails closed. The envelope expiry must not exceed the
writer-transfer claim expiry.

## Transfer Exact Provider Authority to Apply

Set the intended apply recipient when creating a Terraform preview. Terraform encrypts the saved plan for that identity,
which may differ from the current preview writer:

```bash
apex preview --operation apply --provider terraform --recipient "$RECIPIENT" --json
```

After preview completes, render and review it, then approve Gate 4 locally for the intended CI recipient. Create exactly
one writer-transfer claim only after approval, then export the approved state and exact provider binding. Terraform also
includes the encrypted saved-plan artifact referenced by that binding.

```bash
apex provider transfer-export \
  --preview "$PREVIEW_HASH" \
  --provider terraform \
  --file apex-provider-authority.json \
  --recipient "$RECIPIENT" \
  --ttl-seconds 1800 \
  --yes --json
```

In the apply job, supply the same external key and import before writer acceptance and deployment:

```bash
apex provider transfer-import \
  --file apex-provider-authority.json \
  --recipient "$RECIPIENT" \
  --yes --json
```

The import accepts only the exact hash-derived binding path and, for Terraform, the exact artifact and its generated
local plan key. It rejects changed destinations and symlinked runtime ancestors, while allowing byte-identical retries.
It never creates approval or a provider operation. Keep production CI apply blocked until live proof qualifies the
complete repository-state and provider-authority sequence.

## Approve Gate 4 Before CI Handoff

Create the native preview locally for the intended CI recipient, render it, and approve Gate 4 before relinquishing local
writer authority:

```bash
apex gate decide \
  --gate 4 \
  --decision approved \
  --actor local-maintainer \
  --recipient "$RECIPIENT" \
  --json
```

The recipient is stable for the handoff ID. Approval expires at the earlier of the preview and current writer lease. The
accepted transfer advances the approved writer epoch exactly once. Deploy proves journal order `preview.created`,
`gate.decided`, `transfer-requested`, and `transfer-accepted`. A missing approval, second transfer, changed recipient,
superseded preview, expired lease, or changed dependency revision fails before provider execution.

Dispatch permits only the `.apex/**` state changes produced by preview and local approval. It still requires the exact
`main` commit and rejects changes to source, workflows, configuration, or any other workspace path.

The GitHub Environment scopes OIDC, variables, and secrets only. It is not approval evidence. The complete local
approval and CI apply transfer path has live Bicep and Terraform proof. Production workflow enablement remains a
separate release and cutover decision.

Bicep defaults to `detachAll`. Set `ownershipAuthorizesDeleteResources: true` only when the stack exclusively owns every
resource it may delete. `deleteAll` additionally requires an explicitly dedicated sandbox resource group and separate
authorization in provider configuration.

## Preview and Apply Locally

For the repository-owned live qualification sandbox, prepare a strict journaled run before preview:

```bash
npm run prepare:vnext-live -- --yes \
  --track bicep --actor local-maintainer \
  --subscription <subscription-id>
```

The command accepts only a clean exact `main` checkout, current native Azure availability evidence, the committed
qualification IaC and governance contract, and an explicit Gate 1–3 actor. It cannot create a preview or decide Gate 4.
Commit the resulting repository-backed `.apex` state through review, then create the preview from the merged exact `main`
candidate.

Use `--replace-existing` only to refresh an already reviewed qualification run whose Gate 4 is closed. Replacement is
transactional, rejects active writer ownership, and restores the previous state if preparation fails.

For other workflows, complete required tasks and gates first, then configure the selected run's provider:

```bash
apex preview --operation apply --provider bicep \
  --provider-config provider-config.bicep.json --json
apex gate decide --gate 4 --decision approved --actor local-user --json
apex deploy --preview "$PREVIEW_HASH" --json
```

For Terraform, use `--provider terraform` and the Terraform provider config. The preview saves the plan under the local
plan directory, immediately encrypts it into the local provider runtime, removes the plaintext plan, and deploy applies
the approved exact plan. Separate-job provider transfer passed live apply and destroy qualification with recipient,
digest, lineage, serial, owner epoch, and expiry bindings.

The semantic dependency revision covers project/run identity, target, IaC track, runtime lock, and accepted artifact
hashes. Writer ownership epoch is separate authority: an ownership-only transfer preserves the revision while approval
and deploy still require the exact consecutive owner epoch and transfer lineage.

A newly validated preview reopens Gate 4 and supersedes its prior decision on the same run. This supports expired
preview refresh and apply-to-destroy qualification without promotion. Prior preview, approval, and deployment evidence
remain immutable, but only the latest preview can receive a new exact approval.

## Preview and Apply a Destroy

Destroy is also preview-bound:

```bash
apex preview --operation destroy --provider terraform --json
apex gate decide --gate 4 --decision approved --actor local-user --json
apex deploy --preview "$DESTROY_PREVIEW_HASH" --json
```

Bicep destroy uses the configured deployment stack and its ownership settings. Review `actionOnUnmanage` and
`denySettingsMode` before approval. Do not substitute an unscoped Azure deletion command.

## Inspect and Recover

```bash
apex inventory --json
apex reconcile --json
apex diagnose --json
apex project history --limit 50 --json
apex cache status --json
apex cache clear --json
```

`reconcile` requires an existing recorded inventory and appends a reconciliation event. `diagnose` is read-only and
combines run status with doctor results. Cache entries are deterministic and safe to recompute.

## Manage Updates, Telemetry, and Writers

- Run `apex update --json` to update managed customizations. Resolve `APEX_CONFLICT` without overwriting user changes.
- Use `apex telemetry consent --value true|false`, `telemetry export`, and `telemetry delete` for optional telemetry.
- Use `apex writer show` before transfer. Create and accept a claim only with the current repository head and intended
  recipient workflow; expired or stale claims must be recreated.

Use the [CLI reference](cli-reference.md) for every flag and the [testing guide](testing.md) before a real sandbox run.

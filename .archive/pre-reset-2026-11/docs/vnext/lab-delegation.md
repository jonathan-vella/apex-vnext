# Lab gate delegation candidate

Human approval remains the default. This opt-in candidate permits the kernel to record delegated agent decisions for
Gate 1 and **apply-only** Gate 4. It does not claim that a human reviewed an unseen future preview. Gates 2 and 3
remain kernel readiness checkpoints.

## Human policy confirmation

Complete and review Requirements first. Prepare a `lab-delegation-policy-v1` JSON file naming the selected project/run,
lab purpose, non-production environment, Bicep track, AzureCloud tenant/subscription, exact resource-group target,
accepted Requirements object hash, exact ARM resource allowlist, delegated gates, current writer epoch/recipient,
and expiry. No budget ceiling is required. This is a runtime input, not a product default.

The following is a fictional shape, not consent or a usable authorization. Replace every fixture value, including
the Requirements hash, with the reviewed run's values. The resource list has no wildcard or prefix entries.

```json
{
  "schemaVersion": "1.0.0",
  "projectId": "archive-lab",
  "runId": "selected-run",
  "purpose": "lab",
  "environment": "dev",
  "track": "bicep",
  "cloud": "AzureCloud",
  "tenantId": "22222222-2222-2222-2222-222222222222",
  "subscriptionId": "11111111-1111-1111-1111-111111111111",
  "targetScope": "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/archive-lab",
  "requirementsHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "resourceIds": [
    "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/archive-lab/providers/Microsoft.Storage/storageAccounts/syntheticarchive"
  ],
  "gates": [1, 4],
  "operation": "apply",
  "writerEpoch": 1,
  "recipientIdentity": "local",
  "expiresAt": "2026-11-01T12:00:00.000Z"
}
```

From the selected consumer workspace, using this candidate's packaged CLI, the human runs:

```powershell
apex lab delegation-confirm --file .\lab-delegation-policy.json
apex lab delegation-show
```

Confirmation displays the full policy, its SHA-256 hash, exact target/resource allowlist, recipient and expiry. It
asks the human to confirm that the scope is theirs to authorize and the workload is synthetic and non-sensitive,
and explicitly states that future preview review, destroy, production, updates, risk acceptance and other questions
are not delegated. The human must type `DELEGATE <displayed-policy-hash>` exactly. Piped input, `--yes`, `--actor` and
`--json` are refused. Expiry must be future and at most 24 hours away at confirmation; it is checked again on decisions
and execution.

The returned receipt contains `policyHash`, `consentHash`, the exact policy and consent, and `revoked`. Verify the
displayed scope/expiry and that the consent uses `terminal-policy-confirmation`, the local OS username, and
`futurePreviewReviewed: false`. Both hashes are verified against content-addressed objects when read.
The local terminal ceremony is not an Entra-authenticated identity assertion. MCP has no consent-registration tool.
This coding/build task records no real consent.

## Establishing the allowlist before Gate 1

The policy allowlist is an exact **human-selected upper bound**, not a generated Architecture or Plan receipt.
After explicitly confirming Requirements, the human may supply concrete intended ARM IDs (including final names,
child paths and extension scopes) in the policy before Gate 1. The ceremony records consent to those exact IDs; it
does not approve Architecture choices or guarantee that a later plan will fit. No wildcard, guessed name, generated
future manifest or inferred resource ownership can substitute for that input.

Architecture, governance and review decisions still follow their normal paths after Gate 1. If they require any
different resource ID or other policy change, the existing consent cannot authorize it: the human must confirm a new
exact policy. An allowlist established upfront therefore does not make unresolved design questions unattended.

If the exact IDs cannot be established before Gate 1, **the one-time ceremony cannot yet be prepared for both gates**.
Complete Gate 1 through the unchanged human path, resolve Architecture/governance decisions and accept the Plan,
then derive and review exact IDs from the accepted bindings and confirm an apply-only policy with `gates: [4]`.
Do not run Architecture early, silently answer Requirements or design questions, or relax the allowlist to avoid
this ordering constraint.

## Supported decision path

Fresh `apex/status` exposes existing delegation hashes, gates, expiry and revocation. The managed foreground APEX
agent may call `apex/gateDelegate` for an explicitly requested continuation using those exact hashes. For Gate 4 it
must also read the complete current `apex/preview` and preserve the preview and immutable approval-context hashes.
The kernel, not the agent's explanation, evaluates the bounded policy.

The CLI equivalents are:

```powershell
apex gate delegated --gate 1 --policy <policyHash> --consent <consentHash>
apex preview --provider bicep --operation apply
apex gate delegated --gate 4 --policy <policyHash> --consent <consentHash> --preview <previewHash> --context <approvalContextHash>
apex approval show
apex deploy --preview <previewHash>
```

Preview and deploy are live operations when a native provider is configured. The commands above describe the
supported path; they are not authorization to execute it during candidate coding or offline verification.
MCP records the gate decision but does not expose a deployment-execution tool; execution remains with the CLI runner.

The decision uses `mechanism: lab-delegation`, `actor: agent:<current-recipient>`, the kernel evaluator ID,
policy/consent hashes, current writer epoch and expiry. Gate 4 additionally binds the exact preview, immutable context
and native resource-state evidence hash. It never emits a human `tty` receipt.

Gate 1 binds exact accepted Requirements with no unknown/deferred requirements. Gate 4 requires the same run,
environment, track, target, writer/recipient, current dependency revision and exact preview/context. Existing review,
policy, accepted-risk freshness and generated-review checks still apply.

The native azd adapter rechecks its bound source, identity and resource-group state and reads unlisted accepted
resources individually. Only allowlisted **creates of provider-observed absent resources** and **non-material no-ops
of observed present resources** are delegated. All other actions, unresolved IDs, duplicate/missing observations,
out-of-scope changes and blockers fail closed. Hooks and extensions are unsupported on this path because their
effects cannot be bounded by the infrastructure preview. Fake/simulated previews and Terraform cannot authorize it.
Scope observations are repeated before deployment and at the native execution boundary. After native preflight,
the packaged runner rechecks current journal consent, exact writer and approval expiry before invoking azd provision.

Revocation prevents new delegated decisions and execution:

```powershell
apex lab delegation-revoke --policy <policyHash>
```

Expired/revoked delegated gates cease satisfying the workflow and reopen on continuation. Delegated decisions are
not inherited by another run. Revocation is not cancellation or rollback of an already started operation.

## Destroy and remaining blockers

**Delegated destroy is unsupported.** The current Bicep executor requires an already `azd-env-name`-tagged resource
group; `azd down` deletes that entire group, including child resources Azure may not list. Tags, inventory and an
external ledger do not prove run creation. Destroy requires its own current preview and the unchanged human approval
path; apply consent or an apply decision never authorizes it.

A live runner may separately create a user-authorized resource group and keep an external creation ledger. Any
ledger-limited cleanup outside APEX must be labeled **non-qualifying external cleanup**, not kernel-authorized destroy
or proof that the delegated path qualified cleanup. This candidate neither consumes that ledger nor performs cleanup.

Gate delegation does not resolve the separate foreground Requirements confirmations, Architecture decision questions,
governance selections, unresolved risks, missing evidence or expired authentication. Those remain explicit blockers.
Human confirmation can happen once only after the required policy facts exist; a chat instruction or this document
does not substitute for the persisted ceremony.

Offline fixtures cover consent and provenance, Gate 1 CLI/MCP wiring, native azd scope observations, positive bounded
apply evaluation, and rejection cases. A focused regression also exercises actual service/MCP `gateDelegate`,
approval retrieval and deployment with the real `AzdBicepProvider` and mocked external compiler/Azure/azd processes:
complete accepted native validation evidence, a synthetic consent fixture, exact allowlisted create and native
execution/inventory evidence, plus scope drift and final-preflight revocation rejection. The mock compiler output
and synthetic consent are offline fixtures, not real human consent or live Azure evidence.
A built candidate is not a passing live Azure run. Full integration qualification
includes prohibited destructive, uninstall, rollback and tamper tests, so it must not be run under this task's
verification restriction. No publication, installation replacement or live Azure action is implied.

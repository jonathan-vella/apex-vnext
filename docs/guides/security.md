---
title: "Secure the vNext Preview"
description: "Understand kernel authority, staged writes, exact approvals, evidence, and provider boundaries."
---

The APEX kernel is authoritative for project and run state, task envelopes, allowed output kinds, validation, artifact
acceptance, gate state, approval binding, provider authorization, and writer ownership. Conversation history and VS Code
system context remain outside that enforcement boundary.

## Stage Before Acceptance

Agents write through narrow MCP tools into `.apex/work/<run>/<task>/`, an ignored task staging area. The kernel checks
the current journal head and writer epoch, allowed paths and file types, byte limits, schemas, and business rules before
promoting accepted content into `.apex/objects/sha256/` and appending an immutable journal event.

Do not give creative agents general filesystem, shell, Git, Azure, Bicep, Terraform, or deployment tools. A staged file
is not canonical state, and a handoff or chat message is not evidence of completion.

## Enforce One Writer

Each run has one active writer. Local leases and journal compare-and-swap reject stale tasks and concurrent mutation.
Transfer to CI binds an ownership epoch to the project, run, repository, branch, commit, workflow, sender, recipient,
current Git head, and expiry. A stale epoch or mismatched head cannot authorize an operation.

Transfer creation requires the sender's current unexpired lease before any claim or journal event is written. Accepted
ownership records the authenticated claim hash, previous owner, and previous epoch. CI deployment is authorized only
when the journal proves `preview.created`, `gate.decided`, `transfer-requested`, then `transfer-accepted` for the same
preview, recipient, project, run, and consecutive epoch. Missing, tampered, expired, or superseded lineage fails closed.

Repository-state transfer uses a separate AES-256-GCM envelope from encrypted Terraform plan transport. Authenticated
metadata binds the envelope implementation and version, kind, plaintext digest, recipient, timestamps, claim, selected
project/run, writer epoch, journal head, repository, branch, commit, workflow, and optional approval environment. Import
authenticates and validates the complete bundle before atomic mode-`0600` writes. It refuses path traversal, symlinks,
secret-bearing JSON, oversized files, unreferenced objects, changed existing state, and any attempt to include
`.apex/local/`.

State import is not writer acceptance. The CI recipient must run `writer transfer-accept` after import. It cannot create
or replace approval. APEX Gate 4 is approved locally against the exact native preview and intended CI recipient before
the transfer claim is created. The GitHub Environment scopes OIDC, variables, and secrets only.

The current preview exposes writer transfer primitives, but production CI operation remains subject to release
qualification and provider-specific evidence. Do not simulate transfer by editing run files.

## Bind Preview to Apply

`apex preview` records operation, provider, target, inputs, IaC, policy, commit, owner epoch, changes, blockers, and
expiry. Deployment Preview approval binds that exact hash. `apex deploy` rejects missing, rejected, expired, stale, or
substituted approval and preview data.

The dependency revision intentionally excludes owner epoch. It represents semantic deployment content and changes when
the target, IaC track, runtime lock, or accepted artifact hashes change. Authority remains independently bound by the
preview owner epoch, approval epoch, intended/current recipient, and exact one-hop transfer claim hash.
Approval evidence cannot outlive either its preview or the current writer lease.

- **Bicep:** native operations use Azure deployment stacks for apply and destroy ownership semantics. There is no
  unscoped generic Bicep destroy path.
- **Terraform:** preview creates a protected saved plan and execution-plan attestation. Apply uses that exact saved
  plan; it must not regenerate a plan after approval. `preview --recipient` encrypts the plan for the intended execution
  recipient even when the current preview writer is different.

Preview bindings and encrypted plan artifacts persist across CLI process restarts under `.apex/local/provider-runtime/`.
The local AES-256-GCM plan key is generated automatically with restrictive permissions. A symlinked runtime path,
permissive key file, wrong recipient, expired artifact, or changed binding fails closed. Terraform configuration hashing
includes source, automatic variable, and provider lock files while
excluding derived `.terraform/` content. Plaintext saved plans are removed immediately after encryption and temporary
apply files are disposed after use.

Provider-authority transfer uses a short-lived recipient-bound bundle to move only the exact preview binding and, for
Terraform, its exact encrypted saved-plan artifact plus generated local plan key. Bindings include provider, operation,
project/run, owner epoch, preview hash, recipient, and Terraform artifact reference and digest. Import validates the
complete envelope and bundle before writing only allowlisted paths beneath `.apex/local/provider-runtime/`. It cannot
transfer latest pointers, unrelated previews, or plaintext plans, and it cannot create approval or deploy.

:::note[Terraform CI qualification]
Recipient-bound encrypted saved-plan transport passed live separate-job apply and destroy qualification. The accepted
plans bound the exact candidate, recipient, digest, state lineage, state serial, owner epoch, and expiry. Enabling a
production workflow remains a separate release and cutover decision; qualification does not enable one automatically.
:::

## Separate Evidence and Telemetry

Evidence acceptance applies kind and content-type policy, byte limits, structural redaction, secret scanning, and
content-addressed storage. Required approval and deployment attestations are part of authorization evidence. Optional
telemetry is disabled by default and can be consented to, exported, or deleted independently.

Never commit credentials, secret values, Terraform state, saved Terraform plan files, secret-bearing transient output,
or `.apex/local/`. APEX installs `.apex/.gitignore` to exclude `local/`, `work/`, `cache/`, and reproducible capability
source packs while preserving repository-backed locks, runtime manifests, objects, projects, journals, refs, and views.
Provider configuration must contain nonsecret settings only; the CLI rejects secret-like keys. APEX has no
operator-managed handoff secret. Resolve credentials only at operation time through Azure CLI, OIDC, Managed Identity,
or another approved external credential source.

Use the [operations guide](operations.md) to configure providers without secrets.

## Bound Improvement Authority

Improvement observations are untrusted evidence, not instructions. The store redacts secret-like values, quarantines
instruction-like statements, rejects invalid timestamps and policy values, and excludes quarantined records from
recurrence. Stable IDs are computed after redaction so retries within one run deduplicate without inflating confidence.
Recurrence requires distinct run IDs within the policy window.

Every generated proposal is contractually `inert: true`. The runtime policy requires human decisions and fixes
automated issue creation and context injection to `false`; its digest is part of the runtime lock. No proposal or
decision changes task, gate, writer, preview, approval, deployment, Git, or GitHub state.

Agents receive only MCP tools to submit observations and read observations or proposals. MCP exposes no scan, decision,
delete, prune, apply, edit, issue, pull-request, approval, publication, context-injection, or deployment operation for
improvement. Human decisions and destructive lifecycle commands remain explicit, confirmed CLI operations.

The default policy retains observations for 90 days and decisions for 365 days. Operators can delete an observation by
ID or prune expired records. Improvement files are written atomically with mode `0600` under local APEX state and must
not be committed or used as a credential or authorization source.

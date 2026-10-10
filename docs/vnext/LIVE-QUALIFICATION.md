# Live Azure Qualification

This procedure is a separately authorized release activity. Ordinary code generation, documentation, validation, or
package qualification does not authorize cloud access or mutation.

## Purpose And Implementation Status

[ADR-0007](adrs/03-des-adr-0007-use-purpose-bound-approval-and-ci-owned-production-runs.md) selects non-production
first and CI-owned production execution with human approval verified before apply. Those purpose/approval paths are
planned, not implemented by this procedure. Initial non-production acceptance is separate from deferred production.

The steps below exercise the existing native providers and local-to-CI qualification handoff retained after #454.
They are not the new production setup kit or the future azd/Bicep lab executor. Do not skip current gates or reinterpret
the qualification backend's network exception as production authorization.

## Preconditions

- exact clean candidate commit and package set;
- explicit human authorization naming subscription, target, tracks, operations, budget, and expiry;
- target-subscription reviewed policy baseline and pricing evidence;
- explicit ALZ-backed or standalone lab/demo profile and supplied-versus-owned resource boundaries;
- explicit deployment purpose and actual target; non-production purpose does not choose the foundation profile;
- authenticated least-privilege Azure CLI identity;
- isolated Bicep and Terraform targets with cleanup ownership;
- deterministic and package qualification already passing;
- secret-safe evidence location and retention policy.

Stop when any precondition is missing, stale, ambiguous, or outside the authorization.

Quota and regional/SKU availability are assumptions, not separate approval prerequisites. Do not infer no policy from
the absence of an ALZ. Missing or stale target policy evidence remains blocking. The target baseline path follows
[REQ-GOV-001](PRD.md#req-gov-001-governance-and-policy); no local discovery fallback is authorized by this procedure.
If the executable qualification path still requires superseded evidence, align and test it before use, not bypass it.

## Prepare Each Track

Use an explicit current governance context with `subscription_id` and reviewed `security_exceptions`.
The local launcher requires `--governance-file <absolute-file>` for `preview`, `dispatch` and `retrieve`.
`recover` retains its no-endpoint-opening interface. Do not substitute historical checkout or archived evidence.
Before any endpoint mutation the launcher also requires the file's `subscription_id` to equal the active Azure account.
The hosted apply job requires protected nonsecret `APEX_QUALIFICATION_GOVERNANCE_JSON` and writes a regular
mode-0600 context file under `RUNNER_TEMP`. It validates the file before endpoint opening and rechecks expiry.
Setting that environment variable is a separately authorized maintainer prerequisite, not an action of cleanup.
Neither the variable nor the file grants approval; local human Gate 4 and recipient/preview binding remain required.

Run Bicep and Terraform as separate environment runs. For each track:

Cover both profiles with separately authorized scenarios. In ALZ-backed cases, reference supplied networking, identity
and monitoring and prove they survive cleanup. In labs, create only the supporting resources owned by that workload.
Include at least one adapted archetype with fresh consumer governance and no inherited deployment authority.

1. create the run and complete Gate 1 and the lab readiness checkpoints for Gates 2 and 3 through production APIs;
2. configure only nonsecret provider settings;
3. validate generated IaC and native provider readiness;
4. create the exact apply preview for the intended recipient;
5. render and inspect the preview;
6. approve Gate 4 locally through the authorized actor;
7. perform any writer/state/provider handoff with short recipient-bound evidence;
8. deploy only the exact approved preview;
9. capture operation and inventory evidence;
10. create, approve, and execute the exact destroy preview;
11. verify cleanup independently.

## Required Evidence

Record candidate and runtime hashes, actor and recipient identities, owner epochs, target scope, governance and provider
versions, preview and approval hashes, transfer lineage, operation records, inventory, diagnostics, cost, cleanup, and
redacted logs. Terraform evidence also binds the lockfile, configuration tree, saved-plan lineage, and backend mode.

Do not commit credentials, secret values, Terraform state, saved plans, transport material, or unredacted provider
output.

### Future Purpose-Bound Qualification

CP-30 must add separately authorized scenarios after the relevant implementation lands:

- Non-production: confirm intent once, retain required reviews/validation, approve the final preview and exercise
  azd/Bicep and native Terraform apply, inventory, recovery, destroy and cleanup in both foundations.
- Production rehearsal: CI originates the execution run/preview; actual human approval is validated before apply,
  with run/attempt/commit/target/artifact identity and expiry. Missing or stale approval and unavailable protection
  features block execution. CI artifacts remain protected even without a developer-to-CI handoff.
- Setup: read-only readiness, reviewable configuration, explicitly approved provisioning and post-checks must report
  partial failure and missing prerequisites rather than success. Setup or a rehearsal does not by itself authorize
  production use.

Retain negative-case proof for purpose/target changes, exact-plan tampering, replay, identity, state locking,
secret handling and cleanup. Current historical evidence cannot qualify a changed implementation.

## Failure And Recovery

Do not repair state manually. Preserve diagnostics, reject stale evidence, reconcile only through supported operations,
and create a fresh preview after any dependency or ownership change. A failed or partial run remains failed until its
cleanup and evidence disposition are explicit.

Quota, regional or service failures remain real failures even though availability is assumed during design. Report them,
ask relevant recovery questions and approve any revised intent before regenerating the preview. Never substitute a SKU
or region silently, and never weaken policy or security to complete a demo.

## Acceptance

Live qualification passes only when both tracks complete apply, inventory, destroy, and cleanup with current
candidate-bound evidence and no unresolved blocking security, governance, cost, or reliability finding. It still does
not publish, tag, release, or authorize cutover.

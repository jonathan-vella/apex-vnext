# Live Azure Qualification

This procedure is a separately authorized release activity. Ordinary code generation, documentation, validation, or
package qualification does not authorize cloud access or mutation.

## Preconditions

- exact clean candidate commit and package set;
- explicit human authorization naming subscription, target, tracks, operations, budget, and expiry;
- current Azure Policy, quota, regional availability, and pricing evidence;
- authenticated least-privilege Azure CLI identity;
- isolated Bicep and Terraform targets with cleanup ownership;
- deterministic and package qualification already passing;
- secret-safe evidence location and retention policy.

Stop when any precondition is missing, stale, ambiguous, or outside the authorization.

## Prepare Each Track

Run Bicep and Terraform as separate environment runs. For each track:

1. create the run and complete Gates 1 through 3 through production APIs;
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

## Failure And Recovery

Do not repair state manually. Preserve diagnostics, reject stale evidence, reconcile only through supported operations,
and create a fresh preview after any dependency or ownership change. A failed or partial run remains failed until its
cleanup and evidence disposition are explicit.

## Acceptance

Live qualification passes only when both tracks complete apply, inventory, destroy, and cleanup with current
candidate-bound evidence and no unresolved blocking security, governance, cost, or reliability finding. It still does
not publish, tag, release, or authorize cutover.

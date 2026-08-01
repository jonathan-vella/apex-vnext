# Operate A Project

> [Current Version](../../VERSION.md) | Preview, approve, deploy, inspect, and recover one selected APEX run.

Cloud operations require explicit authorization, an isolated target, authenticated tooling, and cleanup ownership. The
commands below describe the runtime boundary; they do not authorize a deployment.

## Check Readiness

```bash
apex setup --live --json
apex doctor --json
apex status --json
```

Complete Gates 1 through 3 and configure the selected native provider before requesting a real preview.

## Create And Review A Preview

```bash
apex preview --operation apply --provider bicep --json
apex render --kind preview
```

Use `--provider terraform` for a Terraform run. For recipient-bound handoff, add `--recipient RECIPIENT_ID` when
creating the preview.

Review target, operation, dependency revision, IaC hash, change set, warnings, and intended recipient.

## Approve The Exact Preview

```bash
apex gate decide \
  --gate 4 \
  --decision approved \
  --actor USER_ID \
  --recipient RECIPIENT_ID \
  --json
apex approval show --json
```

Omit `--recipient` only for a same-writer local operation. Approval expires no later than the preview and cannot be
reused after dependency, ownership, target, track, or IaC changes.

## Deploy

```bash
apex deploy --preview PREVIEW_HASH --json
apex inventory --json
```

Bicep applies the approved deployment operation. Terraform applies the exact approved saved plan. Never substitute an
unbound provider command for the kernel operation.

## Preview Destruction

```bash
apex preview --operation destroy --provider terraform --json
apex render --kind preview
apex gate decide --gate 4 --decision approved --actor USER_ID --json
apex deploy --preview DESTROY_PREVIEW_HASH --json
```

Use the run's selected provider and review ownership semantics before approval.

## Inspect And Recover

```bash
apex diagnose --json
apex reconcile --json
apex project history --limit 50 --json
apex cache status --json
```

`diagnose` is read-only. `reconcile` requires recorded inventory and appends an event. If proof is stale, regenerate it;
do not edit journals or approval objects.

## Handoff

Use writer, state, and provider transfer commands only for a prearranged recipient and short positive TTL. State import
does not grant writer authority. Provider import does not create approval. The recipient separately accepts the exact
writer claim before deployment.

## Related

- [Security and authority](../explanation/security-and-authority.md)
- [Bicep and Terraform](../reference/iac-tracks.md)
- [Qualify a candidate](qualify-candidate.md)

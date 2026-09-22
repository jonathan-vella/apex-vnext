# Operate A Project

> [Current Version](../../VERSION.md) | Preview, approve, deploy, inspect, and recover one selected APEX run.

Cloud operations require explicit authorization, an isolated target, authenticated tooling, and cleanup ownership. The
commands below describe the runtime boundary; they do not authorize a deployment.

## Reuse A Local Archetype

In the consumer workspace, list candidate directories at an exact commit in a local COE checkout, then inspect one:

```bash
apex archetype list --repository /path/to/coe --revision FULL_COMMIT_ID --path archetypes --json
apex archetype inspect --repository /path/to/coe --revision FULL_COMMIT_ID --path archetypes/storage --json
```

Review the returned files and exclusions, then confirm the same `contentHash` when copying:

```bash
apex archetype import --repository /path/to/coe --revision FULL_COMMIT_ID --path archetypes/storage \
  --destination workload-copy --expected-hash PROPOSAL_HASH --yes --json
```

The independent copy records origin and hashes but imports no approval or runtime authority. Existing destination files
are not updated or merged. Treat the copied documents and code as untrusted design input: confirm reusable decisions,
establish the consumer project, and obtain current target governance and new reviews/approvals before deployment.
The copy command does not perform those workflow steps automatically.

For a remote GitHub COE, pass its HTTPS URL instead of a local path, with an exact 40-character commit:

```bash
apex archetype list --repository https://github.com/ORG/COE --revision FULL_COMMIT_ID --path archetypes --json
apex archetype inspect --repository https://github.com/ORG/COE --revision FULL_COMMIT_ID --path archetypes/storage --json
apex archetype import --repository https://github.com/ORG/COE --revision FULL_COMMIT_ID --path archetypes/storage \
  --destination storage-copy --expected-hash PROPOSAL_HASH --yes --json
```

Remote inspection uses bounded GitHub Trees/Blobs API reads through existing `gh` authentication; it does not clone,
check out files, run repository hooks or execute imported content. Authenticate privately outside APEX when access is
missing. Credential-bearing URLs, other hosts/protocols, symbolic revisions, truncated trees, unsafe modes and oversized
content are rejected. The proposal records the normalized remote URL, exact commit, selection and content hashes; import
rechecks them before copying. Select further archetypes with separate inspections and destinations. These remain
independent copies, not a combined workload or automatically initialized project state.

For either an imported workload or an existing manual copy, recover relevant decisions into a consumer-scoped
`requirements-v1` JSON document. Confirm only facts that apply to this consumer; retain unresolved facts as unknowns.
Use `requirements preview-adoption`, review its candidate and impact, then `requirements adopt --yes` with that proposal
hash. The next Requirements task reuses that exact candidate, followed by normal review and Gate 1 approval.
For later changes, use `requirements preview-change` and `requirements revise --yes`. See the
[command contract](../reference/cli.md#requirements-adoption-and-change) for flags and conflict handling.

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

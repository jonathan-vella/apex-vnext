# Qualify A Candidate

> [Current Version](../../VERSION.md) | Run deterministic checks and prepare separately authorized client or cloud proof.

## Run Focused Checks

During development, run the narrowest test that can falsify the current change. Package-level tests and typed contract
validation should precede broad repository checks.

## Run Deterministic Qualification

From a clean repository checkout:

```bash
npm ci
npm run validate:all
npm run qualify:vnext
```

`qualify:vnext` builds packages, validates source and configuration, runs workspace and validator tests, packs the
runtime, and clean-installs it into a temporary consumer project.

## Run Exact-Head Release Qualification

Maintainers can run the non-cloud release lane with a stable collection time:

```bash
npm run qualify:vnext-release -- \
  --collected-at TIMESTAMP \
  --output dist/release-candidate
```

The command requires clean tracked source and writes compact candidate-bound evidence. It does not approve, deploy,
publish, tag, or authorize cutover.

## Prepare Client Qualification

For each selected client, use a clean consumer workspace and the exact candidate packages. Record observed host and
client versions, executable hashes, managed projection hashes, MCP inventory, discovery, routing, input handling,
restart/resume, lifecycle behavior, and normalized outcomes.

VS Code and Copilot CLI outcomes are compared only where both clients support the same interaction. Intentional worker
asymmetry is not a parity failure.

## Prepare Live Azure Qualification

Live qualification requires explicit human authorization, isolated subscriptions or resource groups, governance and
quota discovery, current pricing/availability evidence, authenticated tools, cleanup ownership, and exact preview
approval. Run Bicep and Terraform separately and bind evidence to the candidate.

## Interpret Results

- Deterministic pass means source behavior is internally qualified.
- Package pass means the runtime packs and installs reproducibly.
- Client pass means one exact client candidate satisfies its matrix.
- Live pass means bounded cloud scenarios passed for one exact candidate.
- Release acceptance requires every mandatory level plus explicit authorization.

## Related

- [Qualification reference](../reference/qualification.md)
- [Client support](../reference/client-support.md)
- [Project qualification controls](../vnext/README.md)

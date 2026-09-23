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

Standalone Copilot CLI and VS Code Copilot harness outcomes are compared on the same CLI projection, recorded under the
`github-copilot-cli` and `github-copilot-vscode` evidence identities.

Use Windows via WSL2 without a devcontainer and cover both ALZ-backed and standalone lab/demo profiles. COE import,
relevant change questions, conflict handling and selective regeneration are required target outcomes; missing
implementation must be recorded as a gap. Worker asymmetry cannot excuse missing generation, review or validation.
Review output using the [PRD checklist](../vnext/PRD.md#output-quality-reference), not a new token benchmark.

Run basic interaction checks alongside features when executable controls permit. Final distribution and APEX MCP
redistribution are evaluated last; repeat affected package and client qualification after that decision is implemented.

## Prepare Live Azure Qualification

Live qualification requires explicit human authorization, isolated targets, reviewed target-subscription policy,
pricing evidence, authenticated tools, cleanup ownership and exact preview approval. Quota and regional availability
remain assumptions, not separate evidence gates. Run Bicep and Terraform separately, preserve supplied platform
resources, and bind evidence to the candidate. Follow [the live procedure](../vnext/LIVE-QUALIFICATION.md).

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

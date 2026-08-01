## Original APEX E2E Automation

This directory preserves the original APEX Ralph-loop E2E workflow, validators, benchmark scripts, prompts, and fixtures.
The archived files are historical evidence. They are not active workflow, package, validation, prompt-discovery, or
configuration sources.

## Provenance

- Original paths are preserved beneath this directory.
- Introduced by: `946c72c5c7785e16ded06b4dc26dbf189b194677`.
- Archived from: `901adcbc4b033c912cfbd198307c44b4979b089e`.
- Retirement date: `2026-08-01`.
- Related issue: [#220](https://github.com/jonathan-vella/apex-vnext/issues/220).
- Machine-readable file hashes: [`provenance.json`](provenance.json).

## Rationale

The scheduled workflow depended on `contoso-service-hub-*` original-APEX artifacts that are not produced by the vNext
runtime. Recorded hosted runs failed for that missing corpus, and the workflow was not a protected status check. vNext
qualification now owns deterministic workflow, dual-track, package, restart, fault, and exact-head scorecard evidence.
Keeping the original stack active duplicated validation ownership and maintained a permanently failing scheduled path.

## Replacement Owners

- `npm run qualify:vnext` owns deterministic vNext validation and package qualification.
- `npm run qualify:vnext-release -- --collected-at <ISO-8601-UTC>` owns exact-head scorecard evidence.
- `.github/workflows/release-candidate-qualification.yml` owns hosted exact-head qualification.
- `.github/workflows/vnext-live-qualification.yml` owns explicitly approved live dual-track qualification.
- `tools/registry/diagram-semantics.v1.json` retains active vNext diagram consumers only.

## Active-Reference Exclusions

Archive integrity tests, retirement documentation, changelog history, and frozen Phase 0A evidence may mention these
paths. Active package scripts, workflows, workflow contracts, diagram consumer registries, and prompts must not restore
or execute them.

## Rollback

1. Restore every archived file to the original path recorded in `provenance.json` without changing its bytes.
2. Restore `e2e:validate`, `e2e:benchmark`, and `e2e:combine` in `package.json`.
3. Restore the workflow contract and workflow README entries.
4. Restore the three diagram-semantics consumer rows.
5. Restore or generate a real `contoso-service-hub-*` fixture corpus compatible with the original artifact contract.
6. Run `npm run validate:github-workflows`, `npm run validate:diagram-semantics`, the restored E2E tests, and
   `npm run validate:all`.
7. Record why the original E2E ownership is again compatible with the vNext runtime and protected checks.

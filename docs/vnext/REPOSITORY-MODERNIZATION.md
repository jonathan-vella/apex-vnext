# Repository Modernization

Status: implementation and automated qualification complete; interactive client, human review, merge, and release
gates remain. This document is the authoritative maintenance ledger for repository-wide legacy removal and modernization
on `feat/governance-baseline-import`.

## Candidate Identity

| Field             | Value                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Candidate label   | `modernization-2026-09-20.2`                                                                                                                                 |
| Source baseline   | `5184c0c177fd2fc4a1badb1007fb9e2bee8b80be`                                                                                                                   |
| Baseline captured | 2026-09-20T07:19:00Z                                                                                                                                         |
| Starting branch   | `feat/governance-baseline-import`                                                                                                                            |
| Pull request      | #345 (draft, open)                                                                                                                                           |
| Starting worktree | Dirty: target-governance work, retired archive removals, and current-only policy-precheck tests; see `logs/repository-modernization/wp00-starting-state.log` |
| Historical CI     | Green only for baseline source; not qualification for this worktree                                                                                          |
| Qualified source  | `9b177608897ff71d2eaa4a6b89c81fe5c9ae63bb`                                                                                                                   |

## Execution Status

| Status                      | State                               | Evidence or blocker                                                                |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| source-cleanup-complete     | passed                              | Entry points, readers, generated assets, active guidance, and residue reviewed     |
| toolchain-selected          | passed                              | Exact Current/stable versions activated; prior user-owned binaries retained        |
| offline-validation-passed   | passed                              | `qualify:vnext` and `validate:all` passed on qualified source                      |
| provider-behavior-qualified | not-applicable-with-approved-reason | Provider/module selections and lockfile are unchanged; native semantic tests pass  |
| client-vscode-qualified     | pending                             | VS Code 1.138.0 / Copilot Chat 0.66.0 ready; interactive gate targets older source |
| client-cli-qualified        | pending                             | Copilot CLI 1.0.86 ready; interactive gate targets older source                    |
| hosted-ci-passed            | passed                              | All 10 exact-head checks passed on qualified source                                |
| review-ready                | pending                             | Automated findings resolved; interactive client and human review gates remain      |
| merge-authorized            | pending                             | Human gate                                                                         |
| release-accepted            | pending                             | Human release gate                                                                 |

## Coverage

The complete tracked-file inventory is `logs/repository-modernization/wp01-tracked-files.txt`. Worktree,
ignored-tracked, and untracked inventories are retained alongside it. Dependency-owned `node_modules` and project
environments are reviewed through their manifests and lockfiles rather than as source.

| Group                                                                 | Review mode                                                                  | State    |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Root files, dotfiles, package manifests, lockfiles                    | Direct review                                                                | complete |
| `packages/` runtime, contracts, capabilities, CLI, renderers, testkit | Direct review of exports, state boundaries, registrations, and candidates    | complete |
| `config/`, `tools/`, registries, scripts, schemas, tests              | Direct review of validators, generators, shipped paths, and candidates       | complete |
| `.github/`, `customizations/`, `.vscode/`                             | Direct review of actions, prompts, skills, manifests, and client projections | complete |
| `docs/`, `infra/`, generated catalogs                                 | Review active guidance and generators; retain narrow historical evidence     | complete |
| `agent-output/`, archives, ignored/generated residue                  | Classify provenance, packaging risk, and owner; never rewrite consumer state | complete |

## Contract Register

| Family                                                  | Current disposition                                                     | Evidence and required tests                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `governance-baseline-selection-v1`                      | Obsolete input; reject before mutation                                  | WP04 target-bound import tests                          |
| `governance-baseline-selection-v2`                      | Current target-bound selection                                          | Target, scope, assignment identity, and freshness tests |
| `governance-baseline-v1`                                | Current only for its strict current shape; suffix alone is not obsolete | Collector/importer schema and rejection tests           |
| `policy-precheck-v2`                                    | Current strict precheck format                                          | `tools/tests/validate-policy-precheck.test.mjs`         |
| `policy-precheck-v1` and unsupported versions           | Reject before side effects                                              | `tools/tests/validate-policy-precheck.test.mjs`         |
| Exported contracts in `packages/contracts/src/index.ts` | Current strict contracts; metadata and generated schemas are complete   | Contract registry, metadata, producer, and reader tests |
| Kernel journal and transaction formats                  | Preserve current crash recovery and integrity                           | Kernel journal, transaction, and fault-injection tests  |

## Initial Findings

| ID  | Anchor                                                         | Disposition                                                                     | Next work package       |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------- |
| L01 | `packages/capabilities/src/iac-generation.ts` binding sentinel | Removed; parity parses embedded exact pins without a declared-version bypass    | WP06 complete           |
| L02 | CLI `apex promote` alias                                       | Removed; retain `project promote` and MCP `promote`                             | WP05 complete           |
| L03 | CLI/service single-output completion                           | Removed; CLI and MCP use atomic typed output bundles                            | WP05 complete           |
| L05 | Governance collector/importer                                  | Current target-bound collection/import completed and tested                     | WP04 complete           |
| L07 | Policy-precheck validator and tests                            | Current v2-only validation and contradiction rejection retained                 | WP03/WP07 complete      |
| L11 | Bicep and Terraform instructions                               | Removed direct deploy guidance and stale tag contracts                          | WP09 complete           |
| L12 | Docker debug compose and scripts                               | Removed; host Azure CLI receiver and privacy tests retained                     | WP08 complete           |
| L13 | `apex-recall` generated or environment residue                 | Build residue removed; isolated environment rebuilt without package             | WP07 complete           |
| L19 | Functions recipe materialization                               | Removed unavailable pack and templates; retained assessment/backlog guidance    | WP08 complete           |
| L21 | `validate:terraform` failure swallowing                        | Repaired with isolated data directories and regression coverage                 | WP03 complete           |
| L23 | Toolchain pins and CI metadata                                 | Current exact selections, engines, CI Node, and rollback-safe WSL setup aligned | WP02/WP10/WP11 complete |

## Frozen Candidate Table

Candidate `modernization-2026-09-20.2` is frozen at `2026-09-20T07:13:12Z` for the listed stable JavaScript
selections. It binds source `5184c0c177fd2fc4a1badb1007fb9e2bee8b80be`, dirty diff
`7632c7a1e3d5a6ac00e17d32b93bb51397c0a6de4164eca77c8c3a777f49aa9b`, and the initial lock hashes in
`logs/repository-modernization/wp02-lockfile-hashes.txt`.

| Component                 | Current                      | Selected stable           | Source and state                                                           |
| ------------------------- | ---------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| Node                      | 26.8.2                       | 26.9.0 Current            | Official checksum verified; active with side-by-side rollback              |
| npm                       | 12.0.2                       | 12.0.2                    | Active under selected Node                                                 |
| MCP SDK                   | 1.29.0                       | 1.30.0                    | Installed; MCP schema, lifecycle, stdio, and adapter tests pass            |
| Zod                       | 4.4.3                        | 4.6.5                     | Installed; MCP bridge and output-schema tests pass                         |
| ESLint                    | 10.8.0                       | 10.11.0                   | Installed; CI lint passes                                                  |
| TypeScript                | 7.0.2                        | 7.0.2                     | npm registry metadata; already current                                     |
| TypeBox, Ajv, Hono, Resvg | recorded direct versions     | unchanged                 | npm registry checks; already current                                       |
| Root tooling updates      | see `wp02-npm-outdated.json` | selected stable entries   | Installed in separate runtime/tooling clusters; npm audit reports zero     |
| Azure MCP                 | 3.0.0-beta.37                | 3.0.0-beta.45             | Explicit rolling beta exception; CI verifies exact npm latest before tests |
| GitHub Actions            | major tags                   | reviewed full commit SHAs | Release labels retained in contract; every third-party use is immutable    |
| Terraform                 | 1.16.2                       | 1.16.3                    | Official checksum verified; 1.16.2 retained for rollback                   |
| azd                       | 1.34.0                       | 1.34.1                    | Official digest verified; 1.34.0 retained for rollback                     |
| GitHub CLI                | 2.100.0                      | 2.101.0                   | Official digest verified; 2.100.0 retained for rollback                    |
| Copilot CLI               | 1.0.83                       | 1.0.86                    | Official digest verified; 1.0.83 retained for rollback                     |
| Python / Ruff             | 3.14.7 / 0.16.7              | 3.14.7 / 0.16.8           | Isolated `.venv` rebuilt from hash-pinned requirements                     |

The direct workspace inventory, npm metadata, audit, installed tools, and action consumers are recorded under
`logs/repository-modernization/wp02-*`. `npm audit` reports zero vulnerabilities. No upgrade is qualified or activated
by this table.

## Final Automated Evidence

- `qualify:vnext`: 146 validator tests and 33 package tests passed with zero failures or cancellations.
- `validate:all`: Node, documentation, hooks, security, toolchain, Python, Terraform, and Bicep lanes passed.
- Final package payload: five exact-source npm tarballs plus SBOM and provenance; reproducible pack and clean install passed.
- Run-lock contention: 64 stale-generation contenders and the 120-service reproducer completed without unstable errors.
- Lock/transfer integration: 49 kernel tests and 10 state-transfer tests pass; local lock metadata cannot be imported.
- Secret review: the full modernization range and both compressed and extracted release payloads produced zero findings.
- Hosted validation: all 10 pull-request checks passed, including CI, CodeQL, IaC, docs, and release qualification.
- Review: all automated review threads contain fix evidence and are resolved.

## Validation Repair

`validate:terraform` now delegates to `tools/scripts/validate-terraform.mjs`. It validates every immediate Terraform
root with `main.tf`, continues through all roots, returns nonzero for any failed init or validation, and isolates
`TF_DATA_DIR` so stale local provider caches cannot influence results.

Run locks preserve live local owners even after TTL expiry. Only expired locks whose local owner is confirmed dead
are reclaimed automatically; unknown-host owners fail closed. Complete generations retire atomically into permanent
local tombstones so delayed contenders cannot remove a replacement lock. These tombstones are excluded from state
transfer and retained for concurrency safety; automatic tombstone garbage collection is not implemented.
State transfer rejects active locks and pending transactions rather than exporting incomplete mutation state.

## Checkpoint

Next action: perform exact-candidate interactive qualification in both selected clients, then obtain protected human
review and merge decisions. Release, Windows-side client changes, and live Azure operations remain separately
authorized gates.

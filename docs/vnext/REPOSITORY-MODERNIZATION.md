# Repository Modernization

Status: in progress. This document is the authoritative maintenance ledger for the repository-wide legacy removal and
modernization work on `feat/governance-baseline-import`.

## Candidate Identity

| Field             | Value                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Candidate label   | pending WP02 freeze                                                                                                                                          |
| Source baseline   | `5184c0c177fd2fc4a1badb1007fb9e2bee8b80be`                                                                                                                   |
| Baseline captured | 2026-09-20T07:19:00Z                                                                                                                                         |
| Starting branch   | `feat/governance-baseline-import`                                                                                                                            |
| Pull request      | #345 (draft, open)                                                                                                                                           |
| Starting worktree | Dirty: target-governance work, retired archive removals, and current-only policy-precheck tests; see `logs/repository-modernization/wp00-starting-state.log` |
| Historical CI     | Green only for baseline source; not qualification for this worktree                                                                                          |

## Execution Status

| Status                      | State   | Evidence or blocker                                                               |
| --------------------------- | ------- | --------------------------------------------------------------------------------- |
| source-cleanup-complete     | pending | WP01 inventory and dependent cleanup incomplete                                   |
| toolchain-selected          | blocked | Stable JavaScript set frozen; Azure MCP and Action SHA evidence remain unresolved |
| offline-validation-passed   | pending | Terraform provider cache requires repair before aggregate validation can pass     |
| provider-behavior-qualified | pending | Requires WP11 semantic-delta evidence                                             |
| client-vscode-qualified     | pending | Requires clean same-candidate client qualification                                |
| client-cli-qualified        | pending | Requires clean same-candidate client qualification                                |
| hosted-ci-passed            | pending | No current candidate head yet                                                     |
| review-ready                | pending | Dependent qualification statuses incomplete                                       |
| merge-authorized            | pending | Human gate                                                                        |
| release-accepted            | pending | Human release gate                                                                |

## Coverage

The complete tracked-file inventory is `logs/repository-modernization/wp01-tracked-files.txt`. Worktree,
ignored-tracked, and untracked inventories are retained alongside it. Dependency-owned `node_modules` and project
environments are reviewed through their manifests and lockfiles rather than as source.

| Group                                                                 | Review mode                                                                  | State       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- |
| Root files, dotfiles, package manifests, lockfiles                    | Direct review                                                                | in progress |
| `packages/` runtime, contracts, capabilities, CLI, renderers, testkit | Direct review of exports, state boundaries, registrations, and candidates    | in progress |
| `config/`, `tools/`, registries, scripts, schemas, tests              | Direct review of validators, generators, shipped paths, and candidates       | in progress |
| `.github/`, `customizations/`, `.vscode/`                             | Direct review of actions, prompts, skills, manifests, and client projections | in progress |
| `docs/`, `infra/`, generated catalogs                                 | Review active guidance and generators; retain narrow historical evidence     | in progress |
| `agent-output/`, archives, ignored/generated residue                  | Classify provenance, packaging risk, and owner; never rewrite consumer state | in progress |

## Contract Register

| Family                                                  | Current disposition                                                     | Evidence and required tests                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `governance-baseline-selection-v1`                      | Obsolete input; reject before mutation                                  | WP04 target-bound import tests                           |
| `governance-baseline-selection-v2`                      | Current candidate pending WP04 review                                   | Target, scope, assignment identity, and freshness tests  |
| `governance-baseline-v1`                                | Current only for its strict current shape; suffix alone is not obsolete | Collector/importer schema and rejection tests            |
| `policy-precheck-v2`                                    | Current strict precheck format                                          | `tools/tests/validate-policy-precheck.test.mjs`          |
| `policy-precheck-v1` and unsupported versions           | Reject before side effects                                              | `tools/tests/validate-policy-precheck.test.mjs`          |
| Exported contracts in `packages/contracts/src/index.ts` | Individually current pending reader/producer mapping                    | WP01 export, consumer, persistence, and rejection review |
| Kernel journal and transaction formats                  | Preserve current crash recovery and integrity                           | Kernel journal, transaction, and fault-injection tests   |

## Initial Findings

| ID  | Anchor                                                         | Disposition                                                             | Next work package |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| L01 | `packages/capabilities/src/iac-generation.ts` binding sentinel | Confirmed candidate for removal after caller trace                      | WP06              |
| L02 | CLI `apex promote` alias                                       | Confirmed compatibility alias; retain `project promote`                 | WP05              |
| L03 | CLI/service single-output completion                           | Retire after all callers use typed or bundled completion                | WP05              |
| L05 | Governance collector/importer                                  | Dirty current-only work requires review and focused qualification       | WP04              |
| L07 | Policy-precheck validator and tests                            | Preserve current v2 rejection coverage; inspect redundant wrappers only | WP03/WP07         |
| L12 | Docker debug compose and scripts                               | Approved retirement; host receiver remains current                      | WP08              |
| L13 | `apex-recall` generated or environment residue                 | Confirm ownership before removal                                        | WP07              |
| L19 | Functions recipe materialization                               | Retire unavailable executable scaffolding; retain one backlog item      | WP08              |
| L21 | `validate:terraform` failure swallowing                        | Repaired and regression-tested; real cache error now fails truthfully   | WP03              |
| L23 | Toolchain pins and CI metadata                                 | Freeze exact selections before upgrades                                 | WP02              |

## Frozen Candidate Table

Candidate `modernization-2026-09-20.1` is frozen at `2026-09-20T07:13:12Z` for the listed stable JavaScript
selections. It binds source `5184c0c177fd2fc4a1badb1007fb9e2bee8b80be`, dirty diff
`7632c7a1e3d5a6ac00e17d32b93bb51397c0a6de4164eca77c8c3a777f49aa9b`, and the initial lock hashes in
`logs/repository-modernization/wp02-lockfile-hashes.txt`.

| Component                 | Current                      | Selected stable                       | Source and state                                                            |
| ------------------------- | ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Node                      | 26.8.2 installed             | pending official release verification | Current-channel policy requires a separate official checksum record         |
| npm                       | 12.0.2 installed             | 12.0.2                                | Installed and selected pending Node pairing verification                    |
| MCP SDK                   | 1.29.0                       | 1.30.0                                | npm registry metadata; peer supports Zod 4                                  |
| Zod                       | 4.4.3                        | 4.6.5                                 | npm registry metadata                                                       |
| ESLint                    | 10.8.0                       | 10.11.0                               | npm registry metadata; Node >=24 compatible                                 |
| TypeScript                | 7.0.2                        | 7.0.2                                 | npm registry metadata; already current                                      |
| TypeBox, Ajv, Hono, Resvg | recorded direct versions     | unchanged                             | npm registry checks; already current                                        |
| Root tooling updates      | see `wp02-npm-outdated.json` | latest stable entries                 | npm registry evidence; defer installation until blocked clusters resolve    |
| Azure MCP                 | 3.0.0-beta.37                | blocked                               | Latest is beta.45; stable 2.x exists but is not proven equivalent           |
| GitHub Actions            | major tags                   | blocked                               | Official release lookup stopped at an organization token policy restriction |

The direct workspace inventory, npm metadata, audit, installed tools, and action consumers are recorded under
`logs/repository-modernization/wp02-*`. `npm audit` reports zero vulnerabilities. No upgrade is qualified or activated
by this table.

## Validation Repair

`validate:terraform` now delegates to `tools/scripts/validate-terraform.mjs`. It validates every immediate Terraform
root with `main.tf`, continues through all roots, and returns nonzero for any failed init or validation. The focused
test passes. The real root presently fails during `terraform init` because existing provider-cache targets are symlinks;
that environmental condition is intentionally no longer hidden.

## Checkpoint

Next action: complete WP01 consumer and contract tracing, then freeze the WP02 candidate set before mutating runtime,
dependency, or workflow surfaces.

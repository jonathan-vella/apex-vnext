# Qualification Reference

> [Current Version](../../VERSION.md) | Evidence levels and commands for APEX vNext candidates.

No local command, fixture, or historical dossier grants release authority by itself.

## Evidence Levels

| Level | Proves | Does not prove |
| --- | --- | --- |
| Deterministic | Contracts, state transitions, validation, rendering, and bounded behavior | Client UI or live Azure behavior |
| Package | Reproducible pack and clean installation | Supported-client interaction |
| Client | Exact client discovery, routing, MCP, lifecycle, and normalized outcomes | Live Azure deployment |
| Live | Candidate-bound cloud and client outcomes | Release approval |
| Release | Required scorecard, exact-head checks, approvals, and evidence closure | Future candidates |

## Repository Commands

| Command | Purpose |
| --- | --- |
| `npm run build:vnext` | Build all vNext TypeScript packages. |
| `npm run validate:vnext` | Validate source, contracts, configuration, and projections. |
| `npm run test:vnext` | Run workspace package tests. |
| `npm run test:vnext-validator` | Test validation and live-workflow contracts. |
| `npm run test:vnext-pack` | Pack and clean-install the runtime reproducibly. |
| `npm run qualify:vnext` | Run deterministic validation, workspace tests, validator tests, and pack tests. |
| `npm run validate:all` | Run complete repository validation, including external tool checks. |

Live and release commands are maintainer procedures. They require exact candidate binding and explicit authorization;
they are not implied by ordinary development or documentation changes.

## Current Status

APEX vNext is pre-release and no release candidate is selected. Historical qualification remains characterization only.
Consult the [client support matrix](client-support.md) and binding [project controls](../vnext/README.md).

## Authority

- [`package.json`](../../package.json)
- [`tools/scripts/validate-vnext.mjs`](../../tools/scripts/validate-vnext.mjs)
- [`tools/scripts/qualify-vnext-release.mjs`](../../tools/scripts/qualify-vnext-release.mjs)

## Related

- [Qualify a candidate](../how-to/qualify-candidate.md)
- [Client support](client-support.md)
- [Project controls](../vnext/README.md)

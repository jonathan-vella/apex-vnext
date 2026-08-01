# APEX vNext Checkpoint

- **Updated:** 2026-08-01
- **Repository:** `jonathan-vella/apex-vnext`
- **Integration branch:** `main`
- **Product status:** Pre-release
- **Release candidate:** None selected

## Current State

The standalone vNext repository owns a deterministic TypeScript runtime, versioned contracts, bounded capabilities,
renderers, CLI/MCP lifecycle, managed VS Code and Copilot CLI projections, and deterministic qualification.

Repository modernization has retired original automation, prompts, compatibility utilities, duplicate workflows and npm
scripts, stale root configuration, and unneeded development-container tooling. The active documentation has been rebuilt
around vNext source authorities and Diátaxis navigation.

## Open Release Work

- Complete exact-candidate live qualification for supported client interactions.
- Complete separately authorized Bicep and Terraform cloud qualification.
- Bind current governance, pricing, quota, availability, security, and cleanup evidence.
- Select an exact release candidate only after all blocking evidence is current.
- Keep package publication, tags, releases, deployment, and cutover explicitly unauthorized until final approval.

GitHub Issues and the repository project own day-to-day work selection. [ROADMAP.md](ROADMAP.md) owns dependency order;
[REGISTER.md](REGISTER.md) owns unresolved risks; [PRD.md](PRD.md) owns acceptance.

## Evidence Status

| Evidence                                                       | Status                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| Contract, kernel, capability, renderer, CLI, and package tests | Required on every candidate                               |
| Clean package installation                                     | Required and deterministic                                |
| Managed projection generation and lifecycle                    | Implemented and tested                                    |
| VS Code live client outcomes                                   | Current candidate pending                                 |
| Copilot CLI live client outcomes                               | Current candidate pending with autonomous-worker omission |
| Bicep live Azure outcomes                                      | Current candidate pending                                 |
| Terraform live Azure outcomes                                  | Current candidate pending                                 |
| Release authority                                              | Not granted                                               |

Historical candidate dossiers are archived and do not satisfy current gates.

## Resume Protocol

1. Verify the current `main` head and protected check state.
2. Review open issues and the roadmap dependency order.
3. Select one bounded item with an owner and acceptance evidence.
4. Keep live operations separate unless the item carries explicit authorization.
5. Update this checkpoint only when the durable release boundary changes.

# Client Support

> [Current Version](../../VERSION.md) | Implementation and qualification boundaries for APEX vNext clients.

APEX vNext is pre-release. A projection being implemented does not mean that live parity or release acceptance has
passed.

The target initial host is Windows via WSL2, without Docker or a devcontainer. Both ALZ-backed workloads and standalone
labs/demos, independent COE import, conversational changes and complete design/operational output are release goals.
They are not marked implemented by this support matrix. See the [checkpoint](../vnext/PROJECT.md) and
[target client scenarios](../vnext/CLIENT-QUALIFICATION.md).

## Support Matrix

| Surface                        | Implementation                                    | Deterministic proof                       | Live client proof               | Current status    |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------- | ------------------------------- | ----------------- |
| Direct APEX CLI                | Implemented                                       | Required CI and package qualification     | Not applicable                  | Preview-supported |
| GitHub Copilot in VS Code      | Managed projection implemented                    | Projection generation and lifecycle tests | Current candidate pending       | Conditional       |
| GitHub Copilot CLI             | Coordinator and specialist projection implemented | Projection generation and lifecycle tests | Current candidate pending       | Conditional       |
| VS Code autonomous workers     | Implemented                                       | Projection and delegation tests           | Current candidate pending       | Conditional       |
| Copilot CLI autonomous workers | Intentionally omitted                             | Omission and routing tests                | Unavailable by design           | Unsupported       |
| Bicep track                    | Implemented                                       | Deterministic provider and package tests  | Current cloud candidate pending | Conditional       |
| Terraform track                | Implemented                                       | Deterministic provider and package tests  | Current cloud candidate pending | Conditional       |

## Client Differences

Both Copilot clients receive the coordinator and interactive specialist roles. VS Code also receives autonomous code
generation, review, and validation workers. Copilot CLI omits those workers because the qualified hidden-worker boundary
is not available there; the coordinator must not claim otherwise.

In Copilot CLI, run interactive specialists as foreground custom agents. The coordinator names the required role
and supplies a continuation note with the user's scope; the user selects that role before continuing. Interactive
handoff edges do not grant the background `task` tool. In Requirements, expect native `ask_user` questions followed
by `recordInput` acceptance, not a text-form summary returned by a background agent. Invalid option values require
user correction or confirmation; recommendations are never substituted silently.

Required generation, review and validation outcomes still need a supported CLI path. A missing path blocks the complete
workflow claim; the absence of hidden workers is not an exemption from the product goal.

The direct `apex` CLI is the runtime control surface. It is not a third Copilot client and does not perform creative
requirements, architecture, or planning work by itself.

Onboarding is shared: global CLI, one-shot `npx`, and Copilot CLI all invoke `apex bootstrap`. VS Code may additionally
use the opt-in user-profile **APEX Bootstrap** agent to invoke that same command before the workspace projection exists.
After reload, the workspace-selected VS Code projection remains the only active APEX client projection.

Agent Plugins and APEX MCP redistribution are evaluated last. Their eventual support must be proven using exact client
versions and lifecycle tests, not inferred from plugin-format compatibility alone.

## Evidence Boundary

Historical fixtures characterize behavior but cannot grant release authority. Current support requires evidence bound
to the exact candidate, observed client versions, managed projection hashes, and required live interactions.

## Authority

- [`customizations/manifest.json`](../../customizations/manifest.json)
- [`config/toolchain.v1.json`](../../config/toolchain.v1.json)
- [Client qualification control](../vnext/CLIENT-QUALIFICATION.md)

## Related

- [Client projections](../explanation/client-projections.md)
- [Qualification reference](qualification.md)
- [Manage installation](../how-to/manage-installation.md)

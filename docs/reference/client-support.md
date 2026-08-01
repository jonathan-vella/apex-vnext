# Client Support

> [Current Version](../../VERSION.md) | Implementation and qualification boundaries for APEX vNext clients.

APEX vNext is pre-release. A projection being implemented does not mean that live parity or release acceptance has
passed.

## Support Matrix

| Surface | Implementation | Deterministic proof | Live client proof | Current status |
| --- | --- | --- | --- | --- |
| Direct APEX CLI | Implemented | Required CI and package qualification | Not applicable | Preview-supported |
| GitHub Copilot in VS Code | Managed projection implemented | Projection generation and lifecycle tests | Current candidate pending | Conditional |
| GitHub Copilot CLI | Coordinator and specialist projection implemented | Projection generation and lifecycle tests | Current candidate pending | Conditional |
| VS Code autonomous workers | Implemented | Projection and delegation tests | Current candidate pending | Conditional |
| Copilot CLI autonomous workers | Intentionally omitted | Omission and routing tests | Unavailable by design | Unsupported |
| Bicep track | Implemented | Deterministic provider and package tests | Current cloud candidate pending | Conditional |
| Terraform track | Implemented | Deterministic provider and package tests | Current cloud candidate pending | Conditional |

## Client Differences

Both Copilot clients receive the coordinator and interactive specialist roles. VS Code also receives autonomous code
generation, review, and validation workers. Copilot CLI omits those workers because the qualified hidden-worker boundary
is not available there; the coordinator must not claim otherwise.

The direct `apex` CLI is the runtime control surface. It is not a third Copilot client and does not perform creative
requirements, architecture, or planning work by itself.

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

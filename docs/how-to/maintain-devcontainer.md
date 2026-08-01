# Maintain The Development Container

> [Current Version](../../VERSION.md) | Keep the vNext toolchain portable, deterministic, and context-efficient.

## Preserve The Core Toolchain

The container supports Windows, macOS, and Linux Docker hosts and Linux `amd64` and `arm64` execution. Core features
provide Node.js, Python, Azure CLI and Bicep, PowerShell, Terraform, GitHub CLI, and Azure Developer CLI.

Optional capability runtimes do not belong in the core container unless the vNext runtime contract changes.

## Keep Lifecycle Deterministic

- `onCreateCommand` installs minimal repository prerequisites.
- `postCreateCommand` runs the deterministic bootstrap and locked npm installation.
- `postStartCommand` installs repository hooks without upgrading packages.

Do not add recurring network upgrades or duplicate package installation.

## Use Portable Storage

Azure CLI, azd, GitHub CLI, uv, and Terraform caches use named volumes. Do not bind host credential paths into the
container. Preserve explicit `amd64` and `arm64` checks in local features and bootstrap scripts.

## Review Extensions

The extension inventory must match `.devcontainer/devcontainer.json` and `.vscode/extensions.json` exactly. Extension
packs are prohibited because transitive extensions bypass inventory checks and can inject unrelated agents, prompts, or
tools.

Before adding an extension, inspect its `contributes` keys for chat agents, skills, prompts, participants, and tools.
Update the inventory validator and denylist only with a bounded reason.

## Validate Changes

```bash
npm run validate:vscode
npm run validate:extension-bloat
npm run test:hooks
npm run validate:tool-versions
```

Rebuild without cache to test changed features or bootstrap behavior. Protected CI validates repository contracts but
does not replace an actual multi-architecture container build.

## Diagnose Context Bloat

Use Copilot Chat diagnostics to inspect loaded agents, skills, instructions, prompts, hooks, and extension contributions.
Workspace settings intentionally disable unrelated user-profile discovery for this repository.

## Related

- [Contribute to APEX vNext](contribute.md)
- [Client projections](../explanation/client-projections.md)
- [Development container reference](../../.devcontainer/README.md)

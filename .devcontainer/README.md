# APEX vNext Development Container

The development container provides the repository tooling needed to build, test, validate, and package APEX vNext.
It supports Docker hosts on Windows, macOS, and Linux and container architectures `amd64` and `arm64`.

## Prerequisites

- Docker Desktop or a compatible Docker Engine
- Visual Studio Code with the Dev Containers extension
- At least 4 GB of memory available to Docker

Open the repository in Visual Studio Code and run **Dev Containers: Reopen in Container**.

## Core Toolchain

Devcontainer features install:

| Tool | Version policy | Purpose |
| --- | --- | --- |
| Node.js | 24 | vNext packages and repository validation |
| Python | 3.14 | Python validation and tests |
| Azure CLI and Bicep | Current feature release | Azure contracts and IaC validation |
| PowerShell | Current feature release | Governance discovery scripts |
| Terraform | Current signed HashiCorp release | Terraform validation |
| GitHub CLI | Current feature release | Repository operations |
| Azure Developer CLI | Current feature release | Authorized Azure lifecycle operations |
| Bats and gitleaks | Ubuntu release | Hook tests and staged secret scanning |

The bootstrap runs `npm ci`, installs `pytest`, Ruff, and the in-repository apex-recall test package, then validates the
tool and editor contracts. Optional capability-pack runtimes are resolved by their owning vNext contracts; they are not
installed globally in the core container.

## Editor Extensions

The exact extension inventory is declared identically in `.devcontainer/devcontainer.json` and
`.vscode/extensions.json`. It contains Copilot Chat, Python/Pylance, Bicep, PowerShell, Markdownlint, GitHub Actions and
Pull Requests, Prettier, YAML, and Terraform support.

Extension packs are prohibited because transitive extensions bypass inventory validation and can contribute unrelated
agents, prompts, and tools.

## Portability

Azure CLI, azd, GitHub CLI, uv, and Terraform caches use container-scoped named volumes. No host credential directory
is bind-mounted, so the same configuration works across Windows, macOS, and Linux hosts.

The local Terraform feature explicitly accepts Linux `amd64` and `arm64` and fails closed on unsupported CPU
architectures. The post-create bootstrap applies the same architecture check.

## Lifecycle

- `onCreateCommand` installs Bats and uv.
- `postCreateCommand` runs the deterministic `.devcontainer/post-create.sh` bootstrap.
- `postStartCommand` installs repository Git hooks from the already locked npm dependencies.

Container start does not upgrade packages or mutate tool versions. Rebuild the container when feature definitions or
the lock file change.

## Authentication

Run `az login` or `az login --use-device-code` inside the container when live Azure access is explicitly required.
Azure credentials persist in a named volume and are never committed.

For GitHub CLI operations, provide `GH_TOKEN` to the Visual Studio Code process. The devcontainer forwards it without
persisting it in repository files. Verify access with:

```bash
gh auth status
```

## Validation

Run the focused configuration checks with:

```bash
npm run validate:vscode
npm run validate:extension-bloat
npm run validate:tool-versions
```

Run `npm run qualify:vnext` for deterministic product qualification. Live Azure qualification remains a separate,
explicitly authorized operation.

## Troubleshooting

| Issue | Action |
| --- | --- |
| Feature or tool is missing | Rebuild the container without cache |
| Bootstrap failed | Review `~/.devcontainer-install.log`, fix the reported contract failure, and rebuild |
| Azure authentication expired | Run `az login --use-device-code` |
| GitHub CLI is unauthenticated | Set `GH_TOKEN` for the Visual Studio Code process and rebuild |
| Cached provider is stale | Remove the relevant named volume and rebuild |

See the [repository instructions](../AGENTS.md) for validation and architecture conventions.

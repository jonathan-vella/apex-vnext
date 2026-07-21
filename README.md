# APEX vNext

APEX vNext is the standalone development repository for the deterministic APEX
runtime, CLI, managed VS Code customizations, qualification infrastructure, and
release controls.

> [!WARNING]
> This repository is a pre-cutover release line. Production claims remain
> blocked until the live qualification and final release gates are complete.

## Start Here

Install the locked dependencies and run deterministic qualification:

```bash
npm ci
npm run qualify:vnext
```

Use focused commands while developing:

```bash
npm run build:vnext
npm run validate:vnext
npm run test:vnext
npm run test:vnext-validator
npm run test:vnext-pack
```

## Documentation

- [Documentation index](docs/README.md)
- [Installation](docs/guides/installation.md)
- [Workflow](docs/guides/workflow.md)
- [CLI and MCP reference](docs/guides/cli-reference.md)
- [Operations](docs/guides/operations.md)
- [Security](docs/guides/security.md)
- [Security policy and vulnerability reporting](SECURITY.md)
- [Qualification](docs/guides/testing.md)
- [Project and release controls](docs/vnext/README.md)

Documentation is maintained as ordinary Markdown under `docs/`. This repository
does not include or publish an Astro site.

## Repository Structure

| Path | Purpose |
| ---- | ------- |
| `packages/` | TypeScript contracts, kernel, capabilities, renderers, testkit, and CLI |
| `customizations/` | Managed VS Code agent and skill bundle |
| `config/` | Runtime, workflow, capability-pack, toolchain, and scorecard contracts |
| `infra/` | Bicep and Terraform qualification infrastructure |
| `tools/` | Validators, packaging, live qualification, MCP servers, and project utilities |
| `docs/guides/` | User-facing Markdown guides |
| `docs/vnext/` | Product scope, roadmap, decisions, risks, and qualification procedures |

## Release Safety

Cloud deployment, GitHub Environment approval, package publication, tags, and
release cutover remain explicit maintainer-authorized operations. Local tests do
not substitute for the live evidence required by the
[product acceptance criteria](docs/vnext/PRD.md#cutover-acceptance).

## Provenance

This repository began as a clean snapshot of the qualified vNext integration
head from the original APEX repository. See [docs/MIGRATION.md](docs/MIGRATION.md)
and [SOURCE_PROVENANCE.json](SOURCE_PROVENANCE.json) for the immutable source
reference and extraction policy.

## License

MIT. See [LICENSE](LICENSE).

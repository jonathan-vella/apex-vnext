# APEX vNext

APEX vNext is the standalone development repository for the deterministic APEX
runtime, CLI, managed Copilot customizations, qualification infrastructure, and
release controls.

> [!WARNING]
> This repository is a pre-cutover release line with no current release
> candidate. The `0.10.0` contract is being re-baselined for GitHub Copilot in
> VS Code and GitHub Copilot CLI. Prior qualification is historical only.

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
- [First local run](docs/tutorials/first-run.md)
- [Workflow](docs/how-to/run-workflow.md)
- [CLI reference](docs/reference/cli.md)
- [Operations](docs/how-to/operate-project.md)
- [Security and authority](docs/explanation/security-and-authority.md)
- [Security policy and vulnerability reporting](SECURITY.md)
- [Qualification](docs/how-to/qualify-candidate.md)
- [Project and release controls](docs/vnext/README.md)

Documentation is maintained as ordinary Markdown under `docs/`. This repository
does not include or publish an Astro site.

## Repository Structure

| Path | Purpose |
| ---- | ------- |
| `packages/` | TypeScript contracts, kernel, capabilities, renderers, testkit, and CLI |
| `customizations/` | Canonical managed source for supported Copilot client projections |
| `config/` | Runtime, workflow, capability-pack, toolchain, and scorecard contracts |
| `infra/` | Bicep and Terraform qualification infrastructure |
| `tools/` | Validators, packaging, live qualification, MCP servers, and project utilities |
| `docs/tutorials/`, `docs/how-to/`, `docs/explanation/`, `docs/reference/` | vNext product documentation |
| `docs/vnext/` | Product scope, roadmap, decisions, risks, and qualification procedures |

## Release Safety

Cloud deployment, GitHub Environment approval, package publication, tags, and
release cutover remain explicit maintainer-authorized operations. Local tests do
not substitute for the live evidence required by the
[product acceptance criteria](docs/vnext/PRD.md#cutover-acceptance).

## Provenance

See [Migration](docs/MIGRATION.md) and [SOURCE_PROVENANCE.json](SOURCE_PROVENANCE.json) for extraction provenance.

## License

MIT. See [LICENSE](LICENSE).

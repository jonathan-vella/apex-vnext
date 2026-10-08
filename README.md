# APEX vNext

APEX vNext is the standalone development repository for the deterministic APEX
runtime, CLI, managed Copilot customizations, qualification infrastructure, and
release controls.

The product goal is a workload platform factory: a COE builds documented, coded
archetypes, and consumers reuse independent copies and adapt them through APEX.
Preserve rich output while minimizing repeated input and keeping one owner per
fact. Both ALZ-backed workloads and standalone labs/demos are initial scope.

The supported hosts are VS Code with the Copilot harness and the GitHub Copilot
app on native Windows 11, and GitHub Copilot CLI on Linux or WSL2, without a
devcontainer ([DECISION-033](docs/vnext/DECISIONS.md)). APEX ships as the
`apex` Agent Plugin plus `apex init` onboarding; no plugin release is published
yet.
See the [PRD](docs/vnext/PRD.md) and [roadmap](docs/vnext/ROADMAP.md) for planned
scope, and the [checkpoint](docs/vnext/PROJECT.md) for implementation status.

> [!WARNING]
> This repository is a pre-cutover release line with no current release
> candidate. The `0.10.0` contract is being re-baselined for GitHub Copilot in
> VS Code, the GitHub Copilot app and GitHub Copilot CLI. Prior qualification
> is historical only.

## Start Here

For repository development, install locked dependencies and run qualification:

```bash
npm ci
npm run qualify:vnext
```

Consumer onboarding starts with [Manage installation](docs/how-to/manage-installation.md),
not a clone of this development repository. It covers install, update and reset
for each host. No token-baseline project is required now.

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
- [Install, update and reset APEX](docs/how-to/manage-installation.md)
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

| Path                                                                      | Purpose                                                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/`                                                               | TypeScript contracts, kernel, capabilities, renderers, testkit, and CLI       |
| `customizations/`                                                         | Canonical managed source for supported Copilot client projections             |
| `config/`                                                                 | Runtime, workflow, capability-pack, toolchain, and scorecard contracts        |
| `infra/`                                                                  | Bicep and Terraform qualification infrastructure                              |
| `tools/`                                                                  | Validators, packaging, live qualification, MCP servers, and project utilities |
| `docs/tutorials/`, `docs/how-to/`, `docs/explanation/`, `docs/reference/` | vNext product documentation                                                   |
| `docs/vnext/`                                                             | Product scope, roadmap, decisions, risks, and qualification procedures        |

## Release Safety

Cloud deployment, GitHub Environment approval, package publication, tags, and
release cutover remain explicit maintainer-authorized operations. Local tests do
not substitute for the live evidence required by the
[product acceptance criteria](docs/vnext/PRD.md#cutover-acceptance).

## License

MIT. See [LICENSE](LICENSE).

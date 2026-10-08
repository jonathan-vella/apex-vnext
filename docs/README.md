# APEX vNext Documentation

> [Current Version](../VERSION.md) | Pre-release documentation for the governed APEX runtime and clients.

APEX vNext targets COE workload reuse and conversational adaptation with rich design and operational output. Both
ALZ-backed workloads and standalone labs/demos are initial scope. APEX runs in VS Code with the Copilot harness or the
GitHub Copilot app on native Windows 11, or in GitHub Copilot CLI on Linux or WSL2, without a devcontainer. The kernel
owns state, gates and evidence; clients guide people through it.

The [PRD](vnext/PRD.md) defines the target contract. Guides describe implemented commands and mark planned extensions
explicitly; the [checkpoint](vnext/PROJECT.md) identifies remaining work. APEX ships as the `apex` Agent Plugin plus
`apex init` onboarding; no plugin release is published yet.

## Start By Goal

| Goal                                     | Start here                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Install, update or reset APEX            | [Manage installation](how-to/manage-installation.md)                                 |
| Start in VS Code or the app on Windows   | [Windows 11 first run](tutorials/windows-11-first-run.md)                            |
| Start in Copilot CLI on Linux or WSL2    | [Copilot CLI on WSL2 runbook](tutorials/wsl2-vscode-consumer-runbook.md)             |
| Evaluate APEX locally                    | [Complete the first local run](tutorials/first-run.md)                               |
| Run a governed workflow                  | [Run the workflow](how-to/run-workflow.md)                                           |
| Understand planned COE reuse and changes | [Project adaptation](explanation/workflow-and-gates.md#planned-coe-reuse-and-change) |
| Review output quality expectations       | [Quality reference](vnext/PRD.md#output-quality-reference)                           |
| Preview or reconcile infrastructure      | [Operate a project](how-to/operate-project.md)                                       |
| Contribute to the repository             | [Contribute to APEX vNext](how-to/contribute.md)                                     |
| Understand kernel authority              | [Runtime architecture](explanation/runtime-architecture.md)                          |
| Look up commands or support              | [Reference index](reference/README.md)                                               |

## Tutorials

- [Complete the first local run](tutorials/first-run.md) introduces initialization, readiness, and deterministic local
  state without making cloud changes.
- [Windows 11 first run](tutorials/windows-11-first-run.md) creates an APEX workspace on native Windows and starts APEX
  in VS Code or the GitHub Copilot app.
- [Copilot CLI on WSL2 runbook](tutorials/wsl2-vscode-consumer-runbook.md) creates an APEX workspace in Ubuntu on WSL2
  and starts APEX in Copilot CLI.

## How-To Guides

- [Prepare Windows 11](how-to/prepare-windows-11.md)
- [Manage installation](how-to/manage-installation.md)
- [Run the workflow](how-to/run-workflow.md)
- [Maintain requirements intake](how-to/maintain-requirements-intake.md)
- [Operate a project](how-to/operate-project.md)
- [Qualify a candidate](how-to/qualify-candidate.md)
- [Contribute to APEX vNext](how-to/contribute.md)
- [Historical development agent logging](how-to/debug-local.md)

## Explanation

- [Runtime architecture](explanation/runtime-architecture.md)
- [Workflow and gates](explanation/workflow-and-gates.md)
- [Security and authority](explanation/security-and-authority.md)
- [Client projections](explanation/client-projections.md)

## Reference

- [Reference index](reference/README.md)
- [Client support](reference/client-support.md)
- [CLI commands](reference/cli.md)
- [MCP tools](reference/mcp.md)
- [Configuration and contracts](reference/configuration.md)
- [Sources of truth](reference/sources-of-truth.md)
- [Bicep and Terraform](reference/iac-tracks.md)
- [Qualification](reference/qualification.md)

## Project Controls

Binding product requirements, decisions, risks, release controls, and qualification procedures remain under
[`docs/vnext`](vnext/README.md). These files govern repository development and are not user tutorials.

The [documentation inventory](vnext/documentation-inventory.v1.json) records current content ownership.

## Validate Documentation

```bash
npm run validate:docs
```

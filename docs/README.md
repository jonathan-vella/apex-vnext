# APEX vNext Documentation

> [Current Version](../VERSION.md) | Pre-release documentation for the governed APEX runtime and clients.

APEX vNext targets COE workload reuse and conversational adaptation with rich design and operational output. Both
ALZ-backed workloads and standalone labs/demos are initial scope, using VS Code or Copilot CLI on Windows via WSL2
without a devcontainer. The kernel owns state, gates and evidence; clients guide people through it.

The [PRD](vnext/PRD.md) defines the target contract. Guides describe implemented commands and mark planned extensions
explicitly; the [checkpoint](vnext/PROJECT.md) identifies remaining work. Distribution and APEX MCP packaging are the
last feature-delivery phase, not prerequisites for completing governance and workload reuse.

## Start By Goal

| Goal                                     | Start here                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Start on Windows 11 with WSL2            | [WSL2 consumer runbook](tutorials/wsl2-vscode-consumer-runbook.md)                   |
| Evaluate APEX locally                    | [Complete the first local run](tutorials/first-run.md)                               |
| Install or update APEX                   | [Manage installation](how-to/manage-installation.md)                                 |
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
- [WSL2 and VS Code consumer runbook](tutorials/wsl2-vscode-consumer-runbook.md) installs the published preview and
  creates a VS Code workspace in Ubuntu on WSL2.

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

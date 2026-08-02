# APEX vNext Documentation

> [Current Version](../VERSION.md) | Pre-release documentation for the governed APEX runtime and clients.

APEX vNext is a deterministic workflow runtime for governed Azure platform engineering. The kernel owns state,
authorization, gates, evidence, and bounded operations. Copilot clients guide people through that runtime; they do not
replace its authority.

## Start By Goal

| Goal | Start here |
| --- | --- |
| Start on Windows 11 with WSL2 | [Windows 11 first run](tutorials/windows-11-first-run.md) |
| Evaluate APEX locally | [Complete the first local run](tutorials/first-run.md) |
| Install or update APEX | [Manage installation](how-to/manage-installation.md) |
| Run a governed workflow | [Run the workflow](how-to/run-workflow.md) |
| Preview or reconcile infrastructure | [Operate a project](how-to/operate-project.md) |
| Contribute to the repository | [Contribute to APEX vNext](how-to/contribute.md) |
| Understand kernel authority | [Runtime architecture](explanation/runtime-architecture.md) |
| Look up commands or support | [Reference index](reference/README.md) |

## Tutorials

- [Complete the first local run](tutorials/first-run.md) introduces initialization, readiness, and deterministic local
  state without making cloud changes.
- [Windows 11 first run](tutorials/windows-11-first-run.md) prepares WSL2, Azure, and a selected Copilot client.

## How-To Guides

- [Prepare Windows 11](how-to/prepare-windows-11.md)
- [Manage installation](how-to/manage-installation.md)
- [Run the workflow](how-to/run-workflow.md)
- [Operate a project](how-to/operate-project.md)
- [Qualify a candidate](how-to/qualify-candidate.md)
- [Contribute to APEX vNext](how-to/contribute.md)
- [Maintain the development container](how-to/maintain-devcontainer.md)

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

The [documentation inventory](vnext/documentation-inventory.v1.json) records content ownership and migration status.
Frozen Phase 0A evidence remains immutable.

## Migration History

Predecessor history and extraction provenance are isolated in [Migration](MIGRATION.md). Active product documentation is
vNext-only.

## Validate Documentation

```bash
npm run validate:docs
```

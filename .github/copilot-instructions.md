# APEX - Copilot Instructions

> VS Code Copilot-specific orchestration instructions.
> For general project conventions, build commands, and code style, see the root `AGENTS.md`.

## Azure Defaults (canonical)

This section is the canonical declaration of Azure infrastructure defaults.
Every Azure infrastructure skill, agent, and prompt must reference this section — never restate
the values inline. The IaC-flavoured mirror with CAF naming, AVM modules,
and reference index lives in
[`.github/skills/azure-defaults/SKILL.md`](skills/azure-defaults/SKILL.md).

## Repository Maintenance Mode

When a prompt explicitly declares repository maintenance, its approved branch, scope, testing, validation, archive,
and stop boundaries govern that run. Do not route maintenance through managed APEX roles or live cloud operations
unless the current bounded item directly evaluates that surface.
Path-scoped instructions and repository safety rules still apply.

### Default Regions

| Service             | Default Region       | Reason                         |
| ------------------- | -------------------- | ------------------------------ |
| **All resources**   | `swedencentral`      | EU GDPR-compliant              |
| **Static Web Apps** | `westeurope`         | Not available in swedencentral |
| **Failover**        | `germanywestcentral` | EU paired alternative          |

### Required Tags (Azure Policy Enforced)

Tag schema is **whatever live Azure Policy enforces** in the target subscription. A typed governance contract with
`tag_contract.source: "policy"` always wins.

**Greenfield fallback** (no tag policy found at any inherited scope):
the APEX-standard 9-tag set — `environment`, `owner`, `costcenter`,
`application`, `workload`, `sla`, `backup-policy`, `maint-window`,
`technical-contact` — all lowercase. This mirrors the org-wide
resource-group tag-deny policy (every key must exist on the RG or the
deployment is denied). Citation + greenfield decision checklist:
[`azure-defaults/references/tag-strategy.md`](skills/azure-defaults/references/tag-strategy.md).

> The PascalCase set (`Environment`, `ManagedBy`, `Project`, `Owner`)
> is a **deprecated convention** retained only for backward
> compatibility on existing projects whose deployed resources already
> carry that casing. Do not propagate it to new projects. `ManagedBy`
> and `Project` are not part of the required contract — `ManagedBy` may
> still be emitted as an optional deploy-provenance marker.

### Security baseline + AVM mandate

Non-negotiable: HTTPS-only, TLS 1.2 minimum, no public blob, public network
disabled for prod data services, Managed Identity over keys, AVM-first.
Full rules:
[`iac-policy-compliance.md`](instructions/references/iac-policy-compliance.md)
and
[`iac-security-baseline.md`](instructions/references/iac-security-baseline.md).

### SKU source of truth

Creative SKU decisions (App Service, VM, SQL, Cosmos, AKS pools, Redis,
APIM, App Gateway, Storage replication) flow through
the versioned `workload-decision-manifest-v1` contract. Never re-derive SKUs from prose.

## vNext Runtime

The deterministic runtime in `packages/kernel/` owns state transitions, gates, authorization, evidence, and bounded
improvement. `packages/contracts/` owns versioned schemas; `packages/capabilities/` owns bounded operations;
`packages/cli/` owns lifecycle and terminal interaction. Managed projections under `customizations/` may guide or
delegate, but may not create an independent state machine or bypass kernel authorization.

Use the packaged `apex` CLI for consumer-project lifecycle. Repository changes target source packages, config, and
managed customizations, then run `npm run qualify:vnext`. Live qualification and deployment require explicit human
authorization and are never implied by a code-generation or maintenance request.

## Skills

Skills auto-discover via the `description` field in `.github/skills/{name}/SKILL.md`.
Agents read `SKILL.md` files on demand and load `references/*.md` only when the
body explicitly points to one. There is one tier — no digest, no minimal.

## Chat Triggers

- **User** messages starting with `gh` are GitHub operations (e.g., `gh pr create`,
  `gh workflow run`, `gh api`). Follow `.github/skills/github-operations/SKILL.md`
  (`gh` CLI-first, MCP fallback). This trigger reads user input only — a `gh`
  command an agent issues while executing another prompt never loads the skill.

### GitHub Tool Priority (Mandatory)

For issues and pull requests, prefer the `gh` CLI over GitHub MCP tools — the
CLI is always available in this dev container and is the more stable primitive.
Fall back to MCP only when an operation has no `gh` CLI equivalent (e.g., rich
PR review thread management or bulk GraphQL queries). In devcontainers,
do not run `gh auth` commands unless the user explicitly asks for CLI auth
troubleshooting (`GH_TOKEN` is set via VS Code User Settings →
`terminal.integrated.env.linux`; shell exports do not propagate reliably).

### Explore Subagent Thoroughness

Specify thoroughness explicitly when invoking Explore:

| Lookup Type                           | Thoroughness | Examples                                                  |
| ------------------------------------- | ------------ | --------------------------------------------------------- |
| Single file read, config check        | `quick`      | "What's in azure.yaml?", "Find the main.bicep path"       |
| Multi-file comparison, pattern search | `medium`     | "How do agents reference skills?", "What modules exist?"  |
| Deep codebase research                | `thorough`   | "Audit all security patterns", "Full dependency analysis" |

Check whether the needed information is already in context from earlier
file reads before calling Explore.

## Conventions, Key Files & Validation

See `AGENTS.md` for all conventions, project structure, key file paths,
and build/validation commands.

**Terminal hygiene**: Never use `mv -i`, `rm -i`, `cp -i`, `read -p`, or any
prompt-driven shell builtin (incl. inside `bash -c '...'`). Pipe >50-line
output to a file. See `.github/instructions/no-interactive-shell.instructions.md`
for the full ruleset; `npm run lint:safe-shell` enforces it on committed
agent/skill/instruction snippets.

For vNext implementation, prefer package-level tests and typed contract validation before broad repository checks.

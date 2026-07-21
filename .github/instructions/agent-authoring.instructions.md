---
description: "Standards for managed APEX custom agents and repository prompt files"
applyTo: "customizations/.github/agents/**/*.agent.md, .github/prompts/**/*.prompt.md"
---

# Managed Agent Authoring Standards

## Ownership

- `customizations/.github/agents/` contains the only active APEX custom agents.
- `customizations/manifest.json` owns roles, models, interaction types, cost tiers, and invocation edges.
- Agent frontmatter is executable configuration and must match the corresponding manifest role.
- `config/workflow.v1.json` and the kernel own workflow state, routing, gates, and authorization.
- `.archive/legacy-agents-v0.10/` is historical evidence and must never be added to VS Code discovery settings.

## Frontmatter

Every managed `.agent.md` file must use valid YAML frontmatter with:

- `name`, `description`, `argument-hint`, `model`, `user-invocable`, `tools`, and `agents`.
- `handoffs` only for direct interactive transitions.
- `user-invocable: true` for the coordinator and interactive specialists.
- `user-invocable: false` for hidden workers.
- `agents: []` when the role cannot delegate.
- The smallest tool list that can complete the bounded role.

Model selection is intentional. Update agent frontmatter and the matching role in `customizations/manifest.json` in the
same change, then regenerate `.github/model-catalog.json` with `npm run generate:model-catalog`.

## Interaction Model

- `APEX` coordinates status, resume, and direct handoffs; it does not author artifacts.
- Interactive specialists may use `vscode/askQuestions` for user-owned choices exposed by the kernel.
- Hidden workers never ask users and return typed `needs_input` results when required input is absent.
- A handoff or model response never changes canonical workflow state.
- State changes occur only through narrow `apex/*` MCP tools accepted by the kernel.

## Body Structure

Use short H2 sections for role, method or workflow, boundaries, and output. Write imperative instructions and avoid
repeating repository-wide policy already supplied by instructions or managed skills.

Reference managed skills through `.github/skills/{name}/SKILL.md` as they appear in an installed consumer workspace.
The source files live under `customizations/.github/skills/` and are packaged by the CLI asset preparation step.

## Security Boundaries

- Do not grant shell, Git, Azure, filesystem, publication, approval, or deployment tools to managed agents.
- Do not let an agent self-approve, decide Gate 4, publish, tag, or bypass kernel authorization.
- Do not embed secrets, credentials, raw chat history, or secret-bearing logs.
- Keep hidden-worker output bounded, typed, and suitable for deterministic validation.

## Validation

Run the narrow checks while editing and the complete suite before merge:

```bash
npm run prepare:vnext-assets
npm run validate:agents
npm run validate:model-consistency
npm run validate:model-catalog
npm run validate:vnext
npm run validate:all
```

After changing managed agent files, verify a clean consumer install and supported VS Code discovery before making release
claims.

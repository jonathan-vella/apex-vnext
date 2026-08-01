# Contribute To APEX vNext

> [Current Version](../../VERSION.md) | Change the runtime without bypassing contracts, ownership, or qualification.

## Set Up The Repository

```bash
npm ci
npm run build:vnext
npm run validate:vnext
```

Use the development container for the complete cross-platform toolchain. Work on a short-lived conventional branch and
keep unrelated user changes intact.

## Respect Package Boundaries

| Package | Owns |
| --- | --- |
| `packages/contracts` | Versioned schemas and validation shapes |
| `packages/kernel` | State, tasks, gates, authorization, journals, and evidence decisions |
| `packages/capabilities` | Bounded provider and workflow operations |
| `packages/renderers` | Client-neutral deterministic views |
| `packages/cli` | Lifecycle, terminal commands, MCP facade, and managed installation |
| `packages/testkit` | Deterministic fixtures and qualification support |

Client behavior belongs in `customizations` and adapters. Do not create workflow authority in agents, skills, prompts,
renderers, or scripts.

## Distinguish Source And Generated Files

Edit canonical package source, `config/*.v1.json`, and `customizations`. Regenerate derived schemas, assets, projections,
and package output through owning commands. Never patch generated output as an independent source of truth.

## Develop One Slice

1. Identify the controlling code path and one cheap falsifying check.
2. Make the smallest grounded edit.
3. Run that focused check immediately.
4. Add tests proportional to risk and blast radius.
5. Update documentation when behavior, commands, support, or ownership changes.
6. Run broader validation only after focused checks pass.

## Validate

```bash
npm run validate:all
npm run qualify:vnext
```

Do not run live cloud qualification unless it is separately authorized. Do not bypass hooks or protected branch checks.

## Open A Pull Request

Use a Conventional Commit title, explain behavior and evidence, and let required CI and exact-head qualification finish.
Publication, tags, releases, and production cutover remain explicit maintainer operations.

## Related

- [Repository contribution summary](../../CONTRIBUTING.md)
- [Runtime architecture](../explanation/runtime-architecture.md)
- [Qualification reference](../reference/qualification.md)

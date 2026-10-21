# Contribute To APEX vNext

> [Current Version](../../VERSION.md) | Change the runtime without bypassing contracts, ownership, or qualification.

## Set Up The Repository

```bash
npm ci
npm run build:vnext
npm run validate:vnext
```

Use the [Windows and WSL2 setup automation](prepare-windows-11.md#automated-repository-setup) for the development
toolchain without a devcontainer. Activate the repository `.venv` before Python checks. Work on a short-lived
conventional branch and keep unrelated user changes intact.

## Respect Package Boundaries

| Package                 | Owns                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `packages/contracts`    | Versioned schemas and validation shapes                              |
| `packages/kernel`       | State, tasks, gates, authorization, journals, and evidence decisions |
| `packages/capabilities` | Bounded provider and workflow operations                             |
| `packages/renderers`    | Client-neutral deterministic views                                   |
| `packages/cli`          | Lifecycle, terminal commands, MCP facade, and managed installation   |
| `packages/testkit`      | Deterministic fixtures and qualification support                     |

Client behavior belongs in `customizations` and adapters. Do not create workflow authority in agents, skills, prompts,
renderers, or scripts.

## Distinguish Source And Generated Files

Edit canonical package source, `config/*.v1.json`, and `customizations`. Regenerate derived schemas, assets, projections,
and package output through owning commands. Never patch generated output as an independent source of truth.

## Current Guidance Ownership

The [guidance delivery registry](../../tools/registry/guidance-delivery.v1.json) records managed source and retained
maintainer entrypoints. Historical originals belong to the [archive catalog](../../.archive/CATALOG.json), not
active discovery or qualification. Follow the [restore guide](../../.archive/RESTORE.md) for inspection only.

## Develop One Slice

1. Identify the controlling code path and one cheap falsifying check.
2. Make the smallest grounded edit.
3. Run that focused check immediately.
4. Add tests proportional to risk and blast radius.
5. Update documentation when behavior, commands, support, or ownership changes.
6. Run broader validation only after focused checks pass.

## Change Requirements Intake

Requirements intake is kernel-owned. When changing its catalog, input contract, replay behavior, or tests, follow
[Maintain requirements intake](maintain-requirements-intake.md). Do not edit generated client projections or packaged
assets as a substitute for their source.

## Validate

```bash
npm run validate:all
npm run qualify:vnext
```

Do not run live cloud qualification unless it is separately authorized. Do not bypass hooks or protected branch checks
where they can run; see [Native Windows limits](#native-windows-limits).

## Native Windows Limits

Prefer WSL2 or the devcontainer for development; the hooks and shell scripts are written for them. On native Windows
(PowerShell with Git for Windows):

- **Git hooks do not run.** lefthook 2.1.17 passes each multi-line `run:` script to `sh -c` without escaping inner
  double quotes, so a double-quoted string containing spaces splits the script and `sh` reports
  `unexpected end of file`. Upstream tracks this as
  [evilmartians/lefthook#1167](https://github.com/evilmartians/lefthook/issues/1167); 2.2.x does not change it. Commit
  from WSL2, or use `--no-verify` and run the validators for the files you changed (for example `npm run lint:md`,
  `npm run validate:skills`, `npx prettier --check <files>`). Say in the pull request which checks you ran by hand;
  required CI remains the gate.
- **Symlink tests need the symlink privilege.** Many rejection tests create symlinks and fail with `EPERM` unless
  Windows Developer Mode is on or the shell is elevated.
- **Plugin package tests download from the npm registry** and fail on a network that intercepts TLS. Run them in CI or
  WSL2.

## Open A Pull Request

Use a Conventional Commit title, explain behavior and evidence, and let required CI and exact-head qualification finish.
Publication, tags, releases, and production cutover remain explicit maintainer operations.

## Related

- [Repository contribution summary](../../CONTRIBUTING.md)
- [Maintain requirements intake](maintain-requirements-intake.md)
- [Runtime architecture](../explanation/runtime-architecture.md)
- [Qualification reference](../reference/qualification.md)

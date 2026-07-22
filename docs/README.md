# Documentation

APEX vNext documentation is maintained as repository-native Markdown. No site
build is required to read, review, or validate it.

## User Guides

| Guide | Purpose |
| ----- | ------- |
| [Preview overview](guides/index.md) | Scope, support boundary, and next actions |
| [Installation](guides/installation.md) | Build, install, initialize, and verify the package set |
| [Workflow](guides/workflow.md) | Specialists, workers, gates, and promotion |
| [CLI and MCP reference](guides/cli-reference.md) | Commands, flags, errors, and narrow MCP tools |
| [Operations](guides/operations.md) | Provider setup, preview, apply, recovery, and transfer |
| [Security](guides/security.md) | Kernel authority, writer ownership, approval, and evidence boundaries |
| [Qualification](guides/testing.md) | Deterministic lanes and manual test checklist |
| [Live qualification](guides/live-qualification.md) | Bind manual and cloud evidence to one candidate |
| [Devcontainer hygiene](guides/devcontainer-hygiene.md) | Keep Copilot context and extensions focused |

## Project And Release Controls

- [Project hub](vnext/README.md)
- [Current checkpoint](vnext/PROJECT.md)
- [Product requirements](vnext/PRD.md)
- [Roadmap](vnext/ROADMAP.md)
- [Risk and issue register](vnext/REGISTER.md)
- [Decision log](vnext/DECISIONS.md)
- [Supported client qualification contract](vnext/CLIENT-QUALIFICATION.md)
- [Guidance and automation review contract](vnext/GUIDANCE-AUTOMATION-REVIEW.md)
- [Guidance and automation characterization evidence](vnext/GUIDANCE-AUTOMATION-CHARACTERIZATION.md)
- [Historical qualification dossier and reopened gates](vnext/FINAL-QUALIFICATION.md)
- [Live qualification procedure](vnext/LIVE-QUALIFICATION.md)

## Historical Evidence

The [Phase 0A evidence](vnext/phase-0a/README.md) is frozen source material from
the original repository. Historical references inside that boundary are not
rewritten during repository extraction.

## Validation

```bash
npm run validate:docs
```

This command checks Markdown style, local and external links, and repository
documentation freshness.

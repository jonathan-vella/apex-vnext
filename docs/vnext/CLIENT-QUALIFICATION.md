# Supported Client Qualification

This control defines release-blocking evidence for GitHub Copilot in VS Code and GitHub Copilot CLI. Generated
projection tests are necessary but do not replace live client interaction.

## Candidate Binding

Before interaction, record the exact source commit, package and runtime locks, managed projection digests, client
versions, executable hashes, MCP inventory, and clean consumer workspace identity. An update during a run invalidates
that client result.

## Scenario Matrix

| ID | Shared required outcome | VS Code | Copilot CLI |
| --- | --- | --- | --- |
| `CLIENT-001` | Candidate versions and hashes are bound before work. | Required | Required |
| `CLIENT-002` | Instructions, target projection, agents, and skills are discovered once. | Required | Required |
| `CLIENT-003` | Missing input creates one kernel request and one typed answer event. | `vscode/askQuestions` | Interactive `ask_user` |
| `CLIENT-004` | APEX MCP starts with the exact managed allowlist. | Required | Required |
| `CLIENT-005` | Specialists route correctly and worker boundaries hold. | Workers delegated | Workers absent by design |
| `CLIENT-006` | Gates, stale-state rejection, and operation denial match. | Required | Required |
| `CLIENT-007` | Restart resumes the same journal head without chat history. | Required | Required |
| `CLIENT-008` | Writer conflict and accepted transfer preserve owner epochs. | Required | Required |
| `CLIENT-009` | Init, update, conflict, rollback, uninstall, and reinstall are atomic. | Required | Required |
| `CLIENT-010` | Shared fake-provider workflow outcomes normalize equally. | Required | Required |

Unavailable client mechanics remain unavailable; they are not inferred as passing. Copilot CLI autonomous workers are
intentionally omitted under ADR-0006.

## Execution Rules

1. Use clean independent consumer workspaces for each client.
2. Install the same exact package candidate and one selected projection.
3. Trust only the qualification workspace; do not mutate user-global configuration.
4. Use explicit tool grants. Broad allow-all or remote delegation modes are prohibited.
5. Record structured outcomes and content-free provenance, not raw chat or secrets.
6. Repeat both clients after any release-relevant runtime, contract, projection, MCP, skill, or toolchain change.

## Acceptance

A client passes only when every applicable blocking scenario has current evidence and all normalized comparisons verify.
The aggregate cannot grant release authority; it becomes one input to the final release receipt.

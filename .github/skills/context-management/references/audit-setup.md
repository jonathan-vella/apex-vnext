<!-- ref:audit-setup-v1 -->

# Audit Mode Prerequisites & Setup

> Loaded by `context-management` SKILL.md (Audit mode). Covers what must be
> in place before running a context-window audit and how to enable richer
> Copilot Chat debug logs.

## Prerequisites

- Python 3.14 (for log parser script)
- Access to VS Code Copilot Chat debug logs
- Managed agent definitions in `customizations/.github/agents/*.agent.md` (or equivalent)

## Enabling Debug Logs

Copilot Chat writes debug logs automatically to the VS Code log directory. To find the
latest logs:

```bash
find ~/.vscode-server/data/logs/ -name "GitHub Copilot Chat.log" -newer /tmp/marker 2>/dev/null \
  | sort | tail -5
```

For richer output, set `github.copilot.advanced.debug.overrideLogLevels` in VS Code settings
to capture verbose tool-call data.

## Audit Capabilities

| Capability            | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| Log Parsing           | Extract structured data from Copilot Chat debug logs         |
| Turn-Cost Profiling   | Estimate token spend per turn from timing and model metadata |
| Redundancy Detection  | Find duplicate file reads, overlapping instructions          |
| Hand-Off Gap Analysis | Identify agents that should delegate to subagents            |
| Instruction Audit     | Flag overly broad globs and oversized instruction files      |
| Report Generation     | Structured markdown report with prioritized recommendations  |

## Portability

The audit mode contains **no project-specific logic**. To use in another project:

1. Copy `.github/skills/context-management/` to the target repo
2. Copy `.github/instructions/context-optimization.instructions.md`
3. Copy `tools/scripts/snapshot-agent-context.sh` and
   `tools/scripts/diff-context-baseline.sh`
4. The log parser auto-discovers VS Code log directories

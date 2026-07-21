# Legacy APEX Agent Fleet

## Status

This directory preserves the pre-vNext custom agent and subagent definitions that previously lived under
`.github/agents/`. They are historical compatibility inputs and are not active VS Code customizations.

The active product experience is owned by:

- `customizations/.github/agents/` for the managed APEX coordinator, interactive specialists, and hidden workers.
- `customizations/.github/skills/` for managed workflow guidance.
- `customizations/manifest.json` for roles, models, interaction types, and invocation edges.
- `packages/` and `config/` for runtime state, authorization, workflow, and validation behavior.

## Why Archived

The legacy fleet used prompt-led step agents and dedicated deployment/review subagents. APEX vNext replaces that product
surface with a deterministic kernel, narrow MCP tools, direct interactive handoffs, and hidden bounded workers. Keeping
both fleets discoverable caused duplicate old and new APEX experiences in VS Code.

The source files retain their original hierarchy under `.archive/legacy-agents-v0.10/.github/agents/` so historical
references and the frozen v1 compatibility matrix remain auditable. Compatibility tooling may read these files, but new
features and fixes must target the managed APEX definitions and runtime.

The archive also contains the retired manual agent registry and schema, prompt-contract validators, and shared authoring
instructions that applied only to the step-agent fleet. Archived validator source is retained for audit and is not part
of the active npm validation graph.

## Boundaries

- Do not add this directory to `chat.agentFilesLocations`.
- Do not invoke archived agents for current projects.
- Do not copy archived state-changing behavior into managed agents.
- Preserve these files unless the frozen Phase 0A evidence and v1 compatibility contract are retired through their
  documented release gate.

---
name: apex-mermaid
description: "Renders safe inline Mermaid for supported APEX Markdown document slots from accepted artifact data. Use for inline flow, sequence, state, ER, or Gantt diagrams."
user-invocable: false
---

# APEX Inline Mermaid

Use this skill only to request an inline Mermaid fence through a renderer-supported document slot. The renderer owns
slot support, rendering, validation, and the returned document receipt.

## Rules

1. Use only accepted artifact values and explicit kernel decisions supplied to the renderer.
2. Request only a documented, renderer-supported inline document slot. Keep the diagram inside a `mermaid` fence.
3. Use Mermaid for compact flows, sequences, states, ER models, or Gantt views. See
   [syntax guidance](references/syntax.md).
4. Use concise labels, a neutral theme directive, and limited `classDef` styling. See
   [styling guidance](references/styling.md).
5. Delegate syntax and slot validation to the renderer capability. Return its rendered document or receipt; do not
   claim validation from local inspection.

## Boundaries

- Do not create standalone architecture, network, runtime, as-built, WAF, cost, or compliance diagrams.
- Do not write or edit files, invoke deployment, or mutate source-of-truth artifacts, templates, schemas, or state.
- Do not use unaccepted inputs, infer missing values, or treat rendered Markdown as gate evidence.

## Blockers

When the requested document slot is unsupported, absent, or cannot be filled from accepted data, return a blocker that
names the slot and missing renderer support or artifact data. Do not emit a substitute diagram or alter any source.

## Output

Return only the renderer request or its rendered inline document result and receipt. Preserve any projected artifact and
template hashes.

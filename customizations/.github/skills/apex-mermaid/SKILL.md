---
name: apex-mermaid
description: "Requests safe inline Mermaid for supported APEX Markdown slots. Use for compact flowcharts, sequences, state machines, ER models, Gantt views, renderer validation, accessible theming, and syntax troubleshooting from accepted artifact data."
user-invocable: false
---

# APEX Inline Mermaid

Use this skill only to request an inline Mermaid fence through a renderer-supported document slot. The renderer owns
slot support, rendering, validation, and the returned document receipt.

## Prerequisites

- The target template exposes a Mermaid-capable inline slot.
- Accepted artifact data contains every node, relationship, label, and time value to be shown.
- The renderer declares supported Mermaid syntax and validation behavior.

## Workflow

1. Confirm the slot and choose the simplest diagram type that preserves the accepted relationship.
2. Map accepted values to stable node or participant IDs and concise display labels.
3. Apply the syntax rules in [syntax guidance](references/syntax.md).
4. Apply the accessible theme and class rules in [styling guidance](references/styling.md).
5. Submit the bounded fence to the renderer and inspect its validation result.
6. Correct only the renderer request and retry. If the slot or syntax remains unsupported, return the blocker.

Keep one primary idea per diagram. Split an overloaded inline view or use the appropriate standalone diagram capability;
do not shrink labels until the relationship becomes unreadable.

## Boundaries

- Do not create standalone architecture, network, runtime, as-built, WAF, cost, or compliance diagrams.
- Do not write or edit files, invoke deployment, or mutate source-of-truth artifacts, templates, schemas, or state.
- Do not use unaccepted inputs, infer missing values, or treat rendered Markdown as gate evidence.
- Do not embed Azure service icons, custom SVG, secrets, physical principal IDs, unsafe links, or Mermaid click actions.
- Do not claim syntax or visual validation from model inspection; only the renderer receipt supplies that evidence.

## Blockers

When the requested document slot is unsupported, absent, or cannot be filled from accepted data, return a blocker that
names the slot, diagram type, and missing renderer support or artifact data. Also block when renderer-version syntax,
escaping, or accessibility cannot be validated. Do not emit a substitute diagram or alter any source.

## Output

Return only the renderer request or its rendered inline document result and receipt. Preserve any projected artifact and
template hashes, validation status, and unresolved blockers.

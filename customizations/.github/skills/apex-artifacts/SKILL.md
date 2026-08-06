---
name: apex-artifacts
description: "Present accepted APEX typed artifacts as bounded Markdown documents. Use for artifact templates, document slots, and derived views."
user-invocable: false
---

# APEX Artifact Presentations

Use this skill only after the kernel has accepted the typed artifact. The artifact schema and accepted object hash remain
canonical; a Markdown document is a derived presentation.

## Rules

1. Select the document template that matches the accepted artifact kind.
2. Preserve the template's heading order and section slots.
3. Fill slots only from `apex/taskContext`, accepted artifact values, or explicit kernel decisions.
4. Preserve unknown and deferred values. Do not replace them with assumptions.
5. Do not write files, edit `agent-output`, or use shell tools. Return the rendered document through the kernel-rendered
   document capability when it is available.
6. Do not treat rendered Markdown as gate evidence or alter typed artifact values to fit a template.

## Templates

- [Requirements document](templates/requirements.md) - present an accepted `requirements` artifact.

## Output

Return a bounded document request or the kernel-rendered Markdown receipt. Include source artifact and template hashes
when the capability projects them.

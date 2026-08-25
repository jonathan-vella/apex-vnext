# Instruction Catalog Review

> [Current Version](../../VERSION.md) | Generated retired-source to managed-consumer instruction mapping.

This file is generated from
[`guidance-migration.v1.json`](../../tools/registry/guidance-migration.v1.json). Do not edit it manually.

## Evidence Boundary

The catalog proves only the declared instruction disposition and managed target inventory.
It does not prove live client discovery or workflow behavior.

## Source Dispositions

| Retired source instruction                   | Disposition    | Managed consumer target                             | Rationale                                                                                        |
| -------------------------------------------- | -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| agent-authoring.instructions.md              | adapt          | apex-* / apex-agent-authoring.instructions.md       | Preserves managed-agent tool, state, and interaction boundaries for consumers.                   |
| agent-skills.instructions.md                 | adapt          | apex-* / apex-skill-authoring.instructions.md       | Preserves concise skill structure and progressive disclosure guidance.                           |
| azure-artifacts.instructions.md              | adapt          | apex-* / apex-artifact-contracts.instructions.md    | Preserves typed artifact identity and evidence boundaries without source template workflows.     |
| azure-yaml.instructions.md                   | adapt          | apex-* / apex-azure-yaml.instructions.md            | Preserves consumer azd co-location and environment naming rules.                                 |
| code-quality.instructions.md                 | adapt          | apex-* / apex-code-quality.instructions.md          | Preserves consumer code quality and secret-safe review boundaries.                               |
| context-optimization.instructions.md         | adapt          | apex-* / apex-context.instructions.md               | Preserves narrow consumer guidance and progressive loading rules.                                |
| docs-trigger.instructions.md                 | exclude-unsafe | not-declared                                        | Repository change-trigger and maintenance rules do not belong in consumer workspaces.            |
| docs.instructions.md                         | adapt          | apex-* / apex-documentation.instructions.md         | Preserves consumer documentation structure and evidence-aware language.                          |
| github-actions.instructions.md               | adapt          | apex-* / apex-automation.instructions.md            | Preserves consumer workflow safety without repository CI ownership rules.                        |
| governance-discovery.instructions.md         | adapt          | apex-* / apex-governance.instructions.md            | Preserves evidence-bound governance and planning boundaries without direct discovery operations. |
| iac-bicep-best-practices.instructions.md     | adapt          | apex-* / apex-bicep.instructions.md                 | Preserves consumer Bicep security, AVM, naming, and validation guidance.                         |
| iac-plan-best-practices.instructions.md      | adapt          | apex-* / apex-governance.instructions.md            | Preserves track-neutral planning and policy evidence boundaries.                                 |
| iac-terraform-best-practices.instructions.md | adapt          | apex-* / apex-terraform.instructions.md             | Preserves consumer Terraform security, provider, and validation guidance.                        |
| instructions.instructions.md                 | adapt          | apex-* / apex-instruction-authoring.instructions.md | Preserves consumer instruction scope and authoring rules.                                        |
| javascript.instructions.md                   | adapt          | apex-* / apex-javascript.instructions.md            | Preserves safe consumer JavaScript and Node.js implementation rules.                             |
| json.instructions.md                         | adapt          | apex-* / apex-json.instructions.md                  | Preserves consumer configuration formatting and secret boundaries.                               |
| lesson-collection.instructions.md            | exclude-unsafe | not-declared                                        | Repository retrospective and orchestration records are not consumer workflow authority.          |
| markdown-docs.instructions.md                | adapt          | apex-* / apex-documentation.instructions.md         | Preserves consumer documentation audience and evidence guidance.                                 |
| markdown.instructions.md                     | adapt          | apex-* / apex-markdown.instructions.md              | Preserves portable Markdown structure and formatting rules.                                      |
| no-hardcoded-counts.instructions.md          | exclude-unsafe | not-declared                                        | Repository entity-count governance has no consumer workflow role.                                |
| no-heredoc.instructions.md                   | adapt          | apex-* / apex-safe-file-edits.instructions.md       | Preserves safe consumer file editing and generated artifact boundaries.                          |
| no-interactive-shell.instructions.md         | adapt          | apex-* / apex-safe-shell.instructions.md            | Preserves non-interactive command and secret-safe consumer guidance.                             |
| powershell.instructions.md                   | adapt          | apex-* / apex-powershell.instructions.md            | Preserves non-interactive consumer PowerShell rules.                                             |
| prompt.instructions.md                       | adapt          | apex-* / apex-prompt-authoring.instructions.md      | Preserves consumer prompt scope, tools, and outcome guidance.                                    |
| python.instructions.md                       | adapt          | apex-* / apex-python.instructions.md                | Preserves safe consumer Python implementation rules.                                             |
| shell.instructions.md                        | adapt          | apex-* / apex-shell.instructions.md                 | Preserves safe consumer shell structure and parsing rules.                                       |
| vendor-prompting.instructions.md             | adapt          | apex-* / apex-prompt-authoring.instructions.md      | Preserves consumer model, tool, and prompt authority boundaries.                                 |

## Related

- [Instruction migration ledger](../../tools/registry/guidance-migration.v1.json)
- [Skill catalog review](SKILL-CATALOG-REVIEW.generated.md)
- [Client qualification](CLIENT-QUALIFICATION.md)

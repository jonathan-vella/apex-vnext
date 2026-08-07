# Naming And Binding Guidance

Use projected run identity, selected environment, and accepted governance constraints as naming inputs. Keep names
deterministic and traceable to the active run.

## Naming Rules

- Use the selected project and environment as the semantic base.
- Apply only a run-stable uniqueness suffix through the selected generator or binding capability.
- Respect service-specific character and length limits before finalizing a binding.
- Preserve lowercase or other policy-specific casing from accepted governance constraints.
- Never derive names from a secret, physical principal ID, subscription ID, or chat-only value.

## Common Constraints

| Resource family | Practical constraint |
| --- | --- |
| Storage account | Lowercase letters and numbers only; globally unique; strict length limit. |
| Key Vault | Lowercase letters, numbers, and hyphens; globally unique; strict length limit. |
| SQL server | Lowercase letters, numbers, and hyphens; globally unique. |
| Resource group, VNet, App Service | Human-readable project/environment names within provider length limits. |

## Binding Output

Record the naming pattern, uniqueness mechanism, maximum-length handling, and any governance exception in the typed
binding. Do not generate shell commands, persist suffix files, or claim a name is available without an accepted
availability or deployment receipt.

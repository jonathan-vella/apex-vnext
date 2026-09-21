---
name: azure-defaults
description: '**UTILITY SKILL** - Locate canonical Azure naming, tags, region, security and AVM rules for vNext. WHEN: "Azure naming", "CAF", "resource tags", "AVM module", "security baseline", "region default". EXCLUDES pricing queries and artifact templates.'
license: MIT
metadata:
  author: jonathan-vella
  version: "2.0"
  category: azure-infrastructure
---

# Azure Defaults

Use the [canonical repository defaults](../../copilot-instructions.md#azure-defaults-canonical); do not restate their
values in another table. Target Azure Policy overrides fallbacks. Accepted workload decisions own creative SKU choices.

Managed project guidance has one owner:
[APEX Azure defaults](../../../customizations/.github/skills/apex-azure-defaults/SKILL.md). Use its references for naming,
tag precedence, security, service selection and AVM binding. Do not add independent gates or infer approval from defaults.

## Reference Index

For source maintenance, these references own additional technical details:

| Concern                        | Reference                                                           |
| ------------------------------ | ------------------------------------------------------------------- |
| Security validation            | [Security baseline](references/security-baseline-full.md)           |
| Naming examples                | [Naming](references/naming-full-examples.md)                        |
| Service lifecycle              | [Deprecated services](references/deprecated-services.md)            |
| ARM pricing evidence           | [Pricing guidance](references/arm-mcp-pricing-guidance.md)          |
| Requirement-to-service choices | [Service matrices](references/service-matrices.md)                  |
| Well-Architected reasoning     | [WAF criteria](references/waf-criteria.md)                          |
| Authentication checks          | [Azure CLI authentication](references/azure-cli-auth-validation.md) |
| Policy effect interpretation   | [Policy effects](references/policy-effect-decision-tree.md)         |

AVM-first does not authorize overriding approved intent. Resolve versions through the owning planning/toolchain contract,
use typed secret references, protect supplied platform resources and retain required deployment approval.

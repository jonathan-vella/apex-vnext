---
name: apex-azure-defaults
description: "Apply projected Azure defaults safely in APEX artifacts. Use for region, naming, tags, security baseline, and AVM-first decisions."
user-invocable: false
---

# APEX Azure Defaults

Use this skill only for an active APEX task. The kernel-projected task context, accepted governance constraints, and
runtime configuration are authoritative. This skill does not define customer policy, discover Azure state, or execute
Azure operations.

## Decision Rules

1. Use the selected run environment and target from `apex/taskContext`; do not infer a region, subscription, tag, or
   policy requirement from chat history.
2. Treat accepted governance constraints as stronger than baseline defaults. When a required value is absent, return an
   explicit blocker or record a kernel-owned deferred decision.
3. Prefer managed identity, HTTPS-only endpoints, TLS 1.2 or stronger, private access for production data services,
   and secret references over literal credentials.
4. Keep resource names deterministic, within service limits, and traceable to the active run. Do not invent a global
   naming authority or persist suffixes outside kernel artifacts.
5. Prefer Azure Verified Modules or track-approved provider modules in bindings. Record a non-AVM exception with its
   reason and requirement traceability.
6. Treat cost, SKU, quota, regional availability, and policy evidence as task inputs. Do not query Azure, run shell
   commands, or generate direct deployment code from this skill.

## References

- [Naming and binding guidance](references/naming.md) - deterministic names and service constraints.
- [Tag and governance precedence](references/tag-precedence.md) - accepted policy before fallback intent.
- [Security baseline](references/security-baseline.md) - identity, transport, private access, and diagnostics decisions.
- [AVM and module bindings](references/avm-binding-guidance.md) - module selection and exception intent.
- [Service selection and WAF criteria](references/service-selection.md) - evidence-based candidate comparison.
- [Governance effects](references/governance-effects.md) - map accepted policy effects to binding decisions.

## Output

Return bounded architecture, plan, or binding decisions with their projected evidence references. Preserve unknown and
deferred values; do not turn absent policy evidence into a default.

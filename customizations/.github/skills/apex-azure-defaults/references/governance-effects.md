# Governance Effect Interpretation

Use accepted governance constraints to determine how policy effects change architecture and binding decisions.

| Effect | Decision treatment |
| --- | --- |
| Deny | Required implementation constraint. Do not propose a noncompliant configuration. |
| Modify | Include the resulting property or tag behavior in binding assumptions. |
| Audit | Record as an operational/compliance obligation and validation input. |
| DeployIfNotExists | Account for the dependent resource or setting in architecture and ownership decisions. |
| Disabled or exempt | Preserve the exemption evidence and its scope/expiry; do not treat it as a global removal of the control. |

## Reconciliation

Map each applicable policy constraint to a typed property, binding decision, accepted risk, or explicit blocker.
Return a blocker when an effect cannot be represented by the selected track or module. Do not query policy assignments
or modify exemptions from the skill.

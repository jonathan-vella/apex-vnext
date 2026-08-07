# Governance Evidence Interpretation

Use this reference after accepted governance evidence is available in the
active task context. The evidence is a point-in-time attestation, not a
standing authorization.

## Acceptance Checks

Treat the evidence as usable only when all of the following hold:

- Discovery status is `COMPLETE`.
- Discovery time is within the evidence freshness limit.
- Subscription and management-group ancestry match the intended task scope.
- A completeness signature is present and matches the accepted evidence
  record.
- A nonempty discovery result is consistent with the evidence metadata.

Any failed check is a blocker. State which check failed and route the task to
the governance discovery capability; do not continue with a guessed baseline.

## Classification Rules

| Policy effect | Planning interpretation |
| --- | --- |
| `Deny` | Block the incompatible design unless an accepted exemption applies. |
| `DeployIfNotExists` | Model it as a deployment-time condition that the plan must accommodate. |
| `Modify` | Model it as a deployment-time mutation that may change the final resource state. |
| `Audit` or `AuditIfNotExists` | Preserve as informational context when present in accepted evidence. |
| `Disabled` | Do not treat as a live constraint. |

An accepted exemption retains the original policy effect but changes its
planning classification to informational. Record its category, expiry, scope,
and rationale. An expired, missing, or scope-mismatched exemption is not an
override.

## Planning Handoff

Project only applicable constraints into the typed decision:

- Required tag keys and values.
- Allowed locations.
- Resource-property constraints with resolvable target paths.
- Policy identifiers, classifications, exemptions, and evidence provenance.

Leave an unresolved property path explicit rather than inventing an IaC
mapping. Authorized planning and delivery capabilities own any later
translation or remediation.

# Governance Evidence Interpretation

Use this reference after accepted governance evidence is available in the
active task context. The evidence is a point-in-time attestation, not a
standing authorization.

## Acceptance Checks

Treat the evidence as usable only when all of the following hold:

- Discovery status is `COMPLETE`.
- Successful Azure collection is less than 30 days old in UTC and not future-dated. File-declared legacy TTLs do not
  override this age rule; exactly 30 days requires refresh.
- Subscription and management-group ancestry match the intended task scope.
- The evidence reference matches the runtime-accepted object. Imported completeness signatures may be empty and are
  explicitly unverified; their presence alone is not collection authenticity or completeness proof.
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

Assignment `enforcementMode` is separate from its effect. `Default` permits Azure request-time enforcement of applicable
effects; `DoNotEnforce` does not. Neither changes the desired constraint that APEX must plan for. Do not describe a
`DoNotEnforce` Deny finding as an Azure request-time denial, or interpret it as permission to generate noncompliant IaC.
The collector preserves both supported modes and rejects unsupported modes such as `Enroll`. Legacy imported findings
without a mode remain unknown, not verified `Default`. A mode change is a content change, not timestamp-only renewal.

Explicit assignment and initiative-member `definitionVersion` selectors are not yet resolved by the collector.
Applicable selectors, including wildcards, stop collection rather than substitute an unversioned definition.
Retain the prior baseline after failure; do not remove Azure version pins to make collection pass.

Collected exemptions retain their resource ID, scope, and expiry. Import preserves that provenance as unverified;
legacy exemptions without it remain unknown. The current subscription-level collector rejects descendant exemption
scopes and unrelated scope pairs rather than treating them as subscription-wide waivers. This does not establish
resource-group/resource coverage or permit skipping target-specific applicability checks.

## Planning Handoff

Project only applicable constraints into the typed decision:

- Required tag keys and values.
- Allowed locations.
- Resource-property constraints with resolvable target paths.
- Policy identifiers, classifications, exemptions, and evidence provenance.

Leave an unresolved property path explicit rather than inventing an IaC
mapping. Authorized planning and delivery capabilities own any later
translation or remediation.

## Resume And Reconciliation

On resume, repeat the acceptance checks against the current task scope and freshness limit. A prior `COMPLETE` result
does not survive a changed subscription, management-group ancestry, evidence signature, or expiry window. When
delivery reports policy drift or an indeterminate provider outcome, preserve the observed result and route it to the
authorized reconciliation lifecycle. Do not rerun discovery, apply an override, or synthesize a corrected policy
baseline from this guidance.

Below 30 days, reuse is the default and refresh is optional. Display the collection date and age when selecting the
snapshot, retain the user's selection for the run when supported, and do not ask again at every stage. Collection
renewal and semantic policy change are distinct: import time is not observation time and a pending refresh is not proof.

Discovery scripts, pack execution, and terminal commands remain outside this skill until a separately qualified typed
capability owns them.

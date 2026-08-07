# Tag And Governance Precedence

Accepted governance constraints are the current authority for required tag keys, casing, values, inheritance, and
exceptions. Baseline tags are only a fallback when the task context explicitly establishes that no policy contract
exists.

## Decision Order

1. Apply required keys and casing from accepted governance constraints.
2. Apply any required values, ownership rules, or environment restrictions from the same evidence.
3. Use the projected run environment and workload identity for values that the task context authorizes.
4. If no governance tag contract exists, record the baseline tag requirement as an assumption rather than inventing an
   organization-specific policy.
5. Return a blocker when a required owner, cost center, or contact value is unknown and cannot be safely deferred.

## Baseline Categories

When a fallback is authorized, tag decisions commonly include environment, owner, cost center, application, workload,
service level, backup policy, maintenance window, and technical contact. The exact names and casing are not universal;
never copy these values over accepted policy evidence.

## Output Constraint

Place tag intent in the architecture or binding decision with its governance evidence hash. Do not query policy or write
tags directly from the skill.

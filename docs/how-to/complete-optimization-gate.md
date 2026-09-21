# Complete The Optimization Gate

> [Current Version](../../VERSION.md) | Handle existing optimization controls during product-plan alignment.

## Current Product Boundary

[REQ-OPTIMIZATION-001](../vnext/PRD.md#req-optimization-001-bounded-input-efficiency) now requires bounded input efficiency,
not a token-baseline project or a whole-repository audit before client learning. Reuse accepted decisions, read relevant
context and regenerate affected outputs. Do not launch a token measurement campaign as the next roadmap step.

## Existing Executable Gate

The committed [optimization gate manifest](../../tools/registry/optimization-gate.v1.json) retains a historical,
candidate-bound read-only audit authorization. Its `authorized` state does not mean the authorization is current or the
audit is complete. Preserve its candidate, expiry, pending baselines and findings; it grants no new execution authority.

The [structural validator](../../tools/scripts/validate-optimization-gate.mjs) checks schema, path ownership and proof
commands. A valid draft or authorized record may have pending baselines; passing this check is not an audit-completion
receipt or a client-execution permission. Only a record claiming `complete` must have every baseline captured and no
deferred release-blocking findings. Keep these completion checks for separately authorized maintenance.

Run the structural check and its regression tests when changing these controls:

```bash
npm run validate:optimization-gate
npm run test:optimization-gate
```

## Align Before Affected Execution

If a requested scenario still depends on the old gate, stop at that concrete blocker and align the owning registry,
validator and tests in a bounded implementation change. Preserve diagnostics, authorization and required security checks.
Do not change a receipt to claim work was performed, skip the check, or reinterpret fixture data as live evidence.

The existing inventory, audit and client-context utilities remain available for separately authorized maintenance or
future measurement. Retain their historical results; they are not new release claims. This documentation revision
does not authorize their execution, removal or automatic mutation of the gate manifest.

## Validate The Changed Slice

Use focused tests first, then required repository and package qualification. Basic client checks can accompany features
once applicable executable controls are aligned. Live client, cloud and release activity still requires separate
authorization and candidate-bound evidence.

## Related

- [Qualify A Candidate](qualify-candidate.md) — run deterministic and later live qualification.
- [Optimization Requirement](../vnext/PRD.md#req-optimization-001-bounded-input-efficiency) — current scope.
- [Supported Client Qualification](../vnext/CLIENT-QUALIFICATION.md) — required client outcomes.

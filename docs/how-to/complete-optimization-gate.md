# Complete The Optimization Gate

> [Current Version](../../VERSION.md) | Prepare the candidate-bound review required before live client or provider qualification.

## Start With A Draft

The committed [optimization gate manifest](../../tools/registry/optimization-gate.v1.json) is intentionally a draft.
It defines the repository review surfaces, owners, consumers, proof commands, and required baselines without granting
mutation authority or claiming a qualification receipt.

Run the structural check before changing the manifest:

```bash
npm run validate:optimization-gate
npm run test:optimization-gate
```

## Bind Authorization

> [!IMPORTANT]
> A maintainer must supply the exact candidate commit and tree, approver, expiry, allowed paths and commands, budgets,
> and stop conditions before the gate moves from `draft` to `authorized`.

Record the authorization in the manifest. Review only the paths and commands authorized for that exact candidate.
Every identified finding must be resolved or deferred with an owner, rationale, expiry, and release impact.

## Complete The Receipt

Capture the required repository inventory, validation duration, package installation, and context-footprint baselines.
Run the allowed proof commands, record measured findings, and run the full deterministic qualification on the immutable
completion tree. Do not begin managed-agent scenarios, paired-client execution, or live provider qualification until the
gate receipt is complete.

## Related

- [Qualify A Candidate](qualify-candidate.md) — run deterministic and later live qualification.
- [Optimization Requirement](../vnext/PRD.md) — defines the release-blocking optimization gate.
- [Supported Client Qualification](../vnext/CLIENT-QUALIFICATION.md) — begins only after this gate completes.

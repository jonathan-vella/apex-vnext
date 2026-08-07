# Decision Guardrails

## Do

- Keep one decision focused on one trade-off.
- Compare viable alternatives honestly.
- Record measurable consequences when evidence exists.
- Trace the decision to requirements, governance, cost, availability, or recorded user choices.
- Preserve unresolved information as a blocker, unknown, or deferred decision.

## Do Not

- Create or number ADR files.
- Replace typed architecture decisions with Markdown as authority.
- Use placeholder text, fabricated evidence, or generic implementation guidance.
- Combine unrelated data, networking, identity, and deployment choices into one decision.
- Perform Azure reads, writes, deployments, or role assignments directly.

## Common Failures

| Failure | Correction |
| --- | --- |
| Vague selected option | Name the service, posture, or constraint and its requirement traceability. |
| Missing alternative | Record a viable option and why accepted evidence or constraints rejected it. |
| One-sided consequence | Include both benefits and costs, risks, or operational obligations. |
| Missing WAF impact | State the relevant affected pillars and the resulting trade-off. |
| Generic implementation note | Record typed module, identity, network, diagnostics, or recovery constraints. |

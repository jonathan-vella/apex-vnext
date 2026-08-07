# Service Selection And WAF Criteria

Use service classes as candidates, not predetermined recommendations. Select services only when requirements, accepted
cost/availability evidence, governance, and architecture decisions support them.

## Candidate Evaluation

For each service candidate, compare:

- Requirement coverage and workload fit
- Security and identity model
- Network and data residency constraints
- Availability, recovery, and scalability objectives
- Cost evidence and operational burden
- Module/provider support and implementation constraints

## Well-Architected Questions

| Pillar | Decision prompt |
| --- | --- |
| Security | Does the candidate support the required identity, encryption, private access, and data controls? |
| Reliability | Can it meet accepted availability, RTO, RPO, and backup objectives? |
| Performance | Can it meet projected throughput, latency, and growth needs? |
| Cost | Is the selected SKU/quantity supported by accepted pricing evidence? |
| Operations | Can it provide required diagnostics, health, ownership, and maintenance behavior? |

## Output

Record selected and rejected candidates with evidence hashes, requirement IDs, WAF consequences, and unresolved
assumptions. Do not turn an advisory service matrix into an automatic SKU decision.

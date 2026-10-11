# Workflow And Gates

> [Current Version](../../VERSION.md) | Why APEX separates creative work, deterministic validation, and approval.

## Workflow Shape

A run covers one environment, one Azure scope, and one IaC track. The versioned workflow advances through requirements,
governance discovery, architecture with policy mapping, implementation planning, IaC generation and validation,
preview, deployment, inventory, diagnosis, and quality evaluation. Governance comes before architecture so the design
starts from known policy: a reviewed subscription baseline, or the shipped ALZ Corp reference baseline when none exists.

Creative specialists propose typed results. Deterministic validators decide whether those results satisfy contracts and
business rules. Human-owned gates authorize progression.

## Gates

| Gate | Decision boundary                                                                  |
| ---: | ---------------------------------------------------------------------------------- |
|    1 | Requirements and SKU intent are complete and reviewed.                             |
|    2 | Architecture, cost, governance constraints, and its policy map are acceptable.     |
|    3 | Implementation intent, IaC binding, environment inputs, and review are acceptable. |
|    4 | The exact current preview is approved for its bound recipient and operation.       |

Gate 4 is currently local runtime authority. The existing qualification workflow transports and proves an approved
candidate; it does not silently recreate or inherit approval.

### Lab Runs: Intent Confirmation, Readiness Checkpoints And Final Approval

[DECISION-036](../vnext/DECISIONS.md#decision-036-deliver-non-production-first-with-purpose-bound-approval) selects a
lighter non-production ceremony, and the kernel now implements it for the `lab` purpose. Every run binds a typed
`purpose` (`lab` or `production`); `production` fails closed until the CI-owned flow exists.

| Gate | Lab run                                                                                                    |
| ---: | ---------------------------------------------------------------------------------------------------------- |
|    1 | One human intent confirmation after requirements are accepted and reviewed. It binds purpose and target.   |
|    2 | Kernel readiness checkpoint, recorded automatically. No prompt, actor or approval evidence.                |
|    3 | Kernel readiness checkpoint, recorded automatically. No prompt, actor or approval evidence.                |
|    4 | The final human approval of the exact current preview. It shows the architecture, cost estimate and risks. |

A readiness checkpoint is the new `ready` gate state plus a journaled, hash-chained `gate.readiness-recorded` event
carrying the gate, its dependency hash and the validators that passed. It is never approval evidence: there is no actor,
no approval object and no `gate.decided` event, and `ready` can only be recorded for Gates 2 and 3 of a lab run.
The kernel records it when the gate opens and its required review has no open finding and its gate validators pass.
A missing review, an unresolved blocking finding (including a risk nobody has accepted), or a failing validator leaves
the gate unrecorded, and `nextTask` reports it like any other unmet gate. Deciding Gate 2 or 3 on a lab run is
refused because no human decision exists.

A `ready` gate counts only while the journal proves it: the latest journal event touching that gate must be the kernel's
readiness record for this run, its committed post-state must contain exactly this gate record, and the gate must still
match the current review dependency. Any later invalidation, open, reopen or decision revokes it, and every run rejects
a journal written for another project or run. Approved and inherited gates are trusted from the run file without this
journal check, and the journal hash chain is unkeyed, so APEX does not defend against someone who can rewrite the local
state directory. The stricter readiness check exists because no human vouches for it; it catches stale restores and
mixed-up state, not a deliberate local attacker.

Changed requirements, and therefore changed intent, invalidate Gate 1 and the downstream readiness checkpoints, which
are recomputed after the new confirmation. Promotion inherits the Gate 1 confirmation only for the same target, because
Gate 1 binds it; a changed target redoes the requirements review in the new run, so its Gate 1 dependency hash is
computed there, and needs a fresh human confirmation. Promotion never inherits readiness; the promoted run records its
own. A new human confirmation is needed only for changed requirements, purpose or target, each new risk acceptance, and
each apply and destroy, which keep their own current preview and Gate 4 approval.

The Gate 4 approval context (purpose, target, architecture, cost estimate and accepted risks) is written to
`operations/deployment-preview.md` as a bounded summary of accepted artifacts. Its tamper check is a best-effort local
comparison with a generated-review base file, the same mechanism `approval.md` uses, and its content is not recorded in
`preview.created` or the approval evidence. The exact preview binding remains the authority for what is authorized.
Binding the context hash is tracked in [#466](https://github.com/jonathan-vella/apex-vnext/issues/466).

The CLI and MCP descriptions, managed agent and skill guidance and the client qualification scenarios describe this
flow. `gate decide` and `apex/gateDecide` on a lab Gate 2 or 3 are refused with reason `GATE_READINESS_AUTOMATIC`, the
managed agent never prompts for them, and `nextTask` reports `Gate N readiness checkpoint is not recorded: <reason>`
until the review and validators allow the kernel to record readiness. CLIENT-039 to CLIENT-042 remain planned and not run.

### Accepted Production Target

Production is opt-in. CI owns the execution run and preview from the start, and the kernel verifies an actual
candidate-bound human review receipt before apply. OIDC job identity or an environment pause alone is not approval.
This target is not implemented yet: production is refused until it lands. See
[ADR-0007](../vnext/adrs/03-des-adr-0007-use-purpose-bound-approval-and-ci-owned-production-runs.md).

## Invalidation

Changes invalidate downstream proof. Updating requirements invalidates architecture, planning, generated IaC, previews,
approvals, deployment evidence, and later views. Changes closer to deployment invalidate a narrower suffix.

A preview becomes stale when its dependencies, IaC, target, track, writer epoch, intended recipient, or configured TTL no
longer match. The correct response is to regenerate and reapprove it, not to override staleness.

## Tasks And Inputs

`nextTask` can return an input request, a review decision, a task, or terminal status. Input requests must be answered
before task context is requested. New Requirements runs use three kernel-owned panels: business discovery, combined
workload and service preferences, and security and compliance. Pending four-round requests remain replayable.

Recommendations require confirmation before recording. Service preferences do not authorize an agent to make
architecture, SKU, or implementation choices. Review revision invalidates the affected active evidence while retaining
immutable history. Task IDs and owner epochs prevent stale completion.

## Bicep And Terraform

The workflow branches by selected track for code generation, validation, preview, and deployment, then converges on the
same operation, inventory, diagnosis, and quality contracts.

## Planned COE Reuse And Change

The following is the target experience in [the PRD](../vnext/PRD.md#req-reuse-001-coe-archetype-import), not a claim that
new import commands or conflict-aware regeneration already exist:

1. The user identifies a COE repository; APEX inspects available archetypes and asks which whole workload to import.
2. APEX creates an independent consumer copy with source revision and selected paths, excluding source credentials,
   runtime state, writer claims and deployment approval authority.
3. APEX recovers reusable intent from existing contracts and parameters. For older or manually copied projects, it
   inspects relevant code/documents once and asks the user to confirm recovered decisions.
4. The user requests changes. APEX asks only relevant missing questions, explains consequences and confirms the change.
5. Existing dependency and invalidation mechanisms update affected decisions, code and documents. Manual conflicts
   require confirmation; unrelated files and decisions remain intact.
6. Consumer governance, validation, preview and approval are bound to the new target before deployment.

Both foundation profiles are required: ALZ-backed workloads consume supplied networking, identity and monitoring by
default; standalone labs/demos can provision their own workload support resources. Both obey applicable policy and
security. They are profile/ownership choices in one workflow, not separate engines or inferred from subscription count.
Deployment purpose is a separate confirmed choice; non-production does not imply standalone, and a foundation choice
does not authorize production.

## Output And Handoff

Design reasoning belongs in accepted sources, not repeatedly recreated from generated prose. Renderers should produce
consistent, navigable design/ADR and operational documents from those sources and observed deployment evidence. Follow
the [quality checklist](../vnext/PRD.md#output-quality-reference), distinguishing assumptions from tested outcomes.
Infrastructure outputs, deployment guidance and operational readiness are mandatory. Application pipelines and
application-specific deployment configuration are optional later work; APEX does not develop application code.

## Related

- [Run the workflow](../how-to/run-workflow.md)
- [Maintain requirements intake](../how-to/maintain-requirements-intake.md)
- [Bicep and Terraform](../reference/iac-tracks.md)
- [Security and authority](security-and-authority.md)

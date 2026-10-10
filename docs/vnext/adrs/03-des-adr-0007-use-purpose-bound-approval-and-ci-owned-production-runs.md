# ADR-0007: Use Purpose-Bound Approval And CI-Owned Production Runs

- **Status:** Accepted design; implementation and qualification pending
- **Date:** 2026-10-10
- **Decider:** jonathan-vella
- **Decision:** [DECISION-036](../DECISIONS.md#decision-036-deliver-non-production-first-with-purpose-bound-approval)

## Context

APEX is an open-source workload factory initially used for non-production workloads. Requiring a production
local-to-CI plan, key and writer handoff for every lab adds ceremony without improving the lab user's experience.
Terraform already has a native saved-plan lifecycle; routing it through azd would replan before execution and disable
native state locking in the inspected azd provider. Bicep and Terraform need different execution bindings, not different
sources of workflow authority.

The maintainer approved two execution paths, a lighter non-production flow, optional production setup automation and
CI-owned production runs on 2026-10-09. On 2026-10-10 the maintainer selected one workload-intent confirmation and final
deployment-preview approval for labs, without separate Gate 1 through 3 approval prompts. This record changes the target
design, not the executable gates or live authorization.

## Decision

### Separate Deployment Purpose From Foundation

Record deployment purpose explicitly as the typed value `lab` (non-production) or `production`. Preselect `lab` for
new projects, but require confirmation of the actual target and purpose. Do not infer purpose from resource names,
subscription count, repository visibility, or a `dev` label. ALZ-backed versus standalone foundation is an independent
ownership choice. Neither axis implies permission to create or delete shared platform resources.

Production opt-in requires a new purpose-bound run and current readiness evidence. Changing purpose or target
invalidates affected previews and approval; a lab approval cannot authorize production execution.

### Non-Production Flow

The user confirms workload intent once, then approves the final current deployment preview. Gates 1 through 3 become
profile-bound readiness checkpoints rather than separate human approval prompts; do not synthesize human approvals.
Required requirements, architecture/policy and plan reviews, deterministic validation, evidence and dependency checks
still run. Changed intent or a risk decision still requires the affected human confirmation.

The local run retains one writer and kernel authorization. Apply and destroy each require a preview and explicit
operation-specific approval. Reduced ceremony does not relax target ownership, policy, secret hygiene, native state
locking, exact Terraform saved-plan execution or audit evidence.

### Two IaC Execution Paths

- Bicep uses a bounded azd executor. Bind the reviewed what-if to source, resolved parameters, environment, azd version
  and any allowed hooks, extensions or layers. Unsupported mutation surfaces fail closed. ARM what-if is a prediction,
  not a Terraform-style saved execution plan.
- Terraform uses the native Terraform CLI, with secured Azure Storage backend, normal state locking, pinned
  dependencies and exact saved-plan application. Do not replan or upgrade dependencies after approval.
- Keep `IacTool` as Bicep or Terraform; azd is an executor, not a third IaC language.
- Provisioning and application-package deployment remain distinct operations. APEX does not run `azd up`; any
  `azd deploy` requires its own bound service/package preview and approval. Application development remains out of scope.

### CI-Owned Production Approval

GitHub Actions creates and owns the production execution run and its preview from the start. A local authoring project
may supply reviewed intent and source, but never transfers deployment approval, a saved plan, a decryption key or writer
ownership to this execution run. Preserve the single-writer, ownership-epoch, restart, cancellation and repeat guards
inside CI; removing the developer handoff does not remove those controls.

The first approval adapter targets an authenticated human review through a supported GitHub deployment environment.
The kernel verifies the actual review event before execution. Bind repository identity, workflow/run/attempt, source
commit, environment, Azure target, operation, preview/plan digest, approving actor, ownership and expiry. Associate the
review with the specific candidate presented to the reviewer. Neither a generic PR approval nor an OIDC triggering
actor claim proves approval of that candidate. Missing, rejected, replayed, substituted, expired or unavailable
approval evidence blocks apply.

The workflow and agent cannot manufacture human approval. A GitHub protection pause alone is insufficient without the
candidate binding. Detect whether the consumer repository supports the configured approval controls; if not, production
is blocked with actionable guidance, not silently converted to a lab or automatically approved.

Plans and state can contain secrets. CI-to-CI artifact movement still requires protected encrypted storage, integrity
checks, bounded access, retention and cleanup. Use short-lived OIDC identities and separate bootstrap administration
from deployment rights. Planning permissions must allow normal backend locking without granting unnecessary workload
mutation rights.

### Production Readiness Kit

Reuse the existing bootstrap/governance pattern:

1. Inspect prerequisites read-only and report ready, missing or blocked evidence.
2. Generate reviewable workflow/IaC configuration, scoped OIDC trust, backend and artifact settings, and operator steps.
3. Apply only an explicitly approved setup plan through bounded capabilities with separate operator permissions.
4. Verify resulting configuration; setup completion alone is not production qualification or deployment approval.

Check actual repository visibility and approval capabilities, target policy and identity, backend locking/networking,
action SHA pins, artifact protection and cleanup. Production remains unavailable until its execution and approval
model is implemented and qualified on an exact candidate. Production readiness is not required for the initial
non-production release.

## Alternatives

| Alternative                                                      | Disposition                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Keep local approval and one-hop CI transfer for every deployment | Retain existing qualification evidence, not the new production target       |
| Use the built-in azd Terraform provider                          | Reject as the governed path; retain native saved-plan and locking semantics |
| Build an APEX azd Terraform extension                            | Not selected; avoid extra adapter/distribution maintenance                  |
| Approve in CI without a bound human review receipt               | Reject; job identity and a pause are not candidate approval                 |
| Remove validation or deployment approval from labs               | Reject; simplify prompts, not authorization or native safety                |
| Require production setup before any APEX use                     | Reject; ship the non-production experience first                            |

## Consequences And Prior Decisions

This record supersedes ADR-0002's local-only production approval/transfer requirement and ADR-0003's handoff session as
a mandatory production prerequisite. Both records remain evidence for the existing non-production qualification
workflow; their checks are not disabled by this documentation change. Do not generalize the qualification backend's
temporary public-endpoint exception into a production default.

Implementation must update typed purpose/approval contracts, routing, CLI/MCP and managed guidance together. The kernel
now records lab Gates 2 and 3 as readiness checkpoints, and CLI/MCP descriptions, managed guidance and the client
qualification plan describe that flow (CP-27 PR 3; the scenarios are not yet run). Production gate prompts, native
providers and the local-to-CI qualification workflow remain enforced until their tested replacements land. No new
runtime command or production authorization is created by this ADR.

## Acceptance And Revisit Triggers

- A confirmed non-production purpose does not imply a standalone foundation or authorize a production target.
- Lab readiness retains all required validation/reviews without fabricated human Gate 1 through 3 decisions.
- CI rejects missing/wrong-actor, wrong-run/attempt, changed-candidate and expired human approval before apply.
- Terraform applies only the approved saved plan under native state locking; Bicep binds the approved deployment inputs.
- Setup failure, unavailable GitHub approval features, artifact exposure and incomplete cleanup fail explicitly.
- Retest policy if GitHub approval APIs, azd behavior, runner identities or consumer repository capabilities change.

---

<div align="center">

| [Previous ADR](03-des-adr-0006-omit-cli-autonomous-workers.md) | [Project Index](README.md) | Next ADR |
| -------------------------------------------------------------- | -------------------------- | -------- |
| [ADR-0006](03-des-adr-0006-omit-cli-autonomous-workers.md)     | [README](README.md)        | None     |

</div>

# APEX vNext Roadmap

The roadmap contains only remaining work toward the first APEX vNext release. Completed implementation and migration
history belongs in Git history, archives, and [Migration](../MIGRATION.md).

## Phase 1: Keep The Candidate Deterministic

**Requirements:** `REQ-DIST-001`, `REQ-STATE-001`, `REQ-CONTRACT-001`, `REQ-WORKFLOW-001`, `REQ-DETERMINISM-001`,
`REQ-SECURITY-001`, `REQ-DOCS-001`.

- Keep contracts, runtime configuration, managed projections, and package assets synchronized.
- Require full validation and deterministic qualification on release-relevant changes.
- Preserve clean package installation, SBOM, provenance, and zero blocking security findings.
- Keep documentation commands, support claims, and project controls aligned with source.

**Exit gate:** Required CI and exact-head deterministic qualification pass on a clean candidate.

## Phase 2: Qualify Supported Clients

**Requirements:** `REQ-CUSTOMIZATION-001`, `REQ-GUIDANCE-001`, `REQ-STATE-001`, `REQ-WORKFLOW-001`,
`REQ-APPROVAL-001`, `REQ-DOCS-001`.

- Bind observed stable VS Code, Copilot Chat, and Copilot CLI versions to the candidate.
- Verify managed discovery, input handling, MCP startup, tool allowlists, routing, restart/resume, and lifecycle.
- Compare normalized outcomes only where both clients support the interaction.
- Preserve the intentional Copilot CLI autonomous-worker omission.

**Exit gate:** Every blocking client scenario has current candidate-bound evidence or an explicit unsupported boundary.

## Phase 3: Qualify Bicep And Terraform Live Paths

**Requirements:** `REQ-ARCH-001`, `REQ-GOV-001`, `REQ-IAC-001`, `REQ-BICEP-001`, `REQ-TERRAFORM-001`,
`REQ-APPROVAL-001`, `REQ-OPS-001`, `REQ-CAPABILITY-001`, `REQ-SECURITY-001`.

- Discover current governance, quota, availability, and pricing evidence.
- Run isolated Bicep and Terraform apply, inventory, reconciliation, and destroy scenarios.
- Prove exact preview, recipient, writer, dependency, provider, and cleanup bindings.
- Record cost, security, diagnostics, and retained evidence without secrets.

**Exit gate:** Both tracks pass separately authorized live qualification with cleanup complete.

## Phase 4: Select And Release A Candidate

**Requirements:** `REQ-QUALITY-001`, `REQ-IMPROVE-001`, `REQ-MAINTAINABILITY-001`, `REQ-OPTIMIZATION-001`,
`REQ-DOCS-001` and every requirement above.

- Freeze the exact candidate and rerun all required deterministic checks.
- Bind package, client, live, CodeQL, scorecard, and approval evidence.
- Resolve or explicitly accept every release-blocking risk.
- Obtain explicit maintainer authorization for publication, tags, release creation, and cutover.
- Verify rollback and support procedures before announcing availability.

**Exit gate:** The release receipt proves every mandatory gate and names the authorized release action.

## Deferred Work

Features outside [PRD.md](PRD.md), additional clients, autonomous repository mutation, distributed writers, and broader
cloud operations remain deferred until a later versioned requirement and decision explicitly admits them.

---
title: "Qualify the vNext Preview"
description: "Run deterministic qualification lanes and a manual VS Code and Azure sandbox checklist."
---

Qualify the exact source commit and package set you intend to evaluate. Deterministic lanes require no Azure
credentials or model calls; manual qualification covers VS Code interaction and optional Azure sandboxes.

> [!IMPORTANT]
> The manual checklist below characterizes the current VS Code implementation. Final `0.10.0` acceptance also requires
> an equivalent Copilot CLI matrix and repeat qualification after all re-baseline changes.

## Run the Full Qualification

From the APEX repository root:

```bash
npm ci
npm run qualify:vnext
```

This runs runtime/config validation, workspace build and package tests, validator tests, and the package pack plus clean
consumer-install test.

## Automate Release Candidate Qualification

Run all non-cloud release gates with one command from a clean tracked worktree. Supply a fixed collection time so the
scorecard provenance remains stable across retries:

```bash
npm run qualify:vnext-release -- \
  --collected-at 2026-07-21T06:50:00.000Z \
  --output dist/release-candidate
```

The command prepares managed assets, runs `validate:all` and `qualify:vnext`, collects the release scorecard, removes
the generated per-run workspaces, hashes the compact artifacts and logs, and writes `receipt.json` plus `SHA256SUMS`.
It fails if the tracked source is dirty before or after qualification, a command fails, or any scorecard rule does not
pass.

The `Release Candidate Qualification` workflow runs the same command for release-relevant pull-request revisions and
pushes to `main`. It binds collection metadata to the candidate commit time and retains the compact evidence bundle.
The workflow uses read-only repository permission and cannot dispatch Azure work, approve Gate 4, merge, publish, tag,
or authorize cutover.

CodeQL or an approved equivalent, supported VS Code scenarios, exact-preview Gate 4 decisions, live dual-track Azure
qualification, and final promotion authorization remain separate gates. They are reported in the receipt rather than
silently treated as passing.

## Run an Individual Lane

Use the narrowest lane while diagnosing a failure:

```bash
npm run validate:vnext
npm run test:vnext
npm run test:vnext-validator
npm run test:vnext-pack
npm run lint:vnext
npm run test:bounded-improvement
```

`test:vnext-pack` builds tarballs, verifies manifest digests and package contents, installs the runtime package set into
a clean npm project, runs `apex version`, initializes a project, and verifies managed customization hashes.

The package test suite also exercises deterministic fake-provider scenarios for both Bicep and Terraform tracks. Use
the fake provider for repeatable preview, approval, apply, destroy, restart, and inventory checks without Azure access.

Live-preparation tests derive strict qualification artifacts from the committed Bicep/Terraform and governance sources,
exercise the production task and gate APIs in an isolated workspace, and prove the command ends with Gates 1–3 approved
and Gate 4 closed. Native quota, availability, pricing, and provider validation still require the live sandbox ceremony.

Approval tests cover local actor and intended-recipient binding, strict schemas, preview expiry, exact one-hop transfer
after approval, and adversarial owner, epoch, preview, claim, and recipient mismatches. Workflow mutation tests prove CI
cannot create a preview or Gate 4 decision. These deterministic tests do not constitute live OIDC or Azure proof.

Transfer authorization tests also cover stable semantic dependency revisions, sender lease mismatch without orphaned
claims or events, authenticated ownership lineage, transfer-after-preview ordering, exact one-hop success, wrong or
missing claim hashes, nonconsecutive and second-hop epochs, tampered lineage, post-preview dependency drift, and
superseded previews. Native Terraform tests preview as one writer, encrypt for the planned recipient, and apply as that
recipient only after the exact approved transfer. State-bundle tests approve locally, resume in a fresh workspace,
accept the post-approval claim, and deploy the imported exact preview. Lease tests cover same-epoch retry after a
failed mutation, pending-transfer rejection, expiry, and journal compare-and-swap.

Native Bicep tests cover an absent first stack, unrelated stacks, exact selection, malformed and duplicate list output,
wrong resource-group IDs, pre-apply empty-state binding, and post-apply inventory. No setup mutation is needed before the
approved deployment-stack create command.

Gate 4 supersession tests cover expired preview refresh and an apply-to-destroy sequence on one run. They verify that
the reduced gate returns to open, old approval cannot authorize the new preview, old preview hashes are stale, and a new
exact approval is required before destroy.

The bounded-improvement proof creates repeated structured observations across distinct runs, verifies same-run
deduplication and prompt-injection quarantine, scans one recurring pattern into one inert proposal, and records a human
rejection. It runs in a temporary local directory, performs no Azure or GitHub operation, and reports zero autonomous
actions. Run `npm run prove:bounded-improvement` to inspect the deterministic JSON result.

## Bind Live Evidence

After deterministic qualification passes, create an unavailable-by-default record with `npm run live:vnext`. The record
binds every later manual result to the current commit, package lock, release manifest, runtime bundle, and evidence
manifest. Follow [Record vNext Live Qualification](live-qualification.md) to create, update, validate, and render it.

## Complete the Manual VS Code Checklist

Use a fresh consumer repository and a supported VS Code release. Record pass/fail evidence for each action:

- Install the freshly packed runtime tarballs and run `apex init` with the default managed customization bundle.
- Confirm `APEX` and the interactive Requirements, Architect, Planner, and Operator specialists are visible.
- Start with `APEX`; confirm it reads status and directly hands requirements to `APEX Requirements`.
- Confirm Requirements uses `vscode/askQuestions` for missing workload decisions and submits through MCP.
- Confirm direct handoff to the configured Opus Architect and Planner paths for higher-tier interactive work.
- Confirm CodeGen, Reviewer, and Validator remain hidden workers on their configured standard model tier.
- Exercise MCP `status`, `nextTask`, `taskContext`, `stageArtifact`, `stageFile`, and `generateIac` as tasks allow.
- Restart VS Code and resume from repository state without relying on prior conversation history.
- Approve each named logical gate only after its accepted artifacts, review, and validation are visible.
- Run the fake provider through preview, Deployment Preview approval, deploy, inventory, destroy, and reconcile.
- Optionally repeat apply and destroy in isolated real Bicep and Terraform sandboxes with nonsecret provider config.

See the [VS Code custom agents documentation][vscode-custom-agents] for product-level discovery and handoff behavior.
Record the results with the [live qualification procedure](live-qualification.md); the checklist alone is not release
evidence.

## Capture Expected Evidence

Keep the source commit, package `release-manifest.json`, `qualify:vnext` output, `apex version --json`, redacted doctor
output, selected project/run IDs, journal head, preview and approval hashes, operation result, inventory, and manual
checklist verdicts. For real sandboxes, also capture provider versions, target scope, backend mode, and cleanup result.

Expected deterministic behavior includes stable JSON envelopes, byte-identical replay views, stale task and preview
rejection, managed-file conflict refusal, fake dual-track completion, and successful restart/resume.

## Record Known Limitations

- vNext is a preview and does not import v1 sessions or artifacts.
- Recipient-bound encrypted Terraform saved-plan transport passed live separate-job apply and destroy qualification.
  Production workflow enablement remains a separate release and cutover decision. No production workflow YAML is
  enabled by this implementation.
- The optional VS Code agent-plugin distribution path is not required or qualified for this preview.
- Kernel authority does not extend to VS Code conversation history or system context.
- Real Azure tests may incur cost and require sandbox governance, credentials, quotas, and cleanup ownership.

[vscode-custom-agents]: https://code.visualstudio.com/docs/copilot/customization/custom-agents

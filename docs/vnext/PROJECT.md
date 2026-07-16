## APEX vNext Checkpoint

- **Updated:** 2026-07-16 UTC
- **Milestone:** Dedicated repository extraction
- **Repository:** `jonathan-vella/apex-vnext`
- **Default and integration branch:** `main`
- **Source repository:** `jonathan-vella/apex`
- **Source commit:** `60d96d5a46ff534069c58275cfd32cb8d4490971`
- **History strategy:** Clean snapshot

## Current State

The runtime packages, workspace customizations, configuration, validators, tests, qualification infrastructure,
project controls, and frozen Phase 0A evidence have moved into the dedicated repository. The Astro site is excluded;
user documentation now lives under `docs/guides/` and validates as repository-native Markdown.

The original APEX `main` branch was not modified. The old rolling integration and workflow-bootstrap pull requests are
source-provenance records only and close unmerged after migration receipts are posted.

## Validation State

| Check                        | Result   | Evidence                                                                      |
| ---------------------------- | -------- | ----------------------------------------------------------------------------- |
| Source snapshot              | Pass     | `SOURCE_PROVENANCE.json` binds repository, branch, commit, and excluded path. |
| Markdown docs                | Pass     | `npm run validate:docs`.                                                      |
| vNext contracts              | Pass     | `npm run validate:vnext`.                                                     |
| Live workflow structure      | Pass     | `npm run validate:vnext-live-workflow`.                                       |
| Live workflow mutation tests | Pass     | `npm run test:vnext-live-workflow`.                                           |
| Repository mutation tests    | Pass     | `npm run test:vnext-validator`.                                               |
| Dependency audit             | External | Public npm audit endpoint returned a TLS handshake failure during extraction. |

## Remaining Release Work

The transferred issues remain authoritative for live VS Code and cloud qualification, encrypted Terraform plan
transport, modernization inventory, bounded observe-and-propose work, and the final qualification/cutover decision.

Live evidence produced against the old repository or an earlier source head is historical. Final release evidence must
bind to an exact commit in this repository after the last dependency hash change.

## Resume Pointer

1. Confirm the new repository `main` checks are green.
2. Open the first dependency-ready transferred issue.
3. Create a short-lived issue branch from `origin/main` and target its pull request to `main`.
4. Continue with `/apex-vnext-continue` using repository and issue state as authority.

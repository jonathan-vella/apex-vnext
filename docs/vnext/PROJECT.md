## APEX vNext Checkpoint

- **Updated:** 2026-07-16 UTC
- **Milestone:** Dedicated repository extraction
- **Repository:** `jonathan-vella/apex-vnext`
- **Default and integration branch:** `main`
- **Verified destination head:** `099616a6dcbca3286d74bf3e6b7a47aaad031cdc`
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
| Markdown docs (local)        | Pass     | `npm run validate:docs`.                                                      |
| vNext contracts              | Pass     | `npm run validate:vnext`.                                                     |
| Live workflow structure      | Pass     | `npm run validate:vnext-live-workflow`.                                       |
| Live workflow mutation tests | Pass     | `npm run test:vnext-live-workflow`.                                           |
| Repository mutation tests    | Pass     | `npm run test:vnext-validator`.                                               |
| Full vNext qualification     | Pass     | `npm run qualify:vnext` on destination root commit.                           |
| Full repository validation   | Pass     | `npm run validate:all` on destination root commit.                            |
| Destination CI               | Pass     | Workflow run `29495046605` on `099616a6`.                                     |
| Markdown docs (CI)           | Pass     | Workflow run `29495046638` on `099616a6`.                                     |
| IaC checks                   | Pass     | Workflow run `29495064776` on `099616a6`.                                     |
| Devcontainer CI              | Disabled | Workflow is disabled and is not a migration or release gate.                  |
| Dependency audit             | External | Public npm audit endpoint returned a TLS handshake failure during extraction. |

## Remaining Release Work

The transferred issues remain authoritative:

| Issue | Work                                           |
| ----- | ---------------------------------------------- |
| `#9`  | Qualify supported VS Code and cloud workflows  |
| `#10` | Prove encrypted Terraform CI plan transport    |
| `#11` | Inventory modernization ownership surfaces     |
| `#12` | Design bounded observe-and-propose improvement |
| `#13` | Run final qualification and cutover review     |

Live evidence produced against the old repository or an earlier source head is historical. Final release evidence must
bind to an exact commit in this repository after the last dependency hash change.

## Resume Pointer

1. Confirm the new repository `main` checks are green.
2. Open the first dependency-ready transferred issue.
3. Create a short-lived issue branch from `origin/main` and target its pull request to `main`.
4. Continue with `/apex-vnext-continue` using repository and issue state as authority.

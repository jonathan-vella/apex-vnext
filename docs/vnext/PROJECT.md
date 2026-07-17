## APEX vNext Checkpoint

- **Updated:** 2026-07-16 UTC
- **Milestone:** Live qualification setup
- **Repository:** `jonathan-vella/apex-vnext`
- **Default and integration branch:** `main`
- **Verified destination head:** `436f3359f324400d3288b6b844ecb6b5a0e7e445`
- **Source repository:** `jonathan-vella/apex`
- **Source commit:** `60d96d5a46ff534069c58275cfd32cb8d4490971`
- **History strategy:** Clean snapshot

## Current State

The runtime packages, workspace customizations, configuration, validators, tests, qualification infrastructure,
project controls, and frozen Phase 0A evidence have moved into the dedicated repository. The Astro site is excluded;
user documentation now lives under `docs/guides/` and validates as repository-native Markdown.

The original APEX `main` branch was not modified. The old rolling integration and workflow-bootstrap pull requests are
source-provenance records only and close unmerged after migration receipts are posted.

Issue `#9` is the active dependency-ready workstream. Its destination-readiness slice binds the live launcher,
dispatch workflow, and release evidence to this repository. The secretless Entra application, destination Environment
federation, and Azure qualification bootstrap are deployed and verified.

The Environment is intentionally unprotected and scopes OIDC, variables, and secrets only. Local APEX Gate 4 is the sole
human approval and binds the exact preview before CI handoff. The workflow imports that approval and cannot create one.

## Validation State

| Check                        | Result   | Evidence                                                                      |
| ---------------------------- | -------- | ----------------------------------------------------------------------------- |
| Source snapshot              | Pass     | `SOURCE_PROVENANCE.json` binds repository, branch, commit, and excluded path. |
| Markdown docs (local)        | Pass     | `npm run validate:docs`.                                                      |
| vNext contracts              | Pass     | `npm run validate:vnext`.                                                     |
| Live workflow structure      | Pass     | `npm run validate:vnext-live-workflow`.                                       |
| Live workflow mutation tests | Pass     | `npm run test:vnext-live-workflow`.                                           |
| Repository mutation tests    | Pass     | `npm run test:vnext-validator`.                                               |
| Full vNext qualification     | Pass     | PR workflow run `29505179368` on `9086c00`.                                   |
| Full repository validation   | Pass     | `npm run validate:all` before PR `#14`.                                       |
| Destination CI               | Pass     | Branch, docs, and CI checks passed for PR `#14`.                              |
| Markdown docs (CI)           | Pass     | Workflow run `29495046638` on `099616a6`.                                     |
| IaC checks                   | Pass     | Workflow run `29495064776` on `099616a6`.                                     |
| Entra OIDC federation        | Pass     | Destination Environment subject exists; no client secret or API permission.   |
| Azure bootstrap              | Pass     | Deployment `vnext-qualification-bootstrap` and security checks succeeded.     |
| Local Gate 4 transfer design | Pass     | Package and workflow mutation tests cover exact post-approval transfer.       |
| Devcontainer CI              | Disabled | Workflow is disabled and is not a migration or release gate.                  |
| Dependency audit             | External | Public npm audit endpoint returned a TLS handshake failure during extraction. |

## Remaining Release Work

The transferred issues remain authoritative:

| Issue | Work                                           |
| ----- | ---------------------------------------------- |
| `#11` | Inventory modernization ownership surfaces     |
| `#12` | Design bounded observe-and-propose improvement |
| `#13` | Run final qualification and cutover review     |

Live evidence produced against the old repository or an earlier source head is historical. Final release evidence must
bind to an exact commit in this repository after the last dependency hash change.

## Resume Pointer

1. Complete issue `#11` by reviewing and merging the candidate-bound modernization ownership inventory.
2. Start Milestone F with the validator command graph; characterize behavior before changing orchestration.
3. Compare each slice against the recorded CI, hook, dependency, diagnostic, context, and drift baseline.
4. Keep production cutover and final exact-head qualification deferred to issue `#13`.

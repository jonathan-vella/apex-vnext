## APEX vNext Checkpoint

- **Updated:** 2026-07-21 UTC
- **Milestone:** Final qualification and promotion decision
- **Repository:** `jonathan-vella/apex-vnext`
- **Default and integration branch:** `main`
- **Current public main:** `54a211077d5f05954679e0fd8d3bc24fe29bc3f0`
- **Verified exact-main candidate:** `25530c339410e9758ae34538427f24bddfd83e1d`
- **Live release-source boundary:** `8c672d76cb2c2028131fcb93bb023ba9327d256b`
- **Source repository:** `jonathan-vella/apex`
- **Frozen v1 source head:** `40d0f6147bbaf3e6a809ebd738bb6222509d9bd4`
- **History strategy:** Clean snapshot with source provenance

## Current State

The unified release identity is merged and qualified on exact `main`. CI, docs, release qualification, package
reproducibility, audits, and the approved independent security review pass. The downloaded release artifact verifies
through its checksum manifest, and the prior cloud evidence remains behaviorally equivalent because no workflow, IaC,
or authority path changed.

The repository is public after an explicit operational-metadata disclosure decision and a history-wide Gitleaks scan.
Transient live artifacts were deleted before conversion. Selected Actions, external-fork approval, read-only workflow
tokens, shorter retention, protected `main`, secret scanning, push protection, private vulnerability reporting,
immutable releases, Dependabot security updates, and native CodeQL are enabled and verified.

Both Bicep and Terraform apply/destroy workflows succeeded on attempt one after separate local exact-preview Gate 4
decisions. Final target inventories are empty, writer authority returned locally before ephemeral files were excluded,
and the Azure backend is restored to public network `Disabled` with firewall default `Deny` and no temporary rule or
exception tag.

Issue `#13` is the active release workstream. No npm package, release tag, v1 maintenance reference, support date, or
cutover artifact has been created. Those actions remain separately authorized release operations.

## Validation State

| Check                            | Result             | Evidence                                                                             |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| Exact-main CI                    | Pass               | Run `29827622151`, attempt one                                                       |
| Exact-main release qualification | Pass               | Run `29827622205`, attempt one; all scorecard rules pass                             |
| Release artifact integrity       | Pass               | GitHub digest and all internal `SHA256SUMS` entries verified                         |
| Package qualification            | Pass               | Five reproducible tarballs, clean/offline install, SBOM, and provenance              |
| npm publication dry run          | Pass with boundary | All five tarballs passed; registry identity and trusted publishing remain unverified |
| Production dependency audit      | Pass               | Zero known vulnerabilities                                                           |
| Full dependency audit            | Accepted           | Two moderate development-only Markdown lint findings                                 |
| CodeQL equivalent                | Accepted pass      | Repeated independent exact-main review; no critical, high, or blocking finding       |
| v1 compatibility and sync        | Pass               | Matrix has zero errors or warnings; no post-baseline v1 fix exists                   |
| Bicep live lifecycle             | Pass               | Apply `29816381757`; destroy `29817534614`                                           |
| Terraform live lifecycle         | Pass               | Apply `29820944300`; destroy `29821615776`                                           |
| Final Azure cleanup              | Pass               | Both sandboxes empty; backend restored to `Disabled`/`Deny`                          |
| Supported VS Code scenarios      | Pending            | User-run clean supported-host and cross-device checklist                             |
| Promotion authorization          | Pending            | Separate publication, tag, support-date, and cutover decision                        |
| Unified package set              | Pass               | Exact-main package, clean-install, SBOM, provenance, and npm dry-run evidence        |
| Public repository readiness      | Pass               | Public controls verified; zero open secret or code-scanning alerts                   |
| Native CodeQL                    | Pass               | Run `29830116910`; Actions, JavaScript/TypeScript, and Python passed                 |

## Release Boundaries

- The unprotected `vnext-qualification` Environment scopes OIDC and configuration only. Local APEX Gate 4 is the sole
  cloud approval authority.
- No release workflow exists. The maintainer controls the `@apex` scope, but trusted publishers and a protected release
  environment must be configured against a separately reviewed workflow.
- Public visibility does not authorize npm publication, tags, support dates, or cutover.
- The exact v1 support end date remains 12 calendar months after the yet-unauthorized cutover date.
- Existing stashes and return worktrees preserve superseded or unrelated local state and must not be deleted as release
  cleanup.

## Resume Pointer

1. Run the supported VS Code and cross-device scenarios against the exact package candidate.
2. Configure trusted publishers and a protected release environment for the maintainer-owned `@apex` packages.
3. Decide immutable tag names, v1 maintenance reference, cutover date, and v1 support end date.
4. Request one explicit maintainer decision before dispatching publication, tag, or cutover automation.

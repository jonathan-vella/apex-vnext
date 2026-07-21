## APEX vNext Checkpoint

- **Updated:** 2026-07-21 UTC
- **Milestone:** Final qualification and promotion decision
- **Repository:** `jonathan-vella/apex-vnext`
- **Default and integration branch:** `main`
- **Prior exact-main candidate:** `1f8db536fe0398f6575775d7794ba718234d3ef1`
- **Live release-source boundary:** `8c672d76cb2c2028131fcb93bb023ba9327d256b`
- **Source repository:** `jonathan-vella/apex`
- **Frozen v1 source head:** `40d0f6147bbaf3e6a809ebd738bb6222509d9bd4`
- **History strategy:** Clean snapshot with source provenance

## Current State

The maintainer selected a unified `0.10.0` repository, package, customization, and release identity after qualification
of the prior `0.1.0` package candidate. The amendment is locally qualified but uncommitted. The
[final qualification dossier](FINAL-QUALIFICATION.md) preserves the prior immutable evidence and labels the new package
hashes provisional until an exact-head rerun.

Both Bicep and Terraform apply/destroy workflows succeeded on attempt one after separate local exact-preview Gate 4
decisions. Final target inventories are empty, writer authority returned locally before ephemeral files were excluded,
and the Azure backend is restored to public network `Disabled` with firewall default `Deny` and no temporary rule or
exception tag.

Issue `#13` is the active release workstream. No npm package, release tag, v1 maintenance reference, support date, or
cutover artifact has been created. Those actions remain separately authorized release operations.

## Validation State

| Check                            | Result             | Evidence                                                                             |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| Prior exact-main CI              | Historical pass    | Run `29822326665`, attempt one                                                       |
| Prior release qualification      | Historical pass    | Run `29822400861`, attempt one; all nine scorecard rules pass                        |
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
| Unified `0.10.0` package set     | Local pass         | vNext validator, 109 package-owner tests, package rehearsal, and five npm dry runs   |

## Release Boundaries

- The unprotected `vnext-qualification` Environment scopes OIDC and configuration only. Local APEX Gate 4 is the sole
  cloud approval authority.
- No release workflow exists. The maintainer controls the `@apex` scope, but trusted publishers and a protected release
  environment must be configured against the final reviewed workflow.
- The maintainer selected `0.10.0` as the unified repository, package, customization, and release identity. Exact-head
  evidence must be regenerated after the amendment is committed.
- The exact v1 support end date remains 12 calendar months after the yet-unauthorized cutover date.
- Existing stashes and return worktrees preserve superseded or unrelated local state and must not be deleted as release
  cleanup.

## Resume Pointer

1. Review the unified `0.10.0` amendment, commit it through a pull request, and merge only after required checks pass.
2. Repeat exact-head release qualification, package hashing, audits, and the approved security-equivalent review.
3. Confirm cloud evidence equivalence, then run the supported VS Code and cross-device scenarios against that exact
  package candidate.
4. Configure trusted publishers and a protected release environment for the maintainer-owned `@apex` packages.
5. Decide immutable tag names, v1 maintenance reference, cutover date, and v1 support end date.
6. Request one explicit maintainer decision before dispatching publication, tag, or cutover automation.

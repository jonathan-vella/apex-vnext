# Publish npm Packages

> [Current Version](../../VERSION.md) | Publish an approved APEX release through npm trusted publishing.

## Configure npm Trusted Publishing

In npmjs.com, configure each publishable `@apex` package with a trusted publisher for this repository and the
`.github/workflows/publish-npm.yml` workflow. Protect the GitHub `npm-publish` environment and require the release
approval required by your organization.

The workflow uses GitHub Actions OIDC. Do not add an npm token to repository secrets when trusted publishing is
available.

## Prepare The Candidate

Before dispatching publication, merge the intended release candidate to protected `main`. The workflow refuses to
publish unless the requested version matches `VERSION.md` and every publishable package manifest. It also refuses an
unreleased or pre-release repository status.

Run the deterministic gates locally before requesting release approval:

```bash
npm ci
npm run validate:all
npm run qualify:vnext
```

## Dispatch Publication

In GitHub Actions, select **Publish npm packages**, choose the protected `main` branch, provide the release version
without a `v` prefix, and enter `publish` as the confirmation value. Approve the `npm-publish` environment when
prompted.

The workflow repeats repository qualification, verifies no package version has already been published, and publishes
packages in dependency order with npm provenance.

## Verify As A Consumer

Use a clean workspace and the public npm registry:

```bash
mkdir -p ~/repos/apex-consumer
cd ~/repos/apex-consumer
npm install --save-dev @apex/cli@RELEASE_VERSION
npx apex version --json
```

For the VS Code path, continue with the [installation guide](manage-installation.md). Do not claim client or cloud
qualification merely because npm publication succeeds.

## Related

- [Qualify A Candidate](qualify-candidate.md) - run deterministic qualification before publication.
- [Manage Installation](manage-installation.md) - bootstrap an end-user workspace after publication.
- [Qualification Reference](../reference/qualification.md) - evidence levels and release authority.

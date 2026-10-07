# Publish npm Packages

> [Current Version](../../VERSION.md) | Publish an approved APEX release through npm trusted publishing.

## Configure npm Trusted Publishing

For every existing publishable `@apexops/*` package, configure a trusted publisher in npmjs.com for this repository and
the
`.github/workflows/publish-npm.yml` workflow. Protect the GitHub `npm-publish` environment and require the release
approval set by your organization.

The workflow uses GitHub Actions OIDC. Do not add an npm token to repository secrets when trusted publishing is
available.

For the first publication of each package, npm has no package settings in which to configure a trusted publisher. An
organization owner must bootstrap that first publish with a short-lived granular npm token, configured outside this
repository and used only in an approved release run. Configure the trusted publisher immediately afterward and revoke
the token. Subsequent releases use this workflow's OIDC identity and require no npm token.

## Prepare The Candidate

Before dispatching publication, merge the intended release candidate to protected `main`. The workflow refuses to
publish unless the requested version matches `VERSION.md` and every publishable package manifest. It also refuses an
unreleased repository status. A version with a SemVer prerelease suffix, such as `0.10.0-next.0`, is published with
the `next` dist-tag. A stable version is published with the `latest` dist-tag.

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
packages in dependency order with npm provenance. To install the current preview, use `@apexops/cli@next` or the
exact prerelease version.

npm retains the requested `next` dist-tag and may also assign `latest` to the first published version of a new package.
Until a stable release replaces it, consumers should select the preview explicitly with `@apexops/cli@next` or its
exact prerelease version.

## Verify As A Consumer

Use a clean workspace and the public npm registry:

```bash
mkdir -p ~/repos/apex-consumer
cd ~/repos/apex-consumer
npm install --save-dev @apexops/cli@RELEASE_VERSION
npx apex version --json
```

Continue with the [installation guide](manage-installation.md). Do not claim client or cloud
qualification merely because npm publication succeeds.

## Publish The Plugin

The `apex` Agent Plugins package is published to the
[apex-plugins marketplace](https://github.com/jonathan-vella/apex-plugins) through a reviewed pull request in that
repository. The plugin version is the `@apexops/cli` version, so publish the CLI to npm first. Every plugin release
needs a `## [<version>]` section in `plugin/CHANGELOG.md`.

Clone the marketplace beside this repository, then run the dry run from a clean checkout of the merged release commit:

```bash
gh repo clone jonathan-vella/apex-plugins ../apex-plugins
npm run publish:plugin
```

The dry run builds the plugin and prints the plan: version, source commit SHA, tree hash, files and every check.
It changes nothing except the gitignored `dist/` build output. Run `npm run publish:plugin -- --apply` when every check
passes. `--apply` refuses unless:

- the working tree is clean before and after the build;
- `HEAD` is on `origin/main`, or equals `--release-commit <sha>` and is on an `origin` branch;
- `plugin/CHANGELOG.md` has a section for the version;
- npm has `@apexops/cli` at that version, and the CLI inputs (`packages/`, `customizations/`, `config/`,
  `package-lock.json`) are unchanged since its `gitHead`;
- the marketplace clone (`--marketplace-dir`, default `../apex-plugins`) is clean and its `origin/main` has a
  marketplace manifest;
- the version is newer than the marketplace's `apex` version and `release/apex-<version>` is unused;
- the fresh build's tree hash matches `dist/apex-plugin.sha256`.

It then creates `release/apex-<version>` from the marketplace's `origin/main`. It replaces `plugins/apex/` with the
built tree and updates `.github/plugin/marketplace.json`. It records the source commit, bundled CLI and tree hash in
`.github/plugin/provenance.json`, pushes only that branch and opens a pull request with `gh`. It never merges, pushes
to `main` or creates tags. The marketplace `validate` check recomputes the tree hash before you merge. The source
commit SHA is the pin. Tags are release labels only.

## Related

- [Qualify A Candidate](qualify-candidate.md) - run deterministic qualification before publication.
- [Manage Installation](manage-installation.md) - bootstrap an end-user workspace after publication.
- [Qualification Reference](../reference/qualification.md) - evidence levels and release authority.

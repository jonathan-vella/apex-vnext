import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { hashTree } from "../../scripts/build-plugin.mjs";
import {
  MARKETPLACE_PATH,
  PROVENANCE_PATH,
  changelogSection,
  compareVersions,
  formatPlan,
  publishPlugin,
  pullRequestBody,
  repositorySlug,
  updateMarketplace,
  updateProvenance,
} from "../../scripts/publish-plugin.mjs";

const sourceUrl = "https://github.com/jonathan-vella/apex-vnext.git";
const marketplaceUrl = "https://github.com/jonathan-vella/apex-plugins.git";
const version = "1.2.0-next.3";

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function changelog(sectionVersion = version) {
  return `# APEX plugin changelog\n\n## [${sectionVersion}] - Unreleased\n\n- First release.\n\n## [1.0.0]\n\n- Old.\n`;
}

/**
 * Source repository, marketplace clone and bare origins in a temporary directory. Git runs for real with isolated
 * config; npm, gh and the plugin build are stubbed.
 */
async function fixture(context, { marketplacePlugins = [], seedMarketplace = true } = {}) {
  const base = await mkdtemp(join(tmpdir(), "apex-publish-"));
  context.after(() => rm(base, { recursive: true, force: true }));
  const gitConfig = join(base, "gitconfig");
  await writeText(
    gitConfig,
    "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n" +
      "[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n",
  );
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (cwd, ...args) => {
    const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };

  const root = join(base, "source");
  const sourceOrigin = join(base, "source-origin.git");
  const marketplaceDir = join(base, "apex-plugins");
  const marketplaceOrigin = join(base, "marketplace-origin.git");
  const remotes = new Map([
    [root, sourceUrl],
    [marketplaceDir, marketplaceUrl],
  ]);

  git(base, "init", "--quiet", "--bare", sourceOrigin);
  git(base, "init", "--quiet", root);
  await writeJson(join(root, "plugin/package-manifest.json"), {
    outputDirectory: "dist/apex-plugin",
    plugin: { source: "plugin/plugin.json", target: "plugin.json", versionFrom: "packages/cli/package.json" },
  });
  await writeJson(join(root, "packages/cli/package.json"), { name: "@apexops/cli", version });
  await writeText(join(root, "plugin/CHANGELOG.md"), changelog());
  await writeText(join(root, ".gitignore"), "dist/\n");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", "initial");
  git(root, "remote", "add", "origin", sourceOrigin);
  git(root, "push", "--quiet", "origin", "main");

  git(base, "init", "--quiet", "--bare", marketplaceOrigin);
  const seed = join(base, "seed");
  git(base, "init", "--quiet", seed);
  await writeText(join(seed, "README.md"), "# apex-plugins\n");
  if (seedMarketplace) {
    await writeJson(join(seed, MARKETPLACE_PATH), {
      name: "apex-plugins",
      owner: { name: "Test" },
      metadata: { description: "Test marketplace" },
      plugins: marketplacePlugins,
    });
    await writeJson(join(seed, PROVENANCE_PATH), { schemaVersion: "1.0.0", plugins: [] });
  }
  git(seed, "add", "--all");
  git(seed, "commit", "--quiet", "-m", "scaffold");
  git(seed, "remote", "add", "origin", marketplaceOrigin);
  git(seed, "push", "--quiet", "origin", "main");
  git(base, "clone", "--quiet", marketplaceOrigin, marketplaceDir);

  const state = {
    base,
    root,
    marketplaceDir,
    marketplaceOrigin,
    sourceOrigin,
    git,
    gitHead: git(root, "rev-parse", "HEAD"),
    npm: undefined,
    gh: [],
    build: { sidecar: undefined, touch: undefined },
  };

  state.run = (command, args, { cwd } = {}) => {
    if (command === "git") {
      if (args[0] === "-C" && args[2] === "remote" && args[3] === "get-url")
        return { status: 0, stdout: `${remotes.get(args[1])}\n`, stderr: "" };
      const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
      return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    }
    if (command === "npm") {
      if (state.npm !== undefined) return state.npm;
      const published = { version, gitHead: state.gitHead };
      return { status: 0, stdout: JSON.stringify(published), stderr: "" };
    }
    if (command === "gh") {
      state.gh.push(args);
      return { status: 0, stdout: "https://github.com/jonathan-vella/apex-plugins/pull/7\n", stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
  };

  state.buildPlugin = async ({ root: buildRoot, outputDirectory }) => {
    assert.equal(buildRoot, root);
    await rm(outputDirectory, { recursive: true, force: true });
    await writeJson(join(outputDirectory, "plugin.json"), {
      name: "apex",
      version,
      description: "APEX test plugin",
      repository: "https://github.com/jonathan-vella/apex-vnext",
      license: "MIT",
    });
    await writeText(join(outputDirectory, "mcp/apex.mjs"), "export {};\n");
    await writeText(join(outputDirectory, "skills/apex-test/SKILL.md"), "---\nname: apex-test\n---\n");
    await writeText(join(outputDirectory, "assets/customizations/.mcp.json"), "{}\n");
    const { sha256 } = await hashTree(outputDirectory);
    await writeText(`${outputDirectory}.sha256`, `${state.build.sidecar ?? sha256}  apex-plugin\n`);
    if (state.build.touch) await writeText(join(root, state.build.touch), "changed\n");
  };

  state.publish = (options = {}) =>
    publishPlugin({ root, marketplaceDir, run: state.run, build: state.buildPlugin, ...options });

  state.commitSource = async (path, text, { push = true } = {}) => {
    await writeText(join(root, path), text);
    git(root, "add", "--all");
    git(root, "commit", "--quiet", "-m", `change ${path}`);
    if (push) git(root, "push", "--quiet", "origin", "main");
  };

  return state;
}

function failedChecks(plan) {
  return plan.checks.filter((check) => !check.ok).map((check) => check.id);
}

async function assertRefused(state, checkId, pattern, options = {}) {
  await assert.rejects(state.publish({ apply: true, ...options }), (error) => {
    assert.match(error.message, /^Refusing to publish:/u);
    assert.match(error.message, new RegExp(`- ${checkId}: `, "u"));
    assert.match(error.message, pattern);
    assert.ok(failedChecks(error.plan).includes(checkId));
    return true;
  });
  assert.deepEqual(state.gh, [], "gh must not run when a check fails");
  assert.equal(
    state.git(state.marketplaceDir, "branch", "--list", `release/apex-${version}`),
    "",
    "no release branch is created when a check fails",
  );
}

test("compareVersions follows SemVer 2.0 precedence", () => {
  const ordered = [
    "0.9.9",
    "0.10.0-next.2",
    "0.10.0-next.10",
    "0.10.0-next.10.1",
    "0.10.0-rc.1",
    "0.10.0",
    "0.10.1",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0",
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareVersions(ordered[index], ordered[index - 1]), 1, `${ordered[index]} > ${ordered[index - 1]}`);
    assert.equal(compareVersions(ordered[index - 1], ordered[index]), -1);
  }
  assert.equal(compareVersions("1.0.0+build.1", "1.0.0"), 0);
  assert.throws(() => compareVersions("v1.0.0", "1.0.0"), /Not a semantic version: v1\.0\.0/u);
});

test("changelogSection requires an exact, non-empty version section", () => {
  const text = "# Log\n\n## [1.0.0-next.10]\n\n- ten\n\n## [1.0.0-next.1] - 2026-10-07\n\n- one\n\n## [0.9.0]\n";
  assert.equal(changelogSection(text, "1.0.0-next.1"), "## [1.0.0-next.1] - 2026-10-07\n\n- one");
  assert.equal(changelogSection(text, "1.0.0-next.10"), "## [1.0.0-next.10]\n\n- ten");
  assert.equal(changelogSection(text, "1.0.0"), null);
  assert.equal(changelogSection(text, "0.9.0"), null, "a heading without content is not a changelog section");
});

test("repositorySlug reads HTTPS and SSH GitHub remotes", () => {
  assert.equal(repositorySlug("https://github.com/jonathan-vella/apex-plugins.git"), "jonathan-vella/apex-plugins");
  assert.equal(repositorySlug("git@github.com:jonathan-vella/apex-vnext.git\n"), "jonathan-vella/apex-vnext");
  assert.equal(repositorySlug("/srv/git/apex-plugins.git"), null);
});

test("updateMarketplace adds or replaces only the apex entry with documented fields", () => {
  const marketplace = {
    name: "apex-plugins",
    owner: { name: "Owner" },
    metadata: { description: "d", version: "0.1.0" },
    plugins: [
      { name: "other", source: "./plugins/other", version: "3.0.0" },
      { name: "apex", source: "./plugins/apex", version: "0.1.0", description: "old", category: "x" },
    ],
  };
  const built = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "apex",
    version: "0.2.0",
    description: "new",
    author: { name: "A" },
    repository: "https://github.com/jonathan-vella/apex-vnext",
    license: "MIT",
    keywords: ["apex"],
  };
  const next = updateMarketplace(marketplace, built);
  assert.deepEqual(next.plugins, [
    { name: "other", source: "./plugins/other", version: "3.0.0" },
    {
      name: "apex",
      description: "new",
      version: "0.2.0",
      source: "./plugins/apex",
      author: { name: "A" },
      repository: "https://github.com/jonathan-vella/apex-vnext",
      license: "MIT",
      keywords: ["apex"],
    },
  ]);
  assert.deepEqual(next.metadata, { description: "d", version: "0.2.0" });
  assert.equal(marketplace.plugins[1].version, "0.1.0", "input is not mutated");
  const added = updateMarketplace({ name: "apex-plugins", owner: { name: "Owner" }, plugins: [] }, built);
  assert.equal(added.plugins.length, 1);
  assert.equal(added.plugins[0].source, "./plugins/apex");
});

test("updateProvenance replaces the record for the plugin and keeps others", () => {
  const next = updateProvenance(
    {
      schemaVersion: "1.0.0",
      plugins: [
        { name: "zeta", version: "1.0.0" },
        { name: "apex", version: "0.1.0" },
      ],
    },
    { name: "apex", version: "0.2.0" },
  );
  assert.deepEqual(next.plugins, [
    { name: "apex", version: "0.2.0" },
    { name: "zeta", version: "1.0.0" },
  ]);
  assert.deepEqual(updateProvenance(null, { name: "apex" }), { schemaVersion: "1.0.0", plugins: [{ name: "apex" }] });
});

test("dry run builds, passes every check and changes nothing", async (context) => {
  const state = await fixture(context);
  const marketplaceHead = state.git(state.marketplaceDir, "rev-parse", "HEAD");
  const { plan, dryRun } = await state.publish();
  assert.equal(dryRun, true);
  assert.deepEqual(failedChecks(plan), []);
  assert.equal(plan.ready, true);
  assert.deepEqual(
    plan.checks.map((check) => check.id),
    [
      "clean-tree",
      "source-commit",
      "changelog",
      "npm-release",
      "marketplace",
      "version",
      "release-branch",
      "build",
      "clean-after-build",
    ],
  );
  assert.equal(plan.plugin.version, version);
  assert.equal(plan.source.commit, state.git(state.root, "rev-parse", "HEAD"));
  assert.equal(plan.npm.gitHead, state.gitHead);
  assert.equal(plan.marketplace.current, null);
  assert.equal(plan.marketplace.branch, `release/apex-${version}`);
  assert.deepEqual(plan.tree.files, [
    "assets/customizations/.mcp.json",
    "mcp/apex.mjs",
    "plugin.json",
    "skills/apex-test/SKILL.md",
  ]);
  assert.equal(plan.tree.sha256, (await hashTree(join(state.root, "dist/apex-plugin"))).sha256);
  assert.match(plan.changelog, /^## \[1\.2\.0-next\.3\] - Unreleased\n\n- First release\.$/u);

  const text = formatPlan(plan);
  assert.match(text, /APEX plugin publish plan \(dry run\)/u);
  assert.match(text, new RegExp(`source commit {3}jonathan-vella/apex-vnext@${plan.source.commit}`, "u"));
  assert.match(text, new RegExp(`tree sha256 {5}${plan.tree.sha256}`, "u"));
  assert.match(text, /files {11}4 under plugins\/apex\//u);
  assert.match(text, /Ready: --apply would open the release pull request\./u);

  assert.deepEqual(state.gh, []);
  assert.equal(state.git(state.marketplaceDir, "rev-parse", "HEAD"), marketplaceHead);
  assert.equal(state.git(state.marketplaceDir, "branch", "--list", `release/apex-${version}`), "");
  assert.equal(state.git(state.marketplaceDir, "ls-remote", "--heads", "origin", `release/apex-${version}`), "");
});

test("dry run reports failing checks without refusing", async (context) => {
  const state = await fixture(context);
  await writeText(join(state.root, "untracked.txt"), "x\n");
  const { plan } = await state.publish();
  assert.equal(plan.ready, false);
  assert.deepEqual(failedChecks(plan), ["clean-tree", "clean-after-build"]);
  assert.match(formatPlan(plan), /\[FAIL\] clean-tree {8}uncommitted or untracked files:\n {9}\?\? untracked\.txt/u);
  assert.match(formatPlan(plan), /Not ready: 2 check\(s\) fail; --apply would refuse\./u);
});

test("--apply refuses a dirty source tree", async (context) => {
  const state = await fixture(context);
  await writeText(join(state.root, "plugin/CHANGELOG.md"), `${changelog()}\nextra\n`);
  await assertRefused(state, "clean-tree", /uncommitted or untracked files/u);
});

test("--apply refuses a HEAD that is not on origin/main", async (context) => {
  const state = await fixture(context);
  await state.commitSource("docs/note.md", "local only\n", { push: false });
  await assertRefused(state, "source-commit", /is not on origin\/main/u);
});

test("--apply accepts an explicit release commit only when it is HEAD and on origin", async (context) => {
  const state = await fixture(context);
  await state.commitSource("docs/note.md", "release branch\n", { push: false });
  const head = state.git(state.root, "rev-parse", "HEAD");
  await assertRefused(state, "source-commit", /HEAD [0-9a-f]{40} is not the release commit a{40}/u, {
    releaseCommit: "a".repeat(40),
  });
  await assertRefused(state, "source-commit", /must be a full 40-character commit SHA/u, {
    releaseCommit: head.slice(0, 12),
  });
  await assertRefused(state, "source-commit", /is not on any origin branch/u, { releaseCommit: head });
  state.git(state.root, "push", "--quiet", "origin", "HEAD:refs/heads/release/1.2");
  const { plan } = await state.publish({ releaseCommit: head });
  assert.deepEqual(failedChecks(plan), []);
  assert.match(plan.checks.find((check) => check.id === "source-commit").detail, /explicit release commit/u);
});

test("--apply refuses a version without a changelog section", async (context) => {
  const state = await fixture(context);
  await state.commitSource("plugin/CHANGELOG.md", changelog("1.2.0-next.2"));
  await assertRefused(state, "changelog", /plugin\/CHANGELOG\.md has no non-empty "## \[1\.2\.0-next\.3\]" section/u);
});

test("--apply refuses a CLI version that is not on npm", async (context) => {
  const state = await fixture(context);
  state.npm = {
    status: 1,
    stdout: JSON.stringify({ error: { code: "E404", summary: "No match found" } }),
    stderr: "npm error 404",
  };
  await assertRefused(state, "npm-release", /@apexops\/cli@1\.2\.0-next\.3 is not on npm; publish the CLI first/u);
  state.npm = { status: 1, stdout: "", stderr: "network unreachable" };
  await assertRefused(state, "npm-release", /npm view @apexops\/cli@1\.2\.0-next\.3 failed: network unreachable/u);
});

test("--apply refuses when CLI inputs changed since the npm release", async (context) => {
  const state = await fixture(context);
  await state.commitSource("packages/cli/src/index.ts", "export const changed = true;\n");
  await assertRefused(
    state,
    "npm-release",
    /1 CLI input file\(s\) changed since npm 1\.2\.0-next\.3.*packages\/cli\/src/u,
  );
});

test("--apply refuses a version that is not newer than the marketplace", async (context) => {
  for (const published of [version, "1.2.0"]) {
    const state = await fixture(context, {
      marketplacePlugins: [{ name: "apex", source: "./plugins/apex", version: published }],
    });
    await assertRefused(
      state,
      "version",
      new RegExp(
        `${version.replaceAll(".", "\\.")} must be newer than the published ${published.replaceAll(".", "\\.")}`,
        "u",
      ),
    );
  }
});

test("--apply refuses a dirty or unscaffolded marketplace clone", async (context) => {
  const dirty = await fixture(context);
  await writeText(join(dirty.marketplaceDir, "stray.txt"), "x\n");
  await assertRefused(dirty, "marketplace", /marketplace clone has uncommitted or untracked files/u);

  const missing = await fixture(context, { seedMarketplace: false });
  await assertRefused(missing, "marketplace", /origin\/main has no \.github\/plugin\/marketplace\.json/u);

  const absent = await fixture(context);
  await assertRefused(absent, "marketplace", /no git clone at/u, { marketplaceDir: join(absent.base, "nowhere") });
});

test("--apply refuses a release branch that already exists", async (context) => {
  const state = await fixture(context);
  state.git(state.marketplaceDir, "push", "--quiet", "origin", `main:refs/heads/release/apex-${version}`);
  await assertRefused(state, "release-branch", /already exists on origin/u);
});

test("--apply refuses a build whose tree hash does not match its sidecar", async (context) => {
  const state = await fixture(context);
  state.build.sidecar = "0".repeat(64);
  await assertRefused(state, "build", /does not match the build sidecar 0{64}/u);
});

test("--apply refuses a build that changes the source tree", async (context) => {
  const state = await fixture(context);
  state.build.touch = "packages/cli/generated.txt";
  await assertRefused(state, "clean-after-build", /the build changed tracked or untracked files/u);
});

test("--apply opens a pull request from a release branch with the exact built tree", async (context) => {
  const state = await fixture(context, {
    marketplacePlugins: [
      { name: "apex", source: "./plugins/apex", version: "1.2.0-next.2" },
      { name: "other", source: "./plugins/other", version: "9.0.0" },
    ],
  });
  const originMain = state.git(state.base, `--git-dir=${state.marketplaceOrigin}`, "rev-parse", "main");
  const result = await state.publish({ apply: true });
  const { plan } = result;
  const branch = `release/apex-${version}`;
  assert.equal(result.dryRun, false);
  assert.equal(result.branch, branch);
  assert.equal(result.pullRequest, "https://github.com/jonathan-vella/apex-plugins/pull/7");
  assert.equal(plan.marketplace.current, "1.2.0-next.2");

  assert.equal(
    state.git(state.base, `--git-dir=${state.marketplaceOrigin}`, "rev-parse", "main"),
    originMain,
    "main is never pushed",
  );
  assert.equal(
    state.git(state.base, `--git-dir=${state.marketplaceOrigin}`, "rev-parse", branch),
    state.git(state.marketplaceDir, "rev-parse", "HEAD"),
  );
  assert.equal(state.git(state.marketplaceDir, "status", "--porcelain"), "");
  assert.equal((await hashTree(join(state.marketplaceDir, "plugins/apex"))).sha256, plan.tree.sha256);
  assert.deepEqual(
    state.git(state.marketplaceDir, "diff", "--name-only", "origin/main", "HEAD").split("\n").sort(),
    [MARKETPLACE_PATH, PROVENANCE_PATH, ...plan.tree.files.map((file) => `plugins/apex/${file}`)].sort(),
  );
  const message = state.git(state.marketplaceDir, "log", "-1", "--format=%B");
  assert.match(message, new RegExp(`^chore\\(release\\): publish apex ${version.replaceAll(".", "\\.")}\n`, "u"));
  assert.match(message, new RegExp(`Source-Commit: jonathan-vella/apex-vnext@${plan.source.commit}`, "u"));
  assert.match(message, new RegExp(`Tree-SHA256: ${plan.tree.sha256}`, "u"));

  const marketplace = JSON.parse(await readFile(join(state.marketplaceDir, MARKETPLACE_PATH), "utf8"));
  assert.equal(marketplace.metadata.version, version);
  assert.deepEqual(
    marketplace.plugins.map(({ name, version: entryVersion, source }) => [name, entryVersion, source]),
    [
      ["apex", version, "./plugins/apex"],
      ["other", "9.0.0", "./plugins/other"],
    ],
  );
  const provenance = JSON.parse(await readFile(join(state.marketplaceDir, PROVENANCE_PATH), "utf8"));
  assert.deepEqual(provenance, {
    schemaVersion: "1.0.0",
    plugins: [
      {
        name: "apex",
        version,
        source: { repository: "jonathan-vella/apex-vnext", commit: plan.source.commit },
        cli: { package: "@apexops/cli", version, gitHead: state.gitHead },
        tree: { algorithm: "apex-plugin-tree-sha256-v1", sha256: plan.tree.sha256, files: 4 },
      },
    ],
  });

  assert.equal(state.gh.length, 1);
  const [args] = state.gh;
  assert.deepEqual(args.slice(0, 9), [
    "pr",
    "create",
    "--repo",
    "jonathan-vella/apex-plugins",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
  ]);
  assert.equal(args[9], `chore(release): publish apex ${version}`);
  assert.equal(args[10], "--body");
  assert.equal(args[11], pullRequestBody(plan));
  assert.match(args[11], new RegExp(`jonathan-vella/apex-vnext@${plan.source.commit}`, "u"));
  assert.match(args[11], new RegExp(`Plugin tree SHA-256: \`${plan.tree.sha256}\``, "u"));
  assert.match(args[11], /### \[1\.2\.0-next\.3\] - Unreleased\n\n- First release\./u);
  assert.match(args[11], /\(replaces 1\.2\.0-next\.2\)/u);
  assert.ok(!state.gh.flat().includes("merge"), "the script never merges");
});

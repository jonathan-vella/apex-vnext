#!/usr/bin/env node
/**
 * Publish the built APEX plugin to the jonathan-vella/apex-plugins marketplace through a reviewed pull request (CP-07).
 *
 * Usage: npm run publish:plugin -- [--apply] [--marketplace-dir <apex-plugins clone>] [--release-commit <sha>]
 *                                  [--json] [--files]
 *
 * The default is a dry run: it runs a fresh build:plugin, evaluates every --apply precondition and prints the plan
 * (version, source commit, tree hash, files). It changes nothing outside the gitignored build output.
 *
 * --apply refuses unless every check passes: clean tree, HEAD on origin/main (or HEAD equal to an explicit
 * --release-commit that is on origin), a plugin/CHANGELOG.md section for the version, the same @apexops/cli version on
 * npm built from unchanged CLI inputs, a clean marketplace clone, a version newer than the marketplace's, an unused
 * release branch and a build whose tree hash matches its .sha256 sidecar. It then creates `release/apex-<version>` from
 * the marketplace's origin/main, replaces `plugins/apex/` with the built tree, updates marketplace.json and
 * provenance.json, pushes only that branch and opens a pull request with `gh`. It never merges, never pushes to main
 * and never creates tags. The pin is the source commit SHA; tags are release labels only.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { hashTree } from "./build-plugin.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const PLUGIN_NAME = "apex";
export const SOURCE_REPOSITORY = "jonathan-vella/apex-vnext";
export const MARKETPLACE_REPOSITORY = "jonathan-vella/apex-plugins";
export const MARKETPLACE_NAME = "apex-plugins";
export const MARKETPLACE_PATH = ".github/plugin/marketplace.json";
export const PROVENANCE_PATH = ".github/plugin/provenance.json";
export const PLUGIN_SOURCE = `./plugins/${PLUGIN_NAME}`;
export const CHANGELOG_PATH = "plugin/CHANGELOG.md";
export const CLI_PACKAGE = "@apexops/cli";
export const TREE_ALGORITHM = "apex-plugin-tree-sha256-v1";
/** Inputs of the published @apexops/cli tarball; the plugin bundles them, so they must match the npm release. */
export const CLI_PACKAGE_INPUTS = ["packages", "customizations", "config", "package-lock.json"];
const BASE = "main";
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;

/** SemVer 2.0 precedence: negative when left < right, zero when equal, positive when left > right. */
export function compareVersions(left, right) {
  const a = SEMVER.exec(left);
  const b = SEMVER.exec(right);
  if (!a || !b) throw new Error(`Not a semantic version: ${a ? right : left}`);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a[4] === b[4]) return 0;
  if (a[4] === undefined) return 1;
  if (b[4] === undefined) return -1;
  const leftIds = a[4].split(".");
  const rightIds = b[4].split(".");
  for (let index = 0; index < Math.max(leftIds.length, rightIds.length); index += 1) {
    const l = leftIds[index];
    const r = rightIds[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNumeric = /^\d+$/u.test(l);
    const rNumeric = /^\d+$/u.test(r);
    if (lNumeric && rNumeric) return Math.sign(Number(l) - Number(r));
    if (lNumeric) return -1;
    if (rNumeric) return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

/** The changelog section for `version` (heading `## [version]`) with a non-empty body, or null. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `## [${version}]` || line.startsWith(`## [${version}] `));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const section = lines
    .slice(start, end === -1 ? undefined : end)
    .join("\n")
    .trim();
  return section.split("\n").slice(1).join("\n").trim() === "" ? null : section;
}

/** `owner/name` from an HTTPS or SSH GitHub remote URL, or null. */
export function repositorySlug(url) {
  const match = /github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/u.exec(url.trim());
  return match ? match[1] : null;
}

/** Marketplace JSON with the plugin entry added or updated; other entries and fields are preserved. */
export function updateMarketplace(marketplace, plugin) {
  const next = structuredClone(marketplace);
  const entry = { name: plugin.name, description: plugin.description, version: plugin.version, source: PLUGIN_SOURCE };
  for (const field of ["author", "homepage", "repository", "license", "keywords"]) {
    if (plugin[field] !== undefined) entry[field] = plugin[field];
  }
  next.plugins = Array.isArray(next.plugins) ? next.plugins : [];
  const index = next.plugins.findIndex((candidate) => candidate.name === plugin.name);
  if (index === -1) next.plugins.push(entry);
  else next.plugins[index] = entry;
  next.metadata = { ...next.metadata, version: plugin.version };
  return next;
}

/** Provenance JSON with the release record for the plugin added or replaced. */
export function updateProvenance(provenance, record) {
  const next = provenance === null ? { schemaVersion: "1.0.0", plugins: [] } : structuredClone(provenance);
  next.plugins = Array.isArray(next.plugins) ? next.plugins.filter((entry) => entry.name !== record.name) : [];
  next.plugins.push(record);
  next.plugins.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return next;
}

function npmCommand(args) {
  const npmCli = process.env.npm_execpath;
  return npmCli && /\.(?:c|m)?js$/u.test(npmCli) ? [process.execPath, [npmCli, ...args]] : ["npm", args];
}

/** Runs a command without a shell; returns { status, stdout, stderr }. */
export function defaultRun(command, args, { cwd } = {}) {
  const [executable, finalArgs] = command === "npm" ? npmCommand(args) : [command, args];
  const result = spawnSync(executable, finalArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) return { status: 1, stdout: "", stderr: result.error.message };
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Runs `npm run build:plugin` with its progress on stderr so the plan on stdout stays parseable. */
export function defaultBuild({ root }) {
  const [executable, args] = npmCommand(["run", "build:plugin"]);
  const result = spawnSync(executable, args, { cwd: root, stdio: ["ignore", 2, 2] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm run build:plugin failed with exit code ${result.status}`);
}

function runner(run) {
  const call = (command, args, cwd) => run(command, args, { cwd });
  const must = (command, args, cwd) => {
    const result = call(command, args, cwd);
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim();
      throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
    }
    return result.stdout.trim();
  };
  const git = (cwd, args) => must("git", ["-C", cwd, ...args]);
  const gitStatus = (cwd, args) => call("git", ["-C", cwd, ...args]).status;
  return { call, must, git, gitStatus };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function evaluate(checks, id, body) {
  try {
    const detail = await body();
    checks.push({ id, ok: true, detail });
  } catch (error) {
    checks.push({ id, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Evaluates every --apply precondition without changing tracked files, runs a fresh plugin build, and returns the
 * plan. Network reads: `git fetch` in both repositories and `npm view`.
 */
export async function planRelease({
  root = repositoryRoot,
  marketplaceDir = resolve(repositoryRoot, "..", MARKETPLACE_NAME),
  releaseCommit,
  run = defaultRun,
  build = defaultBuild,
} = {}) {
  const { git, gitStatus, call } = runner(run);
  const manifest = await readJson(join(root, "plugin/package-manifest.json"));
  const { version } = await readJson(join(root, manifest.plugin.versionFrom));
  const outputDirectory = resolve(root, manifest.outputDirectory);
  const branch = `release/${PLUGIN_NAME}-${version}`;
  const checks = [];
  const plan = {
    plugin: { name: PLUGIN_NAME, version, versionFrom: manifest.plugin.versionFrom },
    source: { repository: SOURCE_REPOSITORY, commit: null },
    marketplace: { repository: MARKETPLACE_REPOSITORY, directory: marketplaceDir, base: BASE, branch, current: null },
    npm: { package: CLI_PACKAGE, version, gitHead: null },
    tree: { algorithm: TREE_ALGORITHM, directory: outputDirectory, sha256: null, files: [] },
    changelog: null,
    built: null,
    checks,
  };

  await evaluate(checks, "clean-tree", () => {
    const dirty = git(root, ["status", "--porcelain", "--untracked-files=all"]);
    if (dirty) throw new Error(`uncommitted or untracked files:\n${dirty}`);
    return "working tree is clean";
  });

  await evaluate(checks, "source-commit", () => {
    plan.source.commit = git(root, ["rev-parse", "HEAD"]);
    const slug = repositorySlug(git(root, ["remote", "get-url", "origin"]));
    if (slug !== SOURCE_REPOSITORY)
      throw new Error(`origin is ${slug ?? "not a GitHub remote"}, not ${SOURCE_REPOSITORY}`);
    git(root, ["fetch", "--quiet", "origin", BASE]);
    if (releaseCommit !== undefined) {
      if (!FULL_SHA.test(releaseCommit)) throw new Error("--release-commit must be a full 40-character commit SHA");
      if (releaseCommit !== plan.source.commit)
        throw new Error(`HEAD ${plan.source.commit} is not the release commit ${releaseCommit}`);
      git(root, ["fetch", "--quiet", "origin"]);
      const branches = git(root, ["branch", "--remotes", "--contains", releaseCommit, "--format=%(refname:short)"]);
      if (!branches.split("\n").some((name) => name.startsWith("origin/")))
        throw new Error(`release commit ${releaseCommit} is not on any origin branch; push it first`);
      return `HEAD is the explicit release commit ${releaseCommit}`;
    }
    if (gitStatus(root, ["merge-base", "--is-ancestor", "HEAD", `origin/${BASE}`]) !== 0)
      throw new Error(
        `HEAD ${plan.source.commit} is not on origin/${BASE}; publish a merged commit or --release-commit`,
      );
    return `HEAD ${plan.source.commit} is on origin/${BASE}`;
  });

  await evaluate(checks, "changelog", async () => {
    const path = join(root, CHANGELOG_PATH);
    const text = existsSync(path) ? await readFile(path, "utf8") : "";
    plan.changelog = changelogSection(text, version);
    if (plan.changelog === null) throw new Error(`${CHANGELOG_PATH} has no non-empty "## [${version}]" section`);
    return `${CHANGELOG_PATH} has a section for ${version}`;
  });

  await evaluate(checks, "npm-release", () => {
    const result = call("npm", ["view", `${CLI_PACKAGE}@${version}`, "version", "gitHead", "--json"], root);
    let published;
    try {
      published = result.stdout.trim() === "" ? null : JSON.parse(result.stdout);
    } catch {
      published = null;
    }
    if (result.status !== 0 && published?.error?.code !== "E404")
      throw new Error(`npm view ${CLI_PACKAGE}@${version} failed: ${(result.stderr || result.stdout).trim()}`);
    if (published?.version !== version)
      throw new Error(`${CLI_PACKAGE}@${version} is not on npm; publish the CLI first (docs/how-to/publish-npm.md)`);
    plan.npm.gitHead = published.gitHead ?? null;
    if (!plan.npm.gitHead || !FULL_SHA.test(plan.npm.gitHead))
      throw new Error(`${CLI_PACKAGE}@${version} on npm records no gitHead commit`);
    if (gitStatus(root, ["cat-file", "-e", `${plan.npm.gitHead}^{commit}`]) !== 0)
      throw new Error(`npm gitHead ${plan.npm.gitHead} is not in this clone; fetch origin`);
    const changed = git(root, ["diff", "--name-only", plan.npm.gitHead, "HEAD", "--", ...CLI_PACKAGE_INPUTS]);
    if (changed) {
      const files = changed.split("\n");
      throw new Error(
        `${files.length} CLI input file(s) changed since npm ${version} (gitHead ${plan.npm.gitHead.slice(0, 12)}), ` +
          `e.g. ${files.slice(0, 3).join(", ")}; release a new CLI version first`,
      );
    }
    return `${CLI_PACKAGE}@${version} is on npm from ${plan.npm.gitHead.slice(0, 12)} with unchanged CLI inputs`;
  });

  let marketplaceReady = false;
  await evaluate(checks, "marketplace", () => {
    if (!existsSync(join(marketplaceDir, ".git")))
      throw new Error(
        `no git clone at ${marketplaceDir}; gh repo clone ${MARKETPLACE_REPOSITORY} or --marketplace-dir`,
      );
    const slug = repositorySlug(git(marketplaceDir, ["remote", "get-url", "origin"]));
    if (slug !== MARKETPLACE_REPOSITORY)
      throw new Error(`marketplace origin is ${slug}, not ${MARKETPLACE_REPOSITORY}`);
    const dirty = git(marketplaceDir, ["status", "--porcelain", "--untracked-files=all"]);
    if (dirty) throw new Error(`marketplace clone has uncommitted or untracked files:\n${dirty}`);
    git(marketplaceDir, ["fetch", "--quiet", "--prune", "origin", BASE]);
    const show = call("git", ["-C", marketplaceDir, "show", `origin/${BASE}:${MARKETPLACE_PATH}`]);
    if (show.status !== 0) throw new Error(`origin/${BASE} has no ${MARKETPLACE_PATH}; merge the marketplace scaffold`);
    const marketplace = JSON.parse(show.stdout);
    if (marketplace.name !== MARKETPLACE_NAME)
      throw new Error(`marketplace name is ${marketplace.name}, not ${MARKETPLACE_NAME}`);
    plan.marketplace.current = marketplace.plugins?.find((entry) => entry.name === PLUGIN_NAME)?.version ?? null;
    marketplaceReady = true;
    return `clean clone of ${MARKETPLACE_REPOSITORY} at ${marketplaceDir}`;
  });

  await evaluate(checks, "version", () => {
    if (!marketplaceReady) throw new Error("marketplace version unknown; fix the marketplace check first");
    if (plan.marketplace.current === null) return `${version}; ${PLUGIN_NAME} is not yet in the marketplace`;
    if (compareVersions(version, plan.marketplace.current) <= 0)
      throw new Error(
        `${version} must be newer than the published ${plan.marketplace.current}; bump ${manifest.plugin.versionFrom}`,
      );
    return `${version} is newer than the published ${plan.marketplace.current}`;
  });

  await evaluate(checks, "release-branch", () => {
    if (!marketplaceReady) throw new Error("not checked; fix the marketplace check first");
    if (gitStatus(marketplaceDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) === 0)
      throw new Error(`local branch ${branch} already exists in the marketplace clone`);
    if (git(marketplaceDir, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]))
      throw new Error(`branch ${branch} already exists on origin`);
    return `${branch} is unused`;
  });

  await evaluate(checks, "build", async () => {
    await build({ root, outputDirectory });
    const sidecar = (await readFile(`${outputDirectory}.sha256`, "utf8")).trim().split(/\s+/u)[0];
    const tree = await hashTree(outputDirectory);
    plan.tree.sha256 = tree.sha256;
    plan.tree.files = tree.files;
    if (sidecar !== tree.sha256)
      throw new Error(`tree hash ${tree.sha256} does not match the build sidecar ${sidecar}`);
    plan.built = await readJson(join(outputDirectory, "plugin.json"));
    if (plan.built.name !== PLUGIN_NAME || plan.built.version !== version)
      throw new Error(
        `built plugin.json is ${plan.built.name}@${plan.built.version}, expected ${PLUGIN_NAME}@${version}`,
      );
    return `fresh build, tree sha256 ${tree.sha256} (${tree.files.length} files)`;
  });

  await evaluate(checks, "clean-after-build", () => {
    const dirty = git(root, ["status", "--porcelain", "--untracked-files=all"]);
    if (dirty) throw new Error(`the build changed tracked or untracked files:\n${dirty}`);
    return "build left the working tree unchanged";
  });

  plan.ready = checks.every((check) => check.ok);
  return plan;
}

export function provenanceRecord(plan) {
  return {
    name: PLUGIN_NAME,
    version: plan.plugin.version,
    source: { repository: plan.source.repository, commit: plan.source.commit },
    cli: { package: plan.npm.package, version: plan.npm.version, gitHead: plan.npm.gitHead },
    tree: { algorithm: TREE_ALGORITHM, sha256: plan.tree.sha256, files: plan.tree.files.length },
  };
}

export function pullRequestBody(plan) {
  const { commit, repository } = plan.source;
  return [
    "## Summary",
    "",
    `Publish \`${PLUGIN_NAME}\` ${plan.plugin.version} to the ${MARKETPLACE_NAME} marketplace ${
      plan.marketplace.current ? `(replaces ${plan.marketplace.current}).` : "(first release)."
    }`,
    "",
    "## Provenance",
    "",
    `- Source commit (pin): [${repository}@${commit}](https://github.com/${repository}/commit/${commit})`,
    `- Plugin tree SHA-256: \`${plan.tree.sha256}\` (${plan.tree.files.length} files in \`plugins/${PLUGIN_NAME}/\`, ` +
      `${TREE_ALGORITHM})`,
    `- Bundled CLI: [\`${CLI_PACKAGE}@${plan.npm.version}\`](https://www.npmjs.com/package/${CLI_PACKAGE}/v/` +
      `${plan.npm.version}), npm gitHead \`${plan.npm.gitHead}\``,
    "",
    "## Changelog",
    "",
    plan.changelog.replace(/^## /u, "### "),
    "",
    "## Validation",
    "",
    "The `validate` check recomputes the tree hash of `plugins/apex/` and compares it with",
    `\`${PROVENANCE_PATH}\`, and confirms the source commit is on ${repository} main.`,
    "",
    "Prepared by `npm run publish:plugin -- --apply`. Tags are release labels only; the pin is the source commit SHA.",
    "",
  ].join("\n");
}

/** Prepares the release branch in the marketplace clone, pushes only that branch and opens a pull request. */
export async function applyRelease(plan, { run = defaultRun } = {}) {
  if (!plan.ready) throw new Error("Refusing to publish: not every check passed");
  const { git, must } = runner(run);
  const { directory, branch, base } = plan.marketplace;
  if ([base, "main", "master"].includes(branch)) throw new Error(`Refusing to publish to ${branch}`);
  git(directory, ["switch", "--quiet", "--no-track", "--create", branch, `origin/${base}`]);

  const target = join(directory, "plugins", PLUGIN_NAME);
  await rm(target, { recursive: true, force: true });
  await cp(plan.tree.directory, target, { recursive: true, errorOnExist: true, force: false });
  const copied = await hashTree(target);
  if (copied.sha256 !== plan.tree.sha256)
    throw new Error(`copied tree hash ${copied.sha256} does not match the build ${plan.tree.sha256}`);

  const marketplacePath = join(directory, MARKETPLACE_PATH);
  const marketplace = updateMarketplace(await readJson(marketplacePath), plan.built);
  await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
  const provenancePath = join(directory, PROVENANCE_PATH);
  const provenance = updateProvenance(
    existsSync(provenancePath) ? await readJson(provenancePath) : null,
    provenanceRecord(plan),
  );
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  git(directory, ["add", "--force", "--all", "--", `plugins/${PLUGIN_NAME}`, MARKETPLACE_PATH, PROVENANCE_PATH]);
  const staged = git(directory, ["ls-files", "-z", "--", `plugins/${PLUGIN_NAME}`])
    .split("\0")
    .filter(Boolean)
    .map((path) => path.slice(`plugins/${PLUGIN_NAME}/`.length))
    .sort();
  const expected = [...plan.tree.files].sort();
  if (staged.length !== expected.length || staged.some((path, index) => path !== expected[index]))
    throw new Error(`staged plugins/${PLUGIN_NAME}/ differs from the build file list`);
  const dirty = git(directory, ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter((line) => line && !/^[MADR] {2}/u.test(line));
  if (dirty.length > 0) throw new Error(`unexpected unstaged changes in the marketplace clone:\n${dirty.join("\n")}`);

  const title = `chore(release): publish ${PLUGIN_NAME} ${plan.plugin.version}`;
  git(directory, [
    "commit",
    "--quiet",
    "-m",
    title,
    "-m",
    `Source-Commit: ${plan.source.repository}@${plan.source.commit}\nTree-SHA256: ${plan.tree.sha256}`,
  ]);
  const head = git(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head !== branch || head === base) throw new Error(`Refusing to push ${head}`);
  git(directory, ["push", "--quiet", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
  const url = must("gh", [
    "pr",
    "create",
    "--repo",
    plan.marketplace.repository,
    "--base",
    base,
    "--head",
    branch,
    "--title",
    title,
    "--body",
    pullRequestBody(plan),
  ]);
  return { branch, pullRequest: url };
}

function groupFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const parts = file.split("/");
    const key = parts.length > 2 ? `${parts.slice(0, 2).join("/")}/` : parts.length === 2 ? `${parts[0]}/` : file;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

export function formatPlan(plan, { apply = false, listFiles = false } = {}) {
  const lines = [
    `APEX plugin publish plan (${apply ? "apply" : "dry run"})`,
    "",
    `  plugin          ${plan.plugin.name} ${plan.plugin.version} (version from ${plan.plugin.versionFrom})`,
    `  source commit   ${plan.source.repository}@${plan.source.commit ?? "unknown"}`,
    `  bundled CLI     ${plan.npm.package}@${plan.npm.version} (npm gitHead ${plan.npm.gitHead ?? "unknown"})`,
    `  marketplace     ${plan.marketplace.repository} ${plan.marketplace.base}: ${
      plan.marketplace.current ? `${plan.plugin.name} ${plan.marketplace.current}` : "no published version"
    }`,
    `  release branch  ${plan.marketplace.branch} (pull request into ${plan.marketplace.base}; never merged here)`,
    `  tree sha256     ${plan.tree.sha256 ?? "not built"} (${plan.tree.algorithm})`,
    `  files           ${plan.tree.files.length} under plugins/${plan.plugin.name}/`,
  ];
  for (const [group, count] of groupFiles(plan.tree.files)) lines.push(`    ${String(count).padStart(4)}  ${group}`);
  if (listFiles) for (const file of plan.tree.files) lines.push(`          ${file}`);
  lines.push("", "Checks:");
  for (const check of plan.checks) {
    const [first, ...rest] = check.detail.split("\n");
    lines.push(`  [${check.ok ? "pass" : "FAIL"}] ${check.id.padEnd(17)} ${first}`);
    for (const line of rest) lines.push(`         ${line}`);
  }
  lines.push(
    "",
    plan.ready
      ? "Ready: --apply would open the release pull request."
      : `Not ready: ${plan.checks.filter((check) => !check.ok).length} check(s) fail; --apply would refuse.`,
  );
  return `${lines.join("\n")}\n`;
}

export async function publishPlugin({ apply = false, ...options } = {}) {
  const plan = await planRelease(options);
  if (!apply) return { plan, dryRun: true };
  if (!plan.ready) {
    const failed = plan.checks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.detail}`);
    const error = new Error(`Refusing to publish:\n- ${failed.join("\n- ")}`);
    error.plan = plan;
    throw error;
  }
  return { plan, dryRun: false, ...(await applyRelease(plan, options)) };
}

function parseArguments(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      apply: { type: "boolean", default: false },
      "marketplace-dir": { type: "string" },
      "release-commit": { type: "string" },
      json: { type: "boolean", default: false },
      files: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  return values;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const values = parseArguments(process.argv.slice(2));
    if (values.help) {
      process.stdout.write(
        "Usage: npm run publish:plugin -- [--apply] [--marketplace-dir <dir>] [--release-commit <sha>] [--json] [--files]\n",
      );
    } else {
      const options = {
        apply: values.apply,
        releaseCommit: values["release-commit"],
        ...(values["marketplace-dir"] ? { marketplaceDir: resolve(values["marketplace-dir"]) } : {}),
      };
      try {
        const result = await publishPlugin(options);
        const { plan } = result;
        if (values.json) {
          const { built: _built, ...summary } = plan;
          const output = { mode: values.apply ? "apply" : "dry-run", ...summary };
          if (result.pullRequest) Object.assign(output, { pullRequest: result.pullRequest });
          process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        } else {
          process.stdout.write(formatPlan(plan, { apply: values.apply, listFiles: values.files }));
          if (result.pullRequest) process.stdout.write(`\nOpened ${result.pullRequest} from ${result.branch}\n`);
        }
      } catch (error) {
        if (error.plan) process.stdout.write(formatPlan(error.plan, { apply: true, listFiles: values.files }));
        throw error;
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

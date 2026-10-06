#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixedTime = new Date("2000-01-01T00:00:00.000Z");
const workspaceScope = "@apexops/";

function bytewise(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(path) {
  return path.split(sep).join("/");
}

function contained(root, path) {
  const child = relative(resolve(root), resolve(path));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function safeRelativePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes(":") &&
    !isAbsolute(path) &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function parseArguments(argv) {
  let manifestPath = join(repositoryRoot, "plugin/package-manifest.json");
  let outputDirectory;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--manifest") {
      const value = argv[++index];
      if (value === undefined) throw new Error("Missing value for --manifest");
      manifestPath = resolve(repositoryRoot, value);
    } else if (argument === "--output-dir") {
      const value = argv[++index];
      if (value === undefined) throw new Error("Missing value for --output-dir");
      outputDirectory = resolve(repositoryRoot, value);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { manifestPath, outputDirectory };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readManifest(manifestPath, outputDirectoryOverride) {
  if (!contained(repositoryRoot, manifestPath))
    throw new Error(`Manifest path is outside the repository: ${manifestPath}`);
  const manifest = await readJson(manifestPath);
  if (manifest.schemaVersion !== "1.0.0") throw new Error("Plugin package manifest schemaVersion must be 1.0.0");
  const outputDirectory = resolve(repositoryRoot, outputDirectoryOverride ?? manifest.outputDirectory ?? "");
  if (dirname(outputDirectory) === outputDirectory)
    throw new Error("Plugin output directory must not be a filesystem root");
  if (outputDirectory === repositoryRoot) throw new Error("Plugin output directory must not be the repository root");
  for (const protectedPath of ["customizations", "packages", "plugin", "tools", ".github"]) {
    const protectedRoot = join(repositoryRoot, protectedPath);
    if (contained(repositoryRoot, outputDirectory) && contained(protectedRoot, outputDirectory)) {
      throw new Error(`Plugin output directory must not be inside source directory ${protectedPath}`);
    }
  }
  return { manifest, outputDirectory };
}

function nonBinary(buffer) {
  return !buffer.includes(0);
}

function shouldNormalizeText(path, buffer) {
  return (
    nonBinary(buffer) &&
    new Set([
      ".bat",
      ".cjs",
      ".cmd",
      ".css",
      ".d.ts",
      ".html",
      ".js",
      ".json",
      ".map",
      ".md",
      ".mjs",
      ".ps1",
      ".sh",
      ".svg",
      ".ts",
      ".txt",
      ".xml",
      ".yaml",
      ".yml",
    ]).has(extname(path))
  );
}

async function readSourceFile(path) {
  const resolved = await realpath(path);
  if (!contained(repositoryRoot, resolved)) throw new Error(`Source path is outside the repository: ${path}`);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Unsupported source file: ${path}`);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.readFile();
    return shouldNormalizeText(path, opened) ? Buffer.from(opened.toString("utf8").replace(/\r\n/g, "\n")) : opened;
  } finally {
    await handle.close();
  }
}

async function writeOutputFile(outputRoot, target, content, mode = 0o644) {
  if (!safeRelativePath(target)) throw new Error(`Unsafe plugin target path: ${target}`);
  const destination = join(outputRoot, target);
  if (!contained(outputRoot, destination)) throw new Error(`Plugin target escapes output: ${target}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
  await chmod(destination, mode);
  await utimes(destination, fixedTime, fixedTime);
}

async function copyFileToOutput(source, outputRoot, target) {
  await writeOutputFile(outputRoot, target, await readSourceFile(source));
}

async function sortedDirectoryEntries(root) {
  return (await readdir(root, { withFileTypes: true })).sort((left, right) => bytewise(left.name, right.name));
}

async function copyDirectory(sourceRoot, outputRoot, targetRoot, options = {}) {
  const root = resolve(repositoryRoot, sourceRoot);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Source directory is invalid: ${sourceRoot}`);
  const copied = [];
  async function visit(current, relativeDirectory = "") {
    for (const entry of await sortedDirectoryEntries(current)) {
      if (options.skip?.(entry.name, join(relativeDirectory, entry.name))) continue;
      const source = join(current, entry.name);
      const relativeTarget = portablePath(join(targetRoot, relativeDirectory, entry.name));
      if (entry.isDirectory()) await visit(source, join(relativeDirectory, entry.name));
      else if (entry.isFile()) {
        await copyFileToOutput(source, outputRoot, relativeTarget);
        copied.push(relativeTarget);
      } else {
        throw new Error(`Unsupported source entry: ${source}`);
      }
    }
  }
  await visit(root);
  return copied.sort(bytewise);
}

function parseAgentFrontmatter(path, source) {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source.replaceAll("\r\n", "\n"));
  if (match === null) throw new Error(`Agent file must contain YAML frontmatter: ${path}`);
  const frontmatter = loadYaml(match[1]);
  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new Error(`Agent frontmatter must be an object: ${path}`);
  }
  for (const field of ["model", "model-policy", "reasoning-effort"]) {
    if (Object.hasOwn(frontmatter, field)) throw new Error(`Agent must not pin ${field}: ${path}`);
  }
  if (typeof frontmatter.name !== "string" || frontmatter.name.length === 0) {
    throw new Error(`Agent is missing name: ${path}`);
  }
}

async function validatePackagedAgents(outputRoot, targetRoot) {
  const agentsRoot = join(outputRoot, targetRoot);
  const agentFiles = (await sortedDirectoryEntries(agentsRoot)).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".md"),
  );
  if (agentFiles.length === 0) throw new Error("Plugin package must contain at least one agent");
  for (const entry of agentFiles) {
    const path = portablePath(join(targetRoot, entry.name));
    parseAgentFrontmatter(path, await readFile(join(agentsRoot, entry.name), "utf8"));
  }
}

async function validatePackagedSkills(outputRoot, targetRoot) {
  const skillsRoot = join(outputRoot, targetRoot);
  const skillDirectories = (await sortedDirectoryEntries(skillsRoot)).filter((entry) => entry.isDirectory());
  if (skillDirectories.length === 0) throw new Error("Plugin package must contain at least one skill");
  for (const entry of skillDirectories) {
    const skillPath = join(skillsRoot, entry.name, "SKILL.md");
    const info = await stat(skillPath).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info?.isFile()) throw new Error(`Packaged skill is missing SKILL.md: ${entry.name}`);
  }
}

async function workspacePackageManifest(packageId) {
  return readJson(join(repositoryRoot, "packages", packageId, "package.json"));
}

async function copyWorkspacePackage(packageId, outputRoot, targetRoot) {
  const manifest = await workspacePackageManifest(packageId);
  const packageTarget = `${targetRoot}/${manifest.name}`;
  await writeOutputFile(
    outputRoot,
    `${packageTarget}/package.json`,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  const includes = [
    ...new Set(
      (manifest.files ?? ["dist"])
        .filter((entry) => !entry.startsWith("!"))
        .map((entry) => entry.split("/**", 1)[0])
        .sort(bytewise),
    ),
  ];
  for (const entry of includes) {
    await copyDirectory(join("packages", packageId, entry), outputRoot, `${packageTarget}/${entry}`, {
      skip: (_name, relativePath) => relativePath === "test" || relativePath.startsWith(`test${sep}`),
    });
  }
  return manifest;
}

function packageRootFromName(packageName) {
  return join(repositoryRoot, "node_modules", ...packageName.split("/"));
}

async function optionalPackageInstalled(packageName) {
  const info = await lstat(packageRootFromName(packageName)).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  return info?.isDirectory() === true && !info.isSymbolicLink();
}

async function collectRuntimeDependencies(workspaceManifests) {
  const pending = workspaceManifests.flatMap((manifest) => Object.keys(manifest.dependencies ?? {}));
  const external = new Set();
  for (let index = 0; index < pending.length; index += 1) {
    const packageName = pending[index];
    if (packageName.startsWith(workspaceScope) || external.has(packageName)) continue;
    const packageRoot = packageRootFromName(packageName);
    const info = await lstat(packageRoot);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Runtime dependency is not installed: ${packageName}`);
    external.add(packageName);
    const manifest = await readJson(join(packageRoot, "package.json"));
    pending.push(...Object.keys(manifest.dependencies ?? {}));
    for (const optionalName of Object.keys(manifest.optionalDependencies ?? {})) {
      if (await optionalPackageInstalled(optionalName)) pending.push(optionalName);
    }
  }
  return [...external].sort(bytewise);
}

async function copyExternalPackage(packageName, outputRoot, targetRoot) {
  await copyDirectory(
    relative(repositoryRoot, packageRootFromName(packageName)),
    outputRoot,
    `${targetRoot}/${packageName}`,
    {
      skip: (name, relativePath) =>
        name === "node_modules" ||
        relativePath.includes(`${sep}node_modules${sep}`) ||
        name === ".cache" ||
        name === ".DS_Store",
    },
  );
}

async function setDirectoryTimes(root) {
  async function visit(directory) {
    for (const entry of await sortedDirectoryEntries(directory)) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) await visit(child);
    }
    await utimes(directory, fixedTime, fixedTime);
  }
  await visit(root);
}

async function hashTree(root) {
  const files = [];
  async function visit(directory, relativeDirectory = "") {
    for (const entry of await sortedDirectoryEntries(directory)) {
      const child = join(directory, entry.name);
      const relativePath = portablePath(join(relativeDirectory, entry.name));
      if (entry.isDirectory()) await visit(child, relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw new Error(`Unsupported output entry: ${child}`);
    }
  }
  await visit(root);
  const hash = createHash("sha256");
  for (const file of files.sort(bytewise)) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(root, file)));
    hash.update("\0");
  }
  return { files, sha256: hash.digest("hex") };
}

async function build(
  { manifestPath, outputDirectory: outputDirectoryOverride } = parseArguments(process.argv.slice(2)),
) {
  const { manifest, outputDirectory } = await readManifest(manifestPath, outputDirectoryOverride);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const plugin = await readJson(join(repositoryRoot, manifest.plugin.source));
  const versionSource = await readJson(join(repositoryRoot, manifest.plugin.versionFrom));
  await writeOutputFile(
    outputDirectory,
    manifest.plugin.target,
    Buffer.from(`${JSON.stringify({ ...plugin, version: versionSource.version }, null, 2)}\n`),
  );
  await copyFileToOutput(join(repositoryRoot, manifest.mcp.source), outputDirectory, manifest.mcp.target);
  await copyFileToOutput(
    join(repositoryRoot, manifest.runtime.entry.source),
    outputDirectory,
    manifest.runtime.entry.target,
  );
  await copyDirectory(manifest.agents.sourceRoot, outputDirectory, manifest.agents.targetRoot);
  await copyDirectory(manifest.skills.sourceRoot, outputDirectory, manifest.skills.targetRoot);
  if (manifest.hooks.entries.length > 0) {
    for (const entry of manifest.hooks.entries) {
      await copyFileToOutput(
        join(repositoryRoot, manifest.hooks.sourceRoot, entry),
        outputDirectory,
        portablePath(join(manifest.hooks.targetRoot, entry)),
      );
    }
  }
  await copyDirectory(manifest.assets.sourceRoot, outputDirectory, manifest.assets.targetRoot);

  const workspaceManifests = [];
  for (const packageId of manifest.runtime.workspacePackages) {
    workspaceManifests.push(await copyWorkspacePackage(packageId, outputDirectory, manifest.runtime.targetRoot));
  }
  for (const dependency of await collectRuntimeDependencies(workspaceManifests)) {
    await copyExternalPackage(dependency, outputDirectory, manifest.runtime.targetRoot);
  }

  await validatePackagedAgents(outputDirectory, manifest.agents.targetRoot);
  await validatePackagedSkills(outputDirectory, manifest.skills.targetRoot);
  await setDirectoryTimes(outputDirectory);
  const tree = await hashTree(outputDirectory);
  await writeFile(
    `${outputDirectory}.sha256`,
    `${tree.sha256}  ${portablePath(relative(repositoryRoot, outputDirectory))}\n`,
  );
  return { outputDirectory, ...tree };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await build();
    process.stdout.write(
      `${JSON.stringify(
        {
          outputDirectory: portablePath(relative(repositoryRoot, result.outputDirectory)),
          files: result.files.length,
          sha256: result.sha256,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export { build, hashTree };

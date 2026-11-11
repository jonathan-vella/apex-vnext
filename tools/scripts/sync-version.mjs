#!/usr/bin/env node
/**
 * Synchronizes all versioned manifests, runtime locks, and version-pinned docs
 * from VERSION.md (or an explicit --version <semver> argument).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u;
const SEMVER_CAPTURE = "([0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)";

function parseCliVersion(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--version") {
      const next = argv[i + 1];
      if (!next || !SEMVER_RE.test(next)) {
        throw new Error(`Invalid --version value: ${String(next)}`);
      }
      return next;
    }
  }
  return undefined;
}

function writeIfChanged(relPath, nextContent) {
  const absPath = path.join(ROOT, relPath);
  const prevContent = fs.readFileSync(absPath, "utf8");
  const normalized = nextContent.replace(/\r\n/gu, "\n");
  if (prevContent === normalized) return false;
  fs.writeFileSync(absPath, normalized, "utf8");
  return true;
}

function updatePackageFields(pkg, version) {
  if (typeof pkg.version === "string") pkg.version = version;
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") continue;
    for (const key of Object.keys(deps)) {
      if (key.startsWith("@apexops/") && SEMVER_RE.test(deps[key])) {
        deps[key] = version;
      }
    }
  }
}

const explicitVersion = parseCliVersion(process.argv.slice(2));
const versionMdPath = path.join(ROOT, "VERSION.md");
let versionMd = fs.readFileSync(versionMdPath, "utf8");

if (explicitVersion !== undefined) {
  versionMd = versionMd.replace(
    new RegExp(`(\\*\\*Current Version:\\*\\*\\s*)${SEMVER_CAPTURE}`, "u"),
    `$1${explicitVersion}`,
  );
  writeIfChanged("VERSION.md", versionMd);
}

const versionMatch = versionMd.match(new RegExp(SEMVER_CAPTURE, "u"));
if (!versionMatch) {
  throw new Error("Could not extract semantic version from VERSION.md");
}
const targetVersion = versionMatch[1];
const updated = [];
if (explicitVersion !== undefined) updated.push("VERSION.md");

// 1. Root package.json + packages/*/package.json
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
updatePackageFields(rootPkg, targetVersion);
if (writeIfChanged("package.json", `${JSON.stringify(rootPkg, null, 2)}\n`)) {
  updated.push("package.json");
}

for (const entry of fs.readdirSync(path.join(ROOT, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const relPkgPath = path.posix.join("packages", entry.name, "package.json");
  const absPkgPath = path.join(ROOT, relPkgPath);
  if (!fs.existsSync(absPkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(absPkgPath, "utf8"));
  updatePackageFields(pkg, targetVersion);
  if (writeIfChanged(relPkgPath, `${JSON.stringify(pkg, null, 2)}\n`)) {
    updated.push(relPkgPath);
  }
}

// 2. package-lock.json
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
lock.version = targetVersion;
if (lock.packages && typeof lock.packages === "object") {
  for (const [pkgKey, pkgEntry] of Object.entries(lock.packages)) {
    if (!pkgEntry || typeof pkgEntry !== "object") continue;
    if (pkgKey === "" || /^packages\/[^/]+$/u.test(pkgKey)) {
      updatePackageFields(pkgEntry, targetVersion);
    }
  }
}
if (writeIfChanged("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`)) {
  updated.push("package-lock.json");
}

// 3. packages/cli/src/version.ts
const cliVersionTs = fs
  .readFileSync(path.join(ROOT, "packages/cli/src/version.ts"), "utf8")
  .replace(new RegExp(`(APEX_VERSION\\s*=\\s*")${SEMVER_CAPTURE}(")`, "u"), `$1${targetVersion}$3`);
if (writeIfChanged("packages/cli/src/version.ts", cliVersionTs)) {
  updated.push("packages/cli/src/version.ts");
}

// 4. customizations/manifest.json
const customManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "customizations/manifest.json"), "utf8"));
customManifest.version = targetVersion;
if (writeIfChanged("customizations/manifest.json", `${JSON.stringify(customManifest, null, 2)}\n`)) {
  updated.push("customizations/manifest.json");
}

// 5. config/runtime-bundle.v1.json
const runtimeBundle = JSON.parse(fs.readFileSync(path.join(ROOT, "config/runtime-bundle.v1.json"), "utf8"));
runtimeBundle.bundleVersion = targetVersion;
if (runtimeBundle.components && typeof runtimeBundle.components === "object") {
  for (const component of Object.values(runtimeBundle.components)) {
    if (component && typeof component === "object" && typeof component.version === "string") {
      component.version = targetVersion;
    }
  }
}
if (writeIfChanged("config/runtime-bundle.v1.json", `${JSON.stringify(runtimeBundle, null, 2)}\n`)) {
  updated.push("config/runtime-bundle.v1.json");
}

// 6. Version callouts in README.md, docs/tutorials/first-run.md, docs/vnext/PROJECT.md
const docReplacements = [
  {
    path: "README.md",
    replacer: (text) =>
      text
        .replace(new RegExp(`(The current release is \`)${SEMVER_CAPTURE}(\`)`, "u"), `$1${targetVersion}$3`)
        .replace(
          new RegExp(`(\\| Runtime, CLI and agent plugin\\s*\\|\\s*Preview \`)${SEMVER_CAPTURE}(\`)`, "u"),
          `$1${targetVersion}$3`,
        ),
  },
  {
    path: "docs/tutorials/first-run.md",
    replacer: (text) =>
      text.replace(new RegExp(`(Preview \`)${SEMVER_CAPTURE}(\` is\\s*published)`, "u"), `$1${targetVersion}$3`),
  },
  {
    path: "docs/vnext/PROJECT.md",
    replacer: (text) =>
      text
        .replace(
          new RegExp(
            `(- \\*\\*Product status:\\*\\* Preview published \\(\`apex@apex-plugins\` \`)${SEMVER_CAPTURE}(\`\\))`,
            "u",
          ),
          `$1${targetVersion}$3`,
        )
        .replace(new RegExp(`(- \\*\\*Release candidate:\\*\\* \`)${SEMVER_CAPTURE}(\`)`, "u"), `$1${targetVersion}$3`),
  },
];

for (const { path: relDocPath, replacer } of docReplacements) {
  const absDocPath = path.join(ROOT, relDocPath);
  if (!fs.existsSync(absDocPath)) continue;
  const nextDoc = replacer(fs.readFileSync(absDocPath, "utf8"));
  if (writeIfChanged(relDocPath, nextDoc)) {
    updated.push(relDocPath);
  }
}

console.log(
  updated.length > 0
    ? `Synced v${targetVersion} across ${updated.length} file(s): ${updated.join(", ")}`
    : `All versioned files already match v${targetVersion}`,
);

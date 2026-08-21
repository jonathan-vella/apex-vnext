import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "../..");
const execFile = promisify(execFileCallback);
const manifestPath = join(root, "config", "recipe-packs.v1.json");
const functionsRoot = join(root, ".github", "skills", "azure-prepare", "references", "services", "functions");
const managedReferences = [
  ".github/skills/apex-azure-prepare/references/functions-recipe-pack.md",
  ".github/skills/apex-azure-cloud-migrate/references/lambda-to-functions-assessment.md",
  ".github/skills/apex-terraform-patterns/references/module-composition-and-refactor.md",
  ".github/skills/apex-terraform-test/references/plan-mode-test-design.md",
  ".github/skills/apex-terraform-import/references/import-mapping.md",
];

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function corpusDigest(sourceRoot) {
  const digest = createHash("sha256");
  for (const path of await walkFiles(sourceRoot)) {
    digest.update(`${relative(sourceRoot, path).split(sep).join("/")}\0`);
    digest.update(
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    );
    digest.update("\n");
  }
  return digest.digest("hex");
}

test("Azure Functions recipe pack is source-bound and deferred", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, "1.0.0");
  const pack = manifest.recipePacks.find(({ id }) => id === "azure-functions-recipes");
  assert.ok(pack, "azure-functions-recipes pack must exist");
  assert.equal(pack.id, "azure-functions-recipes");
  assert.equal(pack.source.root, ".github/skills/azure-prepare/references/services/functions");
  assert.equal(pack.source.digestAlgorithm, "sha256(path-nul-file-sha256-newline)");
  assert.equal(await corpusDigest(functionsRoot), pack.source.treeSha256);
  assert.equal(pack.availability.status, "deferred");
  assert.equal(pack.availability.requiredCapability, "recipe-materializer");
  assert.match(pack.availability.behavior, /do not read, compose, stage, or publish/u);
});

test("recipe guidance is declared and copied into both client projections", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const customization = JSON.parse(await readFile(join(root, "customizations", "manifest.json"), "utf8"));
  for (const reference of managedReferences) assert.ok(customization.managedFiles.includes(reference), reference);

  const assets = JSON.parse(await readFile(join(root, "packages", "cli", "assets", "manifest.json"), "utf8"));
  for (const clientId of ["github-copilot-vscode", "github-copilot-cli"]) {
    const projection = assets.projections.find((entry) => entry.id === clientId);
    assert.ok(projection, clientId);
    for (const reference of managedReferences) {
      assert.ok(projection.files.includes(`client-projections/${clientId}/${reference}`), `${clientId}: ${reference}`);
    }
  }
});

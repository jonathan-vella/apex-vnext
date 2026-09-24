import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "../..");
const execFile = promisify(execFileCallback);
const manifestPath = join(root, "config", "recipe-packs.v1.json");
const managedReferences = [
  ".github/skills/apex-azure-cloud-migrate/references/lambda-to-functions-assessment.md",
  ".github/skills/apex-terraform-patterns/references/module-composition-and-refactor.md",
  ".github/skills/apex-terraform-test/references/plan-mode-test-design.md",
  ".github/skills/apex-terraform-import/references/import-mapping.md",
];

test("unavailable Azure Functions recipe pack is absent", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.deepEqual(manifest.recipePacks, []);
});

test("active recipe guidance is copied into the CLI projection", async () => {
  await execFile(process.execPath, ["packages/cli/scripts/prepare-assets.mjs"], { cwd: root });
  const customization = JSON.parse(await readFile(join(root, "customizations", "manifest.json"), "utf8"));
  for (const reference of managedReferences) assert.ok(customization.managedFiles.includes(reference), reference);

  const assets = JSON.parse(await readFile(join(root, "packages", "cli", "assets", "manifest.json"), "utf8"));
  for (const clientId of ["github-copilot-cli"]) {
    const projection = assets.projections.find((entry) => entry.id === clientId);
    assert.ok(projection, clientId);
    for (const reference of managedReferences) {
      assert.ok(projection.files.includes(`client-projections/${clientId}/${reference}`), `${clientId}: ${reference}`);
    }
  }
});

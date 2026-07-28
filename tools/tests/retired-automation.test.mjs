import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync } from "node:fs";
import test from "node:test";

const archivePath = ".archive/retired-automation/sync-workflows.mjs";
const provenancePath = ".archive/retired-automation/README.md";
const expectedHash = "e1111eb1f9a60e4273c1302a9af8666a555f7b5c6f079451ecaa37f50ec4cffa";
const terraformArchivePath = ".archive/retired-automation/terraform-mcp";

test("workflow synchronization remains provenance-only retired automation", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  assert.equal(scripts["sync:workflows"], undefined);
  assert.equal(existsSync("tools/scripts/sync-workflows.mjs"), false);
  assert.equal(existsSync(archivePath), true);
  assert.equal(createHash("sha256").update(readFileSync(archivePath)).digest("hex"), expectedHash);

  const provenance = readFileSync(provenancePath, "utf8");
  assert.match(provenance, new RegExp(expectedHash));
  assert.match(provenance, /946c72c5c7785e16ded06b4dc26dbf189b194677/u);
  assert.match(provenance, /## Workflow Synchronization/u);
  assert.match(provenance, /### Replacement Owner/u);
  assert.match(provenance, /### Rollback/u);

  const activeFiles = globSync(
    ["package.json", "tools/**/*.{mjs,js,json,md,sh}", "docs/**/*.md", ".github/**/*.{yml,yaml,json,md,mjs,js,sh}"],
    { exclude: ["**/node_modules/**", "docs/vnext/phase-0a/**"] },
  ).filter((path) => path !== "tools/tests/retired-automation.test.mjs");
  const activeReferences = activeFiles.filter((path) => {
    const content = readFileSync(path, "utf8");
    return content.includes("sync:workflows") || content.includes("tools/scripts/sync-workflows.mjs");
  });
  assert.deepEqual(activeReferences, [], `active retirement references: ${activeReferences.join(", ")}`);
});

test("Terraform MCP characterization remains provenance-only retired automation", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  assert.equal(scripts["validate:terraform-mcp-characterization"], undefined);
  assert.equal(scripts["test:terraform-mcp-characterization"], undefined);
  assert.equal(existsSync("tools/scripts/validate-terraform-mcp-characterization.mjs"), false);
  assert.equal(existsSync("tools/registry/terraform-mcp-characterization.json"), false);
  assert.equal(existsSync(`${terraformArchivePath}/README.md`), true);

  const provenance = readFileSync(`${terraformArchivePath}/README.md`, "utf8");
  assert.match(provenance, /69bac4e1d6e463a72d4a16111d1163ec30589094/u);
  assert.match(provenance, /7b3dee20b2713430c7302f5cdfc7b4a19e5a73e4/u);
  assert.match(provenance, /## Replacement Owners/u);
  assert.match(provenance, /## Rollback/u);
});

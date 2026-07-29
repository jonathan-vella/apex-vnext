import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateAzureMcpPricingCharacterization } from "../scripts/validate-azure-mcp-pricing-characterization.mjs";

const registry = JSON.parse(readFileSync("tools/registry/azure-mcp-pricing-characterization.v1.json", "utf8"));
const schema = JSON.parse(
  readFileSync("tools/registry/schemas/azure-mcp-pricing-characterization.schema.json", "utf8"),
);

const mutate = (callback) => {
  const value = structuredClone(registry);
  callback(value);
  return value;
};

test("exact stable Azure MCP pricing characterization passes", () => {
  assert.deepEqual(validateAzureMcpPricingCharacterization(registry, schema), []);
});

test("artifact, tool, schema, capability, and authority drift fail closed", () => {
  for (const mutation of [
    (value) => (value.distribution.wrapper.version = "3.0.0-beta.30"),
    (value) => (value.distribution.platform.tarballSha256 = "f".repeat(64)),
    (value) => (value.startup.readOnly = false),
    (value) => value.startup.selectedTools.push("deploy_plan_get"),
    (value) => (value.inventory.evidence.pricingToolsList.sha256 = "f".repeat(64)),
    (value) => (value.inventory.evidence.readOnlyToolNames.path = "tools/registry/evidence/../package.json"),
    (value) => (value.inventory.pricingOutputSchemaPresent = true),
    (value) => value.inventory.costManagementTools.push("cost_query"),
    (value) => (value.disposition.adapterReady = true),
    (value) => (value.disposition.managedAuthority = true),
    (value) => value.disposition.blockers.pop(),
  ]) {
    assert.ok(validateAzureMcpPricingCharacterization(mutate(mutation), schema).length > 0);
  }
});

test("schema-only consumers reject fabricated authority and incomplete shapes", () => {
  assert.ok(
    validateAzureMcpPricingCharacterization(
      { ...registry, disposition: { ...registry.disposition, adapterReady: true } },
      schema,
    ).length > 0,
  );
  const incomplete = structuredClone(registry);
  delete incomplete.inventory.evidence;
  assert.ok(validateAzureMcpPricingCharacterization(incomplete, schema).length > 0);
});

test("tracked inventories prove pricing exposure, capability absence, and read-only exclusions", () => {
  const unrestricted = JSON.parse(readFileSync(registry.inventory.evidence.unrestrictedToolNames.path, "utf8"));
  const readOnly = JSON.parse(readFileSync(registry.inventory.evidence.readOnlyToolNames.path, "utf8"));
  const removed = unrestricted.filter((name) => !readOnly.includes(name));
  assert.equal(unrestricted.length, 315);
  assert.equal(readOnly.length, 175);
  assert.equal(removed.length, 140);
  assert.ok(readOnly.includes("pricing_get"));
  assert.ok(unrestricted.every((name) => !/(?:cost|billing|budget)/i.test(name)));
  assert.ok(removed.includes("compute_vm_create"));
  assert.ok(removed.includes("managedlustre_fs_blob_import_cancel"));
  assert.ok(readOnly.includes("deploy_plan_get"));
  assert.deepEqual(registry.startup.selectedTools, ["pricing_get"]);
});

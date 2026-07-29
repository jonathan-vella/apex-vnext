import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateArmMcpCostPricing } from "../scripts/validate-arm-mcp-cost-pricing.mjs";

const registry = JSON.parse(readFileSync("tools/registry/arm-mcp-cost-pricing.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/arm-mcp-cost-pricing.schema.json", "utf8"));
const mutate = (callback) => {
  const value = structuredClone(registry);
  callback(value);
  return value;
};

test("official ARM MCP endpoint and Cost Management/Pricing tools pass", () => {
  assert.deepEqual(validateArmMcpCostPricing(registry, schema), []);
});

test("Azure MCP Server product names cannot substitute for ARM MCP", () => {
  for (const mutation of [
    (value) => (value.product = "azure-mcp-server"),
    (value) => (value.endpoint = "stdio"),
    (value) => (value.toolsets.Pricing.readTools = ["pricing_get"]),
    (value) => (value.source.repository = "https://github.com/microsoft/mcp"),
  ]) {
    assert.ok(validateArmMcpCostPricing(mutate(mutation), schema).length > 0);
  }
});

test("write, operation, unknown, and premature authority drift fail closed", () => {
  for (const mutation of [
    (value) => value.managedPolicy.candidateReadAllowlist.push("create_budget"),
    (value) => value.managedPolicy.candidateReadAllowlist.push("start_pricesheet_download"),
    (value) => value.managedPolicy.denyBeforeTransport.pop(),
    (value) => (value.managedPolicy.unknownToolDisposition = "allow"),
    (value) => (value.qualification.authenticatedToolsListCaptured = true),
    (value) => (value.qualification.outputFixturesCaptured = true),
    (value) => (value.qualification.adapterReady = true),
    (value) => (value.qualification.managedAuthority = true),
  ]) {
    assert.ok(validateArmMcpCostPricing(mutate(mutation), schema).length > 0);
  }
});

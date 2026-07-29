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

test("schema-valid source metadata drift is rejected by the canonical digest", () => {
  for (const mutation of [
    (value) => (value.observedAt = "2026-07-28"),
    (value) => (value.source.sha256 = "f".repeat(64)),
  ]) {
    assert.ok(
      validateArmMcpCostPricing(mutate(mutation), schema).some((error) =>
        error.includes("canonical ARM MCP cost/pricing contract drifted"),
      ),
    );
  }
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

test("write, operation, unknown, and direct-client retirement drift fail closed", () => {
  for (const mutation of [
    (value) => value.managedPolicy.candidateReadAllowlist.push("create_budget"),
    (value) => value.managedPolicy.candidateReadAllowlist.push("start_pricesheet_download"),
    (value) => value.managedPolicy.denyBeforeTransport.pop(),
    (value) => (value.managedPolicy.unknownToolDisposition = "allow"),
    (value) => (value.qualification.authenticatedToolsListCaptured = false),
    (value) => (value.qualification.outputFixturesCaptured = false),
    (value) => (value.qualification.directClientConfigured = false),
    (value) => (value.qualification.customAdapterRequired = true),
    (value) => (value.qualification.customPricingServerRetired = false),
  ]) {
    assert.ok(validateArmMcpCostPricing(mutate(mutation), schema).length > 0);
  }
});

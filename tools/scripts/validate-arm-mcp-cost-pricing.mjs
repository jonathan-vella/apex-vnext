#!/usr/bin/env node
/** Validate the official ARM MCP Cost Management and Pricing contract. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const REGISTRY_PATH = "tools/registry/arm-mcp-cost-pricing.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/arm-mcp-cost-pricing.schema.json";
const EXPECTED_SHA256 = "f8b8a35169dd00b7beff6fe292eaffb842abe8d21a892b1e8f54aabf140c7785";
const EXPECTED_COST_READ = [
  "query_costs",
  "query_aks_costs",
  "forecast_costs",
  "list_dimensions",
  "list_budgets",
  "get_budget",
  "list_alerts",
  "list_benefit_utilization",
  "get_benefit_recommendations",
  "list_reservation_transactions",
];
const EXPECTED_PRICING_READ = ["get_retail_prices", "get_pricesheet_status"];
const EXPECTED_DENIED = ["create_budget", "create_template_deployment", "cancel_arm_template_deployment"];

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

export function validateArmMcpCostPricing(registry, schema) {
  try {
    const errors = [];
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    if (!ajv.validate(schema, registry)) {
      return (ajv.errors ?? []).map(({ instancePath, message }) => `${instancePath || "/"}: ${message}`);
    }
    const digest = createHash("sha256")
      .update(JSON.stringify(canonicalValue(registry)))
      .digest("hex");
    if (digest !== EXPECTED_SHA256) errors.push("canonical ARM MCP cost/pricing contract drifted");
    const documentedRead = [...registry.toolsets.CostManagement.readTools, ...registry.toolsets.Pricing.readTools];
    if (
      registry.product !== "azure-resource-manager-mcp" ||
      registry.endpoint !== "https://mcp.management.azure.com" ||
      registry.toolsetHeader.name !== "x-mcp-toolset" ||
      registry.toolsetHeader.value !== "CostManagement,Pricing" ||
      JSON.stringify(registry.toolsets.CostManagement.readTools) !== JSON.stringify(EXPECTED_COST_READ) ||
      JSON.stringify(registry.toolsets.CostManagement.writeTools) !== JSON.stringify(["create_budget"]) ||
      JSON.stringify(registry.toolsets.Pricing.readTools) !== JSON.stringify(EXPECTED_PRICING_READ) ||
      JSON.stringify(registry.toolsets.Pricing.operationTools) !== JSON.stringify(["start_pricesheet_download"]) ||
      registry.managedPolicy.candidateReadAllowlist.some((tool) => !documentedRead.includes(tool)) ||
      registry.managedPolicy.candidateReadAllowlist.includes("get_pricesheet_status") ||
      JSON.stringify(registry.managedPolicy.deferredTools) !==
        JSON.stringify(["start_pricesheet_download", "get_pricesheet_status"]) ||
      JSON.stringify(registry.managedPolicy.denyBeforeTransport) !== JSON.stringify(EXPECTED_DENIED) ||
      registry.managedPolicy.unknownToolDisposition !== "deny-before-transport" ||
      registry.qualification.documentationCharacterized !== true ||
      registry.qualification.authenticatedToolsListCaptured !== false ||
      registry.qualification.outputFixturesCaptured !== false ||
      registry.qualification.adapterReady !== false ||
      registry.qualification.managedAuthority !== false
    ) {
      errors.push("ARM MCP cost/pricing semantics or authority boundary drifted");
    }
    return errors.sort();
  } catch {
    return ["ARM MCP cost/pricing contract is malformed"];
  }
}

function main() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const errors = validateArmMcpCostPricing(registry, schema);
  for (const error of errors) console.error(`❌ ${REGISTRY_PATH}: ${error}`);
  if (errors.length === 0) console.log("✅ ARM MCP Cost Management and Pricing contract is valid");
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith("validate-arm-mcp-cost-pricing.mjs")) process.exitCode = main();

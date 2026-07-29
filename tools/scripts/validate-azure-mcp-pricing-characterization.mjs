#!/usr/bin/env node
/** Validate the exact stable Azure MCP pricing characterization. */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const REGISTRY_PATH = "tools/registry/azure-mcp-pricing-characterization.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/azure-mcp-pricing-characterization.schema.json";
const EXPECTED_SHA256 = "56be1c434a304dccee90115932c00cc61c7ee77c840ea4bd8285fa39512add7d";
const EVIDENCE_DIRECTORY = resolve("tools/registry/evidence");
const REQUIRED_BLOCKERS = [
  "NO_FIXED_HOST",
  "NO_OUTPUT_SCHEMA",
  "NO_COST_MANAGEMENT_TOOLS",
  "PRERELEASE_NEWER_THAN_STABLE",
];

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

export function validateAzureMcpPricingCharacterization(registry, schema) {
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
    if (digest !== EXPECTED_SHA256) errors.push("canonical characterization content drifted");

    const evidenceValues = [
      registry.inventory.evidence.pricingToolsList,
      registry.inventory.evidence.unrestrictedToolNames,
      registry.inventory.evidence.readOnlyToolNames,
    ].map((entry) => {
      const path = realpathSync(resolve(entry.path));
      const pathFromEvidence = relative(realpathSync(EVIDENCE_DIRECTORY), path);
      if (pathFromEvidence === "" || pathFromEvidence === ".." || pathFromEvidence.startsWith(`..${sep}`)) {
        throw new TypeError("EVIDENCE_PATH_INVALID");
      }
      if (!statSync(path).isFile()) throw new TypeError("EVIDENCE_NOT_FILE");
      const bytes = readFileSync(path);
      if (bytes.byteLength !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
        throw new TypeError("EVIDENCE_DIGEST_INVALID");
      }
      return JSON.parse(bytes.toString("utf8"));
    });
    const [pricingReceipt, unrestrictedNames, readOnlyNames] = evidenceValues;
    const [pricing] = pricingReceipt.tools;
    const removedByReadOnly = unrestrictedNames.filter((name) => !readOnlyNames.includes(name));
    const capabilityPattern = /(?:cost|billing|budget)/i;
    const exactPricingSchemaKeys = [
      "auth-method",
      "currency",
      "filter",
      "include-savings-plan",
      "price-type",
      "region",
      "retry-delay",
      "retry-max-delay",
      "retry-max-retries",
      "retry-mode",
      "retry-network-timeout",
      "service",
      "service-family",
      "sku",
      "tenant",
    ];
    if (
      registry.distribution.wrapper.package !== "@azure/mcp" ||
      registry.distribution.platform.package !== "@azure/mcp-linux-x64" ||
      registry.startup.transport !== "stdio" ||
      registry.startup.readOnly !== true ||
      registry.startup.dangerousOptionsEnabled !== false ||
      JSON.stringify(registry.startup.selectedTools) !== JSON.stringify(["pricing_get"]) ||
      pricingReceipt.tools.length !== 1 ||
      pricing?.name !== "pricing_get" ||
      typeof pricing.description !== "string" ||
      !pricing.description.includes("Requires at least one filter") ||
      !pricing.description.includes("Do NOT assume or pick default SKUs") ||
      JSON.stringify(Object.keys(pricing.inputSchema.properties).sort()) !== JSON.stringify(exactPricingSchemaKeys) ||
      pricing.inputSchema.additionalProperties !== false ||
      pricing.inputSchema.required.length !== 0 ||
      "outputSchema" in pricing ||
      pricing.annotations?.title !== "Get Azure Retail Pricing" ||
      pricing.annotations?.readOnlyHint !== true ||
      pricing.annotations?.destructiveHint !== false ||
      pricing.annotations?.idempotentHint !== true ||
      pricing.annotations?.openWorldHint !== false ||
      unrestrictedNames.length !== registry.inventory.unrestrictedToolCount ||
      readOnlyNames.length !== registry.inventory.readOnlyToolCount ||
      removedByReadOnly.length !== registry.inventory.excludedByReadOnlyCount ||
      new Set(unrestrictedNames).size !== unrestrictedNames.length ||
      new Set(readOnlyNames).size !== readOnlyNames.length ||
      readOnlyNames.some((name) => !unrestrictedNames.includes(name)) ||
      !unrestrictedNames.includes("pricing_get") ||
      !readOnlyNames.includes("pricing_get") ||
      unrestrictedNames.some((name) => capabilityPattern.test(name)) ||
      !removedByReadOnly.includes("compute_vm_create") ||
      !removedByReadOnly.includes("managedlustre_fs_blob_import_cancel") ||
      !readOnlyNames.includes("deploy_plan_get") ||
      registry.disposition.mode !== "characterization-only" ||
      registry.disposition.adapterReady !== false ||
      registry.disposition.managedAuthority !== false ||
      JSON.stringify(registry.disposition.blockers) !== JSON.stringify(REQUIRED_BLOCKERS)
    ) {
      errors.push("stable pricing characterization semantics drifted");
    }
    return errors.sort();
  } catch {
    return ["characterization evidence is missing, malformed, or outside its trust boundary"];
  }
}

function main() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const errors = validateAzureMcpPricingCharacterization(registry, schema);
  for (const error of errors) console.error(`❌ ${REGISTRY_PATH}: ${error}`);
  if (errors.length === 0) console.log("✅ Azure MCP pricing characterization is valid");
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith("validate-azure-mcp-pricing-characterization.mjs")) process.exitCode = main();

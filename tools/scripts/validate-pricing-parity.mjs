#!/usr/bin/env node
/** Validate the canonical ARM pricing replacement parity registry. */

import fs from "node:fs";
import { createHash } from "node:crypto";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import { PRICING_PARITY_SCENARIO_IDS } from "../../packages/contracts/dist/index.js";

const REGISTRY_PATH = "tools/registry/pricing-parity-scenarios.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/pricing-parity-scenarios.schema.json";
const EXPECTED_REGISTRY_SHA256 = "0991bfa1b7f242226f88492950f944ad53c5e28c28c705173dbbc320336ce324";
const EXPECTED = {
  "PRICING-001-retail": ["retail-lookup", "matched", "unit-price-only"],
  "PRICING-002-meter-aware": [
    "meter-aware-projection",
    "matched",
    "projected-amount-equals-unit-price-times-usage-over-unit-quantity",
  ],
  "PRICING-003-bulk": ["bulk-estimate", "matched", "total-equals-line-item-sum"],
  "PRICING-004-regional": ["regional-comparison", "matched", "comparable-meter-basis"],
  "PRICING-005-commitments": ["commitment-pricing", "matched", "commitment-term-bound"],
  "PRICING-006-negotiated": ["negotiated-pricing", "unavailable", "no-default-discount-substitution"],
  "PRICING-007-ambiguity": ["ambiguity", "ambiguous", "no-first-result-selection"],
  "PRICING-008-uncertainty": ["uncertainty", "matched", "lower-less-than-or-equal-projected-less-than-or-equal-upper"],
  "PRICING-009-throttling": ["throttling", "unavailable", "no-stale-success-after-retry-exhaustion"],
  "PRICING-010-provenance": ["provenance", "matched", "content-capture-false"],
};

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

export function validatePricingParity(registry, schema) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(schema, registry)) {
    return (ajv.errors ?? []).map(({ instancePath, message }) => `${instancePath || "/"}: ${message}`);
  }
  const registryHash = createHash("sha256")
    .update(JSON.stringify(canonicalValue(registry)))
    .digest("hex");
  if (registryHash !== EXPECTED_REGISTRY_SHA256) {
    errors.push("canonical pricing parity registry content drifted");
  }
  const ids = registry.scenarios.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(PRICING_PARITY_SCENARIO_IDS)) {
    errors.push("scenario IDs must match the canonical pricing contract order");
  }
  for (const scenario of registry.scenarios) {
    const expected = EXPECTED[scenario.id];
    if (
      expected === undefined ||
      scenario.capability !== expected[0] ||
      scenario.expectedDisposition !== expected[1] ||
      scenario.arithmeticPredicate !== expected[2]
    ) {
      errors.push(`${scenario.id}: capability, disposition, or arithmetic predicate drifted`);
    }
    if (!scenario.prohibitedFields.includes("rawPayload") || !scenario.prohibitedFields.includes("qualifiesGate")) {
      errors.push(`${scenario.id}: raw payload and gate authority must remain prohibited`);
    }
  }
  const negotiated = registry.scenarios.find(({ id }) => id === "PRICING-006-negotiated");
  if (
    !negotiated.requiredSemantics.includes("attested-price-sheet") ||
    !negotiated.prohibitedFields.includes("defaultCustomerDiscount")
  ) {
    errors.push("PRICING-006-negotiated: unattested default discounts must remain prohibited");
  }
  return errors.sort();
}

function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const errors = validatePricingParity(registry, schema);
  for (const error of errors) console.error(`❌ ${REGISTRY_PATH}: ${error}`);
  if (errors.length === 0) console.log("✅ Pricing parity scenarios are valid");
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith("validate-pricing-parity.mjs")) process.exitCode = main();

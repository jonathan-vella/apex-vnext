#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import { reportRegistryValidation, requestedReportFormat } from "./_lib/registry-validator-reporter.mjs";

const MANIFEST = "tools/registry/modernization-ownership.json";
const SCHEMA = "tools/registry/schemas/modernization-ownership.schema.json";
const DOCUMENT = "docs/vnext/MODERNIZATION-INVENTORY.md";
const CONTEXT_RECEIPT = "tools/registry/client-context-baseline-receipt.json";
const REQUIRED_BASELINES = ["ci", "context", "dependencies", "diagnostics", "drift", "hooks"];
const ARGUMENT_REQUIRED_PROOF_SCRIPTS = new Set([
  "check:h2-order",
  "profile:copilot-cli-otel",
  "profile:debug-log",
  "profile:vscode-otel",
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const CONTEXT_RECEIPT_SHA256 = "197cbc48abfebc3d01c8511557d7b852ed35b5169e8cb2fdcb747d1dc013f42a";
const CONTEXT_CLIENTS = [
  { id: "github-copilot-vscode", version: "1.130.0", extensionVersion: "0.58.0" },
  { id: "github-copilot-cli", version: "1.0.73" },
];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateContextBaselineReceipt(receipt) {
  const errors = [];
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    return [`${CONTEXT_RECEIPT}: receipt must be an object`];
  }
  const expectedKeys = [
    "schemaVersion",
    "matrixId",
    "aggregateSha256",
    "sampleCount",
    "coverageComplete",
    "optionalMetricsPolicy",
    "clients",
    "sampleIds",
    "sourceDigests",
    "requiredMetrics",
    "optionalMetrics",
  ].sort();
  const actualKeys = Object.keys(receipt).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    errors.push(`${CONTEXT_RECEIPT}: receipt has unsupported or missing fields`);
  }
  if (
    receipt.schemaVersion !== "1.0.0" ||
    receipt.matrixId !== "milestone-o-stratified-v1" ||
    receipt.sampleCount !== 12 ||
    receipt.coverageComplete !== true ||
    receipt.optionalMetricsPolicy !== "report-only" ||
    JSON.stringify(receipt.clients) !== JSON.stringify(CONTEXT_CLIENTS)
  ) {
    errors.push(`${CONTEXT_RECEIPT}: receipt does not match the approved matrix contract`);
  }
  if (!SHA256.test(receipt.aggregateSha256 ?? "")) {
    errors.push(`${CONTEXT_RECEIPT}: aggregateSha256 must be a SHA-256 digest`);
  }
  for (const name of ["sampleIds", "sourceDigests"]) {
    const values = receipt[name];
    if (
      !Array.isArray(values) ||
      values.length !== 12 ||
      new Set(values).size !== 12 ||
      values.some((value) => !SHA256.test(value)) ||
      values.some((value, index) => index > 0 && values[index - 1] >= value)
    ) {
      errors.push(`${CONTEXT_RECEIPT}: ${name} must contain 12 unique sorted SHA-256 digests`);
    }
  }
  if (
    JSON.stringify(receipt.requiredMetrics) !== JSON.stringify({ inputTokens: 12, outputTokens: 12, chatCalls: 12 })
  ) {
    errors.push(`${CONTEXT_RECEIPT}: required metric coverage is incomplete`);
  }
  if (
    JSON.stringify(receipt.optionalMetrics) !==
    JSON.stringify({ cacheReadTokens: 0, cacheWriteTokens: 6, cacheHits: 0 })
  ) {
    errors.push(`${CONTEXT_RECEIPT}: optional metric availability does not match the accepted receipt`);
  }
  const receiptDigest = createHash("sha256").update(stableJson(receipt)).digest("hex");
  if (receiptDigest !== CONTEXT_RECEIPT_SHA256) {
    errors.push(`${CONTEXT_RECEIPT}: canonical receipt digest does not match accepted evidence`);
  }
  return errors;
}

export function validateModernizationOwnership({ manifest, schema, document, scripts, receipt, glob = globSync }) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(schema, manifest)) {
    errors.push(...(ajv.errors ?? []).map((error) => `schema ${error.instancePath || "/"}: ${error.message}`));
    return errors;
  }

  const ids = manifest.surfaces.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) errors.push("surface IDs must be unique");
  const decisionIds = manifest.decisions.map(({ id }) => id);
  if (new Set(decisionIds).size !== decisionIds.length) errors.push("decision IDs must be unique");
  const baselineIds = manifest.baselines.map(({ id }) => id).sort();
  if (baselineIds.join("\0") !== REQUIRED_BASELINES.join("\0")) {
    errors.push(`baselines must contain exactly: ${REQUIRED_BASELINES.join(", ")}`);
  }
  if (manifest.baselines.find(({ id }) => id === "context")?.status === "captured") {
    errors.push(...validateContextBaselineReceipt(receipt));
  }

  for (const item of [...manifest.surfaces, ...manifest.baselines]) {
    for (const sourceRef of item.sourceRefs) {
      if (glob(sourceRef, { cwd: process.cwd(), nodir: true }).length === 0) {
        errors.push(`${item.id}: sourceRef matches no files: ${sourceRef}`);
      }
    }
  }
  for (const surface of manifest.surfaces) {
    if (surface.classification !== "keep" && !decisionIds.includes(surface.decisionRef)) {
      errors.push(`${surface.id}: ${surface.classification} requires a valid decisionRef`);
    }
    for (const command of surface.proofCommands) {
      const match = command.match(/^npm run ([^ ]+)$/);
      if (match && scripts[match[1]] === undefined) errors.push(`${surface.id}: unknown npm script: ${match[1]}`);
      if (match && ARGUMENT_REQUIRED_PROOF_SCRIPTS.has(match[1])) {
        errors.push(`${surface.id}: proof script requires an explicit target: ${match[1]}`);
      }
    }
    if (!document.includes(`\`${surface.id}\``)) errors.push(`${surface.id}: missing from ${DOCUMENT}`);
  }
  for (const decision of manifest.decisions) {
    if (!document.includes(`\`${decision.id}\``)) errors.push(`${decision.id}: missing from ${DOCUMENT}`);
  }
  return errors;
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
  const document = readFileSync(DOCUMENT, "utf8");
  const receipt = JSON.parse(readFileSync(CONTEXT_RECEIPT, "utf8"));
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  const errors = validateModernizationOwnership({ manifest, schema, document, scripts, receipt });
  process.exitCode = reportRegistryValidation({
    title: "Modernization Ownership Validator",
    source: MANIFEST,
    errors,
    passMessage: "Modernization ownership inventory is valid",
    format: requestedReportFormat(process.argv.slice(2)),
  });
}

if (process.argv[1]?.endsWith("validate-modernization-ownership.mjs")) main();

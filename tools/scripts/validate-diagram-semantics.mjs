#!/usr/bin/env node
/** Validate format-neutral diagram semantics and routing. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const REGISTRY_PATH = "tools/registry/diagram-semantics.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/diagram-semantics.schema.json";
const EXPECTED_SHA256 = "6bb464e3e48e0dc12d73539cdc20c6adf7d737e02c5b0538bbfdff250ade1ff8";
const EXPECTED_IDS = [
  "g1-three-tier-web",
  "g2-hub-spoke-landing-zone",
  "g3-event-driven-microservices",
  "g4-ml-training-pipeline",
  "g5-enterprise-landing-zone",
  "g6-hyperscale-platform",
  "g7-multi-region-active-active",
];
const EXPECTED_ROUTING = {
  inline: {
    owner: "mermaid",
    outputClasses: ["flow", "sequence", "state", "er", "compact-documentation"],
    formats: ["mmd", "markdown"],
  },
  standalone: {
    owner: "python-diagrams",
    outputClasses: ["architecture", "network", "dependency", "runtime", "as-built", "waf", "cost", "compliance"],
    formats: ["py", "png", "svg"],
  },
};
const EXPECTED_RECONCILIATIONS = {
  "g3-event-driven-microservices": [
    {
      field: "diagramType",
      legacy: "sequence",
      resolved: "runtime-flow",
      rationale: "The prompt requests a standalone runtime-flow artifact; sequence remains an inline route only.",
    },
  ],
  "g5-enterprise-landing-zone": [
    {
      field: "scope.managementGroups",
      legacy: 4,
      resolved: 6,
      rationale: "The prompt names Tenant Root, Platform, Connectivity, Identity, Landing Zones, and Sandbox.",
    },
  ],
  "g6-hyperscale-platform": [
    {
      field: "resources",
      legacy: { minimum: 50, maximum: 60 },
      resolved: { minimum: 28, maximum: 32 },
      rationale: "The prompt names 28 concrete global and per-region resources; workload-level instances may add four.",
    },
  ],
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

export function validateActiveConsumers(consumers, readText = (filePath) => readFileSync(filePath, "utf8")) {
  const errors = [];
  const ids = consumers.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) errors.push("active diagram consumer IDs are not unique");

  for (const consumer of consumers) {
    let content;
    try {
      content = readText(consumer.path);
    } catch {
      errors.push(`${consumer.id}: active consumer is missing or unreadable`);
      continue;
    }
    if (/\.drawio\b|draw\.io/i.test(content)) {
      errors.push(`${consumer.id}: active consumer references retired Draw.io output`);
    }
    for (const marker of consumer.requiredMarkers) {
      if (!content.includes(marker)) errors.push(`${consumer.id}: required marker ${marker} is missing`);
    }
  }

  return errors.sort();
}

export function validateDiagramSemantics(registry, schema) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(schema, registry)) {
    return (ajv.errors ?? []).map(({ instancePath, message }) => `${instancePath || "/"}: ${message}`);
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalValue(registry)))
    .digest("hex");
  if (digest !== EXPECTED_SHA256) errors.push("canonical diagram semantic manifest drifted");
  if (JSON.stringify(registry.routing) !== JSON.stringify(EXPECTED_ROUTING)) errors.push("diagram routing drifted");
  errors.push(...validateActiveConsumers(registry.activeConsumers));
  const ids = registry.scenarios.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_IDS) || new Set(ids).size !== ids.length) {
    errors.push("format-neutral scenario coverage drifted");
  }
  for (const scenario of registry.scenarios) {
    if (scenario.resources.minimum > scenario.resources.maximum) errors.push(`${scenario.id}: resource bounds invert`);
    const expectedReconciliations = EXPECTED_RECONCILIATIONS[scenario.id] ?? [];
    if (JSON.stringify(scenario.legacyReconciliations) !== JSON.stringify(expectedReconciliations)) {
      errors.push(`${scenario.id}: legacy reconciliation drifted`);
    }
    const nodeIds = scenario.nodes.map(({ id }) => id);
    if (new Set(nodeIds).size !== nodeIds.length) errors.push(`${scenario.id}: duplicate node IDs`);
    const edgeIds = scenario.edges.map(({ id }) => id);
    if (new Set(edgeIds).size !== edgeIds.length) errors.push(`${scenario.id}: duplicate edge IDs`);
    for (const node of scenario.nodes) {
      if (node.zone !== undefined && !scenario.zones.includes(node.zone)) {
        errors.push(`${scenario.id}: node ${node.id} references unknown zone ${node.zone}`);
      }
    }
    for (const edge of scenario.edges) {
      if (!nodeIds.includes(edge.source) || !nodeIds.includes(edge.target)) {
        errors.push(`${scenario.id}: edge ${edge.id} references an unknown node`);
      }
    }
    for (const label of scenario.edgeLabels) {
      if (!scenario.edges.some((edge) => edge.label.split("/").some((part) => part.trim() === label))) {
        errors.push(`${scenario.id}: required edge label ${label} has no semantic edge`);
      }
    }
    if (
      scenario.dimensions.minimumWidth > scenario.dimensions.maximumWidth ||
      scenario.dimensions.minimumHeight > scenario.dimensions.maximumHeight
    ) {
      errors.push(`${scenario.id}: dimension bounds invert`);
    }
    const route = registry.routing.inline.outputClasses.includes(scenario.outputClass)
      ? registry.routing.inline
      : registry.routing.standalone.outputClasses.includes(scenario.outputClass)
        ? registry.routing.standalone
        : null;
    if (route === null) errors.push(`${scenario.id}: output class has no active route`);
  }
  return errors.sort();
}

function main() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const errors = validateDiagramSemantics(registry, schema);
  for (const error of errors) console.error(`❌ ${REGISTRY_PATH}: ${error}`);
  if (errors.length === 0) console.log("✅ Format-neutral diagram semantics are valid");
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith("validate-diagram-semantics.mjs")) process.exitCode = main();

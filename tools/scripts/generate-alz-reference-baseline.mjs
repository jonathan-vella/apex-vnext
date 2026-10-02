import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ALZ_RELEASE_TAG = "platform/alz/2026.08.1";
export const ALZ_COMMIT_SHA = "46fa8a20b89f63a3274c4813f9284782012b4ebe";

const REPOSITORY = "Azure/Azure-Landing-Zones-Library";
const PLATFORM = "alz";
const ARCHETYPES = ["root", "landing_zones", "corp"];
const MANAGEMENT_GROUP_IDS = {
  root: "alz",
  landing_zones: "landingzones",
  corp: "corp",
};
const ARM_API_VERSION = "2023-04-01";
const BUILTINS_RESOLVED_VIA = "arm-api-2023-04-01";
const RAW_BASE = `https://raw.githubusercontent.com/${REPOSITORY}/${ALZ_COMMIT_SHA}/platform/${PLATFORM}`;
const GITHUB_API_BASE = `https://api.github.com/repos/${REPOSITORY}/contents/platform/${PLATFORM}`;
const OUTPUT_RELATIVE_PATH = path.join("config", "governance-reference.v1.json");
const EFFECTS = new Set(["deny", "audit", "auditIfNotExists", "append", "modify", "deployIfNotExists", "disabled"]);
const AUTO_REMEDIATE_EFFECTS = new Set(["modify", "deployIfNotExists"]);
const TOP_LEVEL_ALIASES = ["location", "tags", "sku.name", "identity.type", "kind"];
const SKIPPED_SUMMARY = new Map();
const PRINT_WIDTH = 120;

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function noteSkipped(reason) {
  SKIPPED_SUMMARY.set(reason, (SKIPPED_SUMMARY.get(reason) ?? 0) + 1);
}

function indent(level) {
  return "  ".repeat(level);
}

function formatJson(value, level = 0, prefixLength = indent(level).length) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((entry) => formatJson(entry, level + 1, indent(level + 1).length));
    const inline = `[${items.join(", ")}]`;
    if (!inline.includes("\n") && prefixLength + inline.length <= PRINT_WIDTH) return inline;
    return `[\n${items
      .map((entry, index) => `${indent(level + 1)}${entry}${index === items.length - 1 ? "" : ","}`)
      .join("\n")}\n${indent(level)}]`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(([key, entryValue], index) => {
      const prefix = `${indent(level + 1)}${JSON.stringify(key)}: `;
      const formatted = formatJson(entryValue, level + 1, prefix.length);
      return `${prefix}${formatted}${index === entries.length - 1 ? "" : ","}`;
    })
    .join("\n")}\n${indent(level)}}`;
}

function stableJson(value) {
  return `${formatJson(value)}\n`;
}

function getProperty(object, key) {
  return object && typeof object === "object" ? object[key] : undefined;
}

function getParameterValue(parameters, name) {
  const entry = getProperty(parameters, name);
  if (entry && typeof entry === "object" && Object.hasOwn(entry, "value")) return entry.value;
  return entry;
}

function assignmentParameterValues(assignment, alzDefaultValues) {
  const values = {};
  const parameters = assignment?.properties?.parameters ?? {};
  for (const name of Object.keys(parameters)) values[name] = getParameterValue(parameters, name);
  const assignmentName = assignment.name;
  for (const [name, defaultName] of Object.entries(alzDefaultValues.get(assignmentName) ?? {})) {
    if (!Object.hasOwn(values, name)) values[name] = `\${${defaultName}}`;
  }
  return values;
}

function buildAlzDefaultParameterMap(defaultsDocument) {
  const byAssignment = new Map();
  for (const defaultEntry of defaultsDocument?.defaults ?? []) {
    for (const assignment of defaultEntry.policy_assignments ?? []) {
      const current = byAssignment.get(assignment.policy_assignment_name) ?? {};
      for (const parameterName of assignment.parameter_names ?? []) current[parameterName] = defaultEntry.default_name;
      byAssignment.set(assignment.policy_assignment_name, current);
    }
  }
  return byAssignment;
}

function parseParameterReference(value) {
  if (typeof value !== "string") return undefined;
  const match = /^\[parameters\('([^']+)'\)\]$/iu.exec(value.trim());
  return match?.[1];
}

function normalizeEffect(effect) {
  if (typeof effect !== "string") return undefined;
  const compact = effect.trim();
  const lower = compact.toLowerCase();
  const mapped = {
    append: "append",
    audit: "audit",
    auditifnotexists: "auditIfNotExists",
    deny: "deny",
    denyaction: "deny",
    deployifnotexists: "deployIfNotExists",
    disabled: "disabled",
    manual: "audit",
    modify: "modify",
  }[lower];
  return mapped && EFFECTS.has(mapped) ? mapped : undefined;
}

function firstOwn(object, ...keys) {
  for (const key of keys) {
    if (object && typeof object === "object" && Object.hasOwn(object, key)) return object[key];
  }
  return undefined;
}

function valueFromParameterDefinition(definition, parameterName) {
  const parameter = definition?.properties?.parameters?.[parameterName];
  if (parameter && typeof parameter === "object" && Object.hasOwn(parameter, "defaultValue"))
    return parameter.defaultValue;
  return undefined;
}

function resolveSetParameterValue(parameterName, context) {
  const assigned = firstOwn(context.assignmentParameters, parameterName);
  if (assigned !== undefined) return assigned;
  return valueFromParameterDefinition(context.policySetDefinition, parameterName);
}

function resolvePolicyParameterValue(parameterName, context) {
  const memberValue = getParameterValue(context.memberParameters, parameterName);
  if (memberValue !== undefined) {
    const referencedSetParameter = parseParameterReference(memberValue);
    if (referencedSetParameter) {
      const setValue = resolveSetParameterValue(referencedSetParameter, context);
      if (setValue !== undefined) return setValue;
    }
    return memberValue;
  }

  const assigned = firstOwn(context.assignmentParameters, parameterName);
  if (assigned !== undefined) return assigned;

  if (context.policySetDefinition) {
    const setDefault = valueFromParameterDefinition(context.policySetDefinition, parameterName);
    if (setDefault !== undefined) return setDefault;
  }

  return valueFromParameterDefinition(context.policyDefinition, parameterName);
}

function effectOverrideForMember(overrides, memberReferenceId) {
  for (const override of overrides ?? []) {
    if (override?.kind !== "policyEffect" && override?.kind !== "PolicyEffect") continue;
    const selectors = override.selectors ?? [];
    if (selectors.length === 0) return override.value;
    const applies = selectors.some((selector) => {
      if (!Array.isArray(selector?.in)) return false;
      const kind = String(selector.kind ?? "").toLowerCase();
      return kind === "policydefinitionreferenceid" && selector.in.includes(memberReferenceId);
    });
    if (applies) return override.value;
  }
  return undefined;
}

export function resolveEffectiveEffect(policyDefinition, context = {}) {
  const override = effectOverrideForMember(
    context.assignment?.properties?.overrides,
    context.policyDefinitionReferenceId,
  );
  const rawEffect = override ?? policyDefinition?.properties?.policyRule?.then?.effect;
  const referencedParameter = parseParameterReference(rawEffect);
  const resolved = referencedParameter ? resolvePolicyParameterValue(referencedParameter, context) : rawEffect;
  return {
    effect: normalizeEffect(resolved),
    rawEffect: resolved,
    override: override === undefined ? null : override,
  };
}

function visitPolicyCondition(condition, visitor) {
  if (!condition || typeof condition !== "object") return;
  visitor(condition);
  for (const key of ["allOf", "anyOf"]) {
    const branches = condition[key];
    if (Array.isArray(branches)) {
      for (const branch of branches) visitPolicyCondition(branch, visitor);
    }
  }
}

function looksLikeResourceType(value) {
  return /^[A-Za-z][\w.-]+(?:\/[A-Za-z0-9_.-]+)+$/u.test(value) && !value.endsWith("/");
}

export function extractResourceTypes(policyRuleOrCondition) {
  const condition = policyRuleOrCondition?.if ?? policyRuleOrCondition;
  const seen = new Set();
  const result = [];
  const add = (value) => {
    if (typeof value !== "string") return;
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  };

  visitPolicyCondition(condition, (node) => {
    if (typeof node.field !== "string" || node.field.toLowerCase() !== "type") return;
    if (typeof node.equals === "string") add(node.equals);
    if (Array.isArray(node.in)) {
      for (const entry of node.in) if (typeof entry === "string") add(entry);
    }
    if (typeof node.like === "string") {
      const prefix = node.like.split("*")[0];
      if (looksLikeResourceType(prefix)) add(prefix);
    }
  });

  return result.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
}

function firstAliasField(condition, resourceTypes) {
  const fields = [];
  visitPolicyCondition(condition, (node) => {
    if (typeof node.field === "string") fields.push(node.field);
  });
  return fields.find((field) => aliasToPropertyPath(field, resourceTypes));
}

function aliasSuffix(field, resourceTypes) {
  if (typeof field !== "string" || !field.startsWith("Microsoft.")) return undefined;
  const byLength = [...resourceTypes].sort((left, right) => right.length - left.length);
  for (const resourceType of byLength) {
    if (field.toLowerCase().startsWith(`${resourceType.toLowerCase()}/`)) return field.slice(resourceType.length + 1);
  }
  const parts = field.split("/");
  if (parts.length >= 3 && /^Microsoft\./u.test(parts[0])) return parts.slice(2).join("/");
  return undefined;
}

function aliasToPropertyPath(field, resourceTypes) {
  const suffix = aliasSuffix(field, resourceTypes);
  if (!suffix || suffix.includes("/")) return undefined;
  if (
    TOP_LEVEL_ALIASES.some(
      (topLevel) => suffix === topLevel || suffix.startsWith(`${topLevel}.`) || suffix.startsWith(`${topLevel}[`),
    )
  ) {
    return suffix;
  }
  if (suffix.startsWith("properties.")) return suffix;
  return `properties.${suffix}`;
}

function derivePropertyPaths(policyDefinition, effect, resourceTypes) {
  if (effect !== "deny" && effect !== "modify") return {};
  const rule = policyDefinition?.properties?.policyRule;
  const fields = [];
  if (effect === "modify") {
    for (const operation of rule?.then?.details?.operations ?? []) {
      if (typeof operation?.field === "string") fields.push(operation.field);
    }
  }
  const ifField = firstAliasField(rule?.if, resourceTypes);
  if (ifField) fields.push(ifField);
  for (const field of fields) {
    const propertyPath = aliasToPropertyPath(field, resourceTypes);
    if (propertyPath) return { azurePropertyPath: propertyPath, bicepPropertyPath: propertyPath };
  }
  return {};
}

function deriveRequiredValue(policyDefinition) {
  const details = policyDefinition?.properties?.policyRule?.then?.details;
  if (!details || typeof details !== "object") return null;
  if (Object.hasOwn(details, "value")) return details.value;
  let requiredValue = null;
  visitPolicyCondition(details.existenceCondition, (node) => {
    if (requiredValue !== null) return;
    if (Object.hasOwn(node, "equals")) requiredValue = node.equals;
    else if (Object.hasOwn(node, "in")) requiredValue = node.in;
  });
  return requiredValue;
}

function classificationForEffect(effect) {
  if (effect === "deny") return "blocker";
  if (AUTO_REMEDIATE_EFFECTS.has(effect)) return "auto-remediate";
  return "informational";
}

function parseDefinitionName(id, segment) {
  const match = new RegExp(`/providers/Microsoft\\.Authorization/${segment}/([^/?#\\s]+)$`, "iu").exec(id);
  if (!match) throw new Error(`Unsupported policy definition id: ${id}`);
  return decodeURIComponent(match[1]);
}

function isBuiltInDefinition(id, segment) {
  return new RegExp(`^/providers/Microsoft\\.Authorization/${segment}/[^/?#\\s]+$`, "iu").test(id);
}

function customPolicyId(name) {
  return `/providers/Microsoft.Management/managementGroups/alz/providers/Microsoft.Authorization/policyDefinitions/${name}`;
}

function customPolicySetId(name) {
  return `/providers/Microsoft.Management/managementGroups/alz/providers/Microsoft.Authorization/policySetDefinitions/${name}`;
}

function assertSafeAssignmentName(name) {
  if (!/^[^/?#%\s]+$/u.test(name)) throw new Error(`Policy assignment name is not safe for assignment_id: ${name}`);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

function libraryUrl(relativePath) {
  return `${RAW_BASE}/${relativePath}`;
}

async function fetchLibraryJson(relativePath) {
  return fetchJson(libraryUrl(relativePath));
}

async function fetchLibraryDirectory(relativePath) {
  return fetchJson(`${GITHUB_API_BASE}/${relativePath}?ref=${ALZ_COMMIT_SHA}`);
}

async function requireAzLogin() {
  try {
    await execFileAsync("az", ["account", "show", "--output", "none"], { timeout: 30_000 });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Azure CLI 'az' is required to resolve built-in policy definitions from ARM.", { cause: error });
    }
    throw new Error(
      `Azure CLI account check failed. Run 'az login' before generating the ALZ reference baseline. ${error.stderr ?? error.message}`,
      { cause: error },
    );
  }
}

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= limit || queue.length === 0) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    task()
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
}

const armLimiter = createLimiter(6);

async function azRestGet(url) {
  return armLimiter(async () => {
    let stdout;
    try {
      ({ stdout } = await execFileAsync(
        "az",
        ["rest", "--method", "get", "--url", url, "--output", "json", "--only-show-errors"],
        {
          timeout: 90_000,
          maxBuffer: 20 * 1024 * 1024,
        },
      ));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("Azure CLI 'az' is required to resolve built-in policy definitions from ARM.", {
          cause: error,
        });
      }
      throw new Error(`az rest GET failed for ${url}: ${error.stderr ?? error.message}`, { cause: error });
    }
    return JSON.parse(stdout);
  });
}

class DefinitionResolver {
  constructor() {
    this.policyDefinitions = new Map();
    this.policySetDefinitions = new Map();
    this.libraryIndexes = new Map();
  }

  async policyDefinition(id) {
    const key = id.toLowerCase();
    if (!this.policyDefinitions.has(key)) {
      this.policyDefinitions.set(key, this.#loadPolicyDefinition(id));
    }
    return this.policyDefinitions.get(key);
  }

  async policySetDefinition(id) {
    const key = id.toLowerCase();
    if (!this.policySetDefinitions.has(key)) {
      this.policySetDefinitions.set(key, this.#loadPolicySetDefinition(id));
    }
    return this.policySetDefinitions.get(key);
  }

  async #loadPolicyDefinition(id) {
    const name = parseDefinitionName(id, "policyDefinitions");
    if (isBuiltInDefinition(id, "policyDefinitions")) {
      return azRestGet(
        `https://management.azure.com/providers/Microsoft.Authorization/policyDefinitions/${encodeURIComponent(name)}?api-version=${ARM_API_VERSION}`,
      );
    }
    const definition = await fetchLibraryJson(
      await this.#libraryDefinitionPath("policy_definitions", name, "policy_definition"),
    );
    return { ...definition, id: customPolicyId(name), name };
  }

  async #loadPolicySetDefinition(id) {
    const name = parseDefinitionName(id, "policySetDefinitions");
    if (isBuiltInDefinition(id, "policySetDefinitions")) {
      return azRestGet(
        `https://management.azure.com/providers/Microsoft.Authorization/policySetDefinitions/${encodeURIComponent(name)}?api-version=${ARM_API_VERSION}`,
      );
    }
    const definition = await fetchLibraryJson(
      await this.#libraryDefinitionPath("policy_set_definitions", name, "policy_set_definition"),
    );
    return { ...definition, id: customPolicySetId(name), name };
  }

  async #libraryDefinitionPath(directory, name, kind) {
    const exact = `${directory}/${name}.alz_${kind}.json`;
    try {
      await fetchLibraryJson(exact);
      return exact;
    } catch (error) {
      if (!String(error.message).includes(" 404")) throw error;
    }

    if (!this.libraryIndexes.has(directory)) this.libraryIndexes.set(directory, fetchLibraryDirectory(directory));
    const entries = await this.libraryIndexes.get(directory);
    const suffix = `.alz_${kind}.json`;
    const candidates = entries
      .map((entry) => entry.name)
      .filter((fileName) => fileName.startsWith(`${name}.`) && fileName.endsWith(suffix))
      .sort((left, right) => left.localeCompare(right));
    if (candidates.length === 0) throw new Error(`No ALZ library ${kind} file found for ${name}.`);
    return `${directory}/${candidates[0]}`;
  }
}

async function buildFinding({
  archetype,
  assignment,
  policyDefinition,
  policySetDefinition,
  member,
  assignmentParameters,
}) {
  const scope = `/providers/Microsoft.Management/managementGroups/${MANAGEMENT_GROUP_IDS[archetype]}`;
  const assignmentName = assignment.name;
  assertSafeAssignmentName(assignmentName);
  const memberParameters = member?.parameters ?? assignment.properties?.parameters ?? {};
  const policyDefinitionReferenceId = member?.policyDefinitionReferenceId;
  const context = {
    assignment,
    assignmentParameters,
    memberParameters,
    policyDefinition,
    policyDefinitionReferenceId,
    policySetDefinition,
  };
  const { effect, rawEffect, override } = resolveEffectiveEffect(policyDefinition, context);
  if (!effect) {
    noteSkipped(`unsupported-effect:${String(rawEffect)}`);
    return undefined;
  }
  const resourceTypes = extractResourceTypes(policyDefinition.properties?.policyRule ?? {});
  const propertyPaths = derivePropertyPaths(policyDefinition, effect, resourceTypes);
  const finding = {
    policy_id: policyDefinition.id,
    display_name: policyDefinition.properties?.displayName ?? policyDefinition.name ?? policyDefinition.id,
    effect,
    enforcementMode: assignment.properties?.enforcementMode ?? "Default",
    scope,
    assignment_display_name: assignment.properties?.displayName ?? assignmentName,
    assignment_id: `${scope}/providers/Microsoft.Authorization/policyAssignments/${assignmentName}`,
    classification: classificationForEffect(effect),
    category: policyDefinition.properties?.metadata?.category ?? null,
    resource_types: resourceTypes,
    required_value: deriveRequiredValue(policyDefinition),
    ...propertyPaths,
    exemption: null,
    override,
    ...(policyDefinitionReferenceId ? { policyDefinitionReferenceId } : {}),
    reported_exemptions: [],
  };
  return finding;
}

async function processAssignment(archetype, assignment, alzDefaultValues, resolver) {
  const assignmentParameters = assignmentParameterValues(assignment, alzDefaultValues);
  const policyDefinitionId = assignment.properties?.policyDefinitionId;
  if (typeof policyDefinitionId !== "string")
    throw new Error(`Policy assignment ${assignment.name} has no policyDefinitionId.`);
  const isSet = /\/policySetDefinitions\//iu.test(policyDefinitionId);
  if (!isSet) {
    const policyDefinition = await resolver.policyDefinition(policyDefinitionId);
    const finding = await buildFinding({ archetype, assignment, policyDefinition, assignmentParameters });
    return finding ? [finding] : [];
  }

  const policySetDefinition = await resolver.policySetDefinition(policyDefinitionId);
  const members = policySetDefinition.properties?.policyDefinitions ?? [];
  const findings = await Promise.all(
    members.map(async (member) => {
      const policyDefinition = await resolver.policyDefinition(member.policyDefinitionId);
      return buildFinding({
        archetype,
        assignment,
        policyDefinition,
        policySetDefinition,
        member,
        assignmentParameters,
      });
    }),
  );
  return findings.filter(Boolean);
}

function sortFindings(findings) {
  return findings.sort((left, right) => {
    const assignment = left.assignment_id.localeCompare(right.assignment_id);
    if (assignment !== 0) return assignment;
    const reference = (left.policyDefinitionReferenceId ?? "").localeCompare(right.policyDefinitionReferenceId ?? "");
    if (reference !== 0) return reference;
    return left.policy_id.localeCompare(right.policy_id);
  });
}

function summarize(assignments, policies) {
  return {
    assignments,
    policies: policies.length,
    blocker: policies.filter((policy) => policy.classification === "blocker").length,
    auto_remediate: policies.filter((policy) => policy.classification === "auto-remediate").length,
    informational: policies.filter((policy) => policy.classification === "informational").length,
    skipped: [...SKIPPED_SUMMARY.values()].reduce((sum, count) => sum + count, 0),
  };
}

export async function generateBaseline() {
  SKIPPED_SUMMARY.clear();
  await requireAzLogin();
  const [archetypeDefinitions, defaultsDocument] = await Promise.all([
    Promise.all(
      ARCHETYPES.map((archetype) =>
        fetchLibraryJson(`archetype_definitions/${archetype}.alz_archetype_definition.json`),
      ),
    ),
    fetchLibraryJson("alz_policy_default_values.json"),
  ]);
  const alzDefaultValues = buildAlzDefaultParameterMap(defaultsDocument);
  const assignmentRecords = (
    await Promise.all(
      archetypeDefinitions.flatMap((definition) =>
        definition.policy_assignments.map(async (assignmentName) => ({
          archetype: definition.name,
          assignment: await fetchLibraryJson(`policy_assignments/${assignmentName}.alz_policy_assignment.json`),
        })),
      ),
    )
  ).sort((left, right) =>
    `${left.archetype}/${left.assignment.name}`.localeCompare(`${right.archetype}/${right.assignment.name}`),
  );

  const resolver = new DefinitionResolver();
  const policies = sortFindings(
    (
      await Promise.all(
        assignmentRecords.map(({ archetype, assignment }) =>
          processAssignment(archetype, assignment, alzDefaultValues, resolver),
        ),
      )
    ).flat(),
  );

  return {
    schema_version: "governance-reference-v1",
    source: "alz-corp-reference",
    library: {
      repository: REPOSITORY,
      platform: PLATFORM,
      release: ALZ_RELEASE_TAG,
      commit: ALZ_COMMIT_SHA,
      archetypes: ARCHETYPES,
    },
    builtins_resolved_via: BUILTINS_RESOLVED_VIA,
    summary: summarize(assignmentRecords.length, policies),
    tags_required: [],
    allowed_locations: [],
    policies,
  };
}

async function main() {
  const check = process.argv.includes("--check");
  const outputPath = path.join(repoRoot(), OUTPUT_RELATIVE_PATH);
  const baseline = await generateBaseline();
  const content = stableJson(baseline);

  if (check) {
    const current = await readFile(outputPath, "utf8");
    if (current !== content) {
      console.error(`${OUTPUT_RELATIVE_PATH} is out of date. Run npm run generate:alz-reference.`);
      process.exitCode = 1;
      return;
    }
  } else {
    await writeFile(outputPath, content, "utf8");
  }

  const emptyEnforcingResourceTypes = baseline.policies.filter(
    (policy) => ["deny", "modify", "deployIfNotExists"].includes(policy.effect) && policy.resource_types.length === 0,
  ).length;
  console.log(
    `ALZ reference ${baseline.library.release}@${baseline.library.commit}: assignments=${baseline.summary.assignments}, policies=${baseline.summary.policies}, blocker=${baseline.summary.blocker}, auto_remediate=${baseline.summary.auto_remediate}, informational=${baseline.summary.informational}, skipped=${baseline.summary.skipped}, empty_enforcing_resource_types=${emptyEnforcingResourceTypes}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

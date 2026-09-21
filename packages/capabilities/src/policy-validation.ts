import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  POLICY_VALIDATION_LIMITS,
  PolicyPropertyMapV1Schema,
  assertPolicyValidationJson,
  calculatePolicyValidationDigest,
  calculatePolicyValidationHash,
  type IacTool,
  type PolicyPropertyMapV1,
  type PolicyValidationResultV1,
  type PolicyValidationV1,
} from "@apexops/contracts";
import { parseJsonProcessOutput } from "./iac-normalizers.js";

export interface PolicyResourceBinding {
  readonly physicalId?: string;
  readonly codeSymbol?: string;
  readonly terraformAddress?: string;
}

export interface PolicyValidationInput {
  readonly track: IacTool;
  readonly sourceHash: string;
  readonly policyMapHash: string;
  readonly policyMap: PolicyPropertyMapV1;
  readonly logicalResourceManifest: Readonly<Record<string, PolicyResourceBinding>>;
  readonly json: string;
}

interface Resource {
  readonly physicalId?: string;
  readonly codeSymbol?: string;
  readonly value: Record<string, unknown>;
  readonly unknown?: unknown;
  readonly unsupported: boolean;
}

type Observation = Pick<PolicyValidationResultV1, "outcome" | "reason" | "observedValueDigest">;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function own(value: unknown, key: string): unknown {
  const record = object(value);
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function expression(value: unknown, track: IacTool): boolean {
  if (typeof value === "string") return track === "bicep" ? value.trimStart().startsWith("[") : /\$\{|%\{/.test(value);
  if (Array.isArray(value)) return value.some((child) => expression(child, track));
  return (
    object(value) !== undefined &&
    Object.values(value as Record<string, unknown>).some((child) => expression(child, track))
  );
}

function hasUnknown(value: unknown): boolean {
  if (value === true) return true;
  if (Array.isArray(value)) return value.some(hasUnknown);
  return object(value) !== undefined && Object.values(value as Record<string, unknown>).some(hasUnknown);
}

function validUnknownMask(value: unknown, after: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (Array.isArray(value))
    return (
      Array.isArray(after) &&
      value.length === after.length &&
      value.every((child, index) => validUnknownMask(child, after[index]))
    );
  return (
    object(value) !== undefined &&
    object(after) !== undefined &&
    Object.entries(value as Record<string, unknown>).every(
      ([key, child]) => Object.hasOwn(after as object, key) && validUnknownMask(child, own(after, key)),
    )
  );
}

function matchingKnownValues(planned: unknown, after: unknown, unknown: unknown): boolean {
  if (unknown === true) return true;
  if (Array.isArray(planned) && Array.isArray(after)) {
    return (
      planned.length === after.length &&
      planned.every((value, index) =>
        matchingKnownValues(value, after[index], Array.isArray(unknown) ? unknown[index] : undefined),
      )
    );
  }
  const plannedObject = object(planned);
  const afterObject = object(after);
  if (plannedObject !== undefined && afterObject !== undefined) {
    return [...new Set([...Object.keys(plannedObject), ...Object.keys(afterObject)])].every((key) =>
      matchingKnownValues(own(plannedObject, key), own(afterObject, key), own(unknown, key)),
    );
  }
  return planned === after;
}

function resourcesFromJson(json: string, track: IacTool): readonly Resource[] {
  if (Buffer.byteLength(json, "utf8") > POLICY_VALIDATION_LIMITS.bytes)
    throw new TypeError("POLICY_VALIDATION_LIMIT_EXCEEDED");
  const parsed = parseJsonProcessOutput(track === "bicep" ? "azure-what-if" : "terraform-plan", json);
  assertPolicyValidationJson(parsed);
  const root = object(parsed);
  if (root === undefined) throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
  const resources: Resource[] = [];
  if (track === "bicep") {
    const visit = (
      value: unknown,
      inheritedUnsupported = false,
      parentSymbols: readonly string[] | null = [],
    ): void => {
      const entries = Array.isArray(value)
        ? value.map((entry) => [undefined, entry] as const)
        : object(value) !== undefined
          ? Object.entries(value as Record<string, unknown>)
          : undefined;
      if (entries === undefined) throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
      for (const [symbol, entry] of entries) {
        const resource = object(entry);
        if (resource === undefined) throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
        const unsupported =
          inheritedUnsupported ||
          Object.hasOwn(resource, "copy") ||
          (Object.hasOwn(resource, "condition") && resource.condition !== true) ||
          resource.existing === true;
        const physicalId = text(own(resource, "id"));
        const symbols = parentSymbols !== null && symbol !== undefined ? [...parentSymbols, symbol] : null;
        resources.push({
          value: resource,
          unsupported,
          ...(physicalId === undefined ? {} : { physicalId }),
          ...(symbols === null ? {} : { codeSymbol: symbols.join("::") }),
        });
        if (Object.hasOwn(resource, "resources")) visit(resource.resources, unsupported, symbols);
        if (text(resource.type)?.toLowerCase() === "microsoft.resources/deployments") {
          const properties = object(resource.properties);
          if (properties !== undefined && Object.hasOwn(properties, "template")) {
            const template = object(properties.template);
            if (template === undefined) throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
            visit(template.resources, unsupported || Object.hasOwn(properties, "templateLink"), symbols);
          }
        }
      }
    };
    visit(root.resources);
  } else {
    if (
      root.errored === true ||
      root.complete === false ||
      (root.deferred_changes !== undefined &&
        (!Array.isArray(root.deferred_changes) || root.deferred_changes.length > 0))
    ) {
      throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
    }
    if (root.resource_changes !== undefined && !Array.isArray(root.resource_changes))
      throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
    const changes = (root.resource_changes ?? []) as unknown[];
    const visit = (value: unknown): void => {
      const module = object(value);
      if (
        module === undefined ||
        (module.resources !== undefined && !Array.isArray(module.resources)) ||
        (module.child_modules !== undefined && !Array.isArray(module.child_modules))
      )
        throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
      for (const entry of (module.resources ?? []) as unknown[]) {
        const resource = object(entry);
        const address = text(own(resource, "address"));
        const values = object(own(resource, "values"));
        if (resource === undefined || address === undefined || values === undefined)
          throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
        const matchingChanges = changes.filter((change) => own(change, "address") === address);
        const change = own(matchingChanges[0], "change");
        const unknown = own(change, "after_unknown");
        const actions = own(change, "actions");
        const after = object(own(change, "after"));
        const physicalId = text(own(values, "id"));
        resources.push({
          codeSymbol: address,
          ...(physicalId === undefined ? {} : { physicalId }),
          value: values,
          unknown,
          unsupported:
            resource.mode !== "managed" ||
            matchingChanges.length !== 1 ||
            own(matchingChanges[0], "mode") !== "managed" ||
            !Array.isArray(actions) ||
            !["create", "update", "no-op", "create,delete", "delete,create"].includes(actions.join(",")) ||
            !actions.every((action) => typeof action === "string" && !action.includes(",")) ||
            !validUnknownMask(unknown, after) ||
            after === undefined ||
            !matchingKnownValues(values, after, unknown),
        });
      }
      for (const child of (module.child_modules ?? []) as unknown[]) visit(child);
    };
    visit(own(root.planned_values, "root_module"));
  }
  return resources;
}

function observe(
  mapping: PolicyPropertyMapV1["mappings"][number],
  request: PolicyValidationInput,
  resources: readonly Resource[] | undefined,
): Observation {
  if (mapping.disposition === "blocked") return { outcome: "fail", reason: "blocked" };
  if (mapping.disposition === "exempt") return { outcome: "unsupported", reason: "unverified-exemption" };
  if (mapping.effect === "disabled") return { outcome: "unsupported", reason: "unsupported-effect" };
  if (!Object.hasOwn(mapping, "expectedValue")) return { outcome: "unsupported", reason: "missing-expected-value" };
  const segments = mapping.propertyPath.split(".");
  if (
    !/^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(mapping.propertyPath) ||
    segments.some((segment) => ["__proto__", "prototype", "constructor"].includes(segment))
  ) {
    return { outcome: "unsupported", reason: "unsupported-path" };
  }
  if (expression(mapping.expectedValue, request.track))
    return { outcome: "unsupported", reason: "unsupported-expression" };
  const binding = object(own(request.logicalResourceManifest, mapping.logicalResourceId));
  if (binding === undefined) return { outcome: "unsupported", reason: "resource-not-bound" };
  if (resources === undefined) return { outcome: "unsupported", reason: "invalid-source" };
  const physicalId = text(own(binding, "physicalId"));
  if (Object.hasOwn(binding, "physicalId") && physicalId === undefined)
    return { outcome: "unsupported", reason: "unsupported-resource" };
  const codeSymbol =
    request.track === "terraform"
      ? (text(own(binding, "terraformAddress")) ?? text(own(binding, "codeSymbol")))
      : text(own(binding, "codeSymbol"));
  if (codeSymbol === undefined && (request.track === "terraform" || physicalId === undefined)) {
    return { outcome: "unsupported", reason: "resource-not-bound" };
  }
  const matches = resources.filter((resource) =>
    request.track === "terraform"
      ? resource.codeSymbol === codeSymbol
      : (physicalId !== undefined && resource.physicalId === physicalId) ||
        (codeSymbol !== undefined && resource.codeSymbol === codeSymbol),
  );
  if (matches.length === 0) return { outcome: "unsupported", reason: "resource-not-found" };
  if (matches.length !== 1) return { outcome: "unsupported", reason: "ambiguous-resource" };
  const resource = matches[0]!;
  if (resource.unsupported || (physicalId !== undefined && physicalId !== resource.physicalId)) {
    return { outcome: "unsupported", reason: "unsupported-resource" };
  }
  let observed: unknown = resource.value;
  let unknown: unknown = resource.unknown;
  for (const segment of segments) {
    if (unknown === true || (typeof observed === "string" && expression(observed, request.track))) {
      return { outcome: "unsupported", reason: "unsupported-expression" };
    }
    observed = own(observed, segment);
    unknown = own(unknown, segment);
  }
  if (hasUnknown(unknown) || expression(observed, request.track))
    return { outcome: "unsupported", reason: "unsupported-expression" };
  if (observed === undefined) return { outcome: "fail", reason: "missing-property" };
  const observedValueDigest = calculatePolicyValidationDigest(observed);
  const matched = observedValueDigest === calculatePolicyValidationDigest(mapping.expectedValue);
  return { outcome: matched ? "pass" : "fail", reason: matched ? "matched" : "value-mismatch", observedValueDigest };
}

export function validatePolicyProperties(request: PolicyValidationInput): PolicyValidationV1 {
  assertPolicyValidationJson(request.policyMap);
  assertPolicyValidationJson(request.logicalResourceManifest);
  if (
    Array.isArray(request.policyMap?.mappings) &&
    request.policyMap.mappings.length > POLICY_VALIDATION_LIMITS.mappings
  )
    throw new TypeError("POLICY_VALIDATION_LIMIT_EXCEEDED");
  if (
    !Value.Check(PolicyPropertyMapV1Schema, request.policyMap) ||
    !/^[0-9a-f]{64}$/.test(request.sourceHash) ||
    !/^[0-9a-f]{64}$/.test(request.policyMapHash) ||
    !["bicep", "terraform"].includes(request.track) ||
    typeof request.json !== "string" ||
    object(request.logicalResourceManifest) === undefined
  ) {
    throw new TypeError("POLICY_VALIDATION_INVALID_INPUT");
  }
  const policyMapContentHash = calculatePolicyValidationDigest(request.policyMap);
  const logicalResourceManifestHash = calculatePolicyValidationDigest(request.logicalResourceManifest);
  let resources: readonly Resource[] | undefined;
  try {
    resources = resourcesFromJson(request.json, request.track);
  } catch {
    resources = undefined;
  }
  const results = request.policyMap.mappings.map((mapping, mappingIndex): PolicyValidationResultV1 => {
    const { expectedValue, ...identity } = mapping;
    return {
      ...identity,
      mappingIndex,
      mappingHash: calculatePolicyValidationDigest(mapping),
      ...(Object.hasOwn(mapping, "expectedValue")
        ? { expectedValueDigest: calculatePolicyValidationDigest(expectedValue) }
        : {}),
      ...observe(mapping, request, resources),
    };
  });
  const receipt: Omit<PolicyValidationV1, "receiptHash"> = {
    schemaVersion: "1.0.0",
    projectId: request.policyMap.projectId,
    runId: request.policyMap.runId,
    track: request.track,
    sourceHash: request.sourceHash,
    policyMapHash: request.policyMapHash,
    policyMapContentHash,
    logicalResourceManifestHash,
    inputHash: createHash("sha256").update(request.json).digest("hex"),
    outcome: results.some((result) => result.outcome === "fail")
      ? "fail"
      : results.length === 0 || results.some((result) => result.outcome === "unsupported")
        ? "unsupported"
        : "pass",
    results,
  };
  for (const result of results) Object.freeze(result);
  Object.freeze(results);
  return Object.freeze({ ...receipt, receiptHash: calculatePolicyValidationHash(receipt) });
}

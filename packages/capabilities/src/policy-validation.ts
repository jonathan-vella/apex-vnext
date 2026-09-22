import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  POLICY_VALIDATION_LIMITS,
  STORAGE_PROPERTY_HARDENING_CONTROLS,
  PolicyPropertyMapV1Schema,
  LogicalResourceManifestV1Schema,
  assertPolicyValidationJson,
  calculatePolicyValidationDigest,
  calculatePolicyValidationHash,
  type IacTool,
  type PolicyPropertyMapV1,
  type PolicyValidationResultV1,
  type PolicyValidationV1,
  type LogicalResourceManifestV1,
  type NativeValidationReceiptV1,
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
  readonly resourceType?: string;
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
          ...(text(resource.type) === undefined ? {} : { resourceType: text(resource.type)! }),
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
          ...(text(resource.type) !== undefined && own(matchingChanges[0], "type") === resource.type
            ? { resourceType: text(resource.type)! }
            : {}),
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
  return observeBoundProperty(mapping, request, resources);
}

function observeBoundProperty(
  mapping: Pick<PolicyPropertyMapV1["mappings"][number], "propertyPath" | "logicalResourceId" | "expectedValue">,
  request: Pick<PolicyValidationInput, "track" | "logicalResourceManifest">,
  resources: readonly Resource[] | undefined,
): Observation {
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

export interface StorageSecurityObservation {
  readonly coverage: "storage-account-property-hardening-v1";
  readonly fullBaselineEvaluated: false;
  readonly sourceHash: string;
  readonly inputHash: string;
  readonly bindingHash: string;
  readonly outcome: PolicyValidationV1["outcome"];
  readonly results: readonly (Observation & { readonly propertyPath: string; readonly expectedValueDigest: string })[];
}

export function validateStorageSecurityProperties(request: {
  readonly track: IacTool;
  readonly sourceHash: string;
  readonly binding: PolicyResourceBinding;
  readonly json: string;
}): StorageSecurityObservation {
  const { binding, ...source } = request;
  return validateStorageSecurityBindings({ ...source, bindings: { storage: binding } }).storage!;
}

export function validateStorageSecurityBindings(request: {
  readonly track: IacTool;
  readonly sourceHash: string;
  readonly bindings: Readonly<Record<string, PolicyResourceBinding>>;
  readonly json: string;
}): Readonly<Record<string, StorageSecurityObservation>> {
  assertPolicyValidationJson(request.bindings);
  if (
    !["bicep", "terraform"].includes(request.track) ||
    !/^[0-9a-f]{64}$/.test(request.sourceHash) ||
    object(request.bindings) === undefined ||
    Object.keys(request.bindings).length > POLICY_VALIDATION_LIMITS.mappings ||
    Object.entries(request.bindings).some(([id, binding]) => id.length === 0 || object(binding) === undefined) ||
    typeof request.json !== "string"
  )
    throw new TypeError("STORAGE_SECURITY_INVALID_INPUT");
  const controls = STORAGE_PROPERTY_HARDENING_CONTROLS[request.track];
  const expectedType = request.track === "bicep" ? "microsoft.storage/storageaccounts" : "azurerm_storage_account";
  let resources: readonly Resource[] | undefined;
  try {
    resources = resourcesFromJson(request.json, request.track).map((resource) => ({
      ...resource,
      unsupported: resource.unsupported || resource.resourceType?.toLowerCase() !== expectedType,
    }));
  } catch {
    resources = undefined;
  }
  const inputHash = createHash("sha256").update(request.json).digest("hex");
  return Object.freeze(
    Object.fromEntries(
      Object.entries(request.bindings).map(([logicalId, binding]) => {
        const results = controls.map(([propertyPath, expectedValue]) =>
          Object.freeze({
            propertyPath,
            expectedValueDigest: calculatePolicyValidationDigest(expectedValue),
            ...observeBoundProperty(
              { propertyPath, expectedValue, logicalResourceId: "storage" },
              { track: request.track, logicalResourceManifest: { storage: binding } },
              resources,
            ),
          }),
        );
        const observation: StorageSecurityObservation = Object.freeze({
          coverage: "storage-account-property-hardening-v1",
          fullBaselineEvaluated: false,
          sourceHash: request.sourceHash,
          bindingHash: calculatePolicyValidationDigest(binding),
          inputHash,
          outcome: results.some(({ outcome }) => outcome === "fail")
            ? "fail"
            : results.some(({ outcome }) => outcome === "unsupported")
              ? "unsupported"
              : "pass",
          results: Object.freeze(results),
        });
        return [logicalId, observation];
      }),
    ),
  );
}

export function validateBicepStorageDiagnostics(request: {
  readonly sourceHash: string;
  readonly binding: PolicyResourceBinding;
  readonly workspaceResourceId: string;
  readonly json: string;
}): NonNullable<NativeValidationReceiptV1["storageDiagnostics"]>[string] {
  assertPolicyValidationJson(request.binding);
  if (
    !/^[a-f0-9]{64}$/.test(request.sourceHash) ||
    !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.OperationalInsights\/workspaces\/[^/]+$/i.test(
      request.workspaceResourceId,
    ) ||
    typeof request.json !== "string" ||
    Buffer.byteLength(request.json) > POLICY_VALIDATION_LIMITS.bytes
  )
    throw new TypeError("STORAGE_DIAGNOSTICS_INVALID_INPUT");
  const bindingHash = calculatePolicyValidationDigest({
    binding: request.binding,
    workspaceResourceId: request.workspaceResourceId,
  });
  const inputHash = createHash("sha256").update(request.json).digest("hex");
  const result = (
    outcome: "pass" | "fail" | "unsupported",
    reason: NonNullable<NativeValidationReceiptV1["storageDiagnostics"]>[string]["reason"],
  ) => ({
    coverage: "bicep-storage-service-diagnostics-v1" as const,
    fullBaselineEvaluated: false as const,
    sourceHash: request.sourceHash,
    inputHash,
    bindingHash,
    outcome,
    reason,
  });
  let resources: readonly Resource[];
  try {
    resources = resourcesFromJson(request.json, "bicep");
  } catch {
    return result("unsupported", "invalid-source");
  }
  const matches = resources.filter(({ codeSymbol }) => codeSymbol === request.binding.codeSymbol);
  if (matches.length !== 1 || request.binding.codeSymbol === undefined || request.binding.physicalId !== undefined)
    return result("unsupported", "ambiguous-or-unbound-account");
  const account = matches[0]!;
  if (
    account.unsupported ||
    account.codeSymbol!.includes("::") ||
    account.resourceType?.toLowerCase() !== "microsoft.storage/storageaccounts" ||
    typeof account.value.name !== "string" ||
    !/^[a-z0-9]{3,24}$/.test(account.value.name) ||
    Object.hasOwn(account.value, "scope") ||
    Object.hasOwn(account.value, "condition")
  )
    return result("unsupported", "unsupported-account");
  const services = ["blobServices", "fileServices", "queueServices", "tableServices"];
  for (const service of services) {
    const resourceType = `Microsoft.Storage/storageAccounts/${service}`;
    const serviceResources = resources.filter(
      (resource) =>
        resource.resourceType?.toLowerCase() === resourceType.toLowerCase() &&
        (resource.value.name === `${account.value.name}/default` ||
          resource.value.name === `[format('{0}/{1}', '${account.value.name}', 'default')]`),
    );
    if (serviceResources.length !== 1) return result("fail", "missing-or-ambiguous-service");
    const target = serviceResources[0]!;
    if (
      target.unsupported ||
      target.codeSymbol === undefined ||
      target.codeSymbol.includes("::") ||
      Object.hasOwn(target.value, "scope") ||
      Object.hasOwn(target.value, "condition") ||
      !Array.isArray(target.value.dependsOn) ||
      !target.value.dependsOn.includes(account.codeSymbol)
    )
      return result("unsupported", "unsupported-service");
    const scope = `[resourceId('${resourceType}', '${account.value.name}', 'default')]`;
    const settings = resources.filter(
      (resource) =>
        resource.resourceType?.toLowerCase() === "microsoft.insights/diagnosticsettings" &&
        resource.value.scope === scope,
    );
    if (settings.length !== 1) return result("fail", "missing-or-ambiguous-diagnostics");
    const setting = settings[0]!;
    if (
      setting.unsupported ||
      setting.codeSymbol === undefined ||
      setting.codeSymbol.includes("::") ||
      Object.hasOwn(setting.value, "condition") ||
      !Array.isArray(setting.value.dependsOn) ||
      !setting.value.dependsOn.includes(target.codeSymbol)
    )
      return result("unsupported", "unsupported-diagnostics");
    const properties = object(setting.value.properties);
    if (
      properties === undefined ||
      typeof properties.workspaceId !== "string" ||
      properties.workspaceId.toLowerCase() !== request.workspaceResourceId.toLowerCase()
    )
      return result("fail", "workspace-mismatch");
    const logs = properties.logs;
    const metrics = properties.metrics;
    if (!Array.isArray(logs) || !Array.isArray(metrics)) return result("fail", "missing-categories");
    const allLogs = logs.some((entry) => own(entry, "categoryGroup") === "allLogs" && own(entry, "enabled") === true);
    const requiredLogs = ["StorageRead", "StorageWrite", "StorageDelete"];
    if (
      (!allLogs &&
        !requiredLogs.every((category) =>
          logs.some((entry) => own(entry, "category") === category && own(entry, "enabled") === true),
        )) ||
      !metrics.some((entry) => own(entry, "category") === "Transaction" && own(entry, "enabled") === true)
    )
      return result("fail", "disabled-or-missing-categories");
  }
  return result("pass", "matched");
}

export function validateBicepResourceParity(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly json: string;
}) {
  assertPolicyValidationJson(request.manifest);
  if (
    !Value.Check(LogicalResourceManifestV1Schema, request.manifest) ||
    request.manifest.track !== "bicep" ||
    request.manifest.resources.length > 1000 ||
    !/^[a-f0-9]{64}$/.test(request.sourceHash) ||
    typeof request.json !== "string" ||
    Buffer.byteLength(request.json) > POLICY_VALIDATION_LIMITS.bytes
  )
    throw new TypeError("RESOURCE_PARITY_INVALID_INPUT");
  const result = (
    outcome: "pass" | "fail" | "unsupported",
    reason:
      | "matched"
      | "coverage-mismatch"
      | "type-mismatch"
      | "dependency-mismatch"
      | "unsupported-resource"
      | "invalid-source",
  ) => ({
    coverage: "bicep-symbolic-resource-parity-v1" as const,
    sourceHash: request.sourceHash,
    manifestHash: calculatePolicyValidationDigest(request.manifest),
    inputHash: createHash("sha256").update(request.json).digest("hex"),
    outcome,
    reason,
  });
  const expected = request.manifest.resources;
  const byId = new Map(expected.map((resource) => [resource.logicalId, resource]));
  if (
    byId.size !== expected.length ||
    new Set(expected.map(({ executionAddress }) => executionAddress)).size !== expected.length ||
    expected.some(
      (resource) =>
        resource.ownership !== "managed" ||
        resource.implementationKind !== "resource" ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(resource.executionAddress ?? "") ||
        resource.dependsOn.some((id) => !byId.has(id)) ||
        JSON.stringify([...resource.dependsOn].sort()) !== JSON.stringify([...resource.generatedDependencies].sort()),
    )
  )
    return result("unsupported", "unsupported-resource");
  let observed: readonly Resource[];
  try {
    observed = resourcesFromJson(request.json, "bicep");
  } catch {
    return result("unsupported", "invalid-source");
  }
  if (
    observed.some(
      (resource) =>
        resource.unsupported ||
        resource.codeSymbol === undefined ||
        resource.codeSymbol.includes("::") ||
        resource.resourceType?.toLowerCase() === "microsoft.resources/deployments" ||
        Object.hasOwn(resource.value, "scope") ||
        Object.hasOwn(resource.value, "condition"),
    )
  )
    return result("unsupported", "unsupported-resource");
  if (
    observed.length !== expected.length ||
    expected.some(
      (resource) => observed.filter(({ codeSymbol }) => codeSymbol === resource.executionAddress).length !== 1,
    )
  )
    return result("fail", "coverage-mismatch");
  for (const resource of expected) {
    const compiled = observed.find(({ codeSymbol }) => codeSymbol === resource.executionAddress)!;
    if (compiled.resourceType?.toLowerCase() !== resource.type.toLowerCase()) return result("fail", "type-mismatch");
    const dependencies = compiled.value.dependsOn ?? [];
    if (
      !Array.isArray(dependencies) ||
      dependencies.some((dependency) => typeof dependency !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(dependency))
    )
      return result("unsupported", "unsupported-resource");
    const expectedDependencies = resource.dependsOn.map((id) => byId.get(id)!.executionAddress!).sort();
    if (
      new Set(dependencies).size !== dependencies.length ||
      JSON.stringify([...dependencies].sort()) !== JSON.stringify(expectedDependencies)
    )
      return result("fail", "dependency-mismatch");
  }
  return result("pass", "matched");
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

import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  POLICY_VALIDATION_LIMITS,
  STORAGE_PROPERTY_HARDENING_CONTROLS,
  PolicyPropertyMapV1Schema,
  LogicalResourceManifestV1Schema,
  IacBindingV1Schema,
  SECRET_VALUE_PATTERN,
  assertPolicyValidationJson,
  calculatePolicyValidationDigest,
  calculatePolicyValidationHash,
  isSecretBearingField,
  type IacTool,
  type PolicyPropertyMapV1,
  type PolicyValidationResultV1,
  type PolicyValidationV1,
  type LogicalResourceManifestV1,
  type IacBindingV1,
  type NativeValidationReceiptV1,
} from "@apexops/contracts";
import { parseJsonProcessOutput } from "./iac-normalizers.js";

export interface PolicyResourceBinding {
  readonly physicalId?: string;
  readonly codeSymbol?: string;
  readonly terraformAddress?: string;
  readonly componentSymbols?: readonly string[];
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
  readonly existing?: boolean;
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
  const parsed = parseJsonProcessOutput(track === "bicep" ? "bicep-build" : "terraform-plan", json);
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
        ? value.map(
            (entry, index) =>
              [parentSymbols !== null && parentSymbols.length > 0 ? String(index) : undefined, entry] as const,
          )
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
          (Object.hasOwn(resource, "condition") && resource.condition !== true);
        const physicalId = text(own(resource, "id"));
        const symbols = parentSymbols !== null && symbol !== undefined ? [...parentSymbols, symbol] : null;
        resources.push({
          value: resource,
          unsupported,
          ...(resource.existing === true ? { existing: true } : {}),
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
    if (Object.hasOwn(root, "anonymousResources")) {
      if (!Array.isArray(root.anonymousResources)) throw new Error("POLICY_VALIDATION_INVALID_SOURCE");
      visit(root.anonymousResources, false, []);
    }
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
  if (mapping.disposition === "not-applicable") return { outcome: "pass", reason: "not-applicable" };
  if (mapping.effect === "disabled") return { outcome: "unsupported", reason: "unsupported-effect" };
  if (!Object.hasOwn(mapping, "expectedValue"))
    return ["modify", "deployIfNotExists"].includes(mapping.effect)
      ? { outcome: "pass", reason: "platform-remediated" }
      : { outcome: "unsupported", reason: "missing-expected-value" };
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
  let matches = resources.filter((resource) =>
    request.track === "terraform"
      ? resource.codeSymbol === codeSymbol
      : (physicalId !== undefined && resource.physicalId === physicalId) ||
        (codeSymbol !== undefined && resource.codeSymbol === codeSymbol),
  );
  if (matches.length === 0 && request.track === "terraform" && codeSymbol?.startsWith("module.")) {
    const prefix = `${codeSymbol}.`;
    matches = resources.filter(
      (resource) =>
        resource.codeSymbol !== undefined &&
        resource.codeSymbol.startsWith(prefix) &&
        !resource.codeSymbol.slice(prefix.length).includes(".module.") &&
        !resource.unsupported &&
        own(resource.value, segments[0]!) !== undefined,
    );
  }
  if (matches.length === 0) return { outcome: "unsupported", reason: "resource-not-found" };
  if (matches.length !== 1) return { outcome: "unsupported", reason: "ambiguous-resource" };
  const resource = matches[0]!;
  if (
    resource.unsupported ||
    resource.existing === true ||
    (physicalId !== undefined && physicalId !== resource.physicalId)
  ) {
    return { outcome: "unsupported", reason: "unsupported-resource" };
  }
  const walkPath = (
    startValue: unknown,
    startUnknown: unknown,
    pathSegments: readonly string[],
  ): { observed: unknown; unknown: unknown; expressionHit: boolean } => {
    let currentObserved: unknown = startValue;
    let currentUnknown: unknown = startUnknown;
    for (const segment of pathSegments) {
      if (
        currentUnknown === true ||
        (typeof currentObserved === "string" && expression(currentObserved, request.track))
      ) {
        return { observed: undefined, unknown: undefined, expressionHit: true };
      }
      currentObserved = own(currentObserved, segment);
      currentUnknown = own(currentUnknown, segment);
    }
    return { observed: currentObserved, unknown: currentUnknown, expressionHit: false };
  };
  let walked = walkPath(resource.value, resource.unknown, segments);
  if (
    walked.observed === undefined &&
    !walked.expressionHit &&
    request.track === "bicep" &&
    resource.resourceType?.toLowerCase() === "microsoft.resources/deployments" &&
    segments[0] === "properties" &&
    segments.length >= 2 &&
    segments[1] !== "parameters" &&
    segments[1] !== "template" &&
    codeSymbol !== undefined
  ) {
    const prefix = `${codeSymbol}::`;
    const innerCandidates = resources.filter(
      (candidate) =>
        candidate.codeSymbol !== undefined &&
        candidate.codeSymbol.startsWith(prefix) &&
        !candidate.codeSymbol.slice(prefix.length).includes("::") &&
        candidate.resourceType?.toLowerCase() !== "microsoft.resources/deployments" &&
        !candidate.unsupported &&
        candidate.existing !== true,
    );
    if (innerCandidates.length !== 1) {
      return { outcome: "unsupported", reason: "unsupported-resource" };
    }
    const innerResource = innerCandidates[0]!;
    const parametersObj = object(own(resource.value.properties, "parameters"));
    let currentObserved: unknown = innerResource.value;
    let currentUnknown: unknown = innerResource.unknown;
    let resolvedViaInner = true;
    for (let idx = 0; idx < segments.length; idx += 1) {
      if (currentUnknown === true) return { outcome: "unsupported", reason: "unsupported-expression" };
      if (typeof currentObserved === "string") {
        const paramRef = /^\[parameters\('([A-Za-z_][A-Za-z0-9_]*)'\)\]$/u.exec(currentObserved.trim());
        if (paramRef === null) return { outcome: "unsupported", reason: "unsupported-expression" };
        const paramDef = object(own(parametersObj, paramRef[1]!));
        if (paramDef === undefined || !Object.hasOwn(paramDef, "value")) {
          return { outcome: "unsupported", reason: "unsupported-expression" };
        }
        currentObserved = paramDef.value;
        currentUnknown = undefined;
      }
      currentObserved = own(currentObserved, segments[idx]!);
      currentUnknown = own(currentUnknown, segments[idx]!);
    }
    if (typeof currentObserved === "string") {
      const paramRef = /^\[parameters\('([A-Za-z_][A-Za-z0-9_]*)'\)\]$/u.exec(currentObserved.trim());
      if (paramRef !== null) {
        const paramDef = object(own(parametersObj, paramRef[1]!));
        if (paramDef === undefined || !Object.hasOwn(paramDef, "value")) {
          return { outcome: "unsupported", reason: "unsupported-expression" };
        }
        currentObserved = paramDef.value;
        currentUnknown = undefined;
      }
    }
    if (resolvedViaInner) {
      walked = { observed: currentObserved, unknown: currentUnknown, expressionHit: false };
    }
  }
  if (walked.expressionHit || hasUnknown(walked.unknown) || expression(walked.observed, request.track))
    return { outcome: "unsupported", reason: "unsupported-expression" };
  if (walked.observed === undefined) {
    const rawSiblings = own(binding, "componentSymbols");
    if (Array.isArray(rawSiblings) && rawSiblings.length > 0 && physicalId === undefined) {
      const siblingOutcomes = rawSiblings
        .filter((sym): sym is string => typeof sym === "string" && sym.length > 0 && sym !== codeSymbol)
        .map((sym) =>
          observeBoundProperty(
            mapping,
            {
              track: request.track,
              logicalResourceManifest: {
                [mapping.logicalResourceId]:
                  request.track === "terraform" ? { terraformAddress: sym } : { codeSymbol: sym },
              },
            },
            resources,
          ),
        )
        .filter((candidate) => !(candidate.outcome === "fail" && candidate.reason === "missing-property"));
      if (siblingOutcomes.length === 1) return siblingOutcomes[0]!;
      if (siblingOutcomes.some((candidate) => candidate.outcome === "fail")) {
        return siblingOutcomes.find((candidate) => candidate.outcome === "fail")!;
      }
      if (siblingOutcomes.length > 1) return { outcome: "unsupported", reason: "ambiguous-resource" };
    }
    return { outcome: "fail", reason: "missing-property" };
  }
  const expectedValueDigest = calculatePolicyValidationDigest(mapping.expectedValue);
  let observedValueDigest = calculatePolicyValidationDigest(walked.observed);
  let matched = observedValueDigest === expectedValueDigest;
  if (!matched) {
    const statusWrapper = object(walked.observed);
    if (
      statusWrapper !== undefined &&
      Object.keys(statusWrapper).length === 1 &&
      Object.hasOwn(statusWrapper, "status")
    ) {
      const statusDigest = calculatePolicyValidationDigest(own(statusWrapper, "status"));
      if (statusDigest === expectedValueDigest) {
        observedValueDigest = statusDigest;
        matched = true;
      }
    }
  }
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
      unsupported:
        resource.unsupported || resource.existing === true || resource.resourceType?.toLowerCase() !== expectedType,
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
  readonly targetScope?: string;
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
    const fullNameScope = `[resourceId('${resourceType}', split('${account.value.name}/default', '/')[0], split('${account.value.name}/default', '/')[1])]`;
    const settings = resources.filter(
      (resource) =>
        resource.resourceType?.toLowerCase() === "microsoft.insights/diagnosticsettings" &&
        (resource.value.scope === scope || resource.value.scope === fullNameScope),
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
    if (properties === undefined || typeof properties.workspaceId !== "string") {
      return result("fail", "workspace-mismatch");
    }
    const workspaceExprMatch =
      /^\[resourceId\('Microsoft\.OperationalInsights\/workspaces',\s*'([A-Za-z0-9][A-Za-z0-9-]*)'\)\]$/iu.exec(
        properties.workspaceId.trim(),
      );
    if (workspaceExprMatch !== null) {
      if (
        request.targetScope === undefined ||
        !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/]+$/i.test(request.targetScope)
      ) {
        return result("unsupported", "unsupported-diagnostics");
      }
      const resolvedId = `${request.targetScope}/providers/Microsoft.OperationalInsights/workspaces/${workspaceExprMatch[1]!}`;
      if (resolvedId.toLowerCase() !== request.workspaceResourceId.toLowerCase()) {
        return result("fail", "workspace-mismatch");
      }
    } else if (properties.workspaceId.toLowerCase() !== request.workspaceResourceId.toLowerCase()) {
      return result("fail", "workspace-mismatch");
    }
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

export function validateStagedBicepParity(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly binding?: IacBindingV1;
  readonly json: string;
}): NonNullable<NativeValidationReceiptV1["resourceParity"]> {
  const inputHash = createHash("sha256").update(request.json).digest("hex");
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
    ...(request.binding === undefined ? {} : { bindingHash: calculatePolicyValidationDigest(request.binding) }),
    inputHash,
    outcome,
    reason,
  });
  let allObserved: readonly Resource[];
  try {
    allObserved = resourcesFromJson(request.json, "bicep");
  } catch {
    return result("unsupported", "invalid-source");
  }
  const topLevel = allObserved.filter((resource) => !resource.codeSymbol?.includes("::"));
  for (const expected of request.manifest.resources) {
    if (expected.ownership === "existing") continue;
    const bySymbol = topLevel.find(({ codeSymbol }) => codeSymbol === expected.executionAddress);
    if (bySymbol !== undefined) {
      if (expected.implementationKind === "module") {
        if (bySymbol.resourceType?.toLowerCase() !== "microsoft.resources/deployments") {
          return result("fail", "type-mismatch");
        }
      } else if (
        /^Microsoft\.[A-Za-z0-9.]+(?:\/[A-Za-z][A-Za-z0-9]*)+$/i.test(expected.type) &&
        bySymbol.resourceType?.toLowerCase() !== expected.type.toLowerCase()
      ) {
        return result("fail", "type-mismatch");
      }
      continue;
    }
    const nativeMatch = /^native:(Microsoft\.[A-Za-z0-9.]+(?:\/[A-Za-z][A-Za-z0-9]*)+)@/i.exec(
      expected.implementationAddress,
    );
    const hasMatchingResource =
      expected.implementationKind === "module"
        ? topLevel.some(({ resourceType }) => resourceType?.toLowerCase() === "microsoft.resources/deployments")
        : nativeMatch !== null &&
          allObserved.some(({ resourceType }) => resourceType?.toLowerCase() === nativeMatch[1]!.toLowerCase());
    if (!hasMatchingResource) return result("fail", "coverage-mismatch");
  }
  return result("pass", "matched");
}

export function validateStagedBicepBaseline(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly binding: IacBindingV1;
  readonly json: string;
}): NonNullable<NativeValidationReceiptV1["securityBaseline"]> {
  const parity = validateStagedBicepParity(request);
  const result = (
    outcome: "pass" | "fail" | "unsupported",
    reason:
      | "matched"
      | "resource-parity"
      | "unsupported-resource"
      | "credential-content"
      | "storage-controls"
      | "diagnostic-routing",
  ) => ({
    coverage: "bicep-storage-only-baseline-v1" as const,
    sourceHash: request.sourceHash,
    inputHash: parity.inputHash,
    manifestHash: parity.manifestHash,
    bindingHash: calculatePolicyValidationDigest(request.binding),
    outcome,
    reason,
  });
  const strict = validateBicepStorageBaseline(request);
  if (strict.outcome === "fail" && strict.reason === "credential-content") return strict;
  if (parity.outcome !== "pass") return result(parity.outcome, "resource-parity");
  let allObserved: readonly Resource[];
  try {
    allObserved = resourcesFromJson(request.json, "bicep");
  } catch {
    return result("unsupported", "resource-parity");
  }
  for (const resource of allObserved) {
    const type = resource.resourceType?.toLowerCase();
    const props = object(resource.value.properties);
    if (type === "microsoft.storage/storageaccounts" && resource.existing !== true && props !== undefined) {
      if (
        props.allowBlobPublicAccess === true ||
        props.allowSharedKeyAccess === true ||
        props.supportsHttpsTrafficOnly === false ||
        props.minimumTlsVersion === "TLS1_0" ||
        props.minimumTlsVersion === "TLS1_1"
      ) {
        return result("fail", "storage-controls");
      }
    }
    if (type === "microsoft.resources/deployments" && props !== undefined) {
      const params = object(props.parameters);
      if (
        own(params?.allowBlobPublicAccess, "value") === true ||
        own(params?.allowSharedKeyAccess, "value") === true ||
        own(params?.supportsHttpsTrafficOnly, "value") === false ||
        own(params?.minimumTlsVersion, "value") === "TLS1_0" ||
        own(params?.minimumTlsVersion, "value") === "TLS1_1"
      ) {
        return result("fail", "storage-controls");
      }
    }
  }
  return result("pass", "matched");
}

export function validateStagedTerraformParity(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly binding?: IacBindingV1;
  readonly files: Readonly<Record<string, string>>;
}): NonNullable<NativeValidationReceiptV1["resourceParity"]> {
  const inputHash = calculatePolicyValidationDigest(
    Object.fromEntries(Object.entries(request.files).sort(([a], [b]) => a.localeCompare(b))),
  );
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
    coverage: "terraform-symbolic-resource-parity-v1" as const,
    sourceHash: request.sourceHash,
    manifestHash: calculatePolicyValidationDigest(request.manifest),
    ...(request.binding === undefined ? {} : { bindingHash: calculatePolicyValidationDigest(request.binding) }),
    inputHash,
    outcome,
    reason,
  });
  const tfEntries = Object.entries(request.files).filter(([path]) => path.endsWith(".tf"));
  if (tfEntries.length === 0) return result("fail", "coverage-mismatch");
  const combined = tfEntries.map(([, content]) => stripHclComments(content)).join("\n");
  for (const expected of request.manifest.resources) {
    if (expected.ownership === "existing") continue;
    const symbol = (expected.executionAddress ?? expected.logicalId.replaceAll("-", "_")).split(".").at(-1)!;
    const hasSymbol =
      expected.implementationKind === "module"
        ? new RegExp(`\\bmodule\\s+"${symbol.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\s*\\{`, "u").test(combined)
        : new RegExp(
            `\\bresource\\s+"[^"]+"\\s+"${symbol.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\s*\\{`,
            "u",
          ).test(combined);
    if (!hasSymbol) return result("fail", "coverage-mismatch");
  }
  return result("pass", "matched");
}

export function validateStagedTerraformBaseline(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly binding: IacBindingV1;
  readonly files: Readonly<Record<string, string>>;
}): NonNullable<NativeValidationReceiptV1["securityBaseline"]> {
  const parity = validateStagedTerraformParity(request);
  const result = (
    outcome: "pass" | "fail" | "unsupported",
    reason:
      | "matched"
      | "resource-parity"
      | "unsupported-resource"
      | "credential-content"
      | "storage-controls"
      | "diagnostic-routing",
  ) => ({
    coverage: "terraform-source-baseline-v1" as const,
    sourceHash: request.sourceHash,
    inputHash: parity.inputHash,
    manifestHash: parity.manifestHash,
    bindingHash: calculatePolicyValidationDigest(request.binding),
    outcome,
    reason,
  });
  for (const content of Object.values(request.files)) {
    if (SECRET_VALUE_PATTERN.test(content)) return result("fail", "credential-content");
    const clean = stripHclComments(content);
    if (
      /\ballow_nested_items_to_be_public\s*=\s*true\b/u.test(clean) ||
      /\bshared_access_key_enabled\s*=\s*true\b/u.test(clean) ||
      /\bhttps_traffic_only_enabled\s*=\s*false\b/u.test(clean) ||
      /\bmin_tls_version\s*=\s*"TLS1_[01]"\b/u.test(clean)
    ) {
      return result("fail", "storage-controls");
    }
  }
  if (parity.outcome !== "pass") return result(parity.outcome, "resource-parity");
  return result("pass", "matched");
}

export function validateBicepResourceParity(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly binding?: IacBindingV1;
  readonly json: string;
}) {
  assertPolicyValidationJson(request.manifest);
  if (request.binding !== undefined) {
    assertPolicyValidationJson(request.binding);
    if (
      !Value.Check(IacBindingV1Schema, request.binding) ||
      request.binding.track !== "bicep" ||
      request.binding.projectId !== request.manifest.projectId ||
      request.binding.runId !== request.manifest.runId
    )
      throw new TypeError("RESOURCE_PARITY_INVALID_INPUT");
  }
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
    ...(request.binding === undefined ? {} : { bindingHash: calculatePolicyValidationDigest(request.binding) }),
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
        !(
          (resource.ownership === "managed" &&
            (resource.implementationKind === "resource" || resource.implementationKind === "module")) ||
          (resource.ownership === "existing" && resource.implementationKind === "existing")
        ) ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(resource.executionAddress ?? "") ||
        resource.dependsOn.some((id) => !byId.has(id)) ||
        JSON.stringify([...resource.dependsOn].sort()) !== JSON.stringify([...resource.generatedDependencies].sort()),
    )
  )
    return result("unsupported", "unsupported-resource");
  let allObserved: readonly Resource[];
  try {
    allObserved = resourcesFromJson(request.json, "bicep");
  } catch {
    return result("unsupported", "invalid-source");
  }
  const moduleSymbols = new Set(
    expected
      .filter((resource) => resource.implementationKind === "module")
      .map((resource) => resource.executionAddress!),
  );
  const nestedObserved = allObserved.filter((resource) => resource.codeSymbol?.includes("::"));
  if (nestedObserved.some((resource) => !moduleSymbols.has(resource.codeSymbol!.split("::")[0]!)))
    return result("unsupported", "unsupported-resource");
  const observed = allObserved.filter((resource) => !resource.codeSymbol?.includes("::"));
  if (
    observed.some(
      (resource) =>
        resource.unsupported ||
        resource.codeSymbol === undefined ||
        (resource.resourceType?.toLowerCase() === "microsoft.resources/deployments" &&
          !moduleSymbols.has(resource.codeSymbol)) ||
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
    if ((compiled.existing === true) !== (resource.ownership === "existing")) {
      return result("unsupported", "unsupported-resource");
    }
    const expectedType =
      resource.implementationKind === "module" ? "microsoft.resources/deployments" : resource.type.toLowerCase();
    if (compiled.resourceType?.toLowerCase() !== expectedType) return result("fail", "type-mismatch");
    if (resource.ownership === "existing") {
      if (
        Object.hasOwn(compiled.value, "scope") ||
        (Array.isArray(compiled.value.dependsOn) && compiled.value.dependsOn.length > 0)
      ) {
        return result("unsupported", "unsupported-resource");
      }
      continue;
    }
    const selected = request.binding?.resourceBindings[resource.logicalId];
    const scopeId = selected?.scopeLogicalId;
    if (resource.implementationKind === "module") {
      if (Object.hasOwn(compiled.value, "scope") || scopeId !== undefined)
        return result("unsupported", "unsupported-resource");
    } else if (Object.hasOwn(compiled.value, "scope") || scopeId !== undefined) {
      const target = scopeId === undefined ? undefined : byId.get(scopeId);
      const targetBinding = scopeId === undefined ? undefined : request.binding?.resourceBindings[scopeId];
      const targetCompiled =
        target === undefined ? undefined : observed.find(({ codeSymbol }) => codeSymbol === target.executionAddress);
      const targetName = targetBinding?.parameters.name;
      const lowerType = resource.type.toLowerCase();
      const allowedScopedType =
        lowerType === "microsoft.insights/diagnosticsettings" ||
        lowerType === "microsoft.authorization/roleassignments";
      if (
        !allowedScopedType ||
        target === undefined ||
        targetBinding === undefined ||
        targetBinding.scopeLogicalId !== undefined ||
        scopeId === resource.logicalId ||
        !resource.dependsOn.includes(scopeId!) ||
        typeof targetName !== "string" ||
        !/^Microsoft\.[A-Za-z0-9.]+(?:\/[A-Za-z][A-Za-z0-9]*)+$/.test(target.type) ||
        targetName.split("/").length !== target.type.split("/").length - 1 ||
        targetName.split("/").some((name) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) ||
        targetCompiled?.value.name !== targetName ||
        compiled.value.name !== selected?.parameters.name ||
        target.implementationAddress !== targetBinding.implementation ||
        resource.implementationAddress !== selected?.implementation
      )
        return result("unsupported", "unsupported-resource");
      const names = targetName.split("/");
      const literalScope = `[resourceId('${target.type}', ${names.map((name) => `'${name}'`).join(", ")})]`;
      const splitScope = `[resourceId('${target.type}', ${names.map((_, index) => `split('${targetName}', '/')[${index}]`).join(", ")})]`;
      if (compiled.value.scope !== literalScope && compiled.value.scope !== splitScope)
        return result("fail", "dependency-mismatch");
    }
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

export function validateBicepStorageBaseline(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly binding: IacBindingV1;
  readonly json: string;
  readonly targetScope?: string;
}): NonNullable<NativeValidationReceiptV1["securityBaseline"]> {
  const parity = validateBicepResourceParity(request);
  const result = (
    outcome: "pass" | "fail" | "unsupported",
    reason:
      | "matched"
      | "resource-parity"
      | "unsupported-resource"
      | "credential-content"
      | "storage-controls"
      | "diagnostic-routing",
  ) => ({
    coverage: "bicep-storage-only-baseline-v1" as const,
    sourceHash: request.sourceHash,
    inputHash: parity.inputHash,
    manifestHash: parity.manifestHash,
    bindingHash: calculatePolicyValidationDigest(request.binding),
    outcome,
    reason,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.json);
  } catch {
    return result(parity.outcome, "resource-parity");
  }
  const isArmExpression = (value: string): boolean =>
    value.startsWith("[") && !value.startsWith("[[") && value.endsWith("]");
  const hasSecretValue = (value: string, insideModuleTemplate: boolean): boolean => {
    const normalized =
      insideModuleTemplate && isArmExpression(value) ? value.replace(/AccountKey=\{\d+\}/giu, "") : value;
    return SECRET_VALUE_PATTERN.test(normalized);
  };
  const isSafeModuleFieldExpression = (value: string): boolean =>
    isArmExpression(value) &&
    !hasSecretValue(value, true) &&
    !/\bconcat\s*\(/iu.test(value) &&
    /^\[(?:parameters|tryGet|if|subscriptionResourceId|resourceId|reference)\(/u.test(value);
  const hasCredential = (value: unknown, insideModuleTemplate = false, inDeploymentProperties = false): boolean => {
    if (typeof value === "string") {
      return hasSecretValue(value, insideModuleTemplate);
    }
    if (Array.isArray(value)) {
      return value.some((item) => hasCredential(item, insideModuleTemplate));
    }
    const record = object(value);
    if (record === undefined) return false;
    const isDeployment = text(record.type)?.toLowerCase() === "microsoft.resources/deployments";
    return Object.entries(record).some(([key, child]) => {
      const nextInDeploymentProperties = isDeployment && key === "properties";
      const nextInsideTemplate = insideModuleTemplate || (inDeploymentProperties && key === "template");
      const paramValue = !insideModuleTemplate ? object(child)?.value : undefined;
      const candidate = typeof child === "string" ? child : typeof paramValue === "string" ? paramValue : undefined;
      if (isSecretBearingField(key, candidate ?? child)) {
        if (
          candidate !== undefined &&
          candidate.length > 0 &&
          !(insideModuleTemplate && isSafeModuleFieldExpression(candidate))
        ) {
          return true;
        }
      }
      return hasCredential(child, nextInsideTemplate, nextInDeploymentProperties);
    });
  };
  if (hasCredential(parsed)) return result("fail", "credential-content");
  if (parity.outcome !== "pass") return result(parity.outcome, "resource-parity");
  const onlyKeys = (value: unknown, keys: readonly string[]): boolean =>
    object(value) !== undefined && Object.keys(value as object).every((key) => keys.includes(key));
  const template = object(parsed)!;
  if (
    !onlyKeys(template, [
      "$schema",
      "contentVersion",
      "languageVersion",
      "metadata",
      "resources",
      "parameters",
      "variables",
      "outputs",
      "definitions",
      "functions",
    ]) ||
    ["parameters", "variables", "outputs", "definitions"].some(
      (key) => Object.hasOwn(template, key) && object(template[key]) === undefined,
    ) ||
    (Object.hasOwn(template, "functions") &&
      !Array.isArray(template.functions) &&
      object(template.functions) === undefined)
  )
    return result("unsupported", "unsupported-resource");
  const resources = resourcesFromJson(request.json, "bicep").filter((resource) => !resource.codeSymbol?.includes("::"));
  const accounts = resources.filter(
    (resource) =>
      resource.existing !== true && resource.resourceType?.toLowerCase() === "microsoft.storage/storageaccounts",
  );
  if (accounts.length > 0 && new Set(accounts.map(({ value }) => value.name)).size !== accounts.length)
    return result("unsupported", "unsupported-resource");
  for (const resource of resources) {
    if (
      !onlyKeys(resource.value, [
        "existing",
        "type",
        "apiVersion",
        "name",
        "location",
        "kind",
        "sku",
        "tags",
        "identity",
        "properties",
        "dependsOn",
        "scope",
        "plan",
        "zones",
        "extendedLocation",
        "comments",
        "metadata",
      ])
    )
      return result("unsupported", "unsupported-resource");
    if (resource.resourceType?.toLowerCase() === "microsoft.insights/diagnosticsettings") {
      if (!onlyKeys(resource.value.properties, ["workspaceId", "logs", "metrics", "logAnalyticsDestinationType"]))
        return result("unsupported", "unsupported-resource");
    } else if (
      resource.resourceType?.toLowerCase().startsWith("microsoft.storage/storageaccounts/") &&
      resource.value.properties !== undefined &&
      !onlyKeys(resource.value.properties, [
        "deleteRetentionPolicy",
        "containerDeleteRetentionPolicy",
        "isVersioningEnabled",
        "changeFeed",
      ])
    )
      return result("unsupported", "unsupported-resource");
  }
  for (const moduleStorage of request.manifest.resources.filter(
    (entry) =>
      entry.ownership === "managed" &&
      entry.implementationKind === "module" &&
      entry.type.toLowerCase() === "microsoft.storage/storageaccounts",
  )) {
    const deployment = resources.find(({ codeSymbol }) => codeSymbol === moduleStorage.executionAddress);
    const params = object(own(deployment?.value.properties, "parameters"));
    if (params === undefined) return result("unsupported", "unsupported-resource");
    const requiredControls: readonly (readonly [string, unknown])[] = [
      ["allowBlobPublicAccess", false],
      ["allowSharedKeyAccess", false],
      ["minimumTlsVersion", "TLS1_2"],
      ["supportsHttpsTrafficOnly", true],
      ["publicNetworkAccess", "Disabled"],
    ];
    for (const [paramKey, expectedVal] of requiredControls) {
      const entryObj = object(params[paramKey]);
      if (entryObj === undefined || !Object.hasOwn(entryObj, "value") || expression(entryObj.value, "bicep")) {
        return result("unsupported", "unsupported-resource");
      }
      if (entryObj.value !== expectedVal) {
        return result("fail", "storage-controls");
      }
    }
  }
  for (const account of accounts) {
    const properties = object(account.value.properties);
    const network = object(properties?.networkAcls);
    const encryption = object(properties?.encryption);
    const encryptionServices = object(encryption?.services);
    const identity = object(account.value.identity);
    if (
      !onlyKeys(properties, [
        "minimumTlsVersion",
        "supportsHttpsTrafficOnly",
        "allowBlobPublicAccess",
        "allowSharedKeyAccess",
        "publicNetworkAccess",
        "defaultToOAuthAuthentication",
        "networkAcls",
        "encryption",
        "accessTier",
        "isHnsEnabled",
        "allowCrossTenantReplication",
        "allowedCopyScope",
        "routing",
        "sasPolicy",
        "keyPolicy",
        "largeFileSharesState",
        "azureFilesIdentityBasedAuthentication",
        "immutableStorageWithVersioning",
        "customDomain",
      ]) ||
      !onlyKeys(network, ["defaultAction", "bypass", "ipRules", "virtualNetworkRules", "resourceAccessRules"]) ||
      !onlyKeys(identity, ["type", "userAssignedIdentities"]) ||
      !onlyKeys(encryption, [
        "keySource",
        "requireInfrastructureEncryption",
        "services",
        "identity",
        "keyvaultproperties",
      ]) ||
      !onlyKeys(encryptionServices, ["blob", "file", "table", "queue"]) ||
      !["blob", "file"].every((service) => onlyKeys(own(encryptionServices, service), ["enabled", "keyType"]))
    )
      return result("unsupported", "unsupported-resource");
    if (
      properties === undefined ||
      !STORAGE_PROPERTY_HARDENING_CONTROLS.bicep.every(
        ([path, expected]) => properties[path.slice("properties.".length)] === expected,
      ) ||
      properties.publicNetworkAccess !== "Disabled" ||
      properties.defaultToOAuthAuthentication !== true ||
      network?.defaultAction !== "Deny" ||
      network.bypass !== "None" ||
      !Array.isArray(network.ipRules) ||
      network.ipRules.length !== 0 ||
      !Array.isArray(network.virtualNetworkRules) ||
      network.virtualNetworkRules.length !== 0 ||
      (encryption?.keySource !== "Microsoft.Storage" && encryption?.keySource !== "Microsoft.Keyvault") ||
      encryption.requireInfrastructureEncryption !== true ||
      !["blob", "file"].every((service) => own(own(encryptionServices, service), "enabled") === true) ||
      !["SystemAssigned", "UserAssigned", "SystemAssigned, UserAssigned"].includes(String(identity?.type ?? ""))
    )
      return result("fail", "storage-controls");
    const manifestAccount = request.manifest.resources.find(
      ({ executionAddress }) => executionAddress === account.codeSymbol,
    )!;
    const services = request.manifest.resources.filter(
      (resource) =>
        resource.type.toLowerCase().startsWith("microsoft.storage/storageaccounts/") &&
        resource.dependsOn.includes(manifestAccount.logicalId),
    );
    const settings = request.manifest.resources.filter(({ logicalId }) =>
      services.some((service) => request.binding.resourceBindings[logicalId]?.scopeLogicalId === service.logicalId),
    );
    if (services.length > 0 || settings.length > 0) {
      const sameRunWorkspaces = new Map<string, string>();
      if (
        request.targetScope !== undefined &&
        /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/]+$/i.test(request.targetScope)
      ) {
        for (const entry of request.manifest.resources) {
          if (entry.type.toLowerCase() !== "microsoft.operationalinsights/workspaces") continue;
          const wsName = request.binding.resourceBindings[entry.logicalId]?.parameters.name;
          if (typeof wsName === "string" && wsName.length > 0) {
            const fullId = `${request.targetScope}/providers/Microsoft.OperationalInsights/workspaces/${wsName}`;
            sameRunWorkspaces.set(entry.logicalId, fullId);
            if (entry.executionAddress !== undefined) sameRunWorkspaces.set(entry.executionAddress, fullId);
            sameRunWorkspaces.set(`[resourceId('Microsoft.OperationalInsights/workspaces', '${wsName}')]`, fullId);
          }
        }
      }
      const resolveBaselineWorkspace = (raw: unknown): string | undefined => {
        if (typeof raw !== "string") return undefined;
        if (
          /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.OperationalInsights\/workspaces\/[^/]+$/i.test(
            raw,
          )
        ) {
          return raw;
        }
        return sameRunWorkspaces.get(raw);
      };
      const workspaceIds = settings.map(({ logicalId }) =>
        resolveBaselineWorkspace(
          own(request.binding.resourceBindings[logicalId]?.parameters.properties, "workspaceId"),
        ),
      );
      if (
        services.length !== 4 ||
        settings.length !== 4 ||
        workspaceIds.some((id) => typeof id !== "string") ||
        new Set(workspaceIds.map((id) => id!.toLowerCase())).size !== 1
      )
        return result("unsupported", "diagnostic-routing");
      let routing: ReturnType<typeof validateBicepStorageDiagnostics>;
      try {
        routing = validateBicepStorageDiagnostics({
          sourceHash: request.sourceHash,
          binding: { codeSymbol: account.codeSymbol! },
          workspaceResourceId: workspaceIds[0]!,
          json: request.json,
          ...(request.targetScope === undefined ? {} : { targetScope: request.targetScope }),
        });
      } catch {
        return result("unsupported", "diagnostic-routing");
      }
      if (routing.outcome !== "pass") return result(routing.outcome, "diagnostic-routing");
    }
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

interface ParsedTerraformBlock {
  readonly address: string;
  readonly kind: "resource" | "data" | "module" | "variable" | "output" | "provider" | "terraform";
  readonly blockType?: string;
  readonly body: string;
  readonly dependsOn: readonly string[];
}

function stripHclComments(hcl: string): string {
  let out = "";
  let idx = 0;
  let inString = false;
  while (idx < hcl.length) {
    const ch = hcl[idx]!;
    if (inString) {
      if (ch === "\\" && idx + 1 < hcl.length) {
        out += hcl.slice(idx, idx + 2);
        idx += 2;
      } else {
        if (ch === '"') inString = false;
        out += ch;
        idx += 1;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      idx += 1;
      continue;
    }
    if (ch === "#" || hcl.startsWith("//", idx)) {
      while (idx < hcl.length && hcl[idx] !== "\n") idx += 1;
      continue;
    }
    if (hcl.startsWith("/*", idx)) {
      const end = hcl.indexOf("*/", idx + 2);
      idx = end === -1 ? hcl.length : end + 2;
      continue;
    }
    out += ch;
    idx += 1;
  }
  return out;
}

function parseTopLevelHclAttributes(body: string): ReadonlyMap<string, string> | undefined {
  const clean = stripHclComments(body);
  const attrs = new Map<string, string>();
  let idx = 0;
  while (idx < clean.length) {
    while (idx < clean.length && /[\s,]/u.test(clean[idx]!)) idx += 1;
    if (idx >= clean.length) break;
    const keyMatch = /^(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_-]*))\s*(=|\{)/u.exec(clean.slice(idx));
    if (keyMatch === null) return undefined;
    const key = (keyMatch[1] ?? keyMatch[2])!;
    const separator = keyMatch[3]!;
    idx += keyMatch[0].length;
    if (separator === "{") {
      let depth = 1;
      let inStr = false;
      while (idx < clean.length && depth > 0) {
        const ch = clean[idx]!;
        if (inStr) {
          if (ch === "\\") idx += 2;
          else {
            if (ch === '"') inStr = false;
            idx += 1;
          }
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        idx += 1;
      }
      if (depth !== 0) return undefined;
      continue;
    }
    while (idx < clean.length && (clean[idx] === " " || clean[idx] === "\t")) idx += 1;
    const valueStart = idx;
    let braceDepth = 0;
    let bracketDepth = 0;
    let parenDepth = 0;
    let inStr = false;
    while (idx < clean.length) {
      const ch = clean[idx]!;
      if (inStr) {
        if (ch === "\\") idx += 2;
        else {
          if (ch === '"') inStr = false;
          idx += 1;
        }
        continue;
      }
      if (ch === '"') {
        inStr = true;
        idx += 1;
        continue;
      }
      if (ch === "{") braceDepth += 1;
      else if (ch === "}") braceDepth -= 1;
      else if (ch === "[") bracketDepth += 1;
      else if (ch === "]") bracketDepth -= 1;
      else if (ch === "(") parenDepth += 1;
      else if (ch === ")") parenDepth -= 1;
      else if ((ch === "\n" || ch === ",") && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
        break;
      }
      if (braceDepth < 0 || bracketDepth < 0 || parenDepth < 0) return undefined;
      idx += 1;
    }
    if (inStr || braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) return undefined;
    if (attrs.has(key)) return undefined;
    attrs.set(key, clean.slice(valueStart, idx).trim());
    if (idx < clean.length && (clean[idx] === "\n" || clean[idx] === ",")) idx += 1;
  }
  return attrs;
}

function parseHclStringLiteral(raw: string | undefined): string | undefined {
  if (raw === undefined || !raw.startsWith('"') || !raw.endsWith('"') || /\$\{|%\{/u.test(raw)) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseTerraformBlocks(hcl: string): readonly ParsedTerraformBlock[] | undefined {
  const clean = stripHclComments(hcl);
  const blocks: ParsedTerraformBlock[] = [];
  let index = 0;
  const length = clean.length;
  while (index < length) {
    while (index < length && /\s/u.test(clean[index]!)) index += 1;
    if (index >= length) break;
    const twoLabel = /^(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{/u.exec(clean.slice(index));
    const oneLabel =
      twoLabel === null ? /^(module|variable|output|provider)\s+"([^"]+)"\s*\{/u.exec(clean.slice(index)) : null;
    const zeroLabel = twoLabel === null && oneLabel === null ? /^(terraform)\s*\{/u.exec(clean.slice(index)) : null;
    const headerMatch = twoLabel ?? oneLabel ?? zeroLabel;
    if (headerMatch === null) return undefined;
    const openBraceOffset = index + headerMatch[0].length - 1;
    let depth = 1;
    let cursor = openBraceOffset + 1;
    let inString = false;
    while (cursor < length && depth > 0) {
      const ch = clean[cursor]!;
      if (inString) {
        if (ch === "\\") cursor += 2;
        else {
          if (ch === '"') inString = false;
          cursor += 1;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        cursor += 1;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) return undefined;
    const body = clean.slice(openBraceOffset + 1, cursor - 1);
    const attrs = parseTopLevelHclAttributes(body);
    let dependsOn: string[] = [];
    const rawDeps = attrs?.get("depends_on");
    if (rawDeps !== undefined) {
      if (!rawDeps.startsWith("[") || !rawDeps.endsWith("]")) return undefined;
      dependsOn = rawDeps
        .slice(1, -1)
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
    }
    if (twoLabel !== null) {
      const kind = twoLabel[1] as "resource" | "data";
      blocks.push({
        address: kind === "data" ? `data.${twoLabel[2]!}.${twoLabel[3]!}` : `${twoLabel[2]!}.${twoLabel[3]!}`,
        kind,
        blockType: twoLabel[2]!,
        body,
        dependsOn,
      });
    } else if (oneLabel !== null) {
      const kind = oneLabel[1] as "module" | "variable" | "output" | "provider";
      blocks.push({
        address: `${kind}.${oneLabel[2]!}`,
        kind,
        body,
        dependsOn,
      });
    } else {
      blocks.push({
        address: "terraform",
        kind: "terraform",
        body,
        dependsOn: [],
      });
    }
    index = cursor;
  }
  return blocks;
}

const ALLOWED_TERRAFORM_ROOT_FILES = new Map<string, ParsedTerraformBlock["kind"]>([
  ["outputs.tf", "output"],
  ["provider.tf", "provider"],
  ["variables.tf", "variable"],
  ["versions.tf", "terraform"],
]);

function normalizeTerraformSourceFiles(request: {
  readonly hcl?: string;
  readonly files?: Readonly<Record<string, string>>;
}): { readonly inputDigest: string; readonly files: Readonly<Record<string, string>>; readonly validLayout: boolean } {
  const files: Record<string, string> =
    request.files !== undefined
      ? Object.fromEntries(Object.entries(request.files).sort(([a], [b]) => a.localeCompare(b)))
      : { "main.tf": request.hcl ?? "" };
  const inputDigest =
    request.files !== undefined
      ? calculatePolicyValidationDigest(files)
      : createHash("sha256")
          .update(request.hcl ?? "")
          .digest("hex");
  let validLayout = Object.hasOwn(files, "main.tf");
  for (const [path, content] of Object.entries(files)) {
    if (path === ".terraform.lock.hcl" || path === "main.tf") continue;
    if (/\.tf\.json$/iu.test(path) || /(?:^|\/)override\.tf$/iu.test(path) || /_override\.tf$/iu.test(path)) {
      validLayout = false;
      break;
    }
    const expectedBlockKind = ALLOWED_TERRAFORM_ROOT_FILES.get(path);
    if (expectedBlockKind === undefined) {
      validLayout = false;
      break;
    }
    const auxBlocks = parseTerraformBlocks(content);
    if (auxBlocks === undefined || auxBlocks.some(({ kind }) => kind !== expectedBlockKind)) {
      validLayout = false;
      break;
    }
  }
  return { inputDigest, files, validLayout };
}

export function validateTerraformResourceParity(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly binding?: IacBindingV1;
  readonly hcl?: string;
  readonly files?: Readonly<Record<string, string>>;
}): NonNullable<NativeValidationReceiptV1["resourceParity"]> {
  assertPolicyValidationJson(request.manifest);
  if (request.binding !== undefined) {
    assertPolicyValidationJson(request.binding);
    if (
      !Value.Check(IacBindingV1Schema, request.binding) ||
      request.binding.track !== "terraform" ||
      request.binding.projectId !== request.manifest.projectId ||
      request.binding.runId !== request.manifest.runId
    )
      throw new TypeError("RESOURCE_PARITY_INVALID_INPUT");
  }
  const totalBytes =
    request.files !== undefined
      ? Object.values(request.files).reduce((sum, text) => sum + Buffer.byteLength(text), 0)
      : typeof request.hcl === "string"
        ? Buffer.byteLength(request.hcl)
        : POLICY_VALIDATION_LIMITS.bytes + 1;
  if (
    !Value.Check(LogicalResourceManifestV1Schema, request.manifest) ||
    request.manifest.track !== "terraform" ||
    request.manifest.resources.length > 1000 ||
    !/^[a-f0-9]{64}$/.test(request.sourceHash) ||
    (request.files === undefined && typeof request.hcl !== "string") ||
    totalBytes > POLICY_VALIDATION_LIMITS.bytes
  )
    throw new TypeError("RESOURCE_PARITY_INVALID_INPUT");
  const sourceSet = normalizeTerraformSourceFiles(request);
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
    coverage: "terraform-symbolic-resource-parity-v1" as const,
    sourceHash: request.sourceHash,
    manifestHash: calculatePolicyValidationDigest(request.manifest),
    ...(request.binding === undefined ? {} : { bindingHash: calculatePolicyValidationDigest(request.binding) }),
    inputHash: sourceSet.inputDigest,
    outcome,
    reason,
  });
  if (!sourceSet.validLayout) return result("unsupported", "unsupported-resource");
  const expected = request.manifest.resources;
  const byId = new Map(expected.map((resource) => [resource.logicalId, resource]));
  if (
    byId.size !== expected.length ||
    new Set(expected.map(({ executionAddress }) => executionAddress)).size !== expected.length ||
    expected.some(
      (resource) =>
        resource.executionAddress === undefined ||
        resource.dependsOn.some((id) => !byId.has(id)) ||
        JSON.stringify([...resource.dependsOn].sort()) !== JSON.stringify([...resource.generatedDependencies].sort()),
    )
  ) {
    return result("unsupported", "unsupported-resource");
  }
  const blocks = parseTerraformBlocks(sourceSet.files["main.tf"] ?? "");
  if (blocks === undefined) return result("unsupported", "invalid-source");
  if (blocks.some(({ kind }) => kind !== "resource" && kind !== "data" && kind !== "module")) {
    return result("unsupported", "unsupported-resource");
  }
  if (
    blocks.length !== expected.length ||
    expected.some((resource) => blocks.filter(({ address }) => address === resource.executionAddress).length !== 1)
  ) {
    return result("fail", "coverage-mismatch");
  }
  for (const resource of expected) {
    const block = blocks.find(({ address }) => address === resource.executionAddress)!;
    const expectedKind =
      resource.ownership === "existing" ? "data" : resource.implementationKind === "module" ? "module" : "resource";
    if (block.kind !== expectedKind) return result("fail", "type-mismatch");
    const attrs = parseTopLevelHclAttributes(block.body);
    if (attrs === undefined) return result("unsupported", "unsupported-resource");
    const bound = request.binding?.resourceBindings[resource.logicalId];
    if (bound !== undefined && bound.implementation !== resource.implementationAddress) {
      return result("fail", "type-mismatch");
    }
    if (block.kind === "module") {
      const avmMatch = /^avm:([^@\s]+)@([^@\s]+)$/u.exec(resource.implementationAddress);
      if (avmMatch === null) return result("unsupported", "unsupported-resource");
      const sourceAttr = parseHclStringLiteral(attrs.get("source"));
      const versionAttr = parseHclStringLiteral(attrs.get("version"));
      if (sourceAttr === undefined || versionAttr === undefined) return result("unsupported", "unsupported-resource");
      if (
        sourceAttr !== avmMatch[1] ||
        versionAttr.replace(/^=\s*/u, "") !== avmMatch[2]!.replace(/^=\s*/u, "") ||
        (bound !== undefined && bound.version !== avmMatch[2])
      ) {
        return result("fail", "type-mismatch");
      }
    } else if (block.blockType === "azapi_resource") {
      const nativeMatch = /^native:([^@\s]+)@([^@\s]+)$/u.exec(resource.implementationAddress);
      if (nativeMatch === null) return result("unsupported", "unsupported-resource");
      const typeAttr = parseHclStringLiteral(attrs.get("type"));
      if (typeAttr === undefined) return result("unsupported", "unsupported-resource");
      if (
        typeAttr.toLowerCase() !== `${nativeMatch[1]!}@${nativeMatch[2]!}`.toLowerCase() ||
        nativeMatch[1]!.toLowerCase() !== resource.type.toLowerCase() ||
        (bound !== undefined && bound.version !== nativeMatch[2])
      ) {
        return result("fail", "type-mismatch");
      }
    } else {
      return result("unsupported", "unsupported-resource");
    }
    if (resource.ownership !== "existing") {
      const expectedDeps = resource.dependsOn.map((id) => byId.get(id)!.executionAddress!).sort();
      if (JSON.stringify([...block.dependsOn].sort()) !== JSON.stringify(expectedDeps)) {
        return result("fail", "dependency-mismatch");
      }
    }
  }
  return result("pass", "matched");
}

export function validateTerraformStorageBaseline(request: {
  readonly sourceHash: string;
  readonly manifest: LogicalResourceManifestV1;
  readonly binding: IacBindingV1;
  readonly hcl?: string;
  readonly files?: Readonly<Record<string, string>>;
}): NonNullable<NativeValidationReceiptV1["securityBaseline"]> {
  const parity = validateTerraformResourceParity(request);
  const result = (
    outcome: "pass" | "fail" | "unsupported",
    reason:
      | "matched"
      | "resource-parity"
      | "unsupported-resource"
      | "credential-content"
      | "storage-controls"
      | "diagnostic-routing",
  ) => ({
    coverage: "terraform-source-baseline-v1" as const,
    sourceHash: request.sourceHash,
    inputHash: parity.inputHash,
    manifestHash: parity.manifestHash,
    bindingHash: calculatePolicyValidationDigest(request.binding),
    outcome,
    reason,
  });
  if (parity.outcome !== "pass") return result(parity.outcome, "resource-parity");
  const sourceSet = normalizeTerraformSourceFiles(request);
  for (const [path, fileText] of Object.entries(sourceSet.files)) {
    if (path === ".terraform.lock.hcl") continue;
    if (SECRET_VALUE_PATTERN.test(fileText)) return result("fail", "credential-content");
    for (const rawLine of stripHclComments(fileText).split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      const match = /^"?([A-Za-z_][A-Za-z0-9_-]*)"?\s*=\s*"([^"]+)"\s*,?$/u.exec(line);
      if (match !== null && isSecretBearingField(match[1]!, match[2]!)) {
        return result("fail", "credential-content");
      }
    }
  }
  const blocks = parseTerraformBlocks(sourceSet.files["main.tf"] ?? "");
  if (blocks === undefined) return result("unsupported", "unsupported-resource");
  for (const resource of request.manifest.resources) {
    if (resource.ownership !== "managed" || resource.type.toLowerCase() !== "microsoft.storage/storageaccounts") {
      continue;
    }
    const block = blocks.find(({ address }) => address === resource.executionAddress);
    if (block === undefined) return result("fail", "storage-controls");
    const attrs = parseTopLevelHclAttributes(block.body);
    if (attrs === undefined) return result("unsupported", "unsupported-resource");
    if (block.kind === "module") {
      const expectedModuleControls: readonly (readonly [string, string])[] = [
        ["allow_nested_items_to_be_public", "false"],
        ["https_traffic_only_enabled", "true"],
        ["min_tls_version", '"TLS1_2"'],
        ["shared_access_key_enabled", "false"],
      ];
      for (const [key, expectedRaw] of expectedModuleControls) {
        const raw = attrs.get(key);
        if (raw === undefined) return result("fail", "storage-controls");
        if (raw !== "true" && raw !== "false" && parseHclStringLiteral(raw) === undefined) {
          return result("unsupported", "unsupported-resource");
        }
        if (raw !== expectedRaw) return result("fail", "storage-controls");
      }
    } else if (block.blockType === "azapi_resource") {
      const rawBody = attrs.get("body");
      if (rawBody === undefined || !rawBody.startsWith("{") || !rawBody.endsWith("}")) {
        return result("unsupported", "unsupported-resource");
      }
      const bodyAttrs = parseTopLevelHclAttributes(rawBody.slice(1, -1));
      const rawProps = bodyAttrs?.get("properties");
      if (rawProps === undefined || !rawProps.startsWith("{") || !rawProps.endsWith("}")) {
        return result("unsupported", "unsupported-resource");
      }
      const propAttrs = parseTopLevelHclAttributes(rawProps.slice(1, -1));
      if (propAttrs === undefined) return result("unsupported", "unsupported-resource");
      const expectedAzapiControls: readonly (readonly [string, string])[] = [
        ["allowBlobPublicAccess", "false"],
        ["allowSharedKeyAccess", "false"],
        ["minimumTlsVersion", '"TLS1_2"'],
        ["supportsHttpsTrafficOnly", "true"],
      ];
      for (const [key, expectedRaw] of expectedAzapiControls) {
        const raw = propAttrs.get(key);
        if (raw === undefined) return result("fail", "storage-controls");
        if (raw !== "true" && raw !== "false" && parseHclStringLiteral(raw) === undefined) {
          return result("unsupported", "unsupported-resource");
        }
        if (raw !== expectedRaw) return result("fail", "storage-controls");
      }
    }
  }
  return result("pass", "matched");
}

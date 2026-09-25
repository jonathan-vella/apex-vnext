import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  POLICY_VALIDATION_LIMITS,
  PolicyValidationV1Schema,
  assertPolicyValidationJson,
  calculatePolicyValidationDigest,
  calculatePolicyValidationHash,
  hasValidPolicyValidation,
  type PolicyPropertyMapV1,
  type LogicalResourceManifestV1,
  type IacBindingV1,
} from "@apexops/contracts";
import {
  validatePolicyProperties,
  validateBicepResourceParity,
  validateBicepStorageDiagnostics,
  validateBicepStorageBaseline,
  validateStorageSecurityProperties,
  validateStorageSecurityBindings,
  type PolicyValidationInput,
} from "../policy-validation.js";

const hash = "a".repeat(64);

function terraformSource(values: Record<string, unknown>) {
  const identity = {
    address: "azurerm_storage_account.main",
    mode: "managed",
    type: "azurerm_storage_account",
    name: "main",
    provider_name: "registry.terraform.io/hashicorp/azurerm",
  };
  const after = { id: "/resources/storage", ...values };
  return {
    format_version: "1.2",
    terraform_version: "1.9.8",
    planned_values: { root_module: { resources: [{ ...identity, schema_version: 4, values: after }] } },
    resource_changes: [{ ...identity, change: { actions: ["no-op"], before: after, after, after_unknown: {} } }],
  };
}

function nestedValue(depth: number): unknown {
  let value: unknown = true;
  for (let index = 0; index < depth; index++) value = { nested: value };
  return value;
}

function input(track: "bicep" | "terraform"): PolicyValidationInput {
  const mappings: PolicyPropertyMapV1["mappings"] = ["deny", "modify", "deployIfNotExists"].map((effect, index) => ({
    policyAssignmentId: "/assignments/baseline",
    policyDefinitionId: `/definitions/${index}`,
    policyDefinitionReferenceId: `member-${index}`,
    effect: effect as PolicyPropertyMapV1["mappings"][number]["effect"],
    logicalResourceId: "storage",
    propertyPath: "properties.security.enabled",
    expectedValue: true,
    disposition: "planned",
  }));
  return {
    track,
    sourceHash: hash,
    policyMapHash: "b".repeat(64),
    policyMap: { schemaVersion: "1.0.0", projectId: "policy-test", runId: "run-1", governanceHash: hash, mappings },
    logicalResourceManifest: {
      storage: { physicalId: "/resources/storage", codeSymbol: "azurerm_storage_account.main" },
    },
    json: JSON.stringify(
      track === "bicep"
        ? { resources: [{ id: "/resources/storage", properties: { security: { enabled: true } } }] }
        : terraformSource({ properties: { security: { enabled: true } } }),
    ),
  };
}

describe("bounded policy property validation", () => {
  it("storage-only baseline requires complete resource coverage, controls and accepted diagnostic scopes", () => {
    const workspaceId =
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/log";
    const accountType = "Microsoft.Storage/storageAccounts";
    const resources: Record<string, Record<string, unknown>> = {
      storage: {
        type: accountType,
        name: "apexfixture",
        identity: { type: "SystemAssigned" },
        properties: {
          minimumTlsVersion: "TLS1_2",
          supportsHttpsTrafficOnly: true,
          allowBlobPublicAccess: false,
          allowSharedKeyAccess: false,
          publicNetworkAccess: "Disabled",
          defaultToOAuthAuthentication: true,
          networkAcls: { defaultAction: "Deny", bypass: "None", ipRules: [], virtualNetworkRules: [] },
          encryption: {
            keySource: "Microsoft.Storage",
            requireInfrastructureEncryption: true,
            services: { blob: { enabled: true }, file: { enabled: true } },
          },
        },
      },
    };
    const entry = (id: string, type: string, dependsOn: string[]) => ({
      logicalId: id,
      type,
      implementationAddress: `native:${type}@2023-05-01`,
      executionAddress: id,
      implementationKind: "resource" as const,
      ownership: "managed" as const,
      dependsOn,
      generatedDependencies: dependsOn,
      sourcePath: "main.bicep",
    });
    const manifest: LogicalResourceManifestV1 = {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: "run",
      track: "bicep",
      resources: [entry("storage", accountType, [])],
    };
    const binding: IacBindingV1 = {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: "run",
      track: "bicep",
      intentHash: hash,
      resourceBindings: {
        storage: {
          implementation: manifest.resources[0]!.implementationAddress,
          version: "2023-05-01",
          parameters: { name: "apexfixture" },
        },
      },
    };
    for (const service of ["blobServices", "fileServices", "queueServices", "tableServices"]) {
      const type = `${accountType}/${service}`;
      const diagnostic = `${service}Diagnostic`;
      manifest.resources.push(
        entry(service, type, ["storage"]),
        entry(diagnostic, "Microsoft.Insights/diagnosticSettings", [service]),
      );
      binding.resourceBindings[service] = {
        implementation: `native:${type}@2023-05-01`,
        version: "2023-05-01",
        parameters: { name: "apexfixture/default" },
      };
      binding.resourceBindings[diagnostic] = {
        implementation: "native:Microsoft.Insights/diagnosticSettings@2023-05-01",
        version: "2023-05-01",
        scopeLogicalId: service,
        parameters: { name: "logs", properties: { workspaceId } },
      };
      resources[service] = { type, name: "apexfixture/default", dependsOn: ["storage"] };
      resources[diagnostic] = {
        type: "Microsoft.Insights/diagnosticSettings",
        name: "logs",
        dependsOn: [service],
        scope: `[resourceId('${type}', 'apexfixture', 'default')]`,
        properties: {
          workspaceId,
          logs: [{ categoryGroup: "allLogs", enabled: true }],
          metrics: [{ category: "Transaction", enabled: true }],
        },
      };
    }
    const check = (source: unknown) =>
      validateBicepStorageBaseline({ sourceHash: hash, manifest, binding, json: JSON.stringify(source) });
    assert.equal(check({ resources }).outcome, "pass");
    for (const [key, value] of [
      ["allowSharedKeyAccess", true],
      ["publicNetworkAccess", "Enabled"],
      ["defaultToOAuthAuthentication", false],
      ["encryption", {}],
      ["networkAcls", {}],
    ] as const) {
      const changed = structuredClone(resources);
      (changed.storage!.properties as Record<string, unknown>)[key] = value;
      assert.notEqual(check({ resources: changed }).outcome, "pass");
    }
    for (const key of Object.keys(resources.storage!.properties as object)) {
      const changed = structuredClone(resources);
      delete (changed.storage!.properties as Record<string, unknown>)[key];
      assert.notEqual(check({ resources: changed }).outcome, "pass", key);
    }
    const noIdentity = structuredClone(resources);
    delete noIdentity.storage!.identity;
    assert.notEqual(check({ resources: noIdentity }).outcome, "pass");
    for (const section of ["outputs", "variables", "parameters", "functions"]) {
      assert.equal(check({ resources, [section]: { unchecked: "value" } }).outcome, "unsupported");
    }
    for (const property of ["isLocalUserEnabled", "isSftpEnabled", "unknownControl"]) {
      const changed = structuredClone(resources);
      (changed.storage!.properties as Record<string, unknown>)[property] = true;
      assert.equal(check({ resources: changed }).outcome, "unsupported");
    }
    const unreviewedService = structuredClone(resources);
    unreviewedService.blobServices!.properties = { cors: { corsRules: [{ allowedOrigins: ["*"] }] } };
    assert.equal(check({ resources: unreviewedService }).outcome, "unsupported");
    const unsupportedManifest = structuredClone(manifest);
    unsupportedManifest.resources.push(entry("foreign", "Microsoft.KeyVault/vaults", []));
    assert.equal(
      validateBicepStorageBaseline({
        sourceHash: hash,
        manifest: unsupportedManifest,
        binding,
        json: JSON.stringify({ resources: { ...resources, foreign: { type: "Microsoft.KeyVault/vaults" } } }),
      }).reason,
      "unsupported-resource",
    );
    assert.equal(
      check({ resources, outputs: { private: { type: "string", value: "AccountKey=must-not-leak" } } }).reason,
      "credential-content",
    );
    const missing = structuredClone(resources);
    delete missing.blobServicesDiagnostic;
    assert.notEqual(check({ resources: missing }).outcome, "pass");
    const changed = structuredClone(resources);
    (changed.blobServicesDiagnostic!.properties as Record<string, unknown>).workspaceId = `${workspaceId}foreign`;
    assert.equal(check({ resources: changed }).reason, "diagnostic-routing");
  });

  it("storage diagnostics require all service scopes and the exact accepted workspace", () => {
    const workspaceResourceId =
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/log";
    const resources: Record<string, Record<string, unknown>> = {
      storage: { type: "Microsoft.Storage/storageAccounts", name: "apexfixture" },
    };
    for (const service of ["blobServices", "fileServices", "queueServices", "tableServices"]) {
      const type = `Microsoft.Storage/storageAccounts/${service}`;
      resources[service] = { type, name: "[format('{0}/{1}', 'apexfixture', 'default')]", dependsOn: ["storage"] };
      resources[`${service}Diagnostic`] = {
        type: "Microsoft.Insights/diagnosticSettings",
        scope: `[resourceId('${type}', 'apexfixture', 'default')]`,
        dependsOn: [service],
        properties: {
          workspaceId: workspaceResourceId,
          logs: [{ categoryGroup: "allLogs", enabled: true }],
          metrics: [{ category: "Transaction", enabled: true }],
        },
      };
    }
    const check = (source: unknown) =>
      validateBicepStorageDiagnostics({
        sourceHash: hash,
        binding: { codeSymbol: "storage" },
        workspaceResourceId,
        json: JSON.stringify(source),
      });
    const receipt = check({ resources });
    assert.equal(receipt.outcome, "pass");
    const fullNames = structuredClone(resources);
    for (const service of ["blobServices", "fileServices", "queueServices", "tableServices"]) {
      fullNames[service]!.name = "apexfixture/default";
      fullNames[`${service}Diagnostic`]!.scope =
        `[resourceId('Microsoft.Storage/storageAccounts/${service}', split('apexfixture/default', '/')[0], split('apexfixture/default', '/')[1])]`;
    }
    assert.equal(check({ resources: fullNames }).outcome, "pass");
    fullNames.blobServicesDiagnostic!.scope = String(fullNames.blobServicesDiagnostic!.scope).replace("[1]", "[0]");
    assert.notEqual(check({ resources: fullNames }).outcome, "pass");
    assert.equal(receipt.fullBaselineEvaluated, false);
    assert.doesNotMatch(JSON.stringify(receipt), /apexfixture|subscriptions/);
    for (const mutation of [
      "missing-service",
      "missing-setting",
      "wrong-scope",
      "wrong-workspace",
      "disabled-log",
      "disabled-metric",
      "condition",
      "missing-dependency",
    ]) {
      const changed = structuredClone(resources);
      const setting = changed.blobServicesDiagnostic!;
      const properties = setting.properties as {
        workspaceId: string;
        logs: Array<{ enabled: boolean }>;
        metrics: Array<{ enabled: boolean }>;
      };
      if (mutation === "missing-service") delete changed.blobServices;
      if (mutation === "missing-setting") delete changed.blobServicesDiagnostic;
      if (mutation === "wrong-scope") setting.scope = String(setting.scope).replace("apexfixture", "foreignaccount");
      if (mutation === "wrong-workspace") properties.workspaceId += "foreign";
      if (mutation === "disabled-log") properties.logs[0]!.enabled = false;
      if (mutation === "disabled-metric") properties.metrics[0]!.enabled = false;
      if (mutation === "condition") setting.condition = false;
      if (mutation === "missing-dependency") setting.dependsOn = [];
      assert.notEqual(check({ resources: changed }).outcome, "pass", mutation);
    }
    assert.equal(
      check({ resources: { ...resources, storage: { ...resources.storage, name: "[parameters('name')]" } } }).outcome,
      "unsupported",
    );
    assert.equal(check({}).reason, "invalid-source");
  });

  it("compiled Bicep parity checks exact resource coverage, types and dependencies", () => {
    const resource = {
      logicalId: "storage",
      type: "Microsoft.Storage/storageAccounts",
      implementationAddress: "native",
      executionAddress: "storage",
      implementationKind: "resource" as const,
      ownership: "managed" as const,
      dependsOn: [] as string[],
      generatedDependencies: [] as string[],
      sourcePath: "main.bicep",
    };
    const manifest: LogicalResourceManifestV1 = {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: "run",
      track: "bicep",
      resources: [
        resource,
        {
          ...resource,
          logicalId: "second",
          executionAddress: "second",
          dependsOn: ["storage"],
          generatedDependencies: ["storage"],
        },
      ],
    };
    const resources = { storage: { type: resource.type }, second: { type: resource.type, dependsOn: ["storage"] } };
    const check = (source: unknown, expected = manifest) =>
      validateBicepResourceParity({ sourceHash: hash, manifest: expected, json: JSON.stringify(source) });
    assert.equal(check({ resources }).outcome, "pass");
    assert.equal(check({ resources: { ...resources, extra: { type: resource.type } } }).reason, "coverage-mismatch");
    assert.equal(check({ resources: { storage: resources.storage } }).reason, "coverage-mismatch");
    assert.equal(
      check({ resources: { ...resources, storage: { type: "Microsoft.KeyVault/vaults" } } }).reason,
      "type-mismatch",
    );
    assert.equal(check({ resources: { ...resources, second: { type: resource.type } } }).reason, "dependency-mismatch");
    assert.equal(
      check({ resources: { ...resources, second: { type: resource.type, dependsOn: ["[resourceId('x','y')]"] } } })
        .outcome,
      "unsupported",
    );
    for (const patch of [{ condition: true }, { copy: {} }, { scope: "[resourceGroup().id]" }, { existing: true }])
      assert.equal(
        check({ resources: { ...resources, storage: { ...resources.storage, ...patch } } }).outcome,
        "unsupported",
      );
    assert.equal(
      check({ resources }, { ...manifest, resources: [{ ...resource, ownership: "existing" }] }).outcome,
      "unsupported",
    );
    assert.equal(check({ resources: [] }).outcome, "fail");
    assert.equal(
      validateBicepResourceParity({ sourceHash: hash, manifest, json: "not JSON" }).reason,
      "invalid-source",
    );
    assert.equal(check({ resources }).manifestHash, calculatePolicyValidationDigest(manifest));
  });

  it("compiled diagnostic parity requires the exact accepted scope binding", () => {
    const targetType = "Microsoft.Storage/storageAccounts/blobServices";
    const diagnosticType = "Microsoft.Insights/diagnosticSettings";
    const target = {
      logicalId: "blob",
      type: targetType,
      implementationAddress: `native:${targetType}@2023-05-01`,
      executionAddress: "blob",
      implementationKind: "resource" as const,
      ownership: "managed" as const,
      dependsOn: [] as string[],
      generatedDependencies: [] as string[],
      sourcePath: "main.bicep",
    };
    const manifest: LogicalResourceManifestV1 = {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: "run",
      track: "bicep",
      resources: [
        target,
        {
          ...target,
          logicalId: "diag",
          type: diagnosticType,
          implementationAddress: `native:${diagnosticType}@2021-05-01-preview`,
          executionAddress: "diag",
          dependsOn: ["blob"],
          generatedDependencies: ["blob"],
        },
      ],
    };
    const binding: IacBindingV1 = {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: "run",
      track: "bicep",
      intentHash: hash,
      resourceBindings: {
        blob: {
          implementation: target.implementationAddress,
          version: "2023-05-01",
          parameters: { name: "account/default" },
        },
        diag: {
          implementation: manifest.resources[1]!.implementationAddress,
          version: "2021-05-01-preview",
          scopeLogicalId: "blob",
          parameters: { name: "logs" },
        },
      },
    };
    const scope = `[resourceId('${targetType}', split('account/default', '/')[0], split('account/default', '/')[1])]`;
    const resources = {
      blob: { type: targetType, name: "account/default" },
      diag: { type: diagnosticType, name: "logs", scope, dependsOn: ["blob"] },
    };
    const check = (source: unknown, selected = binding) =>
      validateBicepResourceParity({ sourceHash: hash, manifest, binding: selected, json: JSON.stringify(source) });
    assert.equal(check({ resources }).outcome, "pass");
    assert.equal(check({ resources }).bindingHash, calculatePolicyValidationDigest(binding));
    assert.equal(
      check({
        resources: {
          ...resources,
          diag: { ...resources.diag, scope: scope.replaceAll("account/default", "foreign/default") },
        },
      }).outcome,
      "fail",
    );
    assert.equal(
      check({ resources: { ...resources, blob: { ...resources.blob, name: "foreign/default" } } }).outcome,
      "unsupported",
    );
    assert.equal(check({ resources: { ...resources, diag: { ...resources.diag, dependsOn: [] } } }).outcome, "fail");
    const missing = structuredClone(binding);
    delete missing.resourceBindings.diag!.scopeLogicalId;
    assert.equal(check({ resources }, missing).outcome, "unsupported");
    assert.equal(
      validateBicepResourceParity({ sourceHash: hash, manifest, json: JSON.stringify({ resources }) }).outcome,
      "unsupported",
    );
  });

  it("keeps batched storage observations resource-specific and bounded", () => {
    const secure = {
      type: "Microsoft.Storage/storageAccounts",
      properties: {
        minimumTlsVersion: "TLS1_2",
        supportsHttpsTrafficOnly: true,
        allowBlobPublicAccess: false,
        allowSharedKeyAccess: false,
      },
    };
    const source = {
      resources: { secure, insecure: { ...secure, properties: { ...secure.properties, allowSharedKeyAccess: true } } },
    };
    const request = {
      track: "bicep" as const,
      sourceHash: hash,
      json: JSON.stringify(source),
      bindings: { secure: { codeSymbol: "secure" }, insecure: { codeSymbol: "insecure" } },
    };
    const result = validateStorageSecurityBindings(request);
    assert.equal(result.secure!.outcome, "pass");
    assert.equal(result.insecure!.outcome, "fail");
    assert.equal(result.secure!.inputHash, result.insecure!.inputHash);
    assert.notEqual(result.secure!.bindingHash, result.insecure!.bindingHash);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.secure!.results));
    assert.throws(
      () =>
        validateStorageSecurityBindings({
          ...request,
          bindings: Object.fromEntries(
            Array.from({ length: 1001 }, (_, index) => [`storage${index}`, { codeSymbol: "secure" }]),
          ),
        }),
      /INVALID_INPUT/,
    );
  });

  it("reports storage property hardening without claiming full security-baseline coverage", () => {
    for (const track of ["bicep", "terraform"] as const) {
      const source = (insecure = false, foreign = false) => {
        if (track === "bicep")
          return {
            resources: {
              storage: {
                type: foreign ? "Microsoft.KeyVault/vaults" : "Microsoft.Storage/storageAccounts",
                properties: {
                  minimumTlsVersion: "TLS1_2",
                  supportsHttpsTrafficOnly: true,
                  allowBlobPublicAccess: false,
                  allowSharedKeyAccess: insecure,
                },
              },
            },
          };
        const plan = terraformSource({
          min_tls_version: "TLS1_2",
          https_traffic_only_enabled: true,
          allow_nested_items_to_be_public: false,
          shared_access_key_enabled: insecure,
        });
        if (foreign) plan.planned_values.root_module.resources[0]!.type = "azurerm_key_vault";
        return plan;
      };
      const binding =
        track === "bicep" ? { codeSymbol: "storage" } : { terraformAddress: "azurerm_storage_account.main" };
      const request = { track, sourceHash: hash, binding, json: JSON.stringify(source()) };
      const result = validateStorageSecurityProperties(request);
      assert.equal(result.outcome, "pass");
      assert.equal(result.coverage, "storage-account-property-hardening-v1");
      assert.equal(result.fullBaselineEvaluated, false);
      assert.equal(result.results.length, 4);
      assert.ok(result.results.every(({ outcome }) => outcome === "pass"));
      assert.equal(result.bindingHash, calculatePolicyValidationDigest(binding));
      assert.equal(
        validateStorageSecurityProperties({ ...request, json: JSON.stringify(source(true)) }).outcome,
        "fail",
      );
      assert.equal(
        validateStorageSecurityProperties({ ...request, json: JSON.stringify(source(false, true)) }).outcome,
        "unsupported",
      );
    }
  });

  it("storage hardening requires every concrete property on the exact resource", () => {
    const bicepProperties: Record<string, unknown> = {
      minimumTlsVersion: "TLS1_2",
      supportsHttpsTrafficOnly: true,
      allowBlobPublicAccess: false,
      allowSharedKeyAccess: false,
    };
    const terraformProperties: Record<string, unknown> = {
      min_tls_version: "TLS1_2",
      https_traffic_only_enabled: true,
      allow_nested_items_to_be_public: false,
      shared_access_key_enabled: false,
    };
    for (const track of ["bicep", "terraform"] as const) {
      const binding =
        track === "bicep" ? { codeSymbol: "storage" } : { terraformAddress: "azurerm_storage_account.main" };
      const makeSource = (values: Record<string, unknown>, unknown = false) => {
        if (track === "bicep")
          return {
            resources: {
              storage: { type: "Microsoft.Storage/storageAccounts", properties: values },
              sibling: { type: "Microsoft.Storage/storageAccounts", properties: bicepProperties },
            },
          };
        const plan = terraformSource(values);
        if (unknown) plan.resource_changes[0]!.change.after_unknown = { shared_access_key_enabled: true };
        return plan;
      };
      const valid = track === "bicep" ? bicepProperties : terraformProperties;
      const evaluate = (json: string) => validateStorageSecurityProperties({ track, binding, sourceHash: hash, json });
      for (const property of Object.keys(valid)) {
        const missing = { ...valid };
        delete missing[property];
        const result = evaluate(JSON.stringify(makeSource(missing)));
        assert.equal(result.outcome, "fail");
        assert.ok(result.results.some(({ reason }) => reason === "missing-property"));
        for (const bad of [null, "private-value-must-not-leak", {}, []]) {
          const failed = evaluate(JSON.stringify(makeSource({ ...valid, [property]: bad })));
          assert.equal(failed.outcome, "fail");
          assert.equal(JSON.stringify(failed).includes("private-value-must-not-leak"), false);
        }
      }
      assert.equal(evaluate("invalid-json").outcome, "unsupported");
      assert.equal(evaluate("{}").outcome, "unsupported");
      if (track === "bicep") {
        const unresolved = makeSource({ ...valid, allowSharedKeyAccess: "[parameters('sharedKey')]" });
        assert.equal(evaluate(JSON.stringify(unresolved)).outcome, "unsupported");
      } else {
        assert.equal(evaluate(JSON.stringify(makeSource(valid, true))).outcome, "unsupported");
        const duplicate = terraformSource(valid);
        duplicate.planned_values.root_module.resources.push(duplicate.planned_values.root_module.resources[0]!);
        assert.equal(evaluate(JSON.stringify(duplicate)).results[0]!.reason, "ambiguous-resource");
        const wrongType = terraformSource(valid);
        wrongType.resource_changes[0]!.type = "azurerm_key_vault";
        assert.equal(evaluate(JSON.stringify(wrongType)).outcome, "unsupported");
      }
      assert.throws(
        () =>
          validateStorageSecurityProperties({ track, sourceHash: hash, binding: nestedValue(80) as never, json: "{}" }),
        /LIMIT_EXCEEDED/,
      );
      assert.throws(
        () => validateStorageSecurityProperties({ track, sourceHash: "bad", binding, json: "{}" }),
        /INVALID_INPUT/,
      );
    }
  });

  for (const track of ["bicep", "terraform"] as const) {
    it(`${track}: requires an exact physical ID whenever the binding supplies one`, () => {
      const request = input(track);
      for (const physicalId of ["/resources/storage", "/resources/other", "/RESOURCES/storage", undefined]) {
        const values = { properties: { security: { enabled: true } } };
        const source = terraformSource(values);
        const resourceValues: Record<string, unknown> = source.planned_values.root_module.resources[0]!.values;
        if (physicalId === undefined) delete resourceValues.id;
        else resourceValues.id = physicalId;
        const json = JSON.stringify(
          track === "terraform"
            ? source
            : {
                languageVersion: "2.0",
                resources: {
                  "azurerm_storage_account.main": {
                    ...values,
                    ...(physicalId === undefined ? {} : { id: physicalId }),
                  },
                },
              },
        );
        const receipt = validatePolicyProperties({ ...request, json });
        assert.equal(receipt.outcome, physicalId === "/resources/storage" ? "pass" : "unsupported");
        assert.equal(
          validatePolicyProperties({
            ...request,
            json,
            logicalResourceManifest: { storage: { codeSymbol: "azurerm_storage_account.main" } },
          }).outcome,
          "pass",
        );
      }
      assert.equal(
        validatePolicyProperties({
          ...request,
          logicalResourceManifest: { storage: { codeSymbol: "azurerm_storage_account.main", physicalId: "" } },
        }).outcome,
        "unsupported",
      );
    });

    it(`${track}: rejects deeply nested expected values and manifests before recursive work`, () => {
      const request = input(track);
      request.policyMap.mappings[0]!.expectedValue = nestedValue(6000);
      assert.throws(() => validatePolicyProperties(request), {
        name: "TypeError",
        message: "POLICY_VALIDATION_LIMIT_EXCEEDED",
      });
      assert.throws(
        () =>
          validatePolicyProperties({
            ...input(track),
            logicalResourceManifest: { storage: nestedValue(6000) } as PolicyValidationInput["logicalResourceManifest"],
          }),
        { name: "TypeError", message: "POLICY_VALIDATION_LIMIT_EXCEEDED" },
      );
    });

    it(`${track}: treats 66KB deeply nested observed JSON as unsupported`, () => {
      const request = input(track);
      const json = request.json.replaceAll(
        '"enabled":true',
        `"enabled":${'{"nested":'.repeat(6000)}true${"}".repeat(6000)}`,
      );
      assert.ok(Buffer.byteLength(json) >= 66_000);
      const receipt = validatePolicyProperties({ ...request, json });
      assert.equal(receipt.outcome, "unsupported");
      assert.equal(receipt.results[0]!.reason, "invalid-source");
      assert.equal(hasValidPolicyValidation(receipt, receipt), true);
    });

    it(`${track}: checks every deny, modify and DINE mapping and validates the receipt`, () => {
      const request = input(track);
      const receipt = validatePolicyProperties(request);
      assert.equal(receipt.outcome, "pass");
      assert.deepEqual(
        receipt.results.map(({ outcome }) => outcome),
        ["pass", "pass", "pass"],
      );
      assert.equal(Value.Check(PolicyValidationV1Schema, receipt), true);
      assert.equal(hasValidPolicyValidation(receipt, receipt), true);
      assert.equal(hasValidPolicyValidation(receipt, { ...receipt, sourceHash: "c".repeat(64) }), false);
      assert.equal(hasValidPolicyValidation(receipt, { ...receipt, policyMapHash: "c".repeat(64) }), false);
      assert.deepEqual(validatePolicyProperties(request), receipt);
    });

    it(`${track}: fails mismatches and missing properties without recording raw values`, () => {
      const request = input(track);
      request.policyMap.mappings[0]!.expectedValue = "sensitive-expected-value";
      request.policyMap.mappings[1]!.propertyPath = "properties.missing";
      const receipt = validatePolicyProperties(request);
      assert.equal(receipt.outcome, "fail");
      assert.deepEqual(
        receipt.results.map(({ outcome }) => outcome),
        ["fail", "fail", "pass"],
      );
      assert.equal(JSON.stringify(receipt).includes("sensitive-expected-value"), false);
    });

    it(`${track}: absent expectedValue and unverified exemptions cannot pass`, () => {
      const request = input(track);
      delete request.policyMap.mappings[0]!.expectedValue;
      request.policyMap.mappings[1]!.disposition = "exempt";
      request.policyMap.mappings[2]!.disposition = "blocked";
      const receipt = validatePolicyProperties(request);
      assert.deepEqual(
        receipt.results.map(({ outcome }) => outcome),
        ["unsupported", "unsupported", "fail"],
      );
      assert.equal(receipt.outcome, "fail");
    });

    it(`${track}: not-applicable rows and platform-remediated effects pass without a property check`, () => {
      const request = input(track);
      request.policyMap.mappings[0]!.disposition = "not-applicable";
      request.policyMap.mappings[0]!.reason = "No designed resource has this type";
      request.policyMap.mappings[1]!.effect = "deployIfNotExists";
      delete request.policyMap.mappings[1]!.expectedValue;
      request.policyMap.mappings[2]!.effect = "deny";
      delete request.policyMap.mappings[2]!.expectedValue;
      const receipt = validatePolicyProperties(request);
      assert.deepEqual(
        receipt.results.map(({ outcome, reason }) => [outcome, reason]),
        [
          ["pass", "not-applicable"],
          ["pass", "platform-remediated"],
          ["unsupported", "missing-expected-value"],
        ],
      );
      assert.equal(hasValidPolicyValidation(receipt, receipt), true);
    });

    it(`${track}: out-of-scope logical resources and dangerous paths are unsupported`, () => {
      const request = input(track);
      request.policyMap.mappings[0]!.logicalResourceId = "logresource";
      request.policyMap.mappings[1]!.propertyPath = "properties.__proto__.enabled";
      request.policyMap.mappings[2]!.propertyPath = "properties.security[0]";
      assert.deepEqual(
        validatePolicyProperties(request).results.map(({ outcome }) => outcome),
        ["unsupported", "unsupported", "unsupported"],
      );
    });

    it(`${track}: preserves distinct same-effect initiative member identities`, () => {
      const request = input(track);
      request.policyMap.mappings[1]!.effect = "deny";
      const receipt = validatePolicyProperties(request);
      assert.equal(receipt.results.length, 3);
      assert.notEqual(receipt.results[0]!.mappingHash, receipt.results[1]!.mappingHash);
      assert.equal(receipt.results[1]!.policyDefinitionReferenceId, "member-1");
    });

    it(`${track}: rejects stale bindings, mutated results and extra receipt fields`, () => {
      const receipt = validatePolicyProperties(input(track));
      for (const field of [
        "sourceHash",
        "policyMapHash",
        "policyMapContentHash",
        "logicalResourceManifestHash",
        "inputHash",
      ] as const) {
        assert.equal(hasValidPolicyValidation(receipt, { ...receipt, [field]: "c".repeat(64) }), false);
      }
      assert.equal(
        hasValidPolicyValidation(receipt, { ...receipt, track: track === "bicep" ? "terraform" : "bicep" }),
        false,
      );
      assert.equal(hasValidPolicyValidation({ ...receipt, results: receipt.results.slice(1) }, receipt), false);
      assert.equal(Value.Check(PolicyValidationV1Schema, { ...receipt, sourceHash: "stale" }), false);
      assert.equal(Value.Check(PolicyValidationV1Schema, { ...receipt, observedValue: "secret" }), false);
      const altered = structuredClone(receipt);
      delete altered.results[0]!.expectedValueDigest;
      const { receiptHash: ignoredHash, ...body } = altered;
      assert.equal(ignoredHash.length, 64);
      altered.receiptHash = calculatePolicyValidationHash(body);
      assert.equal(hasValidPolicyValidation(altered, receipt), false);
      assert.equal(Object.isFrozen(receipt), true);
      assert.equal(Object.isFrozen(receipt.results), true);
      assert.equal(Object.isFrozen(receipt.results[0]), true);
    });

    it(`${track}: binds exact supplied hashes and content without trusting dispositions`, () => {
      const request = input(track);
      request.policyMap.mappings[0]!.disposition = "satisfied";
      request.policyMap.mappings[0]!.expectedValue = false;
      delete request.policyMap.mappings[2]!.policyDefinitionId;
      delete request.policyMap.mappings[2]!.policyDefinitionReferenceId;
      const receipt = validatePolicyProperties(request);
      assert.equal(receipt.results[0]!.outcome, "fail");
      assert.equal(receipt.sourceHash, request.sourceHash);
      assert.equal(receipt.policyMapHash, request.policyMapHash);
      assert.equal(receipt.policyMapContentHash, calculatePolicyValidationDigest(request.policyMap));
      assert.equal(
        receipt.logicalResourceManifestHash,
        calculatePolicyValidationDigest(request.logicalResourceManifest),
      );
      assert.equal(Object.hasOwn(receipt.results[2]!, "policyDefinitionId"), false);
      assert.equal(hasValidPolicyValidation(receipt, receipt), true);
      const reordered = {
        ...request,
        policyMap: { ...request.policyMap, mappings: [...request.policyMap.mappings].reverse() },
      };
      assert.notEqual(validatePolicyProperties(reordered).receiptHash, receipt.receiptHash);
    });

    it(`${track}: treats malformed output and an empty map as unsupported`, () => {
      const request = input(track);
      for (const json of ["not-json secret-value", "[]", "{}", "null"]) {
        const receipt = validatePolicyProperties({ ...request, json });
        assert.equal(receipt.outcome, "unsupported");
        assert.equal(receipt.results[0]!.reason, "invalid-source");
        assert.equal(JSON.stringify(receipt).includes("secret-value"), false);
      }
      request.policyMap.mappings = [];
      const receipt = validatePolicyProperties(request);
      assert.equal(receipt.outcome, "unsupported");
      assert.equal(hasValidPolicyValidation(receipt, receipt), true);
    });

    it(`${track}: rejects prototype, alias, indexed and wildcard paths`, () => {
      for (const propertyPath of [
        "constructor.name",
        "properties.prototype.enabled",
        "properties..enabled",
        "properties.*",
        "properties.security[0]",
        "Microsoft.Storage/storageAccounts/enabled",
      ]) {
        const request = input(track);
        request.policyMap.mappings[0]!.propertyPath = propertyPath;
        assert.equal(validatePolicyProperties(request).results[0]!.reason, "unsupported-path");
      }
    });

    it(`${track}: compares concrete JSON values structurally and omits source secrets`, () => {
      const request = input(track);
      const values = {
        properties: {
          security: { secret: "sensitive-observed-value", enabled: true },
          nullable: null,
          count: 0,
          disabled: false,
          items: ["one", "two"],
        },
      };
      const json = JSON.stringify(
        track === "bicep" ? { resources: [{ id: "/resources/storage", ...values }] } : terraformSource(values),
      );
      for (const [propertyPath, expectedValue] of [
        ["properties.security", { enabled: true, secret: "sensitive-observed-value" }],
        ["properties.nullable", null],
        ["properties.count", 0],
        ["properties.disabled", false],
        ["properties.items", ["one", "two"]],
      ] as const) {
        request.policyMap.mappings[0]!.propertyPath = propertyPath;
        request.policyMap.mappings[0]!.expectedValue = expectedValue;
        const receipt = validatePolicyProperties({ ...request, json });
        assert.equal(receipt.results[0]!.outcome, "pass");
        assert.equal(JSON.stringify(receipt).includes("sensitive-observed-value"), false);
      }
      request.policyMap.mappings[0]!.expectedValue = ["two", "one"];
      assert.equal(validatePolicyProperties({ ...request, json }).results[0]!.outcome, "fail");
    });

    it(`${track}: checks mixed deny, modify and DINE properties independently`, () => {
      const request = input(track);
      const paths = ["properties.minimumTlsVersion", "tags.owner", "properties.diagnostics.enabled"];
      const expected = ["TLS1_2", "operations", true];
      for (const [index, mapping] of request.policyMap.mappings.entries()) {
        mapping.propertyPath = paths[index]!;
        mapping.expectedValue = expected[index];
      }
      const values = {
        properties: { minimumTlsVersion: "TLS1_2", diagnostics: { enabled: true } },
        tags: { owner: "operations" },
      };
      const json = JSON.stringify(
        track === "bicep" ? { resources: [{ id: "/resources/storage", ...values }] } : terraformSource(values),
      );
      assert.equal(validatePolicyProperties({ ...request, json }).outcome, "pass");
      for (const [index, mapping] of request.policyMap.mappings.entries()) {
        mapping.expectedValue = "wrong";
        assert.equal(validatePolicyProperties({ ...request, json }).results[index]!.reason, "value-mismatch");
        mapping.expectedValue = expected[index];
        mapping.propertyPath = "properties.absent";
        assert.equal(validatePolicyProperties({ ...request, json }).results[index]!.reason, "missing-property");
        mapping.propertyPath = paths[index]!;
      }
    });
  }

  it("uses compiled ARM symbolic keys, not inferred resource names", () => {
    const request = input("bicep");
    const logicalResourceManifest = { storage: { codeSymbol: "azurerm_storage_account.main" } };
    const json = JSON.stringify({
      languageVersion: "2.0",
      resources: {
        "azurerm_storage_account.main": {
          type: "Microsoft.Storage/storageAccounts",
          apiVersion: "2025-01-01",
          name: "[parameters('storageName')]",
          properties: { security: { enabled: true } },
        },
      },
    });
    assert.equal(validatePolicyProperties({ ...request, logicalResourceManifest, json }).outcome, "pass");
    assert.equal(validatePolicyProperties({ ...request, json }).results[0]!.reason, "unsupported-resource");
    const nameOnly = JSON.stringify({ resources: [{ name: "storage", properties: { security: { enabled: true } } }] });
    assert.equal(validatePolicyProperties({ ...request, json: nameOnly }).results[0]!.reason, "resource-not-found");
  });

  it("binds Bicep deployment-template children by qualified symbols without crossing siblings", () => {
    const request = input("bicep");
    const deployment = (enabled: unknown) => ({
      type: "Microsoft.Resources/deployments",
      properties: { template: { resources: { storage: { properties: { security: { enabled } } } } } },
    });
    const source = { resources: { primary: deployment(true), sibling: deployment(false) } };
    const evaluate = (codeSymbol: string, json = JSON.stringify(source)) =>
      validatePolicyProperties({
        ...request,
        json,
        logicalResourceManifest: { storage: { codeSymbol } },
      });
    assert.equal(evaluate("primary::storage").outcome, "pass");
    assert.equal(evaluate("sibling::storage").outcome, "fail");
    assert.equal(evaluate("storage").results[0]!.reason, "resource-not-found");
    assert.equal(evaluate("missing::storage").results[0]!.reason, "resource-not-found");
    for (const extra of [{ condition: false }, { condition: "[parameters('enabled')]" }, { copy: { count: 2 } }]) {
      const json = JSON.stringify({ resources: { primary: { ...deployment(true), ...extra } } });
      assert.equal(evaluate("primary::storage", json).results[0]!.reason, "unsupported-resource");
    }
    const unresolved = JSON.stringify({ resources: { primary: deployment("[parameters('security')]") } });
    assert.equal(evaluate("primary::storage", unresolved).results[0]!.reason, "unsupported-expression");
    const nested = {
      resources: { outer: { type: "Microsoft.Resources/deployments", properties: { template: source } } },
    };
    assert.equal(evaluate("outer::primary::storage", JSON.stringify(nested)).outcome, "pass");
    const child = deployment(true).properties.template.resources.storage;
    const ambiguous = { resources: { primary: deployment(true), "primary::storage": child } };
    assert.equal(evaluate("primary::storage", JSON.stringify(ambiguous)).results[0]!.reason, "ambiguous-resource");
    const unnamed = { resources: [{ ...deployment(true), name: "primary" }] };
    assert.equal(evaluate("primary::storage", JSON.stringify(unnamed)).results[0]!.reason, "resource-not-found");
    for (const properties of [{ template: null }, { template: {} }]) {
      assert.equal(
        evaluate(
          "primary::storage",
          JSON.stringify({ resources: { primary: { type: "Microsoft.Resources/deployments", properties } } }),
        ).results[0]!.reason,
        "invalid-source",
      );
    }
    const linked = { ...deployment(true).properties, templateLink: { uri: "https://example.invalid/template.json" } };
    assert.equal(
      evaluate(
        "primary::storage",
        JSON.stringify({ resources: { primary: { type: "Microsoft.Resources/deployments", properties: linked } } }),
      ).results[0]!.reason,
      "unsupported-resource",
    );
  });

  it("rejects ARM expressions at the leaf, ancestor and inside a compared object", () => {
    for (const security of [
      { enabled: "[parameters('secret')]" },
      "[variables('settings')]",
      { enabled: { nested: "[reference('id')]" } },
    ]) {
      const request = input("bicep");
      const receipt = validatePolicyProperties({
        ...request,
        json: JSON.stringify({ resources: [{ id: "/resources/storage", properties: { security } }] }),
      });
      assert.equal(receipt.results[0]!.reason, "unsupported-expression");
      assert.equal(JSON.stringify(receipt).includes("parameters"), false);
    }
  });

  it("rejects ambiguous ARM bindings, loops and conditional resources", () => {
    const request = input("bicep");
    const resource = { id: "/resources/storage", properties: { security: { enabled: true } } };
    assert.equal(
      validatePolicyProperties({ ...request, json: JSON.stringify({ resources: [resource, resource] }) }).results[0]!
        .reason,
      "ambiguous-resource",
    );
    for (const extra of [{ condition: false }, { condition: "[parameters('enabled')]" }, { copy: { count: 2 } }]) {
      assert.equal(
        validatePolicyProperties({ ...request, json: JSON.stringify({ resources: [{ ...resource, ...extra }] }) })
          .results[0]!.reason,
        "unsupported-resource",
      );
    }
  });

  it("uses exact Terraform child-module addresses and honors after_unknown masks", () => {
    const request = input("terraform");
    const address = 'module.storage.azurerm_storage_account.main["east"]';
    const logicalResourceManifest = { storage: { terraformAddress: address } };
    const resource = { address, mode: "managed", values: { properties: { security: { enabled: true } } } };
    const source = {
      planned_values: { root_module: { child_modules: [{ address: "module.storage", resources: [resource] }] } },
      resource_changes: [
        { address, mode: "managed", change: { actions: ["create"], after: resource.values, after_unknown: {} } },
      ],
    };
    assert.equal(
      validatePolicyProperties({ ...request, logicalResourceManifest, json: JSON.stringify(source) }).outcome,
      "pass",
    );
    assert.equal(
      validatePolicyProperties({ ...request, json: JSON.stringify(source) }).results[0]!.reason,
      "resource-not-found",
    );
    for (const after_unknown of [true, { properties: true }, { properties: { security: { enabled: true } } }]) {
      const receipt = validatePolicyProperties({
        ...request,
        logicalResourceManifest,
        json: JSON.stringify({
          ...source,
          resource_changes: [
            { ...source.resource_changes[0], change: { ...source.resource_changes[0]!.change, after_unknown } },
          ],
        }),
      });
      assert.equal(receipt.results[0]!.reason, "unsupported-expression");
    }
  });

  it("does not accept malformed Terraform unknown metadata or unresolved template strings", () => {
    const request = input("terraform");
    const source = terraformSource({ properties: { security: { enabled: true } } });
    for (const after_unknown of [
      "unknown",
      [],
      [true],
      { properties: [true] },
      { properties: { security: { enabled: {} } } },
      { properties: { security: { enabled: "unknown" } } },
    ]) {
      const json = JSON.stringify({
        ...source,
        resource_changes: [
          { ...source.resource_changes[0], change: { ...source.resource_changes[0]!.change, after_unknown } },
        ],
      });
      assert.equal(validatePolicyProperties({ ...request, json }).outcome, "unsupported");
    }
    const json = JSON.stringify(terraformSource({ properties: { security: { enabled: "${var.enabled}" } } }));
    assert.equal(validatePolicyProperties({ ...request, json }).results[0]!.reason, "unsupported-expression");
  });

  it("fails closed on invalid caller contracts without leaking inputs", () => {
    const request = input("bicep");
    assert.throws(() => validatePolicyProperties({ ...request, sourceHash: "bad" }), /POLICY_VALIDATION_INVALID_INPUT/);
    assert.throws(
      () => validatePolicyProperties({ ...request, policyMapHash: "bad" }),
      /POLICY_VALIDATION_INVALID_INPUT/,
    );
    assert.throws(
      () =>
        validatePolicyProperties({
          ...request,
          policyMap: { ...request.policyMap, secret: "sensitive" },
        } as PolicyValidationInput),
      /POLICY_VALIDATION_INVALID_INPUT/,
    );
  });

  it("checks concrete Azure storage properties in Terraform show plan JSON", () => {
    const physicalId =
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-policy/providers/Microsoft.Storage/storageAccounts/stpolicy";
    const source = terraformSource({
      id: physicalId,
      name: "stpolicy",
      resource_group_name: "rg-policy",
      location: "swedencentral",
      account_tier: "Standard",
      account_replication_type: "LRS",
      min_tls_version: "TLS1_2",
      https_traffic_only_enabled: true,
      allow_nested_items_to_be_public: false,
      shared_access_key_enabled: false,
      tags: { owner: "operations" },
    });
    const request = input("terraform");
    request.policyMap.mappings = [
      ["min_tls_version", "TLS1_2"],
      ["https_traffic_only_enabled", true],
      ["allow_nested_items_to_be_public", false],
    ].map(([propertyPath, expectedValue], index) => ({
      ...request.policyMap.mappings[index]!,
      propertyPath: propertyPath as string,
      expectedValue,
    }));
    for (const actions of [["no-op"], ["update"], ["create"], ["delete", "create"], ["create", "delete"]]) {
      source.resource_changes[0]!.change.actions = actions;
      assert.equal(
        validatePolicyProperties({
          ...request,
          logicalResourceManifest: { storage: { terraformAddress: "azurerm_storage_account.main", physicalId } },
          json: JSON.stringify(source),
        }).outcome,
        "pass",
      );
    }
  });

  it("requires complete, unambiguous Terraform change evidence for every evaluated resource", () => {
    const request = input("terraform");
    const source = terraformSource({ properties: { security: { enabled: true } } });
    const change = source.resource_changes[0]!;
    const { resource_changes: omitted, ...withoutChanges } = source;
    assert.equal(omitted.length, 1);
    for (const json of [
      JSON.stringify(withoutChanges),
      ...[
        [],
        [null],
        [{ ...change, address: "azurerm_storage_account.other" }],
        [change, change],
        [{ ...change, mode: "data" }],
        [{ address: change.address, change: change.change }],
        [{ ...change, change: null }],
        ...["actions", "after_unknown", "after"].map((field) => {
          const partial: Record<string, unknown> = { ...change.change };
          delete partial[field];
          return [{ ...change, change: partial }];
        }),
        ...[
          [],
          ["delete"],
          ["read"],
          ["forget"],
          ["invalid"],
          ["create,delete"],
          ["update", "update"],
          "update",
          null,
        ].map((actions) => [{ ...change, change: { ...change.change, actions } }]),
        ...[null, [], false, { id: "/resources/storage", properties: { security: { enabled: false } } }].map(
          (after) => [{ ...change, change: { ...change.change, after } }],
        ),
      ].map((resource_changes) => JSON.stringify({ ...source, resource_changes })),
    ]) {
      const receipt = validatePolicyProperties({ ...request, json });
      assert.equal(receipt.outcome, "unsupported");
      assert.equal(receipt.results[0]!.reason, "unsupported-resource");
    }

    const otherAddress = "azurerm_storage_account.other";
    const secondResource = { ...source.planned_values.root_module.resources[0]!, address: otherAddress };
    source.planned_values.root_module.resources.push(secondResource);
    request.policyMap.mappings[1]!.logicalResourceId = "other";
    const logicalResourceManifest = { ...request.logicalResourceManifest, other: { terraformAddress: otherAddress } };
    assert.deepEqual(
      validatePolicyProperties({ ...request, logicalResourceManifest, json: JSON.stringify(source) }).results.map(
        ({ outcome }) => outcome,
      ),
      ["pass", "unsupported", "pass"],
    );
    source.resource_changes.push({ ...change, address: otherAddress });
    assert.equal(
      validatePolicyProperties({ ...request, logicalResourceManifest, json: JSON.stringify(source) }).outcome,
      "pass",
    );
  });

  it("allows unknown unrelated Terraform properties without treating them as physical-ID evidence", () => {
    const request = input("terraform");
    const source = terraformSource({ properties: { security: { enabled: true } } });
    const values: Record<string, unknown> = { properties: { security: { enabled: true } } };
    const json = JSON.stringify({
      ...source,
      planned_values: { root_module: { resources: [{ ...source.planned_values.root_module.resources[0], values }] } },
      resource_changes: [
        {
          ...source.resource_changes[0],
          change: { actions: ["create"], before: null, after: { ...values, id: null }, after_unknown: { id: true } },
        },
      ],
    });
    assert.equal(validatePolicyProperties({ ...request, json }).outcome, "unsupported");
    assert.equal(
      validatePolicyProperties({
        ...request,
        json,
        logicalResourceManifest: { storage: { codeSymbol: "azurerm_storage_account.main" } },
      }).outcome,
      "pass",
    );
  });

  it("bounds JSON depth, nodes and UTF-8 bytes, preserving valid JSON digest behavior", () => {
    assert.doesNotThrow(() => calculatePolicyValidationDigest(nestedValue(POLICY_VALIDATION_LIMITS.depth)));
    assert.doesNotThrow(() => assertPolicyValidationJson(Array(POLICY_VALIDATION_LIMITS.nodes - 1).fill(null)));
    assert.doesNotThrow(() => assertPolicyValidationJson("a".repeat(POLICY_VALIDATION_LIMITS.bytes - 2)));
    for (const value of [
      nestedValue(POLICY_VALIDATION_LIMITS.depth + 1),
      Array(POLICY_VALIDATION_LIMITS.nodes).fill(null),
      "a".repeat(POLICY_VALIDATION_LIMITS.bytes - 1),
      "\u00e9".repeat(POLICY_VALIDATION_LIMITS.bytes / 2),
    ])
      assert.throws(() => calculatePolicyValidationDigest(value), {
        name: "TypeError",
        message: "POLICY_VALIDATION_LIMIT_EXCEEDED",
      });
    const shared = { enabled: true };
    assert.equal(
      calculatePolicyValidationDigest([shared, shared]),
      calculatePolicyValidationDigest([{ enabled: true }, { enabled: true }]),
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [cyclic, { nested: undefined }, { nested: Number.NaN }]) {
      assert.throws(() => calculatePolicyValidationDigest(value), {
        name: "TypeError",
        message: "POLICY_VALIDATION_NON_JSON_VALUE",
      });
    }
  });

  it("bounds mapping counts and oversized or wide source JSON before evaluation", () => {
    const request = input("bicep");
    request.policyMap.mappings = Array(POLICY_VALIDATION_LIMITS.mappings).fill(request.policyMap.mappings[0]);
    assert.equal(validatePolicyProperties(request).outcome, "pass");
    request.policyMap.mappings.push(request.policyMap.mappings[0]!);
    assert.throws(() => validatePolicyProperties(request), {
      name: "TypeError",
      message: "POLICY_VALIDATION_LIMIT_EXCEEDED",
    });
    for (const track of ["bicep", "terraform"] as const) {
      const valid = input(track);
      for (const json of [
        valid.json + " ".repeat(POLICY_VALIDATION_LIMITS.bytes),
        valid.json.replaceAll(
          '"enabled":true',
          `"enabled":${JSON.stringify(Array(POLICY_VALIDATION_LIMITS.nodes).fill(null))}`,
        ),
      ])
        assert.equal(validatePolicyProperties({ ...valid, json }).results[0]!.reason, "invalid-source");
      const wide = input(track);
      wide.policyMap.mappings[0]!.expectedValue = Array(POLICY_VALIDATION_LIMITS.nodes).fill(null);
      assert.throws(() => validatePolicyProperties(wide), {
        name: "TypeError",
        message: "POLICY_VALIDATION_LIMIT_EXCEEDED",
      });
    }
  });

  it("returns false for invalid contract data including deeply nested expected values", () => {
    const receipt = validatePolicyProperties(input("bicep"));
    const deep = nestedValue(6000);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      { ...receipt, expectedValue: deep },
      { ...receipt, results: [{ ...receipt.results[0], expectedValue: deep }] },
      { ...receipt, results: [{ ...receipt.results[0], expectedValueDigest: deep }] },
      { ...receipt, results: Array(POLICY_VALIDATION_LIMITS.mappings + 1).fill(receipt.results[0]) },
      cyclic,
    ])
      assert.equal(hasValidPolicyValidation(value, receipt), false);
    assert.equal(
      hasValidPolicyValidation(receipt, { ...receipt, sourceHash: deep } as unknown as typeof receipt),
      false,
    );
    assert.equal(hasValidPolicyValidation(receipt, null as unknown as typeof receipt), false);
    const request = input("bicep");
    request.policyMap.mappings[0]!.expectedValue = cyclic;
    assert.throws(() => validatePolicyProperties(request), {
      name: "TypeError",
      message: "POLICY_VALIDATION_NON_JSON_VALUE",
    });
  });
});

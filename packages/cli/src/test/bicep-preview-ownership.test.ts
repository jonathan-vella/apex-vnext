import assert from "node:assert/strict";
import test from "node:test";
import type { IacBindingV1, ImplementationIntentV1, LogicalResourceManifestV1 } from "@apexops/contracts";
import { sha256Json, ValidatorRegistry } from "@apexops/kernel";
import { registerWorkflowValidators, resolveNativeBicepResourceOwnership } from "../workflow-validators.js";

const targetScope = "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/workload";
const resourceType = "Microsoft.Storage/storageAccounts";
const implementation = `native:${resourceType}@2023-05-01`;
const managedId = `${targetScope}/providers/${resourceType}/acceptedname`;

function fixture() {
  const intent: ImplementationIntentV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run-test",
    sourceHashes: {},
    resources: [{ id: "storage", type: resourceType, purpose: "Storage", dependsOn: [], controls: [] }],
    outputs: [],
  };
  const binding: IacBindingV1 = {
    schemaVersion: "1.0.0",
    projectId: intent.projectId,
    runId: intent.runId,
    track: "bicep",
    intentHash: sha256Json(intent),
    resourceBindings: {
      storage: {
        implementation,
        version: "2023-05-01",
        parameters: {
          name: "acceptedname",
          location: "swedencentral",
          parentId: "/",
          properties: {},
        },
      },
    },
  };
  const manifest: LogicalResourceManifestV1 = {
    schemaVersion: "1.0.0",
    projectId: intent.projectId,
    runId: intent.runId,
    track: "bicep",
    resources: [
      {
        logicalId: "storage",
        type: resourceType,
        implementationAddress: implementation,
        implementationKind: "resource",
        ownership: "managed",
        dependsOn: [],
        generatedDependencies: [],
        sourcePath: "main.bicep",
      },
    ],
  };
  return { intent, binding, manifest, targetScope };
}

function coverage(
  expectedResourceIds: readonly string[],
  changes: {
    resourceId: string;
    action: string;
    material: boolean;
  }[],
  provider = "bicep",
) {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  return registry.validate("preview:coverage", { provider, expectedResourceIds, preview: { changes } });
}

test("native Bicep resolves accepted literal names and exact RG ownership", () => {
  const context = fixture();
  for (const parentId of ["/", targetScope, targetScope.toUpperCase()]) {
    context.binding.resourceBindings.storage!.parameters.parentId = parentId;
    const result = resolveNativeBicepResourceOwnership(context);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.expectedResourceIds, [managedId]);
    assert.equal(result.resourceIdsByLogicalId.storage, managedId);
    assert.deepEqual(result.protectedResourceIds, []);
    for (const action of ["create", "update", "delete", "replace"]) {
      assert.equal(
        coverage(result.expectedResourceIds, [{ resourceId: managedId.toUpperCase(), action, material: true }]).valid,
        true,
      );
    }
  }
});

test("existing Bicep resources are protected from update and delete", () => {
  const context = fixture();
  context.manifest.resources[0]!.ownership = "existing";
  context.manifest.resources[0]!.implementationKind = "existing";
  const result = resolveNativeBicepResourceOwnership(context);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.expectedResourceIds, []);
  assert.deepEqual(result.protectedResourceIds, [managedId]);
  assert.equal(result.resourceIdsByLogicalId.storage, undefined);
  for (const action of ["update", "delete"]) {
    assert.equal(
      coverage(result.expectedResourceIds, [{ resourceId: managedId, action, material: true }]).valid,
      false,
    );
  }
});

test("mixed ownership protects existing IDs and rejects case-insensitive physical collisions", () => {
  const context = fixture();
  context.intent.resources.push({ ...context.intent.resources[0]!, id: "shared" });
  context.binding.intentHash = sha256Json(context.intent);
  context.binding.resourceBindings.shared = {
    ...context.binding.resourceBindings.storage!,
    parameters: { ...context.binding.resourceBindings.storage!.parameters, name: "sharedname" },
  };
  context.manifest.resources.push({
    ...context.manifest.resources[0]!,
    logicalId: "shared",
    ownership: "existing",
    implementationKind: "existing",
  });
  const sharedId = `${targetScope}/providers/${resourceType}/sharedname`;
  const result = resolveNativeBicepResourceOwnership(context);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.expectedResourceIds, [managedId]);
  assert.deepEqual(result.protectedResourceIds, [sharedId]);
  for (const action of ["update", "delete"]) {
    assert.equal(
      coverage(result.expectedResourceIds, [
        { resourceId: managedId, action: "create", material: true },
        { resourceId: sharedId.toUpperCase(), action, material: true },
      ]).valid,
      false,
    );
  }
  context.binding.resourceBindings.shared.parameters.name = "ACCEPTEDNAME";
  const collision = resolveNativeBicepResourceOwnership(context);
  assert.match(collision.issues[0]!.message, /duplicate resource IDs/);
  assert.deepEqual(collision.expectedResourceIds, []);
  assert.deepEqual(Object.keys(collision.resourceIdsByLogicalId), []);
});

test("Bicep rejects unknown resources, other scopes, and unmanaged descendants", () => {
  const { expectedResourceIds } = resolveNativeBicepResourceOwnership(fixture());
  for (const resourceId of [
    `${managedId}other`,
    managedId.replace("resourceGroups/workload", "resourceGroups/other"),
    managedId.replace("11111111", "aaaaaaaa"),
    `${managedId}/blobServices/default`,
  ]) {
    assert.equal(coverage(expectedResourceIds, [{ resourceId, action: "update", material: true }]).valid, false);
  }
  assert.equal(
    coverage(expectedResourceIds, [
      { resourceId: managedId, action: "update", material: true },
      { resourceId: managedId.toUpperCase(), action: "no-op", material: false },
    ]).valid,
    false,
  );
});

test("empty Bicep ownership permits external no-ops but no material changes", () => {
  assert.equal(coverage([], []).valid, true);
  assert.equal(coverage([], [{ resourceId: managedId, action: "no-op", material: false }]).valid, true);
  for (const action of ["create", "update", "delete", "replace", "unknown", "no-op"]) {
    assert.equal(coverage([], [{ resourceId: managedId, action, material: true }]).valid, false);
  }
  assert.equal(coverage([], [{ resourceId: managedId, action: "update", material: false }]).valid, false);
});

test("unsupported Bicep names fail closed without inferred IDs", () => {
  for (const name of [
    "[parameters('name')]",
    "${name}",
    "{{name}}",
    "parent/child",
    "name%2Fchild",
    "..",
    "name\\child",
    " name",
    "",
    123,
  ]) {
    const context = fixture();
    context.binding.resourceBindings.storage!.parameters.name = name;
    const result = resolveNativeBicepResourceOwnership(context);
    assert.ok(result.issues.length > 0, String(name));
    assert.deepEqual(result.expectedResourceIds, []);
    assert.deepEqual(Object.keys(result.resourceIdsByLogicalId), []);
  }
});

test("invalid target scopes and foreign native parents fail closed", () => {
  for (const scope of [
    "/",
    targetScope + "/",
    targetScope + "/providers/Microsoft.Storage/storageAccounts/other",
    targetScope.replace("11111111", "not-a-guid"),
    targetScope.replace("workload", "${name}"),
  ]) {
    const result = resolveNativeBicepResourceOwnership({ ...fixture(), targetScope: scope });
    assert.ok(result.issues.length > 0);
    assert.deepEqual(result.expectedResourceIds, []);
  }
  const context = fixture();
  context.binding.resourceBindings.storage!.parameters.parentId = targetScope + "other";
  assert.ok(resolveNativeBicepResourceOwnership(context).issues.length > 0);
});

test("Bicep module ownership stays unresolved instead of mapping a module to an ARM resource", () => {
  const context = fixture();
  context.binding.resourceBindings.storage!.implementation = "avm:br/public:avm/res/storage/storage-account@0.9.0";
  context.binding.resourceBindings.storage!.version = "0.9.0";
  context.manifest.resources[0]!.implementationAddress = context.binding.resourceBindings.storage!.implementation;
  context.manifest.resources[0]!.implementationKind = "module";
  const result = resolveNativeBicepResourceOwnership(context);
  assert.match(result.issues[0]!.message, /module ownership is unresolved/);
  assert.deepEqual(result.expectedResourceIds, []);
});

test("Bicep ownership checks accepted artifact identity, coverage, type, and descriptor", () => {
  const mutations: ((context: ReturnType<typeof fixture>) => void)[] = [
    ({ binding }) => {
      binding.intentHash = "0".repeat(64);
    },
    ({ binding }) => {
      binding.resourceBindings.extra = binding.resourceBindings.storage!;
    },
    ({ binding }) => {
      delete binding.resourceBindings.storage;
    },
    ({ manifest }) => {
      manifest.runId = "other";
    },
    ({ manifest }) => {
      manifest.resources.push({ ...manifest.resources[0]! });
    },
    ({ manifest }) => {
      manifest.resources[0]!.implementationAddress = "other";
    },
    ({ manifest }) => {
      manifest.resources[0]!.type = "Microsoft.Network/virtualNetworks";
    },
    ({ binding }) => {
      binding.resourceBindings.storage!.version = "2024-01-01";
    },
    ({ binding, manifest }) => {
      const descriptor = "native:Microsoft.Storage/storageAccounts/blobServices@2023-05-01";
      binding.resourceBindings.storage!.implementation = descriptor;
      manifest.resources[0]!.implementationAddress = descriptor;
    },
  ];
  for (const mutate of mutations) {
    const context = fixture();
    mutate(context);
    const result = resolveNativeBicepResourceOwnership(context);
    assert.ok(result.issues.length > 0);
    assert.deepEqual(result.expectedResourceIds, []);
  }
});

test("fake coverage retains exact synthetic ID matching", () => {
  const resourceId = "fake://demo/storage";
  assert.equal(coverage([resourceId], [{ resourceId, action: "create", material: true }], "fake").valid, true);
  assert.equal(
    coverage([resourceId], [{ resourceId: resourceId.toUpperCase(), action: "create", material: true }], "fake").valid,
    false,
  );
});

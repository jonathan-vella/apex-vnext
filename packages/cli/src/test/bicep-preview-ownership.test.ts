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

function avmFixture() {
  const context = fixture();
  const moduleImplementation = "avm:br/public:avm/res/storage/storage-account@0.9.0";
  context.binding.resourceBindings.storage = {
    implementation: moduleImplementation,
    version: "0.9.0",
    parameters: {},
    physicalResources: [{ resourceId: managedId, type: resourceType, ownership: "managed", role: "primary" }],
  };
  context.manifest.resources[0]!.implementationAddress = moduleImplementation;
  context.manifest.resources[0]!.implementationKind = "module";
  return context;
}

function planCoverage(context: ReturnType<typeof fixture>) {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  return registry.validate("business:binding-track-match", {
    track: context.binding.track,
    targetScope: context.targetScope,
    outputs: { "implementation-intent": context.intent, "iac-binding": context.binding },
  });
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
    "name\n",
    "name\r\n",
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
    targetScope + "\n",
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
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  for (const changes of [[], [{ resourceId: managedId, action: "no-op", material: false }]]) {
    assert.equal(
      registry.validate("preview:coverage", {
        provider: "bicep",
        expectedResourceIds: result.expectedResourceIds,
        ownershipIssues: result.issues,
        preview: { changes },
      }).valid,
      false,
    );
  }
});

test("AVM exact authorization includes managed ancillary IDs and protects explicit existing IDs", () => {
  const context = fixture();
  const moduleImplementation = "avm:br/public:avm/res/storage/storage-account@0.9.0";
  const childId = `${managedId}/blobServices/default`;
  const existingId = `${targetScope}/providers/Microsoft.Network/virtualNetworks/shared`;
  Object.assign(context.binding.resourceBindings.storage!, {
    implementation: moduleImplementation,
    version: "0.9.0",
    physicalResources: [
      { resourceId: managedId, type: resourceType, ownership: "managed", role: "primary" },
      {
        resourceId: childId,
        type: `${resourceType}/blobServices`,
        ownership: "managed",
        role: "ancillary",
      },
      {
        resourceId: existingId,
        type: "Microsoft.Network/virtualNetworks",
        ownership: "existing",
        role: "ancillary",
      },
    ],
  });
  context.manifest.resources[0]!.implementationAddress = moduleImplementation;
  context.manifest.resources[0]!.implementationKind = "module";
  const result = resolveNativeBicepResourceOwnership(context);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.expectedResourceIds, [managedId, childId]);
  assert.deepEqual({ ...result.resourceIdsByLogicalId }, { storage: managedId });
  assert.deepEqual(result.protectedResourceIds, [existingId]);
  assert.equal(planCoverage(context).valid, true);
  assert.equal(
    coverage(result.expectedResourceIds, [{ resourceId: childId, action: "create", material: true }]).valid,
    true,
  );
  for (const resourceId of [existingId, `${childId}/containers/unlisted`]) {
    assert.equal(coverage(result.expectedResourceIds, [{ resourceId, action: "update", material: true }]).valid, false);
  }
});

test("AVM exact maps reject malformed, foreign, and mismatched ARM paths at plan and preview", () => {
  for (const resourceId of [
    managedId.replace("workload", "workload-other"),
    managedId.replace("11111111", "aaaaaaaa"),
    `${managedId}/*`,
    `${managedId}\n`,
    `${managedId}\r\n`,
    `${managedId}?api-version=1`,
    `${managedId}#fragment`,
    `${managedId}/`,
    `${managedId}//child`,
    `${managedId}/../other`,
    `${managedId}/./other`,
    `${managedId}/blobServices`,
    `${managedId}/blobServices/default`,
    managedId.replace("acceptedname", "name%2Fother"),
    managedId.replace("acceptedname", "name\\other"),
    managedId.replace("acceptedname", "[parameters('name')]"),
    managedId.replace("acceptedname", "${name}"),
    managedId.replace("acceptedname", "{{name}}"),
    managedId.replace("acceptedname", ".."),
    `${managedId}/providers`,
    `${managedId}/providers/Microsoft.Insights`,
    `${managedId}/providers/Microsoft.Insights/diagnosticSettings`,
    `${managedId}/providers/Microsoft.Insights/diagnosticSettings/diagnostics`,
  ]) {
    const context = avmFixture();
    context.binding.resourceBindings.storage!.physicalResources![0]!.resourceId = resourceId;
    const result = resolveNativeBicepResourceOwnership(context);
    assert.ok(result.issues.length > 0, resourceId);
    assert.deepEqual(result.expectedResourceIds, []);
    assert.deepEqual(Object.keys(result.resourceIdsByLogicalId), []);
    assert.equal(planCoverage(context).valid, false, resourceId);
  }
});

test("AVM exact IDs and ARM types compare case-insensitively", () => {
  const context = avmFixture();
  const primary = context.binding.resourceBindings.storage!.physicalResources![0]!;
  primary.resourceId = managedId.toUpperCase();
  primary.type = resourceType.toUpperCase();
  assert.deepEqual(resolveNativeBicepResourceOwnership(context).expectedResourceIds, [managedId.toUpperCase()]);
  assert.equal(planCoverage(context).valid, true);
  context.binding.resourceBindings.storage!.physicalResources!.push({
    ...primary,
    resourceId: managedId,
    role: "ancillary",
    ownership: "existing",
  });
  assert.ok(
    resolveNativeBicepResourceOwnership(context).issues.some(({ message }) => /duplicate resource IDs/.test(message)),
  );
  assert.equal(planCoverage(context).valid, false);
});

test("AVM maps allow structured extension resources without granting descendant scope", () => {
  const context = avmFixture();
  const extensionId = `${managedId}/blobServices/default/providers/Microsoft.Insights/diagnosticSettings/diagnostics`;
  context.binding.resourceBindings.storage!.physicalResources!.push({
    resourceId: extensionId,
    type: "Microsoft.Insights/diagnosticSettings",
    ownership: "managed",
    role: "ancillary",
  });
  const result = resolveNativeBicepResourceOwnership(context);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.expectedResourceIds, [managedId, extensionId]);
  assert.equal(planCoverage(context).valid, true);
  assert.equal(
    coverage(result.expectedResourceIds, [
      {
        resourceId: `${extensionId}/providers/Microsoft.Authorization/locks/unlisted`,
        action: "delete",
        material: true,
      },
    ]).valid,
    false,
  );
});

test("AVM maps require one managed primary of the intent type and a strict bounded shape", () => {
  const mutations: ((context: ReturnType<typeof avmFixture>) => void)[] = [
    ({ binding }) => {
      binding.resourceBindings.storage!.physicalResources = [];
    },
    ({ binding }) => {
      binding.resourceBindings.storage!.physicalResources![0]!.role = "ancillary";
    },
    ({ binding }) => {
      binding.resourceBindings.storage!.physicalResources![0]!.ownership = "existing";
    },
    ({ binding }) => {
      binding.resourceBindings.storage!.physicalResources![0]!.type = "Microsoft.Network/virtualNetworks";
    },
    ({ binding }) => {
      binding.resourceBindings.storage!.physicalResources!.push({
        ...binding.resourceBindings.storage!.physicalResources![0]!,
        resourceId: `${managedId}second`,
      });
    },
    ({ binding }) => {
      Object.assign(binding.resourceBindings.storage!.physicalResources![0]!, { unexpected: true });
    },
    ({ binding }) => {
      Object.assign(binding.resourceBindings.storage!.physicalResources![0]!, { ownership: "observed" });
    },
    ({ binding }) => {
      Object.assign(binding.resourceBindings.storage!, { physicalResources: null });
    },
    ({ binding }) => {
      binding.resourceBindings.storage!.physicalResources = Array.from({ length: 129 }, (_, index) => ({
        resourceId: `${managedId}${index}`,
        type: resourceType,
        ownership: "managed",
        role: index === 0 ? "primary" : "ancillary",
      }));
    },
  ];
  for (const mutate of mutations) {
    const context = avmFixture();
    mutate(context);
    assert.ok(resolveNativeBicepResourceOwnership(context).issues.length > 0);
    assert.equal(planCoverage(context).valid, false);
  }
});

test("native maps, existing logical modules, and non-AVM modules fail closed", () => {
  for (const ownership of ["managed", "existing"] as const) {
    const context = fixture();
    context.manifest.resources[0]!.ownership = ownership;
    context.binding.resourceBindings.storage!.physicalResources =
      avmFixture().binding.resourceBindings.storage!.physicalResources!;
    assert.ok(resolveNativeBicepResourceOwnership(context).issues.length > 0);
    assert.equal(planCoverage(context).valid, false);
  }
  for (const withMap of [true, false]) {
    const context = avmFixture();
    context.manifest.resources[0]!.ownership = "existing";
    if (!withMap) delete context.binding.resourceBindings.storage!.physicalResources;
    assert.ok(resolveNativeBicepResourceOwnership(context).issues.length > 0);
  }
  const context = avmFixture();
  context.binding.resourceBindings.storage!.implementation = "module:local.bicep";
  context.manifest.resources[0]!.implementationAddress = "module:local.bicep";
  assert.ok(resolveNativeBicepResourceOwnership(context).issues.length > 0);
  assert.equal(planCoverage(context).valid, false);
});

test("AVM explicit IDs collide globally with other maps and derived native IDs", () => {
  for (const native of [true, false]) {
    for (const ownership of ["managed", "existing"] as const) {
      for (const reverse of [true, false]) {
        const context = avmFixture();
        context.intent.resources.push({ ...context.intent.resources[0]!, id: "shared" });
        context.binding.intentHash = sha256Json(context.intent);
        context.binding.resourceBindings.shared = native
          ? fixture().binding.resourceBindings.storage!
          : structuredClone(context.binding.resourceBindings.storage!);
        context.manifest.resources.push({
          ...(native ? fixture().manifest.resources[0]! : context.manifest.resources[0]!),
          logicalId: "shared",
          ownership: native ? ownership : "managed",
          implementationKind: native && ownership === "existing" ? "existing" : native ? "resource" : "module",
        });
        if (native) context.binding.resourceBindings.shared.parameters.name = "ACCEPTEDNAME";
        else {
          context.binding.resourceBindings.shared.physicalResources![0]!.resourceId = `${managedId}other`;
          context.binding.resourceBindings.shared.physicalResources!.push({
            resourceId: managedId.replace("acceptedname", "ACCEPTEDNAME"),
            type: resourceType,
            ownership,
            role: "ancillary",
          });
        }
        if (reverse) context.intent.resources.reverse();
        context.binding.intentHash = sha256Json(context.intent);
        const result = resolveNativeBicepResourceOwnership(context);
        assert.ok(result.issues.some(({ message }) => /duplicate resource IDs/.test(message)));
        assert.deepEqual(result.expectedResourceIds, []);
        assert.deepEqual(Object.keys(result.resourceIdsByLogicalId), []);
        assert.equal(planCoverage(context).valid, false);
      }
    }
  }
});

test("plan validation does not resolve unmapped native or legacy plans", () => {
  const context = fixture();
  context.targetScope = "fake-scope";
  context.binding.resourceBindings.storage!.parameters.name = "${legacyName}";
  assert.equal(planCoverage(context).valid, true);
  const mapped = avmFixture();
  mapped.binding.track = "terraform";
  assert.equal(planCoverage(mapped).valid, false);
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

test("destructive Bicep ancestors cannot bypass protected existing children", () => {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  for (const protectedId of [
    `${managedId}/blobServices/default`,
    `${managedId}/providers/Microsoft.Insights/diagnosticSettings/shared`,
  ]) {
    for (const action of ["delete", "replace"]) {
      const context = {
        provider: "bicep",
        expectedResourceIds: [managedId],
        protectedResourceIds: [protectedId.toUpperCase()],
        preview: { changes: [{ resourceId: managedId, action, material: true }] },
      };
      assert.equal(registry.validate("preview:coverage", context).valid, false);
      assert.equal(
        registry.validate("preview:coverage", {
          ...context,
          protectedResourceIds: [protectedId.replace("acceptedname", "acceptedname-other")],
        }).valid,
        true,
      );
    }
  }
});

test("ARM inventory coverage requires exact case-insensitive physical IDs", () => {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  const check = (resources: { logicalId: string; resourceId: string }[]) =>
    registry.validate("inventory:source-coverage", {
      preview: { changes: [{ resourceId: managedId, action: "create", material: true }] },
      inventory: { resources },
    }).valid;
  assert.equal(check([{ logicalId: "storage", resourceId: managedId.toUpperCase() }]), true);
  assert.equal(check([{ logicalId: managedId, resourceId: `${managedId}foreign` }]), false);
  assert.equal(
    check([
      { logicalId: "one", resourceId: managedId },
      { logicalId: "two", resourceId: managedId.toUpperCase() },
    ]),
    false,
  );
});

test("fake coverage retains exact synthetic ID matching", () => {
  const resourceId = "fake://demo/storage";
  assert.equal(coverage([resourceId], [{ resourceId, action: "create", material: true }], "fake").valid, true);
  assert.equal(
    coverage([resourceId], [{ resourceId: resourceId.toUpperCase(), action: "create", material: true }], "fake").valid,
    false,
  );
});

test("Terraform no-op labels cannot conceal foreign material changes", () => {
  assert.equal(
    coverage(
      ["azapi_resource.owned"],
      [
        {
          resourceId: "azapi_resource.shared",
          action: "no-op",
          material: true,
        },
      ],
      "terraform",
    ).valid,
    false,
  );
  assert.equal(
    coverage(
      ["azapi_resource.owned"],
      [
        {
          resourceId: "azapi_resource.shared",
          action: "no-op",
          material: false,
        },
      ],
      "terraform",
    ).valid,
    true,
  );
});

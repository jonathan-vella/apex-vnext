import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "./test-shard.js";
import { AzdBicepProvider, ProcessRunner, resolveExecutable } from "@apexops/capabilities";
import type {
  IacBindingV1,
  ImplementationIntentV1,
  LogicalResourceManifestV1,
  PolicyPropertyMapV1,
} from "@apexops/contracts";
import { sha256Json, ValidatorRegistry } from "@apexops/kernel";
import { ApexError } from "../errors.js";
import { ApexService } from "../service.js";
import { registerWorkflowValidators, resolveNativeBicepResourceOwnership } from "../workflow-validators.js";
import {
  acceptAvailabilityEvidence,
  architecture,
  assertLabReadiness,
  completeOutputs,
  costEstimate,
  governance,
  governanceFindings,
  importReferenceGovernance,
  nextTaskAfterInput,
  policyMap,
  requirements,
  review,
  tempRoot,
  workloadDecisionManifest,
  AZD_PINNED_VERSION,
} from "./helpers.js";

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

test("native Bicep rejects obsolete and mismatched binding versions", () => {
  for (const version of ["legacy", "2022-09-01"]) {
    const context = fixture();
    context.binding.resourceBindings.storage!.version = version;
    const result = resolveNativeBicepResourceOwnership(context);
    assert.notEqual(result.issues.length, 0);
    assert.deepEqual(result.expectedResourceIds, []);
  }
});

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

test("native Bicep child ownership binds exact full names without granting parent or sibling access", () => {
  const context = fixture();
  const childType = "Microsoft.Storage/storageAccounts/blobServices/containers";
  const childImplementation = `native:${childType}@2023-05-01`;
  context.intent.resources[0]!.type = childType;
  context.binding.intentHash = sha256Json(context.intent);
  context.binding.resourceBindings.storage!.implementation = childImplementation;
  context.binding.resourceBindings.storage!.parameters.name = "acceptedname/default/content";
  context.manifest.resources[0]!.type = childType;
  context.manifest.resources[0]!.implementationAddress = childImplementation;
  const childId = `${managedId}/blobServices/default/containers/content`;
  const result = resolveNativeBicepResourceOwnership(context);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.expectedResourceIds, [childId]);
  assert.equal(
    coverage(result.expectedResourceIds, [{ resourceId: childId, action: "update", material: true }]).valid,
    true,
  );
  for (const resourceId of [
    managedId,
    `${managedId}/blobServices/default`,
    `${childId}-other`,
    `${childId}/other/nested`,
  ])
    assert.equal(coverage(result.expectedResourceIds, [{ resourceId, action: "delete", material: true }]).valid, false);
  for (const name of [
    "content",
    "acceptedname/default",
    "acceptedname/default/content/extra",
    "acceptedname//content",
    "acceptedname/../content",
    "acceptedname/default/content\n",
  ]) {
    context.binding.resourceBindings.storage!.parameters.name = name;
    assert.notEqual(resolveNativeBicepResourceOwnership(context).issues.length, 0, name);
  }
  context.binding.resourceBindings.storage!.parameters.name = "acceptedname/default/content";
  context.manifest.resources[0]!.ownership = "existing";
  context.manifest.resources[0]!.implementationKind = "existing";
  const protectedChild = resolveNativeBicepResourceOwnership(context);
  assert.deepEqual(protectedChild.expectedResourceIds, []);
  assert.deepEqual(protectedChild.protectedResourceIds, [childId]);
});

test("diagnostic extension ownership resolves explicit native scopes without granting sibling extensions", () => {
  const context = fixture();
  const diagnostic = {
    id: "diagnostic",
    type: "Microsoft.Insights/diagnosticSettings",
    purpose: "Monitor",
    dependsOn: ["storage"],
    controls: [],
  };
  context.intent.resources.unshift(diagnostic);
  context.binding.intentHash = sha256Json(context.intent);
  context.binding.resourceBindings.diagnostic = {
    implementation: "native:Microsoft.Insights/diagnosticSettings@2021-05-01-preview",
    version: "2021-05-01-preview",
    scopeLogicalId: "storage",
    parameters: { name: "logs", parentId: "/", location: "swedencentral", properties: {} },
  };
  context.manifest.resources.push({
    ...context.manifest.resources[0]!,
    logicalId: "diagnostic",
    type: diagnostic.type,
    implementationAddress: context.binding.resourceBindings.diagnostic.implementation,
    dependsOn: ["storage"],
    generatedDependencies: ["storage"],
  });
  const expected = `${managedId}/providers/Microsoft.Insights/diagnosticSettings/logs`;
  const result = resolveNativeBicepResourceOwnership(context);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.expectedResourceIds, [managedId, expected]);
  assert.equal(planCoverage(context).valid, true);
  assert.equal(
    coverage(result.expectedResourceIds, [{ resourceId: `${expected}-other`, action: "update", material: true }]).valid,
    false,
  );
  for (const scopeLogicalId of ["missing", "diagnostic"]) {
    const changed = structuredClone(context);
    changed.binding.resourceBindings.diagnostic!.scopeLogicalId = scopeLogicalId;
    assert.ok(resolveNativeBicepResourceOwnership(changed).issues.length > 0);
    assert.equal(planCoverage(changed).valid, false);
  }
  const protectedScope = structuredClone(context);
  protectedScope.manifest.resources[0]!.ownership = "existing";
  protectedScope.manifest.resources[0]!.implementationKind = "existing";
  assert.ok(resolveNativeBicepResourceOwnership(protectedScope).issues.length > 0);
  context.binding.track = "terraform";
  assert.equal(planCoverage(context).valid, false);
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
  // Accepted AVM Terraform module roots own their module.<id>.* descendant resources, not sibling modules.
  assert.equal(
    coverage(
      ["module.storage"],
      [
        {
          resourceId: "module.storage.azurerm_storage_account.this",
          action: "create",
          material: true,
        },
      ],
      "terraform",
    ).valid,
    true,
  );
  assert.equal(
    coverage(
      ["module.storage"],
      [
        {
          resourceId: "module.storage_other.azurerm_storage_account.this",
          action: "create",
          material: true,
        },
      ],
      "terraform",
    ).valid,
    false,
  );
});

type PlanDryRun = {
  assertPlanGeneratable(run: unknown, intent: ImplementationIntentV1, binding: IacBindingV1): void;
  generateIacTree(run: unknown, intent: ImplementationIntentV1, binding: IacBindingV1): unknown;
};

test("plan dry-run accepts a complete Bicep AVM binding and refuses the unresolved ones with APEX_VALIDATION", async () => {
  const service = new ApexService(await tempRoot()) as unknown as PlanDryRun;
  const run = { iacTool: "bicep", targetScope };
  const valid = avmFixture();
  assert.doesNotThrow(() => service.assertPlanGeneratable(run, valid.intent, valid.binding));

  const withoutMap = avmFixture();
  delete withoutMap.binding.resourceBindings.storage!.physicalResources;
  const looseScope = { iacTool: "bicep", targetScope: "local" };
  const subscriptionScope = { iacTool: "bicep", targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111" };
  assert.doesNotThrow(() => service.assertPlanGeneratable(looseScope, withoutMap.intent, withoutMap.binding));
  assert.doesNotThrow(() => service.assertPlanGeneratable(subscriptionScope, withoutMap.intent, withoutMap.binding));
  assert.throws(
    () => service.assertPlanGeneratable(run, withoutMap.intent, withoutMap.binding),
    (error: unknown) =>
      error instanceof ApexError && error.code === "APEX_VALIDATION" && /physical/i.test(error.message),
  );

  const unprefixed = fixture();
  unprefixed.binding.resourceBindings.storage!.implementation = resourceType;
  assert.throws(
    () => service.assertPlanGeneratable(run, unprefixed.intent, unprefixed.binding),
    (error: unknown) =>
      error instanceof ApexError &&
      error.code === "APEX_VALIDATION" &&
      /IaC binding cannot be generated: Unsupported binding implementation/.test(error.message),
  );
});

test("generateIac maps generator TypeErrors on input-shaped bindings to APEX_VALIDATION", async () => {
  const service = new ApexService(await tempRoot()) as unknown as PlanDryRun;
  const context = avmFixture();
  context.binding.resourceBindings.storage!.implementation = "br/public:avm/res/storage/storage-account";
  assert.throws(
    () => service.generateIacTree({ iacTool: "bicep", targetScope }, context.intent, context.binding),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
});

test("pre-sales subscription Bicep flow supports deferred inputs, 1-to-many component splits, and staged real Bicep validation", async (t) => {
  if (resolveExecutable("bicep") === undefined) {
    t.skip("bicep CLI unavailable");
    return;
  }
  const root = await tempRoot();
  const runner = new ProcessRunner();
  const service = new ApexService(root, {
    providerResolver: async (track, context) => {
      if (track !== "bicep" || context.handoffRootPath === undefined) return undefined;
      return new AzdBicepProvider({
        runner,
        currentAuthority: async () => ({
          head: "a".repeat(64),
          dependencyRevision: "a".repeat(64),
          ownerEpoch: 1,
          recipientIdentity: "local",
        }),
        target: {
          projectRoot: resolve(root, context.handoffRootPath),
          environmentName: context.run.environment,
          tenantId: "",
          location: "",
          azdVersion: AZD_PINNED_VERSION,
        },
      });
    },
  });
  const subScope = "/subscriptions/11111111-2222-3333-4444-555555555555";
  const { runId } = await service.init({
    projectId: "demo",
    riskOwner: "partner",
    iacTool: "bicep",
    targetScope: subScope,
  });
  const nextTask = async (expected: string) => {
    const next = await nextTaskAfterInput(service);
    assert.equal(next.status, "task");
    if (next.status !== "task") throw new Error("Expected task");
    assert.equal(next.task.taskType, expected);
    return next.task.taskId;
  };
  const reqHashes = await completeOutputs(service, await nextTask("requirements"), [
    { kind: "requirements", value: requirements() },
  ]);
  await completeOutputs(service, await nextTask("requirements-review"), [
    { kind: "review-findings", value: review(runId, "requirements", reqHashes.outputHashes.requirements!) },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(service, runId);
  await importReferenceGovernance(service);

  const arch = architecture(runId);
  arch.components = [
    {
      ...arch.components[0]!,
      id: "container-platform",
      service: "Azure Container Apps",
      resourceTypes: ["Microsoft.App/managedEnvironments", "Microsoft.App/containerApps"],
    },
  ];
  const cost = costEstimate(runId);
  cost.lineItems[0]!.service = "Azure Container Apps";
  const archTask = await nextTask("architecture");
  const findings = await governanceFindings(service, archTask, arch.components[0]!.resourceTypes);
  const mappedPolicy: PolicyPropertyMapV1 = policyMap(
    runId,
    (await service.taskContext(archTask)).artifactHashes["governance-constraints"]!,
    findings,
  );
  for (const row of mappedPolicy.mappings) {
    row.disposition = "not-applicable";
    row.reason = "Covered by explicit pilot mappings below";
  }
  mappedPolicy.mappings.push(
    {
      policyAssignmentId: "/providers/Microsoft.Authorization/policyAssignments/env-pna",
      effect: "deny",
      logicalResourceId: "container-platform",
      propertyPath: "properties.publicNetworkAccess",
      expectedValue: "Disabled",
      disposition: "satisfied",
    },
    {
      policyAssignmentId: "/providers/Microsoft.Authorization/policyAssignments/app-ingress",
      effect: "deny",
      logicalResourceId: "container-platform",
      propertyPath: "properties.configuration.ingress.external",
      expectedValue: false,
      disposition: "satisfied",
    },
    {
      policyAssignmentId: "/providers/Microsoft.Authorization/policyAssignments/structural-nsg",
      effect: "deny",
      logicalResourceId: "container-platform",
      propertyPath: "properties.securityRules",
      disposition: "satisfied",
    },
  );
  const decisionManifest = workloadDecisionManifest({
    runId,
    requirementsHash: reqHashes.outputHashes.requirements!,
    architectureHash: sha256Json(arch),
    costEstimateHash: sha256Json(cost),
  });
  decisionManifest.skuDecisions[0]!.logicalId = "container-platform";
  decisionManifest.skuDecisions[0]!.service = "Azure Container Apps";
  decisionManifest.sloDecisions[0]!.logicalId = "container-platform";
  const archHashes = await service.completeTaskOutputs(archTask, [
    { kind: "architecture", value: arch },
    { kind: "cost-estimate", value: cost },
    { kind: "workload-decision-manifest", value: decisionManifest },
    { kind: "policy-property-map", value: mappedPolicy },
  ]);
  await completeOutputs(service, await nextTask("architecture-review"), [
    { kind: "review-findings", value: review(runId, "architecture", archHashes.outputHashes.architecture!) },
  ]);
  await assertLabReadiness(service, 2);

  // Pre-sales governance-refresh accepts ALZ reference and advances to plan.
  await nextTask("governance-refresh");
  const refreshedGov = await service.importGovernanceReference();

  const planTask = await nextTask("plan");
  const planIntent: ImplementationIntentV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId,
    sourceHashes: {
      requirements: reqHashes.outputHashes.requirements!,
      architecture: archHashes.outputHashes.architecture!,
      "governance-constraints": refreshedGov.outputHash,
      "policy-property-map": archHashes.outputHashes["policy-property-map"]!,
    },
    resources: [
      {
        id: "container-env",
        componentId: "container-platform",
        type: "Microsoft.App/managedEnvironments",
        purpose: "Internal Container Apps environment",
        dependsOn: [],
        controls: ["publicNetworkAccess=Disabled"],
      },
      {
        id: "container-app",
        componentId: "container-platform",
        type: "Microsoft.App/containerApps",
        purpose: "Internal webhook container app",
        dependsOn: ["container-env"],
        controls: ["ingress.external=false"],
      },
    ],
    outputs: ["containerAppFqdn"],
  };
  await service.completePlan(
    planTask,
    planIntent,
    {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId,
      track: "bicep",
      resourceBindings: {
        "container-env": {
          implementation: "native:Microsoft.App/managedEnvironments@2024-03-01",
          version: "2024-03-01",
          parameters: {},
        },
        "container-app": {
          implementation: "native:Microsoft.App/containerApps@2024-03-01",
          version: "2024-03-01",
          parameters: {},
        },
      },
    },
    {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId,
      environment: "dev",
      inputs: {
        location: { kind: "value", value: "swedencentral" },
        containerImageDigest: { kind: "deferred", owner: "partner-team", reason: "Provided before preview" },
        partnerSecretUri: { kind: "deferred", owner: "partner-team" },
      },
    },
  );
  await completeOutputs(service, await nextTask("plan-review"), [
    { kind: "review-findings", value: review(runId, "plan", sha256Json(planIntent)) },
  ]);
  await assertLabReadiness(service, 3);

  const codegenTask = await nextTask("codegen-bicep");
  const broken = await service.stageFile(
    codegenTask,
    "infra/main.bicep",
    "param location string = 'swedencentral'\nresource bad 'Microsoft.App/managedEnvironments@2024-03-01' = {\n  invalidProp: true\n}\n",
  );
  await assert.rejects(service.generateIac(codegenTask), /Staged Bicep failed bicep build.*BCP/s);

  const validBicep = [
    "param location string = 'swedencentral'",
    "param containerImageDigest string",
    "",
    "resource helper_nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {",
    "  name: 'nsg-cae-demo'",
    "  location: location",
    "  properties: {",
    "    securityRules: []",
    "  }",
    "}",
    "",
    "resource container_env 'Microsoft.App/managedEnvironments@2024-03-01' = {",
    "  name: 'cae-demo-dev'",
    "  location: location",
    "  properties: {",
    "    publicNetworkAccess: 'Disabled'",
    "  }",
    "}",
    "",
    "resource container_app 'Microsoft.App/containerApps@2024-03-01' = {",
    "  name: 'ca-demo-dev'",
    "  location: location",
    "  properties: {",
    "    managedEnvironmentId: container_env.id",
    "    configuration: {",
    "      ingress: {",
    "        external: false",
    "        targetPort: 8080",
    "        allowInsecure: false",
    "      }",
    "    }",
    "    template: {",
    "      containers: [",
    "        {",
    "          name: 'webhook'",
    "          image: containerImageDigest",
    "        }",
    "      ]",
    "    }",
    "  }",
    "}",
    "",
    "output containerAppFqdn string = container_app.properties.configuration.ingress.fqdn",
    "output helperNsgId string = helper_nsg.id",
    "",
  ].join("\n");
  await service.stageFile(codegenTask, "infra/main.bicep", validBicep, broken.hash);
  const generated = await service.generateIac(codegenTask);
  assert.ok(generated.files.some(({ path }) => path.endsWith("azure.yaml")));
  assert.ok(generated.files.some(({ path }) => path.endsWith("bicepconfig.json")));

  const validationTask = await nextTask("validation-bicep");
  const validated = await service.validateTask(validationTask);
  assert.equal(validated.valid, true, JSON.stringify(validated));
  assert.deepEqual(validated.execution?.blockedValidatorIds, []);
  await service.completeTaskOutputs(validationTask, validated.outputs!);

  // Preview is blocked first by reference governance, and on local/collected governance by deferred inputs.
  await assert.rejects(
    service.preview({ operation: "apply", provider: "bicep" }),
    /Reviewed subscription governance baseline is required before deployment preview/,
  );

  const localService = new ApexService(await tempRoot());
  const localInit = await localService.init({ projectId: "demo", riskOwner: "partner", iacTool: "bicep" });
  const localNext = async (expected: string) => {
    const next = await nextTaskAfterInput(localService);
    assert.equal(next.status, "task");
    if (next.status !== "task") throw new Error("Expected task");
    assert.equal(next.task.taskType, expected);
    return next.task.taskId;
  };
  const localReq = await completeOutputs(localService, await localNext("requirements"), [
    { kind: "requirements", value: requirements() },
  ]);
  await completeOutputs(localService, await localNext("requirements-review"), [
    { kind: "review-findings", value: review(localInit.runId, "requirements", localReq.outputHashes.requirements!) },
  ]);
  await localService.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(localService, localInit.runId);
  const localGovHash = await importReferenceGovernance(localService);
  const localArch = architecture(localInit.runId);
  const localCost = costEstimate(localInit.runId);
  const localArchTask = await localNext("architecture");
  const localFindings = await governanceFindings(localService, localArchTask, ["Microsoft.Web/sites"]);
  const localArchHashes = await localService.completeTaskOutputs(localArchTask, [
    { kind: "architecture", value: localArch },
    { kind: "cost-estimate", value: localCost },
    {
      kind: "workload-decision-manifest",
      value: workloadDecisionManifest({
        runId: localInit.runId,
        requirementsHash: localReq.outputHashes.requirements!,
        architectureHash: sha256Json(localArch),
        costEstimateHash: sha256Json(localCost),
      }),
    },
    { kind: "policy-property-map", value: policyMap(localInit.runId, localGovHash, localFindings) },
  ]);
  await completeOutputs(localService, await localNext("architecture-review"), [
    {
      kind: "review-findings",
      value: review(localInit.runId, "architecture", localArchHashes.outputHashes.architecture!),
    },
  ]);
  const localIntent: ImplementationIntentV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: localInit.runId,
    sourceHashes: {
      requirements: localReq.outputHashes.requirements!,
      architecture: localArchHashes.outputHashes.architecture!,
      "governance-constraints": localGovHash,
      "policy-property-map": localArchHashes.outputHashes["policy-property-map"]!,
    },
    resources: [
      {
        id: "api",
        type: "Microsoft.ManagedIdentity/userAssignedIdentities",
        purpose: "Identity",
        dependsOn: [],
        controls: [],
      },
    ],
    outputs: [],
  };
  const localPlanTask = await localNext("plan");
  // Verify completePlan accepts AVM without physicalResources on local scope, then test offline native Bicep through preview blocker.
  await localService.completePlan(
    localPlanTask,
    localIntent,
    {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: localInit.runId,
      track: "bicep",
      resourceBindings: {
        api: {
          implementation: "native:Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31",
          version: "2023-01-31",
          parameters: {},
        },
      },
    },
    {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: localInit.runId,
      environment: "dev",
      inputs: { customDomain: { kind: "deferred", owner: "partner-team" } },
    },
  );
  await completeOutputs(localService, await localNext("plan-review"), [
    { kind: "review-findings", value: review(localInit.runId, "plan", sha256Json(localIntent)) },
  ]);
  const localCodegen = await localNext("codegen-bicep");
  await localService.stageFile(
    localCodegen,
    "infra/main.bicep",
    "param location string = 'swedencentral'\nresource api 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {\n  name: 'id-local-demo'\n  location: location\n}\n",
  );
  await localService.generateIac(localCodegen);
  await completeOutputs(localService, await localNext("validation-bicep"), [
    {
      kind: "validation-evidence",
      value: {
        schemaVersion: "1.0.0",
        projectId: "demo",
        runId: localInit.runId,
        createdAt: "2026-01-01T00:00:00.000Z",
        entries: [
          "bicep:format",
          "bicep:build",
          "bicep:lint",
          "business:security-baseline",
          "business:policy-property-map",
          "business:logical-resource-parity",
        ].map((kind) => ({ kind, hash: "d".repeat(64), bytes: 1, required: true, retention: "immutable" as const })),
      },
    },
  ]);
  await assert.rejects(
    localService.preview({ operation: "apply", provider: "fake" }),
    /Environment inputs remain deferred before deployment preview: customDomain/,
  );
  void governance;
});

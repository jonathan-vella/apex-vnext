import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  DeploymentPreviewV1,
  ExecutionPlanAttestationV1,
  GovernanceConstraintsV1,
  IacHandoffV1,
  IacBindingV1,
  ImplementationIntentV1,
  LogicalResourceManifestV1,
  NativeValidationReceiptV1,
  PolicyPropertyMapV1,
  PolicyValidationV1,
} from "@apexops/contracts";
import {
  calculatePolicyValidationHash,
  calculateNativeValidationCommandHash,
  calculateNativeValidationReceiptHash,
  NATIVE_VALIDATION_COMMANDS,
} from "@apexops/contracts";
import {
  NativeBicepProvider,
  NativeTerraformProvider,
  nativePolicyValidationBinding,
  validatePolicyProperties,
} from "@apexops/capabilities";
import type { IacProvider, PreviewRequest } from "@apexops/capabilities";
import { EventJournal, ObjectStore, RunRepository, ValidatorRegistry, sha256Bytes, sha256Json } from "@apexops/kernel";
import { ApexError } from "../errors.js";
import { dependencyRevision } from "../dependency-revision.js";
import { createMcpServer } from "../mcp.js";
import { ApexService, type TaskOutput } from "../service.js";
import { registerWorkflowValidators } from "../workflow-validators.js";
import { createFileProviderRuntime, hashTerraformConfiguration } from "../provider-runtime.js";
import {
  architecture,
  acceptAvailabilityEvidence,
  codegenBundle,
  costEstimate,
  governance,
  nextTaskAfterInput,
  planBundle,
  policyMap,
  qualityReport,
  requirements,
  review,
  workloadDecisionManifest,
  tempRoot,
  validationEvidence,
  writeJson,
} from "./helpers.js";

async function task(service: ApexService, expected: string): Promise<string> {
  const next = await nextTaskAfterInput(service);
  assert.equal(next.status, "task");
  if (next.status !== "task") throw new Error("Expected task");
  assert.equal(next.task.taskType, expected);
  return next.task.taskId;
}

async function complete(
  service: ApexService,
  expected: string,
  outputs: TaskOutput[],
): Promise<Record<string, string>> {
  const result = await service.completeTaskOutputs(await task(service, expected), outputs);
  return result.outputHashes as Record<string, string>;
}

async function reachCodegen(
  service: ApexService,
  runId: string,
  track: "bicep" | "terraform",
  configurePlan?: (plan: ReturnType<typeof planBundle>) => void | Promise<void>,
  revisePlan = false,
  baselinePath?: string,
  configurePolicy?: (policy: PolicyPropertyMapV1) => void | Promise<void>,
  beforeGovernanceImport?: () => Promise<void>,
): Promise<{ taskId: string; plan: ReturnType<typeof planBundle> }> {
  await service.nextTask();
  const requirementValues: TaskOutput[] = [{ kind: "requirements", value: requirements() }];
  const requirementHashes = await complete(service, "requirements", requirementValues);
  await complete(service, "requirements-review", [
    { kind: "review-findings", value: review(runId, "requirements", requirementHashes.requirements!) },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(service, runId);

  const architectureValue = architecture(runId);
  const costValue = costEstimate(runId);
  const architectureValues: TaskOutput[] = [
    { kind: "architecture", value: architectureValue },
    { kind: "cost-estimate", value: costValue },
    {
      kind: "workload-decision-manifest",
      value: workloadDecisionManifest({
        runId,
        requirementsHash: requirementHashes.requirements!,
        architectureHash: sha256Json(architectureValue),
        costEstimateHash: sha256Json(costValue),
      }),
    },
  ];
  const architectureHashes = await complete(service, "architecture", architectureValues);
  await complete(service, "architecture-review", [
    { kind: "review-findings", value: review(runId, "architecture", architectureHashes.architecture!) },
  ]);
  const governanceValue = governance(runId);
  await beforeGovernanceImport?.();
  if (baselinePath !== undefined) {
    await assert.rejects(service.importGovernanceBaseline("../outside-baseline.json"), /escapes its root/);
    const link = join(baselinePath, "..", "linked-baseline");
    await symlink(join(baselinePath, ".."), link);
    await assert.rejects(service.importGovernanceBaseline(join(link, "baseline.json")), /symlink/);
  }
  const governanceHashes =
    baselinePath === undefined
      ? await complete(service, "governance-discovery", [{ kind: "governance-constraints", value: governanceValue }])
      : { "governance-constraints": (await service.importGovernanceBaseline(baselinePath)).outputHash };
  if (baselinePath !== undefined) {
    const reconciliationTask = await task(service, "governance-reconciliation");
    const context = await service.taskContext(reconciliationTask);
    assert.ok(
      context.inputs.some(
        (value) => (value as { schemaVersion?: string }).schemaVersion === "governance-baseline-selection-v2",
      ),
    );
    const selected = context.inputReferences.find(({ hash }) => !Object.values(context.artifactHashes).includes(hash));
    assert.ok(selected);
    const chunk = await service.readTaskInput(reconciliationTask, 0, 6_000, selected.hash);
    assert.match(chunk.content, /governance-baseline-selection-v2/);
  }
  const policy = policyMap(runId, governanceHashes["governance-constraints"]!) as PolicyPropertyMapV1;
  await configurePolicy?.(policy);
  const policyHashes = await complete(service, "governance-reconciliation", [
    { kind: "policy-property-map", value: policy },
  ]);
  await complete(service, "governance-review", [
    { kind: "review-findings", value: review(runId, "policy-property-map", policyHashes["policy-property-map"]!) },
  ]);
  await service.decideGateNumber(2, "approved", "tester");

  const plan = planBundle(
    runId,
    track,
    {},
    {
      requirements: requirementHashes.requirements!,
      architecture: architectureHashes.architecture!,
      "governance-constraints": governanceHashes["governance-constraints"]!,
      "policy-property-map": policyHashes["policy-property-map"]!,
    },
  );
  await configurePlan?.(plan);
  let planHashes = await complete(service, "plan", plan);
  if (revisePlan) {
    const reviewHashes = await complete(service, "plan-review", [
      {
        kind: "review-findings",
        value: review(runId, "plan", planHashes["implementation-intent"]!, [
          {
            id: "F-1",
            severity: "high",
            disposition: "open",
            title: "Revise",
            detail: "Rename resource",
            evidenceRefs: [],
          },
        ]),
      },
    ]);
    await service.decideReview(reviewHashes["review-findings"]!, [
      { findingId: "F-1", action: "revise", rationale: "Use the confirmed replacement resource name" },
    ]);
    const intent = plan.find(({ kind }) => kind === "implementation-intent")!.value as ImplementationIntentV1;
    const binding = plan.find(({ kind }) => kind === "iac-binding")!.value as IacBindingV1;
    const previousId = intent.resources[0]!.id;
    intent.resources[0]!.id = "replacement";
    binding.resourceBindings.replacement = binding.resourceBindings[previousId]!;
    delete binding.resourceBindings[previousId];
    binding.intentHash = sha256Json(intent);
    const previousHash = planHashes["implementation-intent"];
    planHashes = await complete(service, "plan", plan);
    assert.notEqual(planHashes["implementation-intent"], previousHash);
  }
  await complete(service, "plan-review", [
    { kind: "review-findings", value: review(runId, "plan", planHashes["implementation-intent"]!) },
  ]);
  await service.decideGateNumber(3, "approved", "tester");
  return { taskId: await task(service, `codegen-${track}`), plan };
}

function configureNativeBicepPlan(plan: ReturnType<typeof planBundle>): void {
  const intent = plan.find(({ kind }) => kind === "implementation-intent")!.value as ImplementationIntentV1;
  intent.resources.find(({ id }) => id === "api")!.type = "Microsoft.Storage/storageAccounts";
  const binding = plan.find(({ kind }) => kind === "iac-binding")!.value as IacBindingV1;
  binding.intentHash = sha256Json(intent);
}

async function reachValidation(
  service: ApexService,
  runId: string,
  track: "bicep" | "terraform",
  configurePlan?: (plan: ReturnType<typeof planBundle>) => void,
): Promise<void> {
  const codegen = await reachCodegen(service, runId, track, configurePlan);
  await service.completeTaskOutputs(codegen.taskId, codegenBundle(runId, track, codegen.plan));
  await complete(service, `validation-${track}`, [
    { kind: "validation-evidence", value: validationEvidence(runId, track) },
  ]);
}

test("material governance revision requires confirmation before accessing run or candidate", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await assert.rejects(service.reviseGovernanceBaseline("missing.json", { confirm: false, reason: "Policy changed" }), {
    code: "APEX_AUTHORIZATION",
  });
  assert.deepEqual(await readdir(root), []);
  await service.init({ projectId: "demo", iacTool: "bicep" });
  await assert.rejects(
    service.reviseGovernanceBaseline("missing.json", { confirm: true, reason: "Policy changed" }),
    /requires accepted imported governance/,
  );
});

test("governance baseline reader rejects parent swaps before and after reading", async () => {
  for (const swapAt of [2, 3]) {
    const root = await tempRoot();
    const outside = await tempRoot();
    const parent = join(root, "parent");
    await mkdir(parent);
    await writeFile(join(parent, "baseline.json"), "{}");
    await writeFile(join(outside, "baseline.json"), "{}");
    const service = new ApexService(root);
    const assertSafe = service["assertSafeDestination"].bind(service);
    let checks = 0;
    service["assertSafeDestination"] = async (...args) => {
      if (++checks === swapAt) {
        await rename(parent, join(root, "original"));
        await symlink(outside, parent);
      }
      return assertSafe(...args);
    };
    await assert.rejects(service["readGovernanceBaselineBytes"]("parent/baseline.json"), { code: "APEX_VALIDATION" });
  }
});

for (const track of ["bicep", "terraform"] as const) {
  for (const mixedOwnership of [false, true]) {
    test(`${track} excludes existing resources from apply and destroy (mixed: ${mixedOwnership})`, async () => {
      const root = await tempRoot();
      const capturedRequests: PreviewRequest[] = [];
      const stopped = new Error("Provider request captured without execution");
      const capturePreview = async (request: PreviewRequest): Promise<DeploymentPreviewV1> => {
        capturedRequests.push(request);
        throw stopped;
      };
      const provider = {
        ...(track === "bicep" ? bicepPreviewProvider(new Date()) : terraformPreviewProvider(new Date())),
        previewApply: capturePreview,
        previewDestroy: capturePreview,
      };
      const service = new ApexService(root, { providers: { [track]: provider } });
      const initialized = await service.init({
        projectId: "demo",
        iacTool: track,
        targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-test",
      });
      const codegen = await reachCodegen(service, initialized.runId, track, (plan) => {
        if (track === "bicep") configureNativeBicepPlan(plan);
        if (!mixedOwnership) return;
        const intent = plan.find(({ kind }) => kind === "implementation-intent")!.value as ImplementationIntentV1;
        intent.resources.push({ ...intent.resources[0]!, id: "managed", dependsOn: ["api"] });
        const binding = plan.find(({ kind }) => kind === "iac-binding")!.value as IacBindingV1;
        binding.resourceBindings.managed = {
          ...binding.resourceBindings.api!,
          parameters: {
            ...binding.resourceBindings.api!.parameters,
            name: "manageddemo",
          },
        };
        binding.intentHash = sha256Json(intent);
      });
      const bundle = codegenBundle(initialized.runId, track, codegen.plan);
      const manifest = bundle.find(({ kind }) => kind === "logical-resource-manifest")!
        .value as LogicalResourceManifestV1;
      for (const resource of manifest.resources) {
        resource.ownership = "existing";
        resource.implementationKind = track === "bicep" ? "existing" : "data";
      }
      if (mixedOwnership) {
        manifest.resources.push({
          ...manifest.resources[0]!,
          logicalId: "managed",
          implementationAddress: (codegen.plan[1]!.value as IacBindingV1).resourceBindings.managed!.implementation,
          executionAddress: track === "terraform" ? "azapi_resource.managed" : "managed",
          ownership: "managed",
          implementationKind: "resource",
          dependsOn: ["api"],
          generatedDependencies: ["api"],
        });
      }
      const handoff = bundle.find(({ kind }) => kind === "iac-handoff")!.value as {
        logicalResourceManifestHash: string;
      };
      handoff.logicalResourceManifestHash = sha256Json(manifest);
      await service.completeTaskOutputs(codegen.taskId, bundle);
      await complete(service, `validation-${track}`, [
        { kind: "validation-evidence", value: validationEvidence(initialized.runId, track) },
      ]);
      for (const operation of ["apply", "destroy"] as const) {
        await assert.rejects(service.preview({ operation, provider: track }), (error: unknown) => error === stopped);
        assert.deepEqual(
          capturedRequests.at(-1)?.resources.map(({ logicalId }) => logicalId),
          mixedOwnership ? ["managed"] : [],
        );
        assert.equal(capturedRequests.at(-1)?.inputHash, sha256Json(codegen.plan[0]!.value));
        const preview = await service.preview({ operation, provider: "fake" });
        assert.deepEqual(
          preview.changes.map(({ resourceId }) => resourceId),
          mixedOwnership ? ["fake://dev/managed"] : [],
        );
        assert.equal((await service.status()).run.gates[3]?.state, "open");
        await service.decideGateNumber(4, "approved", "tester");
        const deployed = await service.deploy(preview.previewHash);
        assert.deepEqual(
          deployed.inventory.resources.map(({ logicalId }) => logicalId),
          mixedOwnership && operation === "apply" ? ["managed"] : [],
        );
      }
      assert.equal(capturedRequests.length, 2);
    });
  }

  test(`${track} rejects contradictory resource ownership before staging`, async () => {
    const root = await tempRoot();
    const service = new ApexService(root);
    const initialized = await service.init({ projectId: "demo", iacTool: track });
    const codegen = await reachCodegen(service, initialized.runId, track);
    const bundle = codegenBundle(initialized.runId, track, codegen.plan);
    const output = bundle.find(({ kind }) => kind === "logical-resource-manifest")!;
    const manifest = output.value as LogicalResourceManifestV1;
    const invalid = {
      ...manifest,
      resources: manifest.resources.map((resource) => ({ ...resource, ownership: "existing" as const })),
    };
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"));
    const head = await journal.head();
    const rejectOwnership = (error: unknown) =>
      error instanceof ApexError && error.code === "APEX_VALIDATION" && error.message.includes("ownership");
    await assert.rejects(
      service.stageArtifact(codegen.taskId, { kind: "logical-resource-manifest", value: invalid }),
      rejectOwnership,
    );
    await assert.rejects(
      service.completeTaskOutputs(
        codegen.taskId,
        bundle.map((entry) => (entry.kind === "logical-resource-manifest" ? { ...entry, value: invalid } : entry)),
      ),
      rejectOwnership,
    );
    assert.equal(await journal.head(), head);
    await assert.rejects(
      readFile(join(root, ".apex", "work", initialized.runId, codegen.taskId, "logical-resource-manifest.json")),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    const accepted = await service.stageArtifact(codegen.taskId, {
      kind: "logical-resource-manifest",
      value: {
        ...invalid,
        resources: invalid.resources.map((resource) => ({
          ...resource,
          implementationKind: track === "bicep" ? "existing" : "data",
        })),
      },
    });
    assert.equal(accepted.kind, "logical-resource-manifest");
  });
}

function terraformPreviewProvider(
  now: Date,
  mutation?:
    | "input-hash"
    | "foreign-address"
    | "operation"
    | "state"
    | "apply-error"
    | "missing-receipt"
    | "extra-receipt"
    | "inventory-once"
    | "secret-inventory"
    | "incomplete-inventory",
): IacProvider & {
  attestation(previewHash: string): ExecutionPlanAttestationV1 | undefined;
} {
  let attestation: ExecutionPlanAttestationV1 | undefined;
  let executionEvidence:
    { mode: "native"; operationId: string; previewHash: string; validatorIds: string[] } | undefined;
  let inventoryCalls = 0;
  let latestPreview: DeploymentPreviewV1 | undefined;
  const createPreview = async (request: PreviewRequest): Promise<DeploymentPreviewV1> => {
    const plan = {
      planDigest: "1".repeat(64),
      configHash: "2".repeat(64),
      lockfileHash: "3".repeat(64),
      recipient: "local",
      artifactRef: "plans/test.tfplan.enc",
    };
    const base = {
      schemaVersion: "1.0.0" as const,
      projectId: request.projectId,
      runId: request.runId,
      environment: request.environment as "dev",
      track: "terraform" as const,
      operation: (mutation === "operation" ? "destroy" : "apply") as "apply" | "destroy",
      target: request.target,
      commit: request.commit,
      dependencyRevision: request.dependencyRevision,
      ownerEpoch: request.ownerEpoch,
      inputHash: mutation === "input-hash" ? "f".repeat(64) : request.inputHash,
      iacHash: request.iacHash,
      policyHash: request.policyHash,
      artifactHash: sha256Json(plan),
      stateLineage: "lineage-1",
      stateSerial: 1,
      changes: request.resources.map(({ logicalId }) => ({
        resourceId: mutation === "foreign-address" ? "azapi_resource.foreign" : `azapi_resource.${logicalId}`,
        action: "create" as const,
        material: true,
      })),
      blockers: [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + request.ttlMs).toISOString(),
    };
    const preview = { ...base, previewHash: sha256Json(base) };
    latestPreview = preview;
    attestation = {
      schemaVersion: "1.0.0",
      projectId: request.projectId,
      runId: request.runId,
      track: "terraform",
      previewHash: preview.previewHash,
      inputHash: preview.inputHash,
      iacHash: preview.iacHash,
      policyHash: preview.policyHash,
      configHash: plan.configHash,
      lockfileHash: plan.lockfileHash,
      recipient: plan.recipient,
      planDigest: plan.planDigest,
      artifactRef: plan.artifactRef,
      stateLineage: mutation === "state" ? "lineage-other" : preview.stateLineage,
      stateSerial: preview.stateSerial,
      transport: {
        encrypted: true,
        implementation: "local-reference",
        algorithm: "aes-256-gcm",
        recipient: "local",
        mediaType: "application/vnd.apex.terraform-plan",
        iv: "iv",
        authTag: "tag",
      },
      createdAt: now.toISOString(),
      expiresAt: preview.expiresAt,
    };
    return preview;
  };
  return {
    track: "terraform",
    validationMode: "simulated",
    validate: async () => [],
    previewApply: createPreview,
    previewDestroy: createPreview,
    apply: async (preview, approval, authority) => {
      if (mutation === "apply-error") throw new Error("provider apply outcome is unknown");
      const operation = {
        schemaVersion: "1.0.0" as const,
        operationId: "terraform-operation",
        projectId: preview.projectId,
        runId: preview.runId,
        providerOperationId: "terraform-plan:test",
        operation: preview.operation,
        state: "succeeded" as const,
        previewHash: preview.previewHash,
        approvalHash: sha256Json(approval),
        ownerEpoch: authority.ownerEpoch,
        updatedAt: now.toISOString(),
      };
      if (mutation !== "missing-receipt") {
        executionEvidence = {
          mode: "native",
          operationId: operation.operationId,
          previewHash: preview.previewHash,
          validatorIds: [
            "deploy:exact-saved-plan",
            "deploy:state-lineage-and-serial",
            ...(mutation === "extra-receipt" ? ["deploy:undeclared"] : []),
          ],
        };
      }
      return operation;
    },
    destroy: async () => {
      throw new Error("not used");
    },
    inventory: async (projectId, runId) => {
      inventoryCalls += 1;
      if (mutation === "inventory-once" && inventoryCalls === 1) throw new Error("inventory unavailable");
      return {
        schemaVersion: "1.0.0" as const,
        projectId,
        runId,
        deploymentHash: "9".repeat(64),
        collectedAt: now.toISOString(),
        resources:
          mutation === "incomplete-inventory"
            ? []
            : (latestPreview?.changes ?? []).map(({ resourceId }) => ({
                logicalId: resourceId,
                resourceId,
                type: "terraform/resource",
                location: "terraform-managed",
                properties:
                  mutation === "secret-inventory" ? { token: "Bearer secret-token-value" } : { provider: "terraform" },
              })),
      };
    },
    reconcile: async () => undefined,
    attestation: (previewHash) => (attestation?.previewHash === previewHash ? attestation : undefined),
    executionEvidence: (operationId) =>
      executionEvidence?.operationId === operationId ? executionEvidence : undefined,
  };
}

function bicepPreviewProvider(now: Date): IacProvider {
  let executionEvidence:
    { mode: "native"; operationId: string; previewHash: string; validatorIds: string[] } | undefined;
  let latestPreview: DeploymentPreviewV1 | undefined;
  const createPreview = async (request: PreviewRequest): Promise<DeploymentPreviewV1> => {
    const base = {
      schemaVersion: "1.0.0" as const,
      projectId: request.projectId,
      runId: request.runId,
      environment: request.environment as "dev",
      track: "bicep" as const,
      operation: "apply" as const,
      target: request.target,
      commit: request.commit,
      dependencyRevision: request.dependencyRevision,
      ownerEpoch: request.ownerEpoch,
      inputHash: request.inputHash,
      iacHash: request.iacHash,
      policyHash: request.policyHash,
      artifactHash: "8".repeat(64),
      changes: request.resources.map(({ logicalId, resourceId }) => ({
        resourceId:
          logicalId === "api" ? `${request.target}/providers/Microsoft.Storage/storageAccounts/apidemo` : resourceId,
        action: "create" as const,
        material: true,
      })),
      blockers: [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + request.ttlMs).toISOString(),
    };
    latestPreview = { ...base, previewHash: sha256Json(base) };
    return latestPreview;
  };
  return {
    track: "bicep",
    validationMode: "simulated",
    validate: async () => [],
    previewApply: createPreview,
    previewDestroy: createPreview,
    apply: async (preview, approval, authority) => {
      const operation = {
        schemaVersion: "1.0.0" as const,
        operationId: "bicep-operation",
        projectId: preview.projectId,
        runId: preview.runId,
        providerOperationId: "/stack/workload",
        operation: preview.operation,
        state: "succeeded" as const,
        previewHash: preview.previewHash,
        approvalHash: sha256Json(approval),
        ownerEpoch: authority.ownerEpoch,
        updatedAt: now.toISOString(),
      };
      executionEvidence = {
        mode: "native",
        operationId: operation.operationId,
        previewHash: preview.previewHash,
        validatorIds: ["deploy:bicep-stack-ownership"],
      };
      return operation;
    },
    destroy: async () => {
      throw new Error("not used");
    },
    inventory: async (projectId, runId) => ({
      schemaVersion: "1.0.0",
      projectId,
      runId,
      deploymentHash: "7".repeat(64),
      collectedAt: now.toISOString(),
      resources: (latestPreview?.changes ?? []).map(({ resourceId }) => ({
        logicalId: resourceId,
        resourceId,
        type: "bicep/resource",
        location: "swedencentral",
        properties: { provider: "bicep" },
      })),
    }),
    reconcile: async () => undefined,
    executionEvidence: (operationId) =>
      executionEvidence?.operationId === operationId ? executionEvidence : undefined,
  };
}

test("validation completion executes configured native checks instead of trusting submitted hashes", async () => {
  const root = await tempRoot();
  let calls = 0;
  const service = new ApexService(root, {
    providers: {
      bicep: {
        ...bicepPreviewProvider(new Date()),
        async validateSource(request) {
          calls++;
          assert.equal(request.projectId, "demo");
          assert.ok(request.generatedSource.rootPath.startsWith(root));
          throw new Error("native source validation failed");
        },
      },
    },
  });
  const { runId } = await service.init({ projectId: "demo", iacTool: "bicep" });
  const generated = await reachCodegen(service, runId, "bicep");
  await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, "bicep", generated.plan));
  const validationTask = await task(service, "validation-bicep");
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const head = await journal.head();
  await assert.rejects(
    service.completeTaskOutputs(validationTask, [
      { kind: "validation-evidence", value: validationEvidence(runId, "bicep") },
    ]),
    /native source validation failed/,
  );
  assert.equal(calls, 1);
  assert.equal(await journal.head(), head);
});

test("native validation receives accepted concrete policy mappings and resource bindings on both tracks", async () => {
  for (const track of ["bicep", "terraform"] as const) {
    const root = await tempRoot();
    let calls = 0;
    let expectedPolicy: PolicyPropertyMapV1;
    let expectedBindings: Record<string, { codeSymbol: string } | { terraformAddress: string }>;
    const provider: IacProvider = {
      ...(track === "bicep" ? bicepPreviewProvider(new Date()) : terraformPreviewProvider(new Date())),
      async validateSource(request) {
        calls++;
        const input = request.policyValidation;
        assert.ok(input, "Native validation must receive concrete policy inputs, not only a hash");
        assert.deepEqual(input.policyMap, expectedPolicy);
        assert.equal(sha256Json(input.policyMap), request.policyHash);
        assert.deepEqual(input.logicalResourceManifest, expectedBindings);
        throw new Error("policy inputs inspected");
      },
    };
    const service = new ApexService(root, { providers: { [track]: provider } });
    const { runId } = await service.init({ projectId: "demo", iacTool: track });
    const generated = await reachCodegen(service, runId, track, undefined, false, undefined, (policy) => {
      for (const effect of ["deny", "modify", "deployIfNotExists"] as const) {
        policy.mappings.push({
          policyAssignmentId: `assignment-${effect}`,
          effect,
          logicalResourceId: "api",
          propertyPath: "properties.httpsOnly",
          expectedValue: true,
          disposition: "planned",
        });
      }
    });
    const objects = new ObjectStore(root);
    const policyHash = (generated.plan[0]!.value as ImplementationIntentV1).sourceHashes["policy-property-map"]!;
    expectedPolicy = await objects.getJson<PolicyPropertyMapV1>(policyHash);
    const outputs = codegenBundle(runId, track, generated.plan);
    const manifest = outputs.find(({ kind }) => kind === "logical-resource-manifest")!
      .value as LogicalResourceManifestV1;
    expectedBindings = Object.fromEntries(
      manifest.resources
        .filter(({ ownership, executionAddress }) => ownership === "managed" && executionAddress !== undefined)
        .map(({ logicalId, executionAddress }) => [
          logicalId,
          track === "bicep" ? { codeSymbol: executionAddress! } : { terraformAddress: executionAddress! },
        ]),
    );
    assert.ok(Object.keys(expectedBindings).length > 0);
    await service.completeTaskOutputs(generated.taskId, outputs);
    const validationTask = await task(service, `validation-${track}`);
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    const head = await journal.head();
    await assert.rejects(
      service.completeTaskOutputs(validationTask, [
        { kind: "validation-evidence", value: validationEvidence(runId, track) },
      ]),
      /policy inputs inspected/,
    );
    assert.equal(calls, 1);
    assert.equal(await journal.head(), head);
    assert.equal((await service.status()).run.gates[3]!.state, "closed");
  }
});

test("native adapters cannot silently fall back to simulated validation", async () => {
  const root = await tempRoot();
  const provider = bicepPreviewProvider(new Date());
  Reflect.deleteProperty(provider, "validationMode");
  const service = new ApexService(root, { providers: { bicep: provider } });
  const { runId } = await service.init({ projectId: "demo", iacTool: "bicep" });
  const generated = await reachCodegen(service, runId, "bicep");
  await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, "bicep", generated.plan));
  await assert.rejects(
    complete(service, "validation-bicep", [{ kind: "validation-evidence", value: validationEvidence(runId, "bicep") }]),
    /does not support native source validation/,
  );
});

test("native validation receipts are source-bound, runtime-owned and distinguish unexecuted checks", async () => {
  for (const track of ["bicep", "terraform"] as const) {
    const root = await tempRoot();
    let stale = true;
    let now = new Date();
    let expireDuringValidation = false;
    const provider: IacProvider = {
      ...(track === "bicep" ? bicepPreviewProvider(new Date()) : terraformPreviewProvider(new Date())),
      async validateSource(request) {
        if (expireDuringValidation) now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
        const receipt = {
          schemaVersion: "1.0.0" as const,
          projectId: request.projectId,
          runId: request.runId,
          track,
          sourceHash: stale ? "f".repeat(64) : request.sourceHash,
          treeHash: request.generatedSource.treeHash,
          inputHash: request.inputHash,
          policyHash: request.policyHash,
          outcome: "pass" as const,
          ...(track !== "terraform"
            ? {}
            : {
                policyValidation: validatePolicyProperties({
                  track,
                  sourceHash: request.sourceHash,
                  policyMapHash: request.policyHash,
                  policyMap: {
                    schemaVersion: "1.0.0",
                    projectId: request.projectId,
                    runId: request.runId,
                    governanceHash: request.policyHash,
                    mappings: [
                      {
                        policyAssignmentId: "unrequested",
                        effect: "deny",
                        logicalResourceId: "api",
                        propertyPath: "enabled",
                        expectedValue: true,
                        disposition: "planned",
                      },
                    ],
                  },
                  logicalResourceManifest: { api: { terraformAddress: "azapi_resource.api" } },
                  json: JSON.stringify({
                    planned_values: {
                      root_module: {
                        resources: [{ address: "azapi_resource.api", mode: "managed", values: { enabled: true } }],
                      },
                    },
                    resource_changes: [
                      {
                        address: "azapi_resource.api",
                        mode: "managed",
                        change: { actions: ["create"], after: { enabled: true }, after_unknown: {} },
                      },
                    ],
                  }),
                }),
              }),
          commands: NATIVE_VALIDATION_COMMANDS[track].map((command) => ({
            validatorId: command.validatorId,
            commandHash: calculateNativeValidationCommandHash(command),
            exitCode: 0 as const,
            signal: null,
            timedOut: false as const,
            outputTruncated: false as const,
          })),
        };
        return { ...receipt, receiptHash: calculateNativeValidationReceiptHash(receipt) };
      },
    };
    const service = new ApexService(root, { providers: { [track]: provider }, clock: () => now });
    const { runId } = await service.init({
      projectId: "demo",
      iacTool: track,
      targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-test",
    });
    const generated = await reachCodegen(
      service,
      runId,
      track,
      track === "bicep" ? configureNativeBicepPlan : undefined,
    );
    const generatedHashes = await service.completeTaskOutputs(
      generated.taskId,
      codegenBundle(runId, track, generated.plan),
    );
    const validationTask = await task(service, `validation-${track}`);
    const submitted = validationEvidence(runId, track);
    const original = structuredClone(submitted);
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    const head = await journal.head();
    await assert.rejects(
      service.completeTaskOutputs(validationTask, [{ kind: "validation-evidence", value: submitted }]),
      /receipt is invalid or stale/,
    );
    assert.equal(await journal.head(), head);
    stale = false;
    const originalTime = now;
    expireDuringValidation = true;
    await assert.rejects(service.validateTask(validationTask), /expired/i);
    assert.equal(await journal.head(), head);
    now = originalTime;
    expireDuringValidation = false;
    const checked = await service.validateTask(validationTask);
    assert.equal(checked.valid, false);
    assert.equal(checked.execution?.mode, "native");
    assert.deepEqual(
      [...checked.execution!.executedValidatorIds].sort(),
      NATIVE_VALIDATION_COMMANDS[track].map(({ validatorId }) => validatorId).sort(),
    );
    assert.deepEqual(checked.execution?.blockedValidatorIds, [
      "business:security-baseline",
      "business:policy-property-map",
      "business:logical-resource-parity",
    ]);
    assert.equal(await journal.head(), head);
    const partial = checked.outputs![0]!.value as ReturnType<typeof validationEvidence>;
    assert.equal(partial.entries.length, 3);
    for (const entry of partial.entries) {
      const stored = await new ObjectStore(root).getJson<{ sourceHash: string }>(entry.hash);
      assert.equal(stored.sourceHash, generatedHashes.outputHashes["iac-handoff"]);
    }
    await assert.rejects(
      service.completeTaskOutputs(validationTask, checked.outputs!),
      /business:security-baseline validation failed/,
    );
    assert.equal(await journal.head(), head);
    assert.equal((await service.status()).run.gates[3]!.state, "closed");
    const { validationMode: simulatedMode, ...nativeOnly } = provider;
    assert.equal(simulatedMode, "simulated");
    const production = new ApexService(root, { providers: { [track]: nativeOnly }, clock: () => now });
    await assert.rejects(
      production.completeTaskOutputs(validationTask, [{ kind: "validation-evidence", value: submitted }]),
      /Native validation requires executed evidence for every required validator/,
    );
    assert.equal(await journal.head(), head);
    const server = createMcpServer(service);
    const client = new Client({ name: "validation-evidence-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const response = await client.callTool({ name: "validateTask", arguments: { taskId: validationTask } });
      assert.notEqual(response.isError, true);
      const result = response.structuredContent as Record<string, unknown>;
      assert.equal(result.valid, false);
      assert.deepEqual(result.execution, checked.execution);
      assert.equal(await journal.head(), head);
    } finally {
      await client.close();
      await server.close();
    }
    const submittedOutputs: TaskOutput[] = [{ kind: "validation-evidence", value: submitted }];
    Object.freeze(submittedOutputs);
    const accepted = await service.completeTaskOutputs(validationTask, submittedOutputs);
    assert.equal(submittedOutputs[0]!.value, submitted);
    assert.deepEqual(submitted, original);
    const completion = (await journal.replay()).findLast((event) => event.type === "task.completed")!;
    const payload = completion.payload as {
      validatorEvidenceRefs: Record<string, string>;
      validatorEvidenceModes: Record<string, string>;
    };
    const objects = new ObjectStore(root);
    for (const { validatorId } of NATIVE_VALIDATION_COMMANDS[track]) {
      assert.equal(payload.validatorEvidenceModes[validatorId], "native");
      const receipt = await objects.getJson<{ sourceHash: string }>(payload.validatorEvidenceRefs[validatorId]!);
      assert.equal(receipt.sourceHash, generatedHashes.outputHashes["iac-handoff"]);
    }
    assert.equal(payload.validatorEvidenceModes["business:policy-property-map"], "simulated");
    assert.equal(payload.validatorEvidenceRefs["business:policy-property-map"], undefined);
    const evidence = await objects.getJson<ReturnType<typeof validationEvidence>>(
      accepted.outputHashes["validation-evidence"]!,
    );
    for (const { validatorId } of NATIVE_VALIDATION_COMMANDS[track]) {
      assert.equal(
        evidence.entries.find(({ kind }) => kind === validatorId)!.hash,
        payload.validatorEvidenceRefs[validatorId],
      );
    }
    const report = await readFile(
      join(root, "agent-output", "demo", runId, "validation", "validation-report.md"),
      "utf8",
    );
    assert.match(report, /immutable; native/);
    assert.match(report, /immutable; simulated/);
    const restarted = new ApexService(root, { providers: { [track]: provider } });
    await restarted.preview({ operation: "apply", provider: track });
    assert.equal((await restarted.status()).run.gates[3]!.state, "open");
  }
});

test("Bicep validation acceptance requires complete bound policy evidence before advancing", async () => {
  const root = await tempRoot();
  let mode = "missing";
  const provider: IacProvider = {
    ...bicepPreviewProvider(new Date()),
    async validateSource(request) {
      assert.ok(request.policyValidation);
      const policy = structuredClone(
        validatePolicyProperties({
          ...request.policyValidation,
          track: "bicep",
          sourceHash: request.sourceHash,
          policyMapHash: request.policyHash,
          json: JSON.stringify({ resources: { api: { properties: { httpsOnly: true } } } }),
        }),
      );
      if (mode === "wrong-map") policy.policyMapContentHash = "f".repeat(64);
      if (mode === "wrong-manifest") policy.logicalResourceManifestHash = "f".repeat(64);
      if (mode === "partial") policy.results.pop();
      if (mode === "wrong-mapping") policy.results[0]!.mappingHash = "f".repeat(64);
      if (
        [
          "policyAssignmentId",
          "policyDefinitionId",
          "policyDefinitionReferenceId",
          "logicalResourceId",
          "propertyPath",
        ].includes(mode)
      )
        Object.assign(policy.results[0]!, { [mode]: "different" });
      if (mode === "effect") policy.results[0]!.effect = "modify";
      if (mode === "disposition") policy.results[0]!.disposition = "satisfied";
      if (mode === "expected-value") {
        policy.results[0]!.expectedValueDigest = sha256Json(false);
        policy.results[0]!.observedValueDigest = sha256Json(false);
      }
      const { receiptHash: policyHash, ...policyBody } = policy;
      assert.ok(policyHash);
      const body = {
        schemaVersion: "1.0.0" as const,
        projectId: request.projectId,
        runId: request.runId,
        track: "bicep" as const,
        sourceHash: request.sourceHash,
        treeHash: request.generatedSource.treeHash,
        inputHash: request.inputHash,
        policyHash: request.policyHash,
        outcome: "pass" as const,
        commands: NATIVE_VALIDATION_COMMANDS.bicep.map((command) => ({
          validatorId: command.validatorId,
          commandHash: calculateNativeValidationCommandHash(command),
          exitCode: 0 as const,
          signal: null,
          timedOut: false as const,
          outputTruncated: false as const,
        })),
        ...(mode === "missing"
          ? {}
          : {
              policyValidation: { ...policyBody, receiptHash: calculatePolicyValidationHash(policyBody) },
            }),
      };
      return { ...body, receiptHash: calculateNativeValidationReceiptHash(body) };
    },
  };
  const service = new ApexService(root, { providers: { bicep: provider } });
  const { runId } = await service.init({ projectId: "demo", iacTool: "bicep" });
  const generated = await reachCodegen(service, runId, "bicep", undefined, false, undefined, (policy) => {
    for (const effect of ["deny", "modify", "deployIfNotExists"] as const) {
      policy.mappings.push({
        policyAssignmentId: effect,
        effect,
        logicalResourceId: "api",
        propertyPath: "properties.httpsOnly",
        expectedValue: true,
        disposition: "planned",
      });
    }
  });
  await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, "bicep", generated.plan));
  const validationTask = await task(service, "validation-bicep");
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const head = await journal.head();
  for (mode of [
    "missing",
    "wrong-map",
    "wrong-manifest",
    "partial",
    "wrong-mapping",
    "policyAssignmentId",
    "policyDefinitionId",
    "policyDefinitionReferenceId",
    "logicalResourceId",
    "propertyPath",
    "effect",
    "disposition",
    "expected-value",
  ]) {
    await assert.rejects(service.validateTask(validationTask), /Native validation receipt is invalid or incomplete/);
    await assert.rejects(
      service.completeTaskOutputs(validationTask, [
        { kind: "validation-evidence", value: validationEvidence(runId, "bicep") },
      ]),
      /Native validation requires passing source-bound policy evidence/,
    );
    assert.equal(await journal.head(), head);
    assert.equal((await service.status()).run.gates[3]!.state, "closed");
  }
  mode = "pass";
  const accepted = await service.completeTaskOutputs(validationTask, [
    { kind: "validation-evidence", value: validationEvidence(runId, "bicep") },
  ]);
  const event = (await journal.replay()).findLast(({ type }) => type === "task.completed")!;
  const payload = event.payload as {
    validatorEvidenceRefs: Record<string, string>;
    validatorEvidenceModes: Record<string, string>;
  };
  assert.equal(payload.validatorEvidenceModes["business:policy-property-map"], "native");
  const objects = new ObjectStore(root);
  const evidence = await objects.getJson<ReturnType<typeof validationEvidence>>(
    accepted.outputHashes["validation-evidence"]!,
  );
  assert.equal(
    evidence.entries.find(({ kind }) => kind === "business:policy-property-map")!.hash,
    payload.validatorEvidenceRefs["business:policy-property-map"],
  );
});

test("native preview refuses historical label-only validation when source checks are available", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({
    projectId: "demo",
    iacTool: "bicep",
    targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-test",
  });
  await reachValidation(service, runId, "bicep", configureNativeBicepPlan);
  let previewCalls = 0;
  const restarted = new ApexService(root, {
    providers: {
      bicep: {
        ...bicepPreviewProvider(new Date()),
        async validateSource() {
          throw new Error("must not run validation during preview");
        },
        async previewApply() {
          previewCalls++;
          throw new Error("preview must not execute");
        },
      },
    },
  });
  await assert.rejects(restarted.preview({ operation: "apply", provider: "bicep" }), /runtime-owned native validation/);
  assert.equal(previewCalls, 0);
  assert.equal((await restarted.status()).run.gates[3]!.state, "closed");
});

test("validation without a submitted bundle cannot claim executed checks", async () => {
  for (const track of ["bicep", "terraform"] as const) {
    const root = await tempRoot();
    const service = new ApexService(root);
    const { runId } = await service.init({ projectId: "demo", iacTool: track });
    const generated = await reachCodegen(service, runId, track);
    await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, track, generated.plan));
    const validationTask = await task(service, `validation-${track}`);
    const before = await service.status();
    await assert.rejects(service.validateTask(validationTask), /native source validation provider/i);
    assert.deepEqual(await service.status(), before);
  }
});

test("validation task inputs include the accepted policy map on both tracks", async () => {
  for (const track of ["bicep", "terraform"] as const) {
    const service = new ApexService(await tempRoot());
    const { runId } = await service.init({ projectId: "demo", iacTool: track });
    const generated = await reachCodegen(service, runId, track);
    await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, track, generated.plan));
    const validationTask = await task(service, `validation-${track}`);
    const context = await service.taskContext(validationTask);
    const policyHash = (generated.plan[0]!.value as ImplementationIntentV1).sourceHashes["policy-property-map"]!;
    assert.equal(context.artifactHashes["policy-property-map"], policyHash);
    assert.ok(context.inputReferences.some(({ hash }) => hash === policyHash));
  }
});

test("task completion records executed manifest validators in order", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await service.nextTask();
  await complete(service, "requirements", [{ kind: "requirements", value: requirements() }]);

  const events = await new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal")).replay();
  const completed = events.find(
    (event) => event.type === "task.completed" && (event.payload as { nodeId?: unknown }).nodeId === "requirements",
  );
  assert.deepEqual((completed?.payload as { validatorIds?: unknown }).validatorIds, [
    "schema:requirements-v1",
    "business:requirements-completeness",
  ]);
});

test("task validation refuses workflow bytes outside the run lock", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const workflowPath = join(
    root,
    ".apex",
    "runtime-generations",
    (await service.status()).run.runtimeLockHash,
    "workflow.v1.json",
  );
  const workflowBytes = await readFile(workflowPath);
  await writeFile(workflowPath, Buffer.concat([workflowBytes, Buffer.from("\n")]));
  await assert.rejects(
    service.completeTaskOutputs(issued.task.taskId, [{ kind: "requirements", value: requirements() }]),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
  );
});

test("gate approval records executed manifest validators in order", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await service.nextTask();
  const requirementHashes = await complete(service, "requirements", [{ kind: "requirements", value: requirements() }]);
  await complete(service, "requirements-review", [
    {
      kind: "review-findings",
      value: review(runId, "requirements", requirementHashes.requirements!),
    },
  ]);
  const workflowPath = join(
    root,
    ".apex",
    "runtime-generations",
    (await service.status()).run.runtimeLockHash,
    "workflow.v1.json",
  );
  const workflowBytes = await readFile(workflowPath);
  await writeFile(workflowPath, Buffer.concat([workflowBytes, Buffer.from("\n")]));
  await assert.rejects(
    service.decideGateNumber(1, "approved", "tester"),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
  );
  await writeFile(workflowPath, workflowBytes);
  await service.decideGateNumber(1, "approved", "tester");

  const events = await new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal")).replay();
  const decided = events.find(
    (event) => event.type === "gate.decided" && (event.payload as { gate?: unknown }).gate === 1,
  );
  assert.deepEqual((decided?.payload as { validatorIds?: unknown }).validatorIds, ["gate:requirements-ready"]);
});

test("task-bound workflow validators reject semantic and evidence mutations", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", iacTool: "bicep" });
  await service.nextTask();

  const requirementTask = await task(service, "requirements");
  const duplicateRequirements = structuredClone(requirements());
  duplicateRequirements.requirements.push({ ...duplicateRequirements.requirements[0]! });
  await assert.rejects(
    service.completeTaskOutputs(requirementTask, [{ kind: "requirements", value: duplicateRequirements }]),
    /business:requirements-completeness/,
  );
  const requirementValues = requirements();
  const requirementHashes = await service.completeTaskOutputs(requirementTask, [
    { kind: "requirements", value: requirementValues },
  ]);

  const requirementReviewTask = await task(service, "requirements-review");
  const duplicateFinding = {
    id: "F-1",
    severity: "info",
    disposition: "dismissed",
    title: "Duplicate",
    detail: "Duplicate review identifier",
    evidenceRefs: [],
  };
  await assert.rejects(
    service.completeTaskOutputs(requirementReviewTask, [
      {
        kind: "review-findings",
        value: review(runId, "requirements", requirementHashes.outputHashes.requirements!, [
          duplicateFinding,
          duplicateFinding,
        ]),
      },
    ]),
    /review:requirements-comprehensive/,
  );
  await service.completeTaskOutputs(requirementReviewTask, [
    {
      kind: "review-findings",
      value: review(runId, "requirements", requirementHashes.outputHashes.requirements!),
    },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  const availabilityHash = await acceptAvailabilityEvidence(service, runId);

  const architectureTask = await task(service, "architecture");
  const untraceableArchitecture = architecture(runId);
  untraceableArchitecture.components[0]!.requirementIds = ["REQ-UNKNOWN"];
  const untraceableCost = costEstimate(runId);
  await assert.rejects(
    service.completeTaskOutputs(architectureTask, [
      { kind: "architecture", value: untraceableArchitecture },
      { kind: "cost-estimate", value: untraceableCost },
      {
        kind: "workload-decision-manifest",
        value: workloadDecisionManifest({
          runId,
          requirementsHash: requirementHashes.outputHashes.requirements!,
          architectureHash: sha256Json(untraceableArchitecture),
          costEstimateHash: sha256Json(untraceableCost),
        }),
      },
    ]),
    /business:requirements-traceability/,
  );
  const architectureValue = architecture(runId);
  const costValue = costEstimate(runId);
  const architectureWithoutWaf = structuredClone(architectureValue);
  delete architectureWithoutWaf.wellArchitectedAssessment;
  await assert.rejects(
    service.completeTaskOutputs(architectureTask, [
      { kind: "architecture", value: architectureWithoutWaf },
      { kind: "cost-estimate", value: costValue },
      {
        kind: "workload-decision-manifest",
        value: workloadDecisionManifest({
          runId,
          requirementsHash: requirementHashes.outputHashes.requirements!,
          architectureHash: sha256Json(architectureWithoutWaf),
          costEstimateHash: sha256Json(costValue),
        }),
      },
    ]),
    /business:well-architected-assessment-complete/,
  );
  const architectureHashes = await service.completeTaskOutputs(architectureTask, [
    { kind: "architecture", value: architectureValue },
    { kind: "cost-estimate", value: costValue },
    {
      kind: "workload-decision-manifest",
      value: workloadDecisionManifest({
        runId,
        requirementsHash: requirementHashes.outputHashes.requirements!,
        architectureHash: sha256Json(architectureValue),
        costEstimateHash: sha256Json(costValue),
      }),
    },
  ]);
  const architectureEvents = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", runId, "journal"),
  ).replay();
  const architectureCompleted = architectureEvents.find(
    (event) => event.type === "task.completed" && (event.payload as { nodeId?: unknown }).nodeId === "architecture",
  );
  assert.deepEqual((architectureCompleted?.payload as { validatorIds?: unknown }).validatorIds, [
    "schema:architecture-v1",
    "schema:workload-decision-manifest-v1",
    "business:requirements-traceability",
    "business:well-architected-assessment-complete",
    "business:workload-decision-manifest-coverage",
    "business:cost-arithmetic",
  ]);
  assert.equal(availabilityHash.length, 64);
  const architectureReviewTask = await task(service, "architecture-review");
  const reviewWithoutCriteria = review(runId, "architecture", architectureHashes.outputHashes.architecture!);
  delete reviewWithoutCriteria.criteria;
  await assert.rejects(
    service.completeTaskOutputs(architectureReviewTask, [{ kind: "review-findings", value: reviewWithoutCriteria }]),
    /review:well-architected-criteria-complete/,
  );
  await service.completeTaskOutputs(architectureReviewTask, [
    {
      kind: "review-findings",
      value: review(runId, "architecture", architectureHashes.outputHashes.architecture!),
    },
  ]);

  const governanceTask = await task(service, "governance-discovery");
  await assert.rejects(
    service.completeTaskOutputs(governanceTask, [
      { kind: "governance-constraints", value: { ...governance(runId), expiresAt: "2020-01-01T00:00:00.000Z" } },
    ]),
    /business:governance-freshness/,
  );
  const multiEffectGovernance = governance(runId);
  multiEffectGovernance.summary.assignmentCount = 1;
  multiEffectGovernance.summary.denyCount = 1;
  multiEffectGovernance.summary.auditCount = 1;
  multiEffectGovernance.constraintsRef.bytes = 1;
  const governanceHashes = await service.completeTaskOutputs(governanceTask, [
    { kind: "governance-constraints", value: multiEffectGovernance },
  ]);
  const policyHashes = await complete(service, "governance-reconciliation", [
    {
      kind: "policy-property-map",
      value: {
        ...policyMap(runId, governanceHashes.outputHashes["governance-constraints"]!),
        mappings: [
          {
            policyAssignmentId: "assignment-1",
            effect: "deny",
            logicalResourceId: "api",
            propertyPath: "properties.deny",
            disposition: "planned",
          },
          {
            policyAssignmentId: "assignment-1",
            effect: "audit",
            logicalResourceId: "api",
            propertyPath: "properties.audit",
            disposition: "planned",
          },
        ],
      },
    },
  ]);
  await complete(service, "governance-review", [
    {
      kind: "review-findings",
      value: review(runId, "policy-property-map", policyHashes["policy-property-map"]!),
    },
  ]);
  await service.decideGateNumber(2, "approved", "tester");

  const sourceHashes = {
    requirements: requirementHashes.outputHashes.requirements!,
    architecture: architectureHashes.outputHashes.architecture!,
    "governance-constraints": governanceHashes.outputHashes["governance-constraints"]!,
    "policy-property-map": policyHashes["policy-property-map"]!,
  };
  const validPlan = planBundle(runId, "bicep", {}, sourceHashes);
  const cyclicPlan = structuredClone(validPlan) as TaskOutput[];
  const cyclicIntent = cyclicPlan[0]!.value as ImplementationIntentV1;
  cyclicIntent.resources[0]!.dependsOn = ["worker"];
  cyclicIntent.resources.push({ ...cyclicIntent.resources[0]!, id: "worker", dependsOn: ["api"] });
  const cyclicBinding = cyclicPlan[1]!.value as IacBindingV1;
  cyclicBinding.resourceBindings.worker = { ...cyclicBinding.resourceBindings.api! };
  cyclicBinding.intentHash = sha256Json(cyclicIntent);
  const planTask = await task(service, "plan");
  await assert.rejects(service.completeTaskOutputs(planTask, cyclicPlan), /business:dependency-acyclic/);
  const planHashes = await service.completeTaskOutputs(planTask, validPlan);
  await complete(service, "plan-review", [
    {
      kind: "review-findings",
      value: review(runId, "plan", planHashes.outputHashes["implementation-intent"]!),
    },
  ]);
  await service.decideGateNumber(3, "approved", "tester");

  const validCodegen = codegenBundle(runId, "bicep", validPlan);
  const incompleteCodegen = structuredClone(validCodegen) as TaskOutput[];
  const incompleteManifest = incompleteCodegen[0]!.value as LogicalResourceManifestV1;
  incompleteManifest.resources[0]!.logicalId = "other";
  (incompleteCodegen[1]!.value as { logicalResourceManifestHash: string }).logicalResourceManifestHash =
    sha256Json(incompleteManifest);
  const codegenTask = await task(service, "codegen-bicep");
  await assert.rejects(service.completeTaskOutputs(codegenTask, incompleteCodegen), /business:bicep-binding-coverage/);
  await service.completeTaskOutputs(codegenTask, validCodegen);

  const validEvidence = validationEvidence(runId, "bicep");
  const incompleteEvidence = {
    ...validEvidence,
    entries: validEvidence.entries.filter(({ kind }) => kind !== "bicep:format"),
  };
  const validationTask = await task(service, "validation-bicep");
  await assert.rejects(
    service.completeTaskOutputs(validationTask, [{ kind: "validation-evidence", value: incompleteEvidence }]),
    /bicep:format/,
  );
  await service.completeTaskOutputs(validationTask, [{ kind: "validation-evidence", value: validEvidence }]);
  assert.match(
    await readFile(join(root, "agent-output", "demo", runId, "validation", "validation-report.md"), "utf8"),
    /Validation Report[\s\S]*bicep:format/u,
  );
});

test("architecture assumes availability and permits dismissal of out-of-scope review findings", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await service.nextTask();
  const requirementHashes = await complete(service, "requirements", [{ kind: "requirements", value: requirements() }]);
  await complete(service, "requirements-review", [
    {
      kind: "review-findings",
      value: review(runId, "requirements", requirementHashes.requirements!),
    },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  const architectureValue = architecture(runId);
  const costValue = costEstimate(runId);
  const architectureHashes = await service.completeTaskOutputs(await task(service, "architecture"), [
    { kind: "architecture", value: architectureValue },
    { kind: "cost-estimate", value: costValue },
    {
      kind: "workload-decision-manifest",
      value: workloadDecisionManifest({
        runId,
        requirementsHash: requirementHashes.requirements!,
        architectureHash: sha256Json(architectureValue),
        costEstimateHash: sha256Json(costValue),
      }),
    },
  ]);
  const architectureReview = review(runId, "architecture", architectureHashes.outputHashes.architecture!, [
    {
      id: "F-ARCH-1",
      severity: "high",
      disposition: "open",
      title: "Regional availability must be verified",
      detail: "Validate regional SKU support and quota before implementation.",
      evidenceRefs: [],
    },
  ]);
  const reliabilityCriterion = architectureReview.criteria!.find(({ criterionId }) => criterionId === "reliability")!;
  reliabilityCriterion.outcome = "finding";
  (reliabilityCriterion.findingIds as string[]).push("F-ARCH-1");
  const reviewHashes = await service.completeTaskOutputs(await task(service, "architecture-review"), [
    { kind: "review-findings", value: architectureReview },
  ]);
  const pendingReview = await service.nextTask();
  assert.equal(pendingReview.status, "needs_review");
  if (pendingReview.status !== "needs_review") return;
  assert.equal(pendingReview.review.gate, 2);
  assert.equal(pendingReview.review.reviewHash, reviewHashes.outputHashes["review-findings"]);
  assert.deepEqual(
    pendingReview.review.findings.map(({ id, actions }) => ({ id, actions })),
    [{ id: "F-ARCH-1", actions: ["revise", "dismiss"] }],
  );
  assert.deepEqual(
    await service.decideReview(pendingReview.review.reviewHash, [
      { findingId: "F-ARCH-1", action: "dismiss", rationale: "Outside APEX Architecture review scope." },
    ]),
    { status: "resolved" },
  );
  assert.equal((await service.nextTask()).status, "task");
});

test("authorized capability adapter accepts native architecture availability evidence", async () => {
  const root = await tempRoot();
  let acceptedTarget: string | undefined;
  const service = new ApexService(root, {
    architectureAvailabilityAdapter: async (evidence) => {
      acceptedTarget = evidence.targetScope;
    },
  });
  const { runId } = await service.init({ projectId: "demo", targetScope: "resource-group:test" });

  const hash = await acceptAvailabilityEvidence(service, runId, "demo", "resource-group:test", { mode: "native" });

  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(acceptedTarget, "resource-group:test");
});

for (const track of ["bicep", "terraform"] as const) {
  test(`full logical ${track} workflow reaches fake deploy and quality`, async () => {
    const root = await tempRoot();
    const service = new ApexService(root);
    const { runId } = await service.init({ projectId: "demo", iacTool: track });
    await reachValidation(service, runId, track);
    const preview = await service.preview({ operation: "apply", provider: "fake" });
    const previewEvents = await new EventJournal(
      join(root, ".apex", "projects", "demo", "runs", runId, "journal"),
    ).replay();
    const previewCreated = [...previewEvents].reverse().find((event) => event.type === "preview.created");
    assert.deepEqual((previewCreated?.payload as { validatorIds?: unknown }).validatorIds, [
      "preview:hash-bindings",
      "preview:policy-precheck",
      "preview:coverage",
      "preview:freshness",
    ]);
    assert.equal((previewCreated?.payload as { evidenceMode?: unknown }).evidenceMode, "simulated");
    assert.deepEqual(
      (previewCreated?.payload as { omittedValidatorIds?: unknown }).omittedValidatorIds,
      track === "terraform" ? ["terraform:saved-plan-binding"] : undefined,
    );
    await service.decideGateNumber(4, "approved", "tester");
    const deployed = await service.deploy(preview.previewHash);
    assert.equal(deployed.inventory.resources.length, 1);
    const deploymentEvents = await new EventJournal(
      join(root, ".apex", "projects", "demo", "runs", runId, "journal"),
    ).replay();
    const deployment = [...deploymentEvents].reverse().find((event) => event.type === "deployment.completed");
    assert.deepEqual((deployment?.payload as { validatorIds?: unknown }).validatorIds, [
      "deploy:exact-approved-operation",
      "deploy:stale-writer-rejection",
    ]);
    assert.deepEqual((deployment?.payload as { preValidatorIds?: unknown }).preValidatorIds, [
      "deploy:exact-approved-operation",
      "deploy:stale-writer-rejection",
    ]);
    assert.deepEqual((deployment?.payload as { postValidatorIds?: unknown }).postValidatorIds, []);
    assert.deepEqual(
      (deployment?.payload as { omittedValidatorIds?: unknown }).omittedValidatorIds,
      track === "bicep"
        ? ["deploy:bicep-stack-ownership"]
        : ["deploy:exact-saved-plan", "deploy:state-lineage-and-serial"],
    );
    assert.equal((deployment?.payload as { evidenceMode?: unknown }).evidenceMode, "simulated");
    assert.deepEqual((deployment?.payload as { inventoryValidatorIds?: unknown }).inventoryValidatorIds, [
      "inventory:secret-free",
      "inventory:source-coverage",
      "inventory:eventual-consistency-reconciled",
    ]);
    const diagnosisTask = await task(service, "diagnosis");
    const diagnosis = {
      schemaVersion: "1.0.0" as const,
      projectId: "demo",
      runId,
      diagnosedAt: deployed.inventory.collectedAt,
      status: "healthy" as const,
      observations: ["deployed"],
      causes: [],
    };
    await assert.rejects(
      service.completeTaskOutputs(diagnosisTask, [
        { kind: "diagnosis", value: { ...diagnosis, observations: ["Bearer secret-token-value"] } },
      ]),
      /diagnosis:secret-free/,
    );
    await assert.rejects(
      service.completeTaskOutputs(diagnosisTask, [
        { kind: "diagnosis", value: { ...diagnosis, diagnosedAt: "2099-01-01T00:00:00.000Z" } },
      ]),
      /diagnosis:read-only/,
    );
    await assert.rejects(
      service.completeTaskOutputs(diagnosisTask, [
        {
          kind: "diagnosis",
          value: {
            ...diagnosis,
            causes: [
              {
                id: "cause-1",
                summary: "Observed mismatch",
                confidence: "medium",
                evidenceRefs: ["e".repeat(64)],
              },
            ],
          },
        },
      ]),
      /diagnosis:read-only/,
    );
    await service.completeTaskOutputs(diagnosisTask, [{ kind: "diagnosis", value: diagnosis }]);
    const qualityTask = await task(service, "quality");
    const report = await qualityReport(root, runId);
    const staleScorecard = { ...report, scorecardHash: "f".repeat(64) };
    await assert.rejects(
      service.completeTaskOutputs(qualityTask, [{ kind: "quality-report", value: staleScorecard }]),
      /quality:scorecard-decidable/,
    );
    await writeJson(join(root, ".apex", "quality", "measurements.json"), {
      schemaVersion: "1.0.0",
      measurements: [],
    });
    await assert.rejects(
      service.completeTaskOutputs(qualityTask, [{ kind: "quality-report", value: report }]),
      /quality:scorecard-decidable/,
    );
    await qualityReport(root, runId);
    const reordered = structuredClone(report);
    [reordered.checks[0], reordered.checks[1]] = [reordered.checks[1]!, reordered.checks[0]!];
    await assert.rejects(
      service.completeTaskOutputs(qualityTask, [{ kind: "quality-report", value: reordered }]),
      /quality:no-subjective-deterministic-claims/,
    );
    const measurementPath = join(root, ".apex", "quality", "measurements.json");
    const duplicatedMeasurements = JSON.parse(await readFile(measurementPath, "utf8")) as {
      schemaVersion: "1.0.0";
      measurements: Array<Record<string, unknown>>;
    };
    duplicatedMeasurements.measurements.push({ ...duplicatedMeasurements.measurements[0]! });
    await writeJson(measurementPath, duplicatedMeasurements);
    const duplicateMeasurementReport = {
      ...report,
      measurementsHash: sha256Json(duplicatedMeasurements),
    };
    await assert.rejects(
      service.completeTaskOutputs(qualityTask, [{ kind: "quality-report", value: duplicateMeasurementReport }]),
      /quality:no-subjective-deterministic-claims/,
    );
    await qualityReport(root, runId);
    const inventedPass = structuredClone(report);
    inventedPass.checks[0]!.status = "pass";
    inventedPass.checks[0]!.detail = "target satisfied";
    inventedPass.status = "pass";
    await assert.rejects(
      service.completeTaskOutputs(qualityTask, [{ kind: "quality-report", value: inventedPass }]),
      /quality:scorecard-decidable/,
    );
    const unsupportedClaim = structuredClone(report);
    const claimed = unsupportedClaim.checks.find(({ status }) => status !== "omitted")!;
    claimed.evidenceRefs = [];
    await assert.rejects(
      service.completeTaskOutputs(qualityTask, [{ kind: "quality-report", value: unsupportedClaim }]),
      /quality:no-subjective-deterministic-claims/,
    );
    await service.completeTaskOutputs(qualityTask, [{ kind: "quality-report", value: report }]);
    const qualityEvents = await new EventJournal(
      join(root, ".apex", "projects", "demo", "runs", runId, "journal"),
    ).replay();
    const qualityCompleted = [...qualityEvents]
      .reverse()
      .find((event) => event.type === "task.completed" && (event.payload as { nodeId?: unknown }).nodeId === "quality");
    assert.deepEqual((qualityCompleted?.payload as { validatorIds?: unknown }).validatorIds, [
      "quality:scorecard-decidable",
      "quality:no-subjective-deterministic-claims",
    ]);
    if (track === "bicep") {
      const workflowPath = join(
        root,
        ".apex",
        "runtime-generations",
        (await service.status()).run.runtimeLockHash,
        "workflow.v1.json",
      );
      const workflowBytes = await readFile(workflowPath);
      await writeFile(workflowPath, Buffer.concat([workflowBytes, Buffer.from("\n")]));
      await assert.rejects(
        service.status(),
        (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
      );
      await writeFile(workflowPath, workflowBytes);
    }
    assert.equal((await service.status()).task, null);
    assert.equal((await service.status()).task, null);
    const finalEvents = await new EventJournal(
      join(root, ".apex", "projects", "demo", "runs", runId, "journal"),
    ).replay();
    const diagnosisCompleted = [...finalEvents]
      .reverse()
      .find(
        (event) => event.type === "task.completed" && (event.payload as { nodeId?: unknown }).nodeId === "diagnosis",
      );
    assert.deepEqual((diagnosisCompleted?.payload as { validatorIds?: unknown }).validatorIds, [
      "diagnosis:read-only",
      "diagnosis:secret-free",
    ]);
    const workflowCompleted = [...finalEvents].reverse().find((event) => event.type === "workflow.completed");
    assert.deepEqual((workflowCompleted?.payload as { validatorIds?: unknown }).validatorIds, [
      "terminal:run-evidence-complete",
    ]);
    const terminalPayload = workflowCompleted?.payload as {
      activeValidatorIds?: string[];
      executedValidatorIds?: string[];
      simulatedOmittedValidatorIds?: string[];
    };
    const accounted = new Set([
      ...(terminalPayload.executedValidatorIds ?? []),
      ...(terminalPayload.simulatedOmittedValidatorIds ?? []),
    ]);
    assert.equal(
      (terminalPayload.activeValidatorIds ?? [])
        .filter((id) => id !== "terminal:run-evidence-complete")
        .every((id) => accounted.has(id)),
      true,
    );
    const trackValidator = track === "bicep" ? "bicep:build" : "terraform:validate";
    const opposingTrackValidator = track === "bicep" ? "terraform:validate" : "bicep:build";
    assert.equal((terminalPayload.activeValidatorIds ?? []).includes(trackValidator), true);
    assert.equal((terminalPayload.activeValidatorIds ?? []).includes(opposingTrackValidator), false);
    assert.equal(finalEvents.filter(({ type }) => type === "workflow.completed").length, 1);
  });
}

test("native Bicep deploy records stack ownership evidence in manifest order", async () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const root = await tempRoot();
  const service = new ApexService(root, { clock: () => now, providers: { bicep: bicepPreviewProvider(now) } });
  const { runId } = await service.init({
    projectId: "demo",
    iacTool: "bicep",
    targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-test",
  });
  await reachValidation(service, runId, "bicep", configureNativeBicepPlan);
  const preview = await service.preview({ operation: "apply", provider: "bicep" });
  await service.decideGateNumber(4, "approved", "tester");
  await service.deploy(preview.previewHash);
  const events = await new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal")).replay();
  const completed = [...events].reverse().find((event) => event.type === "deployment.completed");
  assert.deepEqual((completed?.payload as { validatorIds?: unknown }).validatorIds, [
    "deploy:exact-approved-operation",
    "deploy:bicep-stack-ownership",
    "deploy:stale-writer-rejection",
  ]);
  assert.deepEqual((completed?.payload as { preValidatorIds?: unknown }).preValidatorIds, [
    "deploy:exact-approved-operation",
    "deploy:stale-writer-rejection",
  ]);
  assert.deepEqual((completed?.payload as { postValidatorIds?: unknown }).postValidatorIds, [
    "deploy:bicep-stack-ownership",
  ]);
  assert.equal((completed?.payload as { evidenceMode?: unknown }).evidenceMode, "native");
});

for (const scenario of ["foreign ID", "existing update", "existing delete"] as const) {
  test(`native Bicep preview rejects ${scenario} outside accepted managed ownership`, async () => {
    const root = await tempRoot();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const base = bicepPreviewProvider(now);
    let mutatePreview = true;
    const provider: IacProvider = {
      ...base,
      async previewApply(request) {
        assert.deepEqual(
          request.resources.map(({ logicalId }) => logicalId),
          scenario === "foreign ID" ? ["api"] : [],
        );
        const original = await base.previewApply(request);
        if (!mutatePreview) return original;
        const { previewHash, ...body } = original;
        assert.equal(previewHash, sha256Json(body));
        const changed = {
          ...body,
          changes: [
            {
              resourceId: `${request.target}/providers/Microsoft.Storage/storageAccounts/${scenario === "foreign ID" ? "foreign" : "apidemo"}`,
              action: scenario === "existing delete" ? ("delete" as const) : ("update" as const),
              material: true,
            },
          ],
        };
        return { ...changed, previewHash: sha256Json(changed) };
      },
    };
    const service = new ApexService(root, { clock: () => now, providers: { bicep: provider } });
    const { runId } = await service.init({
      projectId: "demo",
      iacTool: "bicep",
      targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-test",
    });
    const codegen = await reachCodegen(service, runId, "bicep", configureNativeBicepPlan);
    const bundle = codegenBundle(runId, "bicep", codegen.plan);
    if (scenario !== "foreign ID") {
      const manifest = bundle.find(({ kind }) => kind === "logical-resource-manifest")!
        .value as LogicalResourceManifestV1;
      manifest.resources[0]!.ownership = "existing";
      manifest.resources[0]!.implementationKind = "existing";
      const handoff = bundle.find(({ kind }) => kind === "iac-handoff")!.value as {
        logicalResourceManifestHash: string;
      };
      handoff.logicalResourceManifestHash = sha256Json(manifest);
    }
    await service.completeTaskOutputs(codegen.taskId, bundle);
    await complete(service, "validation-bicep", [
      { kind: "validation-evidence", value: validationEvidence(runId, "bicep") },
    ]);
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    const head = await journal.head();
    await assert.rejects(service.preview({ operation: "apply", provider: "bicep" }), /preview:coverage/);
    assert.equal((await service.status()).run.gates[3]!.state, "closed");
    assert.equal(await journal.head(), head);
    mutatePreview = false;
    await service.preview({ operation: "apply", provider: "bicep" });
    assert.equal((await service.status()).run.gates[3]!.state, "open");
  });
}

for (const track of ["bicep", "terraform"] as const) {
  test(`unresolved ${track} module ownership blocks empty and no-op previews without advancing state`, async (context) => {
    for (const noOp of [false, true]) {
      await context.test(`no-op=${noOp}`, async () => {
        const root = await tempRoot();
        const now = new Date("2026-01-01T00:00:00.000Z");
        const base = track === "bicep" ? bicepPreviewProvider(now) : terraformPreviewProvider(now);
        let moduleAttestation: ExecutionPlanAttestationV1 | undefined;
        const provider: IacProvider = {
          ...base,
          ...(track !== "terraform"
            ? {}
            : {
                attestation: (hash: string) =>
                  moduleAttestation?.previewHash === hash ? moduleAttestation : undefined,
              }),
          async previewApply(request) {
            const { previewHash, ...body } = await base.previewApply(request);
            assert.equal(previewHash, sha256Json(body));
            const changed = {
              ...body,
              changes: noOp
                ? body.changes.map((change) => ({
                    ...change,
                    action: "no-op" as const,
                    material: false,
                  }))
                : [],
            };
            const preview = { ...changed, previewHash: sha256Json(changed) };
            if ("attestation" in base && typeof base.attestation === "function") {
              const originalAttestation = base.attestation(previewHash) as ExecutionPlanAttestationV1 | undefined;
              assert.ok(originalAttestation);
              moduleAttestation = { ...originalAttestation, previewHash: preview.previewHash };
            }
            return preview;
          },
        };
        const service = new ApexService(root, { clock: () => now, providers: { [track]: provider } });
        const { runId } = await service.init({
          projectId: "demo",
          iacTool: track,
          targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-test",
        });
        const codegen = await reachCodegen(service, runId, track, (plan) => {
          configureNativeBicepPlan(plan);
          const binding = plan[1]!.value as IacBindingV1;
          binding.resourceBindings.api!.implementation =
            track === "bicep"
              ? "avm:br/public:avm/res/storage/storage-account@0.9.0"
              : "avm:Azure/avm-res-storage-storageaccount/azurerm@0.9.0";
          binding.resourceBindings.api!.version = "0.9.0";
        });
        const bundle = codegenBundle(runId, track, codegen.plan);
        const manifest = bundle.find(({ kind }) => kind === "logical-resource-manifest")!
          .value as LogicalResourceManifestV1;
        manifest.resources[0]!.implementationKind = "module";
        manifest.resources[0]!.executionAddress = track === "bicep" ? "api" : "module.api";
        const handoff = bundle.find(({ kind }) => kind === "iac-handoff")!.value as {
          logicalResourceManifestHash: string;
        };
        handoff.logicalResourceManifestHash = sha256Json(manifest);
        await service.completeTaskOutputs(codegen.taskId, bundle);
        await complete(service, `validation-${track}`, [
          { kind: "validation-evidence", value: validationEvidence(runId, track) },
        ]);
        const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
        const head = await journal.head();
        await assert.rejects(service.preview({ operation: "apply", provider: track }), /preview:coverage/);
        assert.equal((await service.status()).run.gates[3]!.state, "closed");
        assert.equal(await journal.head(), head);
      });
    }
  });
}

test("Bicep AVM exact scope binds requests and rejects foreign inventory", async () => {
  const root = await tempRoot();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const targetScope = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-test";
  const primaryId = `${targetScope}/providers/Microsoft.Storage/storageAccounts/apidemo`;
  const childId = `${primaryId}/blobServices/default`;
  const base = bicepPreviewProvider(now);
  let foreignInventory = true;
  let deleteParent = true;
  const provider: IacProvider = {
    ...base,
    async previewApply(request) {
      assert.deepEqual(request.resources.map(({ resourceId }) => resourceId).sort(), [primaryId, childId].sort());
      const original = await base.previewApply(request);
      if (!deleteParent) return original;
      const { previewHash, ...body } = original;
      assert.equal(previewHash, sha256Json(body));
      const destructive = { ...body, changes: [{ resourceId: primaryId, action: "delete" as const, material: true }] };
      return { ...destructive, previewHash: sha256Json(destructive) };
    },
    async inventory(projectId, runId) {
      const inventory = await base.inventory(projectId, runId);
      return {
        ...inventory,
        resources: inventory.resources.map((resource, index) => ({
          ...resource,
          resourceId: foreignInventory && index === 1 ? `${primaryId}/blobServices/foreign` : resource.resourceId,
        })),
      };
    },
  };
  const service = new ApexService(root, { clock: () => now, providers: { bicep: provider } });
  const { runId } = await service.init({ projectId: "demo", iacTool: "bicep", targetScope });
  const codegen = await reachCodegen(service, runId, "bicep", (plan) => {
    configureNativeBicepPlan(plan);
    const binding = (plan[1]!.value as IacBindingV1).resourceBindings.api!;
    binding.implementation = "avm:br/public:avm/res/storage/storage-account@0.9.0";
    binding.version = "0.9.0";
    binding.physicalResources = [
      { resourceId: primaryId, type: "Microsoft.Storage/storageAccounts", ownership: "managed", role: "primary" },
      {
        resourceId: childId,
        type: "Microsoft.Storage/storageAccounts/blobServices",
        ownership: "managed",
        role: "ancillary",
      },
      {
        resourceId: `${primaryId}/providers/Microsoft.Insights/diagnosticSettings/shared`,
        type: "Microsoft.Insights/diagnosticSettings",
        ownership: "existing",
        role: "ancillary",
      },
    ];
  });
  const bundle = codegenBundle(runId, "bicep", codegen.plan);
  const manifest = bundle.find(({ kind }) => kind === "logical-resource-manifest")!.value as LogicalResourceManifestV1;
  manifest.resources[0]!.implementationKind = "module";
  (
    bundle.find(({ kind }) => kind === "iac-handoff")!.value as { logicalResourceManifestHash: string }
  ).logicalResourceManifestHash = sha256Json(manifest);
  await service.completeTaskOutputs(codegen.taskId, bundle);
  await complete(service, "validation-bicep", [
    { kind: "validation-evidence", value: validationEvidence(runId, "bicep") },
  ]);
  await assert.rejects(service.preview({ operation: "apply", provider: "bicep" }), /preview:coverage/);
  assert.equal((await service.status()).run.gates[3]!.state, "closed");
  deleteParent = false;
  const preview = await service.preview({ operation: "apply", provider: "bicep" });
  const bindingDocument = await readFile(join(root, "agent-output", "demo", runId, "plan", "iac-binding.md"), "utf8");
  assert.match(bindingDocument, /Physical Authorization Scope/);
  assert.ok(bindingDocument.includes(childId));
  await service.decideGateNumber(4, "approved", "tester");
  await assert.rejects(service.deploy(preview.previewHash), /inventory.*ownership/i);
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  assert.equal(
    (await journal.replay()).some(({ type }) => type === "deployment.completed"),
    false,
  );
  foreignInventory = false;
  await service.reconcile();
  const completed = await service.deploy(preview.previewHash);
  assert.deepEqual(
    completed.inventory.resources.map(({ resourceId }) => resourceId).sort(),
    [primaryId, childId].sort(),
  );
  assert.ok(
    completed.inventory.resources.some(({ logicalId, resourceId }) => logicalId === "api" && resourceId === primaryId),
  );
});

test("native apply requires complete source-bound policy receipts before Gate 4", async () => {
  const root = await tempRoot();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const base = bicepPreviewProvider(now);
  let receipt: PolicyValidationV1 | undefined;
  let includeReceipt = false;
  let substituteResult = true;
  const provider: IacProvider = {
    ...base,
    async previewApply(request) {
      assert.ok(request.policyValidation);
      const binding = request.policyValidation.logicalResourceManifest.api!;
      receipt = validatePolicyProperties({
        ...request.policyValidation,
        track: "bicep",
        sourceHash: request.iacHash,
        policyMapHash: request.policyHash,
        json: JSON.stringify({
          resources: {
            [binding.codeSymbol!]: { properties: { httpsOnly: true } },
          },
        }),
      });
      return base.previewApply(request);
    },
    policyValidation: () => {
      if (!includeReceipt || receipt === undefined) return undefined;
      if (!substituteResult) return receipt;
      const changed = structuredClone(receipt);
      changed.results[0]!.logicalResourceId = "foreign";
      const { receiptHash, ...body } = changed;
      assert.ok(receiptHash);
      return { ...body, receiptHash: calculatePolicyValidationHash(body) };
    },
  };
  const service = new ApexService(root, { clock: () => now, providers: { bicep: provider } });
  const { runId } = await service.init({
    projectId: "demo",
    iacTool: "bicep",
    targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-test",
  });
  const codegen = await reachCodegen(service, runId, "bicep", configureNativeBicepPlan, false, undefined, (policy) => {
    policy.mappings.push({
      policyAssignmentId: "https",
      effect: "deny",
      logicalResourceId: "api",
      propertyPath: "properties.httpsOnly",
      expectedValue: true,
      disposition: "planned",
    });
  });
  await service.completeTaskOutputs(codegen.taskId, codegenBundle(runId, "bicep", codegen.plan));
  await complete(service, "validation-bicep", [
    { kind: "validation-evidence", value: validationEvidence(runId, "bicep") },
  ]);
  await assert.rejects(service.preview({ operation: "apply", provider: "bicep" }), /source-bound policy validation/);
  assert.equal((await service.status()).run.gates[3]!.state, "closed");
  includeReceipt = true;
  const head = (await service.status()).head;
  await assert.rejects(service.preview({ operation: "apply", provider: "bicep" }), /source-bound policy validation/);
  assert.equal((await service.status()).head, head);
  assert.equal((await service.status()).run.gates[3]!.state, "closed");
  substituteResult = false;
  await service.preview({ operation: "apply", provider: "bicep" });
  const events = await new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal")).replay();
  const created = events.findLast(({ type }) => type === "preview.created");
  const hash = (created!.payload as { policyValidationHash: string }).policyValidationHash;
  assert.equal((await new ObjectStore(root).getJson<PolicyValidationV1>(hash)).outcome, "pass");
});

test("native Terraform preview rejects changes outside accepted managed addresses", () => {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  const context = {
    provider: "terraform",
    expectedResourceIds: ["azurerm_storage_account.workload"],
    preview: { changes: [{ resourceId: "azurerm_virtual_network.platform", action: "update", material: true }] },
  };
  assert.equal(registry.validate("preview:coverage", context).valid, false);
  context.preview.changes[0]!.action = "no-op";
  context.preview.changes[0]!.material = false;
  assert.equal(registry.validate("preview:coverage", context).valid, true);
  context.preview.changes[0]!.resourceId = "azurerm_storage_account.workload";
  context.preview.changes[0]!.action = "create";
  context.preview.changes[0]!.material = true;
  assert.equal(registry.validate("preview:coverage", context).valid, true);
});

test("imported governance validates actionable effects without inventing audit mappings", () => {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  const constraints = governance("run-test");
  constraints.summary.auditCount = 252;
  const policy = policyMap("run-test", "a".repeat(64)) as PolicyPropertyMapV1;
  policy.mappings.push({
    policyAssignmentId: "diagnostics",
    effect: "deployIfNotExists",
    logicalResourceId: "api",
    propertyPath: "diagnostics",
    expectedValue: true,
    disposition: "planned",
  });
  const context = {
    artifacts: { "governance-constraints": constraints },
    outputs: { "policy-property-map": policy },
    importedPolicyEffects: ["deployIfNotExists"],
  };
  assert.equal(registry.validate("business:policy-effect-coverage", context).valid, true);
  policy.mappings = [];
  assert.equal(registry.validate("business:policy-effect-coverage", context).valid, false);
});

test("plans reject policy mappings to absent resources and unresolved blocked controls", () => {
  for (const track of ["bicep", "terraform"] as const) {
    const registry = new ValidatorRegistry();
    registerWorkflowValidators(registry);
    const plan = planBundle("run-test", track);
    const intent = plan[0]!.value as ImplementationIntentV1;
    const policy = policyMap("run-test", "a".repeat(64)) as PolicyPropertyMapV1;
    policy.mappings.push({
      policyAssignmentId: "required-control",
      effect: "deny",
      logicalResourceId: "missing",
      propertyPath: "httpsOnly",
      expectedValue: true,
      disposition: "planned",
    });
    const hash = sha256Json(policy);
    const context = {
      track,
      artifacts: { "policy-property-map": policy },
      artifactHashes: { "policy-property-map": hash },
      outputs: { "implementation-intent": { ...intent, sourceHashes: { "policy-property-map": hash } } },
    };
    assert.equal(registry.validate("business:plan-source-coverage", context).valid, false);
    policy.mappings[0]!.logicalResourceId = "api";
    context.artifactHashes["policy-property-map"] = sha256Json(policy);
    context.outputs["implementation-intent"].sourceHashes["policy-property-map"] = sha256Json(policy);
    assert.equal(registry.validate("business:plan-source-coverage", context).valid, true);
    policy.mappings[0]!.disposition = "blocked";
    context.artifactHashes["policy-property-map"] = sha256Json(policy);
    context.outputs["implementation-intent"].sourceHashes["policy-property-map"] = sha256Json(policy);
    assert.equal(registry.validate("business:plan-source-coverage", context).valid, false);
  }
});

test("policy mapping failures cannot complete planning or open Gate 3", async (context) => {
  for (const track of ["bicep", "terraform"] as const) {
    for (const failure of ["missing-resource", "blocked"] as const) {
      await context.test(`${track}: ${failure}`, async () => {
        const root = await tempRoot();
        const service = new ApexService(root);
        const { runId } = await service.init({ projectId: "demo", iacTool: track });
        await assert.rejects(
          reachCodegen(service, runId, track, undefined, false, undefined, (policy) => {
            policy.mappings.push({
              policyAssignmentId: "required-control",
              effect: "deny",
              logicalResourceId: failure === "missing-resource" ? "missing" : "api",
              propertyPath: "httpsOnly",
              expectedValue: true,
              disposition: failure === "blocked" ? "blocked" : "planned",
            });
          }),
          /business:plan-source-coverage validation failed/,
        );
        const events = await new EventJournal(
          join(root, ".apex", "projects", "demo", "runs", runId, "journal"),
        ).replay();
        assert.equal(
          events.some(
            (event) => event.type === "task.completed" && (event.payload as { nodeId?: unknown }).nodeId === "plan",
          ),
          false,
        );
        assert.equal((await service.status()).run.gates[2]!.state, "closed");
      });
    }
  }
});

test("native Terraform apply requires complete source-bound policy receipts before Gate 4", async () => {
  const root = await tempRoot();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const base = terraformPreviewProvider(now);
  const requests: PreviewRequest[] = [];
  let receipt: PolicyValidationV1 | undefined;
  let attestation: ExecutionPlanAttestationV1 | undefined;
  let receiptMode: "missing" | "rehashed" | "substituted" | "valid" = "missing";
  const provider: typeof base = {
    ...base,
    async previewApply(request) {
      requests.push(request);
      assert.ok(request.policyValidation);
      const address = request.policyValidation.logicalResourceManifest.api!.terraformAddress!;
      const values = { https_only: true };
      receipt = validatePolicyProperties({
        ...request.policyValidation,
        track: "terraform",
        sourceHash: request.iacHash,
        policyMapHash: request.policyHash,
        json: JSON.stringify({
          planned_values: { root_module: { resources: [{ address, mode: "managed", values }] } },
          resource_changes: [
            { address, mode: "managed", change: { actions: ["create"], after: values, after_unknown: {} } },
          ],
        }),
      });
      assert.equal(receipt.outcome, "pass");
      if (receiptMode === "substituted") {
        const changed = structuredClone(receipt);
        changed.results[0]!.expectedValueDigest = sha256Json(false);
        changed.results[0]!.observedValueDigest = sha256Json(false);
        const { receiptHash, ...body } = changed;
        assert.ok(receiptHash);
        receipt = { ...body, receiptHash: calculatePolicyValidationHash(body) };
      }
      const original = await base.previewApply(request);
      const originalAttestation = base.attestation(original.previewHash);
      assert.ok(originalAttestation);
      const originalSnapshot = structuredClone(original);
      const attestationSnapshot = structuredClone(originalAttestation);
      const { previewHash: originalHash, ...previewBody } = original;
      const boundBody = {
        ...previewBody,
        artifactHash: sha256Json({
          planDigest: originalAttestation.planDigest,
          configHash: originalAttestation.configHash,
          lockfileHash: originalAttestation.lockfileHash,
          recipient: originalAttestation.recipient,
          artifactRef: originalAttestation.artifactRef,
          policyValidation: nativePolicyValidationBinding(receipt),
        }),
      };
      const preview = Object.freeze({ ...boundBody, previewHash: sha256Json(boundBody) });
      attestation = Object.freeze({ ...originalAttestation, previewHash: preview.previewHash });
      assert.notEqual(preview.previewHash, originalHash);
      assert.deepEqual(original, originalSnapshot);
      assert.deepEqual(base.attestation(originalHash), attestationSnapshot);
      return preview;
    },
    attestation: (previewHash) => (attestation?.previewHash === previewHash ? attestation : undefined),
    policyValidation(previewHash) {
      assert.equal(previewHash, attestation?.previewHash);
      assert.ok(receipt);
      if (receiptMode === "missing") return undefined;
      if (receiptMode === "rehashed") {
        const { receiptHash, ...receiptBody } = receipt;
        const changed = { ...receiptBody, inputHash: "f".repeat(64) };
        const changedHash = calculatePolicyValidationHash(changed);
        assert.notEqual(changedHash, receiptHash);
        return { ...changed, receiptHash: changedHash };
      }
      return receipt;
    },
  };
  const service = new ApexService(root, { clock: () => now, providers: { terraform: provider } });
  const { runId } = await service.init({ projectId: "demo", iacTool: "terraform" });
  const codegen = await reachCodegen(service, runId, "terraform", undefined, false, undefined, (policy) => {
    policy.mappings.push({
      policyAssignmentId: "https",
      effect: "deny",
      logicalResourceId: "api",
      propertyPath: "https_only",
      expectedValue: true,
      disposition: "planned",
    });
  });
  const bundle = codegenBundle(runId, "terraform", codegen.plan);
  const handoff = bundle.find(({ kind }) => kind === "iac-handoff")!.value;
  assert.ok("rootPath" in handoff);
  const hashes = await service.completeTaskOutputs(codegen.taskId, bundle);
  await complete(service, "validation-terraform", [
    { kind: "validation-evidence", value: validationEvidence(runId, "terraform") },
  ]);
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const head = await journal.head();
  await assert.rejects(
    service.preview({ operation: "apply", provider: "terraform" }),
    /source-bound policy validation/,
  );
  assert.equal((await service.status()).run.gates[3]!.state, "closed");
  assert.equal(await journal.head(), head);
  receiptMode = "rehashed";
  await assert.rejects(service.preview({ operation: "apply", provider: "terraform" }), /terraform:saved-plan-binding/);
  assert.equal((await service.status()).run.gates[3]!.state, "closed");
  assert.equal(await journal.head(), head);
  receiptMode = "substituted";
  await assert.rejects(
    service.preview({ operation: "apply", provider: "terraform" }),
    /source-bound policy validation/,
  );
  assert.equal(await journal.head(), head);
  assert.equal((await service.status()).run.gates[3]!.state, "closed");
  receiptMode = "valid";
  const preview = await service.preview({ operation: "apply", provider: "terraform" });
  assert.equal((await service.status()).run.gates[3]!.state, "open");
  assert.equal(requests.length, 4);
  const events = await journal.replay();
  const created = events.findLast(({ type }) => type === "preview.created");
  assert.ok(created);
  const payload = created.payload as { policyValidationHash: string; attestationHash: string; validatorIds: string[] };
  const objects = new ObjectStore(root);
  const storedReceipt = await objects.getJson<PolicyValidationV1>(payload.policyValidationHash);
  assert.deepEqual(storedReceipt, receipt);
  assert.equal(storedReceipt.outcome, "pass");
  assert.equal(storedReceipt.results.length, 1);
  assert.deepEqual(await objects.getJson<ExecutionPlanAttestationV1>(payload.attestationHash), attestation);
  assert.equal(attestation?.previewHash, preview.previewHash);
  assert.ok(payload.validatorIds.includes("terraform:saved-plan-binding"));
  for (const request of requests) {
    assert.equal(request.projectId, "demo");
    assert.equal(request.runId, runId);
    assert.equal(request.iacHash, (hashes.outputHashes as Record<string, string>)["iac-handoff"]);
    assert.deepEqual(request.generatedSource, { rootPath: join(root, handoff.rootPath), treeHash: handoff.treeHash });
    assert.equal(request.policyHash, storedReceipt.policyMapHash);
    assert.deepEqual(request.policyValidation?.logicalResourceManifest, {
      api: { terraformAddress: "azapi_resource.api" },
    });
  }
  await service.decideGateNumber(4, "approved", "tester");
  assert.equal((await service.status()).run.gates[3]!.state, "approved");
});

test("native Terraform service preview rejects a foreign managed address", async () => {
  const root = await tempRoot();
  const now = new Date("2026-01-01T00:00:00.000Z");
  const service = new ApexService(root, {
    clock: () => now,
    providers: { terraform: terraformPreviewProvider(now, "foreign-address") },
  });
  const { runId } = await service.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(service, runId, "terraform");
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const head = await journal.head();
  await assert.rejects(service.preview({ operation: "apply", provider: "terraform" }), /preview:coverage/);
  assert.equal((await service.status()).run.gates[3]!.state, "closed");
  assert.equal(await journal.head(), head);
});

test("native Terraform preview records saved-plan validation and rejects wrong bindings", async () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const root = await tempRoot();
  const provider = terraformPreviewProvider(now);
  const service = new ApexService(root, { clock: () => now, providers: { terraform: provider } });
  const { runId } = await service.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(service, runId, "terraform");
  const preview = await service.preview({ operation: "apply", provider: "terraform" });
  const events = await new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal")).replay();
  const created = [...events].reverse().find((event) => event.type === "preview.created");
  assert.deepEqual((created?.payload as { validatorIds?: unknown }).validatorIds, [
    "preview:hash-bindings",
    "preview:policy-precheck",
    "preview:coverage",
    "preview:freshness",
    "terraform:saved-plan-binding",
  ]);
  assert.equal((created?.payload as { evidenceMode?: unknown }).evidenceMode, "native");
  assert.match((created?.payload as { attestationHash?: string }).attestationHash!, /^[0-9a-f]{64}$/);
  await service.decideGateNumber(4, "approved", "tester");
  await service.deploy(preview.previewHash);
  const completedEvents = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", runId, "journal"),
  ).replay();
  const deployment = [...completedEvents].reverse().find((event) => event.type === "deployment.completed");
  assert.deepEqual((deployment?.payload as { validatorIds?: unknown }).validatorIds, [
    "deploy:exact-approved-operation",
    "deploy:exact-saved-plan",
    "deploy:state-lineage-and-serial",
    "deploy:stale-writer-rejection",
  ]);
  assert.deepEqual((deployment?.payload as { preValidatorIds?: unknown }).preValidatorIds, [
    "deploy:exact-approved-operation",
    "deploy:stale-writer-rejection",
  ]);
  assert.deepEqual((deployment?.payload as { postValidatorIds?: unknown }).postValidatorIds, [
    "deploy:exact-saved-plan",
    "deploy:state-lineage-and-serial",
  ]);
  assert.equal((deployment?.payload as { evidenceMode?: unknown }).evidenceMode, "native");
  assert.equal((deployment?.payload as { omittedValidatorIds?: unknown }).omittedValidatorIds, undefined);

  const receiptRoot = await tempRoot();
  const missingReceipt = new ApexService(receiptRoot, {
    clock: () => now,
    providers: { terraform: terraformPreviewProvider(now, "missing-receipt") },
  });
  const receiptRun = await missingReceipt.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(missingReceipt, receiptRun.runId, "terraform");
  const receiptPreview = await missingReceipt.preview({ operation: "apply", provider: "terraform" });
  await missingReceipt.decideGateNumber(4, "approved", "tester");
  await assert.rejects(missingReceipt.deploy(receiptPreview.previewHash), /deploy:exact-saved-plan/);
  const receiptEvents = await new EventJournal(
    join(receiptRoot, ".apex", "projects", "demo", "runs", receiptRun.runId, "journal"),
  ).replay();
  assert.equal(
    receiptEvents.some(({ type }) => type === "deployment.executed"),
    true,
  );
  assert.equal(
    receiptEvents.some(({ type }) => type === "deployment.completed"),
    false,
  );
  await assert.rejects(missingReceipt.deploy(receiptPreview.previewHash), /run reconcile before retrying/);
  assert.match((await missingReceipt.status()).blockers.join(" "), /requires reconciliation/);

  const extraRoot = await tempRoot();
  const extraReceipt = new ApexService(extraRoot, {
    clock: () => now,
    providers: { terraform: terraformPreviewProvider(now, "extra-receipt") },
  });
  const extraRun = await extraReceipt.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(extraReceipt, extraRun.runId, "terraform");
  const extraPreview = await extraReceipt.preview({ operation: "apply", provider: "terraform" });
  await extraReceipt.decideGateNumber(4, "approved", "tester");
  await assert.rejects(extraReceipt.deploy(extraPreview.previewHash), /receipt validator IDs/);

  const reconcileRoot = await tempRoot();
  const reconcileProvider = terraformPreviewProvider(now, "inventory-once");
  const reconciling = new ApexService(reconcileRoot, {
    clock: () => now,
    providers: { terraform: reconcileProvider },
  });
  const reconcileRun = await reconciling.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(reconciling, reconcileRun.runId, "terraform");
  const reconcilePreview = await reconciling.preview({ operation: "apply", provider: "terraform" });
  await reconciling.decideGateNumber(4, "approved", "tester");
  await assert.rejects(reconciling.deploy(reconcilePreview.previewHash), /inventory unavailable/);
  await assert.rejects(reconciling.deploy(reconcilePreview.previewHash), /run reconcile before retrying/);
  const reconciled = (await reconciling.reconcile()) as { deploymentHash: string };
  assert.equal(reconciled.deploymentHash, "9".repeat(64));
  await reconciling.deploy(reconcilePreview.previewHash);
  const reconciledEvents = await new EventJournal(
    join(reconcileRoot, ".apex", "projects", "demo", "runs", reconcileRun.runId, "journal"),
  ).replay();
  assert.equal(reconciledEvents.filter(({ type }) => type === "deployment.executed").length, 1);
  assert.equal(reconciledEvents.filter(({ type }) => type === "deployment.completed").length, 1);

  const indeterminateRoot = await tempRoot();
  const indeterminate = new ApexService(indeterminateRoot, {
    clock: () => now,
    providers: { terraform: terraformPreviewProvider(now, "apply-error") },
  });
  const indeterminateRun = await indeterminate.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(indeterminate, indeterminateRun.runId, "terraform");
  const indeterminatePreview = await indeterminate.preview({ operation: "apply", provider: "terraform" });
  await indeterminate.decideGateNumber(4, "approved", "tester");
  await assert.rejects(indeterminate.deploy(indeterminatePreview.previewHash), /outcome is unknown/);
  await assert.rejects(indeterminate.deploy(indeterminatePreview.previewHash), /run reconcile before retrying/);
  const indeterminateEvents = await new EventJournal(
    join(indeterminateRoot, ".apex", "projects", "demo", "runs", indeterminateRun.runId, "journal"),
  ).replay();
  assert.equal(
    indeterminateEvents.some(({ type }) => type === "deployment.indeterminate"),
    true,
  );
  assert.equal(
    indeterminateEvents.some(({ type }) => type === "deployment.completed"),
    false,
  );

  for (const mutation of ["secret-inventory", "incomplete-inventory"] as const) {
    const inventoryRoot = await tempRoot();
    const inventoryService = new ApexService(inventoryRoot, {
      clock: () => now,
      providers: { terraform: terraformPreviewProvider(now, mutation) },
    });
    const inventoryRun = await inventoryService.init({ projectId: "demo", iacTool: "terraform" });
    await reachValidation(inventoryService, inventoryRun.runId, "terraform");
    const inventoryPreview = await inventoryService.preview({ operation: "apply", provider: "terraform" });
    await inventoryService.decideGateNumber(4, "approved", "tester");
    await assert.rejects(
      inventoryService.deploy(inventoryPreview.previewHash),
      mutation === "secret-inventory" ? /inventory:secret-free/ : /inventory:source-coverage/,
    );
    const inventoryEvents = await new EventJournal(
      join(inventoryRoot, ".apex", "projects", "demo", "runs", inventoryRun.runId, "journal"),
    ).replay();
    assert.equal(
      inventoryEvents.some(({ type }) => type === "deployment.executed"),
      true,
    );
    assert.equal(
      inventoryEvents.some(({ type }) => type === "deployment.completed"),
      false,
    );
  }

  const invalidRoot = await tempRoot();
  const invalid = new ApexService(invalidRoot, {
    clock: () => now,
    providers: { terraform: terraformPreviewProvider(now, "input-hash") },
  });
  const initialized = await invalid.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(invalid, initialized.runId, "terraform");
  await assert.rejects(invalid.preview({ operation: "apply", provider: "terraform" }), /preview:hash-bindings/);
  assert.equal((await invalid.status()).run.gates[3]?.state, "closed");
  const invalidEvents = await new EventJournal(
    join(invalidRoot, ".apex", "projects", "demo", "runs", initialized.runId, "journal"),
  ).replay();
  assert.equal(
    invalidEvents.some(({ type }) => type === "preview.created"),
    false,
  );
  assert.equal(
    invalidEvents.some(({ type }) => type === "preview.requested"),
    false,
  );

  const operationRoot = await tempRoot();
  const wrongOperation = new ApexService(operationRoot, {
    clock: () => now,
    providers: { terraform: terraformPreviewProvider(now, "operation") },
  });
  const operationRun = await wrongOperation.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(wrongOperation, operationRun.runId, "terraform");
  await assert.rejects(wrongOperation.preview({ operation: "apply", provider: "terraform" }), /preview:hash-bindings/);

  const stateRoot = await tempRoot();
  const wrongState = new ApexService(stateRoot, {
    clock: () => now,
    providers: { terraform: terraformPreviewProvider(now, "state") },
  });
  const stateRun = await wrongState.init({ projectId: "demo", iacTool: "terraform" });
  await reachValidation(wrongState, stateRun.runId, "terraform");
  await assert.rejects(
    wrongState.preview({ operation: "apply", provider: "terraform" }),
    /terraform:saved-plan-binding/,
  );

  const recovering = new ApexService(invalidRoot, {
    clock: () => now,
    providers: { terraform: terraformPreviewProvider(now) },
  });
  await recovering.preview({ operation: "apply", provider: "terraform" });
  assert.equal((await recovering.status()).run.gates[3]?.state, "open");
});

test("terminal validator rejects unaccounted active validators", () => {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  const result = registry.validate("terminal:run-evidence-complete", {
    activeValidatorIds: ["schema:requirements-v1", "terminal:run-evidence-complete"],
    executedValidatorIds: [],
    simulatedOmittedValidatorIds: [],
  });
  assert.equal(result.valid, false);
  assert.match(result.issues[0]?.message ?? "", /schema:requirements-v1/);
});

test("review blockers persist, resolve, and permit gate approval", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await service.nextTask();
  const hashes = await complete(service, "requirements", [{ kind: "requirements", value: requirements() }]);
  const reviewHashes = await complete(service, "requirements-review", [
    {
      kind: "review-findings",
      value: review(runId, "requirements", hashes.requirements!, [
        { id: "F-1", severity: "high", disposition: "open", title: "Block", detail: "Resolve", evidenceRefs: [] },
      ]),
    },
  ]);
  const pendingReview = await service.nextTask();
  assert.equal(pendingReview.status, "needs_review");
  if (pendingReview.status !== "needs_review") return;
  assert.deepEqual(
    pendingReview.review.findings.map(({ id, actions }) => ({ id, actions })),
    [{ id: "F-1", actions: ["revise", "acknowledge"] }],
  );
  const restarted = new ApexService(root);
  const reviewHash = reviewHashes["review-findings"]!;
  const dependencyHash = sha256Json({ "review-findings": reviewHash });
  await assert.rejects(
    restarted.resolveReview({
      findingId: "F-1",
      reviewHash,
      subjectHash: hashes.requirements!,
      disposition: "accepted-risk",
      actor: "tester",
      rationale: "not permitted",
      evidenceRefs: [],
      expiresAt: "2027-01-01T00:00:00.000Z",
      dependencyHash,
    }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_AUTHORIZATION",
  );
  await restarted.resolveReview({
    findingId: "F-1",
    reviewHash,
    subjectHash: hashes.requirements!,
    disposition: "fixed",
    actor: "tester",
    rationale: "corrected requirement",
    evidenceRefs: [hashes.requirements!],
    dependencyHash,
  });
  assert.equal((await restarted.status()).run.gates[0]?.state, "open");
  await restarted.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(restarted, runId);
  assert.equal((await nextTaskAfterInput(restarted)).status, "task");
});

test("requirements obligations can be acknowledged with a downstream owner", async () => {
  const service = new ApexService(await tempRoot());
  const { runId } = await service.init({ projectId: "demo" });
  await service.nextTask();
  const hashes = await complete(service, "requirements", [{ kind: "requirements", value: requirements() }]);
  const reviewHashes = await complete(service, "requirements-review", [
    {
      kind: "review-findings",
      value: review(runId, "requirements", hashes.requirements!, [
        {
          id: "F-1",
          severity: "high",
          disposition: "open",
          title: "GDPR ownership is unresolved",
          detail: "Document and assign this downstream obligation.",
          evidenceRefs: [],
        },
      ]),
    },
  ]);

  await assert.rejects(
    service.decideReview(reviewHashes["review-findings"]!, [{ findingId: "F-1", action: "acknowledge" }]),
    /Acknowledgment requires an owner/u,
  );
  assert.deepEqual(
    await service.decideReview(reviewHashes["review-findings"]!, [
      { findingId: "F-1", action: "acknowledge", owner: "Nordic Fresh Foods Product Owner" },
    ]),
    { status: "resolved" },
  );
  assert.equal((await service.status()).run.gates[0]?.state, "open");
});

test("requirements revision invalidates the old artifact and requires a fresh review", async () => {
  const service = new ApexService(await tempRoot());
  const { runId } = await service.init({ projectId: "demo" });
  await service.nextTask();
  const initial = await complete(service, "requirements", [{ kind: "requirements", value: requirements() }]);
  const reviewHashes = await complete(service, "requirements-review", [
    {
      kind: "review-findings",
      value: review(runId, "requirements", initial.requirements!, [
        { id: "F-1", severity: "high", disposition: "open", title: "Revise", detail: "Clarify", evidenceRefs: [] },
      ]),
    },
  ]);

  const decision = await service.decideReview(reviewHashes["review-findings"]!, [
    { findingId: "F-1", action: "revise", rationale: "Clarify the requirement" },
  ]);
  assert.deepEqual(decision, { status: "revision_requested" });
  const replacementTask = await service.nextTask();
  assert.equal(replacementTask.status, "task");
  if (replacementTask.status !== "task") return;
  assert.equal(replacementTask.task.taskType, "requirements");

  const revised = requirements();
  revised.requirements[0]!.statement = "Revised offline service requirement";
  const revisedHashes = await service.completeRequirements(replacementTask.task.taskId, revised);
  const replacementReview = await service.nextTask();
  assert.equal(replacementReview.status, "task");
  if (replacementReview.status !== "task") return;
  assert.equal(replacementReview.task.taskType, "requirements-review");
  await service.completeReview(replacementReview.task.taskId, []);
  assert.equal((await service.status()).run.gates[0]?.state, "open");
  assert.notEqual(revisedHashes.outputHashes.requirements, initial.requirements);
});

test("expired accepted risk can be replaced without reopening an open gate", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const service = new ApexService(await tempRoot(), { clock: () => new Date(now) });
  const { runId } = await service.init({ projectId: "demo" });
  await service.nextTask();
  const hashes = await complete(service, "requirements", [{ kind: "requirements", value: requirements() }]);
  const reviewHashes = await complete(service, "requirements-review", [
    {
      kind: "review-findings",
      value: review(runId, "requirements", hashes.requirements!, [
        { id: "F-1", severity: "medium", disposition: "open", title: "Risk", detail: "Resolve", evidenceRefs: [] },
      ]),
    },
  ]);
  const dependencyHash = sha256Json({ "review-findings": reviewHashes["review-findings"]! });
  await service.resolveReview({
    findingId: "F-1",
    reviewHash: reviewHashes["review-findings"]!,
    subjectHash: hashes.requirements!,
    disposition: "accepted-risk",
    actor: "tester",
    rationale: "temporary exception",
    evidenceRefs: [],
    expiresAt: "2026-01-02T00:00:00.000Z",
    dependencyHash,
  });
  assert.equal((await service.status()).run.gates[0]?.state, "open");

  now = Date.parse("2026-01-03T00:00:00.000Z");
  await assert.rejects(service.decideGateNumber(1, "approved", "tester"), /gate:requirements-ready/);
  await service.resolveReview({
    findingId: "F-1",
    reviewHash: reviewHashes["review-findings"]!,
    subjectHash: hashes.requirements!,
    disposition: "fixed",
    actor: "tester",
    rationale: "permanent correction",
    evidenceRefs: [hashes.requirements!],
    dependencyHash,
  });
  assert.equal((await service.status()).run.gates[0]?.state, "open");
  await service.decideGateNumber(1, "approved", "tester");
});

test("promotion inherits neutral progression and restarts at the first environment-specific dependency", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  const codegen = await reachCodegen(service, runId, "bicep");
  await service.cancelTask(codegen.taskId);
  const sameScope = await service.promote("stage", "local");
  assert.deepEqual(
    sameScope.gates.map(({ state }) => state),
    ["inherited", "inherited", "inherited", "closed"],
  );
  assert.equal((await service.nextTask()).status, "task");
  assert.equal((await service.status()).task, "codegen-bicep");

  await service.use("demo", runId);
  const changedScope = await service.promote("prod", "subscription/prod");
  assert.deepEqual(
    changedScope.gates.map(({ state }) => state),
    ["inherited", "closed", "closed", "closed"],
  );
  const next = await service.nextTask();
  assert.equal(next.status, "task");
  if (next.status === "task") assert.equal(next.task.taskType, "governance-discovery");
});

test("approval bookkeeping preserves authority while runtime dependency mutation blocks deploy", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await reachValidation(service, runId, "bicep");
  const preview = await service.preview({ operation: "apply", provider: "fake" });
  await service.decideGateNumber(4, "approved", "tester");
  const deployed = await service.deploy(preview.previewHash);
  assert.equal(deployed.inventory.resources.length, 1);

  const secondRoot = await tempRoot();
  const second = new ApexService(secondRoot);
  const initialized = await second.init({ projectId: "demo" });
  await reachValidation(second, initialized.runId, "bicep");
  const stalePreview = await second.preview({ operation: "apply", provider: "fake" });
  await second.decideGateNumber(4, "approved", "tester");
  const secondRuntimeHash = (await second.status()).run.runtimeLockHash;
  await import("node:fs/promises").then(({ appendFile }) =>
    appendFile(join(secondRoot, ".apex", "runtime-generations", secondRuntimeHash, "workflow.v1.json"), "\n"),
  );
  await assert.rejects(
    second.deploy(stalePreview.previewHash),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
  );
});

test("invalid bundles are rejected before completion state changes", async () => {
  const service = new ApexService(await tempRoot());
  const { runId } = await service.init({ projectId: "demo" });
  await service.nextTask();
  const requirementTask = await task(service, "requirements");
  const before = await service.status();
  const invalidRequirements = structuredClone(requirements());
  invalidRequirements.requirements.push({ ...invalidRequirements.requirements[0]! });
  await assert.rejects(
    service.completeTaskOutputs(requirementTask, [{ kind: "requirements", value: invalidRequirements }]),
    /requirements-completeness/i,
  );
  assert.equal((await service.status()).events, before.events);

  const accepted = await service.completeTaskOutputs(requirementTask, [
    { kind: "requirements", value: requirements() },
  ]);
  const hashes = await complete(service, "requirements-review", [
    { kind: "review-findings", value: review(runId, "requirements", accepted.outputHashes.requirements!) },
  ]);
  assert.ok(hashes["review-findings"]);
  await service.decideGateNumber(1, "approved", "tester");
  const architectureTask = await task(service, "architecture");
  const invalidCostArchitecture = architecture(runId);
  const invalidCostEstimate = costEstimate(runId, 2);
  await assert.rejects(
    service.completeTaskOutputs(architectureTask, [
      { kind: "architecture", value: invalidCostArchitecture },
      { kind: "cost-estimate", value: invalidCostEstimate },
      {
        kind: "workload-decision-manifest",
        value: workloadDecisionManifest({
          runId,
          requirementsHash: accepted.outputHashes.requirements!,
          architectureHash: sha256Json(invalidCostArchitecture),
          costEstimateHash: sha256Json(invalidCostEstimate),
        }),
      },
    ]),
    /arithmetic/i,
  );
});

test("plan rejects wrong track and secret literals", async () => {
  const service = new ApexService(await tempRoot());
  const { runId } = await service.init({ projectId: "demo", iacTool: "bicep" });
  await reachValidation(service, runId, "bicep");
  const promoted = await service.promote("dev", "local-next");
  assert.equal(promoted.parentRunId, runId);

  const isolated = new ApexService(await tempRoot());
  const initialized = await isolated.init({ projectId: "demo", iacTool: "bicep" });
  await reachCodegen(isolated, initialized.runId, "bicep", async (plan) => {
    const planTask = await task(isolated, "plan");
    const sourceHashes = (plan[0]!.value as ImplementationIntentV1).sourceHashes;
    const before = await isolated.status();
    await assert.rejects(isolated.completeTaskOutputs(planTask, [plan[0]!]), /Task bundle is missing/);
    await assert.rejects(
      isolated.completeTaskOutputs(planTask, planBundle(initialized.runId, "terraform", {}, sourceHashes)),
      /track/i,
    );
    await assert.rejects(
      isolated.completeTaskOutputs(
        planTask,
        planBundle(initialized.runId, "bicep", { password: { kind: "value", value: "literal" } }, sourceHashes),
      ),
      /secret-reference/i,
    );
    assert.equal((await isolated.status()).head, before.head);
  });
});

test("MCP completeTask accepts an output bundle", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const server = createMcpServer(service);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const response = await client.callTool({
    name: "completeTask",
    arguments: {
      taskId: issued.task.taskId,
      outputs: [{ kind: "requirements", value: requirements() }],
    },
  });
  assert.equal(response.isError, undefined);
  await client.close();
  await server.close();
});

test("codegen binding coverage compares approved dependency sets without imposing array order", () => {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  for (const track of ["bicep", "terraform"] as const) {
    const plan = planBundle("run-test", track);
    const intent = plan[0]!.value as ImplementationIntentV1;
    const binding = plan[1]!.value as IacBindingV1;
    for (const id of ["network", "identity"]) {
      intent.resources.push({ ...intent.resources[0]!, id, dependsOn: [] });
      binding.resourceBindings[id] = structuredClone(binding.resourceBindings.api!);
    }
    intent.resources[0]!.dependsOn = ["network", "identity"];
    binding.intentHash = sha256Json(intent);
    const bundle = codegenBundle("run-test", track, plan);
    const manifest = bundle[0]!.value as LogicalResourceManifestV1;
    for (const logicalId of ["network", "identity"]) manifest.resources.push({ ...manifest.resources[0]!, logicalId });
    manifest.resources[0]!.dependsOn = ["identity", "network"];
    const context = {
      artifacts: { "implementation-intent": intent, "iac-binding": binding },
      outputs: { "logical-resource-manifest": manifest },
    };
    assert.equal(registry.validate(`business:${track}-binding-coverage`, context).valid, true);
    manifest.resources[0]!.dependsOn = ["network"];
    assert.equal(registry.validate(`business:${track}-binding-coverage`, context).valid, false);
    manifest.resources[0]!.dependsOn = ["network", "identity", "network"];
    assert.equal(registry.validate(`business:${track}-binding-coverage`, context).valid, false);
  }
});

test("codegen acceptance rejects rehashed manifests that diverge from approved intent and binding", async () => {
  for (const track of ["bicep", "terraform"] as const) {
    const root = await tempRoot();
    const service = new ApexService(root);
    const { runId } = await service.init({ projectId: "demo", iacTool: track });
    const generated = await reachCodegen(service, runId, track);
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    const head = await journal.head();
    for (const mutation of ["logical-id", "type", "implementation", "extra-resource"] as const) {
      const bundle = codegenBundle(runId, track, generated.plan);
      const manifest = bundle.find(({ kind }) => kind === "logical-resource-manifest")!
        .value as LogicalResourceManifestV1;
      const resource = manifest.resources[0]!;
      if (mutation === "logical-id") resource.logicalId = "unapproved";
      if (mutation === "type") resource.type = "Microsoft.KeyVault/vaults";
      if (mutation === "implementation") resource.implementationAddress = "native:Microsoft.KeyVault/vaults@2023-07-01";
      if (mutation === "extra-resource")
        manifest.resources.push({ ...resource, logicalId: "unapproved", executionAddress: "unapproved" });
      const handoff = bundle.find(({ kind }) => kind === "iac-handoff")!.value as IacHandoffV1;
      handoff.logicalResourceManifestHash = sha256Json(manifest);
      await assert.rejects(
        service.completeTaskOutputs(generated.taskId, bundle),
        /binding-coverage validation failed/i,
      );
      assert.equal(await journal.head(), head);
      assert.equal((await service.status()).run.gates[3]!.state, "closed");
    }
    await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, track, generated.plan));
    assert.equal((await service.status()).task, `validation-${track}`);
  }
});

test("restricted staging and generateIac produce a real accepted tree", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", iacTool: "bicep" });
  const { taskId } = await reachCodegen(service, runId, "bicep");
  const first = await service.stageFile(taskId, "notes.md", "bounded\n");
  const second = await service.stageFile(taskId, "notes.md", "bounded\n");
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const head = await journal.head();
  const before = (await service.status()).run;
  await assert.rejects(service.stageFile(taskId, "../escape.tf", "bad"), /unsafe/i);
  await assert.rejects(service.stageFile(taskId, "notes.md", "changed\n"), /overwrite/i);
  assert.equal(await journal.head(), head);
  assert.deepEqual((await service.status()).run, before);
  assert.equal(await readFile(first.path, "utf8"), "bounded\n");
  await assert.rejects(readFile(join(first.path, "..", "..", "escape.tf")), { code: "ENOENT" });
  const generated = await service.generateIac(taskId, { requiredToolVersions: { bicep: "test" } });
  assert.match(generated.treeHash, /^[0-9a-f]{64}$/);
  assert.ok(generated.files.some(({ path }) => path.endsWith("main.bicep")));
  assert.match(generated.outputHashes["iac-handoff"]!, /^[0-9a-f]{64}$/);
  assert.equal((await service.status()).task, "validation-bicep");
  const completedHead = await journal.head();
  await assert.rejects(service.completeTaskOutputs(taskId, []), /stale/i);
  assert.equal(await journal.head(), completedHead);
});

function emptyGovernanceBaseline(subscriptionId: string, discoveredAt: string) {
  return {
    schema_version: "governance-baseline-v1",
    subscription_id: subscriptionId,
    coverage_status: "COMPLETE",
    subscriptions_discovered: 1,
    subscriptions_processed: 1,
    subscriptions_skipped: [],
    subscriptions_excluded: [],
    summary: { total_findings: 0, total_blockers: 0, total_auto_remediate: 0, subscriptions_complete: 1 },
    subscriptions: {
      [subscriptionId]: {
        schema_version: "governance-constraints-v1",
        subscription_id: subscriptionId,
        discovered_at: discoveredAt,
        source: "github-actions-baseline",
        discovery_status: "COMPLETE",
        discovery_metadata: {
          discovery_status: "COMPLETE",
          discovered_at: discoveredAt,
          scope: {
            subscription_id: subscriptionId,
            management_groups: [],
            coverage: "subscription-and-descendants-v1",
          },
          api_versions: {
            policyAssignments: "2022-06-01",
            policyDefinitions: "2021-06-01",
            policyExemptions: "2022-07-01-preview",
          },
          page_counts: { policyAssignments: 0, policyDefinitions: 0, policyExemptions: 0 },
          completeness_signature: "",
          ttl_days: 7,
        },
        discovery_summary: {
          assignment_total: 0,
          assignment_kept: 0,
          defender_auto_filtered: 0,
          subscription_scope_count: 0,
          management_group_inherited_count: 0,
          blocker_count: 0,
          auto_remediate_count: 0,
          informational_count: 0,
          audit_count: 0,
          disabled_count: 0,
          exempted_count: 0,
          classified_policy_count: 0,
          other_effect_count: 0,
        },
        assignment_inventory: [],
        findings: [],
        policies: [],
        tags_required: [],
        allowed_locations: [],
        irrelevant_metadata: "UNSELECTED_BASELINE_MARKER",
      },
    },
  };
}

async function materialGovernanceFixture(track: "bicep" | "terraform", native = false) {
  const root = await tempRoot();
  const now = new Date("2026-09-19T00:00:00Z");
  const subscriptionId = "11111111-1111-1111-1111-111111111111";
  const path = join(root, "baseline.json");
  const baseline = emptyGovernanceBaseline(subscriptionId, now.toISOString());
  await writeJson(path, baseline);
  const provider = track === "bicep" ? bicepPreviewProvider(now) : terraformPreviewProvider(now);
  const service = new ApexService(root, { clock: () => now, ...(native ? { providers: { [track]: provider } } : {}) });
  const { runId } = await service.init({
    projectId: "demo",
    iacTool: track,
    targetScope: `/subscriptions/${subscriptionId}/resourceGroups/rg-test`,
  });
  const generated = await reachCodegen(
    service,
    runId,
    track,
    native && track === "bicep" ? configureNativeBicepPlan : undefined,
    false,
    path,
  );
  const directory = join(root, ".apex", "projects", "demo", "runs", runId);
  const journal = new EventJournal(join(directory, "journal"));
  const candidate = structuredClone(baseline);
  candidate.subscriptions[subscriptionId]!.irrelevant_metadata = "MATERIAL_REVISION";
  return {
    root,
    now,
    path,
    baseline,
    candidate,
    service,
    runId,
    generated,
    directory,
    journal,
    subscriptionId,
    provider,
  };
}

test("material governance revision rejects unsafe, stale, incomplete, unchanged and unbound inputs without mutation", async () => {
  const { root, now, path, baseline, candidate, service, directory, journal, subscriptionId } =
    await materialGovernanceFixture("bicep");
  const head = await journal.head();
  const runBytes = await readFile(join(directory, "run.json"));
  const reject = async (inputPath: string, pattern: RegExp | { code: string }, reason = "Policy changed") => {
    await assert.rejects(service.reviseGovernanceBaseline(inputPath, { confirm: true, reason }), pattern);
    assert.equal(await journal.head(), head);
    assert.deepEqual(await readFile(join(directory, "run.json")), runBytes);
  };
  await reject(path, /unchanged.*normal import renewal/);
  await reject(path, /requires a reason/, "  ");
  await reject("../outside.json", /escapes its root/);
  await symlink(path, join(root, "linked.json"));
  await reject("linked.json", /symlink/);
  for (const offset of [-30 * 86_400_000, 1]) {
    const changed = structuredClone(candidate);
    const observedAt = new Date(now.getTime() + offset).toISOString();
    changed.subscriptions[subscriptionId]!.discovered_at = observedAt;
    changed.subscriptions[subscriptionId]!.discovery_metadata.discovered_at = observedAt;
    await writeJson(path, changed);
    await reject(path, /stale|future|refresh/i);
  }
  await writeJson(path, { ...candidate, coverage_status: "INCOMPLETE" });
  await reject(path, { code: "APEX_VALIDATION" });
  await writeJson(path, emptyGovernanceBaseline("22222222-2222-2222-2222-222222222222", now.toISOString()));
  await reject(path, { code: "APEX_VALIDATION" });
  await writeJson(path, candidate);
  const run = (await service.status()).run;
  await writeJson(join(directory, "run.json"), { ...run, ownerEpoch: 2 });
  await assert.rejects(
    service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" }),
    /writer authority/i,
  );
  await writeJson(join(directory, "run.json"), run);
  await writeJson(join(directory, "run.json"), {
    ...run,
    targetScope: `/subscriptions/${subscriptionId}/resourceGroups/different`,
  });
  await assert.rejects(
    service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" }),
    /run and target/i,
  );
  await writeFile(join(directory, "run.json"), runBytes);
  assert.equal(await journal.head(), head);
  await writeJson(path, baseline);
});

test("material governance revision blocks synthetic and legacy accepted governance without guessing a digest", async () => {
  const { path, candidate, service, journal, runId, root } = await materialGovernanceFixture("bicep");
  await writeJson(path, candidate);
  const run = (await service.status()).run;
  const originalHash = service["acceptedArtifactHashes"](await journal.replay())["governance-constraints"]!;
  const objects = new ObjectStore(root);
  const original = await objects.getJson<GovernanceConstraintsV1>(originalHash);
  const snapshot = await objects.getJson<Record<string, unknown>>(original.constraintsRef.digest);
  delete snapshot.contentHash;
  const digest = await objects.putJson(snapshot);
  const legacy = {
    ...original,
    constraintsRef: {
      ...original.constraintsRef,
      digest,
      uri: `apex-object:${digest}`,
      bytes: (await objects.getBytes(digest)).length,
    },
  };
  for (const [value, pattern] of [
    [governance(runId), /synthetic/],
    [legacy, /content digest.*new run/],
  ] as const) {
    await service["append"](run, "task.completed", {
      nodeId: "governance-discovery",
      artifactHashes: { "governance-constraints": await objects.putJson(value) },
    });
    const head = await journal.head();
    await assert.rejects(service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" }), pattern);
    assert.equal(await journal.head(), head);
  }
});

test("target-bound governance rejects obsolete coverage and snapshots without migration", async () => {
  const { root, path, baseline, service, journal } = await materialGovernanceFixture("bicep");
  const run = (await service.status()).run;
  const objects = new ObjectStore(root);
  const original = await objects.getJson<GovernanceConstraintsV1>(
    service["acceptedArtifactHashes"](await journal.replay())["governance-constraints"]!,
  );
  const snapshot = await objects.getJson<Record<string, unknown>>(original.constraintsRef.digest);
  assert.equal(snapshot.schemaVersion, "governance-baseline-selection-v2");
  assert.equal(snapshot.targetScope, run.targetScope.toLowerCase());
  const oldBaseline = structuredClone(baseline);
  delete (
    oldBaseline.subscriptions[Object.keys(oldBaseline.subscriptions)[0]!]!.discovery_metadata.scope as Record<
      string,
      unknown
    >
  ).coverage;
  await writeJson(path, oldBaseline);
  const head = await journal.head();
  await assert.rejects(service.importGovernanceBaseline(path), /incomplete/);
  assert.equal(await journal.head(), head);
  await writeJson(path, baseline);
  snapshot.schemaVersion = "governance-baseline-selection-v1";
  delete snapshot.targetScope;
  snapshot.contentHash = "a".repeat(64);
  const digest = await objects.putJson(snapshot);
  const legacy = {
    ...original,
    constraintsRef: {
      ...original.constraintsRef,
      digest,
      uri: `apex-object:${digest}`,
      bytes: (await objects.getBytes(digest)).length,
    },
  };
  await service["append"](run, "task.completed", {
    nodeId: "governance-discovery",
    artifactHashes: { "governance-constraints": await objects.putJson(legacy) },
  });
  await assert.rejects(service.importGovernanceBaseline(path), /run and target/);
  await assert.rejects(
    service.reviseGovernanceBaseline(path, { confirm: false, reason: "Migrate target coverage" }),
    /confirmation/,
  );
  const obsoleteHead = await journal.head();
  await assert.rejects(
    service.reviseGovernanceBaseline(path, { confirm: true, reason: "Migrate target coverage" }),
    /run and target/,
  );
  assert.equal(await journal.head(), obsoleteHead);
});

test("material governance revision is permitted after native execution is reconciled", async () => {
  const { path, candidate, service, runId, generated, provider, journal } = await materialGovernanceFixture(
    "terraform",
    true,
  );
  await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, "terraform", generated.plan));
  await complete(service, "validation-terraform", [
    { kind: "validation-evidence", value: validationEvidence(runId, "terraform") },
  ]);
  const preview = await service.preview({ operation: "apply", provider: "terraform" });
  await service.decideGateNumber(4, "approved", "tester");
  const inventory = provider.inventory.bind(provider);
  provider.inventory = async () => {
    throw new Error("inventory unavailable");
  };
  await assert.rejects(service.deploy(preview.previewHash), /inventory unavailable/);
  await writeJson(path, candidate);
  const head = await journal.head();
  await assert.rejects(
    service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" }),
    /reconcile before governance revision/,
  );
  assert.equal(await journal.head(), head);
  provider.inventory = inventory;
  const reconciled = await service.reconcile();
  const before = await journal.replay();
  await service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed after reconciliation" });
  assert.deepEqual((await journal.replay()).slice(0, -1), before);
  assert.deepEqual(await service.inventory(), reconciled);
});

for (const stage of ["intent", "journal", "run", "cleanup"] as const) {
  test(`material governance revision transaction recovers ${stage} failure without split gates`, async () => {
    const { root, now, path, candidate, service, journal, directory } = await materialGovernanceFixture("bicep");
    await writeJson(path, candidate);
    const before = await journal.replay();
    const beforeRun = (await service.status()).run;
    service["runRepository"] = () =>
      new RunRepository(directory, {
        clock: () => now,
        faultInjector: (actual) => {
          if (actual === stage) throw new Error(`injected ${stage}`);
        },
      });
    await assert.rejects(
      service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" }),
      new RegExp(`injected ${stage}`),
    );
    const restarted = new ApexService(root, { clock: () => now });
    const recovered = await restarted["currentRun"]();
    if (stage === "intent") {
      assert.deepEqual(await journal.replay(), before);
      assert.deepEqual(recovered, beforeRun);
      await restarted.reviseGovernanceBaseline(path, { confirm: true, reason: "Retry after rollback" });
    } else {
      assert.deepEqual((await journal.replay()).slice(0, -1), before);
      assert.deepEqual(
        recovered.gates.slice(1).map(({ state }) => state),
        ["invalidated", "invalidated", "invalidated"],
      );
      assert.equal(restarted["acceptedArtifactHashes"](await journal.replay())["governance-constraints"], undefined);
    }
    assert.ok(!(await readdir(directory)).includes(".run-transaction.json"));
    await restarted.importGovernanceBaseline(path);
    await task(restarted, "governance-reconciliation");
  });
}

for (const conflict of ["head", "writer"] as const) {
  test(`material governance revision rejects concurrent ${conflict} CAS changes`, async () => {
    const { path, candidate, service, journal, directory, now } = await materialGovernanceFixture("bicep");
    await writeJson(path, candidate);
    const beforeRun = (await service.status()).run;
    const repository = new RunRepository(directory, { clock: () => now });
    const mutate = repository.mutate.bind(repository);
    repository.mutate = async (input) => {
      if (conflict === "head") await service["append"](beforeRun, "test.concurrent", {});
      else await writeJson(join(directory, "run.json"), { ...beforeRun, ownerEpoch: 2 });
      return mutate(input);
    };
    service["runRepository"] = () => repository;
    await assert.rejects(service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" }), {
      code: "APEX_STALE",
    });
    assert.equal((await journal.replay()).filter(({ type }) => type === "workflow.invalidated").length, 0);
    assert.deepEqual((await repository.read()).gates, beforeRun.gates);
    assert.ok(!(await readdir(directory)).includes(".run-transaction.json"));
  });
}

for (const track of ["bicep", "terraform"] as const) {
  test(`${track} material governance revision invalidates closure and binds explicit import without erasing history`, async () => {
    const { root, now, path, candidate, service, runId, generated, journal } = await materialGovernanceFixture(track);
    await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, track, generated.plan));
    await complete(service, `validation-${track}`, [
      { kind: "validation-evidence", value: validationEvidence(runId, track) },
    ]);
    const preview = await service.preview({ operation: "apply", provider: "fake" });
    await service.decideGateNumber(4, "approved", "tester");
    const selected = await service.selectGovernanceBaseline(path);
    if (selected.status !== "needs_input") throw new Error("Expected governance choice");
    await service.recordInput({
      schemaVersion: "1.0.0",
      requestId: selected.request.requestId,
      expectedHead: selected.request.expectedHead,
      ownerEpoch: selected.request.ownerEpoch,
      answers: [{ questionId: "governance-baseline-choice", value: "refresh" }],
    });
    const before = await journal.replay();
    const beforeRun = (await service.status()).run;
    const previousHashes = service["acceptedArtifactHashes"](before);
    await writeJson(path, candidate);
    const result = await service.reviseGovernanceBaseline(path, {
      confirm: true,
      reason: "  Policy materially changed  ",
    });
    assert.equal(result.previousGovernanceHash, previousHashes["governance-constraints"]);
    assert.equal(result.candidateHash, sha256Bytes(await readFile(path)));
    for (const node of [
      "governance-discovery",
      "governance-reconciliation",
      "governance-review",
      "gate-2",
      "plan",
      "plan-review",
      "gate-3",
      "codegen-bicep",
      "codegen-terraform",
      "validation-bicep",
      "validation-terraform",
      "preview-bicep",
      "preview-terraform",
      "gate-4",
      "deploy-bicep",
      "deploy-terraform",
      "inventory",
      "diagnosis",
      "quality",
    ])
      assert.ok(result.invalidatedNodes.includes(node), node);
    for (const node of ["requirements", "requirements-review", "gate-1", "architecture", "architecture-review"])
      assert.ok(!result.invalidatedNodes.includes(node), node);
    const after = await journal.replay();
    assert.deepEqual(after.slice(0, -1), before);
    assert.equal(after.at(-1)!.type, "workflow.invalidated");
    assert.equal((after.at(-1)!.payload as { reason: string }).reason, "Policy materially changed");
    assert.ok(!JSON.stringify(after.at(-1)).includes("MATERIAL_REVISION"));
    const afterRun = (await service.status()).run;
    assert.deepEqual(afterRun.gates[0], beforeRun.gates[0]);
    assert.deepEqual(
      afterRun.gates.slice(1).map(({ state }) => state),
      ["invalidated", "invalidated", "invalidated"],
    );
    assert.notEqual(dependencyRevision(afterRun, after), dependencyRevision(beforeRun, before));
    const remaining = service["acceptedArtifactHashes"](after);
    for (const kind of ["requirements", "architecture", "cost-estimate", "workload-decision-manifest"])
      assert.equal(remaining[kind], previousHashes[kind]);
    assert.equal(remaining["governance-constraints"], undefined);
    const architectureReview = before.findLast(
      (event) =>
        event.type === "task.completed" && (event.payload as { nodeId?: string }).nodeId === "architecture-review",
    )!;
    assert.equal(
      remaining["review-findings"],
      (architectureReview.payload as { artifactHashes: Record<string, string> }).artifactHashes["review-findings"],
    );
    await assert.rejects(service.taskContext(generated.taskId), /stale|head/i);
    await assert.rejects(service.currentPreview());
    await assert.rejects(service.deploy(preview.previewHash));
    const restarted = new ApexService(root, { clock: () => now });
    const discoveryTask = await task(restarted, "governance-discovery");
    await assert.rejects(
      restarted.completeTaskOutputs(discoveryTask, [{ kind: "governance-constraints", value: governance(runId) }]),
      /requires explicit import/,
    );
    await writeJson(join(root, "other.json"), candidate);
    await assert.rejects(restarted.importGovernanceBaseline("other.json"), /confirm a new material revision/);
    await writeFile(path, JSON.stringify(candidate));
    await assert.rejects(restarted.importGovernanceBaseline(path), /confirm a new material revision/);
    await restarted.reviseGovernanceBaseline(path, { confirm: true, reason: "Confirm replacement bytes" });
    await assert.rejects(restarted.taskContext(discoveryTask), /stale|head/i);
    const imported = await restarted.importGovernanceBaseline(path);
    assert.notEqual(imported.outputHash, result.previousGovernanceHash);
    await task(restarted, "governance-reconciliation");
    assert.deepEqual(
      (await restarted.status()).run.gates.slice(1).map(({ state }) => state),
      ["invalidated", "invalidated", "invalidated"],
    );
  });

  test(`${track} material governance revision blocks in-flight and indeterminate native deployment`, async () => {
    const { path, candidate, service, runId, generated, provider, journal, root, now } =
      await materialGovernanceFixture(track, true);
    await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, track, generated.plan));
    await complete(service, `validation-${track}`, [
      { kind: "validation-evidence", value: validationEvidence(runId, track) },
    ]);
    const preview = await service.preview({ operation: "apply", provider: track });
    await service.decideGateNumber(4, "approved", "tester");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    provider.apply = async () => {
      entered.resolve();
      await release.promise;
      throw new Error("Unknown provider outcome");
    };
    const deployment = assert.rejects(service.deploy(preview.previewHash), /Unknown provider outcome/);
    await entered.promise;
    await writeJson(path, candidate);
    const inFlightHead = await journal.head();
    try {
      await assert.rejects(
        service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" }),
        /in-flight or indeterminate.*reconcile/,
      );
      assert.equal(await journal.head(), inFlightHead);
    } finally {
      release.resolve();
    }
    await deployment;
    const restarted = new ApexService(root, { clock: () => now, providers: { [track]: provider } });
    const head = await journal.head();
    await assert.rejects(
      restarted.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" }),
      /indeterminate.*reconcile/,
    );
    assert.equal(await journal.head(), head);
    assert.ok((await journal.replay()).some(({ type }) => type === "deployment.indeterminate"));
  });

  test(`${track} material governance revision makes prior native preview and approval unusable`, async () => {
    const { path, candidate, service, runId, generated, journal } = await materialGovernanceFixture(track, true);
    await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, track, generated.plan));
    await complete(service, `validation-${track}`, [
      { kind: "validation-evidence", value: validationEvidence(runId, track) },
    ]);
    const preview = await service.preview({ operation: "apply", provider: track });
    const approval = await service.decideGateNumber(4, "approved", "tester");
    await service.deploy(preview.previewHash);
    const before = await journal.replay();
    await writeJson(path, candidate);
    await service.reviseGovernanceBaseline(path, { confirm: true, reason: "Policy changed" });
    assert.deepEqual((await journal.replay()).slice(0, -1), before);
    assert.deepEqual(await service.currentApproval(), approval);
    await assert.rejects(service.currentPreview());
    await assert.rejects(service.deploy(preview.previewHash));
    await assert.rejects(service.decideGateNumber(4, "approved", "tester"));
    const imported = await service.importGovernanceBaseline(path);
    const policy = await complete(service, "governance-reconciliation", [
      { kind: "policy-property-map", value: policyMap(runId, imported.outputHash) },
    ]);
    await complete(service, "governance-review", [
      { kind: "review-findings", value: review(runId, "policy-property-map", policy["policy-property-map"]!) },
    ]);
    await service.decideGateNumber(2, "approved", "tester");
    const hashes = service["acceptedArtifactHashes"](await journal.replay());
    const plan = planBundle(
      runId,
      track,
      {},
      {
        requirements: hashes.requirements!,
        architecture: hashes.architecture!,
        "governance-constraints": imported.outputHash,
        "policy-property-map": policy["policy-property-map"]!,
      },
    );
    if (track === "bicep") configureNativeBicepPlan(plan);
    const planHashes = await complete(service, "plan", plan);
    await complete(service, "plan-review", [
      { kind: "review-findings", value: review(runId, "plan", planHashes["implementation-intent"]!) },
    ]);
    await service.decideGateNumber(3, "approved", "tester");
    await complete(service, `codegen-${track}`, codegenBundle(runId, track, plan));
    await complete(service, `validation-${track}`, [
      { kind: "validation-evidence", value: validationEvidence(runId, track) },
    ]);
    await assert.rejects(
      service.nextTask(),
      /preview is required|Deployment and inventory are required|Gate 4 approval is required/,
    );
  });

  test(`${track} persists bounded governance refresh without collecting or completing`, async () => {
    const root = await tempRoot();
    const subscriptionId = "11111111-1111-1111-1111-111111111111";
    let now = new Date("2026-09-19T00:00:00Z");
    const observedAt = new Date(now.getTime() - 29 * 86_400_000).toISOString();
    const baseline = emptyGovernanceBaseline(subscriptionId, observedAt);
    const path = join(root, "baseline.json");
    await writeJson(path, baseline);
    const service = new ApexService(root, { clock: () => now });
    const { runId } = await service.init({
      projectId: "demo",
      iacTool: track,
      targetScope: `/subscriptions/${subscriptionId}`,
    });
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    const initialHead = await journal.head();
    await assert.rejects(service.selectGovernanceBaseline(path), /active discovery task/);
    assert.equal(await journal.head(), initialHead);
    await reachCodegen(service, runId, track, undefined, false, path, undefined, async () => {
      const beforeSelection = await journal.head();
      for (const malformed of ["null", "{}", "not JSON"]) {
        await writeFile(path, malformed);
        await assert.rejects(service.selectGovernanceBaseline(path));
        await assert.rejects(service.importGovernanceBaseline(path));
        assert.equal(await journal.head(), beforeSelection);
      }
      const missing = join(root, "missing-baseline.json");
      await assert.rejects(service.selectGovernanceBaseline(missing));
      await assert.rejects(service.importGovernanceBaseline(missing));
      await writeJson(
        path,
        emptyGovernanceBaseline(subscriptionId, new Date(now.getTime() - 30 * 86_400_000).toISOString()),
      );
      await assert.rejects(service.importGovernanceBaseline(path), /stale/);
      assert.equal(await journal.head(), beforeSelection);
      await writeJson(path, baseline);
      const selected = await service.selectGovernanceBaseline(path);
      if (selected.status !== "needs_input") throw new Error("Expected governance input");
      const request = selected.request;
      assert.equal(request.governance!.candidatePath, "baseline.json");
      assert.equal(request.governance!.candidateHash, sha256Bytes(await readFile(path)));
      assert.doesNotMatch(JSON.stringify(selected), /UNSELECTED_BASELINE_MARKER|"snapshot":|"findings":/);
      assert.match(selected.request.questions[0]!.prompt, /29 days ago/);
      const requestedEvent = (await journal.replay()).at(-1)!;
      const boundaryGovernance = {
        ...request.governance!,
        requestedAt: new Date(now.getTime() - 1).toISOString(),
        expiresAt: new Date(now.getTime() - 1 + 86_400_000).toISOString(),
      };
      const boundaryEvent = {
        ...requestedEvent,
        payload: {
          requestId: request.requestId,
          governance: boundaryGovernance,
          questions: service["governanceQuestions"](observedAt, false, boundaryGovernance.requestedAt),
        },
      };
      assert.match(service["governanceInputRequest"](boundaryEvent).questions[0]!.prompt, /28 days ago/);
      for (const requestedAt of [
        new Date(now.getTime() + 1).toISOString(),
        new Date(now.getTime() - 86_400_000).toISOString(),
      ]) {
        assert.throws(
          () =>
            service["governanceInputRequest"]({
              ...boundaryEvent,
              payload: { ...boundaryEvent.payload, governance: { ...boundaryGovernance, requestedAt } },
            }),
          { code: "APEX_VALIDATION" },
        );
      }
      const answer = {
        schemaVersion: "1.0.0" as const,
        requestId: request.requestId,
        expectedHead: request.expectedHead,
        ownerEpoch: request.ownerEpoch,
        answers: [{ questionId: request.questions[0]!.id, value: "reuse" }],
      };
      const head = await journal.head();
      await assert.rejects(service.importGovernanceBaseline(path), /explicit input answer/);
      await assert.rejects(service.recordInput({ ...answer, expectedHead: "0".repeat(64) }), /head is stale/);
      await assert.rejects(service.recordInput({ ...answer, ownerEpoch: answer.ownerEpoch + 1 }), /epoch is stale/);
      await assert.rejects(service.recordInput({ ...answer, requestId: "wrong-request" }), /ID does not match/);
      await assert.rejects(
        service.recordInput({ ...answer, answers: [...answer.answers, ...answer.answers] }),
        /duplicate|once/i,
      );
      await assert.rejects(
        service.recordInput({ ...answer, answers: [{ questionId: "unknown", value: "reuse" }] }),
        /unknown|missing/i,
      );
      await writeFile(path, JSON.stringify(baseline));
      await assert.rejects(service.recordInput(answer), /candidate changed/);
      await assert.rejects(service.selectGovernanceBaseline(path), /candidate changed/);
      await writeJson(path, baseline);
      assert.equal(await journal.head(), head);
      now = new Date(Date.parse(observedAt) + 30 * 86_400_000 - 1);
      const renewedRequest = await service.selectGovernanceBaseline(path);
      assert.deepEqual(renewedRequest, selected);
      now = new Date(Date.parse(observedAt) + 30 * 86_400_000);
      await assert.rejects(service.recordInput(answer), /expired|refresh/);
      const refresh = await service.selectGovernanceBaseline(path);
      if (refresh.status !== "needs_input") throw new Error("Expected refresh input");
      assert.deepEqual(refresh.request.questions[0]!.options, ["refresh"]);
      assert.equal(refresh.request.governance!.refreshRequired, true);
      const refreshAnswer = {
        ...answer,
        requestId: refresh.request.requestId,
        expectedHead: refresh.request.expectedHead,
        answers: [{ questionId: refresh.request.questions[0]!.id, value: "refresh" }],
      };
      await assert.rejects(service.recordInput({ ...refreshAnswer, answers: answer.answers }), /option|allowed/i);
      const restarted = new ApexService(root, { clock: () => now });
      assert.deepEqual(await restarted.nextTask(), refresh);
      const beforeAnswer = await journal.replay();
      await restarted.recordInput(refreshAnswer);
      const afterAnswer = await journal.replay();
      assert.equal(afterAnswer.length, beforeAnswer.length + 1);
      assert.equal(afterAnswer.at(-1)!.type, "governance.input-recorded");
      assert.doesNotMatch(JSON.stringify(afterAnswer.at(-1)), /UNSELECTED_BASELINE_MARKER|snapshot|findings/);
      const currentRun = (await restarted.status()).run;
      for (const unrelated of [
        { type: "governance.observation-renewed", payload: {} },
        { type: "task.completed", payload: { nodeId: "governance-discovery" } },
        { type: "governance.selection-applied", payload: { requestId: refresh.request.requestId } },
      ]) {
        const state = await restarted["governanceInputState"](currentRun, [
          ...afterAnswer,
          { ...afterAnswer.at(-1)!, ...unrelated },
        ]);
        assert.equal(state?.fulfilled, false, unrelated.type);
      }
      for (const type of ["governance.input-requested", "governance.input-recorded"]) {
        await assert.rejects(
          async () =>
            restarted["governanceInputState"](currentRun, [
              ...afterAnswer.slice(0, -1),
              { ...afterAnswer.at(-1)!, type, payload: null },
            ]),
          { code: "APEX_VALIDATION" },
        );
      }
      await assert.rejects(restarted.recordInput(refreshAnswer), /already recorded/);
      const selectedRefresh = {
        status: "selected",
        choice: "refresh",
        candidateHash: refresh.request.governance!.candidateHash,
        observedAt,
        refreshRequired: true,
      };
      assert.deepEqual(
        await new ApexService(root, { clock: () => now }).selectGovernanceBaseline(path),
        selectedRefresh,
      );
      const refreshHead = await journal.head();
      await assert.rejects(restarted.nextTask(), /Governance refresh required/);
      await assert.rejects(restarted.importGovernanceBaseline(path), /Governance refresh required/);
      const unrelated = join(root, "unrelated.json");
      await writeJson(unrelated, emptyGovernanceBaseline(subscriptionId, now.toISOString()));
      await assert.rejects(restarted.importGovernanceBaseline(unrelated), /selected candidate path/);
      await assert.rejects(restarted.selectGovernanceBaseline(unrelated), /candidate changed/);
      await writeFile(path, JSON.stringify(baseline));
      await assert.rejects(restarted.importGovernanceBaseline(path), /Governance refresh required/);
      assert.equal(await journal.head(), refreshHead);
      now = new Date(now.getTime() + 2 * 86_400_000);
      await writeJson(path, emptyGovernanceBaseline(subscriptionId, now.toISOString()));
      await assert.rejects(restarted.nextTask(), /Governance refresh required/);
      assert.equal(await journal.head(), refreshHead);
      const append = service["append"].bind(service);
      service["append"] = async (...args) => {
        if (args[1] === "governance.selection-applied") throw new Error("Interrupted selection marker");
        return append(...args);
      };
      try {
        await assert.rejects(service.importGovernanceBaseline(path), /Interrupted selection marker/);
      } finally {
        service["append"] = append;
      }
      const interrupted = await journal.replay();
      assert.equal((await restarted["governanceInputState"](currentRun, interrupted))?.fulfilled, false);
      await assert.rejects(restarted.nextTask(), /Governance refresh required/);
      await restarted.importGovernanceBaseline(path);
      const recovered = await journal.replay();
      assert.equal(recovered.length, interrupted.length + 1);
      assert.equal(recovered.at(-1)!.type, "governance.selection-applied");
      const imported = recovered.at(-1)!.payload as Record<string, string>;
      assert.equal(imported.rawSourceDigest, sha256Bytes(await readFile(path)));
      assert.notEqual(imported.rawSourceDigest, refresh.request.governance!.candidateHash);
      assert.equal(imported.selectedPath, "baseline.json");
      assert.equal(imported.requestId, refresh.request.requestId);
      assert.equal((await restarted["governanceInputState"](currentRun, recovered))?.fulfilled, true);
      await restarted.importGovernanceBaseline(path);
      assert.equal(await journal.head(), recovered.at(-1)!.hash);
    });
    const events = await journal.replay();
    assert.equal(events.filter(({ type }) => type === "governance.input-requested").length, 2);
    assert.equal(events.filter(({ type }) => type === "governance.input-recorded").length, 1);
    assert.ok(
      events.some(
        (event) =>
          event.type === "task.completed" && (event.payload as { nodeId?: string }).nodeId === "governance-discovery",
      ),
    );
    const pending = await service.selectGovernanceBaseline(path);
    if (pending.status !== "needs_input") throw new Error("Expected accepted-run governance input");
    const pendingAnswer = {
      schemaVersion: "1.0.0" as const,
      requestId: pending.request.requestId,
      expectedHead: pending.request.expectedHead,
      ownerEpoch: pending.request.ownerEpoch,
      answers: [{ questionId: pending.request.questions[0]!.id, value: "reuse" }],
    };
    const runPath = join(root, ".apex", "projects", "demo", "runs", runId, "run.json");
    const originalRun = (await service.status()).run;
    await writeJson(runPath, { ...originalRun, ownerEpoch: originalRun.ownerEpoch + 1 });
    await assert.rejects(service.recordInput(pendingAnswer), /epoch is stale/);
    await writeJson(runPath, originalRun);
    await journal.append({
      eventId: crypto.randomUUID(),
      projectId: "demo",
      runId,
      type: "test.head-advanced",
      timestamp: now.toISOString(),
      ownerEpoch: originalRun.ownerEpoch,
      expectedHead: await journal.head(),
      payload: {},
    });
    await assert.rejects(service.recordInput(pendingAnswer), /head is stale/);
    await assert.rejects(service.nextTask(), /head is stale/);
    const malformed = await journal.append({
      eventId: crypto.randomUUID(),
      projectId: "demo",
      runId,
      type: "governance.input-requested",
      timestamp: now.toISOString(),
      ownerEpoch: originalRun.ownerEpoch,
      expectedHead: await journal.head(),
      payload: {
        requestId: "malformed-governance",
        governance: pending.request.governance!,
        questions: [{ id: "governance-baseline-choice", prompt: "Pick", options: ["reuse", "refresh", "skip"] }],
      },
    });
    await assert.rejects(service.nextTask(), /Persisted governance input request is invalid/);
    await assert.rejects(
      service.recordInput({ ...pendingAnswer, requestId: "malformed-governance", expectedHead: malformed.hash }),
      /Persisted governance input request is invalid/,
    );
    for (const type of ["governance.input-requested", "governance.input-recorded"]) {
      await journal.append({
        eventId: crypto.randomUUID(),
        projectId: "demo",
        runId,
        type: "governance.input-requested",
        timestamp: now.toISOString(),
        ownerEpoch: originalRun.ownerEpoch,
        expectedHead: await journal.head(),
        payload: {
          requestId: pending.request.requestId,
          governance: pending.request.governance!,
          questions: pending.request.questions,
        },
      });
      const invalid = await journal.append({
        eventId: crypto.randomUUID(),
        projectId: "demo",
        runId,
        type,
        timestamp: now.toISOString(),
        ownerEpoch: originalRun.ownerEpoch,
        expectedHead: await journal.head(),
        payload: null,
      });
      await assert.rejects(service.nextTask(), { code: "APEX_VALIDATION" });
      await assert.rejects(service.recordInput(pendingAnswer), { code: "APEX_VALIDATION" });
      assert.equal(await journal.head(), invalid.hash);
    }
  });

  test(`${track} pending optional refresh blocks preview and approval while accepted evidence is fresh`, async () => {
    const root = await tempRoot();
    const now = new Date("2026-09-19T00:00:00Z");
    const subscriptionId = "11111111-1111-1111-1111-111111111111";
    const path = join(root, "baseline.json");
    await writeJson(path, emptyGovernanceBaseline(subscriptionId, now.toISOString()));
    const service = new ApexService(root, { clock: () => now });
    const { runId } = await service.init({
      projectId: "demo",
      iacTool: track,
      targetScope: `/subscriptions/${subscriptionId}`,
    });
    const generated = await reachCodegen(service, runId, track, undefined, false, path);
    await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, track, generated.plan));
    await complete(service, `validation-${track}`, [
      { kind: "validation-evidence", value: validationEvidence(runId, track) },
    ]);
    await service.preview({ operation: "apply", provider: "fake" });
    const selected = await service.selectGovernanceBaseline(path);
    if (selected.status !== "needs_input") throw new Error("Expected governance question");
    await service.recordInput({
      schemaVersion: "1.0.0",
      requestId: selected.request.requestId,
      expectedHead: selected.request.expectedHead,
      ownerEpoch: selected.request.ownerEpoch,
      answers: [{ questionId: "governance-baseline-choice", value: "refresh" }],
    });
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    const head = await journal.head();
    await assert.rejects(service.preview({ operation: "apply", provider: "fake" }), /Governance refresh required/);
    await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /Governance refresh required/);
    assert.equal(await journal.head(), head);
    const reopened = await service.selectGovernanceBaseline(path, { reopen: true });
    if (reopened.status !== "needs_input") throw new Error("Expected reopened choice");
    assert.notEqual(reopened.request.requestId, selected.request.requestId);
    assert.deepEqual(reopened.request.questions[0]!.options, ["reuse", "refresh"]);
    await service.recordInput({
      schemaVersion: "1.0.0",
      requestId: reopened.request.requestId,
      expectedHead: reopened.request.expectedHead,
      ownerEpoch: reopened.request.ownerEpoch,
      answers: [{ questionId: "governance-baseline-choice", value: "reuse" }],
    });
    await service.importGovernanceBaseline(path);
    await service.preview({ operation: "apply", provider: "fake" });
  });

  test(`${track} generates the replacement intent after plan review revision`, async () => {
    const root = await tempRoot();
    const service = new ApexService(root);
    const { runId } = await service.init({ projectId: "demo", iacTool: track });
    const { taskId, plan } = await reachCodegen(service, runId, track, undefined, true);
    const generated = await service.generateIac(taskId);
    const main = generated.files.find(({ path }) => path.endsWith(track === "bicep" ? "main.bicep" : "main.tf"));
    assert.ok(main);
    assert.match(await readFile(main.path, "utf8"), /replacement/);
    const handoff = await new ObjectStore(root).getJson<{ intentHash: string }>(generated.outputHashes["iac-handoff"]!);
    assert.equal(handoff.intentHash, sha256Json(plan.find(({ kind }) => kind === "implementation-intent")!.value));
  });
  for (const mode of ["simulated", "native", "native-module"] as const) {
    test(`${track} imports nonempty policy identities through ${mode} workflow without copying unrelated data`, async () => {
      const root = await tempRoot();
      const now = new Date("2026-09-21T00:00:00Z");
      const subscriptionId = "11111111-1111-1111-1111-111111111111";
      const otherSubscriptionId = "22222222-2222-2222-2222-222222222222";
      const baseline = emptyGovernanceBaseline(subscriptionId, now.toISOString());
      const scope = `/subscriptions/${subscriptionId}`;
      const findings = (["deny", "modify", "deployIfNotExists"] as const).map((effect) => ({
        policy_id: `/providers/Microsoft.Authorization/policyDefinitions/${effect}`,
        display_name: effect,
        effect,
        scope,
        assignment_id: `${scope}/providers/Microsoft.Authorization/policyAssignments/${effect}`,
        classification: effect === "deny" ? "blocker" : "auto-remediate",
        resource_types: [mode !== "simulated" ? "Microsoft.Storage/storageAccounts" : "Microsoft.Web/sites"],
        exemption: null,
        reported_exemptions: [],
        required_value: true,
      }));
      const entry = baseline.subscriptions[subscriptionId]!;
      Object.assign(entry, {
        findings,
        policies: findings,
        assignment_inventory: findings.map((finding) => ({
          scope,
          assignmentId: finding.assignment_id,
          assignmentType: "subscription",
          displayName: finding.display_name,
          policyDefinitionId: finding.policy_id,
        })),
      });
      Object.assign(entry.discovery_summary, {
        assignment_total: 3,
        assignment_kept: 3,
        subscription_scope_count: 3,
        blocker_count: 1,
        auto_remediate_count: 2,
        classified_policy_count: 3,
      });
      entry.discovery_metadata.page_counts.policyAssignments = findings.length;
      entry.discovery_metadata.page_counts.policyDefinitions = findings.length;
      const other = emptyGovernanceBaseline(otherSubscriptionId, now.toISOString()).subscriptions[otherSubscriptionId]!;
      other.irrelevant_metadata = "UNRELATED_SUBSCRIPTION_SENTINEL";
      baseline.subscriptions[otherSubscriptionId] = other;
      baseline.subscriptions_discovered = baseline.subscriptions_processed = 2;
      Object.assign(baseline.summary, {
        total_findings: 3,
        total_blockers: 1,
        total_auto_remediate: 2,
        subscriptions_complete: 2,
      });
      Reflect.deleteProperty(baseline, "subscription_id");
      Object.assign(baseline, { management_group_id: "platform" });
      const path = join(root, "baseline.json");
      await writeJson(path, baseline);
      const service = new ApexService(root, { clock: () => now });
      const targetScope = mode !== "simulated" ? `${scope}/resourceGroups/rg-test` : scope;
      const { runId } = await service.init({ projectId: "demo", iacTool: track, targetScope });
      const generated = await reachCodegen(
        service,
        runId,
        track,
        mode !== "simulated"
          ? (plan) => {
              configureNativeBicepPlan(plan);
              if (mode === "native-module" && track === "bicep") {
                const binding = (plan[1]!.value as IacBindingV1).resourceBindings.api!;
                binding.implementation = "avm:br/public:avm/res/storage/storage-account@0.9.0";
                binding.version = "0.9.0";
                binding.physicalResources = [
                  {
                    resourceId: `${targetScope}/providers/Microsoft.Storage/storageAccounts/apidemo`,
                    type: "Microsoft.Storage/storageAccounts",
                    ownership: "managed",
                    role: "primary",
                  },
                ];
              }
            }
          : undefined,
        false,
        path,
        async (policy) => {
          policy.mappings = findings.map((finding) => ({
            policyAssignmentId: finding.assignment_id,
            policyDefinitionId: finding.policy_id,
            effect: finding.effect,
            logicalResourceId: "api",
            propertyPath: mode !== "simulated" ? "properties.supportsHttpsTrafficOnly" : "properties.httpsOnly",
            expectedValue: true,
            disposition: "planned",
          }));
          const reconciliationTask = await task(service, "governance-reconciliation");
          const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
          const head = await journal.head();
          for (const effect of ["deny", "modify", "deployIfNotExists"] as const) {
            for (const mutation of ["omit", "assignment", "definition", "member", "effect", "exempt"] as const) {
              const invalid = structuredClone(policy);
              const mapping = invalid.mappings.find((value) => value.effect === effect)!;
              if (mutation === "omit") invalid.mappings = invalid.mappings.filter((value) => value !== mapping);
              else if (mutation === "assignment") mapping.policyAssignmentId += "-unrelated";
              else if (mutation === "definition") mapping.policyDefinitionId += "-unrelated";
              else if (mutation === "member") mapping.policyDefinitionReferenceId = "unrelated-member";
              else if (mutation === "effect") mapping.effect = "audit";
              else mapping.disposition = "exempt";
              await assert.rejects(
                service.completeTaskOutputs(reconciliationTask, [{ kind: "policy-property-map", value: invalid }]),
                /Imported policy controls require explicit mappings/,
              );
              assert.equal(await journal.head(), head);
              assert.equal((await service.status()).run.gates[1]!.state, "closed");
            }
          }
        },
      );
      const objects = new ObjectStore(root);
      const intent = generated.plan[0]!.value as ImplementationIntentV1;
      const policyHash = intent.sourceHashes["policy-property-map"]!;
      const acceptedPolicy = await objects.getJson<PolicyPropertyMapV1>(policyHash);
      assert.deepEqual(
        acceptedPolicy.mappings.map(({ policyAssignmentId }) => policyAssignmentId),
        findings.map(({ assignment_id }) => assignment_id),
      );
      const acceptedGovernance = await objects.getJson<GovernanceConstraintsV1>(acceptedPolicy.governanceHash);
      const snapshot = await objects.getJson(acceptedGovernance.constraintsRef.digest);
      const serializedSnapshot = JSON.stringify(snapshot);
      for (const finding of findings) assert.ok(serializedSnapshot.includes(finding.assignment_id));
      for (const excluded of [otherSubscriptionId, "UNRELATED_SUBSCRIPTION_SENTINEL", "UNSELECTED_BASELINE_MARKER"])
        assert.equal(serializedSnapshot.includes(excluded), false);
      if (mode !== "simulated") {
        const sourceRoot = join(root, ".apex/work/code");
        await mkdir(sourceRoot, { recursive: true });
        const source = {
          path: track === "bicep" ? "main.bicep" : "main.tf",
          content: track === "bicep" ? "targetScope = 'resourceGroup'\n" : "terraform {}\n",
        };
        await writeFile(join(sourceRoot, source.path), source.content);
        const bundle = codegenBundle(runId, track, generated.plan);
        const handoff = bundle.find(({ kind }) => kind === "iac-handoff")!.value as IacHandoffV1;
        const terraformAddress = mode === "native-module" ? "module.api.azapi_resource.storage" : "azapi_resource.api";
        if (mode === "native-module") {
          const manifest = bundle.find(({ kind }) => kind === "logical-resource-manifest")!
            .value as LogicalResourceManifestV1;
          manifest.resources[0]!.executionAddress = track === "bicep" ? "api::storage" : terraformAddress;
          if (track === "bicep") manifest.resources[0]!.implementationKind = "module";
          handoff.logicalResourceManifestHash = sha256Json(manifest);
        }
        handoff.treeHash = sha256Json([source]);
        const generatedHashes = (await service.completeTaskOutputs(generated.taskId, bundle)).outputHashes;
        const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
        const runtime = await createFileProviderRuntime(root);
        let observed = false;
        let policyOutput = "";
        const calls: string[] = [];
        const runner = {
          run: async (command: import("@apexops/capabilities").ProcessRequest) => {
            calls.push(`${command.executable} ${command.args.join(" ")}`);
            let stdout = "";
            if (command.executable === "bicep" && command.args[0] === "build") {
              const resource = { properties: { supportsHttpsTrafficOnly: observed } };
              stdout = JSON.stringify({
                resources: {
                  api:
                    mode === "native-module"
                      ? {
                          type: "Microsoft.Resources/deployments",
                          properties: { template: { resources: { storage: resource } } },
                        }
                      : resource,
                },
              });
            } else if (command.executable === "bicep" && ["format", "lint"].includes(command.args[0]!)) {
              stdout = "";
            } else if (command.executable === "az" && command.args.includes("what-if")) {
              stdout = JSON.stringify({
                changes: [
                  {
                    resourceId: `${targetScope}/providers/Microsoft.Storage/storageAccounts/apidemo`,
                    changeType: "Create",
                  },
                ],
              });
            } else if (command.executable === "az" && command.args.includes("list")) {
              stdout = "[]";
            } else if (command.executable === "terraform" && ["init", "fmt", "validate"].includes(command.args[0]!)) {
              stdout = "";
            } else if (
              command.executable === "terraform" &&
              command.args[0] === "state" &&
              command.args[1] === "pull"
            ) {
              stdout = JSON.stringify({ lineage: "imported-policy-test", serial: 1 });
            } else if (command.executable === "terraform" && command.args[0] === "plan") {
              const output = command.args.find((argument) => argument.startsWith("-out="));
              assert.ok(output);
              await writeFile(output.slice(5), "mock-saved-plan");
            } else if (command.executable === "terraform" && command.args[0] === "show") {
              const values = { properties: { supportsHttpsTrafficOnly: observed } };
              stdout = JSON.stringify({
                complete: true,
                resource_changes: [
                  {
                    address: terraformAddress,
                    mode: "managed",
                    change: { actions: ["create"], before: null, after: values, after_unknown: {} },
                  },
                ],
                planned_values: {
                  root_module:
                    mode === "native-module"
                      ? {
                          child_modules: [
                            {
                              address: "module.api",
                              resources: [{ address: terraformAddress, mode: "managed", values }],
                            },
                          ],
                        }
                      : { resources: [{ address: terraformAddress, mode: "managed", values }] },
                },
              });
            } else throw new Error(`Unexpected fixture command: ${command.executable} ${command.args.join(" ")}`);
            if (
              (command.executable === "bicep" && command.args[0] === "build") ||
              (command.executable === "terraform" && command.args[0] === "show")
            )
              policyOutput = stdout;
            return { exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, outputTruncated: false };
          },
        };
        const currentAuthority = async () => {
          const run = (await service.status()).run;
          const revision = dependencyRevision(run, await journal.replay());
          return {
            head: revision,
            dependencyRevision: revision,
            ownerEpoch: run.ownerEpoch,
            recipientIdentity: "local",
          };
        };
        const makeProvider = () =>
          track === "bicep"
            ? new NativeBicepProvider({
                runner,
                currentAuthority,
                now: () => now,
                bindingStore: runtime.bindingStores.bicep,
                target: {
                  cwd: sourceRoot,
                  templateFile: "main.bicep",
                  resourceGroup: "rg-test",
                  deploymentName: "policy-test",
                  stackName: "policy-test",
                  denySettingsMode: "denyDelete",
                },
              })
            : new NativeTerraformProvider({
                runner,
                currentAuthority,
                now: () => now,
                bindingStore: runtime.bindingStores.terraform,
                artifactStore: runtime.artifactStore,
                keyProvider: runtime.keyProvider,
                target: {
                  cwd: sourceRoot,
                  target: targetScope,
                  lockfileHash: "e".repeat(64),
                  configHash: () => hashTerraformConfiguration(sourceRoot),
                  planPath: () => join(sourceRoot, "policy.tfplan"),
                },
              });
        const nativeService = new ApexService(root, { clock: () => now, providers: { [track]: makeProvider() } });
        const validationTask = await task(nativeService, `validation-${track}`);
        const evidence = [{ kind: "validation-evidence" as const, value: validationEvidence(runId, track) }];
        if (track === "bicep") {
          const head = await journal.head();
          await assert.rejects(
            nativeService.completeTaskOutputs(validationTask, evidence),
            /Native policy property validation failed/,
          );
          assert.equal(await journal.head(), head);
          assert.equal((await nativeService.status()).run.gates[3]!.state, "closed");
        }
        observed = true;
        const diagnostics = await nativeService.validateTask(validationTask);
        assert.equal(diagnostics.valid, false);
        assert.ok(diagnostics.execution!.blockedValidatorIds.includes("business:security-baseline"));
        const diagnosticEvidence = diagnostics.outputs![0]!.value as ReturnType<typeof validationEvidence>;
        const sourceReceipt = await objects.getJson<NativeValidationReceiptV1>(diagnosticEvidence.entries[0]!.hash);
        if (track === "bicep") {
          assert.equal(sourceReceipt.storageSecurity?.api?.fullBaselineEvaluated, false);
          assert.notEqual(sourceReceipt.storageSecurity?.api?.outcome, "pass");
          assert.deepEqual(diagnostics.execution?.storageSecurity, sourceReceipt.storageSecurity);
        } else assert.equal(sourceReceipt.storageSecurity, undefined);
        const beforeIncomplete = await journal.head();
        await assert.rejects(
          nativeService.completeTaskOutputs(validationTask, evidence),
          /Native validation requires executed evidence for every required validator/,
        );
        assert.equal(await journal.head(), beforeIncomplete);
        assert.equal((await nativeService.status()).run.gates[3]!.state, "closed");
        const previewFixture = new ApexService(root, {
          clock: () => now,
          providers: { [track]: Object.assign(makeProvider(), { validationMode: "simulated" as const }) },
        });
        await previewFixture.completeTaskOutputs(validationTask, evidence);
        const validated = (await journal.replay()).findLast(({ type }) => type === "task.completed")!.payload as {
          validatorEvidenceRefs: Record<string, string>;
          validatorEvidenceModes: Record<string, string>;
        };
        const nativeReceipt = await objects.getJson<NativeValidationReceiptV1>(
          validated.validatorEvidenceRefs[NATIVE_VALIDATION_COMMANDS[track][0]!.validatorId]!,
        );
        assert.equal(validated.validatorEvidenceModes["business:security-baseline"], "simulated");
        assert.equal(validated.validatorEvidenceModes["business:logical-resource-parity"], "simulated");
        assert.equal(nativeReceipt.sourceHash, generatedHashes["iac-handoff"]);
        assert.equal(nativeReceipt.policyHash, policyHash);
        for (const { validatorId } of NATIVE_VALIDATION_COMMANDS[track])
          assert.equal(validated.validatorEvidenceModes[validatorId], "native");
        if (track === "bicep") {
          assert.equal(validated.validatorEvidenceModes["business:policy-property-map"], "native");
          assert.equal(nativeReceipt.policyValidation?.outcome, "pass");
          assert.equal(nativeReceipt.policyValidation?.results.length, 3);
          assert.equal(nativeReceipt.policyValidation?.inputHash, sha256Bytes(Buffer.from(policyOutput)));
        } else {
          assert.equal(validated.validatorEvidenceRefs["business:policy-property-map"], undefined);
          assert.equal(nativeReceipt.policyValidation, undefined);
        }
        const productionRestart = new ApexService(root, { clock: () => now, providers: { [track]: makeProvider() } });
        const beforeRestart = await journal.head();
        const commandCount = calls.length;
        await assert.rejects(
          productionRestart.preview({ operation: "apply", provider: track }),
          /native validation for every required validator/,
        );
        assert.equal(await journal.head(), beforeRestart);
        assert.equal(calls.length, commandCount);
        const restarted = new ApexService(root, {
          clock: () => now,
          providers: { [track]: Object.assign(makeProvider(), { validationMode: "simulated" as const }) },
        });
        observed = false;
        const head = await journal.head();
        await assert.rejects(restarted.preview({ operation: "apply", provider: track }), /policy|blocker/i);
        assert.equal(await journal.head(), head);
        assert.equal((await restarted.status()).run.gates[3]!.state, "closed");
        observed = true;
        const preview = await restarted.preview({ operation: "apply", provider: track });
        assert.equal(preview.policyHash, policyHash);
        const created = (await journal.replay()).findLast(({ type }) => type === "preview.created")!;
        const payload = created.payload as {
          policyValidationHash: string;
          evidenceMode: string;
          attestationHash?: string;
        };
        assert.equal(payload.evidenceMode, "native");
        const receipt = await objects.getJson<PolicyValidationV1>(payload.policyValidationHash);
        assert.equal(receipt.sourceHash, generatedHashes["iac-handoff"]);
        assert.equal(receipt.policyMapHash, policyHash);
        assert.equal(receipt.inputHash, sha256Bytes(Buffer.from(policyOutput)));
        assert.equal(receipt.outcome, "pass");
        assert.equal(receipt.results.length, 3);
        assert.deepEqual(
          receipt.results.map(({ policyAssignmentId }) => policyAssignmentId),
          findings.map(({ assignment_id }) => assignment_id),
        );
        if (track === "terraform") assert.ok(payload.attestationHash);
        assert.equal((await restarted.status()).run.gates[3]!.state, "open");
        assert.equal(
          calls.some((command) => /\b(apply|create|delete)\b/.test(command)),
          false,
        );
      } else {
        await service.completeTaskOutputs(generated.taskId, codegenBundle(runId, track, generated.plan));
        await complete(service, `validation-${track}`, [
          { kind: "validation-evidence", value: validationEvidence(runId, track) },
        ]);
        const restarted = new ApexService(root, { clock: () => now });
        const preview = await restarted.preview({ operation: "apply", provider: "fake" });
        assert.equal(preview.policyHash, policyHash);
        await restarted.decideGateNumber(4, "approved", "tester");
        const deployed = await restarted.deploy(preview.previewHash);
        assert.equal(deployed.inventory.resources.length, 1);
        assert.deepEqual(await objects.getJson(policyHash), acceptedPolicy);
      }
      for (const file of await readdir(join(root, ".apex"), { recursive: true, withFileTypes: true })) {
        if (!file.isFile()) continue;
        assert.doesNotMatch(
          await readFile(join(file.parentPath, file.name), "utf8"),
          /UNRELATED_SUBSCRIPTION_SENTINEL|UNSELECTED_BASELINE_MARKER/,
        );
      }
    });
  }

  test(`${track} imports an evidenced-empty standalone baseline through deployment without copying other data`, async () => {
    const root = await tempRoot();
    const subscriptionId = "11111111-1111-1111-1111-111111111111";
    let now = new Date("2026-09-19T00:00:00Z");
    const discoveredAt = new Date(now.getTime() - 29 * 86_400_000).toISOString();
    const baseline = emptyGovernanceBaseline(subscriptionId, discoveredAt);
    const path = join(root, "baseline.json");
    await writeJson(path, baseline);
    const service = new ApexService(root, { clock: () => now });
    const { runId } = await service.init({
      projectId: "demo",
      iacTool: track,
      targetScope: `/subscriptions/${subscriptionId}`,
    });
    await assert.rejects(service.importGovernanceBaseline(path), /active discovery task/);
    const expiry = Date.parse(discoveredAt) + 30 * 86_400_000;
    const codegen = await reachCodegen(
      service,
      runId,
      track,
      async (plan) => {
        const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
        const head = await journal.head();
        now = new Date(expiry);
        await assert.rejects(service.nextTask(), /governance.*refresh/i);
        assert.equal(await journal.head(), head);
        now = new Date(expiry - 1);
        const planTask = await task(service, "plan");
        const issuedHead = await journal.head();
        now = new Date(expiry);
        await assert.rejects(service.taskContext(planTask), /governance.*refresh/i);
        await assert.rejects(service.completeTaskOutputs(planTask, plan), /governance.*refresh/i);
        assert.equal(await journal.head(), issuedHead);
        now = new Date(expiry - 1);
      },
      false,
      path,
      undefined,
      async () => {
        const selected = await service.selectGovernanceBaseline(path);
        assert.equal(selected.status, "needs_input");
        if (selected.status !== "needs_input") throw new Error("Expected governance input");
        assert.deepEqual(selected.request.questions[0]!.options, ["reuse", "refresh"]);
        assert.equal(selected.request.questions[0]!.recommendation?.value, "reuse");
        assert.equal(selected.request.governance?.observedAt, discoveredAt);
        const restarted = new ApexService(root, { clock: () => now });
        assert.deepEqual(await restarted.nextTask(), selected);
        await restarted.recordInput({
          schemaVersion: "1.0.0",
          requestId: selected.request.requestId,
          expectedHead: selected.request.expectedHead,
          ownerEpoch: selected.request.ownerEpoch,
          answers: [{ questionId: selected.request.questions[0]!.id, value: "reuse" }],
        });
        assert.deepEqual(await restarted.selectGovernanceBaseline(path), {
          status: "selected",
          choice: "reuse",
          candidateHash: selected.request.governance!.candidateHash,
          observedAt: discoveredAt,
          refreshRequired: false,
        });
        const answerTime = now;
        const head = await new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal")).head();
        now = new Date(expiry);
        await assert.rejects(restarted.nextTask(), /Governance refresh required/);
        await assert.rejects(restarted.importGovernanceBaseline(path), /Governance refresh required/);
        now = answerTime;
        await writeFile(path, JSON.stringify(baseline));
        await assert.rejects(restarted.importGovernanceBaseline(path), /candidate changed/);
        await assert.rejects(restarted.nextTask(), /candidate changed/);
        await writeJson(path, baseline);
        assert.equal(
          await new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal")).head(),
          head,
        );
      },
    );
    await service.completeTaskOutputs(codegen.taskId, codegenBundle(runId, track, codegen.plan));
    await complete(service, `validation-${track}`, [
      { kind: "validation-evidence", value: validationEvidence(runId, track) },
    ]);
    now = new Date(Date.parse(discoveredAt) + 30 * 86_400_000 - 1);
    const preview = await service.preview({ operation: "apply", provider: "fake" });
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    const head = await journal.head();
    now = new Date(Date.parse(discoveredAt) + 30 * 86_400_000);
    await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /governance.*refresh/i);
    await assert.rejects(service.preview({ operation: "apply", provider: "fake" }), /governance.*refresh/i);
    assert.equal(await journal.head(), head);
    assert.equal((await service.status()).run.gates[3]!.state, "open");
    baseline.subscriptions[subscriptionId]!.discovered_at = now.toISOString();
    baseline.subscriptions[subscriptionId]!.discovery_metadata.discovered_at = now.toISOString();
    const beforeRenewal = (await service.status()).run;
    const beforeEvents = await journal.replay();
    const objectStore = new ObjectStore(root);
    const previewObjectHash = (
      beforeEvents.findLast(({ type }) => type === "preview.created")!.payload as { previewObjectHash: string }
    ).previewObjectHash;
    const storedPreview = await objectStore.getJson<DeploymentPreviewV1>(previewObjectHash);
    const planBytes = await readFile(join(root, ".apex", "projects", "demo", "runs", runId, "run.json"));
    const rejectRenewal = async (changed: typeof baseline, reason: RegExp) => {
      const previousHead = await journal.head();
      await writeJson(path, changed);
      await assert.rejects(service.importGovernanceBaseline(path), reason);
      assert.equal(await journal.head(), previousHead);
      assert.deepEqual((await service.status()).run, beforeRenewal);
    };
    for (const mutate of [
      (value: typeof baseline) => {
        value.subscriptions[subscriptionId]!.irrelevant_metadata = "changed";
      },
      (value: typeof baseline) => {
        Object.assign(value.subscriptions[subscriptionId]!.discovery_metadata, { collector: "changed" });
      },
      (value: typeof baseline) => {
        Object.assign(value.subscriptions[subscriptionId]!.discovery_summary, { audit_notes: "changed" });
      },
      (value: typeof baseline) => {
        const entry = value.subscriptions[subscriptionId]!;
        const finding = {
          policy_id: "audit-policy",
          display_name: "Audit",
          effect: "audit",
          scope: `/subscriptions/${subscriptionId}`,
          assignment_id: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyAssignments/audit`,
          classification: "informational",
          resource_types: [],
          exemption: null,
          reported_exemptions: [],
        };
        Object.assign(entry, {
          findings: [finding],
          policies: [finding],
          assignment_inventory: [
            {
              scope: `/subscriptions/${subscriptionId}`,
              assignmentType: "subscription",
              displayName: "audit",
              policyDefinitionId: "audit-policy",
              assignmentId: finding.assignment_id,
            },
          ],
        });
        Object.assign(entry.discovery_summary, {
          assignment_total: 1,
          assignment_kept: 1,
          subscription_scope_count: 1,
          audit_count: 1,
          informational_count: 1,
          classified_policy_count: 1,
        });
        value.summary.total_findings = 1;
        entry.discovery_metadata.page_counts.policyAssignments = 1;
      },
    ]) {
      const changed = structuredClone(baseline);
      mutate(changed);
      await rejectRenewal(changed, /content changed.*reconcile/i);
    }
    const incomplete = structuredClone(baseline);
    for (const requiredValue of [true, false]) {
      const changed = structuredClone(baseline);
      const entry = changed.subscriptions[subscriptionId]!;
      const finding = {
        policy_id: "policy",
        display_name: "Policy",
        effect: "deny",
        scope: `/subscriptions/${subscriptionId}`,
        assignment_id: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyAssignments/policy`,
        classification: "blocker",
        resource_types: ["Microsoft.Storage/storageAccounts"],
        exemption: null,
        required_value: requiredValue,
        reported_exemptions: [],
      };
      Object.assign(entry, {
        findings: [finding],
        policies: [finding],
        assignment_inventory: [
          {
            scope: finding.scope,
            assignmentId: finding.assignment_id,
            assignmentType: "subscription",
            displayName: "Policy",
            policyDefinitionId: "policy",
          },
        ],
      });
      Object.assign(entry.discovery_summary, {
        assignment_total: 1,
        assignment_kept: 1,
        subscription_scope_count: 1,
        blocker_count: 1,
        classified_policy_count: 1,
      });
      entry.discovery_metadata.page_counts.policyAssignments = 1;
      changed.summary.total_findings = 1;
      changed.summary.total_blockers = 1;
      await rejectRenewal(changed, /content changed.*reconcile/i);
    }
    incomplete.coverage_status = "PARTIAL";
    await rejectRenewal(incomplete, /incomplete|invalid-input/);
    const wrongTarget = structuredClone(baseline);
    wrongTarget.subscriptions[subscriptionId]!.discovery_metadata.scope.subscription_id =
      "22222222-2222-2222-2222-222222222222";
    await rejectRenewal(wrongTarget, /target-mismatch/);
    for (const invalidTime of [discoveredAt, new Date(now.getTime() + 1).toISOString()]) {
      const invalid = structuredClone(baseline);
      invalid.subscriptions[subscriptionId]!.discovered_at = invalid.subscriptions[
        subscriptionId
      ]!.discovery_metadata.discovered_at = invalidTime;
      await rejectRenewal(invalid, /stale/);
    }
    await writeJson(path, baseline);
    const renewed = await service.importGovernanceBaseline(path);
    const afterEvents = await journal.replay();
    assert.equal(afterEvents.length, beforeEvents.length + 1);
    assert.equal(afterEvents.at(-1)!.type, "governance.observation-renewed");
    assert.notEqual(await journal.head(), head);
    assert.equal(dependencyRevision(beforeRenewal, afterEvents), dependencyRevision(beforeRenewal, beforeEvents));
    assert.deepEqual((await service.status()).run, beforeRenewal);
    assert.deepEqual(await readFile(join(root, ".apex", "projects", "demo", "runs", runId, "run.json")), planBytes);
    assert.deepEqual(await objectStore.getJson(previewObjectHash), storedPreview);
    const receiptHash = (afterEvents.at(-1)!.payload as { receiptHash: string }).receiptHash;
    const receipt = await objectStore.getJson<Record<string, string>>(receiptHash);
    assert.equal(receipt.governanceHash, renewed.outputHash);
    assert.equal(receipt.observedAt, now.toISOString());
    assert.equal(receipt.projectId, "demo");
    assert.equal(receipt.runId, runId);
    assert.equal(receipt.targetScope, beforeRenewal.targetScope);
    assert.equal(receipt.rawSourceDigest, sha256Bytes(await readFile(path)));
    assert.equal(Date.parse(receipt.expiresAt!) - Date.parse(receipt.observedAt!), 30 * 86_400_000);
    const acceptedGovernance = await objectStore.getJson<GovernanceConstraintsV1>(renewed.outputHash);
    assert.equal(receipt.snapshotDigest, acceptedGovernance.constraintsRef.digest);
    const acceptedSnapshot = await objectStore.getJson<Record<string, unknown>>(receipt.snapshotDigest!);
    assert.equal(receipt.contentHash, acceptedSnapshot.contentHash);
    const renewedHead = await journal.head();
    const restarted = new ApexService(root, { clock: () => now });
    assert.equal((await restarted.importGovernanceBaseline(path)).outputHash, renewed.outputHash);
    assert.equal(await journal.head(), renewedHead);
    const older = structuredClone(baseline);
    older.subscriptions[subscriptionId]!.discovered_at = older.subscriptions[
      subscriptionId
    ]!.discovery_metadata.discovered_at = new Date(now.getTime() - 1).toISOString();
    await writeJson(path, older);
    await assert.rejects(restarted.importGovernanceBaseline(path), /newer successful/);
    assert.equal(await journal.head(), renewedHead);
    await writeFile(path, JSON.stringify(baseline));
    await assert.rejects(restarted.importGovernanceBaseline(path), /newer successful/);
    assert.equal(await journal.head(), renewedHead);
    const renewalTime = now.getTime();
    now = new Date(renewalTime + 30 * 86_400_000);
    await assert.rejects(restarted.preview({ operation: "apply", provider: "fake" }), /governance.*refresh/i);
    await assert.rejects(restarted.importGovernanceBaseline(path), /stale/);
    assert.equal(await journal.head(), renewedHead);
    now = new Date(renewalTime);
    await restarted.decideGateNumber(4, "approved", "tester");
    const approvedRun = (await restarted.status()).run;
    const currentChoice = await restarted.selectGovernanceBaseline(path);
    if (currentChoice.status !== "needs_input") throw new Error("Expected existing observation choice");
    await restarted.recordInput({
      schemaVersion: "1.0.0",
      requestId: currentChoice.request.requestId,
      expectedHead: currentChoice.request.expectedHead,
      ownerEpoch: currentChoice.request.ownerEpoch,
      answers: [{ questionId: currentChoice.request.questions[0]!.id, value: "reuse" }],
    });
    const beforeReuse = await journal.replay();
    assert.equal((await restarted.importGovernanceBaseline(path)).outputHash, renewed.outputHash);
    const afterReuse = await journal.replay();
    assert.equal(afterReuse.length, beforeReuse.length + 1);
    assert.equal(afterReuse.at(-1)!.type, "governance.selection-applied");
    assert.equal(
      afterReuse.filter(({ type }) => type === "governance.observation-renewed").length,
      beforeReuse.filter(({ type }) => type === "governance.observation-renewed").length,
    );
    assert.deepEqual((await restarted.status()).run, approvedRun);
    await writeJson(path, baseline);
    const acceptedChoice = await restarted.selectGovernanceBaseline(path);
    if (acceptedChoice.status !== "needs_input") throw new Error("Expected accepted-run refresh choice");
    await restarted.recordInput({
      schemaVersion: "1.0.0",
      requestId: acceptedChoice.request.requestId,
      expectedHead: acceptedChoice.request.expectedHead,
      ownerEpoch: acceptedChoice.request.ownerEpoch,
      answers: [{ questionId: acceptedChoice.request.questions[0]!.id, value: "refresh" }],
    });
    const acceptedChoiceHead = await journal.head();
    await assert.rejects(restarted.nextTask(), /Governance refresh required/);
    await assert.rejects(restarted.importGovernanceBaseline(path), /Governance refresh required/);
    assert.equal(await journal.head(), acceptedChoiceHead);
    now = new Date(renewalTime + 1);
    baseline.subscriptions[subscriptionId]!.discovered_at = baseline.subscriptions[
      subscriptionId
    ]!.discovery_metadata.discovered_at = now.toISOString();
    await writeJson(path, baseline);
    await restarted.importGovernanceBaseline(path);
    const refreshEvents = await journal.replay();
    const renewal = refreshEvents.at(-1)!;
    assert.equal(renewal.type, "governance.observation-renewed");
    const renewedSelection = renewal.payload as Record<string, string>;
    assert.equal(renewedSelection.selectionRequestId, acceptedChoice.request.requestId);
    assert.equal(renewedSelection.selectedPath, "baseline.json");
    assert.equal(renewedSelection.rawSourceDigest, sha256Bytes(await readFile(path)));
    assert.notEqual(renewedSelection.rawSourceDigest, acceptedChoice.request.governance!.candidateHash);
    assert.equal((await restarted["governanceInputState"](approvedRun, refreshEvents))?.fulfilled, true);
    for (const changes of [
      { selectionRequestId: "unrelated" },
      { selectedPath: "other.json" },
      { rawSourceDigest: acceptedChoice.request.governance!.candidateHash },
      { rawSourceDigest: "a".repeat(64) },
      { observedAt: acceptedChoice.request.governance!.observedAt },
      { governanceHash: "b".repeat(64) },
    ]) {
      const altered = [...refreshEvents.slice(0, -1), { ...renewal, payload: { ...renewedSelection, ...changes } }];
      assert.equal((await restarted["governanceInputState"](approvedRun, altered))?.fulfilled, false);
    }
    assert.deepEqual((await restarted.status()).run, approvedRun);
    const approvedHead = await journal.head();
    now = new Date(storedPreview.expiresAt);
    await assert.rejects(restarted.deploy(preview.previewHash), /preview has expired/i);
    assert.equal(await journal.head(), approvedHead);
    now = new Date(renewalTime + 1);
    const runPath = join(root, ".apex", "projects", "demo", "runs", runId, "run.json");
    await writeJson(runPath, { ...approvedRun, ownerEpoch: approvedRun.ownerEpoch + 1 });
    await assert.rejects(restarted.importGovernanceBaseline(path), /writer authority/i);
    await assert.rejects(restarted.deploy(preview.previewHash), /writer authority|epoch/i);
    assert.equal(await journal.head(), approvedHead);
    await writeJson(runPath, approvedRun);
    const deployed = await restarted.deploy(preview.previewHash);
    assert.equal(deployed.inventory.resources.length, 1);
    const diagnosisId = await task(restarted, "diagnosis");
    const taskPath = join(root, ".apex", "projects", "demo", "runs", runId, "tasks", `${diagnosisId}.json`);
    const originalTask = await readFile(taskPath);
    now = new Date(renewalTime + 2 * 86_400_000);
    baseline.subscriptions[subscriptionId]!.discovered_at = baseline.subscriptions[
      subscriptionId
    ]!.discovery_metadata.discovered_at = now.toISOString();
    await writeJson(path, baseline);
    const beforeRace = await journal.replay();
    const competing = await Promise.allSettled([
      restarted.importGovernanceBaseline(path),
      new ApexService(root, { clock: () => now }).importGovernanceBaseline(path),
    ]);
    assert.ok(competing.some(({ status }) => status === "fulfilled"));
    for (const result of competing) {
      if (result.status === "fulfilled") assert.equal(result.value.outputHash, renewed.outputHash);
      else assert.match(String(result.reason), /stale journal head|mutation is already in progress/i);
    }
    assert.equal((await journal.replay()).length, beforeRace.length + 1);
    assert.deepEqual(await readFile(taskPath), originalTask);
    await assert.rejects(restarted.taskContext(diagnosisId), /expired|stale|head/i);
    const appendEvidence = async (type: string, payload: { [key: string]: string | { [key: string]: string } }) =>
      journal.append({
        eventId: crypto.randomUUID(),
        projectId: "demo",
        runId,
        type,
        timestamp: now.toISOString(),
        ownerEpoch: approvedRun.ownerEpoch,
        expectedHead: await journal.head(),
        payload,
      });
    const replaceGovernance = async (
      snapshot: Record<string, unknown>,
      extra: Partial<GovernanceConstraintsV1> = {},
    ) => {
      const digest = await objectStore.putJson(snapshot);
      const changedHash = await objectStore.putJson({
        ...acceptedGovernance,
        ...extra,
        constraintsRef: {
          ...acceptedGovernance.constraintsRef,
          digest,
          uri: `apex-object:${digest}`,
          bytes: (await objectStore.getBytes(digest)).byteLength,
        },
      });
      await appendEvidence("task.completed", { artifactHashes: { "governance-constraints": changedHash } });
      return changedHash;
    };
    const changedHash = await replaceGovernance(acceptedSnapshot, {
      summary: { ...acceptedGovernance.summary, auditCount: 1 },
    });
    const replacedHead = await journal.head();
    await assert.rejects(restarted.preview({ operation: "apply", provider: "fake" }), /governance.*refresh/i);
    assert.equal(await journal.head(), replacedHead);
    await appendEvidence("governance.observation-renewed", { governanceHash: changedHash, receiptHash });
    const mismatchedHead = await journal.head();
    await assert.rejects(restarted.preview({ operation: "apply", provider: "fake" }), /receipt.*match/i);
    assert.equal(await journal.head(), mismatchedHead);
    const legacySnapshot = { ...acceptedSnapshot };
    delete legacySnapshot.contentHash;
    await replaceGovernance(legacySnapshot);
    const legacyHead = await journal.head();
    await assert.rejects(restarted.importGovernanceBaseline(path), /start a new run/i);
    assert.equal(await journal.head(), legacyHead);
    await replaceGovernance({ ...acceptedSnapshot, allowedLocations: ["changed"] });
    const semanticHead = await journal.head();
    await assert.rejects(restarted.importGovernanceBaseline(path), /content changed.*reconcile/i);
    assert.equal(await journal.head(), semanticHead);
    await replaceGovernance({ ...acceptedSnapshot, runId: "foreign-run" });
    const foreignHead = await journal.head();
    await assert.rejects(restarted.importGovernanceBaseline(path), /does not belong/i);
    assert.equal(await journal.head(), foreignHead);
    for (const file of await readdir(join(root, ".apex"), { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue;
      assert.equal(
        (await readFile(join(file.parentPath, file.name), "utf8")).includes("UNSELECTED_BASELINE_MARKER"),
        false,
      );
    }
  });
}

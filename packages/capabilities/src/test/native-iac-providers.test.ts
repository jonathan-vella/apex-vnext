import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { sha256 } from "../iac.js";
import { Value } from "@sinclair/typebox/value";
import { FormatRegistry } from "@sinclair/typebox";
import {
  ExecutionPlanAttestationV1Schema,
  NativeValidationReceiptV1Schema,
  NATIVE_VALIDATION_COMMANDS,
  calculateNativeValidationCommandHash,
  calculateNativeValidationReceiptHash,
  hasValidNativeValidationReceipt,
  calculatePolicyValidationHash,
  calculatePolicyValidationDigest,
  hasValidPolicyValidation,
  type ApprovalEvidenceV1,
  type DeploymentPreviewV1,
  type PolicyValidationV1,
  type PolicyPropertyMapV1,
  type IacBindingV1,
  type LogicalResourceManifestV1,
} from "@apexops/contracts";
import {
  IacOutputParseError,
  IacProviderError,
  LocalEncryptedPlanTransport,
  NativeBicepProvider,
  NativeTerraformProvider,
  ProcessRunner,
  nativePolicyValidationBinding,
  normalizeAzureWhatIf,
  normalizeTerraformPlan,
  selectAzureDeploymentStack,
  type CurrentDeploymentAuthority,
  type NativeValidationRequest,
  type PreviewRequest,
  type ProcessRequest,
  type ProcessResult,
  type ProcessRunnerLike,
  type LocalEncryptedPlan,
  type PersistedPreviewBinding,
  type TerraformNativeTarget,
} from "../index.js";

const hashes = {
  head: "a".repeat(64),
  input: "b".repeat(64),
  iac: "c".repeat(64),
  policy: "d".repeat(64),
  lock: "e".repeat(64),
};
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));
}
const clock = { value: new Date("2026-07-13T01:00:00.000Z") };
const authority: CurrentDeploymentAuthority = {
  head: hashes.head,
  dependencyRevision: hashes.head,
  ownerEpoch: 3,
  recipientIdentity: "writer@example.com",
};

function request(overrides: Partial<PreviewRequest> = {}): PreviewRequest {
  return {
    projectId: "project",
    runId: "run",
    environment: "dev",
    target: "/subscriptions/sub/resourceGroups/rg",
    commit: hashes.head,
    dependencyRevision: hashes.head,
    ownerEpoch: 3,
    inputHash: hashes.input,
    iacHash: hashes.iac,
    policyHash: hashes.policy,
    resources: [],
    ttlMs: 60_000,
    ...overrides,
  };
}

function approval(preview: DeploymentPreviewV1): ApprovalEvidenceV1 {
  return {
    schemaVersion: "1.0.0",
    projectId: preview.projectId,
    runId: preview.runId,
    gate: 4,
    decision: "approved",
    actor: "approver@example.com",
    mechanism: "tty",
    dependencyHash: preview.previewHash,
    previewHash: preview.previewHash,
    writerEpoch: authority.ownerEpoch,
    recipientIdentity: authority.recipientIdentity,
    decidedAt: clock.value.toISOString(),
    expiresAt: "2026-07-13T02:00:00.000Z",
  };
}

class FakeRunner implements ProcessRunnerLike {
  readonly requests: ProcessRequest[] = [];
  constructor(private readonly respond: (request: ProcessRequest) => Promise<string> | string) {}

  async run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    return {
      exitCode: 0,
      signal: null,
      stdout: await this.respond(request),
      stderr: "",
      timedOut: false,
      outputTruncated: false,
    };
  }
}

class MemoryBindingStore {
  readonly values = new Map<string, PersistedPreviewBinding>();
  readonly latest = new Map<string, PersistedPreviewBinding>();
  async save(previewHash: string, binding: PersistedPreviewBinding): Promise<void> {
    this.values.set(previewHash, binding);
    this.latest.set(
      `${binding.preview.projectId}\u0000${binding.preview.runId}\u0000${binding.preview.operation}`,
      binding,
    );
  }
  async load(previewHash: string): Promise<PersistedPreviewBinding | undefined> {
    return this.values.get(previewHash);
  }
  async loadLatest(
    projectId: string,
    runId: string,
    operation: "apply" | "destroy",
  ): Promise<PersistedPreviewBinding | undefined> {
    return this.latest.get(`${projectId}\u0000${runId}\u0000${operation}`);
  }
}

class MemoryArtifactStore {
  readonly values = new Map<string, LocalEncryptedPlan>();
  async put(reference: string, artifact: LocalEncryptedPlan): Promise<void> {
    this.values.set(reference, artifact);
  }
  async get(reference: string): Promise<LocalEncryptedPlan | undefined> {
    return this.values.get(reference);
  }
}

async function nativePolicyFixture(context: TestContext, track: "bicep" | "terraform") {
  const root = await mkdtemp(join(tmpdir(), `apex-native-policy-${track}-`));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const sourceFile = track === "bicep" ? "main.bicep" : "main.tf";
  const content = track === "bicep" ? "targetScope = 'resourceGroup'\n" : "terraform {}\n";
  await writeFile(join(root, sourceFile), content);
  const generatedSource = { rootPath: root, treeHash: sha256([{ path: sourceFile, content }]) };
  const source = {
    value: "native-value-must-not-leak",
    invalid: false,
    unknown: false,
    compileFailed: false,
    complete: true,
    configHash: hashes.iac,
    duringPreview: undefined as (() => Promise<void>) | undefined,
    duringShow: undefined as (() => Promise<void>) | undefined,
    duringInit: undefined as (() => Promise<void>) | undefined,
    duringCommand: undefined as ((process: ProcessRequest) => Promise<void>) | undefined,
  };
  const json = () =>
    source.invalid
      ? "{}"
      : JSON.stringify(
          track === "bicep"
            ? { resources: { storage: { properties: { security: source.value } } } }
            : {
                complete: source.complete,
                resource_changes: [
                  {
                    address: "azurerm_storage_account.main",
                    mode: "managed",
                    change: {
                      actions: ["create"],
                      before: null,
                      after: { properties: { security: source.value } },
                      after_unknown: { properties: { security: source.unknown } },
                    },
                  },
                ],
                planned_values: {
                  root_module: {
                    resources: [
                      {
                        address: "azurerm_storage_account.main",
                        mode: "managed",
                        values: { properties: { security: source.value } },
                      },
                    ],
                  },
                },
              },
        );
  const runner = new FakeRunner(async (process) => {
    await source.duringCommand?.(process);
    if (process.executable === "bicep") {
      if (process.args[0] === "format" || process.args[0] === "lint") {
        const command = NATIVE_VALIDATION_COMMANDS.bicep.find(({ args }) => args[0] === process.args[0]);
        assert.deepEqual(process.args, command?.args);
        return "";
      }
      assert.deepEqual(process.args, ["build", "main.bicep", "--stdout"]);
      if (source.compileFailed) throw new Error("compiler diagnostic containing private source");
      return json();
    }
    if (process.args.includes("what-if")) {
      await source.duringPreview?.();
      return JSON.stringify({ changes: [{ resourceId: "/storage", changeType: "Create" }] });
    }
    if (process.args[2] === "list") return "[]";
    if (process.args[0] === "init") await source.duringInit?.();
    const outputArg = process.args.find((argument) => argument.startsWith("-out="));
    if (outputArg !== undefined) {
      await writeFile(outputArg.slice(5), "actual-saved-plan", { mode: 0o600 });
      await source.duringPreview?.();
    }
    if (process.args[0] === "show") {
      await source.duringShow?.();
      return json();
    }
    if (process.args[0] === "state") return JSON.stringify({ lineage: "policy-state", serial: 1 });
    return "";
  });
  const bindings = new MemoryBindingStore();
  const artifacts = new MemoryArtifactStore();
  const runtime = {
    runner,
    bindingStore: bindings,
    currentAuthority: async () => authority,
    now: () => clock.value,
  };
  const makeProvider = (
    options: { cwd?: string; templateFile?: string; parametersFile?: string; planPath?: string } = {},
  ) =>
    track === "bicep"
      ? new NativeBicepProvider({
          ...runtime,
          target: {
            cwd: options.cwd ?? root,
            resourceGroup: "rg",
            deploymentName: "preview",
            stackName: "workload",
            templateFile: options.templateFile ?? "main.bicep",
            ...(options.parametersFile === undefined ? {} : { parametersFile: options.parametersFile }),
            denySettingsMode: "denyDelete",
          },
        })
      : new NativeTerraformProvider({
          ...runtime,
          artifactStore: artifacts,
          keyProvider: async () => Buffer.alloc(32, 9),
          target: {
            cwd: options.cwd ?? root,
            target: "dev",
            planPath: () => options.planPath ?? join(root, "policy.tfplan"),
            configHash: async () => source.configHash,
            lockfileHash: hashes.lock,
          },
        });
  const policyRequest = request({
    policyValidation: {
      policyMap: {
        schemaVersion: "1.0.0",
        projectId: "project",
        runId: "run",
        governanceHash: hashes.policy,
        mappings: (["deny", "modify", "deployIfNotExists"] as const).map((effect) => ({
          policyAssignmentId: "/assignments/baseline",
          effect,
          logicalResourceId: "storage",
          propertyPath: "properties.security",
          expectedValue: "native-value-must-not-leak",
          disposition: "planned",
        })),
      },
      logicalResourceManifest: { storage: { codeSymbol: "storage", terraformAddress: "azurerm_storage_account.main" } },
    },
  });
  const executed = () => runner.requests.some((entry) => entry.args[0] === "apply" || entry.args[2] === "create");
  return {
    root,
    sourceFile,
    generatedSource,
    source,
    json,
    runner,
    bindings,
    artifacts,
    makeProvider,
    policyRequest,
    executed,
  };
}

function rehashPolicy(receipt: PolicyValidationV1): PolicyValidationV1 {
  const { receiptHash: previousHash, ...body } = receipt;
  assert.ok(previousHash);
  return { ...body, receiptHash: calculatePolicyValidationHash(body) };
}

for (const track of ["bicep", "terraform"] as const) {
  test(`native ${track} preview snapshots policy inputs before awaited commands`, async (context) => {
    for (const phase of ["init", "show"] as const) {
      for (const mutation of ["value", "mappings", "binding"] as const) {
        await context.test(`${phase}: ${mutation}`, async (child) => {
          const fixture = await nativePolicyFixture(child, track);
          const input = fixture.policyRequest.policyValidation!;
          const originalMapHash = sha256(input.policyMap);
          const originalManifestHash = sha256(input.logicalResourceManifest);
          fixture.source.value = "actual-private-mismatch";
          const mutate = async () => {
            if (mutation === "value") {
              for (const mapping of input.policyMap.mappings) mapping.expectedValue = fixture.source.value;
            } else if (mutation === "mappings") {
              input.policyMap.mappings.length = 0;
            } else {
              delete input.logicalResourceManifest.storage;
            }
          };
          if (track === "bicep")
            fixture.source.duringCommand = async (command) => {
              if (phase === "init" ? command.args.includes("what-if") : command.args[0] === "build") await mutate();
            };
          else if (phase === "init") fixture.source.duringInit = mutate;
          else fixture.source.duringShow = mutate;
          const provider = fixture.makeProvider();
          const preview = await provider.previewApply(fixture.policyRequest);
          const receipt = provider.policyValidation(preview.previewHash);
          assert.ok(receipt);
          assert.equal(receipt.policyMapContentHash, originalMapHash);
          assert.equal(receipt.logicalResourceManifestHash, originalManifestHash);
          assert.equal(receipt.outcome, "fail");
          assert.equal(receipt.results.length, 3);
          assert.ok(receipt.results.every(({ reason }) => reason === "value-mismatch"));
          assert.equal(preview.blockers.length, 3);
          await assert.rejects(provider.apply(preview, approval(preview), authority), { code: "PREVIEW_BLOCKED" });
          assert.equal(fixture.executed(), false);
        });
      }
    }
  });

  test(`native ${track} preview bounds policy inputs before commands`, async (context) => {
    const fixture = await nativePolicyFixture(context, track);
    fixture.policyRequest.policyValidation!.policyMap.mappings[0]!.expectedValue = Array(100_001).fill(null);
    await assert.rejects(fixture.makeProvider().previewApply(fixture.policyRequest), {
      code: "PREVIEW_HASH_MISMATCH",
      message: `${track === "bicep" ? "Bicep" : "Terraform"} policy validation inputs are invalid`,
    });
    assert.equal(fixture.runner.requests.length, 0);
    assert.equal(fixture.bindings.values.size, 0);
  });
}

test("native terraform validateSource leaves accepted source pristine for fresh validation and preview", async (context) => {
  const fixture = await nativePolicyFixture(context, "terraform");
  const provider = fixture.makeProvider();
  const input: NativeValidationRequest = {
    projectId: "project",
    runId: "run",
    sourceHash: hashes.iac,
    generatedSource: fixture.generatedSource,
    policyHash: hashes.policy,
    inputHash: hashes.input,
  };
  fixture.source.duringCommand = async (process) => {
    if (process.args[0] !== "init") return;
    await mkdir(join(process.cwd!, ".terraform"), { recursive: true });
    await writeFile(join(process.cwd!, ".terraform", "provider"), Buffer.from([0xff, 0xfe]));
    await writeFile(join(process.cwd!, ".terraform.lock.hcl"), "new native lock");
  };
  const receipt = await provider.validateSource(input);
  assert.deepEqual(await provider.validateSource(input), receipt);
  assert.equal(fixture.runner.requests.length, 6);
  assert.deepEqual(await fixture.makeProvider().validateSource(input), receipt);
  const scratchRoots = new Set(fixture.runner.requests.map(({ cwd }) => cwd!));
  assert.equal(scratchRoots.size, 3);
  for (const root of scratchRoots) {
    assert.notEqual(root, fixture.root);
    await assert.rejects(stat(root), { code: "ENOENT" });
    assert.equal(JSON.stringify(receipt).includes(root), false);
  }
  assert.deepEqual(await readdir(fixture.root), [fixture.sourceFile]);
  assert.equal(await readFile(join(fixture.root, fixture.sourceFile), "utf8"), "terraform {}\n");
  fixture.source.duringCommand = undefined;
  await fixture.makeProvider().previewApply(request({ generatedSource: fixture.generatedSource }));
  assert.deepEqual(await readdir(fixture.root), [fixture.sourceFile]);
  const previous = fixture.runner.requests.length;
  await writeFile(join(fixture.root, ".unexpected"), "hidden-source-change");
  await assert.rejects(provider.validateSource(input), { code: "PREVIEW_HASH_MISMATCH" });
  assert.equal(fixture.runner.requests.length, previous);
});

test("native terraform validateSource does not trust unknown, failed, or mistyped outputs", async (context) => {
  for (const scenario of [
    "preexisting-cache",
    "preexisting-lock",
    "later-cache",
    "later-lock",
    "failed-init",
    "cache-file",
    "lock-directory",
    "cache-symlink",
  ] as const) {
    await context.test(scenario, async (child) => {
      const fixture = await nativePolicyFixture(child, "terraform");
      const provider = fixture.makeProvider();
      const input: NativeValidationRequest = {
        projectId: "project",
        runId: "run",
        sourceHash: hashes.iac,
        generatedSource: fixture.generatedSource,
        policyHash: hashes.policy,
        inputHash: hashes.input,
      };
      const cache = join(fixture.root, ".terraform");
      const lock = join(fixture.root, ".terraform.lock.hcl");
      if (scenario.startsWith("later-")) await provider.validateSource(input);
      if (scenario.endsWith("cache")) await mkdir(cache);
      if (scenario.endsWith("lock")) await writeFile(lock, "untrusted native lock");
      if (scenario === "failed-init") {
        fixture.source.duringInit = async () => {
          await mkdir(cache);
          throw new Error("private-init-failure");
        };
        await assert.rejects(provider.validateSource(input), { code: "PREVIEW_HASH_MISMATCH" });
        fixture.source.duringInit = undefined;
      }
      if (scenario === "cache-file")
        fixture.source.duringInit = async () => {
          await writeFile(cache, "not a cache directory");
        };
      if (scenario === "lock-directory")
        fixture.source.duringInit = async () => {
          await mkdir(lock);
        };
      if (scenario === "cache-symlink")
        fixture.source.duringInit = async () => {
          await symlink(fixture.root, cache);
        };
      const previous = fixture.runner.requests.length;
      await assert.rejects(provider.validateSource(input), { code: "PREVIEW_HASH_MISMATCH" });
      if (!["cache-file", "lock-directory", "cache-symlink"].includes(scenario))
        assert.equal(fixture.runner.requests.length, previous);
    });
  }
});

test("native terraform validateSource rejects malformed scratch outputs and cleans failed init", async (context) => {
  for (const scenario of [
    "cache-file",
    "lock-directory",
    "cache-symlink",
    "lock-symlink",
    "lock-hardlink",
    "failed-init",
  ] as const) {
    await context.test(scenario, async (child) => {
      const fixture = await nativePolicyFixture(child, "terraform");
      fixture.source.duringCommand = async (process) => {
        if (process.args[0] !== "init") return;
        const cache = join(process.cwd!, ".terraform");
        const lock = join(process.cwd!, ".terraform.lock.hcl");
        if (scenario === "cache-file") await writeFile(cache, "not a cache directory");
        if (scenario === "lock-directory") await mkdir(lock);
        if (scenario === "cache-symlink") await symlink(fixture.root, cache);
        if (scenario === "lock-symlink") await symlink(join(fixture.root, fixture.sourceFile), lock);
        if (scenario === "lock-hardlink") await link(join(process.cwd!, fixture.sourceFile), lock);
        if (scenario === "failed-init") {
          await mkdir(cache);
          await writeFile(join(cache, "provider"), Buffer.from([0xff]));
          await writeFile(lock, "new native lock");
          throw new Error(`private-init-failure ${process.cwd}`);
        }
      };
      await assert.rejects(
        fixture.makeProvider().validateSource({
          projectId: "project",
          runId: "run",
          sourceHash: hashes.iac,
          generatedSource: fixture.generatedSource,
          policyHash: hashes.policy,
          inputHash: hashes.input,
        }),
        { code: scenario === "failed-init" ? "NATIVE_VALIDATION_FAILED" : "PREVIEW_HASH_MISMATCH" },
      );
      assert.equal(fixture.runner.requests.length, 1);
      await assert.rejects(stat(fixture.runner.requests[0]!.cwd!), { code: "ENOENT" });
      assert.deepEqual(await readdir(fixture.root), [fixture.sourceFile]);
      assert.equal(await readFile(join(fixture.root, fixture.sourceFile), "utf8"), "terraform {}\n");
    });
  }
});

for (const location of ["original", "scratch"] as const) {
  test(`native terraform validateSource preserves accepted lockfiles in ${location}`, async (context) => {
    for (const mutation of ["none", "init", "fmt", "validate"] as const) {
      await context.test(mutation, async (child) => {
        const fixture = await nativePolicyFixture(child, "terraform");
        const lockContent = "accepted native lock";
        await writeFile(join(fixture.root, ".terraform.lock.hcl"), lockContent);
        const files = [
          { path: ".terraform.lock.hcl", content: lockContent },
          { path: fixture.sourceFile, content: await readFile(join(fixture.root, fixture.sourceFile), "utf8") },
        ].sort((left, right) => left.path.localeCompare(right.path));
        const input: NativeValidationRequest = {
          projectId: "project",
          runId: "run",
          sourceHash: hashes.iac,
          generatedSource: { rootPath: fixture.root, treeHash: sha256(files) },
          policyHash: hashes.policy,
          inputHash: hashes.input,
        };
        fixture.source.duringCommand = async (process) => {
          const root = location === "original" ? fixture.root : process.cwd!;
          assert.equal(await readFile(join(process.cwd!, ".terraform.lock.hcl"), "utf8"), lockContent);
          if (process.args[0] === mutation) await writeFile(join(root, ".terraform.lock.hcl"), "changed lock");
        };
        const provider = fixture.makeProvider();
        if (mutation === "none") {
          const receipt = await provider.validateSource(input);
          assert.deepEqual(await provider.validateSource(input), receipt);
        } else {
          await assert.rejects(provider.validateSource(input), { code: "PREVIEW_HASH_MISMATCH" });
        }
      });
    }
  });
}

test("installed Bicep validates nested formatting and lint without changing accepted source", async (context) => {
  const runner = new ProcessRunner();
  try {
    await runner.run({ executable: "bicep", args: ["--version"], timeoutMs: 10_000, maxOutputBytes: 4096 });
  } catch (error) {
    if ((error as { code?: string }).code === "PROCESS_SPAWN_ERROR") {
      context.skip("Bicep is not installed");
      return;
    }
    throw error;
  }
  for (const scenario of [
    "pass",
    "format-drift",
    "lint-error",
    "policy-pass",
    "policy-mismatch",
    "module-pass",
    "module-mismatch",
    "diagnostics-pass",
  ] as const) {
    await context.test(scenario, async (child) => {
      const root = await mkdtemp(join(tmpdir(), "apex-real-bicep-validation-"));
      child.after(() => rm(root, { recursive: true, force: true }));
      const checkModule = scenario.startsWith("module-");
      const checkDiagnostics = scenario === "diagnostics-pass";
      const checkPolicy = scenario.startsWith("policy-") || checkModule || checkDiagnostics;
      const workspaceResourceId =
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-fixture/providers/Microsoft.OperationalInsights/workspaces/log-fixture";
      const files = [
        {
          path: "main.bicep",
          content: checkPolicy
            ? "resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {\n  name: 'apexpolicytest'\n  location: 'swedencentral'\n  kind: 'StorageV2'\n  sku: {\n    name: 'Standard_LRS'\n  }\n  properties: {\n    supportsHttpsTrafficOnly: true\n    minimumTlsVersion: 'TLS1_2'\n    allowBlobPublicAccess: false\n    allowSharedKeyAccess: false\n  }\n}\n"
            : "output result string = 'ok'\n",
        },
        {
          path: "modules/nested.bicep",
          content:
            scenario === "format-drift"
              ? "output result string='ok'\n"
              : scenario === "lint-error"
                ? "param unused string = 'value'\n"
                : "output result string = 'nested'\n",
        },
        {
          path: "bicepconfig.json",
          content: JSON.stringify({
            experimentalFeaturesEnabled: { symbolicNameCodegen: true },
            analyzers: { core: { rules: { "no-unused-params": { level: "error" } } } },
          }),
        },
      ].sort((left, right) => left.path.localeCompare(right.path));
      if (checkModule) {
        const main = files.find(({ path }) => path === "main.bicep")!;
        files.find(({ path }) => path === "modules/nested.bicep")!.content = main.content;
        main.content = "module storageModule 'modules/nested.bicep' = {\n  name: 'storage-module'\n}\n";
      }
      if (checkDiagnostics) {
        const main = files.find(({ path }) => path === "main.bicep")!;
        for (const service of ["blobServices", "fileServices", "queueServices", "tableServices"]) {
          main.content += `\nresource ${service} 'Microsoft.Storage/storageAccounts/${service}@2023-05-01' = {\n  parent: storage\n  name: 'default'\n}\n\nresource ${service}Diagnostic 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {\n  scope: ${service}\n  name: 'logs'\n  properties: {\n    workspaceId: '${workspaceResourceId}'\n    logs: [\n      {\n        categoryGroup: 'allLogs'\n        enabled: true\n      }\n    ]\n    metrics: [\n      {\n        category: 'Transaction'\n        enabled: true\n      }\n    ]\n  }\n}\n`;
        }
      }
      await mkdir(join(root, "modules"));
      for (const file of files) await writeFile(join(root, file.path), file.content);
      const calls: ProcessRequest[] = [];
      const provider = new NativeBicepProvider({
        runner: {
          run: async (command) => {
            calls.push(command);
            return runner.run(command);
          },
        },
        currentAuthority: async () => authority,
        target: {
          cwd: root,
          templateFile: "main.bicep",
          resourceGroup: "rg",
          deploymentName: "validation",
          stackName: "workload",
          denySettingsMode: "denyDelete",
        },
      });
      const policyValidation = checkPolicy
        ? {
            policyMap: {
              schemaVersion: "1.0.0" as const,
              projectId: "project",
              runId: "run",
              governanceHash: hashes.policy,
              mappings: (["deny", "modify", "deployIfNotExists"] as const).map((effect) => ({
                policyAssignmentId: "/assignments/baseline",
                effect,
                logicalResourceId: "storage",
                propertyPath: "properties.supportsHttpsTrafficOnly",
                expectedValue: !scenario.endsWith("mismatch"),
                disposition: "planned" as const,
              })),
            },
            logicalResourceManifest: { storage: { codeSymbol: checkModule ? "storageModule::storage" : "storage" } },
          }
        : undefined;
      const input = {
        projectId: "project",
        runId: "run",
        sourceHash: hashes.iac,
        policyHash: policyValidation === undefined ? hashes.policy : sha256(policyValidation.policyMap),
        inputHash: hashes.input,
        generatedSource: { rootPath: root, treeHash: sha256(files) },
        policyValidation,
        ...(checkDiagnostics
          ? { storageDiagnosticsTargets: { storage: { binding: { codeSymbol: "storage" }, workspaceResourceId } } }
          : {}),
        ...(policyValidation === undefined
          ? {}
          : {
              storageSecurityBindings: policyValidation.logicalResourceManifest,
              resourceParityManifest: {
                schemaVersion: "1.0.0" as const,
                projectId: "project",
                runId: "run",
                track: "bicep" as const,
                resources: [
                  {
                    logicalId: "storage",
                    type: "Microsoft.Storage/storageAccounts",
                    implementationAddress: "native:Microsoft.Storage/storageAccounts@2023-05-01",
                    executionAddress: checkModule ? "storageModule::storage" : "storage",
                    implementationKind: "resource" as const,
                    ownership: "managed" as const,
                    dependsOn: [],
                    generatedDependencies: [],
                    sourcePath: "main.bicep",
                  },
                ],
              },
            }),
      };
      if (scenario === "pass" || scenario.endsWith("-pass")) {
        const receipt = await provider.validateSource(input);
        if (checkPolicy) {
          assert.equal(receipt.policyValidation?.outcome, "pass");
          assert.equal(
            receipt.resourceParity?.outcome,
            checkModule ? "unsupported" : checkDiagnostics ? "fail" : "pass",
          );
          if (checkDiagnostics) {
            assert.equal(receipt.storageDiagnostics?.storage?.outcome, "pass");
            assert.equal(receipt.storageDiagnostics?.storage?.fullBaselineEvaluated, false);
            assert.equal(receipt.storageDiagnostics?.storage?.inputHash, receipt.policyValidation?.inputHash);
          }
          assert.equal(
            receipt.resourceParity?.manifestHash,
            calculatePolicyValidationDigest(input.resourceParityManifest!),
          );
          assert.equal(receipt.resourceParity?.inputHash, receipt.policyValidation?.inputHash);
          assert.equal(receipt.policyValidation?.results.length, 3);
          assert.equal(receipt.storageSecurity?.storage?.outcome, "pass");
          assert.equal(receipt.storageSecurity?.storage?.fullBaselineEvaluated, false);
          assert.equal(receipt.storageSecurity?.storage?.sourceHash, input.sourceHash);
          assert.equal(receipt.storageSecurity?.storage?.bindingHash, sha256(input.storageSecurityBindings!.storage));
          assert.equal(
            hasValidNativeValidationReceipt(receipt, {
              ...input,
              track: "bicep",
              treeHash: input.generatedSource.treeHash,
            }),
            true,
          );
          for (const field of [
            "sourceHash",
            "inputHash",
            "fullBaselineEvaluated",
            "outcome",
            "observedValueDigest",
          ] as const) {
            const altered = structuredClone(receipt);
            const diagnostic = altered.storageSecurity!.storage!;
            if (field === "sourceHash") diagnostic.sourceHash = "f".repeat(64);
            else if (field === "inputHash") diagnostic.inputHash = "f".repeat(64);
            else if (field === "fullBaselineEvaluated") Object.assign(diagnostic, { fullBaselineEvaluated: true });
            else if (field === "outcome") diagnostic.outcome = "fail";
            else diagnostic.results[0]!.observedValueDigest = "f".repeat(64);
            const { receiptHash, ...body } = altered;
            assert.ok(receiptHash);
            altered.receiptHash = calculateNativeValidationReceiptHash(body);
            assert.equal(
              hasValidNativeValidationReceipt(altered, {
                ...input,
                track: "bicep",
                treeHash: input.generatedSource.treeHash,
              }),
              false,
            );
          }
        }
        assert.deepEqual(
          receipt.commands.map(({ validatorId }) => validatorId),
          ["bicep:format", "bicep:build", "bicep:lint"],
        );
      } else {
        await assert.rejects(provider.validateSource(input), {
          code: scenario === "format-drift" ? "PREVIEW_HASH_MISMATCH" : "NATIVE_VALIDATION_FAILED",
        });
      }
      assert.equal(calls.length, scenario === "format-drift" ? 1 : 3);
      for (const file of files) assert.equal(await readFile(join(root, file.path), "utf8"), file.content);
      await assert.rejects(stat(calls[0]!.cwd!), { code: "ENOENT" });
    });
  }
});

test("native parity snapshots the accepted binding before compiler commands", async (context) => {
  const fixture = await nativePolicyFixture(context, "bicep");
  const implementation = "native:Microsoft.Storage/storageAccounts@2023-05-01";
  const binding: IacBindingV1 = {
    schemaVersion: "1.0.0",
    projectId: "project",
    runId: "run",
    track: "bicep",
    intentHash: hashes.input,
    resourceBindings: { storage: { implementation, version: "2023-05-01", parameters: { name: "approved" } } },
  };
  const manifest: LogicalResourceManifestV1 = {
    schemaVersion: "1.0.0",
    projectId: "project",
    runId: "run",
    track: "bicep",
    resources: [
      {
        logicalId: "storage",
        type: "Microsoft.Storage/storageAccounts",
        implementationAddress: implementation,
        executionAddress: "storage",
        implementationKind: "resource",
        ownership: "managed",
        dependsOn: [],
        generatedDependencies: [],
        sourcePath: "main.bicep",
      },
    ],
  };
  const expected = calculatePolicyValidationDigest(binding);
  fixture.source.duringCommand = async () => {
    binding.resourceBindings.storage!.parameters.name = "changed-after-await";
  };
  const receipt = await fixture.makeProvider().validateSource({
    projectId: "project",
    runId: "run",
    sourceHash: hashes.iac,
    generatedSource: fixture.generatedSource,
    policyHash: hashes.policy,
    inputHash: hashes.input,
    resourceParityManifest: manifest,
    resourceParityBinding: binding,
  });
  assert.equal(receipt.resourceParity?.bindingHash, expected);
  assert.notEqual(receipt.resourceParity?.bindingHash, calculatePolicyValidationDigest(binding));
  assert.equal(fixture.runner.requests.length, 3);
  await assert.rejects(
    fixture.makeProvider().validateSource({
      projectId: "project",
      runId: "run",
      sourceHash: hashes.iac,
      generatedSource: fixture.generatedSource,
      policyHash: hashes.policy,
      inputHash: hashes.input,
      resourceParityManifest: manifest,
      resourceParityBinding: { ...binding, intentHash: "f".repeat(64) },
    }),
    /inputs are invalid/,
  );
  assert.equal(fixture.runner.requests.length, 3);
});

test("native bicep validateSource requires the accepted main.bicep target", async (context) => {
  const fixture = await nativePolicyFixture(context, "bicep");
  await assert.rejects(
    fixture.makeProvider({ templateFile: "other.bicep" }).validateSource({
      projectId: "project",
      runId: "run",
      sourceHash: hashes.iac,
      generatedSource: fixture.generatedSource,
      policyHash: hashes.policy,
      inputHash: hashes.input,
    }),
    { code: "PREVIEW_HASH_MISMATCH" },
  );
  assert.equal(fixture.runner.requests.length, 0);
});

test("native bicep validateSource evaluates mapped properties from its build output", async (context) => {
  for (const scenario of ["pass", "mismatch", "expression", "invalid-output", "missing-binding"] as const) {
    await context.test(scenario, async (context) => {
      const fixture = await nativePolicyFixture(context, "bicep");
      const policyValidation = structuredClone(fixture.policyRequest.policyValidation!);
      if (scenario === "mismatch") fixture.source.value = "different";
      if (scenario === "expression") fixture.source.value = "[parameters('security')]";
      if (scenario === "invalid-output") fixture.source.invalid = true;
      if (scenario === "missing-binding") delete policyValidation.logicalResourceManifest.storage;
      const input: NativeValidationRequest = {
        projectId: "project",
        runId: "run",
        sourceHash: hashes.iac,
        generatedSource: fixture.generatedSource,
        policyHash: sha256(policyValidation.policyMap),
        inputHash: hashes.input,
        policyValidation,
      };
      const provider = fixture.makeProvider();
      if (scenario === "pass") {
        const receipt = await provider.validateSource(input);
        const policy = Reflect.get(receipt, "policyValidation") as PolicyValidationV1 | undefined;
        assert.ok(policy, "Native Bicep validation must return executed policy evidence");
        assert.equal(policy.outcome, "pass");
        assert.equal(policy.results.length, 3);
        assert.equal(policy.sourceHash, input.sourceHash);
        assert.equal(policy.policyMapHash, input.policyHash);
        assert.equal(policy.inputHash, createHash("sha256").update(fixture.json()).digest("hex"));
        assert.equal(
          hasValidNativeValidationReceipt(receipt, {
            ...input,
            track: "bicep",
            treeHash: input.generatedSource.treeHash,
          }),
          true,
        );
        assert.equal(JSON.stringify(receipt).includes(fixture.source.value), false);
        for (const key of [
          "projectId",
          "runId",
          "track",
          "sourceHash",
          "policyMapHash",
          "outcome",
          "receiptHash",
        ] as const) {
          const changed = structuredClone(receipt);
          const nested = Reflect.get(changed, "policyValidation") as PolicyValidationV1;
          Reflect.set(
            nested,
            key,
            key.endsWith("Hash")
              ? "f".repeat(64)
              : key === "track"
                ? "terraform"
                : key === "outcome"
                  ? "unsupported"
                  : "other",
          );
          if (key !== "receiptHash") {
            const { receiptHash: oldPolicyHash, ...policyBody } = nested;
            assert.ok(oldPolicyHash);
            nested.receiptHash = calculatePolicyValidationHash(policyBody);
          }
          const { receiptHash: oldNativeHash, ...nativeBody } = changed;
          assert.ok(oldNativeHash);
          changed.receiptHash = calculateNativeValidationReceiptHash(nativeBody);
          assert.equal(
            hasValidNativeValidationReceipt(changed, {
              ...input,
              track: "bicep",
              treeHash: input.generatedSource.treeHash,
            }),
            false,
            key,
          );
        }
      } else {
        await assert.rejects(provider.validateSource(input), { code: "NATIVE_VALIDATION_FAILED" });
      }
      assert.equal(fixture.runner.requests.filter(({ args }) => args[0] === "build").length, 1);
      assert.ok(fixture.runner.requests.every(({ executable }) => executable === "bicep"));
      await assert.rejects(stat(fixture.runner.requests[0]!.cwd!), { code: "ENOENT" });
      assert.equal(fixture.executed(), false);
    });
  }
});

test("native Bicep policy inputs are bound before commands and snapshotted during execution", async (context) => {
  const fixture = await nativePolicyFixture(context, "bicep");
  const policyValidation = structuredClone(fixture.policyRequest.policyValidation!);
  const input: NativeValidationRequest = {
    projectId: "project",
    runId: "run",
    sourceHash: hashes.iac,
    generatedSource: fixture.generatedSource,
    policyHash: sha256(policyValidation.policyMap),
    inputHash: hashes.input,
    policyValidation,
  };
  const provider = fixture.makeProvider();
  for (const invalid of [
    { ...input, policyHash: hashes.policy },
    { ...input, runId: "other" },
  ]) {
    await assert.rejects(provider.validateSource(invalid), { code: "NATIVE_VALIDATION_INPUT_INVALID" });
    assert.equal(fixture.runner.requests.length, 0);
  }
  fixture.source.duringCommand = async () => {
    policyValidation.policyMap.mappings[0]!.expectedValue = "mutated-after-validation-started";
  };
  const receipt = await provider.validateSource(input);
  assert.equal(receipt.policyValidation?.outcome, "pass");
  assert.equal(receipt.policyValidation?.policyMapContentHash, input.policyHash);
});

test("native command-only validation does not claim unexecuted policy checks", async (context) => {
  for (const track of ["bicep", "terraform"] as const) {
    const fixture = await nativePolicyFixture(context, track);
    const policyValidation = structuredClone(fixture.policyRequest.policyValidation!);
    if (track === "bicep") policyValidation.policyMap.mappings = [];
    const receipt = await fixture.makeProvider().validateSource({
      projectId: "project",
      runId: "run",
      sourceHash: hashes.iac,
      generatedSource: fixture.generatedSource,
      policyHash: sha256(policyValidation.policyMap),
      inputHash: hashes.input,
      policyValidation,
    });
    assert.equal(receipt.policyValidation, undefined);
    assert.deepEqual(
      fixture.runner.requests.map(({ args }) => args[0]),
      NATIVE_VALIDATION_COMMANDS[track].map(({ args }) => args[0]),
    );
  }
});

for (const track of ["bicep", "terraform"] as const) {
  test(`native ${track} validateSource returns a source-bound receipt`, async (context) => {
    const fixture = await nativePolicyFixture(context, track);
    const nestedPath = `modules/nested/${fixture.sourceFile}`;
    const nestedContent = "\uFEFFnested source\r\n";
    await mkdir(join(fixture.root, "modules", "nested"), { recursive: true });
    await writeFile(join(fixture.root, nestedPath), nestedContent);
    fixture.generatedSource.treeHash = sha256(
      [
        { path: fixture.sourceFile, content: await readFile(join(fixture.root, fixture.sourceFile), "utf8") },
        { path: nestedPath, content: nestedContent },
      ].sort((left, right) => left.path.localeCompare(right.path)),
    );
    fixture.source.duringCommand = async (process) => {
      assert.notEqual(process.cwd, fixture.root);
      assert.equal(await readFile(join(process.cwd!, nestedPath), "utf8"), nestedContent);
      assert.deepEqual((await readdir(process.cwd!)).sort(), [fixture.sourceFile, "modules"].sort());
      assert.equal((await stat(process.cwd!)).mode & 0o777, 0o700);
      assert.equal((await stat(join(process.cwd!, nestedPath))).nlink, 1);
    };
    const provider = fixture.makeProvider();
    const input: NativeValidationRequest = {
      projectId: "project",
      runId: "run",
      sourceHash: hashes.iac,
      generatedSource: fixture.generatedSource,
      policyHash: hashes.policy,
      inputHash: hashes.input,
    };
    const receipt = await provider.validateSource(input);
    assert.equal(Value.Check(NativeValidationReceiptV1Schema, receipt), true);
    assert.equal(
      hasValidNativeValidationReceipt(receipt, { ...input, track, treeHash: input.generatedSource.treeHash }),
      true,
    );
    const { receiptHash, ...body } = receipt;
    assert.equal(receiptHash, calculateNativeValidationReceiptHash(body));
    assert.equal(receipt.outcome, "pass");
    const commands = NATIVE_VALIDATION_COMMANDS[track];
    assert.deepEqual(
      commands,
      track === "bicep"
        ? [
            { validatorId: "bicep:format", executable: "bicep", args: ["format", "--pattern", "**/*.bicep"] },
            { validatorId: "bicep:build", executable: "bicep", args: ["build", "main.bicep", "--stdout"] },
            {
              validatorId: "bicep:lint",
              executable: "bicep",
              args: ["lint", "--pattern", "**/*.bicep", "--no-restore"],
            },
          ]
        : [
            {
              validatorId: "terraform:init-backend-false",
              executable: "terraform",
              args: ["init", "-backend=false", "-input=false"],
            },
            { validatorId: "terraform:format", executable: "terraform", args: ["fmt", "-check"] },
            { validatorId: "terraform:validate", executable: "terraform", args: ["validate"] },
          ],
    );
    assert.deepEqual(
      receipt.commands.map(({ validatorId, commandHash }) => ({ validatorId, commandHash })),
      commands.map((command) => ({
        validatorId: command.validatorId,
        commandHash: calculateNativeValidationCommandHash(command),
      })),
    );
    assert.deepEqual(
      fixture.runner.requests.map(({ executable, args, cwd }) => ({ executable, args, cwd })),
      commands.map(({ executable, args }) => ({ executable, args: [...args], cwd: fixture.runner.requests[0]!.cwd })),
    );
    const scratchRoot = fixture.runner.requests[0]!.cwd!;
    assert.notEqual(scratchRoot, fixture.root);
    await assert.rejects(stat(scratchRoot), { code: "ENOENT" });
    assert.equal(JSON.stringify(receipt).includes(scratchRoot), false);
    assert.equal(JSON.stringify(receipt).includes(fixture.root), false);
    assert.equal(JSON.stringify(receipt).includes(fixture.source.value), false);
    assert.equal(JSON.stringify(receipt).includes("stdout"), false);
    assert.equal(JSON.stringify(receipt).includes("stderr"), false);
    assert.deepEqual(await provider.validateSource(input), receipt);
  });

  test(`native ${track} records empty policy applicability without planning or claiming property evaluation`, async (context) => {
    const fixture = await nativePolicyFixture(context, track);
    const policyMap: PolicyPropertyMapV1 = {
      schemaVersion: "1.0.0",
      projectId: "project",
      runId: "run",
      governanceHash: hashes.policy,
      mappings: [],
    };
    const input: NativeValidationRequest = {
      projectId: "project",
      runId: "run",
      sourceHash: hashes.iac,
      generatedSource: fixture.generatedSource,
      policyHash: calculatePolicyValidationDigest(policyMap),
      inputHash: hashes.input,
      policyValidation: { policyMap, logicalResourceManifest: {} },
    };
    const receipt = await fixture.makeProvider().validateSource(input);
    assert.deepEqual(receipt.policyApplicability, {
      status: "no-actionable-mappings",
      policyMapContentHash: input.policyHash,
    });
    assert.equal(receipt.policyValidation, undefined);
    assert.equal(
      hasValidNativeValidationReceipt(receipt, { ...input, track, treeHash: input.generatedSource.treeHash }),
      true,
    );
    assert.deepEqual(
      fixture.runner.requests.map(({ executable, args }) => ({ executable, args })),
      NATIVE_VALIDATION_COMMANDS[track].map(({ executable, args }) => ({ executable, args: [...args] })),
    );
    await assert.rejects(
      fixture.makeProvider().validateSource({ ...input, policyHash: "f".repeat(64) }),
      /inputs are invalid/,
    );
    const malformed = { ...policyMap, mappings: "" };
    const before = fixture.runner.requests.length;
    await assert.rejects(
      fixture.makeProvider().validateSource({
        ...input,
        policyHash: calculatePolicyValidationDigest(malformed),
        policyValidation: { policyMap: malformed as unknown as PolicyPropertyMapV1, logicalResourceManifest: {} },
      }),
      /inputs are invalid/,
    );
    assert.equal(fixture.runner.requests.length, before);
  });

  test(`native ${track} validateSource rejects missing, stale, or misbound sources before commands`, async (context) => {
    for (const failure of [
      "missing",
      "missing-file",
      "stale",
      "cwd",
      "relative-root",
      "symlink",
      "hardlink",
      "hidden",
      "bad-hash",
    ] as const) {
      await context.test(failure, async (child) => {
        const fixture = await nativePolicyFixture(child, track);
        const input: NativeValidationRequest = {
          projectId: "project",
          runId: "run",
          sourceHash: hashes.iac,
          generatedSource: fixture.generatedSource,
          policyHash: hashes.policy,
          inputHash: hashes.input,
        };
        if (failure === "missing-file") await rm(join(fixture.root, fixture.sourceFile));
        if (failure === "stale") await writeFile(join(fixture.root, fixture.sourceFile), "private-source-changed");
        if (failure === "hidden") await writeFile(join(fixture.root, ".unexpected"), "private-hidden-content");
        if (failure === "symlink") await symlink(join(fixture.root, fixture.sourceFile), join(fixture.root, "alias"));
        if (failure === "hardlink") {
          const other = await nativePolicyFixture(child, track);
          await rm(join(fixture.root, fixture.sourceFile));
          await link(join(other.root, other.sourceFile), join(fixture.root, fixture.sourceFile));
        }
        const malformed =
          failure === "missing"
            ? { ...input, generatedSource: undefined }
            : failure === "relative-root"
              ? { ...input, generatedSource: { ...input.generatedSource, rootPath: "." } }
              : failure === "bad-hash"
                ? { ...input, inputHash: "private-invalid-hash" }
                : input;
        await assert.rejects(
          fixture
            .makeProvider(failure === "cwd" ? { cwd: tmpdir() } : {})
            .validateSource(malformed as NativeValidationRequest),
          (error: unknown) => {
            assert.ok(error instanceof IacProviderError);
            assert.equal(
              error.code,
              failure === "bad-hash" ? "NATIVE_VALIDATION_INPUT_INVALID" : "PREVIEW_HASH_MISMATCH",
            );
            assert.equal(JSON.stringify(error).includes("private-"), false);
            assert.equal(error.message.includes(fixture.root), false);
            return true;
          },
        );
        assert.equal(fixture.runner.requests.length, 0);
      });
    }
  });

  test(`native ${track} validateSource rejects every unsuccessful process result without output leakage`, async (context) => {
    const failures: Array<Partial<ProcessResult> | "throw"> = [
      { exitCode: 1 },
      { exitCode: null },
      { signal: "SIGTERM" },
      { timedOut: true },
      { outputTruncated: true },
      "throw",
    ];
    for (const failure of failures) {
      for (const command of NATIVE_VALIDATION_COMMANDS[track]) {
        await context.test(`${command.validatorId} ${JSON.stringify(failure)}`, async (child) => {
          const fixture = await nativePolicyFixture(child, track);
          const run = fixture.runner.run.bind(fixture.runner);
          fixture.runner.run = async (process) => {
            const result = await run(process);
            if (process.args[0] !== command.args[0]) return result;
            if (failure === "throw") throw new Error(`private-source ${fixture.root}`);
            return {
              ...result,
              stdout: `private-source ${fixture.root}`,
              stderr: "private-diagnostic-secret",
              ...failure,
            };
          };
          await assert.rejects(
            fixture.makeProvider().validateSource({
              projectId: "project",
              runId: "run",
              sourceHash: hashes.iac,
              generatedSource: fixture.generatedSource,
              policyHash: hashes.policy,
              inputHash: hashes.input,
            }),
            (error: unknown) => {
              assert.ok(error instanceof IacProviderError);
              assert.equal(error.code, "NATIVE_VALIDATION_FAILED");
              assert.equal(error.message, "Native validation command failed");
              assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
              assert.equal(JSON.stringify(error).includes("private-"), false);
              return true;
            },
          );
          assert.equal(
            fixture.runner.requests.length,
            NATIVE_VALIDATION_COMMANDS[track].findIndex((entry) => entry.validatorId === command.validatorId) + 1,
          );
          await assert.rejects(stat(fixture.runner.requests[0]!.cwd!), { code: "ENOENT" });
        });
      }
    }
  });

  for (const location of ["original", "scratch"] as const) {
    test(`native ${track} validateSource checks ${location} source after each command`, async (context) => {
      for (const command of NATIVE_VALIDATION_COMMANDS[track]) {
        for (const mutation of ["edit", "remove", "extra", "hidden", "symlink", "hardlink"] as const) {
          await context.test(`${command.validatorId} ${mutation}`, async (child) => {
            const fixture = await nativePolicyFixture(child, track);
            fixture.source.duringCommand = async (process) => {
              if (process.args[0] !== command.args[0]) return;
              const root = location === "original" ? fixture.root : process.cwd!;
              const path = join(root, fixture.sourceFile);
              if (mutation === "edit") await writeFile(path, "private-source-tamper");
              if (mutation === "remove") await rm(path);
              if (mutation === "extra") await writeFile(join(root, "extra.tf"), "private-source-extra");
              if (mutation === "hidden") await writeFile(join(root, ".unexpected"), "private-source-hidden");
              if (mutation === "symlink") {
                await rm(path);
                await symlink(join(fixture.root, "missing"), path);
              }
              if (mutation === "hardlink") {
                const other = await nativePolicyFixture(child, track);
                await rm(path);
                await link(join(other.root, other.sourceFile), path);
              }
            };
            await assert.rejects(
              fixture.makeProvider().validateSource({
                projectId: "project",
                runId: "run",
                sourceHash: hashes.iac,
                generatedSource: fixture.generatedSource,
                policyHash: hashes.policy,
                inputHash: hashes.input,
              }),
              { code: "PREVIEW_HASH_MISMATCH" },
            );
            assert.equal(
              fixture.runner.requests.length,
              NATIVE_VALIDATION_COMMANDS[track].findIndex((entry) => entry.validatorId === command.validatorId) + 1,
            );
            await assert.rejects(stat(fixture.runner.requests[0]!.cwd!), { code: "ENOENT" });
          });
        }
      }
    });
  }

  test(`native ${track} binds generated source before commands and after evaluation`, async (context) => {
    for (const mutation of ["none", "before", "during", "extra", "extra-during", "removed-during"] as const) {
      await context.test(mutation, async (child) => {
        const fixture = await nativePolicyFixture(child, track);
        const { generatedSource } = fixture;
        if (mutation === "before") await writeFile(join(fixture.root, fixture.sourceFile), "changed");
        if (mutation === "during") {
          fixture.source.duringPreview = async () => writeFile(join(fixture.root, fixture.sourceFile), "changed");
        }
        if (mutation === "extra") await writeFile(join(fixture.root, "extra.tf"), "unbound");
        if (mutation === "extra-during") {
          fixture.source.duringPreview = async () => writeFile(join(fixture.root, "extra.tf"), "unbound");
        }
        if (mutation === "removed-during") {
          fixture.source.duringPreview = async () => rm(join(fixture.root, fixture.sourceFile));
        }
        const provider = fixture.makeProvider();
        const preview = provider.previewApply({ ...fixture.policyRequest, generatedSource });
        if (mutation === "none") {
          const result = await preview;
          assert.deepEqual(result.blockers, []);
          assert.equal(provider.policyValidation(result.previewHash)!.sourceHash, hashes.iac);
        } else {
          await assert.rejects(
            preview,
            (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
          );
          assert.equal(fixture.bindings.values.size, 0);
          assert.equal(fixture.artifacts.values.size, 0);
          if (mutation === "before" || mutation === "extra") assert.equal(fixture.runner.requests.length, 0);
        }
      });
    }
  });

  test(`native ${track} generated source rejects unrelated roots and symlinks`, async (context) => {
    for (const mismatch of ["cwd", "root-link", "file-link", "directory-link", "relative-root"] as const) {
      await context.test(mismatch, async (child) => {
        const fixture = await nativePolicyFixture(child, track);
        const other = await nativePolicyFixture(child, track);
        let rootPath = fixture.root;
        if (mismatch === "root-link") {
          rootPath = join(other.root, "alias");
          await symlink(fixture.root, rootPath, "dir");
        }
        if (mismatch === "file-link") {
          await rm(join(fixture.root, fixture.sourceFile));
          await symlink(join(other.root, other.sourceFile), join(fixture.root, fixture.sourceFile));
        }
        if (mismatch === "directory-link") await symlink(other.root, join(fixture.root, "modules"), "dir");
        if (mismatch === "relative-root") rootPath = ".";
        const provider = fixture.makeProvider({ cwd: mismatch === "cwd" ? other.root : rootPath });
        await assert.rejects(
          provider.previewApply({
            ...fixture.policyRequest,
            generatedSource: { ...fixture.generatedSource, rootPath },
          }),
          (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
        );
        assert.equal(fixture.runner.requests.length, 0);
      });
    }
  });

  test(`native ${track} checks sorted nested sources with and without policy`, async (context) => {
    for (const withPolicy of [true, false]) {
      for (const mutate of [false, true]) {
        const fixture = await nativePolicyFixture(context, track);
        const path = `modules/${fixture.sourceFile}`;
        await mkdir(join(fixture.root, "modules"));
        const content = "nested source\n";
        await writeFile(join(fixture.root, path), content);
        const generatedSource = {
          rootPath: fixture.root,
          treeHash: sha256(
            [
              { path, content },
              { path: fixture.sourceFile, content: await readFile(join(fixture.root, fixture.sourceFile), "utf8") },
            ].sort((left, right) => left.path.localeCompare(right.path)),
          ),
        };
        if (mutate) fixture.source.duringPreview = async () => writeFile(join(fixture.root, path), "changed module");
        const previewRequest = withPolicy ? fixture.policyRequest : request();
        const provider = fixture.makeProvider();
        if (mutate) {
          await assert.rejects(
            provider.previewApply({ ...previewRequest, generatedSource }),
            (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
          );
        } else {
          const preview = await provider.previewApply({ ...previewRequest, generatedSource });
          assert.deepEqual(preview.blockers, []);
          assert.equal(provider.policyValidation(preview.previewHash) !== undefined, withPolicy);
          assert.deepEqual((await provider.previewDestroy({ ...previewRequest, generatedSource })).blockers, []);
        }
      }
    }
  });

  test(`native ${track} bounds generated tree bytes and rejects invalid UTF-8`, async (context) => {
    for (const oversized of [true, false]) {
      const fixture = await nativePolicyFixture(context, track);
      const content = oversized ? Buffer.alloc(16 * 1024 * 1024 + 1, "x") : Buffer.from([0xff]);
      await writeFile(join(fixture.root, fixture.sourceFile), content);
      const generatedSource = {
        rootPath: fixture.root,
        treeHash: sha256([{ path: fixture.sourceFile, content: content.toString("utf8") }]),
      };
      await assert.rejects(
        fixture.makeProvider().previewApply({ ...fixture.policyRequest, generatedSource }),
        (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
      );
      assert.equal(fixture.runner.requests.length, 0);
    }
  });

  test(`native ${track} policy receipts bind actual output and survive restart without replacing approval`, async (context) => {
    const fixture = await nativePolicyFixture(context, track);
    const provider = fixture.makeProvider();
    const preview = await provider.previewApply(fixture.policyRequest);
    assert.deepEqual(preview.blockers, []);
    const receipt = provider.policyValidation(preview.previewHash)!;
    const binding = fixture.bindings.values.get(preview.previewHash)!;
    assert.deepEqual(nativePolicyValidationBinding(receipt), {
      track,
      sourceHash: receipt.sourceHash,
      policyMapHash: receipt.policyMapHash,
      policyMapContentHash: receipt.policyMapContentHash,
      logicalResourceManifestHash: receipt.logicalResourceManifestHash,
      inputHash: receipt.inputHash,
      receiptHash: receipt.receiptHash,
    });
    assert.deepEqual(binding.policyValidationBinding, nativePolicyValidationBinding(receipt));
    assert.equal(receipt.outcome, "pass");
    assert.equal(receipt.results.length, 3);
    assert.equal(receipt.sourceHash, fixture.policyRequest.iacHash);
    assert.equal(receipt.policyMapHash, fixture.policyRequest.policyHash);
    assert.equal(receipt.inputHash, createHash("sha256").update(fixture.json()).digest("hex"));
    assert.equal(hasValidPolicyValidation(receipt, binding.policyValidationBinding!), true);
    assert.equal(JSON.stringify(binding).includes("native-value-must-not-leak"), false);
    assert.equal(JSON.stringify(receipt).includes('expectedValue"'), false);
    assert.equal(JSON.stringify(receipt).includes('observedValue"'), false);
    assert.notEqual(receipt.sourceHash, receipt.inputHash);
    assert.equal(fixture.executed(), false);
    const restarted = fixture.makeProvider();
    await assert.rejects(
      restarted.apply(preview, { ...approval(preview), decision: "rejected" }, authority),
      (error) => error instanceof IacProviderError && error.code === "APPROVAL_REJECTED",
    );
    assert.equal(fixture.executed(), false);
    await fixture.bindings.save(preview.previewHash, JSON.parse(JSON.stringify(binding)) as PersistedPreviewBinding);
    assert.equal((await restarted.apply(preview, approval(preview), authority)).state, "succeeded");
    assert.deepEqual(restarted.policyValidation(preview.previewHash), receipt);
    receipt.results.length = 0;
    assert.equal(provider.policyValidation(preview.previewHash)!.results.length, 3);
    if (track === "terraform") {
      assert.equal(fixture.runner.requests.filter((entry) => entry.args[0] === "show").length, 1);
    }
  });

  test(`native ${track} policy mismatches and unsupported expressions block with diagnostic receipts`, async (context) => {
    for (const [value, outcome, reason] of [
      ["actual-private-mismatch", "fail", "value-mismatch"],
      [track === "bicep" ? "[parameters('security')]" : "${var.security}", "unsupported", "unsupported-expression"],
    ] as const) {
      await context.test(outcome, async (child) => {
        const fixture = await nativePolicyFixture(child, track);
        fixture.source.value = value;
        const provider = fixture.makeProvider();
        const preview = await provider.previewApply(fixture.policyRequest);
        const receipt = provider.policyValidation(preview.previewHash)!;
        assert.equal(receipt.outcome, outcome);
        assert.equal(receipt.results[0]!.reason, reason);
        assert.equal(preview.blockers.length, 3);
        assert.equal(JSON.stringify(receipt).includes(value), false);
        await assert.rejects(
          fixture.makeProvider().apply(preview, approval(preview), authority),
          (error) => error instanceof IacProviderError && error.code === "PREVIEW_BLOCKED",
        );
        assert.equal(fixture.executed(), false);
      });
    }
  });

  test(`native ${track} policy exemptions block, while empty baselines and destroy skip`, async (context) => {
    const fixture = await nativePolicyFixture(context, track);
    fixture.policyRequest.policyValidation!.policyMap.mappings[0]!.disposition = "exempt";
    const provider = fixture.makeProvider();
    const exempt = await provider.previewApply(fixture.policyRequest);
    assert.equal(provider.policyValidation(exempt.previewHash)!.results[0]!.reason, "unverified-exemption");
    assert.equal(exempt.blockers.length, 1);
    const destroy = await provider.previewDestroy(fixture.policyRequest);
    assert.equal(provider.policyValidation(destroy.previewHash), undefined);
    fixture.policyRequest.policyValidation!.policyMap.mappings.length = 0;
    const empty = await provider.previewApply(fixture.policyRequest);
    assert.equal(provider.policyValidation(empty.previewHash), undefined);
    assert.equal(fixture.bindings.values.get(empty.previewHash)!.policyValidationBinding, undefined);
    assert.deepEqual(empty.blockers, []);
    await fixture.makeProvider().apply(empty, approval(empty), authority);
    if (track === "bicep") {
      assert.equal(fixture.runner.requests.filter((entry) => entry.executable === "bicep").length, 1);
    }
  });

  test(`native ${track} rejects restarted policy receipt omission and tampering`, async (context) => {
    const fixture = await nativePolicyFixture(context, track);
    const preview = await fixture.makeProvider().previewApply(fixture.policyRequest);
    const original = fixture.bindings.values.get(preview.previewHash)!;
    const { policyValidation: receipt, policyValidationBinding: expectation, ...native } = original;
    assert.ok(receipt);
    assert.ok(expectation);
    const mutations: Record<string, PersistedPreviewBinding> = {
      "omit receipt": { ...native, policyValidationBinding: expectation },
      "omit expectation": { ...native, policyValidation: receipt },
      "omit both": native,
      "receipt hash": { ...original, policyValidation: { ...receipt, receiptHash: "f".repeat(64) } },
      results: { ...original, policyValidation: { ...receipt, results: [] } },
    };
    for (const field of [
      "sourceHash",
      "policyMapHash",
      "policyMapContentHash",
      "logicalResourceManifestHash",
      "inputHash",
    ] as const) {
      const changed = rehashPolicy({ ...receipt, [field]: "f".repeat(64) });
      mutations[field] = {
        ...original,
        policyValidation: changed,
        policyValidationBinding: { ...expectation, [field]: changed[field], receiptHash: changed.receiptHash },
      };
    }
    const changedResults = rehashPolicy({
      ...receipt,
      results: receipt.results.map((result) => ({ ...result, mappingHash: "f".repeat(64) })),
    });
    mutations["rehashed results"] = {
      ...original,
      policyValidation: changedResults,
      policyValidationBinding: { ...expectation, receiptHash: changedResults.receiptHash },
    };
    for (const [name, binding] of Object.entries(mutations)) {
      await context.test(name, async () => {
        await fixture.bindings.save(
          preview.previewHash,
          JSON.parse(JSON.stringify(binding)) as PersistedPreviewBinding,
        );
        await assert.rejects(
          fixture.makeProvider().apply(preview, approval(preview), authority),
          (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
        );
        assert.equal(fixture.executed(), false);
      });
    }
  });

  test(`native ${track} source drift during and after preview cannot bypass native binding`, async (context) => {
    const fixture = await nativePolicyFixture(context, track);
    const provider = fixture.makeProvider();
    const preview = await provider.previewApply(fixture.policyRequest);
    if (track === "bicep") fixture.source.value = "changed-compiler-output";
    else fixture.source.configHash = "f".repeat(64);
    await assert.rejects(
      fixture.makeProvider().apply(preview, approval(preview), authority),
      (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
    );
    fixture.source.value = "native-value-must-not-leak";
    fixture.source.configHash = hashes.iac;
    fixture.source.duringPreview = async () => {
      if (track === "bicep") await writeFile(join(fixture.root, "main.bicep"), "changed-source");
      else fixture.source.configHash = "f".repeat(64);
    };
    const drifted = await provider.previewApply(fixture.policyRequest);
    assert.match(drifted.blockers.join("\n"), /changed during policy validation preview/);
    assert.ok(provider.policyValidation(drifted.previewHash));
    await assert.rejects(
      fixture.makeProvider().apply(drifted, approval(drifted), authority),
      (error) => error instanceof IacProviderError && error.code === "PREVIEW_BLOCKED",
    );
    assert.equal(fixture.executed(), false);
  });
}

test("native Bicep generated binding requires main.bicep and accepted parameters", async (context) => {
  for (const mismatch of [
    "compiled",
    "other-entrypoint",
    "outside-entrypoint",
    "outside-parameters",
    "none",
  ] as const) {
    await context.test(mismatch, async (child) => {
      const fixture = await nativePolicyFixture(child, "bicep");
      const files = [
        { path: "main.bicep", content: await readFile(join(fixture.root, "main.bicep"), "utf8") },
        { path: "main.json", content: "{}" },
        { path: "other.bicep", content: "targetScope = 'resourceGroup'\n" },
        { path: "parameters.json", content: "{}" },
      ].sort((left, right) => left.path.localeCompare(right.path));
      for (const file of files) await writeFile(join(fixture.root, file.path), file.content);
      const generatedSource = { rootPath: fixture.root, treeHash: sha256(files) };
      const provider = fixture.makeProvider({
        templateFile:
          mismatch === "compiled"
            ? "main.json"
            : mismatch === "other-entrypoint"
              ? "other.bicep"
              : mismatch === "outside-entrypoint"
                ? "../main.bicep"
                : "main.bicep",
        parametersFile: mismatch === "outside-parameters" ? "../parameters.json" : "parameters.json",
      });
      if (mismatch === "none") {
        assert.deepEqual((await provider.previewApply({ ...fixture.policyRequest, generatedSource })).blockers, []);
        await provider.validate();
        assert.ok(
          fixture.runner.requests
            .filter((entry) => entry.executable === "bicep")
            .every((entry) => entry.args.includes("--stdout")),
        );
      } else {
        await assert.rejects(
          provider.previewApply({ ...fixture.policyRequest, generatedSource }),
          (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
        );
        assert.equal(fixture.runner.requests.length, 0);
      }
    });
  }
});

test("native Terraform generated binding allows only newly created native outputs", async (context) => {
  for (const extra of ["none", "extra.tf", "extra.tf.json", "modules/main.tf", "other.tfplan", "main.json"] as const) {
    await context.test(extra, async (child) => {
      const fixture = await nativePolicyFixture(child, "terraform");
      fixture.source.duringInit = async () => {
        await mkdir(join(fixture.root, ".terraform", "modules"), { recursive: true });
        await writeFile(join(fixture.root, ".terraform", "modules", "modules.json"), "{}");
        await writeFile(join(fixture.root, ".terraform.lock.hcl"), "provider lock");
      };
      if (extra !== "none") {
        fixture.source.duringShow = async () => {
          await mkdir(join(fixture.root, "modules"), { recursive: true });
          await writeFile(join(fixture.root, extra), "unbound source");
        };
      }
      const preview = fixture
        .makeProvider()
        .previewApply({ ...fixture.policyRequest, generatedSource: fixture.generatedSource });
      if (extra === "none") assert.deepEqual((await preview).blockers, []);
      else {
        await assert.rejects(
          preview,
          (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
        );
        assert.equal(fixture.bindings.values.size, 0);
        assert.equal(fixture.artifacts.values.size, 0);
      }
      await assert.rejects(stat(join(fixture.root, "policy.tfplan")), /ENOENT/);
    });
  }
});

test("native Terraform generated binding never exempts accepted lockfiles or source plan paths", async (context) => {
  for (const mutation of ["lockfile", "entrypoint", "unbound-source", "during-init"] as const) {
    const fixture = await nativePolicyFixture(context, "terraform");
    const files = [
      { path: ".terraform.lock.hcl", content: "accepted lock" },
      { path: "main.tf", content: await readFile(join(fixture.root, "main.tf"), "utf8") },
    ].sort((left, right) => left.path.localeCompare(right.path));
    await writeFile(
      join(fixture.root, ".terraform.lock.hcl"),
      files.find(({ path }) => path === ".terraform.lock.hcl")!.content,
    );
    const generatedSource = { rootPath: fixture.root, treeHash: sha256(files) };
    if (mutation === "lockfile")
      fixture.source.duringInit = async () => writeFile(join(fixture.root, ".terraform.lock.hcl"), "changed lock");
    if (mutation === "during-init")
      fixture.source.duringInit = async () => writeFile(join(fixture.root, "main.tf"), "changed source");
    const provider = fixture.makeProvider({
      ...(mutation === "entrypoint" ? { planPath: join(fixture.root, "main.tf") } : {}),
      ...(mutation === "unbound-source" ? { planPath: join(fixture.root, "extra.tf") } : {}),
    });
    await assert.rejects(
      provider.previewApply({ ...fixture.policyRequest, generatedSource }),
      (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
    );
    assert.equal(fixture.bindings.values.size, 0);
    if (mutation === "entrypoint" || mutation === "unbound-source") assert.equal(fixture.runner.requests.length, 0);
  }
});

test("native generated binding does not ignore artifacts present before preview", async (context) => {
  for (const track of ["bicep", "terraform"] as const) {
    const fixture = await nativePolicyFixture(context, track);
    await writeFile(join(fixture.root, track === "bicep" ? "main.json" : ".terraform.lock.hcl"), "unaccepted output");
    await assert.rejects(
      fixture.makeProvider().previewApply({ ...fixture.policyRequest, generatedSource: fixture.generatedSource }),
      (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
    );
    assert.equal(fixture.runner.requests.length, 0);
  }
});

test("native Bicep unavailable or invalid compiler JSON preserves unsupported receipts", async (context) => {
  for (const failure of ["invalid", "compileFailed"] as const) {
    const fixture = await nativePolicyFixture(context, "bicep");
    fixture.source[failure] = true;
    const provider = fixture.makeProvider();
    const preview = await provider.previewApply(fixture.policyRequest);
    assert.equal(provider.policyValidation(preview.previewHash)!.outcome, "unsupported");
    assert.equal(provider.policyValidation(preview.previewHash)!.results[0]!.reason, "invalid-source");
    assert.ok(preview.blockers.length >= 3);
    assert.equal(JSON.stringify(preview).includes("private source"), false);
    assert.equal(fixture.executed(), false);
  }
});

test("native Terraform unknown saved-plan values remain unsupported", async (context) => {
  const fixture = await nativePolicyFixture(context, "terraform");
  fixture.source.unknown = true;
  const provider = fixture.makeProvider();
  const preview = await provider.previewApply(fixture.policyRequest);
  const receipt = provider.policyValidation(preview.previewHash)!;
  assert.equal(receipt.outcome, "unsupported");
  assert.equal(receipt.results[0]!.reason, "unsupported-expression");
  await assert.rejects(
    fixture.makeProvider().apply(preview, approval(preview), authority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_BLOCKED",
  );
  assert.equal(fixture.executed(), false);
});

test("native Terraform detects saved-plan byte mutation during show-json", async (context) => {
  const fixture = await nativePolicyFixture(context, "terraform");
  fixture.source.duringShow = async () => writeFile(join(fixture.root, "policy.tfplan"), "replaced-plan");
  const provider = fixture.makeProvider();
  const preview = await provider.previewApply(fixture.policyRequest);
  assert.match(preview.blockers.join("\n"), /saved plan changed during policy validation/);
  assert.ok(provider.policyValidation(preview.previewHash));
  await assert.rejects(
    fixture.makeProvider().apply(preview, approval(preview), authority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_BLOCKED",
  );
  assert.equal(fixture.executed(), false);
});

test("Azure and Terraform normalizers block unknown or unevaluated changes", () => {
  const azure = normalizeAzureWhatIf({
    properties: {
      changes: [
        { resourceId: "/created", changeType: "Create" },
        { resourceId: "/ignored", changeType: "Ignore" },
        { resourceId: "/unknown", changeType: "Unsupported" },
      ],
    },
  });
  assert.deepEqual(
    azure.changes.map((change) => change.action),
    ["create", "no-op", "unknown"],
  );
  assert.equal(azure.blockers.length, 1);

  const terraform = normalizeTerraformPlan({
    resource_changes: [
      { address: "azurerm_resource_group.main", change: { actions: ["no-op"] } },
      { address: "azurerm_storage_account.main", change: { actions: ["delete", "create"] } },
      { address: "unknown.main", change: { actions: ["forget"] } },
    ],
    deferred_changes: [{}],
  });
  assert.deepEqual(
    terraform.changes.map((change) => change.action),
    ["no-op", "replace", "unknown"],
  );
  assert.equal(terraform.blockers.length, 2);
  assert.throws(() => normalizeAzureWhatIf({}), IacOutputParseError);
});

test("normalizers block missing, duplicate, and malformed material change identities", () => {
  const azure = normalizeAzureWhatIf({
    changes: [
      { changeType: "Create" },
      { resourceId: "/duplicate", changeType: "Delete" },
      { resourceId: "/duplicate", changeType: "Modify" },
      null,
    ],
  });
  assert.match(azure.blockers.join("\n"), /no stable resource ID|duplicate material|not a JSON object/);

  const terraform = normalizeTerraformPlan({
    resource_changes: [
      { change: { actions: ["create"] } },
      { address: "duplicate.main", change: { actions: ["update"] } },
      { address: "duplicate.main", change: { actions: ["delete"] } },
      { address: "broken.main", change: {} },
    ],
  });
  assert.match(terraform.blockers.join("\n"), /no stable resource address|duplicate material|malformed/);
});

test("Terraform normalization cannot turn incomplete or malformed plan evidence into safe changes", () => {
  for (const plan of [
    { resource_changes: [], complete: false },
    { resource_changes: "invalid" },
    { resource_changes: [], deferred_changes: {} },
    { resource_changes: [], complete: "true" },
    { resource_changes: [], errored: "false" },
    { resource_changes: [{ address: "azapi_resource.main", change: { actions: ["no-op", 42] } }] },
    { resource_changes: [{ address: "azapi_resource.main", change: { actions: ["create", null] } }] },
  ]) {
    const normalized = normalizeTerraformPlan(plan);
    assert.ok(normalized.blockers.length > 0, JSON.stringify(plan));
  }
  const noOp = normalizeTerraformPlan({ resource_changes: [], complete: true, errored: false });
  assert.deepEqual(noOp, { changes: [], blockers: [] });
  assert.deepEqual(normalizeTerraformPlan({ terraform_version: "1.7.5", format_version: "1.2" }), {
    changes: [],
    blockers: [],
  });
});

test("native Terraform incomplete plans block apply even without policy mappings", async (context) => {
  for (const withPolicy of [false, true]) {
    await context.test(`policy=${withPolicy}`, async (child) => {
      const fixture = await nativePolicyFixture(child, "terraform");
      fixture.source.complete = false;
      const provider = fixture.makeProvider();
      const preview = await provider.previewApply(withPolicy ? fixture.policyRequest : request());
      assert.match(preview.blockers.join("\n"), /plan is incomplete/);
      await assert.rejects(
        provider.apply(preview, approval(preview), authority),
        (error) => error instanceof IacProviderError && error.code === "PREVIEW_BLOCKED",
      );
      assert.equal(fixture.executed(), false);
    });
  }
});

function stack(name: string, resourceGroup = "rg", resources: unknown[] = []) {
  return {
    id: `/subscriptions/sub/resourceGroups/${resourceGroup}/providers/Microsoft.Resources/deploymentStacks/${name}`,
    name,
    properties: { resources },
  };
}

test("Azure stack selection distinguishes absent, exact, malformed, duplicate, and wrong-scope results", () => {
  const exact = stack("workload");
  const failedStack = {
    ...stack("failed"),
    properties: { provisioningState: "failed" },
    resources: [{ id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/example" }],
  };
  assert.equal(selectAzureDeploymentStack([stack("other")], "rg", "workload"), null);
  assert.equal(selectAzureDeploymentStack([stack("other"), exact], "rg", "Workload"), exact);
  assert.equal(selectAzureDeploymentStack([failedStack], "rg", "failed"), failedStack);
  assert.throws(() => selectAzureDeploymentStack({}, "rg", "workload"), /must be a JSON array/);
  assert.throws(() => selectAzureDeploymentStack([{}], "rg", "workload"), /entry 0 is malformed/);
  assert.throws(() => selectAzureDeploymentStack([exact, stack("WORKLOAD")], "rg", "workload"), /duplicate name/);
  assert.throws(() => selectAzureDeploymentStack([stack("workload", "other")], "rg", "workload"), /outside/);
  assert.throws(
    () => selectAzureDeploymentStack([{ ...exact, properties: {} }], "rg", "workload"),
    /malformed managed resources/,
  );
});

test("native Bicep first preview binds empty stack state and creates only after approval", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-native-bicep-first-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "main.bicep"), "targetScope = 'resourceGroup'\n");
  let created = false;
  const runner = new FakeRunner((process) => {
    if (process.args.includes("what-if")) {
      return JSON.stringify({ properties: { changes: [{ resourceId: "/resource", changeType: "Create" }] } });
    }
    if (process.args[2] === "list") {
      return JSON.stringify(
        created ? [stack("workload", "rg", [{ id: "/resource", name: "resource", type: "Example/type" }])] : [],
      );
    }
    if (process.args[2] === "create") {
      created = true;
      return JSON.stringify({ id: "/stack/workload" });
    }
    return "";
  });
  const provider = new NativeBicepProvider({
    runner,
    currentAuthority: async () => authority,
    now: () => clock.value,
    nextId: () => "operation",
    bindingStore: new MemoryBindingStore(),
    target: {
      cwd: root,
      resourceGroup: "rg",
      deploymentName: "preview",
      stackName: "workload",
      templateFile: "main.bicep",
      denySettingsMode: "denyDelete",
    },
  });
  const preview = await provider.previewApply(request());
  assert.equal(created, false);
  assert.equal((await provider.apply(preview, approval(preview), authority)).state, "succeeded");
  assert.equal(created, true);
  assert.equal((await provider.inventory("project", "run")).resources.length, 1);
  const listCommands = runner.requests.filter((entry) => entry.args[2] === "list");
  assert.ok(listCommands.length >= 3);
  assert.equal(
    listCommands.some((entry) => entry.args.includes("--name")),
    false,
  );
});

test("native Bicep lifecycle binds fallback preview inputs/state and exact stack commands", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-native-bicep-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "main.bicep"), "targetScope = 'resourceGroup'\n");
  await writeFile(join(root, "main.bicepparam"), "using './main.bicep'\n");
  const runner = new FakeRunner((process) => {
    if (process.args.includes("what-if")) {
      return JSON.stringify({ properties: { changes: [{ resourceId: "/resource", changeType: "Create" }] } });
    }
    if (process.args[2] === "list") {
      return JSON.stringify([stack("workload", "rg", [{ id: "/resource", name: "resource", type: "Example/type" }])]);
    }
    return JSON.stringify({ id: "/stack/workload" });
  });
  let current = authority;
  const bindings = new MemoryBindingStore();
  const options = {
    runner,
    currentAuthority: async () => current,
    now: () => clock.value,
    nextId: () => "operation",
    bindingStore: bindings,
    target: {
      cwd: root,
      resourceGroup: "rg",
      deploymentName: "preview",
      stackName: "workload",
      templateFile: "main.bicep",
      parametersFile: "main.bicepparam",
      actionOnUnmanage: "deleteResources",
      ownershipAuthorizesDeleteResources: true,
      denySettingsMode: "denyWriteAndDelete",
    },
  } as const;
  const provider = new NativeBicepProvider(options);
  const applyPreview = await provider.previewApply(request());
  const restarted = new NativeBicepProvider(options);
  const applyOperation = await restarted.apply(applyPreview, approval(applyPreview), authority);
  assert.deepEqual(restarted.executionEvidence(applyOperation.operationId), {
    mode: "native",
    operationId: applyOperation.operationId,
    previewHash: applyPreview.previewHash,
    validatorIds: ["deploy:bicep-stack-ownership"],
  });
  assert.equal(
    runner.requests.some((entry) => entry.args[2] === "create"),
    true,
  );
  assert.equal(runner.requests.flatMap((entry) => entry.args).includes("--bypass-stack-out-of-sync-error"), false);
  const previewCommand = runner.requests.find((entry) => entry.args.includes("what-if"))!;
  const applyCommand = runner.requests.find((entry) => entry.args[2] === "create")!;
  for (const flag of ["--resource-group", "--template-file", "--parameters"]) {
    assert.equal(
      applyCommand.args[applyCommand.args.indexOf(flag) + 1],
      previewCommand.args[previewCommand.args.indexOf(flag) + 1],
    );
  }
  assert.equal(applyCommand.args[applyCommand.args.indexOf("--name") + 1], "workload");
  assert.equal(applyCommand.args[applyCommand.args.indexOf("--action-on-unmanage") + 1], "deleteResources");
  assert.equal(applyCommand.args[applyCommand.args.indexOf("--deny-settings-mode") + 1], "denyWriteAndDelete");
  assert.equal((await provider.inventory("project", "run")).resources.length, 1);

  const destroyPreview = await provider.previewDestroy(request());
  await provider.destroy(destroyPreview, approval(destroyPreview), authority);
  const deleteRequest = runner.requests.find((entry) => entry.args[2] === "delete");
  assert.deepEqual(deleteRequest?.args.slice(0, 7), [
    "stack",
    "group",
    "delete",
    "--resource-group",
    "rg",
    "--name",
    "workload",
  ]);

  const stalePreview = await provider.previewApply(request());
  current = { ...authority, ownerEpoch: 4 };
  await assert.rejects(
    provider.apply(stalePreview, approval(stalePreview), authority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_OWNER_EPOCH_MISMATCH",
  );

  current = authority;

  const superseded = await provider.previewApply(request({ runId: "superseded" }));
  await provider.previewApply(
    request({ runId: "superseded", commit: "e".repeat(64), dependencyRevision: "e".repeat(64) }),
  );
  const supersededRestart = new NativeBicepProvider(options);
  await assert.rejects(
    supersededRestart.apply(superseded, approval(superseded), authority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_SUPERSEDED",
  );
  const mutationPreview = await provider.previewApply(request({ runId: "mutated" }));
  await writeFile(join(root, "main.bicep"), "targetScope = 'subscription'\n");
  await assert.rejects(
    restarted.apply(mutationPreview, approval(mutationPreview), authority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
  );
});

test("Bicep fallback blocks unrepresented managed resources and enforces safe action defaults", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-native-bicep-safety-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "main.bicep"), "targetScope = 'resourceGroup'\n");
  const runner = new FakeRunner((process) =>
    process.args.includes("what-if")
      ? JSON.stringify({ changes: [{ resourceId: "/represented", changeType: "Modify" }] })
      : JSON.stringify([stack("workload", "rg", [{ id: "/removed", name: "removed", type: "Example/type" }])]),
  );
  const base = {
    runner,
    currentAuthority: async () => authority,
    now: () => clock.value,
    target: {
      cwd: root,
      resourceGroup: "rg",
      deploymentName: "preview",
      stackName: "workload",
      templateFile: "main.bicep",
      denySettingsMode: "none" as const,
    },
  };
  const provider = new NativeBicepProvider(base);
  const preview = await provider.previewApply(request());
  assert.match(preview.blockers.join("\n"), /cannot prove action-on-unmanage.*\/removed/);
  assert.throws(
    () => new NativeBicepProvider({ ...base, target: { ...base.target, actionOnUnmanage: "deleteResources" } }),
    /ownership authorization/,
  );
  assert.throws(
    () => new NativeBicepProvider({ ...base, target: { ...base.target, actionOnUnmanage: "deleteAll" } }),
    /dedicated sandbox/,
  );
});

test("native Terraform encrypts immediately and restores exact-plan binding after restart", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-native-terraform-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const applyPath = join(root, "apply.tfplan");
  const destroyPath = join(root, "destroy.tfplan");
  let stateSerial = 7;
  const runner = new FakeRunner(async (process) => {
    const outputArg = process.args.find((argument) => argument.startsWith("-out="));
    if (outputArg !== undefined) {
      await writeFile(outputArg.slice(5), process.args.includes("-destroy") ? "destroy-plan" : "apply-plan", {
        mode: 0o600,
      });
      return "";
    }
    if (process.args[0] === "show" && process.args[1] === "-json") {
      return JSON.stringify({
        resource_changes: [{ address: "azurerm_resource_group.main", change: { actions: ["create"] } }],
      });
    }
    if (process.args[0] === "state" && process.args[1] === "pull") {
      return JSON.stringify({ lineage: "lineage-1", serial: stateSerial });
    }
    return "";
  });
  const bindings = new MemoryBindingStore();
  const artifacts = new MemoryArtifactStore();
  const key = Buffer.alloc(32, 9);
  let configHash = hashes.iac;
  let lockfileHash = hashes.lock;
  const target: TerraformNativeTarget = {
    cwd: root,
    target: "dev",
    planPath: (_request, operation) => (operation === "apply" ? applyPath : destroyPath),
    get lockfileHash() {
      return lockfileHash;
    },
    configHash: async () => configHash,
  };
  const options = {
    runner,
    currentAuthority: async () => authority,
    now: () => clock.value,
    nextId: () => "terraform-operation",
    target,
    bindingStore: bindings,
    artifactStore: artifacts,
    keyProvider: async () => key,
  };
  const provider = new NativeTerraformProvider(options);

  const applyPreview = await provider.previewApply(request());
  await assert.rejects(stat(applyPath), /ENOENT/);
  assert.equal(artifacts.values.size, 1);
  assert.equal(provider.attestation(applyPreview.previewHash)?.lockfileHash, hashes.lock);
  assert.equal(applyPreview.stateLineage, "lineage-1");
  assert.equal(applyPreview.stateSerial, 7);
  const attestation = provider.attestation(applyPreview.previewHash);
  assert.equal(
    Value.Check(ExecutionPlanAttestationV1Schema, attestation),
    true,
    JSON.stringify([...Value.Errors(ExecutionPlanAttestationV1Schema, attestation)]),
  );
  assert.equal("savedPlanPath" in (provider.attestation(applyPreview.previewHash) ?? {}), false);

  const restarted = new NativeTerraformProvider(options);
  const applyOperation = await restarted.apply(applyPreview, approval(applyPreview), authority);
  assert.deepEqual(restarted.executionEvidence(applyOperation.operationId), {
    mode: "native",
    operationId: applyOperation.operationId,
    previewHash: applyPreview.previewHash,
    validatorIds: ["deploy:exact-saved-plan", "deploy:state-lineage-and-serial"],
  });
  const exactApply = runner.requests.at(-1);
  assert.equal(exactApply?.args[0], "apply");
  assert.match(exactApply?.args[2] ?? "", /apex-local-plan-/);
  await assert.rejects(stat(exactApply?.args[2] ?? ""), /ENOENT/);

  const mutationPreview = await provider.previewApply(request({ runId: "mutation" }));
  configHash = "f".repeat(64);
  await assert.rejects(
    restarted.apply(mutationPreview, approval(mutationPreview), authority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
  );
  configHash = hashes.iac;
  lockfileHash = "1".repeat(64);
  await assert.rejects(
    restarted.apply(mutationPreview, approval(mutationPreview), authority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
  );
  lockfileHash = hashes.lock;

  stateSerial = 8;
  await assert.rejects(
    restarted.apply(mutationPreview, approval(mutationPreview), authority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_HASH_MISMATCH",
  );
  stateSerial = 7;

  const wrongKey = new NativeTerraformProvider({ ...options, keyProvider: async () => Buffer.alloc(32, 8) });
  await assert.rejects(wrongKey.apply(mutationPreview, approval(mutationPreview), authority));

  const binding = bindings.values.get(mutationPreview.previewHash);
  assert.equal(binding?.kind, "terraform");
  if (binding?.kind === "terraform") {
    const encrypted = artifacts.values.get(binding.attestation.artifactRef)!;
    const first = encrypted.ciphertext[0] === "A" ? "B" : "A";
    artifacts.values.set(binding.attestation.artifactRef, {
      ...encrypted,
      ciphertext: `${first}${encrypted.ciphertext.slice(1)}`,
    });
    await assert.rejects(restarted.apply(mutationPreview, approval(mutationPreview), authority));
  }
});

test("native Terraform encrypts for the planned post-preview recipient", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-native-terraform-recipient-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const planPath = join(root, "apply.tfplan");
  const runner = new FakeRunner(async (process) => {
    const outputArg = process.args.find((argument) => argument.startsWith("-out="));
    if (outputArg !== undefined) {
      await writeFile(outputArg.slice(5), "recipient-plan", { mode: 0o600 });
      return "";
    }
    if (process.args[0] === "show") return JSON.stringify({ resource_changes: [] });
    return "";
  });
  const claimHash = "9".repeat(64);
  let currentAuthority: CurrentDeploymentAuthority = authority;
  const provider = new NativeTerraformProvider({
    runner,
    currentAuthority: async () => currentAuthority,
    now: () => clock.value,
    target: {
      cwd: root,
      target: "dev",
      planPath: () => planPath,
      lockfileHash: hashes.lock,
      configHash: async () => hashes.iac,
    },
    bindingStore: new MemoryBindingStore(),
    artifactStore: new MemoryArtifactStore(),
    keyProvider: async () => Buffer.alloc(32, 7),
  });
  const preview = await provider.previewApply(request({ executionRecipientIdentity: "apply@example.com" }));
  assert.equal(provider.attestation(preview.previewHash)?.recipient, "apply@example.com");
  currentAuthority = {
    ...authority,
    ownerEpoch: 4,
    previousOwnerEpoch: 3,
    writerTransferClaimHash: claimHash,
    recipientIdentity: "apply@example.com",
  };
  const transferredApproval: ApprovalEvidenceV1 = {
    ...approval(preview),
    writerEpoch: 4,
    writerTransferClaimHash: claimHash,
    recipientIdentity: "apply@example.com",
  };
  assert.equal((await provider.apply(preview, transferredApproval, currentAuthority)).state, "succeeded");

  const missingClaim = { ...transferredApproval };
  delete missingClaim.writerTransferClaimHash;
  await assert.rejects(
    provider.apply(preview, missingClaim, currentAuthority),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_OWNER_EPOCH_MISMATCH",
  );
  await assert.rejects(
    provider.apply(preview, transferredApproval, { ...currentAuthority, recipientIdentity: "wrong@example.com" }),
    (error) => error instanceof IacProviderError && error.code === "PREVIEW_OWNER_EPOCH_MISMATCH",
  );
});

test("native Terraform cleans decrypted temp plans when apply fails", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-native-terraform-failure-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const planPath = join(root, "apply.tfplan");
  let appliedPath = "";
  const runner: ProcessRunnerLike = {
    async run(process) {
      const outputArg = process.args.find((argument) => argument.startsWith("-out="));
      if (outputArg !== undefined) await writeFile(outputArg.slice(5), "apply-plan", { mode: 0o600 });
      if (process.args[0] === "show") {
        return result(JSON.stringify({ resource_changes: [], prior_state: { lineage: "lineage", serial: 1 } }));
      }
      if (process.args[0] === "apply") {
        appliedPath = process.args[2] ?? "";
        throw new Error("apply failed");
      }
      return result("");
    },
  };
  const bindings = new MemoryBindingStore();
  const provider = new NativeTerraformProvider({
    runner,
    currentAuthority: async () => authority,
    now: () => clock.value,
    target: {
      cwd: root,
      target: "dev",
      planPath: () => planPath,
      lockfileHash: hashes.lock,
      configHash: async () => hashes.iac,
    },
    bindingStore: bindings,
    artifactStore: new MemoryArtifactStore(),
    keyProvider: async () => Buffer.alloc(32, 9),
  });
  const preview = await provider.previewApply(request());
  await assert.rejects(provider.apply(preview, approval(preview), authority), /apply failed/);
  await assert.rejects(stat(appliedPath), /ENOENT/);
});

test("Terraform inventory recursively removes sensitive and secret-denylisted state properties", async () => {
  const runner = new FakeRunner(() =>
    JSON.stringify({
      values: {
        outputs: { password: { value: "output-secret", sensitive: true } },
        root_module: {
          resources: [
            {
              address: "azurerm_example.main",
              provider_name: "registry.terraform.io/hashicorp/azurerm",
              type: "azurerm_example",
              values: {
                name: "safe",
                resourceId: "/subscriptions/sub/resourceGroups/rg/providers/example/main",
                eventHubAuthorizationRuleId: null,
                nested: { visible: "yes", hidden: "nested-secret" },
                clientSecret: "denylisted-secret",
              },
              sensitive_values: { nested: { hidden: true } },
            },
          ],
          child_modules: [
            {
              resources: [
                {
                  address: "module.child.azurerm_example.child",
                  type: "azurerm_example",
                  values: { name: "child", token: "denylisted-token" },
                  sensitive_values: {},
                },
              ],
            },
          ],
        },
      },
    }),
  );
  const provider = new NativeTerraformProvider({
    runner,
    currentAuthority: async () => authority,
    now: () => clock.value,
    target: {
      cwd: "/tmp",
      target: "dev",
      planPath: () => "/tmp/unused.tfplan",
      lockfileHash: hashes.lock,
      configHash: async () => hashes.iac,
    },
  });

  const inventory = await provider.inventory("project", "run");
  assert.equal(inventory.resources.length, 2);
  assert.deepEqual(inventory.resources[0]?.properties, {
    name: "safe",
    resourceId: "/subscriptions/sub/resourceGroups/rg/providers/example/main",
    nested: { visible: "yes" },
  });
  assert.deepEqual(inventory.resources[1]?.properties, { name: "child" });
  assert.doesNotMatch(JSON.stringify(inventory), /output-secret|nested-secret|denylisted/);
});

function result(stdout: string): ProcessResult {
  return { exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, outputTruncated: false };
}

test("local reference plan transport authenticates metadata, recipient, expiry, and temp mode", async (context) => {
  const key = Buffer.alloc(32, 7);
  const transport = new LocalEncryptedPlanTransport(() => clock.value);
  const encrypted = transport.encrypt(Buffer.from("saved-plan"), key, {
    recipient: authority.recipientIdentity,
    ttlMs: 60_000,
  });
  assert.equal(encrypted.metadata.implementation, "local-reference");
  assert.equal(transport.decrypt(encrypted, key, authority.recipientIdentity).toString(), "saved-plan");
  const persisted = {
    ...encrypted,
    metadata: {
      algorithm: encrypted.metadata.algorithm,
      createdAt: encrypted.metadata.createdAt,
      digest: encrypted.metadata.digest,
      expiresAt: encrypted.metadata.expiresAt,
      implementation: encrypted.metadata.implementation,
      recipient: encrypted.metadata.recipient,
    },
  };
  assert.equal(transport.decrypt(persisted, key, authority.recipientIdentity).toString(), "saved-plan");
  assert.throws(() => transport.decrypt(encrypted, key, "other@example.com"), /recipient/);
  assert.throws(() =>
    transport.decrypt(
      { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` },
      key,
      authority.recipientIdentity,
    ),
  );

  const handle = await transport.decryptToRestrictiveTemp(encrypted, key, authority.recipientIdentity);
  context.after(async () => handle.dispose());
  assert.equal((await stat(handle.path)).mode & 0o777, 0o600);
  assert.equal((await readFile(handle.path)).toString(), "saved-plan");
  await handle.dispose();

  clock.value = new Date("2026-07-13T01:02:00.000Z");
  assert.throws(() => transport.decrypt(encrypted, key, authority.recipientIdentity), /expired/);
  clock.value = new Date("2026-07-13T01:00:00.000Z");
});

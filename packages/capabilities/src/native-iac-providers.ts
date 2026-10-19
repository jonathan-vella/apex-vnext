import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, opendir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
  hasValidPolicyValidation,
  NATIVE_VALIDATION_COMMANDS,
  calculateNativeValidationCommandHash,
  calculateNativeValidationReceiptHash,
  calculatePolicyValidationDigest,
  hasActionablePolicyMappings,
  hasValidNativeValidationReceipt,
  PolicyPropertyMapV1Schema,
  LogicalResourceManifestV1Schema,
  EnvironmentSchema,
  IacBindingV1Schema,
} from "@apexops/contracts";
import type {
  ApprovalEvidenceV1,
  AzdBindingV1,
  AzdExecutionEnvelopeV1,
  DeploymentPreviewV1,
  ExecutionPlanAttestationV1,
  NativeValidationReceiptV1,
  OperationRecordV1,
  PolicyValidationBinding,
  PolicyValidationV1,
  ResourceInventoryV1,
} from "@apexops/contracts";
import { AzureCliReadAdapter, TerraformCommandAdapter, type CommandPlan } from "./command-plans.js";
import {
  assertAzdBindingUnchanged,
  describeAzdBinding,
  inspectAzdBicepProject,
  type AzdApprovalMaterial,
  type AzdBindingRequest,
} from "./azd-binding.js";
import { assertAzdIdentityMatchesBinding, buildAzdArguments } from "./azd-execution-envelope.js";
import { evaluateAzdPrerequisite } from "./azd-prerequisites.js";
import { AzdBindingError } from "./azd-project-files.js";
import { AZD_GENERATED_TEMPLATE as BICEP_TEMPLATE } from "./iac-generation.js";
import {
  authorizeDeploymentPreview,
  IacProviderError,
  sha256,
  type CurrentDeploymentAuthority,
  type IacProvider,
  type NativeValidationRequest,
  type ProviderExecutionEvidence,
  type PreviewRequest,
} from "./iac.js";
import {
  normalizeAzdGroupResources,
  normalizeAzdPreview,
  normalizeAzdTaggedGroups,
  normalizeTerraformPlan,
  parseJsonProcessOutput,
  type AzdOwnedResource,
  type NormalizedPreview,
} from "./iac-normalizers.js";
import { ProcessRunnerError, type ProcessRunnerLike } from "./process-runner.js";
import { secretFreeProperties } from "./secret-redaction.js";
import { LocalEncryptedPlanTransport, type LocalEncryptedPlan } from "./local-plan-transport.js";
import {
  validatePolicyProperties,
  validateStorageSecurityBindings,
  validateBicepResourceParity,
  validateBicepStorageDiagnostics,
  validateBicepStorageBaseline,
} from "./policy-validation.js";

export interface NativeProviderRuntime {
  readonly runner: ProcessRunnerLike;
  readonly currentAuthority: () => Promise<CurrentDeploymentAuthority>;
  readonly now?: () => Date;
  readonly nextId?: () => string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly bindingStore?: PreviewBindingStore;
}

export interface PreviewBindingStore {
  save(previewHash: string, binding: PersistedPreviewBinding): Promise<void>;
  load(previewHash: string): Promise<PersistedPreviewBinding | undefined>;
  loadLatest?(
    projectId: string,
    runId: string,
    operation: "apply" | "destroy",
  ): Promise<PersistedPreviewBinding | undefined>;
}

export interface EncryptedPlanArtifactStore {
  put(reference: string, artifact: LocalEncryptedPlan): Promise<void>;
  get(reference: string): Promise<LocalEncryptedPlan | undefined>;
}

export type PersistedPreviewBinding = BicepPreviewBinding | TerraformPreviewBinding;

/** The approved azd project and environment the Bicep executor runs; the Azure target comes from the run's scope. */
export interface AzdBicepTarget {
  /** Absolute azd project root; it must be the accepted generated source root. */
  readonly projectRoot: string;
  readonly environmentName: string;
  /** The approved tenant; the identity preflight requires the signed-in tenant to equal it. */
  readonly tenantId: string;
  readonly location: string;
  readonly cloud?: AzdExecutionEnvelopeV1["identityPreflight"]["cloud"];
  /** Exact azd release bundled with APEX; undefined when the bundle carries none, which fails every run. */
  readonly azdVersion: string | undefined;
}

export interface AzdBicepProviderOptions extends NativeProviderRuntime {
  readonly target: AzdBicepTarget;
}

export interface TerraformNativeTarget {
  readonly cwd: string;
  readonly target: string;
  readonly planPath: (request: PreviewRequest, operation: "apply" | "destroy") => string;
  readonly lockfileHash: string;
  readonly configHash: () => Promise<string>;
}

export type TerraformPlanAttestation = ExecutionPlanAttestationV1;

export interface NativeTerraformProviderOptions extends NativeProviderRuntime {
  readonly target: TerraformNativeTarget;
  readonly keyProvider?: () => Promise<Uint8Array>;
  readonly artifactStore?: EncryptedPlanArtifactStore;
  readonly transport?: LocalEncryptedPlanTransport;
}

export type NativePolicyValidationBinding = PolicyValidationBinding & { readonly receiptHash: string };

export function nativePolicyValidationBinding(receipt: PolicyValidationV1): NativePolicyValidationBinding {
  return {
    track: receipt.track,
    sourceHash: receipt.sourceHash,
    policyMapHash: receipt.policyMapHash,
    policyMapContentHash: receipt.policyMapContentHash,
    logicalResourceManifestHash: receipt.logicalResourceManifestHash,
    inputHash: receipt.inputHash,
    receiptHash: receipt.receiptHash,
  };
}

interface NativePolicyBinding {
  readonly policyValidation?: PolicyValidationV1;
  readonly policyValidationBinding?: NativePolicyValidationBinding;
}

export interface BicepPreviewBinding extends NativePolicyBinding {
  readonly kind: "bicep";
  readonly preview: DeploymentPreviewV1;
  readonly providerBindingHash: string;
  /** Everything azd recompiles or reads when it runs, bound at preview time. */
  readonly azdBinding: AzdBindingV1;
  /** Digest of the azd environment's resource group tagging and resources at preview time. */
  readonly ownedStateHash: string;
}

export interface TerraformPreviewBinding extends NativePolicyBinding {
  readonly kind: "terraform";
  readonly preview: DeploymentPreviewV1;
  readonly attestation: TerraformPlanAttestation;
}

function terraformStateIdentity(value: unknown): { stateLineage?: string; stateSerial?: number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const state = value as Record<string, unknown>;
  const stateLineage = typeof state.lineage === "string" && state.lineage.length > 0 ? state.lineage : undefined;
  const stateSerial =
    typeof state.serial === "number" && Number.isInteger(state.serial) && state.serial >= 0 ? state.serial : undefined;
  return {
    ...(stateLineage === undefined ? {} : { stateLineage }),
    ...(stateSerial === undefined ? {} : { stateSerial }),
  };
}

function terraformStateIdentityOutput(stdout: string): { stateLineage?: string; stateSerial?: number } {
  return stdout.trim().length === 0 ? {} : terraformStateIdentity(parseJsonProcessOutput("terraform-state", stdout));
}

const maxGeneratedSourceBytes = 16 * 1024 * 1024;

interface GeneratedSourceSnapshot {
  readonly rootPath: string;
  readonly treeHash: string;
  readonly paths: ReadonlySet<string>;
  readonly fileHashes: ReadonlyMap<string, string>;
  readonly fileContents: ReadonlyMap<string, Buffer>;
}

function pathEscapes(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation);
}

function sourceBindingError(): IacProviderError {
  return new IacProviderError(
    "PREVIEW_HASH_MISMATCH",
    "Native preview source does not match the accepted generated tree",
  );
}

async function readGeneratedSource(
  source: NonNullable<PreviewRequest["generatedSource"]>,
  accepted?: GeneratedSourceSnapshot,
  outputs: ReadonlySet<string> = new Set(),
): Promise<GeneratedSourceSnapshot> {
  try {
    const rootPath = resolve(source.rootPath);
    if (!isAbsolute(source.rootPath) || !/^[a-f0-9]{64}$/.test(source.treeHash)) throw sourceBindingError();
    const rootStat = await lstat(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw sourceBindingError();
    }
    const rootRealPath = await realpath(rootPath);
    let bytes = 0;
    let entries = 0;
    const files: Array<{ path: string; content: string }> = [];
    const fileHashes = new Map<string, string>();
    const fileContents = new Map<string, Buffer>();
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > 64) throw sourceBindingError();
      const handle = await opendir(directory);
      for await (const entry of handle) {
        // azd keeps the environment under `.azure`; it is inspected by the azd binding and is never generated source.
        if (depth === 0 && entry.name === ".azure") continue;
        if (++entries > 4096) throw sourceBindingError();
        const filePath = resolve(directory, entry.name);
        if (pathEscapes(rootPath, filePath) || pathEscapes(rootRealPath, await realpath(filePath))) {
          throw sourceBindingError();
        }
        const metadata = await lstat(filePath);
        if (metadata.isSymbolicLink() || (metadata.isFile() && metadata.nlink !== 1)) throw sourceBindingError();
        const path = relative(rootPath, filePath).split(sep).join("/");
        const isAccepted = accepted?.paths.has(path) === true;
        if (accepted !== undefined && !isAccepted && outputs.has(filePath)) {
          if (path === ".terraform" ? metadata.isDirectory() : metadata.isFile()) continue;
          throw sourceBindingError();
        }
        if (metadata.isDirectory()) {
          await visit(filePath, depth + 1);
          continue;
        }
        if (!metadata.isFile() || metadata.size > maxGeneratedSourceBytes - bytes) throw sourceBindingError();
        const input = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const opened = await input.stat();
          if (!opened.isFile() || opened.nlink !== 1) throw sourceBindingError();
          const chunks: Buffer[] = [];
          for (;;) {
            const chunk = Buffer.alloc(Math.min(64 * 1024, maxGeneratedSourceBytes - bytes + 1));
            const { bytesRead } = await input.read(chunk);
            if (bytesRead === 0) break;
            bytes += bytesRead;
            if (bytes > maxGeneratedSourceBytes) throw sourceBindingError();
            chunks.push(chunk.subarray(0, bytesRead));
          }
          const buffer = Buffer.concat(chunks);
          const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
          files.push({ path, content });
          fileHashes.set(path, createHash("sha256").update(buffer).digest("hex"));
          fileContents.set(path, buffer);
        } finally {
          await input.close();
        }
      }
    };
    await visit(rootPath, 0);
    files.sort((left, right) => left.path.localeCompare(right.path));
    if (sha256(files) !== source.treeHash) throw sourceBindingError();
    return {
      rootPath,
      treeHash: source.treeHash,
      paths: new Set(files.map(({ path }) => path)),
      fileHashes,
      fileContents,
    };
  } catch {
    throw sourceBindingError();
  }
}

export async function assertGeneratedSourceUnchanged(
  source: NonNullable<PreviewRequest["generatedSource"]>,
): Promise<void> {
  await readGeneratedSource(source);
}

async function bindGeneratedSource(
  request: Pick<PreviewRequest, "generatedSource">,
  cwd: string | undefined,
  templateFile?: string,
  parametersFile?: string,
  accepted?: GeneratedSourceSnapshot,
  outputs?: ReadonlySet<string>,
): Promise<GeneratedSourceSnapshot | undefined> {
  if (request.generatedSource === undefined) return undefined;
  const source = await readGeneratedSource({ ...request.generatedSource }, accepted, outputs);
  if (resolve(cwd ?? process.cwd()) !== source.rootPath) throw sourceBindingError();
  if (
    templateFile !== undefined &&
    resolve(source.rootPath, templateFile) !== resolve(source.rootPath, BICEP_TEMPLATE)
  ) {
    throw sourceBindingError();
  }
  for (const file of [templateFile, parametersFile]) {
    if (file === undefined) continue;
    const path = relative(source.rootPath, resolve(source.rootPath, file)).split(sep).join("/");
    if (!source.paths.has(path)) throw sourceBindingError();
  }
  return source;
}

abstract class NativeProviderBase {
  protected readonly runner: ProcessRunnerLike;
  protected readonly now: () => Date;
  protected readonly nextId: () => string;
  protected readonly currentAuthority: () => Promise<CurrentDeploymentAuthority>;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #operations = new Map<string, OperationRecordV1>();
  readonly #executionEvidence = new Map<string, ProviderExecutionEvidence>();
  readonly #policyValidations = new Map<string, PolicyValidationV1>();
  protected readonly bindingStore: PreviewBindingStore | undefined;

  protected constructor(options: NativeProviderRuntime) {
    this.runner = options.runner;
    this.currentAuthority = options.currentAuthority;
    this.now = options.now ?? (() => new Date());
    this.nextId = options.nextId ?? randomUUID;
    this.#timeoutMs = options.timeoutMs ?? 15 * 60_000;
    this.#maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    this.bindingStore = options.bindingStore;
  }

  protected async run(plan: CommandPlan): Promise<string> {
    const result = await this.runner.run({
      executable: plan.executable,
      args: plan.args,
      ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
      ...(plan.env === undefined ? {} : { env: { ...process.env, ...plan.env } }),
      timeoutMs: this.#timeoutMs,
      maxOutputBytes: this.#maxOutputBytes,
    });
    return result.stdout;
  }

  protected async validateBoundSource(
    request: NativeValidationRequest,
    track: "bicep" | "terraform",
    cwd: () => string | undefined,
    templateFile?: string,
  ): Promise<NativeValidationReceiptV1> {
    if (request.generatedSource === undefined || cwd() === undefined) throw sourceBindingError();
    const generatedSource = { ...request.generatedSource };
    const commands = NATIVE_VALIDATION_COMMANDS[track];
    let receipt: NativeValidationReceiptV1;
    let policyInput: NativeValidationRequest["policyValidation"];
    let storageBindings: NativeValidationRequest["storageSecurityBindings"];
    let parityManifest: NativeValidationRequest["resourceParityManifest"];
    let parityBinding: NativeValidationRequest["resourceParityBinding"];
    let diagnosticsTargets: NativeValidationRequest["storageDiagnosticsTargets"];
    try {
      if (track === "bicep" && request.resourceParityBinding !== undefined) {
        calculatePolicyValidationDigest(request.resourceParityBinding);
        parityBinding = structuredClone(request.resourceParityBinding);
        if (
          !Value.Check(IacBindingV1Schema, parityBinding) ||
          request.resourceParityManifest === undefined ||
          parityBinding.track !== track ||
          parityBinding.projectId !== request.projectId ||
          parityBinding.runId !== request.runId ||
          parityBinding.intentHash !== request.inputHash
        )
          throw new Error();
      }
      if (track === "bicep" && request.storageDiagnosticsTargets !== undefined) {
        calculatePolicyValidationDigest(request.storageDiagnosticsTargets);
        diagnosticsTargets = structuredClone(request.storageDiagnosticsTargets);
        if (Object.keys(diagnosticsTargets).length > 1000) throw new Error();
      }
      if (track === "bicep" && request.resourceParityManifest !== undefined) {
        calculatePolicyValidationDigest(request.resourceParityManifest);
        parityManifest = structuredClone(request.resourceParityManifest);
        if (
          !Value.Check(LogicalResourceManifestV1Schema, parityManifest) ||
          parityManifest.track !== track ||
          parityManifest.projectId !== request.projectId ||
          parityManifest.runId !== request.runId ||
          parityManifest.resources.length > 1000
        )
          throw new Error();
      }
      if (track === "bicep" && request.storageSecurityBindings !== undefined) {
        calculatePolicyValidationDigest(request.storageSecurityBindings);
        storageBindings = structuredClone(request.storageSecurityBindings);
        if (Object.keys(storageBindings).length > 1000) throw new Error();
      }
      if (request.policyValidation !== undefined) {
        calculatePolicyValidationDigest(request.policyValidation);
        policyInput = structuredClone(request.policyValidation);
        if (
          !Value.Check(PolicyPropertyMapV1Schema, policyInput.policyMap) ||
          calculatePolicyValidationDigest(policyInput.policyMap) !== request.policyHash ||
          policyInput.policyMap.projectId !== request.projectId ||
          policyInput.policyMap.runId !== request.runId
        )
          throw new Error();
      }
      const body: Omit<NativeValidationReceiptV1, "receiptHash"> = {
        schemaVersion: "1.0.0",
        projectId: request.projectId,
        runId: request.runId,
        track,
        sourceHash: request.sourceHash,
        treeHash: generatedSource.treeHash,
        policyHash: request.policyHash,
        inputHash: request.inputHash,
        ...(policyInput !== undefined && !hasActionablePolicyMappings(policyInput.policyMap)
          ? {
              policyApplicability: {
                status: "no-actionable-mappings" as const,
                policyMapContentHash: calculatePolicyValidationDigest(policyInput.policyMap),
              },
            }
          : {}),
        outcome: "pass",
        commands: commands.map((command) => ({
          validatorId: command.validatorId,
          commandHash: calculateNativeValidationCommandHash(command),
          exitCode: 0,
          signal: null,
          timedOut: false,
          outputTruncated: false,
        })),
      };
      receipt = { ...body, receiptHash: calculateNativeValidationReceiptHash(body) };
      if (!hasValidNativeValidationReceipt(receipt, body)) throw new Error();
    } catch {
      throw new IacProviderError("NATIVE_VALIDATION_INPUT_INVALID", "Native validation inputs are invalid");
    }
    const source = await bindGeneratedSource({ generatedSource }, cwd(), templateFile);
    if (source === undefined) throw sourceBindingError();
    if (track === "terraform") {
      const cache = resolve(source.rootPath, ".terraform");
      const existing = await lstat(cache).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw sourceBindingError();
      });
      if (existing !== undefined) throw sourceBindingError();
    }
    let scratchRoot: string | undefined;
    try {
      try {
        scratchRoot = await mkdtemp(resolve(await realpath(tmpdir()), "apex-native-validation-"));
        for (const path of source.paths) {
          const destination = resolve(scratchRoot, path);
          if (!destination.startsWith(`${scratchRoot}${sep}`)) throw sourceBindingError();
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await writeFile(destination, source.fileContents.get(path)!, { flag: "wx", mode: 0o600 });
        }
      } catch {
        throw sourceBindingError();
      }
      const scratch = await readGeneratedSource({ rootPath: scratchRoot, treeHash: source.treeHash });
      const outputs = new Set<string>();
      if (track === "terraform") {
        outputs.add(resolve(scratchRoot, ".terraform"));
        outputs.add(resolve(scratchRoot, ".terraform.lock.hcl"));
      }
      const verify = async (): Promise<void> => {
        if (cwd() === undefined) throw sourceBindingError();
        await bindGeneratedSource({ generatedSource }, cwd(), templateFile);
        if (track === "terraform") {
          for (const path of [".terraform", ".terraform.lock.hcl"]) {
            if (source.paths.has(path)) continue;
            const metadata = await lstat(resolve(source.rootPath, path)).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return undefined;
              throw sourceBindingError();
            });
            if (metadata !== undefined) throw sourceBindingError();
          }
        }
        await readGeneratedSource(scratch, scratch, outputs);
      };
      let compiledTemplate: string | undefined;
      for (const command of commands) {
        await verify();
        try {
          const result = await this.runner.run({
            executable: command.executable,
            args: [...command.args],
            cwd: scratchRoot,
            timeoutMs: this.#timeoutMs,
            maxOutputBytes: this.#maxOutputBytes,
          });
          if (
            result.exitCode !== 0 ||
            result.signal !== null ||
            result.timedOut !== false ||
            result.outputTruncated !== false
          )
            throw new Error();
          if (command.validatorId === "bicep:build") compiledTemplate = result.stdout;
        } catch {
          throw new IacProviderError("NATIVE_VALIDATION_FAILED", "Native validation command failed");
        } finally {
          await verify();
        }
      }
      if (parityManifest !== undefined) {
        receipt.resourceParity = validateBicepResourceParity({
          sourceHash: receipt.sourceHash,
          manifest: parityManifest,
          ...(parityBinding === undefined ? {} : { binding: parityBinding }),
          json: compiledTemplate ?? "",
        });
        const { receiptHash: previousHash, ...updated } = receipt;
        if (!previousHash) throw sourceBindingError();
        receipt.receiptHash = calculateNativeValidationReceiptHash(updated);
      }
      if (parityManifest !== undefined && parityBinding !== undefined) {
        receipt.securityBaseline = validateBicepStorageBaseline({
          sourceHash: receipt.sourceHash,
          manifest: parityManifest,
          binding: parityBinding,
          json: compiledTemplate ?? "",
        });
        const { receiptHash: previousHash, ...updated } = receipt;
        if (!previousHash) throw sourceBindingError();
        receipt.receiptHash = calculateNativeValidationReceiptHash(updated);
      }
      if (diagnosticsTargets !== undefined) {
        receipt.storageDiagnostics = Object.fromEntries(
          Object.entries(diagnosticsTargets).map(([logicalId, target]) => [
            logicalId,
            validateBicepStorageDiagnostics({
              ...target,
              sourceHash: receipt.sourceHash,
              json: compiledTemplate ?? "",
            }),
          ]),
        );
        const { receiptHash: previousHash, ...updated } = receipt;
        if (!previousHash) throw sourceBindingError();
        receipt.receiptHash = calculateNativeValidationReceiptHash(updated);
      }
      if (track === "bicep" && policyInput !== undefined && hasActionablePolicyMappings(policyInput.policyMap)) {
        let policyValidation: PolicyValidationV1;
        try {
          policyValidation = validatePolicyProperties({
            ...policyInput,
            track,
            sourceHash: receipt.sourceHash,
            policyMapHash: receipt.policyHash,
            json: compiledTemplate ?? "",
          });
          if (policyValidation.outcome !== "pass") throw new Error();
        } catch {
          throw new IacProviderError("NATIVE_VALIDATION_FAILED", "Native policy property validation failed");
        } finally {
          await verify();
        }
        receipt.policyValidation = policyValidation;
        const { receiptHash, ...updated } = receipt;
        if (!receiptHash)
          throw new IacProviderError("NATIVE_VALIDATION_FAILED", "Native validation receipt is missing");
        receipt = { ...updated, receiptHash: calculateNativeValidationReceiptHash(updated) };
      }
      if (storageBindings !== undefined && Object.keys(storageBindings).length > 0) {
        const observations = validateStorageSecurityBindings({
          track,
          bindings: storageBindings,
          sourceHash: receipt.sourceHash,
          json: compiledTemplate ?? "",
        });
        const storageSecurity = Object.fromEntries(
          Object.entries(observations).map(([logicalId, observation]) => {
            return [logicalId, { ...observation, results: [...observation.results] }];
          }),
        );
        await verify();
        const { receiptHash, ...body } = receipt;
        if (!receiptHash)
          throw new IacProviderError("NATIVE_VALIDATION_FAILED", "Native validation receipt is missing");
        const updated = { ...body, storageSecurity };
        receipt = { ...updated, receiptHash: calculateNativeValidationReceiptHash(updated) };
      }
      return receipt;
    } finally {
      if (scratchRoot !== undefined) {
        await rm(scratchRoot, { recursive: true, force: true }).catch(() => {
          throw sourceBindingError();
        });
      }
    }
  }

  protected async authorize(
    track: "bicep" | "terraform",
    operation: "apply" | "destroy",
    preview: DeploymentPreviewV1,
    approval: ApprovalEvidenceV1,
    suppliedAuthority: CurrentDeploymentAuthority,
    latestPreviewHash: string | undefined,
  ): Promise<CurrentDeploymentAuthority> {
    const authority = await this.currentAuthority();
    if (
      authority.head !== suppliedAuthority.head ||
      authority.dependencyRevision !== suppliedAuthority.dependencyRevision ||
      authority.ownerEpoch !== suppliedAuthority.ownerEpoch ||
      authority.previousOwnerEpoch !== suppliedAuthority.previousOwnerEpoch ||
      authority.writerTransferClaimHash !== suppliedAuthority.writerTransferClaimHash ||
      authority.recipientIdentity !== suppliedAuthority.recipientIdentity
    ) {
      throw new IacProviderError("PREVIEW_OWNER_EPOCH_MISMATCH", "Supplied authority is not the current authority");
    }
    authorizeDeploymentPreview({
      operation,
      track,
      preview,
      approval,
      authority,
      now: this.now(),
      ...(latestPreviewHash === undefined ? {} : { latestPreviewHash }),
    });
    return authority;
  }

  protected record(
    operation: "apply" | "destroy",
    preview: DeploymentPreviewV1,
    approval: ApprovalEvidenceV1,
    authority: CurrentDeploymentAuthority,
    providerOperationId?: string,
    validatorIds: readonly string[] = [],
  ): OperationRecordV1 {
    const operationId = this.nextId();
    const record: OperationRecordV1 = {
      schemaVersion: "1.0.0",
      operationId,
      projectId: preview.projectId,
      runId: preview.runId,
      ...(providerOperationId === undefined ? {} : { providerOperationId }),
      operation,
      state: "succeeded",
      previewHash: preview.previewHash,
      approvalHash: sha256(approval),
      ownerEpoch: authority.ownerEpoch,
      updatedAt: this.now().toISOString(),
    };
    this.#operations.set(operationId, record);
    this.#executionEvidence.set(operationId, {
      mode: "native",
      operationId,
      previewHash: preview.previewHash,
      validatorIds: [...validatorIds],
    });
    return record;
  }

  async reconcile(operationId: string): Promise<OperationRecordV1 | undefined> {
    return this.#operations.get(operationId);
  }

  executionEvidence(operationId: string): ProviderExecutionEvidence | undefined {
    return this.#executionEvidence.get(operationId);
  }

  policyValidation(previewHash: string): PolicyValidationV1 | undefined {
    const receipt = this.#policyValidations.get(previewHash);
    return receipt === undefined ? undefined : structuredClone(receipt);
  }

  protected evaluatePolicy(
    track: "bicep" | "terraform",
    request: PreviewRequest,
    json: string,
    blockers: string[],
  ): NativePolicyBinding {
    const input = request.policyValidation;
    if (input === undefined || !hasActionablePolicyMappings(input.policyMap)) return {};
    const receipt = validatePolicyProperties({
      ...input,
      track,
      sourceHash: request.iacHash,
      policyMapHash: request.policyHash,
      json,
    });
    if (receipt.projectId !== request.projectId || receipt.runId !== request.runId) {
      blockers.push("Policy validation project/run does not match the preview");
    }
    for (const result of receipt.results) {
      if (result.outcome !== "pass") {
        blockers.push(`Policy validation mapping ${result.mappingIndex}: ${result.outcome} (${result.reason})`);
      }
    }
    return {
      policyValidation: receipt,
      policyValidationBinding: nativePolicyValidationBinding(receipt),
    };
  }

  protected rememberPolicy(preview: DeploymentPreviewV1, binding: NativePolicyBinding): void {
    if (binding.policyValidation !== undefined) {
      this.#policyValidations.set(preview.previewHash, structuredClone(binding.policyValidation));
    }
  }

  protected verifyPolicy(preview: DeploymentPreviewV1, binding: NativePolicyBinding): void {
    const receipt = binding.policyValidation;
    const expected = binding.policyValidationBinding;
    if (receipt === undefined && expected === undefined) return;
    if (
      receipt === undefined ||
      expected === undefined ||
      !hasValidPolicyValidation(receipt, expected) ||
      receipt.receiptHash !== expected.receiptHash ||
      receipt.track !== preview.track ||
      receipt.sourceHash !== preview.iacHash ||
      receipt.policyMapHash !== preview.policyHash ||
      receipt.projectId !== preview.projectId ||
      receipt.runId !== preview.runId ||
      preview.operation !== "apply" ||
      receipt.outcome !== "pass"
    ) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Policy validation receipt does not match the preview");
    }
  }

  protected previewKey(request: PreviewRequest, operation: "apply" | "destroy"): string {
    return `${request.projectId}\u0000${request.runId}\u0000${operation}`;
  }

  protected createPreview(
    track: "bicep" | "terraform",
    operation: "apply" | "destroy",
    request: PreviewRequest,
    normalized: NormalizedPreview,
    extra: Partial<Pick<DeploymentPreviewV1, "artifactHash" | "stateLineage" | "stateSerial">> = {},
  ): DeploymentPreviewV1 {
    const createdAt = this.now();
    const base = {
      schemaVersion: "1.0.0" as const,
      projectId: request.projectId,
      runId: request.runId,
      environment: request.environment,
      track,
      operation,
      target: request.target,
      commit: request.commit,
      dependencyRevision: request.dependencyRevision,
      ownerEpoch: request.ownerEpoch,
      inputHash: request.inputHash,
      iacHash: request.iacHash,
      policyHash: request.policyHash,
      ...extra,
      changes: normalized.changes,
      blockers: [...(request.blockers ?? []), ...normalized.blockers],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + request.ttlMs).toISOString(),
    };
    return { ...base, previewHash: sha256(base) };
  }
}

const AZD_GROUP_SCOPE =
  /^\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resourceGroups\/([^/]+)$/iu;
const AZD_PROCESS_ENV = { AZD_SKIP_UPDATE_CHECK: "true" } as const;

interface ApprovedAzdTarget {
  readonly projectId: string;
  readonly runId: string;
  readonly subscriptionId: string;
  readonly resourceGroup: string;
  readonly scope: string;
}

interface AzdOwnedState {
  readonly taggedGroups: readonly string[];
  readonly resources: readonly AzdOwnedResource[];
  readonly hash: string;
}

/**
 * The only Bicep executor: azd previews with `azd provision --preview`, applies with `azd provision` and destroys with
 * `azd down`, each bound to the azd binding, the pinned azd version and the approved Azure identity. Resources belong
 * to the azd environment through the `azd-env-name` tag of the approved resource group, which is how azd itself finds
 * them; `azd down` deletes that whole group, so the destroy preview lists everything in it.
 */
export class AzdBicepProvider extends NativeProviderBase implements IacProvider {
  readonly track = "bicep" as const;
  readonly #target: AzdBicepTarget;
  readonly #reads = new AzureCliReadAdapter();
  readonly #bindings = new Map<string, BicepPreviewBinding>();
  readonly #targets = new Map<string, ApprovedAzdTarget>();

  constructor(options: AzdBicepProviderOptions) {
    super(options);
    if (!Value.Check(EnvironmentSchema, options.target.environmentName))
      throw new AzdBindingError("AZD_BINDING_INPUT_INVALID", "The azd environment name is invalid");
    this.#target = options.target;
  }

  /**
   * Verifies that the configured Bicep template compiles cleanly.
   * Full source-bound policy and resource-parity validation runs through `validateSource()`.
   */
  async validate(): Promise<readonly string[]> {
    await this.#compiledTemplate();
    return [];
  }

  async validateSource(request: NativeValidationRequest): Promise<NativeValidationReceiptV1> {
    return await this.validateBoundSource(request, this.track, () => this.#target.projectRoot, BICEP_TEMPLATE);
  }

  approvalMaterial(previewHash: string): AzdApprovalMaterial | undefined {
    for (const binding of this.#bindings.values()) {
      if (binding.preview.previewHash !== previewHash) continue;
      const material = describeAzdBinding(binding.azdBinding);
      return binding.preview.operation === "destroy"
        ? {
            ...material,
            warnings: [
              ...material.warnings,
              "azd down deletes the entire approved resource group and everything in it, including child and extension resources that Azure does not list and so are not shown above. It runs without --purge, so soft-deleted resources such as Key Vaults are not purged and keep their names reserved.",
            ],
          }
        : material;
    }
    return undefined;
  }

  async previewApply(request: PreviewRequest): Promise<DeploymentPreviewV1> {
    if (request.policyValidation !== undefined) {
      try {
        calculatePolicyValidationDigest(request.policyValidation);
        request = { ...request, policyValidation: structuredClone(request.policyValidation) };
      } catch {
        throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Bicep policy validation inputs are invalid");
      }
    }
    const target = this.#approvedTarget(request);
    const source = await bindGeneratedSource(request, this.#target.projectRoot, BICEP_TEMPLATE);
    const azdVersion = await this.#assertAzd();
    await this.#ensureEnvironment(target);
    const inspected = await this.#inspect(target, azdVersion);
    await this.#assertIdentity(inspected);
    const [stdout, owned] = await Promise.all([
      this.run(this.#azdPlan("provision-preview", inspected)),
      this.#ownedState(target),
    ]);
    const normalized = normalizeAzdPreview(stdout, request.resources);
    normalized.blockers.push(...this.#ownershipBlockers(target, owned));
    await this.#assertInputsUnchanged(inspected, target, azdVersion);
    if (source !== undefined) await readGeneratedSource(source, source);
    let policy: NativePolicyBinding = {};
    if (request.policyValidation?.policyMap.mappings.length) {
      let compiled = "";
      try {
        compiled = await this.#compiledTemplate();
      } catch {
        normalized.blockers.push("Policy validation compiler output is unavailable");
      }
      policy = this.evaluatePolicy(this.track, request, compiled, normalized.blockers);
    }
    return await this.#bind(request, "apply", target, normalized, inspected, owned, policy);
  }

  async previewDestroy(request: PreviewRequest): Promise<DeploymentPreviewV1> {
    const target = this.#approvedTarget(request);
    const source = await bindGeneratedSource(request, this.#target.projectRoot, BICEP_TEMPLATE);
    const azdVersion = await this.#assertAzd();
    await this.#ensureEnvironment(target);
    const inspected = await this.#inspect(target, azdVersion);
    await this.#assertIdentity(inspected);
    const listedState = await this.#ownedState(target);
    // Accepted child resources that a group listing omits are shown too; unaccepted children of listed resources are
    // deleted with them and cannot be enumerated, which the approval material states.
    const owned: AzdOwnedState = {
      ...listedState,
      resources: [
        ...listedState.resources,
        ...(await this.#readUnlisted(
          target,
          listedState.resources,
          request.resources.map(({ resourceId }) => resourceId),
        )),
      ],
    };
    const normalized: NormalizedPreview = {
      changes: owned.resources.map(({ resourceId }) => ({
        resourceId,
        action: "delete" as const,
        material: true,
        details: "azd down deletes the whole resource group",
      })),
      blockers: this.#ownershipBlockers(target, owned),
    };
    await this.#assertInputsUnchanged(inspected, target, azdVersion);
    if (source !== undefined) await readGeneratedSource(source, source);
    return await this.#bind(request, "destroy", target, normalized, inspected, owned);
  }

  async apply(
    preview: DeploymentPreviewV1,
    approval: ApprovalEvidenceV1,
    authority: CurrentDeploymentAuthority,
  ): Promise<OperationRecordV1> {
    return await this.#execute("apply", preview, approval, authority);
  }

  async destroy(
    preview: DeploymentPreviewV1,
    approval: ApprovalEvidenceV1,
    authority: CurrentDeploymentAuthority,
  ): Promise<OperationRecordV1> {
    return await this.#execute("destroy", preview, approval, authority);
  }

  async inventory(projectId: string, runId: string): Promise<ResourceInventoryV1> {
    const target = this.#targets.get(`${projectId}\u0000${runId}`);
    if (target === undefined)
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "No approved azd target is known for this run");
    const owned = await this.#ownedState(target);
    if (owned.resources.length > 0 && !this.#isTagged(target, owned))
      throw new IacProviderError(
        "PREVIEW_BLOCKED",
        "The approved resource group is not tagged for the azd environment, so ownership cannot be proven",
      );
    const resources = [...owned.resources, ...(await this.#unlistedPlannedResources(target, owned.resources))];
    return {
      schemaVersion: "1.0.0",
      projectId,
      runId,
      deploymentHash: sha256(resources),
      collectedAt: this.now().toISOString(),
      resources: resources.map((resource) => ({ ...resource, properties: { ...resource.properties } })),
    };
  }

  /**
   * A group listing omits child and extension resources, so the given IDs the listing lacks are read one by one.
   * Anything Azure does not return is left out, which the inventory coverage check then reports.
   */
  async #readUnlisted(
    target: ApprovedAzdTarget,
    listed: readonly AzdOwnedResource[],
    resourceIds: readonly string[],
  ): Promise<readonly AzdOwnedResource[]> {
    const known = new Set(listed.map(({ resourceId }) => resourceId.toLowerCase()));
    const found: AzdOwnedResource[] = [];
    for (const resourceId of resourceIds) {
      if (known.has(resourceId.toLowerCase())) continue;
      known.add(resourceId.toLowerCase());
      let stdout: string;
      try {
        stdout = await this.run(this.#reads.resourceById(resourceId));
      } catch (error) {
        if (error instanceof ProcessRunnerError && /NotFound|could not be found/iu.test(error.result?.stderr ?? ""))
          continue;
        throw error;
      }
      found.push(...normalizeAzdGroupResources(`[${stdout}]`, target.scope));
    }
    return found;
  }

  /** The material resources of the latest approved apply preview, which a group listing may omit. */
  async #unlistedPlannedResources(
    target: ApprovedAzdTarget,
    listed: readonly AzdOwnedResource[],
  ): Promise<readonly AzdOwnedResource[]> {
    const key = `${target.projectId}\u0000${target.runId}\u0000apply`;
    const latest =
      this.#bindings.get(key) ?? (await this.bindingStore?.loadLatest?.(target.projectId, target.runId, "apply"));
    if (latest?.kind !== "bicep") return [];
    return await this.#readUnlisted(
      target,
      listed,
      latest.preview.changes
        .filter(({ material, action }) => material && action !== "delete" && action !== "no-op")
        .map(({ resourceId }) => resourceId),
    );
  }

  #approvedTarget(request: Pick<PreviewRequest, "projectId" | "runId" | "target">): ApprovedAzdTarget {
    const match = AZD_GROUP_SCOPE.exec(request.target);
    if (match === null)
      throw new AzdBindingError(
        "AZD_PROJECT_UNSUPPORTED",
        "The azd executor requires an exact resource-group target scope",
      );
    const target: ApprovedAzdTarget = {
      projectId: request.projectId,
      runId: request.runId,
      subscriptionId: match[1]!.toLowerCase(),
      resourceGroup: match[2]!,
      scope: request.target,
    };
    this.#targets.set(`${request.projectId}\u0000${request.runId}`, target);
    return target;
  }

  #azdPlan(operation: "provision-preview" | "provision" | "down", binding: AzdBindingV1): CommandPlan {
    return {
      executable: "azd",
      args: buildAzdArguments(binding.executionEnvelope, operation, this.#target.projectRoot),
      cwd: this.#target.projectRoot,
      env: AZD_PROCESS_ENV,
    };
  }

  /** Fails closed unless the installed azd is exactly the pinned release. */
  async #assertAzd(): Promise<string> {
    let found = true;
    let installedVersion: string | undefined;
    try {
      const stdout = await this.run({ executable: "azd", args: ["version"], env: AZD_PROCESS_ENV });
      installedVersion = /\bazd version (\d+\.\d+\.\d+)(?:\s|$)/u.exec(stdout)?.[1];
    } catch (error) {
      if (error instanceof ProcessRunnerError && error.code === "PROCESS_SPAWN_ERROR") found = false;
    }
    const result = evaluateAzdPrerequisite({ pinnedVersion: this.#target.azdVersion, found, installedVersion });
    if (!result.ok || installedVersion === undefined)
      throw new AzdBindingError(
        result.code ?? "AZD_VERSION_UNAVAILABLE",
        `${result.value}. ${result.remedy ?? ""}`.trim(),
      );
    return installedVersion;
  }

  /** Creates the allowlisted, non-secret azd environment file when the project has none; an existing one is bound as is. */
  async #ensureEnvironment(target: ApprovedAzdTarget): Promise<void> {
    const azure = resolve(this.#target.projectRoot, ".azure");
    const directory = resolve(azure, this.#target.environmentName);
    const existing = await lstat(azure).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing !== undefined && (!existing.isDirectory() || existing.isSymbolicLink()))
      throw new AzdBindingError("AZD_PATH_UNSAFE", "The azd environment directory is not a plain directory");
    const lines = [
      ["AZURE_ENV_NAME", this.#target.environmentName],
      ["AZURE_LOCATION", this.#target.location.toLowerCase()],
      ["AZURE_RESOURCE_GROUP", target.resourceGroup],
      ["AZURE_SUBSCRIPTION_ID", target.subscriptionId],
      ["AZURE_TENANT_ID", this.#target.tenantId.toLowerCase()],
    ].map(([key, value]) => `${key}="${value}"\n`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory())
      throw new AzdBindingError("AZD_PATH_UNSAFE", "The azd environment directory is not a plain directory");
    try {
      await writeFile(resolve(directory, ".env"), lines.join(""), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  #bindingRequest(target: ApprovedAzdTarget, azdVersion: string): AzdBindingRequest {
    return {
      ...(this.#target.cloud === undefined ? {} : { cloud: this.#target.cloud }),
      projectId: target.projectId,
      runId: target.runId,
      projectRoot: this.#target.projectRoot,
      environmentName: this.#target.environmentName,
      azdVersion,
      target: {
        subscriptionId: target.subscriptionId,
        location: this.#target.location,
        tenantId: this.#target.tenantId,
        resourceGroup: target.resourceGroup,
      },
    };
  }

  async #inspect(target: ApprovedAzdTarget, azdVersion: string): Promise<AzdBindingV1> {
    const binding = await inspectAzdBicepProject(this.#bindingRequest(target, azdVersion));
    if (binding.infra.layered)
      throw new AzdBindingError(
        "AZD_LAYER_UNSUPPORTED",
        "azd previews one layer at a time, so a layered project cannot be previewed as a whole; use a single infrastructure root",
      );
    return binding;
  }

  async #assertInputsUnchanged(
    accepted: AzdBindingV1,
    target: ApprovedAzdTarget,
    azdVersion: string,
  ): Promise<AzdBindingV1> {
    try {
      return await assertAzdBindingUnchanged(accepted, this.#bindingRequest(target, azdVersion));
    } catch (error) {
      if (error instanceof AzdBindingError) throw new IacProviderError("PREVIEW_HASH_MISMATCH", error.message);
      throw error;
    }
  }

  /** The cloud, tenant and default subscription the Azure CLI reports must equal the approved target before any run. */
  async #assertIdentity(binding: AzdBindingV1): Promise<void> {
    let account: Record<string, unknown> = {};
    try {
      account = parseJsonProcessOutput("azure-read", await this.run(this.#reads.account())) as Record<string, unknown>;
    } catch {
      // An unreadable account is reported by the preflight as a missing value.
    }
    const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
    assertAzdIdentityMatchesBinding(
      {
        ...(text(account.environmentName) === undefined ? {} : { cloud: text(account.environmentName)! }),
        ...(text(account.tenantId) === undefined ? {} : { tenantId: text(account.tenantId)! }),
        ...(text(account.id) === undefined ? {} : { azureCliDefaultSubscriptionId: text(account.id)! }),
      },
      binding,
    );
  }

  async #readOrMissing(plan: CommandPlan): Promise<string | undefined> {
    try {
      return await this.run(plan);
    } catch (error) {
      if (error instanceof ProcessRunnerError && /ResourceGroupNotFound/u.test(error.result?.stderr ?? error.message))
        return undefined;
      throw error;
    }
  }

  async #ownedState(target: ApprovedAzdTarget): Promise<AzdOwnedState> {
    const [groups, resources] = await Promise.all([
      this.run(this.#reads.taggedResourceGroups(target.subscriptionId, this.#target.environmentName)),
      this.#readOrMissing(this.#reads.resourceGroupResources(target.subscriptionId, target.resourceGroup)),
    ]);
    const { taggedGroups } = normalizeAzdTaggedGroups(groups, this.#target.environmentName);
    const listed = resources === undefined ? [] : normalizeAzdGroupResources(resources, target.scope);
    return {
      taggedGroups,
      resources: listed,
      hash: sha256({ taggedGroups: taggedGroups.map((name) => name.toLowerCase()), resources: listed }),
    };
  }

  #isTagged(target: ApprovedAzdTarget, owned: AzdOwnedState): boolean {
    return owned.taggedGroups.some((name) => name.toLowerCase() === target.resourceGroup.toLowerCase());
  }

  #ownershipBlockers(target: ApprovedAzdTarget, owned: AzdOwnedState): string[] {
    const blockers: string[] = [];
    if (!this.#isTagged(target, owned))
      blockers.push(
        `The approved resource group is not tagged azd-env-name=${this.#target.environmentName}; azd finds an environment's resources through that tag`,
      );
    const others = owned.taggedGroups.filter((name) => name.toLowerCase() !== target.resourceGroup.toLowerCase());
    if (others.length > 0)
      blockers.push(
        `Other resource groups carry azd-env-name=${this.#target.environmentName}: ${others.join(", ")}; the environment must own only the approved group`,
      );
    return blockers;
  }

  async #bind(
    request: PreviewRequest,
    operation: "apply" | "destroy",
    target: ApprovedAzdTarget,
    normalized: NormalizedPreview,
    azdBinding: AzdBindingV1,
    owned: AzdOwnedState,
    policy: NativePolicyBinding = {},
  ): Promise<DeploymentPreviewV1> {
    const providerBindingHash = this.#providerBindingHash(azdBinding.bindingHash, owned.hash, policy);
    const preview = this.createPreview(this.track, operation, request, normalized, {
      artifactHash: providerBindingHash,
    });
    const binding: BicepPreviewBinding = {
      kind: "bicep",
      preview,
      providerBindingHash,
      azdBinding,
      ownedStateHash: owned.hash,
      ...policy,
    };
    this.#targets.set(`${target.projectId}\u0000${target.runId}`, target);
    this.#bindings.set(this.previewKey(request, operation), binding);
    await this.bindingStore?.save(preview.previewHash, binding);
    this.rememberPolicy(preview, binding);
    return preview;
  }

  #providerBindingHash(azdBindingHash: string, ownedStateHash: string, policy: NativePolicyBinding): string {
    return sha256({
      azdBindingHash,
      ownedStateHash,
      ...(policy.policyValidationBinding === undefined ? {} : { policyValidation: policy.policyValidationBinding }),
    });
  }

  async #compiledTemplate(): Promise<string> {
    return await this.run({
      executable: "bicep",
      args: ["build", BICEP_TEMPLATE, "--stdout"],
      cwd: this.#target.projectRoot,
    });
  }

  async #execute(
    operation: "apply" | "destroy",
    preview: DeploymentPreviewV1,
    approval: ApprovalEvidenceV1,
    suppliedAuthority: CurrentDeploymentAuthority,
  ): Promise<OperationRecordV1> {
    const key = `${preview.projectId}\u0000${preview.runId}\u0000${operation}`;
    const restoredLatest = await this.bindingStore?.loadLatest?.(preview.projectId, preview.runId, operation);
    const latestBinding = this.#bindings.get(key) ?? (restoredLatest?.kind === "bicep" ? restoredLatest : undefined);
    let binding = latestBinding;
    if (binding === undefined) {
      const restored = await this.bindingStore?.load(preview.previewHash);
      if (restored?.kind === "bicep") binding = restored;
    }
    const authority = await this.authorize(
      this.track,
      operation,
      preview,
      approval,
      suppliedAuthority,
      latestBinding?.preview.previewHash ?? binding?.preview.previewHash,
    );
    if (binding === undefined || binding.preview.previewHash !== preview.previewHash) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "No exact azd binding is available for this preview");
    }
    this.verifyPolicy(preview, binding);
    if (
      binding.policyValidationBinding !== undefined &&
      createHash("sha256")
        .update(await this.#compiledTemplate())
        .digest("hex") !== binding.policyValidationBinding.inputHash
    ) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Bicep compiler output changed after policy validation");
    }
    const accepted = binding.azdBinding;
    const environment = accepted.environment;
    if (
      preview.artifactHash !== binding.providerBindingHash ||
      preview.artifactHash !== this.#providerBindingHash(accepted.bindingHash, binding.ownedStateHash, binding) ||
      accepted.projectId !== preview.projectId ||
      accepted.runId !== preview.runId ||
      environment.name !== this.#target.environmentName ||
      environment.target.resourceGroup === undefined
    ) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "The azd binding does not match the approved preview");
    }
    const target: ApprovedAzdTarget = {
      projectId: preview.projectId,
      runId: preview.runId,
      subscriptionId: environment.target.subscriptionId,
      resourceGroup: environment.target.resourceGroup,
      scope: preview.target,
    };
    if (
      `/subscriptions/${target.subscriptionId}/resourceGroups/${target.resourceGroup}`.toLowerCase() !==
      preview.target.toLowerCase()
    )
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "The azd binding does not match the approved target");
    const azdVersion = await this.#assertAzd();
    if (azdVersion !== accepted.azdVersion)
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "The installed azd is not the version bound at preview");
    const current = await this.#assertInputsUnchanged(accepted, target, azdVersion);
    await this.#assertIdentity(current);
    const owned = await this.#ownedState(target);
    if (owned.hash !== binding.ownedStateHash) {
      throw new IacProviderError(
        "PREVIEW_HASH_MISMATCH",
        "The azd environment's resource group or resources changed after preview",
      );
    }
    this.#targets.set(`${target.projectId}\u0000${target.runId}`, target);
    this.rememberPolicy(preview, binding);
    await this.run(this.#azdPlan(operation === "apply" ? "provision" : "down", current));
    return this.record(operation, preview, approval, authority, undefined, ["deploy:bicep-azd-execution"]);
  }
}

export class NativeTerraformProvider extends NativeProviderBase implements IacProvider {
  readonly track = "terraform" as const;
  readonly #target: TerraformNativeTarget;
  readonly #commands = new TerraformCommandAdapter();
  readonly #bindings = new Map<string, TerraformPreviewBinding>();
  readonly #keyProvider: (() => Promise<Uint8Array>) | undefined;
  readonly #artifactStore: EncryptedPlanArtifactStore | undefined;
  readonly #transport: LocalEncryptedPlanTransport;

  constructor(options: NativeTerraformProviderOptions) {
    super(options);
    this.#target = options.target;
    this.#keyProvider = options.keyProvider;
    this.#artifactStore = options.artifactStore;
    this.#transport = options.transport ?? new LocalEncryptedPlanTransport(this.now);
  }

  async validate(): Promise<readonly string[]> {
    await this.run(this.#commands.init(this.#target.cwd, false));
    for (const command of this.#commands.validate(this.#target.cwd)) {
      await this.run(command);
    }
    return [];
  }

  async validateSource(request: NativeValidationRequest): Promise<NativeValidationReceiptV1> {
    return await this.validateBoundSource(request, this.track, () => this.#target.cwd);
  }

  async previewApply(request: PreviewRequest): Promise<DeploymentPreviewV1> {
    return await this.#preview(request, "apply");
  }

  async previewDestroy(request: PreviewRequest): Promise<DeploymentPreviewV1> {
    return await this.#preview(request, "destroy");
  }

  async apply(
    preview: DeploymentPreviewV1,
    approval: ApprovalEvidenceV1,
    authority: CurrentDeploymentAuthority,
  ): Promise<OperationRecordV1> {
    return await this.#execute("apply", preview, approval, authority);
  }

  async destroy(
    preview: DeploymentPreviewV1,
    approval: ApprovalEvidenceV1,
    authority: CurrentDeploymentAuthority,
  ): Promise<OperationRecordV1> {
    return await this.#execute("destroy", preview, approval, authority);
  }

  async inventory(projectId: string, runId: string): Promise<ResourceInventoryV1> {
    const stdout = await this.run({ executable: "terraform", args: ["show", "-json"], cwd: this.#target.cwd });
    const root = parseJsonProcessOutput("terraform-plan", stdout) as Record<string, unknown>;
    const values = root.values as Record<string, unknown> | undefined;
    const rootModule = values?.root_module as Record<string, unknown> | undefined;
    const collectResources = (module: Record<string, unknown> | undefined): readonly unknown[] => [
      ...(Array.isArray(module?.resources) ? module.resources : []),
      ...(Array.isArray(module?.child_modules)
        ? module.child_modules.flatMap((child) =>
            child !== null && typeof child === "object" && !Array.isArray(child)
              ? collectResources(child as Record<string, unknown>)
              : [],
          )
        : []),
    ];
    const resources = collectResources(rootModule);
    const normalized = resources.flatMap((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
      const resource = entry as Record<string, unknown>;
      const address = typeof resource.address === "string" ? resource.address : undefined;
      if (address === undefined) return [];
      return [
        {
          logicalId: address,
          resourceId: typeof resource.provider_name === "string" ? `${resource.provider_name}:${address}` : address,
          type: typeof resource.type === "string" ? resource.type : "unknown",
          location: "terraform-managed",
          properties: secretFreeProperties(resource.values, resource.sensitive_values),
        },
      ];
    });
    return {
      schemaVersion: "1.0.0",
      projectId,
      runId,
      deploymentHash: sha256(normalized),
      collectedAt: this.now().toISOString(),
      resources: normalized,
    };
  }

  attestation(previewHash: string): TerraformPlanAttestation | undefined {
    for (const binding of this.#bindings.values()) {
      if (binding.preview.previewHash === previewHash) return binding.attestation;
    }
    return undefined;
  }

  async #preview(request: PreviewRequest, operation: "apply" | "destroy"): Promise<DeploymentPreviewV1> {
    if (this.#keyProvider === undefined || this.#artifactStore === undefined || this.bindingStore === undefined) {
      throw new IacProviderError(
        "PREVIEW_HASH_MISMATCH",
        "Terraform local/reference plan transport requires injected key, artifact, and binding stores",
      );
    }
    if (operation === "apply" && request.policyValidation !== undefined) {
      try {
        calculatePolicyValidationDigest(request.policyValidation);
        request = { ...request, policyValidation: structuredClone(request.policyValidation) };
      } catch {
        throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Terraform policy validation inputs are invalid");
      }
    }
    const source = await bindGeneratedSource(request, this.#target.cwd);
    const requestedPlanPath = this.#target.planPath(request, operation);
    const planPath = source === undefined ? requestedPlanPath : resolve(source.rootPath, requestedPlanPath);
    const outputs = new Set<string>();
    if (source !== undefined) {
      const relativePlanPath = relative(source.rootPath, planPath).split(sep).join("/");
      if (
        source.paths.has(relativePlanPath) ||
        planPath === source.rootPath ||
        [...source.paths].some((path) => path.startsWith(`${relativePlanPath}/`)) ||
        /\.(?:tf|tfvars)(?:\.json)?$/i.test(planPath) ||
        relativePlanPath === ".terraform.lock.hcl" ||
        relativePlanPath === ".terraform" ||
        relativePlanPath.startsWith(".terraform/") ||
        [...source.paths].some((path) => path.startsWith(".terraform/"))
      ) {
        throw sourceBindingError();
      }
      outputs.add(planPath);
      outputs.add(resolve(source.rootPath, ".terraform"));
      outputs.add(resolve(source.rootPath, ".terraform.lock.hcl"));
    }
    await this.run(this.#commands.init(this.#target.cwd, true));
    const policyExpected = operation === "apply" && Boolean(request.policyValidation?.policyMap.mappings.length);
    const initialConfigHash = policyExpected ? await this.#target.configHash() : undefined;
    const initialLockfileHash = this.#target.lockfileHash;
    const stateIdentity = terraformStateIdentityOutput(await this.run(this.#commands.statePull(this.#target.cwd)));
    await this.run(this.#commands.preview(this.#target.cwd, planPath, operation === "destroy"));
    try {
      const planBytes = await readFile(planPath);
      const planDigest = createHash("sha256").update(planBytes).digest("hex");
      const showOutput = await this.run(this.#commands.showJson(this.#target.cwd, planPath));
      const normalized = normalizeTerraformPlan(parseJsonProcessOutput("terraform-plan", showOutput));
      const policy = policyExpected ? this.evaluatePolicy(this.track, request, showOutput, normalized.blockers) : {};
      if (
        policyExpected &&
        createHash("sha256")
          .update(await readFile(planPath))
          .digest("hex") !== planDigest
      ) {
        normalized.blockers.push("Terraform saved plan changed during policy validation preview");
      }
      const authority = await this.currentAuthority();
      if (
        authority.ownerEpoch !== request.ownerEpoch ||
        authority.head !== request.commit ||
        authority.dependencyRevision !== request.dependencyRevision
      ) {
        throw new IacProviderError("PREVIEW_OWNER_EPOCH_MISMATCH", "Preview request authority is stale");
      }
      const executionRecipient = request.executionRecipientIdentity ?? authority.recipientIdentity;
      const encrypted = this.#transport.encrypt(planBytes, await this.#keyProvider(), {
        recipient: executionRecipient,
        ttlMs: request.ttlMs,
      });
      const artifactRef = `${request.projectId}/${request.runId}/${operation}/${planDigest}.tfplan.enc`;
      const configHash = await this.#target.configHash();
      if (source !== undefined) {
        if (resolve(this.#target.cwd) !== source.rootPath) throw sourceBindingError();
        await readGeneratedSource(source, source, outputs);
      }
      if (policyExpected && (configHash !== initialConfigHash || this.#target.lockfileHash !== initialLockfileHash)) {
        normalized.blockers.push("Terraform configuration changed during policy validation preview");
      }
      const artifactHash = sha256({
        planDigest,
        configHash,
        lockfileHash: this.#target.lockfileHash,
        recipient: executionRecipient,
        artifactRef,
        ...(policy.policyValidationBinding === undefined ? {} : { policyValidation: policy.policyValidationBinding }),
      });
      const preview = this.createPreview(this.track, operation, request, normalized, {
        artifactHash,
        ...stateIdentity,
      });
      const createdAt = this.now();
      const attestation: TerraformPlanAttestation = {
        schemaVersion: "1.0.0",
        projectId: request.projectId,
        runId: request.runId,
        track: this.track,
        previewHash: preview.previewHash,
        inputHash: request.inputHash,
        iacHash: request.iacHash,
        policyHash: request.policyHash,
        configHash,
        lockfileHash: this.#target.lockfileHash,
        recipient: executionRecipient,
        planDigest,
        artifactRef,
        ...(preview.stateLineage === undefined ? {} : { stateLineage: preview.stateLineage }),
        ...(preview.stateSerial === undefined ? {} : { stateSerial: preview.stateSerial }),
        transport: {
          encrypted: true,
          implementation: "local-reference",
          algorithm: "aes-256-gcm",
          recipient: executionRecipient,
          mediaType: "application/vnd.apex.terraform-plan",
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        },
        createdAt: createdAt.toISOString(),
        expiresAt: preview.expiresAt,
      };
      const binding: TerraformPreviewBinding = { kind: "terraform", preview, attestation, ...policy };
      await this.#artifactStore.put(artifactRef, encrypted);
      this.#bindings.set(this.previewKey(request, operation), binding);
      await this.bindingStore.save(preview.previewHash, binding);
      this.rememberPolicy(preview, binding);
      return preview;
    } finally {
      await rm(planPath, { force: true });
    }
  }

  async #execute(
    operation: "apply" | "destroy",
    preview: DeploymentPreviewV1,
    approval: ApprovalEvidenceV1,
    suppliedAuthority: CurrentDeploymentAuthority,
  ): Promise<OperationRecordV1> {
    let binding = this.#bindings.get(`${preview.projectId}\u0000${preview.runId}\u0000${operation}`);
    if (binding === undefined) {
      const restored = await this.bindingStore?.load(preview.previewHash);
      if (restored?.kind === "terraform") binding = restored;
    }
    const authority = await this.authorize(
      this.track,
      operation,
      preview,
      approval,
      suppliedAuthority,
      binding?.preview.previewHash,
    );
    if (binding === undefined) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "No exact saved plan is bound to this preview");
    }
    this.verifyPolicy(preview, binding);
    if (binding.attestation.recipient !== authority.recipientIdentity) {
      throw new IacProviderError("APPROVAL_RECIPIENT_MISMATCH", "Saved plan recipient is not the current authority");
    }
    if (
      binding.attestation.configHash !== (await this.#target.configHash()) ||
      binding.attestation.lockfileHash !== this.#target.lockfileHash ||
      binding.attestation.inputHash !== preview.inputHash ||
      binding.attestation.iacHash !== preview.iacHash ||
      binding.attestation.policyHash !== preview.policyHash ||
      binding.attestation.previewHash !== preview.previewHash ||
      binding.attestation.stateLineage !== preview.stateLineage ||
      binding.attestation.stateSerial !== preview.stateSerial
    ) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Saved plan attestation does not match the preview");
    }
    const currentState = terraformStateIdentityOutput(await this.run(this.#commands.statePull(this.#target.cwd)));
    if (
      currentState.stateLineage !== binding.attestation.stateLineage ||
      currentState.stateSerial !== binding.attestation.stateSerial
    ) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Terraform state changed after preview");
    }
    const providerArtifactHash = sha256({
      planDigest: binding.attestation.planDigest,
      configHash: binding.attestation.configHash,
      lockfileHash: binding.attestation.lockfileHash,
      recipient: binding.attestation.recipient,
      artifactRef: binding.attestation.artifactRef,
      ...(binding.policyValidationBinding === undefined ? {} : { policyValidation: binding.policyValidationBinding }),
    });
    if (preview.artifactHash !== providerArtifactHash) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Terraform provider binding hash does not match the preview");
    }
    this.rememberPolicy(preview, binding);
    if (this.#keyProvider === undefined || this.#artifactStore === undefined) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Terraform plan decryption dependencies are unavailable");
    }
    const encrypted = await this.#artifactStore.get(binding.attestation.artifactRef);
    if (encrypted === undefined)
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Encrypted plan artifact is missing");
    if (
      encrypted.iv !== binding.attestation.transport.iv ||
      encrypted.authTag !== binding.attestation.transport.authTag ||
      encrypted.metadata.digest !== binding.attestation.planDigest
    ) {
      throw new IacProviderError("PREVIEW_HASH_MISMATCH", "Encrypted plan metadata does not match its attestation");
    }
    const handle = await this.#transport.decryptToRestrictiveTemp(
      encrypted,
      await this.#keyProvider(),
      authority.recipientIdentity,
    );
    try {
      await this.run(this.#commands.applyExact(this.#target.cwd, handle.path));
      return this.record(operation, preview, approval, authority, `terraform-plan:${binding.attestation.planDigest}`, [
        "deploy:exact-saved-plan",
        "deploy:state-lineage-and-serial",
      ]);
    } finally {
      await handle.dispose();
    }
  }
}

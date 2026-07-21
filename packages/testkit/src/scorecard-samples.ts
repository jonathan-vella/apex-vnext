import { CapabilityPackLoader } from "@apex/capabilities";
import { CONTRACT_VERSION, TaskEnvelopeV1Schema, registerContractFormats } from "@apex/contracts";
import { ContentCache, ValidatorRegistry, contentCacheKey, type ContentCacheInput } from "@apex/kernel";
import { readFile } from "node:fs/promises";
import type { QualificationMutationResult, QualificationOutcome } from "./quality.js";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const CREATED_AT = "2026-07-13T12:00:00.000Z";
const EXPIRES_AT = "2026-07-13T13:00:00.000Z";

type MutableTaskEnvelope = Record<string, unknown> & {
  capabilityGrants: Record<string, unknown>[];
};

interface MutationCase {
  readonly id: string;
  readonly apply: (value: MutableTaskEnvelope) => void;
}

const TASK_MUTATIONS: readonly MutationCase[] = [
  { id: "missing-schema-version", apply: (value) => delete value.schemaVersion },
  { id: "wrong-schema-version", apply: (value) => (value.schemaVersion = "0.0.0") },
  { id: "invalid-project-id", apply: (value) => (value.projectId = "Invalid_Project") },
  { id: "empty-run-id", apply: (value) => (value.runId = "") },
  { id: "path-task-id", apply: (value) => (value.taskId = "../task") },
  { id: "empty-role", apply: (value) => (value.role = "") },
  { id: "empty-task-type", apply: (value) => (value.taskType = "") },
  { id: "short-expected-head", apply: (value) => (value.expectedHead = "abc") },
  { id: "zero-owner-epoch", apply: (value) => (value.ownerEpoch = 0) },
  { id: "fractional-owner-epoch", apply: (value) => (value.ownerEpoch = 1.5) },
  { id: "invalid-created-at", apply: (value) => (value.createdAt = "not-a-date") },
  { id: "invalid-expires-at", apply: (value) => (value.expiresAt = "not-a-date") },
  { id: "malformed-input-hash", apply: (value) => (value.inputRefs = ["not-a-hash"]) },
  { id: "duplicate-input-ref", apply: (value) => (value.inputRefs = [HASH, HASH]) },
  {
    id: "duplicate-output-kind",
    apply: (value) => (value.allowedOutputKinds = ["validation-evidence", "validation-evidence"]),
  },
  { id: "empty-capability", apply: (value) => (value.capabilityGrants[0]!.capability = "") },
  { id: "invalid-side-effect", apply: (value) => (value.capabilityGrants[0]!.sideEffect = "shell") },
  { id: "invalid-grant-expiry", apply: (value) => (value.capabilityGrants[0]!.expiresAt = "not-a-date") },
  { id: "zero-output-limit", apply: (value) => (value.maxOutputBytes = 0) },
  { id: "unexpected-property", apply: (value) => (value.unexpected = true) },
];

export function collectValidationMutationResults(samples = 100): readonly QualificationMutationResult[] {
  assertSampleCount(samples);
  registerContractFormats();
  const validators = new ValidatorRegistry();
  validators.register("task-envelope", TaskEnvelopeV1Schema);
  return Array.from({ length: samples }, (_, index) => {
    const value = taskEnvelope(index);
    if (!validators.validate("task-envelope", value).valid) {
      throw new Error("Validation mutation baseline is invalid");
    }
    const mutation = TASK_MUTATIONS[index % TASK_MUTATIONS.length]!;
    mutation.apply(value);
    return {
      caseId: `${mutation.id}-${String(index).padStart(3, "0")}`,
      escaped: validators.validate("task-envelope", value).valid,
    };
  });
}

export async function collectCapabilityResults(
  packageJsonPath: string,
  samples = 100,
): Promise<readonly QualificationOutcome[]> {
  assertSampleCount(samples);
  const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Capability qualification package manifest has no version");
  }
  const installedVersion = manifest.version;
  const loader = new CapabilityPackLoader({
    resolvePackageJson: async (packageName) =>
      packageName.startsWith("@apex/qualification-present-") ? packageJsonPath : undefined,
  });
  return await Promise.all(
    Array.from({ length: samples }, async (_, index) => {
      const mode = index % 4;
      const present = mode < 2;
      const compatible = mode === 0;
      const optional = mode === 3;
      const requirement = {
        packageName: `@apex/qualification-${present ? "present" : "missing"}-${index}`,
        version: compatible ? installedVersion : `${installedVersion}-mismatch-${index}`,
        optional,
      };
      try {
        const status = await loader.check(requirement);
        const messageMatches = compatible
          ? status.actionableMessage.includes("is available")
          : present
            ? status.actionableMessage.includes("install required version")
            : status.actionableMessage.startsWith(optional ? "Optional capability pack" : "Required capability pack");
        return {
          caseId: `${compatible ? "compatible" : present ? "incompatible" : optional ? "optional-missing" : "required-missing"}-${String(index).padStart(3, "0")}`,
          success: status.available === present && status.compatible === compatible && messageMatches,
        };
      } catch {
        return { caseId: `exception-${String(index).padStart(3, "0")}`, success: false };
      }
    }),
  );
}

export async function collectCacheResults(root: string, samples = 100): Promise<readonly QualificationOutcome[]> {
  assertSampleCount(samples);
  const cache = new ContentCache(root);
  const results: QualificationOutcome[] = [];
  for (let index = 0; index < samples; index += 1) {
    const dependency = `source-${index}`;
    const input: ContentCacheInput = {
      dependencies: { [dependency]: `hash-${index}` },
      config: { mode: `qualification-${index}` },
      toolchain: { version: `1.${index}` },
    };
    const mutationKind = ["dependency", "config", "toolchain"][index % 3]!;
    const mutated: ContentCacheInput =
      mutationKind === "dependency"
        ? { ...input, dependencies: { [dependency]: `mutated-${index}` } }
        : mutationKind === "config"
          ? { ...input, config: { mode: `mutated-${index}` } }
          : { ...input, toolchain: { version: `mutated-${index}` } };
    try {
      await cache.set(input, { sample: index });
      const baseline = await cache.get(input);
      const mutationMiss = await cache.get(mutated);
      const unrelatedInvalidations = await cache.invalidate(`unrelated-${index}`);
      const invalidated = await cache.invalidate(dependency);
      const invalidatedMiss = await cache.get(input);
      results.push({
        caseId: `${mutationKind}-${String(index).padStart(3, "0")}`,
        success:
          contentCacheKey(input) !== contentCacheKey(mutated) &&
          (baseline as { sample?: unknown } | null)?.sample === index &&
          mutationMiss === null &&
          unrelatedInvalidations === 0 &&
          invalidated === 1 &&
          invalidatedMiss === null,
      });
    } catch {
      results.push({ caseId: `${mutationKind}-exception-${String(index).padStart(3, "0")}`, success: false });
    }
  }
  return results;
}

function taskEnvelope(index: number): MutableTaskEnvelope {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId: "qualification",
    runId: `run-${index}`,
    taskId: `task-${index}`,
    role: "worker",
    taskType: "validation",
    expectedHead: HASH,
    ownerEpoch: 1,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    inputRefs: [OTHER_HASH],
    allowedOutputKinds: ["validation-evidence"],
    capabilityGrants: [{ capability: `validate-${index}`, sideEffect: "none", expiresAt: EXPIRES_AT }],
    maxOutputBytes: 65_536,
  };
}

function assertSampleCount(samples: number): void {
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError("samples must be a positive integer");
}

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ContractVersionSchema,
  IacToolSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  Sha256Schema,
} from "./common.js";
import {
  calculatePolicyValidationDigest,
  hasValidPolicyValidation,
  PolicyValidationV1Schema,
} from "./policy-validation.js";

export const NATIVE_VALIDATION_COMMANDS = {
  bicep: [
    { validatorId: "bicep:format", executable: "bicep", args: ["format", "--pattern", "**/*.bicep"] },
    { validatorId: "bicep:build", executable: "bicep", args: ["build", "main.bicep", "--stdout"] },
    { validatorId: "bicep:lint", executable: "bicep", args: ["lint", "--pattern", "**/*.bicep", "--no-restore"] },
  ],
  terraform: [
    {
      validatorId: "terraform:init-backend-false",
      executable: "terraform",
      args: ["init", "-backend=false", "-input=false"],
    },
    { validatorId: "terraform:format", executable: "terraform", args: ["fmt", "-check"] },
    { validatorId: "terraform:validate", executable: "terraform", args: ["validate"] },
  ],
} as const;

for (const commands of Object.values(NATIVE_VALIDATION_COMMANDS)) {
  for (const command of commands) {
    Object.freeze(command.args);
    Object.freeze(command);
  }
  Object.freeze(commands);
}
Object.freeze(NATIVE_VALIDATION_COMMANDS);

export const STORAGE_PROPERTY_HARDENING_CONTROLS = Object.freeze({
  bicep: Object.freeze([
    Object.freeze(["properties.minimumTlsVersion", "TLS1_2"] as const),
    Object.freeze(["properties.supportsHttpsTrafficOnly", true] as const),
    Object.freeze(["properties.allowBlobPublicAccess", false] as const),
    Object.freeze(["properties.allowSharedKeyAccess", false] as const),
  ]),
  terraform: Object.freeze([
    Object.freeze(["min_tls_version", "TLS1_2"] as const),
    Object.freeze(["https_traffic_only_enabled", true] as const),
    Object.freeze(["allow_nested_items_to_be_public", false] as const),
    Object.freeze(["shared_access_key_enabled", false] as const),
  ]),
});

const policyResultProperties = PolicyValidationV1Schema.properties.results.items.properties;
const storageSecurityObservation = Type.Object(
  {
    coverage: Type.Literal("storage-account-property-hardening-v1"),
    fullBaselineEvaluated: Type.Literal(false),
    sourceHash: Sha256Schema,
    inputHash: Sha256Schema,
    bindingHash: Sha256Schema,
    outcome: policyResultProperties.outcome,
    results: Type.Array(
      Type.Object(
        {
          propertyPath: NonEmptyStringSchema,
          expectedValueDigest: Sha256Schema,
          observedValueDigest: Type.Optional(Sha256Schema),
          outcome: policyResultProperties.outcome,
          reason: policyResultProperties.reason,
        },
        { additionalProperties: false },
      ),
      { minItems: 4, maxItems: 4 },
    ),
  },
  { additionalProperties: false },
);

export const NativeValidationReceiptV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    track: IacToolSchema,
    sourceHash: Sha256Schema,
    treeHash: Sha256Schema,
    policyHash: Sha256Schema,
    inputHash: Sha256Schema,
    policyValidation: Type.Optional(PolicyValidationV1Schema),
    securityBaseline: Type.Optional(
      Type.Object(
        {
          coverage: Type.Literal("bicep-storage-only-baseline-v1"),
          sourceHash: Sha256Schema,
          inputHash: Sha256Schema,
          manifestHash: Sha256Schema,
          bindingHash: Sha256Schema,
          outcome: Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unsupported")]),
          reason: Type.Union(
            [
              "matched",
              "resource-parity",
              "unsupported-resource",
              "credential-content",
              "storage-controls",
              "diagnostic-routing",
            ].map((reason) => Type.Literal(reason)),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    resourceParity: Type.Optional(
      Type.Object(
        {
          coverage: Type.Literal("bicep-symbolic-resource-parity-v1"),
          sourceHash: Sha256Schema,
          manifestHash: Sha256Schema,
          bindingHash: Type.Optional(Sha256Schema),
          inputHash: Sha256Schema,
          outcome: Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unsupported")]),
          reason: Type.Union([
            Type.Literal("matched"),
            Type.Literal("coverage-mismatch"),
            Type.Literal("type-mismatch"),
            Type.Literal("dependency-mismatch"),
            Type.Literal("unsupported-resource"),
            Type.Literal("invalid-source"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    policyApplicability: Type.Optional(
      Type.Object(
        {
          status: Type.Literal("no-actionable-mappings"),
          policyMapContentHash: Sha256Schema,
        },
        { additionalProperties: false },
      ),
    ),
    storageSecurity: Type.Optional(
      Type.Record(NonEmptyStringSchema, storageSecurityObservation, { maxProperties: 1000 }),
    ),
    storageDiagnostics: Type.Optional(
      Type.Record(
        NonEmptyStringSchema,
        Type.Object(
          {
            coverage: Type.Literal("bicep-storage-service-diagnostics-v1"),
            fullBaselineEvaluated: Type.Literal(false),
            sourceHash: Sha256Schema,
            inputHash: Sha256Schema,
            bindingHash: Sha256Schema,
            outcome: Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unsupported")]),
            reason: Type.Union(
              [
                "matched",
                "invalid-source",
                "ambiguous-or-unbound-account",
                "unsupported-account",
                "missing-or-ambiguous-service",
                "unsupported-service",
                "missing-or-ambiguous-diagnostics",
                "unsupported-diagnostics",
                "workspace-mismatch",
                "missing-categories",
                "disabled-or-missing-categories",
              ].map((reason) => Type.Literal(reason)),
            ),
          },
          { additionalProperties: false },
        ),
        { maxProperties: 1000 },
      ),
    ),
    outcome: Type.Literal("pass"),
    commands: Type.Array(
      Type.Object(
        {
          validatorId: Type.Union([
            Type.Literal("bicep:format"),
            Type.Literal("bicep:build"),
            Type.Literal("bicep:lint"),
            Type.Literal("terraform:init-backend-false"),
            Type.Literal("terraform:format"),
            Type.Literal("terraform:validate"),
          ]),
          commandHash: Sha256Schema,
          exitCode: Type.Literal(0),
          signal: Type.Null(),
          timedOut: Type.Literal(false),
          outputTruncated: Type.Literal(false),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 3 },
    ),
    receiptHash: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/native-validation-receipt-v1.json", additionalProperties: false },
);

export type NativeValidationReceiptV1 = Static<typeof NativeValidationReceiptV1Schema>;
export type NativeValidationBinding = Pick<
  NativeValidationReceiptV1,
  "projectId" | "runId" | "track" | "sourceHash" | "treeHash" | "policyHash" | "inputHash"
>;

export function calculateNativeValidationCommandHash(command: {
  readonly executable: string;
  readonly args: readonly string[];
}): string {
  return calculatePolicyValidationDigest({ executable: command.executable, args: command.args });
}

export function calculateNativeValidationReceiptHash(receipt: Omit<NativeValidationReceiptV1, "receiptHash">): string {
  return calculatePolicyValidationDigest(receipt);
}

export function hasValidNativeValidationReceipt(
  value: unknown,
  binding: NativeValidationBinding,
): value is NativeValidationReceiptV1 {
  try {
    if (!Value.Check(NativeValidationReceiptV1Schema, value)) return false;
    const { receiptHash, ...receipt } = value;
    const keys = ["projectId", "runId", "track", "sourceHash", "treeHash", "policyHash", "inputHash"] as const;
    if (keys.some((key) => receipt[key] !== binding[key])) return false;
    if (
      receipt.policyApplicability !== undefined &&
      (receipt.policyValidation !== undefined ||
        receipt.policyApplicability.policyMapContentHash !== receipt.policyHash)
    )
      return false;
    const storageInputHash =
      receipt.storageSecurity === undefined ? undefined : Object.values(receipt.storageSecurity)[0]?.inputHash;
    const parity = receipt.resourceParity;
    const baseline = receipt.securityBaseline;
    if (
      baseline !== undefined &&
      (receipt.track !== "bicep" ||
        parity === undefined ||
        baseline.sourceHash !== receipt.sourceHash ||
        baseline.inputHash !== parity.inputHash ||
        baseline.manifestHash !== parity.manifestHash ||
        baseline.bindingHash !== parity.bindingHash ||
        (baseline.outcome === "pass" && (baseline.reason !== "matched" || parity.outcome !== "pass")) ||
        (baseline.reason === "matched" && baseline.outcome !== "pass") ||
        (baseline.reason === "resource-parity" && (parity.outcome === "pass" || baseline.outcome !== parity.outcome)) ||
        (baseline.reason === "unsupported-resource" && baseline.outcome !== "unsupported") ||
        (["credential-content", "storage-controls"].includes(baseline.reason) && baseline.outcome !== "fail") ||
        (baseline.reason === "diagnostic-routing" && baseline.outcome === "pass"))
    )
      return false;
    if (receipt.storageDiagnostics !== undefined) {
      const observations = Object.values(receipt.storageDiagnostics);
      const inputHash = observations[0]?.inputHash;
      if (
        receipt.track !== "bicep" ||
        observations.some(
          (observation) =>
            observation.sourceHash !== receipt.sourceHash ||
            observation.inputHash !== inputHash ||
            (storageInputHash !== undefined && observation.inputHash !== storageInputHash) ||
            (parity !== undefined && observation.inputHash !== parity.inputHash) ||
            (receipt.policyValidation !== undefined && observation.inputHash !== receipt.policyValidation.inputHash) ||
            observation.outcome !==
              (observation.reason === "matched"
                ? "pass"
                : [
                      "invalid-source",
                      "ambiguous-or-unbound-account",
                      "unsupported-account",
                      "unsupported-service",
                      "unsupported-diagnostics",
                    ].includes(observation.reason)
                  ? "unsupported"
                  : "fail"),
        )
      )
        return false;
    }
    if (
      parity !== undefined &&
      (receipt.track !== "bicep" ||
        parity.sourceHash !== receipt.sourceHash ||
        (storageInputHash !== undefined && parity.inputHash !== storageInputHash) ||
        (receipt.policyValidation !== undefined && parity.inputHash !== receipt.policyValidation.inputHash) ||
        parity.outcome !==
          (parity.reason === "matched"
            ? "pass"
            : ["unsupported-resource", "invalid-source"].includes(parity.reason)
              ? "unsupported"
              : "fail"))
    )
      return false;
    if (
      receipt.storageSecurity !== undefined &&
      (receipt.track !== "bicep" ||
        Object.values(receipt.storageSecurity).some(
          (observation) =>
            observation.sourceHash !== receipt.sourceHash ||
            observation.inputHash !== storageInputHash ||
            (receipt.policyValidation !== undefined && observation.inputHash !== receipt.policyValidation.inputHash) ||
            observation.outcome !==
              (observation.results.some(({ outcome }) => outcome === "fail")
                ? "fail"
                : observation.results.some(({ outcome }) => outcome === "unsupported")
                  ? "unsupported"
                  : "pass") ||
            observation.results.some((result, index) => {
              const control = STORAGE_PROPERTY_HARDENING_CONTROLS.bicep[index];
              if (
                control === undefined ||
                result.propertyPath !== control[0] ||
                result.expectedValueDigest !== calculatePolicyValidationDigest(control[1])
              )
                return true;
              if (result.reason === "matched")
                return result.outcome !== "pass" || result.expectedValueDigest !== result.observedValueDigest;
              if (result.reason === "value-mismatch")
                return (
                  result.outcome !== "fail" ||
                  result.observedValueDigest === undefined ||
                  result.expectedValueDigest === result.observedValueDigest
                );
              if (result.reason === "missing-property")
                return result.outcome !== "fail" || result.observedValueDigest !== undefined;
              return (
                ![
                  "unsupported-expression",
                  "resource-not-bound",
                  "resource-not-found",
                  "ambiguous-resource",
                  "unsupported-resource",
                  "invalid-source",
                ].includes(result.reason) ||
                result.outcome !== "unsupported" ||
                result.observedValueDigest !== undefined
              );
            }),
        ))
    )
      return false;
    const policy = receipt.policyValidation;
    if (
      policy !== undefined &&
      (policy.projectId !== receipt.projectId ||
        policy.runId !== receipt.runId ||
        policy.outcome !== "pass" ||
        !hasValidPolicyValidation(policy, {
          track: receipt.track,
          sourceHash: receipt.sourceHash,
          policyMapHash: receipt.policyHash,
          policyMapContentHash: policy.policyMapContentHash,
          logicalResourceManifestHash: policy.logicalResourceManifestHash,
          inputHash: policy.inputHash,
        }))
    )
      return false;
    const expected = NATIVE_VALIDATION_COMMANDS[receipt.track];
    return (
      receipt.commands.length === expected.length &&
      expected.every(
        (command, index) =>
          receipt.commands[index]?.validatorId === command.validatorId &&
          receipt.commands[index]?.commandHash === calculateNativeValidationCommandHash(command),
      ) &&
      receiptHash === calculateNativeValidationReceiptHash(receipt)
    );
  } catch {
    return false;
  }
}

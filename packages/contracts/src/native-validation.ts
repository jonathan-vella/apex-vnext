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
    storageSecurity: Type.Optional(
      Type.Record(NonEmptyStringSchema, storageSecurityObservation, { maxProperties: 1000 }),
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
      receipt.storageSecurity !== undefined &&
      (receipt.track !== "bicep" ||
        Object.values(receipt.storageSecurity).some(
          (observation) =>
            observation.sourceHash !== receipt.sourceHash ||
            (receipt.policyValidation !== undefined && observation.inputHash !== receipt.policyValidation.inputHash) ||
            observation.outcome !==
              (observation.results.some(({ outcome }) => outcome === "fail")
                ? "fail"
                : observation.results.some(({ outcome }) => outcome === "unsupported")
                  ? "unsupported"
                  : "pass") ||
            observation.results.some(
              (result) =>
                result.outcome === "pass" &&
                (result.reason !== "matched" || result.expectedValueDigest !== result.observedValueDigest),
            ),
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

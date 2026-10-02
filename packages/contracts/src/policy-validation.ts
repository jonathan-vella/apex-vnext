import { createHash } from "node:crypto";
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
import { PolicyPropertyMapV1Schema } from "./targets.js";

const OutcomeSchema = Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unsupported")]);
const mappingProperties = PolicyPropertyMapV1Schema.properties.mappings.items.properties;

export const PolicyValidationV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    track: IacToolSchema,
    sourceHash: Sha256Schema,
    policyMapHash: Sha256Schema,
    policyMapContentHash: Sha256Schema,
    logicalResourceManifestHash: Sha256Schema,
    inputHash: Sha256Schema,
    outcome: OutcomeSchema,
    results: Type.Array(
      Type.Object(
        {
          mappingIndex: Type.Integer({ minimum: 0 }),
          mappingHash: Sha256Schema,
          policyAssignmentId: NonEmptyStringSchema,
          policyDefinitionId: Type.Optional(NonEmptyStringSchema),
          policyDefinitionReferenceId: Type.Optional(NonEmptyStringSchema),
          effect: mappingProperties.effect,
          disposition: mappingProperties.disposition,
          logicalResourceId: NonEmptyStringSchema,
          propertyPath: NonEmptyStringSchema,
          expectedValueDigest: Type.Optional(Sha256Schema),
          observedValueDigest: Type.Optional(Sha256Schema),
          outcome: OutcomeSchema,
          reason: Type.Union([
            Type.Literal("matched"),
            Type.Literal("value-mismatch"),
            Type.Literal("missing-property"),
            Type.Literal("blocked"),
            Type.Literal("missing-expected-value"),
            Type.Literal("unverified-exemption"),
            Type.Literal("unsupported-effect"),
            Type.Literal("unsupported-path"),
            Type.Literal("unsupported-expression"),
            Type.Literal("resource-not-bound"),
            Type.Literal("resource-not-found"),
            Type.Literal("ambiguous-resource"),
            Type.Literal("unsupported-resource"),
            Type.Literal("invalid-source"),
            Type.Literal("not-applicable"),
            Type.Literal("platform-remediated"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    receiptHash: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/policy-validation-v1.json", additionalProperties: false },
);

export type PolicyValidationV1 = Static<typeof PolicyValidationV1Schema>;

export function hasActionablePolicyMappings(policyMap: Static<typeof PolicyPropertyMapV1Schema>): boolean {
  return policyMap.mappings.some(({ disposition }) => disposition !== "not-applicable");
}
export type PolicyValidationResultV1 = PolicyValidationV1["results"][number];
export type PolicyValidationBinding = Pick<
  PolicyValidationV1,
  "track" | "sourceHash" | "policyMapHash" | "policyMapContentHash" | "logicalResourceManifestHash" | "inputHash"
>;

export const POLICY_VALIDATION_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  depth: 64,
  nodes: 100_000,
  mappings: 1_000,
});

export function assertPolicyValidationJson(value: unknown): void {
  const pending = [{ value, depth: 0, exit: false }];
  const ancestors = new Set<object>();
  let nodes = 1;
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.exit) {
      ancestors.delete(current.value as object);
      continue;
    }
    if (current.depth > POLICY_VALIDATION_LIMITS.depth) throw new TypeError("POLICY_VALIDATION_LIMIT_EXCEEDED");
    const child = current.value;
    if (child !== null && typeof child === "object") {
      if ((!Array.isArray(child) && Object.getPrototypeOf(child) !== Object.prototype) || ancestors.has(child))
        throw new TypeError("POLICY_VALIDATION_NON_JSON_VALUE");
      ancestors.add(child);
      pending.push({ ...current, exit: true });
      const keys = Array.isArray(child) ? undefined : Object.keys(child);
      const length = keys === undefined ? (child as unknown[]).length : keys.length;
      nodes += length;
      if (nodes > POLICY_VALIDATION_LIMITS.nodes) throw new TypeError("POLICY_VALIDATION_LIMIT_EXCEEDED");
      bytes += 2 + Math.max(0, length - 1);
      for (let index = 0; index < length; index++) {
        const key = keys?.[index];
        const entry = key === undefined ? (child as unknown[])[index] : (child as Record<string, unknown>)[key];
        if (key !== undefined) bytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 1;
        pending.push({ value: entry, depth: current.depth + 1, exit: false });
      }
    } else if (
      child === null ||
      typeof child === "string" ||
      typeof child === "boolean" ||
      (typeof child === "number" && Number.isFinite(child))
    ) {
      bytes += Buffer.byteLength(JSON.stringify(child), "utf8");
    } else {
      throw new TypeError("POLICY_VALIDATION_NON_JSON_VALUE");
    }
    if (bytes > POLICY_VALIDATION_LIMITS.bytes) throw new TypeError("POLICY_VALIDATION_LIMIT_EXCEEDED");
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  throw new TypeError("POLICY_VALIDATION_NON_JSON_VALUE");
}

export function calculatePolicyValidationDigest(value: unknown): string {
  assertPolicyValidationJson(value);
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

export function calculatePolicyValidationHash(receipt: Omit<PolicyValidationV1, "receiptHash">): string {
  return calculatePolicyValidationDigest(receipt);
}

export function hasValidPolicyValidation(
  value: unknown,
  binding: PolicyValidationBinding,
): value is PolicyValidationV1 {
  try {
    assertPolicyValidationJson(value);
    assertPolicyValidationJson(binding);
  } catch {
    return false;
  }
  if (binding === null || typeof binding !== "object" || Array.isArray(binding)) return false;
  if (!Value.Check(PolicyValidationV1Schema, value)) return false;
  if (value.results.length > POLICY_VALIDATION_LIMITS.mappings) return false;
  const { receiptHash, ...receipt } = value;
  const keys = [
    "track",
    "sourceHash",
    "policyMapHash",
    "policyMapContentHash",
    "logicalResourceManifestHash",
    "inputHash",
  ] as const;
  if (keys.some((key) => receipt[key] !== binding[key])) return false;
  const outcome = receipt.results.some((result) => result.outcome === "fail")
    ? "fail"
    : receipt.results.length === 0 || receipt.results.some((result) => result.outcome === "unsupported")
      ? "unsupported"
      : "pass";
  if (receipt.outcome !== outcome) return false;
  if (
    !receipt.results.every((result, index) => {
      if (result.mappingIndex !== index) return false;
      if (result.reason === "matched") {
        return (
          result.outcome === "pass" &&
          result.expectedValueDigest !== undefined &&
          result.expectedValueDigest === result.observedValueDigest &&
          result.disposition !== "blocked" &&
          result.disposition !== "exempt" &&
          result.disposition !== "not-applicable" &&
          result.effect !== "disabled"
        );
      }
      if (result.reason === "not-applicable")
        return result.outcome === "pass" && result.disposition === "not-applicable";
      if (result.reason === "platform-remediated")
        return (
          result.outcome === "pass" &&
          ["modify", "deployIfNotExists"].includes(result.effect) &&
          ["satisfied", "planned"].includes(result.disposition)
        );
      if (["blocked", "value-mismatch", "missing-property"].includes(result.reason)) return result.outcome === "fail";
      return result.outcome === "unsupported";
    })
  )
    return false;
  try {
    return receiptHash === calculatePolicyValidationHash(receipt);
  } catch {
    return false;
  }
}

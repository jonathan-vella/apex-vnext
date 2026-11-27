import { Type, type Static } from "@sinclair/typebox";
import {
  ContractVersionSchema,
  EnvironmentSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  Sha256Schema,
} from "./common.js";

const uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" });

export const LabDelegationPolicyV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    purpose: Type.Literal("lab"),
    environment: EnvironmentSchema,
    track: Type.Literal("bicep"),
    cloud: Type.Literal("AzureCloud"),
    tenantId: uuid,
    subscriptionId: uuid,
    targetScope: NonEmptyStringSchema,
    requirementsHash: Sha256Schema,
    resourceIds: Type.Array(NonEmptyStringSchema, { minItems: 1, maxItems: 256, uniqueItems: true }),
    gates: Type.Array(Type.Union([Type.Literal(1), Type.Literal(4)]), { minItems: 1, uniqueItems: true }),
    operation: Type.Literal("apply"),
    writerEpoch: Type.Integer({ minimum: 1 }),
    recipientIdentity: NonEmptyStringSchema,
    expiresAt: IsoDateTimeSchema,
  },
  { $id: "https://schemas.apexops.dev/lab-delegation-policy-v1.json", additionalProperties: false },
);

export const LabDelegationConsentV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    policyHash: Sha256Schema,
    actor: NonEmptyStringSchema,
    mechanism: Type.Literal("terminal-policy-confirmation"),
    userOwnedScopeConfirmed: Type.Literal(true),
    syntheticNonSensitiveConfirmed: Type.Literal(true),
    futurePreviewReviewed: Type.Literal(false),
    consentedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  },
  { $id: "https://schemas.apexops.dev/lab-delegation-consent-v1.json", additionalProperties: false },
);

/** Provider observations, not an agent-submitted ownership or run-created-resource claim. */
export const LabApplyScopeV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    previewHash: Sha256Schema,
    cloud: Type.Literal("AzureCloud"),
    tenantId: uuid,
    subscriptionId: uuid,
    targetScope: NonEmptyStringSchema,
    executor: Type.Literal("azd"),
    hooksAbsent: Type.Literal(true),
    extensionsAbsent: Type.Literal(true),
    resourceStates: Type.Array(
      Type.Object(
        {
          resourceId: NonEmptyStringSchema,
          state: Type.Union([Type.Literal("absent"), Type.Literal("present")]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
  },
  { $id: "https://schemas.apexops.dev/lab-apply-scope-v1.json", additionalProperties: false },
);

export type LabDelegationPolicyV1 = Static<typeof LabDelegationPolicyV1Schema>;
export type LabDelegationConsentV1 = Static<typeof LabDelegationConsentV1Schema>;
export type LabApplyScopeV1 = Static<typeof LabApplyScopeV1Schema>;

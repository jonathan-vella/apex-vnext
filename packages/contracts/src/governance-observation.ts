import { Type, type Static } from "@sinclair/typebox";
import {
  ContractVersionSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  Sha256Schema,
} from "./common.js";

export const GovernanceObservationReceiptV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    targetScope: NonEmptyStringSchema,
    governanceHash: Sha256Schema,
    snapshotDigest: Sha256Schema,
    contentHash: Sha256Schema,
    observedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    rawSourceDigest: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/governance-observation-receipt-v1.json", additionalProperties: false },
);

export type GovernanceObservationReceiptV1 = Static<typeof GovernanceObservationReceiptV1Schema>;

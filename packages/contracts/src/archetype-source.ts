import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Sha256Schema } from "./common.js";
import { calculatePolicyValidationDigest } from "./policy-validation.js";

const path = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^(?!/)(?!.*(?:^|/)[.]{1,2}(?:/|$))(?!.*[\\\\:\\x00-\\x1f\\x7f])[^/]+(?:/[^/]+)*$",
});
export const ArchetypeSourceProposalV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("1.0.0"),
    repositoryPath: Type.String({ minLength: 1, maxLength: 4096 }),
    revision: Type.String({ pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }),
    selectedPath: path,
    authorityImported: Type.Literal(false),
    requiresConsumerReview: Type.Literal(true),
    files: Type.Array(
      Type.Object(
        { path, hash: Sha256Schema, bytes: Type.Integer({ minimum: 0, maximum: 1_048_576 }) },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 256 },
    ),
    excluded: Type.Array(
      Type.Object(
        { path, reason: Type.Union([Type.Literal("source-authority"), Type.Literal("unsupported-material")]) },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
    contentHash: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/archetype-source-proposal-v1.json", additionalProperties: false },
);

export type ArchetypeSourceProposalV1 = Static<typeof ArchetypeSourceProposalV1Schema>;

export const ArchetypeBatchConfigV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("1.0.0"),
    repository: Type.String({
      pattern: "^https://github\\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$(?![\\s\\S])",
    }),
    revision: Type.String({ pattern: "^[a-f0-9]{40}$(?![\\s\\S])" }),
    selections: Type.Array(
      Type.Object(
        { selectedPath: path, destination: Type.String({ pattern: "^[a-z][a-z0-9-]{0,62}$(?![\\s\\S])" }) },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 16 },
    ),
  },
  { $id: "https://schemas.apexops.dev/archetype-batch-config-v1.json", additionalProperties: false },
);
export type ArchetypeBatchConfigV1 = Static<typeof ArchetypeBatchConfigV1Schema>;

export const ArchetypeBatchPlanV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("1.0.0"),
    config: ArchetypeBatchConfigV1Schema,
    entries: Type.Array(
      Type.Object(
        {
          destination: Type.String({ minLength: 1, maxLength: 63 }),
          proposal: ArchetypeSourceProposalV1Schema,
          state: Type.Union([Type.Literal("pending"), Type.Literal("already-copied")]),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 16 },
    ),
    planHash: Sha256Schema,
    authorityImported: Type.Literal(false),
    requiresConsumerReview: Type.Literal(true),
  },
  { $id: "https://schemas.apexops.dev/archetype-batch-plan-v1.json", additionalProperties: false },
);
export type ArchetypeBatchPlanV1 = Static<typeof ArchetypeBatchPlanV1Schema>;

export function hasValidArchetypeSourceProposal(value: unknown): value is ArchetypeSourceProposalV1 {
  try {
    calculatePolicyValidationDigest(value);
    if (!Value.Check(ArchetypeSourceProposalV1Schema, value)) return false;
    const paths = [...value.files, ...value.excluded].map(({ path }) => path.toLowerCase());
    if (
      paths.length > 256 ||
      new Set(paths).size !== paths.length ||
      value.files.reduce((sum, file) => sum + file.bytes, 0) > 8_388_608
    )
      return false;
    const { contentHash, ...body } = value;
    return contentHash === calculatePolicyValidationDigest(body);
  } catch {
    return false;
  }
}

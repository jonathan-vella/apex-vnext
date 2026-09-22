import { Type, type Static } from "@sinclair/typebox";
import {
  ContractVersionSchema,
  EnvironmentSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  Sha256Schema,
} from "./common.js";

export const RequirementV1Schema = Type.Object(
  {
    id: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    priority: Type.Union([Type.Literal("must"), Type.Literal("should"), Type.Literal("could")]),
    status: Type.Union([Type.Literal("confirmed"), Type.Literal("unknown"), Type.Literal("deferred")]),
    source: NonEmptyStringSchema,
  },
  { additionalProperties: false },
);

export const RequirementsV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    workload: NonEmptyStringSchema,
    environment: EnvironmentSchema,
    requirements: Type.Array(RequirementV1Schema, { minItems: 1 }),
    assumptions: Type.Array(NonEmptyStringSchema),
    unknowns: Type.Array(NonEmptyStringSchema),
    businessContext: Type.Optional(NonEmptyStringSchema),
    successCriteria: Type.Optional(NonEmptyStringSchema),
    nonFunctionalRequirements: Type.Optional(NonEmptyStringSchema),
    securityAndCompliance: Type.Optional(NonEmptyStringSchema),
    budgetAndOperations: Type.Optional(NonEmptyStringSchema),
    regionalConstraints: Type.Optional(NonEmptyStringSchema),
    architectureHandoff: Type.Optional(NonEmptyStringSchema),
  },
  { $id: "https://schemas.apexops.dev/requirements-v1.json", additionalProperties: false },
);

const ChangeIdsSchema = Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
  maxItems: 4096,
  uniqueItems: true,
});

export const RequirementsChangeProposalV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    expectedHead: Sha256Schema,
    ownerEpoch: Type.Integer({ minimum: 0 }),
    sourceRequirementsHash: Type.Union([Sha256Schema, Type.Null()]),
    mode: Type.Union([Type.Literal("adopt"), Type.Literal("revise")]),
    candidateHash: Sha256Schema,
    reason: Type.String({ minLength: 1, maxLength: 2048 }),
    addedRequirementIds: ChangeIdsSchema,
    removedRequirementIds: ChangeIdsSchema,
    changedRequirementIds: ChangeIdsSchema,
    retainedRequirementIds: ChangeIdsSchema,
    changedFields: ChangeIdsSchema,
    invalidatedNodes: ChangeIdsSchema,
    invalidatedGates: Type.Array(Type.Integer({ minimum: 1, maximum: 4 }), { maxItems: 4, uniqueItems: true }),
    requiresReassessment: Type.Tuple([
      Type.Literal("cost"),
      Type.Literal("policy"),
      Type.Literal("security"),
      Type.Literal("dependencies"),
      Type.Literal("code"),
      Type.Literal("documents"),
    ]),
    filesModified: Type.Literal(false),
    deploymentAuthorized: Type.Literal(false),
    proposalHash: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/requirements-change-proposal-v1.json", additionalProperties: false },
);

export type RequirementsChangeProposalV1 = Static<typeof RequirementsChangeProposalV1Schema>;

export const LogicalResourceV1Schema = Type.Object(
  {
    id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    purpose: NonEmptyStringSchema,
    dependsOn: Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
    controls: Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const ImplementationIntentV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    sourceHashes: Type.Record(NonEmptyStringSchema, Sha256Schema),
    resources: Type.Array(LogicalResourceV1Schema, { minItems: 1 }),
    outputs: Type.Array(NonEmptyStringSchema),
  },
  { $id: "https://schemas.apexops.dev/implementation-intent-v1.json", additionalProperties: false },
);

export const IacBindingV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    track: Type.Union([Type.Literal("bicep"), Type.Literal("terraform")]),
    intentHash: Sha256Schema,
    resourceBindings: Type.Record(
      NonEmptyStringSchema,
      Type.Object(
        {
          implementation: NonEmptyStringSchema,
          version: NonEmptyStringSchema,
          parameters: Type.Record(NonEmptyStringSchema, Type.Unknown()),
          scopeLogicalId: Type.Optional(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$", maxLength: 256 })),
          physicalResources: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  resourceId: Type.String({
                    minLength: 1,
                    maxLength: 2048,
                    pattern: [
                      "^/[sS][uU][bB][sS][cC][rR][iI][pP][tT][iI][oO][nN][sS]/",
                      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/",
                      "[rR][eE][sS][oO][uU][rR][cC][eE][gG][rR][oO][uU][pP][sS]/[A-Za-z0-9_()-][A-Za-z0-9_.()-]*/",
                      "[pP][rR][oO][vV][iI][dD][eE][rR][sS]/[A-Za-z0-9_.()/-]+$(?![\\s\\S])",
                    ].join(""),
                  }),
                  type: Type.String({
                    minLength: 1,
                    maxLength: 256,
                    pattern:
                      "^[mM][iI][cC][rR][oO][sS][oO][fF][tT]\\.[A-Za-z0-9.]+(?:/[A-Za-z][A-Za-z0-9]*)+$(?![\\s\\S])",
                  }),
                  ownership: Type.Union([Type.Literal("managed"), Type.Literal("existing")]),
                  role: Type.Union([Type.Literal("primary"), Type.Literal("ancillary")]),
                },
                { additionalProperties: false },
              ),
              {
                minItems: 1,
                maxItems: 128,
                uniqueItems: true,
                description: "Accepted intended authorization scope, not observed resource attribution.",
              },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: "https://schemas.apexops.dev/iac-binding-v1.json", additionalProperties: false },
);

export type RequirementsV1 = Static<typeof RequirementsV1Schema>;
export type ImplementationIntentV1 = Static<typeof ImplementationIntentV1Schema>;
export type IacBindingV1 = Static<typeof IacBindingV1Schema>;

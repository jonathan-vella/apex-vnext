import { Type, type Static } from "@sinclair/typebox";
import {
  ContractVersionSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  Sha256Schema,
} from "./common.js";
import { ConfidenceSchema } from "./targets.js";

export const ImprovementSourceSchema = Type.Union([
  Type.Literal("task-completion"),
  Type.Literal("deterministic-test"),
  Type.Literal("validation-failure"),
  Type.Literal("capability-execution"),
  Type.Literal("cache-check"),
  Type.Literal("explicit-correction"),
]);

export const ImprovementCategorySchema = Type.Union([
  Type.Literal("correctness"),
  Type.Literal("security"),
  Type.Literal("reliability"),
  Type.Literal("performance"),
  Type.Literal("usability"),
  Type.Literal("documentation"),
  Type.Literal("capability-gap"),
]);

export const ImprovementTargetSchema = Type.Union([
  Type.Literal("documentation"),
  Type.Literal("validator"),
  Type.Literal("instruction"),
  Type.Literal("skill"),
  Type.Literal("architecture"),
  Type.Literal("backlog"),
]);

export const ImprovementObservationV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    taskId: Type.Optional(NonEmptyStringSchema),
    observationId: Sha256Schema,
    patternKey: Sha256Schema,
    observedAt: IsoDateTimeSchema,
    source: ImprovementSourceSchema,
    category: ImprovementCategorySchema,
    severity: Type.Union([
      Type.Literal("critical"),
      Type.Literal("high"),
      Type.Literal("medium"),
      Type.Literal("low"),
      Type.Literal("info"),
    ]),
    statement: Type.String({ minLength: 1, maxLength: 1024 }),
    evidenceRefs: Type.Array(Sha256Schema, { minItems: 1, uniqueItems: true, maxItems: 32 }),
    disposition: Type.Union([Type.Literal("active"), Type.Literal("quarantined")]),
    redactionCount: Type.Integer({ minimum: 0 }),
  },
  { $id: "https://schemas.apexops.dev/improvement-observation-v1.json", additionalProperties: false },
);

export const ImprovementRecurrenceV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    patternKey: Sha256Schema,
    category: ImprovementCategorySchema,
    detectedAt: IsoDateTimeSchema,
    firstSeenAt: IsoDateTimeSchema,
    lastSeenAt: IsoDateTimeSchema,
    occurrenceCount: Type.Integer({ minimum: 2 }),
    distinctRunCount: Type.Integer({ minimum: 2 }),
    runIds: Type.Array(RunIdSchema, { minItems: 2, uniqueItems: true }),
    observationIds: Type.Array(Sha256Schema, { minItems: 2, uniqueItems: true }),
    evidenceRefs: Type.Array(Sha256Schema, { minItems: 1, uniqueItems: true }),
    confidence: ConfidenceSchema,
  },
  { $id: "https://schemas.apexops.dev/improvement-recurrence-v1.json", additionalProperties: false },
);

export const ImprovementProposalV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    proposalId: Sha256Schema,
    patternKey: Sha256Schema,
    generatedAt: IsoDateTimeSchema,
    target: ImprovementTargetSchema,
    title: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.String({ minLength: 1, maxLength: 2048 }),
    occurrenceCount: Type.Integer({ minimum: 2 }),
    runIds: Type.Array(RunIdSchema, { minItems: 2, uniqueItems: true }),
    evidenceRefs: Type.Array(Sha256Schema, { minItems: 1, uniqueItems: true }),
    confidence: ConfidenceSchema,
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("accepted"),
      Type.Literal("rejected"),
      Type.Literal("deferred"),
    ]),
    inert: Type.Literal(true),
  },
  { $id: "https://schemas.apexops.dev/improvement-proposal-v1.json", additionalProperties: false },
);

export const ImprovementDecisionV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    proposalId: Sha256Schema,
    decidedAt: IsoDateTimeSchema,
    actor: NonEmptyStringSchema,
    decision: Type.Union([Type.Literal("accepted"), Type.Literal("rejected"), Type.Literal("deferred")]),
    rationale: Type.String({ minLength: 1, maxLength: 2048 }),
    externalRef: Type.Optional(
      Type.String({ pattern: "^https://github\\.com/[^/]+/[^/]+/(?:issues|pull)/[1-9][0-9]*$" }),
    ),
  },
  { $id: "https://schemas.apexops.dev/improvement-decision-v1.json", additionalProperties: false },
);

export const ImprovementPolicyV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    allowedSources: Type.Array(ImprovementSourceSchema, { minItems: 1, uniqueItems: true }),
    allowedCategories: Type.Array(ImprovementCategorySchema, { minItems: 1, uniqueItems: true }),
    recurrence: Type.Object(
      {
        threshold: Type.Integer({ minimum: 2 }),
        windowDays: Type.Integer({ minimum: 1, maximum: 365 }),
      },
      { additionalProperties: false },
    ),
    retention: Type.Object(
      {
        observationDays: Type.Integer({ minimum: 1, maximum: 3650 }),
        decisionDays: Type.Integer({ minimum: 1, maximum: 3650 }),
      },
      { additionalProperties: false },
    ),
    limits: Type.Object(
      {
        statementCharacters: Type.Integer({ minimum: 1, maximum: 1024 }),
        evidenceRefs: Type.Integer({ minimum: 1, maximum: 32 }),
        observations: Type.Integer({ minimum: 1, maximum: 100000 }),
      },
      { additionalProperties: false },
    ),
    proposalTargets: Type.Array(ImprovementTargetSchema, { minItems: 1, uniqueItems: true }),
    humanDecisionRequired: Type.Literal(true),
    automatedIssueCreation: Type.Literal(false),
    contextInjection: Type.Literal(false),
  },
  { $id: "https://schemas.apexops.dev/improvement-policy-v1.json", additionalProperties: false },
);

export type ImprovementSource = Static<typeof ImprovementSourceSchema>;
export type ImprovementCategory = Static<typeof ImprovementCategorySchema>;
export type ImprovementTarget = Static<typeof ImprovementTargetSchema>;
export type ImprovementObservationV1 = Static<typeof ImprovementObservationV1Schema>;
export type ImprovementRecurrenceV1 = Static<typeof ImprovementRecurrenceV1Schema>;
export type ImprovementProposalV1 = Static<typeof ImprovementProposalV1Schema>;
export type ImprovementDecisionV1 = Static<typeof ImprovementDecisionV1Schema>;
export type ImprovementPolicyV1 = Static<typeof ImprovementPolicyV1Schema>;

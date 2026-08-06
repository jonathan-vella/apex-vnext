import { Type, type Static } from "@sinclair/typebox";
import {
  ContractVersionSchema,
  EnvironmentSchema,
  IacToolSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  Sha256Schema,
  TaskIdSchema,
} from "./common.js";

export const RuntimeBundleLockV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    cliVersion: NonEmptyStringSchema,
    customizationVersion: NonEmptyStringSchema,
    workflowHash: Sha256Schema,
    defaultsHash: Sha256Schema,
    validatorHash: Sha256Schema,
    qualityScorecardHash: Sha256Schema,
    improvementPolicyHash: Sha256Schema,
    requiredCapabilityPacks: Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
  },
  { $id: "https://schemas.apexops.dev/runtime-bundle-lock-v1.json", additionalProperties: false },
);

export const ProjectConfigV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    displayName: NonEmptyStringSchema,
    createdAt: IsoDateTimeSchema,
    defaultIacTool: IacToolSchema,
  },
  { $id: "https://schemas.apexops.dev/project-config-v1.json", additionalProperties: false },
);

export const GateStateSchema = Type.Union([
  Type.Literal("closed"),
  Type.Literal("open"),
  Type.Literal("approved"),
  Type.Literal("inherited"),
  Type.Literal("rejected"),
  Type.Literal("invalidated"),
]);

export const GateRecordV1Schema = Type.Object(
  {
    gate: Type.Integer({ minimum: 1, maximum: 4 }),
    state: GateStateSchema,
    dependencyHash: Sha256Schema,
    decidedAt: Type.Optional(IsoDateTimeSchema),
    inheritedFromRunId: Type.Optional(RunIdSchema),
    reason: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
);

export const RunConfigV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    environment: EnvironmentSchema,
    targetScope: NonEmptyStringSchema,
    iacTool: IacToolSchema,
    createdAt: IsoDateTimeSchema,
    runtimeLockHash: Sha256Schema,
    parentRunId: Type.Optional(RunIdSchema),
    ownerEpoch: Type.Integer({ minimum: 1 }),
    gates: Type.Array(GateRecordV1Schema, { minItems: 4, maxItems: 4 }),
  },
  { $id: "https://schemas.apexops.dev/run-config-v1.json", additionalProperties: false },
);

export const CapabilityGrantV1Schema = Type.Object(
  {
    capability: NonEmptyStringSchema,
    sideEffect: Type.Union([Type.Literal("none"), Type.Literal("local"), Type.Literal("remote")]),
    expiresAt: IsoDateTimeSchema,
  },
  { additionalProperties: false },
);

export const TaskEnvelopeV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    taskId: TaskIdSchema,
    role: NonEmptyStringSchema,
    taskType: NonEmptyStringSchema,
    expectedHead: Sha256Schema,
    ownerEpoch: Type.Integer({ minimum: 1 }),
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    inputRefs: Type.Array(Sha256Schema, { uniqueItems: true }),
    allowedOutputKinds: Type.Array(NonEmptyStringSchema, { uniqueItems: true }),
    capabilityGrants: Type.Array(CapabilityGrantV1Schema),
    maxOutputBytes: Type.Integer({ minimum: 1 }),
  },
  { $id: "https://schemas.apexops.dev/task-envelope-v1.json", additionalProperties: false },
);

export const QuestionV1Schema = Type.Object(
  {
    id: NonEmptyStringSchema,
    prompt: NonEmptyStringSchema,
    options: Type.Optional(Type.Array(NonEmptyStringSchema, { minItems: 1, uniqueItems: true })),
    multiSelect: Type.Optional(Type.Boolean()),
    valueType: Type.Optional(
      Type.Union([
        Type.Literal("budget"),
        Type.Literal("recovery"),
        Type.Literal("environment-set"),
        Type.Literal("data-classification"),
        Type.Literal("compliance"),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const DeferredInputValueV1Schema = Type.Object(
  { kind: Type.Literal("deferred"), owner: NonEmptyStringSchema },
  { additionalProperties: false },
);

export const UnknownInputValueV1Schema = Type.Object(
  { kind: Type.Literal("unknown") },
  { additionalProperties: false },
);

export const BudgetInputValueV1Schema = Type.Object(
  {
    kind: Type.Literal("budget"),
    amount: Type.Number({ minimum: 0 }),
    currency: Type.String({ pattern: "^[A-Z]{3}$" }),
    cadence: Type.Literal("monthly"),
  },
  { additionalProperties: false },
);

export const RecoveryInputValueV1Schema = Type.Object(
  {
    kind: Type.Literal("recovery"),
    rtoMinutes: Type.Integer({ minimum: 0 }),
    rpoMinutes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ClassificationInputValueV1Schema = Type.Object(
  {
    kind: Type.Literal("data-classification"),
    classification: Type.Union([
      Type.Literal("public"),
      Type.Literal("internal"),
      Type.Literal("confidential"),
      Type.Literal("restricted"),
    ]),
  },
  { additionalProperties: false },
);

export const ComplianceInputValueV1Schema = Type.Object(
  { kind: Type.Literal("compliance"), scopes: Type.Array(NonEmptyStringSchema, { minItems: 1, uniqueItems: true }) },
  { additionalProperties: false },
);

export const InputValueV1Schema = Type.Union([
  NonEmptyStringSchema,
  Type.Array(NonEmptyStringSchema, { minItems: 1, uniqueItems: true }),
  DeferredInputValueV1Schema,
  UnknownInputValueV1Schema,
  BudgetInputValueV1Schema,
  RecoveryInputValueV1Schema,
  ClassificationInputValueV1Schema,
  ComplianceInputValueV1Schema,
]);

export const RequirementsIntakeRoundV1Schema = Type.Union([
  Type.Literal("business-discovery"),
  Type.Literal("workload-pattern"),
  Type.Literal("service-preferences"),
  Type.Literal("security-compliance"),
]);

export const RequirementsIntakeV1Schema = Type.Object(
  {
    round: RequirementsIntakeRoundV1Schema,
    ordinal: Type.Integer({ minimum: 1, maximum: 4 }),
    total: Type.Literal(4),
  },
  { additionalProperties: false },
);

export const InputRequestV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    requestId: TaskIdSchema,
    expectedHead: Sha256Schema,
    ownerEpoch: Type.Integer({ minimum: 1 }),
    intake: RequirementsIntakeV1Schema,
    questions: Type.Array(QuestionV1Schema, { minItems: 1, uniqueItems: true }),
  },
  { $id: "https://schemas.apexops.dev/input-request-v1.json", additionalProperties: false },
);

export const InputAnswerV1Schema = Type.Object(
  {
    questionId: NonEmptyStringSchema,
    value: InputValueV1Schema,
  },
  { additionalProperties: false },
);

export const InputSubmissionV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    requestId: TaskIdSchema,
    expectedHead: Sha256Schema,
    ownerEpoch: Type.Integer({ minimum: 1 }),
    answers: Type.Array(InputAnswerV1Schema, { minItems: 1 }),
  },
  { $id: "https://schemas.apexops.dev/input-submission-v1.json", additionalProperties: false },
);

export const TaskResultV1Schema = Type.Union([
  Type.Object(
    {
      schemaVersion: ContractVersionSchema,
      taskId: TaskIdSchema,
      status: Type.Literal("completed"),
      outputRefs: Type.Array(Sha256Schema),
      summary: NonEmptyStringSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      schemaVersion: ContractVersionSchema,
      taskId: TaskIdSchema,
      status: Type.Literal("needs_input"),
      questions: Type.Array(QuestionV1Schema, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      schemaVersion: ContractVersionSchema,
      taskId: TaskIdSchema,
      status: Type.Literal("failed"),
      errorCode: NonEmptyStringSchema,
      message: NonEmptyStringSchema,
      retryable: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
]);

export const EventV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    eventId: NonEmptyStringSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    sequence: Type.Integer({ minimum: 1 }),
    type: NonEmptyStringSchema,
    timestamp: IsoDateTimeSchema,
    ownerEpoch: Type.Integer({ minimum: 1 }),
    previousHash: Type.Union([Sha256Schema, Type.Null()]),
    payloadHash: Sha256Schema,
    payload: Type.Unknown(),
    hash: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/event-v1.json", additionalProperties: false },
);

export type RuntimeBundleLockV1 = Static<typeof RuntimeBundleLockV1Schema>;
export type ProjectConfigV1 = Static<typeof ProjectConfigV1Schema>;
export type GateRecordV1 = Static<typeof GateRecordV1Schema>;
export type RunConfigV1 = Static<typeof RunConfigV1Schema>;
export type TaskEnvelopeV1 = Static<typeof TaskEnvelopeV1Schema>;
export type TaskResultV1 = Static<typeof TaskResultV1Schema>;
export type EventV1 = Static<typeof EventV1Schema>;
export type QuestionV1 = Static<typeof QuestionV1Schema>;
export type InputValueV1 = Static<typeof InputValueV1Schema>;
export type RequirementsIntakeRoundV1 = Static<typeof RequirementsIntakeRoundV1Schema>;
export type RequirementsIntakeV1 = Static<typeof RequirementsIntakeV1Schema>;
export type InputRequestV1 = Static<typeof InputRequestV1Schema>;
export type InputAnswerV1 = Static<typeof InputAnswerV1Schema>;
export type InputSubmissionV1 = Static<typeof InputSubmissionV1Schema>;

export function hasValidInputRequestQuestions(questions: QuestionV1[]): boolean {
  return (
    new Set(questions.map(({ id }) => id)).size === questions.length &&
    questions.every(
      ({ multiSelect, options }) =>
        (multiSelect !== true || options !== undefined) &&
        (options === undefined || (options.length > 0 && new Set(options).size === options.length)),
    )
  );
}

import {
  ApprovalEvidenceV1Schema,
  ImprovementObservationV1Schema,
  ImprovementProposalV1Schema,
  InputRequestV1Schema,
  InputValueV1Schema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  ResourceInventoryV1Schema,
  RunConfigV1Schema,
  Sha256Schema,
  TaskEnvelopeV1Schema,
  registerContractFormats,
} from "@apexops/contracts";
import { Type, type TObject, type TProperties, type TSchema, type TUnion } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { z } from "zod";
import { SUPPORTED_ARTIFACT_KINDS } from "./service.js";

registerContractFormats();

const object = <Properties extends TProperties>(properties: Properties) =>
  Type.Object(properties, { additionalProperties: false });
const strings = Type.Array(Type.String());
const count = Type.Integer({ minimum: 0 });
const artifactKind = Type.Union(SUPPORTED_ARTIFACT_KINDS.map((kind) => Type.Literal(kind)));
const artifactHashes = object(
  Object.fromEntries(SUPPORTED_ARTIFACT_KINDS.map((kind) => [kind, Type.Optional(Sha256Schema)])),
);

function contract(schema: TObject | TUnion<TObject[]>): z.ZodObject {
  schema = Type.Union([
    ...((schema.anyOf as TObject[] | undefined) ?? [schema as TObject]),
    object({
      error: object({
        code: Type.Union(
          [
            "APEX_USAGE",
            "APEX_NOT_FOUND",
            "APEX_CONFLICT",
            "APEX_VALIDATION",
            "APEX_STALE",
            "APEX_AUTHORIZATION",
            "APEX_INTERNAL",
          ].map((code) => Type.Literal(code)),
        ),
        message: Type.String(),
      }),
    }),
  ]);
  const branches = schema.anyOf as TObject[] | undefined;
  const envelope =
    branches === undefined
      ? schema
      : object(
          Object.fromEntries(
            [...new Set(branches.flatMap((branch) => Object.keys(branch.properties)))].map((key) => [
              key,
              Type.Optional(Type.Union(branches.flatMap((branch) => branch.properties[key] ?? []))),
            ]),
          ),
        );
  const json = (value: TSchema) =>
    JSON.parse(JSON.stringify(value, (key, entry: unknown) => (key === "$id" ? undefined : entry)));
  const converted = z.fromJSONSchema(json(envelope));
  if (!(converted instanceof z.ZodObject)) throw new Error("MCP result contract must be an object");
  return converted
    .superRefine((value, context) => {
      if (!Value.Check(schema, value)) context.addIssue({ code: "custom", message: "Invalid domain contract" });
    })
    .meta({ ...json(envelope), ...json(schema) });
}

const selection = object({ projectId: NonEmptyStringSchema, runId: NonEmptyStringSchema });
const capability = object({
  id: Type.String(),
  state: Type.Union(
    ["installed", "unavailable", "blocked", "invalid", "not-installed"].map((value) => Type.Literal(value)),
  ),
  version: Type.Optional(Type.String()),
  installedVersion: Type.Optional(Type.String()),
  requiredWorkflows: strings,
  reason: Type.Optional(Type.String()),
  action: Type.String(),
});
const status = object({
  run: RunConfigV1Schema,
  head: Type.Union([Sha256Schema, Type.Null()]),
  events: count,
  task: Type.Union([NonEmptyStringSchema, Type.Null()]),
  blockers: strings,
});
const doctor = object({
  healthy: Type.Boolean(),
  checks: Type.Array(
    object({
      id: Type.String(),
      ok: Type.Boolean(),
      value: Type.String(),
      remedy: Type.Optional(Type.String()),
    }),
  ),
  remedies: strings,
  nextAction: Type.String(),
});
const review = object({
  gate: Type.Integer({ minimum: 1, maximum: 4 }),
  reviewHash: Sha256Schema,
  findings: Type.Array(
    object({
      id: NonEmptyStringSchema,
      severity: Type.Union(["critical", "high", "medium", "low", "info"].map((value) => Type.Literal(value))),
      title: NonEmptyStringSchema,
      detail: NonEmptyStringSchema,
      actions: Type.Array(
        Type.Union(["revise", "accept-risk", "acknowledge", "dismiss"].map((value) => Type.Literal(value))),
      ),
    }),
  ),
});
const reviewMetadata = object({
  subjectKind: artifactKind,
  subjectHash: Sha256Schema,
  criteria: strings,
  dispositions: Type.Array(
    object({
      findingId: NonEmptyStringSchema,
      reviewHash: Sha256Schema,
      subjectHash: Sha256Schema,
      disposition: Type.Union(
        ["fixed", "accepted-risk", "acknowledged", "dismissed"].map((value) => Type.Literal(value)),
      ),
      actor: Type.String(),
      rationale: Type.String(),
      evidenceRefs: Type.Array(Sha256Schema),
      expiresAt: Type.Optional(IsoDateTimeSchema),
      dependencyHash: Sha256Schema,
    }),
  ),
  evidenceRefs: Type.Array(Sha256Schema),
  evidenceRefsRequired: Type.Literal(true),
});
const stagedArtifact = object({
  taskId: NonEmptyStringSchema,
  kind: artifactKind,
  path: NonEmptyStringSchema,
  bytes: count,
  hash: Sha256Schema,
});
const stagedFile = object({
  taskId: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  bytes: count,
  hash: Sha256Schema,
  idempotent: Type.Boolean(),
});
const completion = object({ outputHashes: artifactHashes, summary: Type.String() });
const evidenceProperties = {
  kind: Type.String(),
  bytes: count,
  retention: Type.Union(["immutable", "project", "optional"].map((value) => Type.Literal(value))),
  redacted: Type.Boolean(),
  reasons: strings,
};

export const MCP_OUTPUT_SCHEMAS = {
  status: contract(status),
  capabilityList: contract(object({ packs: Type.Array(capability) })),
  capabilityStatus: contract(capability),
  nextTask: contract(
    Type.Union([
      object({ status: Type.Literal("needs_input"), request: InputRequestV1Schema }),
      object({ status: Type.Literal("needs_review"), review }),
      object({ status: Type.Literal("task"), task: TaskEnvelopeV1Schema }),
    ]),
  ),
  taskContext: contract(
    object({
      task: TaskEnvelopeV1Schema,
      inputs: Type.Array(Type.Unknown()),
      inputReferences: Type.Array(object({ hash: Sha256Schema, bytes: count, inlined: Type.Boolean() })),
      artifactHashes: Type.Record(Type.String(), Sha256Schema),
      recordedInput: Type.Union([Type.Record(Type.String(), InputValueV1Schema), Type.Null()]),
      decisions: Type.Record(Type.String(), InputValueV1Schema),
      outputTemplates: object(
        Object.fromEntries(SUPPORTED_ARTIFACT_KINDS.map((kind) => [kind, Type.Optional(Type.Unknown())])),
      ),
      reviewMetadata: Type.Optional(reviewMetadata),
      reviewMetadataReference: Type.Optional(
        object({ selector: Type.Literal("review-metadata"), bytes: count, inlined: Type.Boolean() }),
      ),
      outputRoot: NonEmptyStringSchema,
      status: Type.Union([Type.Literal("completed"), Type.Literal("active")]),
      blockers: strings,
    }),
  ),
  readTaskInput: contract(
    object({
      subjectHash: Sha256Schema,
      content: Type.String(),
      offset: count,
      nextOffset: Type.Optional(count),
      outputTemplate: Type.Optional(Type.Unknown()),
    }),
  ),
  recordInput: contract(object({ recorded: Type.Literal(true), requestId: NonEmptyStringSchema })),
  governanceImport: contract(object({ outputHash: Sha256Schema, summary: Type.String() })),
  projectCreate: contract(selection),
  projectList: contract(
    object({ projects: Type.Array(object({ projectId: NonEmptyStringSchema, displayName: Type.String() })) }),
  ),
  projectUse: contract(selection),
  projectDelete: contract(object({ deleted: NonEmptyStringSchema, selected: Type.Optional(selection) })),
  gateDecide: contract(ApprovalEvidenceV1Schema),
  reviewDecide: contract(
    object({ status: Type.Union([Type.Literal("revision_requested"), Type.Literal("resolved")]) }),
  ),
  stageArtifact: contract(Type.Union([stagedArtifact, object({ artifacts: Type.Array(stagedArtifact) })])),
  stageFile: contract(stagedFile),
  generateIac: contract(
    object({ files: Type.Array(stagedFile), outputHashes: artifactHashes, treeHash: Sha256Schema }),
  ),
  validateTask: contract(
    object({
      valid: Type.Literal(true),
      taskId: NonEmptyStringSchema,
      staged: Type.Optional(Type.Union([stagedArtifact, Type.Array(stagedArtifact)])),
    }),
  ),
  completeTask: contract(completion),
  requirementsComplete: contract(completion),
  architectureComplete: contract(completion),
  reviewComplete: contract(completion),
  planComplete: contract(completion),
  preview: contract(object({ markdown: Type.String() })),
  inventory: contract(ResourceInventoryV1Schema),
  reconcile: contract(ResourceInventoryV1Schema),
  diagnose: contract(object({ status, doctor })),
  improvementObserve: contract(object({ observation: ImprovementObservationV1Schema, deduplicated: Type.Boolean() })),
  improvementObservations: contract(object({ observations: Type.Array(ImprovementObservationV1Schema) })),
  improvementProposals: contract(object({ proposals: Type.Array(ImprovementProposalV1Schema) })),
  render: contract(object({ markdown: Type.String() })),
  promote: contract(RunConfigV1Schema),
  doctor: contract(doctor),
  submitEvidence: contract(
    Type.Union([
      object({ ...evidenceProperties, status: Type.Literal("accepted"), hash: Sha256Schema }),
      object({ ...evidenceProperties, status: Type.Literal("quarantined"), quarantinePath: NonEmptyStringSchema }),
    ]),
  ),
} satisfies Record<string, z.ZodObject>;

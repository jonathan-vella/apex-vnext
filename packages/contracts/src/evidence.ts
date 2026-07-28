import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ContractVersionSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  Sha256Schema,
  TaskIdSchema,
} from "./common.js";

export const CLIENT_OUTCOME_SCENARIO_IDS = [
  "CLIENT-001",
  "CLIENT-002",
  "CLIENT-003",
  "CLIENT-004",
  "CLIENT-005",
  "CLIENT-006",
  "CLIENT-007",
  "CLIENT-008",
  "CLIENT-009",
  "CLIENT-010",
] as const;

export const CLIENT_OUTCOME_CLIENT_IDS = ["github-copilot-vscode", "github-copilot-cli"] as const;
export const CLIENT_OUTCOME_EQUALITY_PATHS = [
  "/candidate",
  "/execution/projectId",
  "/execution/workflowNode",
  "/execution/taskState",
  "/execution/semanticJournalHash",
  "/execution/ownerEpoch",
  "/observations/gates",
  "/observations/artifacts",
  "/observations/evidence",
  "/observations/denialCodes",
  "/observations/transfer",
  "/observations/assertions",
  "/disposition",
] as const;

const ClientOutcomeScenarioIdSchema = Type.Union(CLIENT_OUTCOME_SCENARIO_IDS.map((id) => Type.Literal(id)));
const ClientOutcomeClientIdSchema = Type.Union(CLIENT_OUTCOME_CLIENT_IDS.map((id) => Type.Literal(id)));
const BoundedIdentifierSchema = Type.String({ pattern: "^[a-z][a-z0-9.-]{0,63}$", maxLength: 64 });
const UpperCodeSchema = Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,63}$", maxLength: 64 });
const VersionSchema = Type.String({ pattern: "^[0-9]+(?:\\.[0-9]+){1,3}(?:-[0-9A-Za-z.-]+)?$", maxLength: 32 });
const JsonPointerSchema = Type.String({
  pattern: "^/(?:[a-z][a-zA-Z0-9.-]*)(?:/(?:[a-z][a-zA-Z0-9.-]*|[0-9]+))*$",
  maxLength: 160,
});
const HashMapSchema = Type.Record(BoundedIdentifierSchema, Sha256Schema, { maxProperties: 32 });
const AssertionMapSchema = Type.Record(
  BoundedIdentifierSchema,
  Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unavailable")]),
  { maxProperties: 32 },
);

const ClientCandidateV1Schema = Type.Object(
  {
    repository: Type.String({ pattern: "^[a-z0-9_.-]+/[a-z0-9_.-]+$", maxLength: 128 }),
    branch: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$", maxLength: 128 }),
    commit: Type.String({ pattern: "^[0-9a-f]{40}$" }),
    packageLockHash: Sha256Schema,
    releaseManifestHash: Sha256Schema,
    runtimeBundleHash: Sha256Schema,
    customizationBundleHash: Sha256Schema,
    scenarioCorpusHash: Sha256Schema,
    toolchainHash: Sha256Schema,
  },
  { additionalProperties: false },
);

export const ClientOutcomeV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    scenarioId: ClientOutcomeScenarioIdSchema,
    evidenceKind: Type.Union([Type.Literal("fixture"), Type.Literal("live")]),
    candidate: ClientCandidateV1Schema,
    client: Type.Object(
      {
        id: ClientOutcomeClientIdSchema,
        version: VersionSchema,
        extensionVersion: Type.Optional(VersionSchema),
        os: Type.Union([Type.Literal("linux"), Type.Literal("macos"), Type.Literal("windows")]),
        architecture: Type.Union([Type.Literal("x64"), Type.Literal("arm64")]),
      },
      { additionalProperties: false },
    ),
    execution: Type.Object(
      {
        projectId: Type.Intersect([ProjectIdSchema, Type.String({ maxLength: 64 })]),
        runId: RunIdSchema,
        workflowNode: BoundedIdentifierSchema,
        taskId: TaskIdSchema,
        taskState: Type.Union([
          Type.Literal("completed"),
          Type.Literal("failed"),
          Type.Literal("blocked"),
          Type.Literal("unavailable"),
        ]),
        rawJournalHead: Sha256Schema,
        rawJournalSourceDigest: Sha256Schema,
        semanticJournalHash: Sha256Schema,
        ownerEpoch: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    observations: Type.Object(
      {
        gates: Type.Array(
          Type.Object(
            {
              gate: Type.Integer({ minimum: 1, maximum: 4 }),
              state: Type.Union([
                Type.Literal("approved"),
                Type.Literal("denied"),
                Type.Literal("pending"),
                Type.Literal("not-applicable"),
              ]),
            },
            { additionalProperties: false },
          ),
          { maxItems: 4, uniqueItems: true },
        ),
        artifacts: HashMapSchema,
        evidence: HashMapSchema,
        denialCodes: Type.Array(UpperCodeSchema, { maxItems: 32, uniqueItems: true }),
        transfer: Type.Object(
          {
            result: Type.Union([Type.Literal("succeeded"), Type.Literal("denied"), Type.Literal("not-applicable")]),
            ownerEpochDelta: Type.Integer(),
          },
          { additionalProperties: false },
        ),
        assertions: AssertionMapSchema,
      },
      { additionalProperties: false },
    ),
    disposition: Type.Union([
      Type.Object(
        {
          status: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
          reasonCode: Type.Optional(UpperCodeSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          status: Type.Literal("unavailable"),
          reasonCode: UpperCodeSchema,
          ownerCode: UpperCodeSchema,
          nextActionCode: UpperCodeSchema,
        },
        { additionalProperties: false },
      ),
    ]),
    evidence: Type.Object(
      {
        sourceDigest: Sha256Schema,
        attestationHash: Sha256Schema,
        refs: Type.Array(Sha256Schema, { minItems: 1, maxItems: 32, uniqueItems: true }),
        contentCapture: Type.Literal(false),
      },
      { additionalProperties: false },
    ),
    outcomeId: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/client-outcome-v1.json", additionalProperties: false },
);

export const ClientOutcomeComparisonV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    scenarioId: ClientOutcomeScenarioIdSchema,
    evidenceKind: Type.Union([Type.Literal("fixture"), Type.Literal("live")]),
    outcomeIds: Type.Object(
      {
        vscode: Sha256Schema,
        cli: Sha256Schema,
      },
      { additionalProperties: false },
    ),
    binding: Type.Object(
      {
        candidateId: Sha256Schema,
        toolchainHash: Sha256Schema,
        clients: Type.Object(
          {
            vscodeVersion: VersionSchema,
            vscodeExtensionVersion: VersionSchema,
            cliVersion: VersionSchema,
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    status: Type.Union([Type.Literal("pass"), Type.Literal("fail"), Type.Literal("unavailable")]),
    qualifiesRelease: Type.Literal(false),
    mismatches: Type.Array(JsonPointerSchema, { maxItems: 64, uniqueItems: true }),
    blockers: Type.Array(UpperCodeSchema, { maxItems: 32, uniqueItems: true }),
    comparisonId: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/client-outcome-comparison-v1.json", additionalProperties: false },
);

export const ClientOutcomeQualificationV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    evidenceKind: Type.Union([Type.Literal("fixture"), Type.Literal("live")]),
    binding: Type.Object(
      {
        candidateId: Sha256Schema,
        toolchainHash: Sha256Schema,
        clients: Type.Object(
          {
            vscodeVersion: VersionSchema,
            vscodeExtensionVersion: VersionSchema,
            cliVersion: VersionSchema,
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    comparisons: Type.Array(
      Type.Object(
        {
          scenarioId: ClientOutcomeScenarioIdSchema,
          comparisonId: Sha256Schema,
          outcomeIds: Type.Object(
            {
              vscode: Sha256Schema,
              cli: Sha256Schema,
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: CLIENT_OUTCOME_SCENARIO_IDS.length, maxItems: CLIENT_OUTCOME_SCENARIO_IDS.length },
    ),
    status: Type.Literal("pass"),
    matrixComplete: Type.Literal(true),
    qualifiesClientParity: Type.Literal(true),
    qualifiesRelease: Type.Literal(false),
    qualificationId: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/client-outcome-qualification-v1.json", additionalProperties: false },
);

export const EvidenceManifestV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    createdAt: IsoDateTimeSchema,
    entries: Type.Array(
      Type.Object(
        {
          kind: NonEmptyStringSchema,
          hash: Sha256Schema,
          bytes: Type.Integer({ minimum: 0 }),
          required: Type.Boolean(),
          retention: Type.Union([Type.Literal("immutable"), Type.Literal("project"), Type.Literal("optional")]),
        },
        { additionalProperties: false },
      ),
    ),
    clientQualification: Type.Optional(
      Type.Object(
        {
          kind: Type.Literal("client-qualification"),
          hash: Sha256Schema,
          bytes: Type.Integer({ minimum: 1 }),
          required: Type.Literal(true),
          retention: Type.Literal("immutable"),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: "https://schemas.apexops.dev/evidence-manifest-v1.json", additionalProperties: false },
);

export const LIVE_QUALIFICATION_SCENARIO_IDS = [
  "vscode-experience",
  "restart-cross-device",
  "github-oidc-writer-transfer",
  "bicep-lifecycle",
  "terraform-lifecycle",
  "promotion",
] as const;

const LiveQualificationScenarioIdSchema = Type.Union([
  Type.Literal(LIVE_QUALIFICATION_SCENARIO_IDS[0]),
  Type.Literal(LIVE_QUALIFICATION_SCENARIO_IDS[1]),
  Type.Literal(LIVE_QUALIFICATION_SCENARIO_IDS[2]),
  Type.Literal(LIVE_QUALIFICATION_SCENARIO_IDS[3]),
  Type.Literal(LIVE_QUALIFICATION_SCENARIO_IDS[4]),
  Type.Literal(LIVE_QUALIFICATION_SCENARIO_IDS[5]),
]);

const LiveQualificationScenarioBase = {
  id: LiveQualificationScenarioIdSchema,
  environment: NonEmptyStringSchema,
  targetScope: NonEmptyStringSchema,
  actor: NonEmptyStringSchema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  toolVersions: Type.Record(Type.String({ pattern: "^[a-z][a-z0-9.-]*$" }), NonEmptyStringSchema, {
    minProperties: 1,
  }),
};

const LiveQualificationScenarioV1Schema = Type.Union([
  Type.Object(
    {
      ...LiveQualificationScenarioBase,
      outcome: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
      evidenceRefs: Type.Array(Sha256Schema, { minItems: 1, uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...LiveQualificationScenarioBase,
      outcome: Type.Literal("unavailable"),
      evidenceRefs: Type.Array(Sha256Schema, { uniqueItems: true }),
      disposition: Type.Object(
        {
          reason: NonEmptyStringSchema,
          owner: NonEmptyStringSchema,
          nextAction: NonEmptyStringSchema,
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);

export const LiveQualificationV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    candidate: Type.Object(
      {
        repository: NonEmptyStringSchema,
        branch: NonEmptyStringSchema,
        commit: Type.String({ pattern: "^[0-9a-f]{40}$" }),
        packageLockHash: Sha256Schema,
        releaseManifestHash: Sha256Schema,
        runtimeBundleHash: Sha256Schema,
        customizationBundleHash: Sha256Schema,
      },
      { additionalProperties: false },
    ),
    createdAt: IsoDateTimeSchema,
    evidenceManifestHash: Sha256Schema,
    scenarios: Type.Array(LiveQualificationScenarioV1Schema, { minItems: 1 }),
  },
  { $id: "https://schemas.apexops.dev/live-qualification-v1.json", additionalProperties: false },
);

export const ScorecardRuleV1Schema = Type.Object(
  {
    metric: NonEmptyStringSchema,
    direction: Type.Union([Type.Literal("min"), Type.Literal("max"), Type.Literal("exact")]),
    target: Type.Number(),
    tolerance: Type.Number({ minimum: 0 }),
    scenario: NonEmptyStringSchema,
    minimumSamples: Type.Integer({ minimum: 1 }),
    source: Type.Union([Type.Literal("kernel"), Type.Literal("vscode"), Type.Literal("estimated")]),
    owner: NonEmptyStringSchema,
    unavailable: Type.Union([Type.Literal("block"), Type.Literal("omit-claim")]),
  },
  { additionalProperties: false },
);

export const QualityScorecardV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    frozenAt: IsoDateTimeSchema,
    rules: Type.Array(ScorecardRuleV1Schema, { minItems: 1 }),
  },
  { $id: "https://schemas.apexops.dev/quality-scorecard-v1.json", additionalProperties: false },
);

export const QualityMeasurementsV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    measurements: Type.Array(
      Type.Object(
        {
          metric: NonEmptyStringSchema,
          scenario: NonEmptyStringSchema,
          value: Type.Optional(Type.Number()),
          samples: Type.Integer({ minimum: 0 }),
          evidenceRefs: Type.Array(Sha256Schema, { uniqueItems: true }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: "https://schemas.apexops.dev/quality-measurements-v1.json", additionalProperties: false },
);

const AvailabilityCheckV1Schema = Type.Object(
  {
    status: Type.Union([Type.Literal("current"), Type.Literal("unavailable"), Type.Literal("blocked")]),
    evidenceRef: Sha256Schema,
  },
  { additionalProperties: false },
);

export const ArchitectureAvailabilityV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    targetScope: NonEmptyStringSchema,
    mode: Type.Union([Type.Literal("native"), Type.Literal("simulated")]),
    collectedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    checks: Type.Object(
      {
        pricing: AvailabilityCheckV1Schema,
        quota: AvailabilityCheckV1Schema,
        regionalAvailability: AvailabilityCheckV1Schema,
      },
      { additionalProperties: false },
    ),
  },
  { $id: "https://schemas.apexops.dev/architecture-availability-v1.json", additionalProperties: false },
);

export type EvidenceManifestV1 = Static<typeof EvidenceManifestV1Schema>;
export type ClientOutcomeV1 = Static<typeof ClientOutcomeV1Schema>;
export type ClientOutcomeComparisonV1 = Static<typeof ClientOutcomeComparisonV1Schema>;
export type ClientOutcomeQualificationV1 = Static<typeof ClientOutcomeQualificationV1Schema>;
export type LiveQualificationV1 = Static<typeof LiveQualificationV1Schema>;
export type QualityScorecardV1 = Static<typeof QualityScorecardV1Schema>;
export type QualityMeasurementsV1 = Static<typeof QualityMeasurementsV1Schema>;
export type ArchitectureAvailabilityV1 = Static<typeof ArchitectureAvailabilityV1Schema>;

const CLIENT_QUALIFICATION_MAX_BYTES = 65_536;

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortCanonicalValue(child)]),
    );
  }
  return value;
}

function canonicalQualificationBytes(qualificationPayload: ClientOutcomeQualificationV1 | Uint8Array): {
  qualification: ClientOutcomeQualificationV1;
  bytes: Buffer;
} {
  let qualification: unknown = qualificationPayload;
  let suppliedBytes: Buffer | undefined;
  if (qualificationPayload instanceof Uint8Array) {
    suppliedBytes = Buffer.from(qualificationPayload);
    if (suppliedBytes.byteLength > CLIENT_QUALIFICATION_MAX_BYTES) {
      throw new TypeError("CLIENT_QUALIFICATION_BYTES_INVALID");
    }
    try {
      qualification = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(suppliedBytes));
    } catch {
      throw new TypeError("CLIENT_QUALIFICATION_BYTES_INVALID");
    }
  }
  if (!Value.Check(ClientOutcomeQualificationV1Schema, qualification)) {
    throw new TypeError("CLIENT_QUALIFICATION_SCHEMA_INVALID");
  }
  const canonicalBytes = Buffer.from(JSON.stringify(sortCanonicalValue(qualification)), "utf8");
  if (canonicalBytes.byteLength > CLIENT_QUALIFICATION_MAX_BYTES) {
    throw new TypeError("CLIENT_QUALIFICATION_BYTES_INVALID");
  }
  if (suppliedBytes !== undefined && !suppliedBytes.equals(canonicalBytes)) {
    throw new TypeError("CLIENT_QUALIFICATION_BYTES_NOT_CANONICAL");
  }
  const { qualificationId: _qualificationId, ...content } = qualification;
  const expectedId = createHash("sha256")
    .update(Buffer.from(JSON.stringify(sortCanonicalValue(content)), "utf8"))
    .digest("hex");
  if (qualification.qualificationId !== expectedId) throw new TypeError("CLIENT_QUALIFICATION_ID_INVALID");
  if (!qualification.matrixComplete || !qualification.qualifiesClientParity || qualification.qualifiesRelease) {
    throw new TypeError("CLIENT_QUALIFICATION_NOT_PARITY_ONLY");
  }
  return { qualification, bytes: canonicalBytes };
}

export function createClientQualificationEvidenceEntry(
  qualificationPayload: ClientOutcomeQualificationV1 | Uint8Array,
): NonNullable<EvidenceManifestV1["clientQualification"]> {
  const { bytes } = canonicalQualificationBytes(qualificationPayload);
  return {
    kind: "client-qualification",
    hash: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    required: true,
    retention: "immutable",
  };
}

export function hasBoundClientQualification(
  manifest: EvidenceManifestV1,
  qualificationPayload: ClientOutcomeQualificationV1 | Uint8Array,
): boolean {
  try {
    const expected = createClientQualificationEvidenceEntry(qualificationPayload);
    const entry = manifest.clientQualification;
    return entry !== undefined && JSON.stringify(entry) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

export function hasValidLiveQualification(qualification: LiveQualificationV1): boolean {
  const scenarioIds = qualification.scenarios.map(({ id }) => id);
  const uniqueScenarioIds = new Set(scenarioIds);
  const createdAt = Date.parse(qualification.createdAt);
  return (
    scenarioIds.length === LIVE_QUALIFICATION_SCENARIO_IDS.length &&
    uniqueScenarioIds.size === LIVE_QUALIFICATION_SCENARIO_IDS.length &&
    LIVE_QUALIFICATION_SCENARIO_IDS.every((id) => uniqueScenarioIds.has(id)) &&
    Number.isFinite(createdAt) &&
    qualification.scenarios.every(({ startedAt, completedAt }) => {
      const started = Date.parse(startedAt);
      const completed = Date.parse(completedAt);
      return Number.isFinite(started) && Number.isFinite(completed) && createdAt <= started && started <= completed;
    })
  );
}

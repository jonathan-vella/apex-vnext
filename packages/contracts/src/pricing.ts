import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ContractVersionSchema,
  IsoDateTimeSchema,
  ProjectIdSchema,
  RunIdSchema,
  SECRET_FIELD_PATTERN,
  SECRET_VALUE_PATTERN,
  Sha256Schema,
  registerContractFormats,
} from "./common.js";
import { CurrencySchema } from "./targets.js";

export const PRICING_PARITY_SCENARIO_IDS = [
  "PRICING-001-retail",
  "PRICING-002-meter-aware",
  "PRICING-003-bulk",
  "PRICING-004-regional",
  "PRICING-005-commitments",
  "PRICING-006-negotiated",
  "PRICING-007-ambiguity",
  "PRICING-008-uncertainty",
  "PRICING-009-throttling",
  "PRICING-010-provenance",
] as const;

const ScenarioIdSchema = Type.Union(PRICING_PARITY_SCENARIO_IDS.map((id) => Type.Literal(id)));
const IdentifierSchema = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9 ._()/-]{0,127}$", maxLength: 128 });
const RegionSchema = Type.String({ pattern: "^[a-z][a-z0-9-]{1,31}$", maxLength: 32 });
const CodeSchema = Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,63}$", maxLength: 64 });
const UnitDimensionSchema = Type.Union([
  Type.Literal("hour"),
  Type.Literal("day"),
  Type.Literal("month"),
  Type.Literal("second"),
  Type.Literal("gb-month"),
  Type.Literal("gb"),
  Type.Literal("transactions"),
]);
const CommitmentSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("none"), Type.Literal("reservation"), Type.Literal("savings-plan")]),
    termMonths: Type.Optional(Type.Union([Type.Literal(12), Type.Literal(36)])),
    priceBasis: Type.Optional(Type.Union([Type.Literal("hourly"), Type.Literal("total")])),
  },
  { additionalProperties: false },
);
const TargetSchema = Type.Object(
  {
    serviceName: IdentifierSchema,
    skuName: Type.Optional(IdentifierSchema),
    regions: Type.Array(RegionSchema, { minItems: 1, maxItems: 16, uniqueItems: true }),
    currency: CurrencySchema,
  },
  { additionalProperties: false },
);
const UsageSchema = Type.Object(
  {
    dimension: UnitDimensionSchema,
    quantity: Type.Number({ minimum: 0, maximum: 1_000_000_000 }),
  },
  { additionalProperties: false },
);
const MeterSchema = Type.Object(
  {
    meterId: IdentifierSchema,
    unitDimension: UnitDimensionSchema,
    unitQuantity: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000_000 }),
  },
  { additionalProperties: false },
);

export const PricingRequestV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    scenarioId: ScenarioIdSchema,
    target: TargetSchema,
    usage: UsageSchema,
    meter: Type.Optional(MeterSchema),
    bulkItems: Type.Optional(
      Type.Array(
        Type.Object(
          {
            specId: IdentifierSchema,
            target: TargetSchema,
            usage: UsageSchema,
            meter: Type.Optional(MeterSchema),
          },
          { additionalProperties: false },
        ),
        { minItems: 2, maxItems: 256 },
      ),
    ),
    commitment: Type.Optional(CommitmentSchema),
    requestedAt: IsoDateTimeSchema,
    requestId: Sha256Schema,
  },
  { $id: "https://schemas.apexops.dev/pricing-request-v1.json", additionalProperties: false },
);

const PriceRecordSchema = Type.Object(
  {
    specId: Type.Optional(IdentifierSchema),
    priceId: IdentifierSchema,
    meterId: IdentifierSchema,
    serviceName: IdentifierSchema,
    skuName: IdentifierSchema,
    region: RegionSchema,
    currency: CurrencySchema,
    priceType: Type.Union([
      Type.Literal("consumption"),
      Type.Literal("reservation"),
      Type.Literal("savings-plan"),
      Type.Literal("negotiated"),
    ]),
    unitDimension: UnitDimensionSchema,
    unitQuantity: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000_000 }),
    unitPrice: Type.Number({ minimum: 0, maximum: 1_000_000_000 }),
    usageQuantity: Type.Number({ minimum: 0, maximum: 1_000_000_000 }),
    projectedAmount: Type.Number({ minimum: 0, maximum: 1_000_000_000_000 }),
    commitment: CommitmentSchema,
    uncertainty: Type.Object(
      {
        lowerAmount: Type.Number({ minimum: 0, maximum: 1_000_000_000_000 }),
        upperAmount: Type.Number({ minimum: 0, maximum: 1_000_000_000_000 }),
        confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
        reasonCodes: Type.Array(CodeSchema, { maxItems: 16, uniqueItems: true }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const ProvenanceSchema = Type.Object(
  {
    provider: Type.Literal("azure-resource-manager-mcp"),
    endpointId: IdentifierSchema,
    toolName: IdentifierSchema,
    toolVersion: Type.String({ pattern: "^[0-9]+(?:\\.[0-9]+){1,3}(?:-[0-9A-Za-z.-]+)?$", maxLength: 32 }),
    toolchainHash: Sha256Schema,
    toolsListHash: Sha256Schema,
    rawSourceDigest: Sha256Schema,
    rawSourceBytes: Type.Integer({ minimum: 1, maximum: 16_777_216 }),
    contentCapture: Type.Literal(false),
  },
  { additionalProperties: false },
);

const NextActionCodeSchema = Type.Union([
  Type.Literal("SELECT_CANDIDATE"),
  Type.Literal("RETRY_LATER"),
  Type.Literal("RETRY_WITH_ATTESTED_SOURCE"),
  Type.Literal("REFRESH_TOOL_BINDING"),
  Type.Literal("REQUEST_AUTHORIZATION"),
]);

export const PricingEvidenceV1Schema = Type.Object(
  {
    schemaVersion: ContractVersionSchema,
    projectId: ProjectIdSchema,
    runId: RunIdSchema,
    scenarioId: ScenarioIdSchema,
    requestId: Sha256Schema,
    requestHash: Sha256Schema,
    evidenceId: Sha256Schema,
    provenance: ProvenanceSchema,
    collectedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    result: Type.Union([
      Type.Object(
        {
          status: Type.Literal("matched"),
          records: Type.Array(PriceRecordSchema, { minItems: 1, maxItems: 256 }),
          totalAmount: Type.Number({ minimum: 0, maximum: 1_000_000_000_000 }),
          paginationStatus: Type.Union([Type.Literal("complete"), Type.Literal("partial")]),
          continuationCursorHash: Type.Optional(Sha256Schema),
          bulk: Type.Optional(
            Type.Object(
              {
                deduplicatedSpecs: Type.Integer({ minimum: 1, maximum: 256 }),
                successful: Type.Integer({ minimum: 0, maximum: 256 }),
                failed: Type.Integer({ minimum: 0, maximum: 256 }),
                partialFailures: Type.Array(
                  Type.Object({ specId: IdentifierSchema, reasonCode: CodeSchema }, { additionalProperties: false }),
                  { maxItems: 256 },
                ),
              },
              { additionalProperties: false },
            ),
          ),
          regionalUnavailable: Type.Optional(Type.Array(RegionSchema, { maxItems: 16, uniqueItems: true })),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          status: Type.Literal("ambiguous"),
          reasonCode: CodeSchema,
          candidateIds: Type.Array(IdentifierSchema, { minItems: 2, maxItems: 32, uniqueItems: true }),
          nextActionCode: NextActionCodeSchema,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          status: Type.Literal("unavailable"),
          reasonCode: Type.Union([
            Type.Literal("NO_MATCH"),
            Type.Literal("THROTTLED"),
            Type.Literal("TIMEOUT"),
            Type.Literal("AUTHORIZATION_DENIED"),
            Type.Literal("TOOL_DRIFT"),
            Type.Literal("MALFORMED_SOURCE"),
            Type.Literal("NEGOTIATED_PRICE_UNAVAILABLE"),
          ]),
          attemptCount: Type.Integer({ minimum: 1, maximum: 16 }),
          retryAt: Type.Optional(IsoDateTimeSchema),
          nextActionCode: NextActionCodeSchema,
        },
        { additionalProperties: false },
      ),
    ]),
    qualifiesGate: Type.Literal(false),
  },
  { $id: "https://schemas.apexops.dev/pricing-evidence-v1.json", additionalProperties: false },
);

export type PricingRequestV1 = Static<typeof PricingRequestV1Schema>;
export type PricingEvidenceV1 = Static<typeof PricingEvidenceV1Schema>;

const MAX_EVIDENCE_LIFETIME_MS = 24 * 60 * 60 * 1_000;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError("PRICING_NON_JSON_VALUE");
}

function contentHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function containsSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([key, child]) => SECRET_FIELD_PATTERN.test(key) || containsSecret(child));
  }
  return typeof value === "string" && SECRET_VALUE_PATTERN.test(value);
}

function amountsEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 16;
}

function isExactDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function calculatePricingRequestId(request: Omit<PricingRequestV1, "requestId">): string {
  return contentHash(request);
}

export function calculatePricingEvidenceId(evidence: Omit<PricingEvidenceV1, "evidenceId">): string {
  return contentHash(evidence);
}

export function hasValidPricingEvidence(
  request: PricingRequestV1,
  evidence: PricingEvidenceV1,
  evaluatedAt: number | string = Date.now(),
): boolean {
  registerContractFormats();
  if (!Value.Check(PricingRequestV1Schema, request) || !Value.Check(PricingEvidenceV1Schema, evidence)) return false;
  if (containsSecret(request) || containsSecret(evidence)) return false;
  const validCommitment = (
    commitment: { kind: string; termMonths?: number; priceBasis?: string } | undefined,
  ): boolean =>
    commitment === undefined ||
    (commitment.kind === "none"
      ? commitment.termMonths === undefined && commitment.priceBasis === undefined
      : (commitment.termMonths === 12 || commitment.termMonths === 36) && commitment.priceBasis !== undefined);
  if (!validCommitment(request.commitment)) return false;
  if (
    (request.scenarioId === "PRICING-003-bulk") !== (request.bulkItems !== undefined) ||
    (request.scenarioId === "PRICING-005-commitments"
      ? request.commitment === undefined || request.commitment.kind === "none"
      : request.commitment !== undefined && request.commitment.kind !== "none")
  ) {
    return false;
  }
  const { requestId: _requestId, ...requestContent } = request;
  const { evidenceId: _evidenceId, ...evidenceContent } = evidence;
  const evaluationTime = typeof evaluatedAt === "number" ? evaluatedAt : Date.parse(evaluatedAt);
  if (
    !Number.isFinite(evaluationTime) ||
    !isExactDateTime(request.requestedAt) ||
    !isExactDateTime(evidence.collectedAt) ||
    !isExactDateTime(evidence.expiresAt) ||
    request.requestId !== calculatePricingRequestId(requestContent) ||
    evidence.evidenceId !== calculatePricingEvidenceId(evidenceContent) ||
    evidence.requestId !== request.requestId ||
    evidence.requestHash !== request.requestId ||
    evidence.projectId !== request.projectId ||
    evidence.runId !== request.runId ||
    evidence.scenarioId !== request.scenarioId ||
    Date.parse(evidence.collectedAt) < Date.parse(request.requestedAt) ||
    Date.parse(evidence.collectedAt) > evaluationTime ||
    Date.parse(evidence.expiresAt) <= Date.parse(evidence.collectedAt) ||
    Date.parse(evidence.expiresAt) - Date.parse(evidence.collectedAt) > MAX_EVIDENCE_LIFETIME_MS ||
    Date.parse(evidence.expiresAt) <= evaluationTime
  ) {
    return false;
  }
  const expectedDisposition =
    request.scenarioId === "PRICING-007-ambiguity"
      ? "ambiguous"
      : request.scenarioId === "PRICING-006-negotiated" || request.scenarioId === "PRICING-009-throttling"
        ? "unavailable"
        : "matched";
  if (evidence.result.status !== expectedDisposition) return false;
  if (evidence.result.status === "ambiguous") {
    return request.scenarioId === "PRICING-007-ambiguity" && evidence.result.nextActionCode === "SELECT_CANDIDATE";
  }
  if (evidence.result.status === "unavailable") {
    return (
      (request.scenarioId === "PRICING-006-negotiated" &&
        evidence.result.reasonCode === "NEGOTIATED_PRICE_UNAVAILABLE" &&
        evidence.result.nextActionCode === "RETRY_WITH_ATTESTED_SOURCE") ||
      (request.scenarioId === "PRICING-009-throttling" &&
        evidence.result.reasonCode === "THROTTLED" &&
        evidence.result.retryAt !== undefined &&
        isExactDateTime(evidence.result.retryAt) &&
        Date.parse(evidence.result.retryAt) > Date.parse(evidence.collectedAt) &&
        evidence.result.nextActionCode === "RETRY_LATER")
    );
  }
  const matchedResult = evidence.result;
  const total = matchedResult.records.reduce((sum, record) => sum + record.projectedAmount, 0);
  const requestCommitment: { kind: string; termMonths?: number; priceBasis?: string } = request.commitment ?? {
    kind: "none",
  };
  const recordMatchesInputs = (
    record: Static<typeof PriceRecordSchema>,
    target: Static<typeof TargetSchema>,
    usage: Static<typeof UsageSchema>,
    meter: Static<typeof MeterSchema> | undefined,
    commitment: { kind: string; termMonths?: number; priceBasis?: string },
  ): boolean =>
    record.serviceName === target.serviceName &&
    (target.skuName === undefined || record.skuName === target.skuName) &&
    target.regions.includes(record.region) &&
    record.currency === target.currency &&
    record.unitDimension === usage.dimension &&
    record.usageQuantity === usage.quantity &&
    (meter === undefined ||
      (record.meterId === meter.meterId &&
        record.unitDimension === meter.unitDimension &&
        record.unitQuantity === meter.unitQuantity)) &&
    record.commitment.kind === commitment.kind &&
    record.commitment.termMonths === commitment.termMonths &&
    record.commitment.priceBasis === commitment.priceBasis &&
    (commitment.kind === "none" ? record.priceType === "consumption" : record.priceType === commitment.kind);
  const recordMatchesRequest = (record: Static<typeof PriceRecordSchema>): boolean => {
    if (request.scenarioId !== "PRICING-003-bulk") {
      return (
        record.specId === undefined &&
        recordMatchesInputs(record, request.target, request.usage, request.meter, requestCommitment)
      );
    }
    const item = request.bulkItems?.find(({ specId }) => specId === record.specId);
    return item !== undefined && recordMatchesInputs(record, item.target, item.usage, item.meter, { kind: "none" });
  };
  const firstRecord = matchedResult.records[0];
  if (firstRecord === undefined) return false;
  const paginationValid =
    matchedResult.paginationStatus === "complete"
      ? matchedResult.continuationCursorHash === undefined
      : matchedResult.continuationCursorHash !== undefined;
  const bulkSpecIds = request.bulkItems?.map(({ specId }) => specId) ?? [];
  const bulkRecordIds = matchedResult.records.flatMap(({ specId }) => (specId === undefined ? [] : [specId]));
  const bulkFailureIds = matchedResult.bulk?.partialFailures.map(({ specId }) => specId) ?? [];
  const scenarioSemanticsValid =
    (request.scenarioId === "PRICING-003-bulk" ? matchedResult.bulk !== undefined : matchedResult.bulk === undefined) &&
    (request.scenarioId === "PRICING-004-regional"
      ? matchedResult.regionalUnavailable !== undefined
      : matchedResult.regionalUnavailable === undefined) &&
    (request.scenarioId !== "PRICING-002-meter-aware" || request.meter !== undefined) &&
    (request.scenarioId !== "PRICING-003-bulk" ||
      (request.bulkItems !== undefined &&
        new Set(bulkSpecIds).size === bulkSpecIds.length &&
        matchedResult.bulk !== undefined &&
        matchedResult.bulk.deduplicatedSpecs === bulkSpecIds.length &&
        matchedResult.bulk.successful === bulkRecordIds.length &&
        matchedResult.bulk.failed === bulkFailureIds.length &&
        matchedResult.bulk.successful + matchedResult.bulk.failed === matchedResult.bulk.deduplicatedSpecs &&
        new Set([...bulkRecordIds, ...bulkFailureIds]).size === bulkSpecIds.length &&
        [...bulkRecordIds, ...bulkFailureIds].every((specId) => bulkSpecIds.includes(specId)))) &&
    (request.scenarioId !== "PRICING-004-regional" ||
      (request.target.regions.length >= 2 &&
        request.target.regions.every(
          (region) =>
            matchedResult.records.some((record) => record.region === region) ||
            matchedResult.regionalUnavailable?.includes(region),
        ) &&
        matchedResult.records.every(
          (record) =>
            record.skuName === firstRecord.skuName &&
            record.currency === firstRecord.currency &&
            record.meterId === firstRecord.meterId &&
            record.unitDimension === firstRecord.unitDimension &&
            record.unitQuantity === firstRecord.unitQuantity &&
            record.priceType === firstRecord.priceType,
        ) &&
        (matchedResult.regionalUnavailable ?? []).every(
          (region) =>
            request.target.regions.includes(region) &&
            !matchedResult.records.some((record) => record.region === region),
        ))) &&
    (request.scenarioId !== "PRICING-005-commitments" || requestCommitment.kind !== "none") &&
    (request.scenarioId !== "PRICING-008-uncertainty" ||
      matchedResult.records.every(
        (record) =>
          record.uncertainty.lowerAmount < record.projectedAmount &&
          record.uncertainty.upperAmount > record.projectedAmount &&
          record.uncertainty.confidence !== "high" &&
          record.uncertainty.reasonCodes.length > 0,
      ));
  return (
    amountsEqual(total, matchedResult.totalAmount) &&
    paginationValid &&
    scenarioSemanticsValid &&
    matchedResult.records.every(
      (record) =>
        validCommitment(record.commitment) &&
        recordMatchesRequest(record) &&
        amountsEqual(
          record.projectedAmount,
          record.commitment.priceBasis === "total"
            ? record.unitPrice
            : (record.unitPrice * record.usageQuantity) / record.unitQuantity,
        ) &&
        record.uncertainty.lowerAmount <= record.projectedAmount &&
        record.uncertainty.upperAmount >= record.projectedAmount,
    )
  );
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculatePricingEvidenceId,
  calculatePricingRequestId,
  hasValidPricingEvidence,
  registerContractFormats,
} from "../../packages/contracts/dist/index.js";
import { validatePricingParity } from "../scripts/validate-pricing-parity.mjs";

const registry = JSON.parse(readFileSync("tools/registry/pricing-parity-scenarios.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/pricing-parity-scenarios.schema.json", "utf8"));
registerContractFormats();

const mutate = (callback) => {
  const value = structuredClone(registry);
  callback(value);
  return value;
};

const hash = (character) => character.repeat(64);

function requestFor(scenarioId) {
  const content = {
    schemaVersion: "1.0.0",
    projectId: "pricing-parity",
    runId: "run-1",
    scenarioId,
    target: {
      serviceName: "Virtual Machines",
      skuName: "D2s v5",
      regions: scenarioId === "PRICING-004-regional" ? ["swedencentral", "westeurope"] : ["swedencentral"],
      currency: "USD",
    },
    usage: { dimension: "hour", quantity: 730 },
    meter: { meterId: "compute-hour", unitDimension: "hour", unitQuantity: 1 },
    ...(scenarioId === "PRICING-003-bulk"
      ? {
          bulkItems: [
            {
              specId: "spec-1",
              target: {
                serviceName: "Virtual Machines",
                skuName: "D2s v5",
                regions: ["swedencentral"],
                currency: "USD",
              },
              usage: { dimension: "hour", quantity: 730 },
              meter: { meterId: "compute-hour", unitDimension: "hour", unitQuantity: 1 },
            },
            {
              specId: "spec-2",
              target: {
                serviceName: "Storage",
                skuName: "Standard LRS",
                regions: ["swedencentral"],
                currency: "USD",
              },
              usage: { dimension: "gb-month", quantity: 100 },
              meter: { meterId: "storage-month", unitDimension: "gb-month", unitQuantity: 1 },
            },
          ],
        }
      : {}),
    commitment:
      scenarioId === "PRICING-005-commitments"
        ? { kind: "reservation", termMonths: 12, priceBasis: "total" }
        : { kind: "none" },
    requestedAt: "2026-07-29T08:00:00.000Z",
  };
  return { ...content, requestId: calculatePricingRequestId(content) };
}

function resultFor(scenario) {
  if (scenario.expectedDisposition === "ambiguous") {
    return {
      status: "ambiguous",
      reasonCode: "MULTIPLE_MATCHES",
      candidateIds: ["candidate-1", "candidate-2"],
      nextActionCode: "SELECT_CANDIDATE",
    };
  }
  if (scenario.expectedDisposition === "unavailable") {
    return {
      status: "unavailable",
      reasonCode: scenario.id === "PRICING-006-negotiated" ? "NEGOTIATED_PRICE_UNAVAILABLE" : "THROTTLED",
      attemptCount: 3,
      ...(scenario.id === "PRICING-009-throttling" ? { retryAt: "2026-07-29T08:10:00.000Z" } : {}),
      nextActionCode: scenario.id === "PRICING-006-negotiated" ? "RETRY_WITH_ATTESTED_SOURCE" : "RETRY_LATER",
    };
  }
  return {
    status: "matched",
    records: [
      {
        ...(scenario.id === "PRICING-003-bulk" ? { specId: "spec-1" } : {}),
        priceId: "price-1",
        meterId: "compute-hour",
        serviceName: "Virtual Machines",
        skuName: "D2s v5",
        region: "swedencentral",
        currency: "USD",
        priceType: scenario.id === "PRICING-005-commitments" ? "reservation" : "consumption",
        unitDimension: "hour",
        unitQuantity: 1,
        unitPrice: scenario.id === "PRICING-005-commitments" ? 73 : 0.1,
        usageQuantity: 730,
        projectedAmount: 73,
        commitment:
          scenario.id === "PRICING-005-commitments"
            ? { kind: "reservation", termMonths: 12, priceBasis: "total" }
            : { kind: "none" },
        uncertainty: {
          lowerAmount: scenario.id === "PRICING-008-uncertainty" ? 65 : 73,
          upperAmount: scenario.id === "PRICING-008-uncertainty" ? 80 : 73,
          confidence: scenario.id === "PRICING-008-uncertainty" ? "medium" : "high",
          reasonCodes: scenario.id === "PRICING-008-uncertainty" ? ["USAGE_ESTIMATE"] : [],
        },
      },
    ],
    totalAmount: 73,
    paginationStatus: "complete",
    ...(scenario.id === "PRICING-003-bulk"
      ? {
          bulk: {
            deduplicatedSpecs: 2,
            successful: 1,
            failed: 1,
            partialFailures: [{ specId: "spec-2", reasonCode: "NO_MATCH" }],
          },
        }
      : {}),
    ...(scenario.id === "PRICING-004-regional" ? { regionalUnavailable: ["westeurope"] } : {}),
  };
}

function evidenceFor(request, scenario) {
  const content = {
    schemaVersion: "1.0.0",
    projectId: request.projectId,
    runId: request.runId,
    scenarioId: request.scenarioId,
    requestId: request.requestId,
    requestHash: request.requestId,
    provenance: {
      provider: "azure-resource-manager-mcp",
      endpointId: "arm-pricing",
      toolName: "pricing-read",
      toolVersion: "1.0.0",
      toolchainHash: hash("a"),
      toolsListHash: hash("b"),
      rawSourceDigest: hash("c"),
      rawSourceBytes: 512,
      contentCapture: false,
    },
    collectedAt: "2026-07-29T08:01:00.000Z",
    expiresAt: "2026-07-29T09:01:00.000Z",
    result: resultFor(scenario),
    qualifiesGate: false,
  };
  return { ...content, evidenceId: calculatePricingEvidenceId(content) };
}

function rehashEvidence(evidence) {
  const { evidenceId: _evidenceId, ...content } = evidence;
  return { ...content, evidenceId: calculatePricingEvidenceId(content) };
}

test("canonical pricing parity registry is complete", () => {
  assert.deepEqual(validatePricingParity(registry, schema), []);
});

test("every scenario rejects semantic drift", () => {
  for (const [index, scenario] of registry.scenarios.entries()) {
    const drifted = mutate((value) => {
      value.scenarios[index].arithmeticPredicate = "drifted-predicate";
    });
    assert.ok(
      validatePricingParity(drifted, schema).some((error) => error.includes(scenario.id)),
      scenario.id,
    );
  }
  for (const field of ["sourceOwners", "requiredSemantics"]) {
    const drifted = mutate((value) => {
      value.scenarios[0][field][0] = `${value.scenarios[0][field][0]}-drift`;
    });
    assert.ok(validatePricingParity(drifted, schema).some((error) => error.includes("registry content drifted")));
  }
  const prohibitedDrift = mutate((value) => {
    value.scenarios[0].prohibitedFields = value.scenarios[0].prohibitedFields.slice(1);
  });
  assert.ok(validatePricingParity(prohibitedDrift, schema).length > 0);
});

test("every parity scenario has valid bound deterministic evidence", () => {
  for (const scenario of registry.scenarios) {
    const request = requestFor(scenario.id);
    const evidence = evidenceFor(request, scenario);
    assert.equal(hasValidPricingEvidence(request, evidence, "2026-07-29T08:30:00.000Z"), true, scenario.id);
    assert.equal(
      hasValidPricingEvidence({ ...request, requestId: hash("f") }, evidence, "2026-07-29T08:30:00.000Z"),
      false,
      scenario.id,
    );
  }
});

test("pricing evidence rejects secret values and prose/raw authority fields", () => {
  const scenario = registry.scenarios[0];
  const request = requestFor(scenario.id);
  const evidence = evidenceFor(request, scenario);
  const secretRequestContent = {
    ...request,
    target: { ...request.target, serviceName: "Bearer abcdefghijklmnop" },
  };
  const { requestId: _requestId, ...secretContent } = secretRequestContent;
  const secretRequest = { ...secretContent, requestId: calculatePricingRequestId(secretContent) };
  const evaluatedAt = "2026-07-29T08:30:00.000Z";
  assert.equal(hasValidPricingEvidence(secretRequest, evidence, evaluatedAt), false);
  assert.equal(hasValidPricingEvidence(request, { ...evidence, message: "selected first result" }, evaluatedAt), false);
  assert.equal(hasValidPricingEvidence(request, { ...evidence, rawPayload: {} }, evaluatedAt), false);
  assert.equal(hasValidPricingEvidence(request, { ...evidence, qualifiesGate: true }, evaluatedAt), false);
  assert.equal(hasValidPricingEvidence({ ...request, unexpected: undefined }, evidence, evaluatedAt), false);
  assert.equal(hasValidPricingEvidence(request, { ...evidence, unexpected: Number.NaN }, evaluatedAt), false);
  assert.equal(
    hasValidPricingEvidence(
      request,
      {
        ...evidence,
        result: {
          status: "ambiguous",
          reasonCode: "MULTIPLE_MATCHES",
          candidateIds: ["a", "b"],
          nextActionCode: "RELEASE_APPROVED",
        },
      },
      evaluatedAt,
    ),
    false,
  );
});

test("pricing evidence enforces target, disposition, freshness, and scenario summaries", () => {
  const evaluatedAt = "2026-07-29T08:30:00.000Z";
  const retailScenario = registry.scenarios[0];
  const retailRequest = requestFor(retailScenario.id);
  const retailEvidence = evidenceFor(retailRequest, retailScenario);
  const wrongTarget = structuredClone(retailEvidence);
  wrongTarget.result.records[0].serviceName = "Storage";
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(wrongTarget), evaluatedAt), false);
  const missingMeter = structuredClone(retailEvidence);
  delete missingMeter.result.records[0].meterId;
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(missingMeter), evaluatedAt), false);
  assert.equal(hasValidPricingEvidence(retailRequest, retailEvidence, "2026-07-29T09:02:00.000Z"), false);
  assert.equal(hasValidPricingEvidence(retailRequest, retailEvidence, "2026-07-29T08:00:30.000Z"), false);
  const excessiveLifetime = structuredClone(retailEvidence);
  excessiveLifetime.expiresAt = "2026-07-30T08:01:00.001Z";
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(excessiveLifetime), evaluatedAt), false);
  const tinyArithmeticDrift = structuredClone(retailEvidence);
  tinyArithmeticDrift.result.records[0].unitPrice = 0.0000009;
  tinyArithmeticDrift.result.records[0].usageQuantity = 1;
  tinyArithmeticDrift.result.records[0].projectedAmount = 0;
  tinyArithmeticDrift.result.totalAmount = 0;
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(tinyArithmeticDrift), evaluatedAt), false);
  const partialWithoutContinuation = structuredClone(retailEvidence);
  partialWithoutContinuation.result.paginationStatus = "partial";
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(partialWithoutContinuation), evaluatedAt), false);
  const unrelatedRegionalSummary = structuredClone(retailEvidence);
  unrelatedRegionalSummary.result.regionalUnavailable = ["eastus"];
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(unrelatedRegionalSummary), evaluatedAt), false);
  const unrelatedBulkSummary = structuredClone(retailEvidence);
  unrelatedBulkSummary.result.bulk = {
    deduplicatedSpecs: 1,
    successful: 1,
    failed: 0,
    partialFailures: [],
  };
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(unrelatedBulkSummary), evaluatedAt), false);

  const negotiatedScenario = registry.scenarios[5];
  const negotiatedRequest = requestFor(negotiatedScenario.id);
  const matchedNegotiated = {
    ...retailEvidence,
    scenarioId: negotiatedRequest.scenarioId,
    requestId: negotiatedRequest.requestId,
    requestHash: negotiatedRequest.requestId,
  };
  assert.equal(hasValidPricingEvidence(negotiatedRequest, rehashEvidence(matchedNegotiated), evaluatedAt), false);
  const wrongNegotiatedAction = structuredClone(evidenceFor(negotiatedRequest, negotiatedScenario));
  wrongNegotiatedAction.result.nextActionCode = "REQUEST_AUTHORIZATION";
  assert.equal(hasValidPricingEvidence(negotiatedRequest, rehashEvidence(wrongNegotiatedAction), evaluatedAt), false);

  const ambiguityScenario = registry.scenarios[6];
  const ambiguityRequest = requestFor(ambiguityScenario.id);
  const wrongAmbiguityAction = structuredClone(evidenceFor(ambiguityRequest, ambiguityScenario));
  wrongAmbiguityAction.result.nextActionCode = "REQUEST_AUTHORIZATION";
  assert.equal(hasValidPricingEvidence(ambiguityRequest, rehashEvidence(wrongAmbiguityAction), evaluatedAt), false);

  const throttlingScenario = registry.scenarios[8];
  const throttlingRequest = requestFor(throttlingScenario.id);
  const immediateRetry = structuredClone(evidenceFor(throttlingRequest, throttlingScenario));
  immediateRetry.result.retryAt = immediateRetry.collectedAt;
  assert.equal(hasValidPricingEvidence(throttlingRequest, rehashEvidence(immediateRetry), evaluatedAt), false);
  const wrongThrottleAction = structuredClone(evidenceFor(throttlingRequest, throttlingScenario));
  wrongThrottleAction.result.nextActionCode = "SELECT_CANDIDATE";
  assert.equal(hasValidPricingEvidence(throttlingRequest, rehashEvidence(wrongThrottleAction), evaluatedAt), false);

  const bulkScenario = registry.scenarios[2];
  const bulkRequest = requestFor(bulkScenario.id);
  const badBulk = structuredClone(evidenceFor(bulkRequest, bulkScenario));
  badBulk.result.bulk.partialFailures[0].specId = "unknown-spec";
  assert.equal(hasValidPricingEvidence(bulkRequest, rehashEvidence(badBulk), evaluatedAt), false);
  const commitmentBulkRequest = structuredClone(bulkRequest);
  commitmentBulkRequest.bulkItems[0].commitment = { kind: "reservation", termMonths: 12, priceBasis: "total" };
  const { requestId: _bulkRequestId, ...commitmentBulkContent } = commitmentBulkRequest;
  commitmentBulkRequest.requestId = calculatePricingRequestId(commitmentBulkContent);
  assert.equal(
    hasValidPricingEvidence(commitmentBulkRequest, evidenceFor(bulkRequest, bulkScenario), evaluatedAt),
    false,
  );
  const validPartial = structuredClone(retailEvidence);
  validPartial.result.paginationStatus = "partial";
  validPartial.result.continuationCursorHash = hash("d");
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(validPartial), evaluatedAt), true);
  const dateOnly = structuredClone(retailEvidence);
  dateOnly.collectedAt = "2026-07-29";
  assert.equal(hasValidPricingEvidence(retailRequest, rehashEvidence(dateOnly), evaluatedAt), false);

  const regionalScenario = registry.scenarios[3];
  const regionalRequest = requestFor(regionalScenario.id);
  const missingRegion = structuredClone(evidenceFor(regionalRequest, regionalScenario));
  missingRegion.result.regionalUnavailable = [];
  assert.equal(hasValidPricingEvidence(regionalRequest, rehashEvidence(missingRegion), evaluatedAt), false);
  const overlappingRegion = structuredClone(evidenceFor(regionalRequest, regionalScenario));
  overlappingRegion.result.regionalUnavailable = ["swedencentral", "westeurope"];
  assert.equal(hasValidPricingEvidence(regionalRequest, rehashEvidence(overlappingRegion), evaluatedAt), false);
  const unrequestedRegion = structuredClone(evidenceFor(regionalRequest, regionalScenario));
  unrequestedRegion.result.regionalUnavailable = ["westeurope", "eastus"];
  assert.equal(hasValidPricingEvidence(regionalRequest, rehashEvidence(unrequestedRegion), evaluatedAt), false);
  const singleRegionContent = { ...regionalRequest, target: { ...regionalRequest.target, regions: ["swedencentral"] } };
  const { requestId: _regionalRequestId, ...singleRegionRequestContent } = singleRegionContent;
  const singleRegionRequest = {
    ...singleRegionRequestContent,
    requestId: calculatePricingRequestId(singleRegionRequestContent),
  };
  const singleRegionEvidence = evidenceFor(singleRegionRequest, regionalScenario);
  singleRegionEvidence.result.regionalUnavailable = [];
  assert.equal(hasValidPricingEvidence(singleRegionRequest, rehashEvidence(singleRegionEvidence), evaluatedAt), false);

  const uncertaintyScenario = registry.scenarios[7];
  const uncertaintyRequest = requestFor(uncertaintyScenario.id);
  const degenerateUncertainty = structuredClone(evidenceFor(uncertaintyRequest, uncertaintyScenario));
  degenerateUncertainty.result.records[0].uncertainty = {
    lowerAmount: 73,
    upperAmount: 73,
    confidence: "high",
    reasonCodes: [],
  };
  assert.equal(hasValidPricingEvidence(uncertaintyRequest, rehashEvidence(degenerateUncertainty), evaluatedAt), false);

  const commitmentScenario = registry.scenarios[4];
  const commitmentRequest = requestFor(commitmentScenario.id);
  const commitmentEvidence = evidenceFor(commitmentRequest, commitmentScenario);
  const hourlyMisprojection = structuredClone(commitmentEvidence);
  hourlyMisprojection.result.records[0].projectedAmount = 73 * 730;
  hourlyMisprojection.result.totalAmount = 73 * 730;
  assert.equal(hasValidPricingEvidence(commitmentRequest, rehashEvidence(hourlyMisprojection), evaluatedAt), false);
});

test("registry rejects incomplete replacement, raw payload permission, and negotiated defaults", () => {
  assert.ok(
    validatePricingParity(
      mutate((value) => {
        delete value.replacementStatus;
      }),
      schema,
    ).length > 0,
  );
  assert.ok(
    validatePricingParity(
      mutate((value) => {
        value.scenarios[0].prohibitedFields = ["rawPayload"];
      }),
      schema,
    ).length > 0,
  );
  assert.ok(
    validatePricingParity(
      mutate((value) => {
        value.scenarios[5].prohibitedFields = ["qualifiesGate", "rawPayload"];
      }),
      schema,
    ).some((error) => error.includes("PRICING-006-negotiated")),
  );
});

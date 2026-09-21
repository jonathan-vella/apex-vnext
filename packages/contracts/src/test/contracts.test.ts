import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ApprovalEvidenceV1Schema,
  ArchitectureV1Schema,
  CapabilityPackManifestV1Schema,
  CONTRACT_VERSION,
  CostEstimateV1Schema,
  CustomizationLockV1Schema,
  DeploymentPreviewV1Schema,
  DiagnosisV1Schema,
  EnvironmentInputsV1Schema,
  ExecutionPlanAttestationV1Schema,
  GovernanceConstraintsV1Schema,
  GovernanceObservationReceiptV1Schema,
  hasValidInputRequestQuestions,
  isGovernanceObservationCurrent,
  IacBindingV1Schema,
  IacHandoffV1Schema,
  ImprovementDecisionV1Schema,
  ImprovementObservationV1Schema,
  ImprovementPolicyV1Schema,
  ImprovementProposalV1Schema,
  ImprovementRecurrenceV1Schema,
  InputRequestV1Schema,
  InputSubmissionV1Schema,
  LogicalResourceManifestV1Schema,
  NativeValidationReceiptV1Schema,
  NATIVE_VALIDATION_COMMANDS,
  calculateNativeValidationCommandHash,
  calculateNativeValidationReceiptHash,
  hasValidNativeValidationReceipt,
  LiveQualificationV1Schema,
  LIVE_QUALIFICATION_SCENARIO_IDS,
  OnboardingConfigV1Schema,
  PolicyPropertyMapV1Schema,
  PricingEvidenceV1Schema,
  PricingRequestV1Schema,
  QualityReportV1Schema,
  QualityMeasurementsV1Schema,
  ArchitectureAvailabilityV1Schema,
  RequirementsV1Schema,
  ReviewFindingsV1Schema,
  RuntimeBundleLockV1Schema,
  ScenarioV1Schema,
  TelemetryV1Schema,
  WorkloadDecisionManifestV1Schema,
  contractMetadata,
  contractSchemas,
  hasCompleteContractMetadata,
  hasOnlyTypedSecretReferences,
  hasValidLiveQualification,
  hasValidCostArithmetic,
  hasValidLogicalResourceReferences,
  hasValidPreviewApprovalBinding,
  calculatePricingEvidenceId,
  calculatePricingRequestId,
  hasValidPricingEvidence,
  schemaById,
  type ApprovalEvidenceV1,
  type CostEstimateV1,
  type DeploymentPreviewV1,
  type EnvironmentInputsV1,
  type ExecutionPlanAttestationV1,
  type LogicalResourceManifestV1,
  type NativeValidationReceiptV1,
  type LiveQualificationV1,
  type PricingEvidenceV1,
  type PricingRequestV1,
  type RequirementsV1,
  type RuntimeBundleLockV1,
} from "../index.js";
import {
  CONTRACT_METADATA_FILENAME,
  JSON_SCHEMA_DIALECT,
  createContractMetadataFile,
  createContractSchemaFiles,
} from "../schema-export.js";

const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const timestamp = "2026-07-13T12:00:00.000Z";
const expiry = "2026-07-13T13:00:00.000Z";
const completion = "2026-07-13T14:00:00.000Z";

FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));
FormatRegistry.Set(
  "date",
  (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)),
);

describe("Wave 1 contracts", () => {
  it("requires compact, strictly typed governance observation bindings without raw baseline data", () => {
    const receipt = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "demo",
      runId: "run-1",
      targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111",
      governanceHash: hash,
      snapshotDigest: otherHash,
      contentHash: hash,
      observedAt: timestamp,
      expiresAt: expiry,
      rawSourceDigest: otherHash,
    };
    assert.equal(Value.Check(GovernanceObservationReceiptV1Schema, receipt), true);
    for (const field of Object.keys(receipt)) {
      const incomplete = { ...receipt } as Record<string, unknown>;
      delete incomplete[field];
      assert.equal(Value.Check(GovernanceObservationReceiptV1Schema, incomplete), false, field);
    }
    for (const invalid of [
      { ...receipt, baseline: {} },
      { ...receipt, rawSourceDigest: "invalid" },
      { ...receipt, observedAt: "invalid" },
      { ...receipt, targetScope: "" },
    ])
      assert.equal(Value.Check(GovernanceObservationReceiptV1Schema, invalid), false);
    assert.equal(schemaById[GovernanceObservationReceiptV1Schema.$id!], GovernanceObservationReceiptV1Schema);
    assert.equal(contractMetadata[GovernanceObservationReceiptV1Schema.$id!]?.maxBytes, 16_384);
  });
  it("uses precise elapsed UTC age and rejects malformed governance observation dates", () => {
    const observed = "2026-09-01T00:00:00Z";
    assert.equal(isGovernanceObservationCurrent(observed, "2026-09-30T23:59:59.999Z"), true);
    assert.equal(isGovernanceObservationCurrent(observed, "2026-10-01T00:00:00Z"), false);
    assert.equal(isGovernanceObservationCurrent("2026-09-01T02:00:00+02:00", "2026-10-01T00:00:00Z"), false);
    assert.equal(isGovernanceObservationCurrent(observed, "2026-08-31T23:59:59Z"), false);
    for (const invalid of ["2026-09-01", "2026-09-01T00:00:00", "2026-02-30T00:00:00Z", "invalid"]) {
      assert.equal(isGovernanceObservationCurrent(invalid, "2026-09-02T00:00:00Z"), false, invalid);
      assert.equal(isGovernanceObservationCurrent(observed, invalid), false, invalid);
    }
  });
  it("requires Bicep format, build and lint rather than accepting build-only receipts", () => {
    assert.deepEqual(
      NATIVE_VALIDATION_COMMANDS.bicep.map(({ validatorId }) => validatorId),
      ["bicep:format", "bicep:build", "bicep:lint"],
    );
  });
  for (const track of ["bicep", "terraform"] as const) {
    it(`validates strict source-bound native validation receipts for ${track}`, () => {
      const body: Omit<NativeValidationReceiptV1, "receiptHash"> = {
        schemaVersion: CONTRACT_VERSION,
        projectId: "project",
        runId: "run",
        track,
        sourceHash: hash,
        treeHash: otherHash,
        policyHash: hash,
        inputHash: hash,
        outcome: "pass",
        commands: NATIVE_VALIDATION_COMMANDS[track].map((command) => ({
          validatorId: command.validatorId,
          commandHash: calculateNativeValidationCommandHash(command),
          exitCode: 0,
          signal: null,
          timedOut: false,
          outputTruncated: false,
        })),
      };
      const receipt = { ...body, receiptHash: calculateNativeValidationReceiptHash(body) };
      assert.equal(Value.Check(NativeValidationReceiptV1Schema, receipt), true);
      assert.equal(hasValidNativeValidationReceipt(receipt, body), true);
      assert.equal(schemaById[NativeValidationReceiptV1Schema.$id!], NativeValidationReceiptV1Schema);
      assert.equal(contractMetadata[NativeValidationReceiptV1Schema.$id!]?.maxBytes, 8_404_992);
      assert.equal(
        calculateNativeValidationReceiptHash(Object.fromEntries(Object.entries(body).reverse()) as typeof body),
        receipt.receiptHash,
      );
      for (const key of ["projectId", "runId", "track", "sourceHash", "treeHash", "policyHash", "inputHash"] as const) {
        assert.equal(hasValidNativeValidationReceipt(receipt, { ...body, [key]: "different" }), false, key);
        assert.equal(hasValidNativeValidationReceipt({ ...receipt, [key]: "different" }, body), false, key);
      }
      for (const invalid of [
        { ...receipt, receiptHash: otherHash },
        { ...receipt, schemaVersion: "2.0.0" },
        { ...receipt, stdout: "private-source" },
        { ...receipt, rootPath: "/private/path" },
        { ...receipt, compliance: "pass" },
        { ...receipt, outcome: "block" },
        { ...receipt, commands: [] },
        { ...receipt, commands: [...receipt.commands, ...receipt.commands, ...receipt.commands, ...receipt.commands] },
        ...[
          { stdout: "private-source" },
          { stderr: "private-diagnostic" },
          { path: "/private/path" },
          { exitCode: 1 },
          { signal: "SIGTERM" },
          { timedOut: true },
          { outputTruncated: true },
          { validatorId: "bicep:lint" },
          { commandHash: "invalid" },
        ].map((extra) => ({
          ...receipt,
          commands: [{ ...receipt.commands[0], ...extra }, ...receipt.commands.slice(1)],
        })),
      ]) {
        assert.equal(hasValidNativeValidationReceipt(invalid, body), false);
      }
      for (const commands of [
        body.commands.slice(1),
        body.commands.filter(({ validatorId }) => validatorId === "bicep:build"),
        [...body.commands, body.commands[0]!],
        body.commands.map((command) => ({ ...command, commandHash: otherHash })),
        body.commands.map((command) => ({ ...command, validatorId: "terraform:validate" as const })),
      ]) {
        const tampered = { ...body, commands };
        assert.equal(
          hasValidNativeValidationReceipt(
            { ...tampered, receiptHash: calculateNativeValidationReceiptHash(tampered) },
            body,
          ),
          false,
        );
      }
      if (body.commands.length > 1) {
        const reordered = { ...body, commands: [...body.commands].reverse() };
        assert.equal(
          hasValidNativeValidationReceipt(
            { ...reordered, receiptHash: calculateNativeValidationReceiptHash(reordered) },
            body,
          ),
          false,
        );
      }
    });
  }

  it("uses one explicit persisted contract version", () => {
    const lock: RuntimeBundleLockV1 = {
      schemaVersion: CONTRACT_VERSION,
      cliVersion: "0.1.0",
      customizationVersion: "0.1.0",
      workflowHash: "a".repeat(64),
      defaultsHash: "b".repeat(64),
      validatorHash: "c".repeat(64),
      qualityScorecardHash: "d".repeat(64),
      improvementPolicyHash: "e".repeat(64),
      requiredCapabilityPacks: [],
    };

    assert.equal(lock.schemaVersion, "1.0.0");
    assert.equal(Value.Check(RuntimeBundleLockV1Schema, lock), true);
  });

  it("validates requirements from the walking skeleton", () => {
    const requirements: RequirementsV1 = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "example-project",
      workload: "Secure web API",
      environment: "dev",
      requirements: [
        {
          id: "REQ-001",
          statement: "Use managed identity",
          priority: "must",
          status: "confirmed",
          source: "user",
        },
      ],
      assumptions: [],
      unknowns: [],
    };

    assert.equal(Value.Check(RequirementsV1Schema, requirements), true);
  });

  it("validates optional strict bounded intended physical resource scope on bindings", () => {
    const primary = {
      resourceId:
        "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/workload/providers/Microsoft.Storage/storageAccounts/storage",
      type: "Microsoft.Storage/storageAccounts",
      ownership: "managed",
      role: "primary",
    };
    const resourceBinding = {
      implementation: "avm:br/public:avm/res/storage/storage-account@0.9.0",
      version: "0.9.0",
      parameters: {},
    };
    const binding = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "demo",
      runId: "run-test",
      track: "bicep",
      intentHash: hash,
      resourceBindings: { storage: resourceBinding },
    };
    const withResources = (physicalResources: unknown) => ({
      ...binding,
      resourceBindings: { storage: { ...resourceBinding, physicalResources } },
    });
    assert.equal(Value.Check(IacBindingV1Schema, binding), true);
    assert.equal(Value.Check(IacBindingV1Schema, withResources([primary])), true);
    assert.equal(
      Value.Check(
        IacBindingV1Schema,
        withResources([{ ...primary, resourceId: primary.resourceId.toUpperCase(), type: primary.type.toUpperCase() }]),
      ),
      true,
    );
    const bounded = Array.from({ length: 128 }, (_, index) => ({
      ...primary,
      resourceId: `${primary.resourceId}${index}`,
      role: index === 0 ? "primary" : "ancillary",
      ownership: index === 0 ? "managed" : "existing",
    }));
    assert.equal(Value.Check(IacBindingV1Schema, withResources(bounded)), true);
    for (const physicalResources of [
      [],
      null,
      {},
      [primary, primary],
      [...bounded, primary],
      [{ ...primary, unexpected: true }],
      [{ ...primary, ownership: "observed" }],
      [{ ...primary, role: "secondary" }],
      [{ ...primary, type: "" }],
      [{ ...primary, type: `Microsoft.Storage/${"a".repeat(256)}` }],
      [{ ...primary, resourceId: `${primary.resourceId}${"a".repeat(2048)}` }],
      ...["*", "%2f", "?query", "#fragment", "[expression]", "${expression}", "\n", "\r\n"].map((suffix) => [
        { ...primary, resourceId: `${primary.resourceId}${suffix}` },
      ]),
      [{ ...primary, type: `${primary.type}\n` }],
      ...Object.keys(primary).map((key) => [
        Object.fromEntries(Object.entries(primary).filter(([field]) => field !== key)),
      ]),
    ]) {
      assert.equal(Value.Check(IacBindingV1Schema, withResources(physicalResources)), false);
    }
  });

  it("validates strict onboarding configuration with optional defaults", () => {
    const config = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "payments",
      client: "github-copilot-vscode",
      createRepository: true,
    };

    assert.equal(Value.Check(OnboardingConfigV1Schema, config), true);
    assert.equal(Value.Check(OnboardingConfigV1Schema, { ...config, client: "unsupported" }), false);
    assert.equal(Value.Check(OnboardingConfigV1Schema, { ...config, unexpected: true }), false);
  });

  it("binds live qualification evidence to an exact candidate", () => {
    const scenarios: LiveQualificationV1["scenarios"] = LIVE_QUALIFICATION_SCENARIO_IDS.map((id) => ({
      id,
      environment: "sandbox",
      targetScope: "subscription/example",
      actor: "maintainer",
      startedAt: expiry,
      completedAt: completion,
      toolVersions: { apex: "0.1.0" },
      outcome: "pass",
      evidenceRefs: [hash],
    }));
    const qualification: LiveQualificationV1 = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "live-test",
      runId: "run-1",
      candidate: {
        repository: "jonathan-vella/apex-vnext",
        branch: "main",
        commit: "a".repeat(40),
        packageLockHash: hash,
        releaseManifestHash: otherHash,
        runtimeBundleHash: "c".repeat(64),
        customizationBundleHash: "e".repeat(64),
      },
      createdAt: timestamp,
      evidenceManifestHash: "d".repeat(64),
      scenarios,
    };

    assert.equal(Value.Check(LiveQualificationV1Schema, qualification), true);
    assert.equal(hasValidLiveQualification(qualification), true);
    assert.equal(
      hasValidLiveQualification({
        ...qualification,
        scenarios: qualification.scenarios.map((scenario, index) =>
          index === 1 ? { ...scenario, id: "vscode-experience" } : scenario,
        ),
      }),
      false,
    );
    assert.equal(
      hasValidLiveQualification({
        ...qualification,
        createdAt: completion,
      }),
      false,
    );
    assert.equal(
      hasValidLiveQualification({
        ...qualification,
        scenarios: qualification.scenarios.map((scenario, index) =>
          index === 0 ? { ...scenario, startedAt: completion, completedAt: expiry } : scenario,
        ),
      }),
      false,
    );
    assert.equal(Value.Check(LiveQualificationV1Schema, { ...qualification, unexpected: true }), false);
  });

  it("publishes an id for every registered schema", () => {
    assert.ok(contractSchemas.length > 0);
    for (const schema of contractSchemas) {
      assert.match(schema.$id ?? "", /^https:\/\/schemas\.apexops\.dev\//);
    }
  });

  it("validates bounded improvement contracts", () => {
    const observation = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "example-project",
      runId: "run-1",
      taskId: "task-1",
      observationId: hash,
      patternKey: otherHash,
      observedAt: timestamp,
      source: "validation-failure",
      category: "correctness",
      severity: "medium",
      statement: "A deterministic validator failed.",
      evidenceRefs: [hash],
      disposition: "active",
      redactionCount: 0,
    };
    const recurrence = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "example-project",
      patternKey: otherHash,
      category: "correctness",
      detectedAt: completion,
      firstSeenAt: timestamp,
      lastSeenAt: expiry,
      occurrenceCount: 2,
      distinctRunCount: 2,
      runIds: ["run-1", "run-2"],
      observationIds: [hash, otherHash],
      evidenceRefs: [hash],
      confidence: "medium",
    };
    const proposal = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "example-project",
      proposalId: hash,
      patternKey: otherHash,
      generatedAt: completion,
      target: "validator",
      title: "Review recurring validator failure",
      summary: "Inspect the recurring deterministic evidence through the normal change workflow.",
      occurrenceCount: 2,
      runIds: ["run-1", "run-2"],
      evidenceRefs: [hash],
      confidence: "medium",
      status: "pending",
      inert: true,
    };
    const decision = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "example-project",
      proposalId: hash,
      decidedAt: completion,
      actor: "maintainer",
      decision: "accepted",
      rationale: "Track through a normal reviewed issue.",
      externalRef: "https://github.com/owner/repo/issues/12",
    };
    const policy = {
      schemaVersion: CONTRACT_VERSION,
      allowedSources: ["validation-failure", "explicit-correction"],
      allowedCategories: ["correctness", "security"],
      recurrence: { threshold: 2, windowDays: 30 },
      retention: { observationDays: 90, decisionDays: 365 },
      limits: { statementCharacters: 1024, evidenceRefs: 32, observations: 10000 },
      proposalTargets: ["documentation", "validator", "backlog"],
      humanDecisionRequired: true,
      automatedIssueCreation: false,
      contextInjection: false,
    };

    assert.equal(Value.Check(ImprovementObservationV1Schema, observation), true);
    assert.equal(Value.Check(ImprovementRecurrenceV1Schema, recurrence), true);
    assert.equal(Value.Check(ImprovementProposalV1Schema, proposal), true);
    assert.equal(Value.Check(ImprovementDecisionV1Schema, decision), true);
    assert.equal(Value.Check(ImprovementPolicyV1Schema, policy), true);
    assert.equal(Value.Check(ImprovementProposalV1Schema, { ...proposal, inert: false }), false);
    assert.equal(Value.Check(ImprovementPolicyV1Schema, { ...policy, automatedIssueCreation: true }), false);
  });
});

describe("pricing evidence contracts", () => {
  const requestContent: Omit<PricingRequestV1, "requestId"> = {
    schemaVersion: CONTRACT_VERSION,
    projectId: "pricing-test",
    runId: "run-1",
    scenarioId: "PRICING-002-meter-aware",
    target: {
      serviceName: "Virtual Machines",
      skuName: "D2s v5",
      regions: ["swedencentral"],
      currency: "USD",
    },
    usage: { dimension: "hour", quantity: 730 },
    meter: { meterId: "compute-hour", unitDimension: "hour", unitQuantity: 1 },
    commitment: { kind: "none" },
    requestedAt: timestamp,
  };
  const request: PricingRequestV1 = {
    ...requestContent,
    requestId: calculatePricingRequestId(requestContent),
  };
  const evidenceContent: Omit<PricingEvidenceV1, "evidenceId"> = {
    schemaVersion: CONTRACT_VERSION,
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
      toolchainHash: hash,
      toolsListHash: otherHash,
      rawSourceDigest: "c".repeat(64),
      rawSourceBytes: 512,
      contentCapture: false,
    },
    collectedAt: expiry,
    expiresAt: completion,
    result: {
      status: "matched",
      records: [
        {
          priceId: "price-1",
          meterId: "compute-hour",
          serviceName: "Virtual Machines",
          skuName: "D2s v5",
          region: "swedencentral",
          currency: "USD",
          priceType: "consumption",
          unitDimension: "hour",
          unitQuantity: 1,
          unitPrice: 0.1,
          usageQuantity: 730,
          projectedAmount: 73,
          commitment: { kind: "none" },
          uncertainty: { lowerAmount: 73, upperAmount: 73, confidence: "high", reasonCodes: [] },
        },
      ],
      totalAmount: 73,
      paginationStatus: "complete",
    },
    qualifiesGate: false,
  };
  const evidence: PricingEvidenceV1 = {
    ...evidenceContent,
    evidenceId: calculatePricingEvidenceId(evidenceContent),
  };

  it("binds strict content-free pricing evidence and arithmetic", () => {
    assert.equal(Value.Check(PricingRequestV1Schema, request), true);
    assert.equal(Value.Check(PricingEvidenceV1Schema, evidence), true);
    assert.equal(hasValidPricingEvidence(request, evidence, expiry), true);
    assert.equal(hasValidPricingEvidence({ ...request, requestId: hash }, evidence, expiry), false);
    const badArithmeticContent = {
      ...evidenceContent,
      result: { ...evidenceContent.result, totalAmount: 72 },
    } as Omit<PricingEvidenceV1, "evidenceId">;
    const badArithmetic = {
      ...badArithmeticContent,
      evidenceId: calculatePricingEvidenceId(badArithmeticContent),
    } as PricingEvidenceV1;
    assert.equal(hasValidPricingEvidence(request, badArithmetic, expiry), false);
    assert.equal(Value.Check(PricingEvidenceV1Schema, { ...evidence, rawPayload: {} }), false);
    assert.equal(Value.Check(PricingEvidenceV1Schema, { ...evidence, qualifiesGate: true }), false);
  });
});

describe("persisted contract schemas", () => {
  const schemasDirectory = fileURLToPath(new URL("../../schemas/", import.meta.url));
  const generatedSchemas = createContractSchemaFiles();

  it("matches the registry inventory and committed bytes deterministically", async () => {
    const expectedFilenames = generatedSchemas.map(({ filename }) => filename);
    const actualFilenames = (await readdir(schemasDirectory))
      .filter((filename) => filename.endsWith(".schema.json"))
      .sort();

    assert.deepEqual(actualFilenames, expectedFilenames);
    assert.equal(new Set(expectedFilenames).size, contractSchemas.length);
    for (const generated of generatedSchemas) {
      const committed = await readFile(new URL(`../../schemas/${generated.filename}`, import.meta.url), "utf8");
      assert.equal(committed, generated.contents);
      assert.equal(
        generated.contents,
        createContractSchemaFiles().find(({ filename }) => filename === generated.filename)?.contents,
      );
    }
  });

  it("includes identifiers, dialect, strict objects, and TypeBox-compatible schemas", () => {
    for (const generated of generatedSchemas) {
      const sourceSchema = contractSchemas.find((schema) => schema.$id === generated.schema.$id);
      assert.ok(sourceSchema);
      assert.equal(generated.schema.$schema, JSON_SCHEMA_DIALECT);
      const union = (generated.schema as { anyOf?: Array<{ additionalProperties?: unknown }> }).anyOf;
      if (union === undefined) assert.equal(generated.schema.additionalProperties, false);
      else
        assert.equal(
          union.every((branch) => branch.additionalProperties === false),
          true,
        );
      assert.equal(Value.Check(generated.schema, {}), Value.Check(sourceSchema, {}));
    }
  });

  it("matches the metadata registry inventory and committed bytes", async () => {
    const contents = createContractMetadataFile();
    const committed = await readFile(new URL(`../../schemas/${CONTRACT_METADATA_FILENAME}`, import.meta.url), "utf8");
    const persistedMetadata = JSON.parse(contents) as Record<string, unknown>;

    assert.equal(committed, contents);
    assert.deepEqual(Object.keys(persistedMetadata).sort(), contractSchemas.map((schema) => schema.$id).sort());
  });
});

describe("target family contracts", () => {
  const fixtures = [
    [
      WorkloadDecisionManifestV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        environment: "prod",
        sourceRequirementsHash: hash,
        architectureHash: otherHash,
        costEstimateHash: "c".repeat(64),
        environments: ["dev", "prod"],
        requirementTraceability: [
          { requirementId: "REQ-001", skuDecisionIds: ["api-sku"], sloDecisionIds: ["api-slo"] },
        ],
        skuDecisions: [
          {
            id: "api-sku",
            service: "Azure App Service",
            logicalId: "api",
            sku: "P1v3",
            quantity: 1,
            rationale: "Availability target",
            requirementIds: ["REQ-001"],
            environmentOverrides: [],
          },
        ],
        sloDecisions: [
          {
            id: "api-slo",
            logicalId: "api",
            availabilityPercent: 99.9,
            rtoMinutes: 60,
            rpoMinutes: 15,
            supportWindow: "business-hours",
            complianceScopes: ["gdpr"],
            requirementIds: ["REQ-001"],
            environmentOverrides: [],
          },
        ],
        revisions: [{ number: 1, createdAt: timestamp, sourceHash: hash, reason: "Initial user pins" }],
      },
    ],
    [
      ArchitectureV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        title: "Web API",
        summary: "Managed web API architecture",
        sourceHashes: { requirements: hash },
        components: [
          {
            id: "api",
            service: "Azure App Service",
            purpose: "Host API",
            requirementIds: ["REQ-001"],
            dependsOn: [],
          },
        ],
        decisions: ["Use managed identity"],
        risks: [],
        wellArchitectedAssessment: {
          framework: "azure-well-architected-framework",
          assessmentType: "qualitative",
          pillars: [
            "security",
            "reliability",
            "performance-efficiency",
            "cost-optimization",
            "operational-excellence",
          ].map((pillar) => ({
            pillar,
            status: "aligned",
            assessment: `${pillar} requirements are addressed`,
            requirementIds: ["REQ-001"],
            evidenceRefs: [hash],
            recommendations: [],
            tradeoffs: [],
          })),
        },
      },
    ],
    [
      CostEstimateV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        currency: "USD",
        pricingDate: "2026-07-13",
        lineItems: [
          {
            id: "api-compute",
            service: "Azure App Service",
            sku: "P1v3",
            quantity: 2,
            unitPrice: 0.1,
            unitsPerMonth: 730,
            monthlyCost: 146,
            source: { provider: "Azure Retail Prices", uri: "https://prices.azure.com", retrievedAt: timestamp },
            uncertainty: { lowerMonthlyCost: 140, upperMonthlyCost: 155, confidence: "high", basis: "Usage range" },
          },
        ],
        totalMonthlyCost: 146,
        assumptions: ["Two continuously running instances"],
      },
    ],
    [
      ReviewFindingsV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        subjectKind: "architecture-v1",
        subjectHash: hash,
        reviewedAt: timestamp,
        findings: [
          {
            id: "finding-1",
            severity: "medium",
            disposition: "remediated",
            title: "Missing zone detail",
            detail: "Availability zones were not explicit",
            evidenceRefs: [otherHash],
            resolution: "Added zone-redundant deployment",
          },
        ],
        criteria: [
          "security",
          "reliability",
          "performance-efficiency",
          "cost-optimization",
          "operational-excellence",
        ].map((criterionId) => ({
          criterionId,
          outcome: criterionId === "reliability" ? "finding" : "pass",
          rationale: `${criterionId} was reviewed`,
          findingIds: criterionId === "reliability" ? ["finding-1"] : [],
        })),
      },
    ],
    [
      GovernanceConstraintsV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        targetScope: "/subscriptions/example",
        discoveredAt: timestamp,
        expiresAt: expiry,
        summary: { assignmentCount: 3, denyCount: 1, modifyCount: 1, auditCount: 1, exemptionCount: 0 },
        constraintsRef: { mediaType: "application/json", uri: "artifact://governance/full", digest: hash, bytes: 4096 },
      },
    ],
    [
      PolicyPropertyMapV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        governanceHash: hash,
        mappings: [
          {
            policyAssignmentId: "/providers/Microsoft.Authorization/policyAssignments/tls",
            effect: "deny",
            logicalResourceId: "api",
            propertyPath: "siteConfig.minTlsVersion",
            expectedValue: "1.2",
            disposition: "satisfied",
          },
        ],
      },
    ],
    [
      EnvironmentInputsV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        environment: "prod",
        inputs: {
          location: { kind: "value", value: "swedencentral" },
          deploymentToken: { kind: "secret-reference", provider: "environment", reference: "DEPLOYMENT_TOKEN" },
        },
      },
    ],
    [
      LogicalResourceManifestV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        track: "bicep",
        resources: [
          {
            logicalId: "plan",
            type: "Microsoft.Web/serverfarms",
            implementationAddress: "plan",
            implementationKind: "resource",
            ownership: "managed",
            dependsOn: [],
            generatedDependencies: [],
            sourcePath: "main.bicep",
          },
          {
            logicalId: "api",
            type: "Microsoft.Web/sites",
            implementationAddress: "api",
            implementationKind: "resource",
            ownership: "managed",
            dependsOn: ["plan"],
            generatedDependencies: ["plan"],
            sourcePath: "main.bicep",
          },
        ],
      },
    ],
    [
      IacHandoffV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        track: "bicep",
        rootPath: "infra/bicep/example-project",
        treeHash: hash,
        intentHash: hash,
        bindingHash: hash,
        environmentInputsHash: hash,
        logicalResourceManifestHash: hash,
        requiredToolVersions: { bicep: "0.38.3" },
        generatedAt: timestamp,
      },
    ],
    [
      ExecutionPlanAttestationV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        track: "terraform",
        previewHash: hash,
        inputHash: hash,
        iacHash: hash,
        policyHash: hash,
        configHash: hash,
        lockfileHash: hash,
        recipient: "deploy-prod",
        planDigest: otherHash,
        artifactRef: "plans/run-1/apply.enc",
        stateLineage: "lineage-1",
        stateSerial: 7,
        transport: {
          encrypted: true,
          implementation: "local-reference",
          algorithm: "aes-256-gcm",
          recipient: "deploy-prod",
          mediaType: "application/octet-stream",
          iv: "base64-iv",
          authTag: "base64-auth-tag",
        },
        createdAt: timestamp,
        expiresAt: expiry,
      },
    ],
    [
      ScenarioV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        id: "managed-web-api",
        title: "Managed web API",
        description: "Validates a managed identity deployment",
        inputs: { environment: "dev" },
        expectedOutcomes: ["Deployment succeeds"],
        tags: ["web", "identity"],
      },
    ],
    [
      QualityReportV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        evaluatedAt: timestamp,
        scorecardHash: hash,
        measurementsHash: hash,
        status: "pass",
        checks: [
          {
            id: "schema",
            scenario: "contracts",
            status: "pass",
            value: 1,
            samples: 1,
            evidenceRefs: [hash],
            detail: "target satisfied",
          },
        ],
      },
    ],
    [
      QualityMeasurementsV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        measurements: [
          {
            metric: "schema",
            scenario: "contracts",
            value: 1,
            samples: 1,
            evidenceRefs: [hash],
          },
        ],
      },
    ],
    [
      ArchitectureAvailabilityV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        targetScope: "local",
        mode: "simulated",
        collectedAt: timestamp,
        expiresAt: expiry,
        checks: {
          pricing: { status: "current", evidenceRef: hash },
          quota: { status: "current", evidenceRef: hash },
          regionalAvailability: { status: "current", evidenceRef: hash },
        },
      },
    ],
    [
      TelemetryV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        eventId: "event-1",
        timestamp,
        metric: "run.duration",
        value: 42,
        unit: "seconds",
        consent: { status: "granted", scope: "product-improvement" },
        source: "kernel",
        confidence: "high",
        dimensions: { workflow: "apex-workflow-v1" },
      },
    ],
    [
      DiagnosisV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        projectId: "example-project",
        runId: "run-1",
        diagnosedAt: timestamp,
        status: "degraded",
        observations: ["Health probe failed"],
        causes: [
          {
            id: "cause-1",
            summary: "Probe path mismatch",
            confidence: "high",
            evidenceRefs: [hash],
            remediation: "Align the probe path",
          },
        ],
      },
    ],
    [
      CapabilityPackManifestV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        id: "azure-core",
        version: "1.2.0",
        digest: hash,
        capabilities: ["azure.preview", "azure.deploy"],
        entrypoints: { preview: "./preview.js" },
        requires: ["azure-cli>=2.75"],
      },
    ],
    [
      CustomizationLockV1Schema,
      {
        schemaVersion: CONTRACT_VERSION,
        customizationId: "apex-default",
        version: "1.0.0",
        manifestHash: hash,
        capabilityPacks: [{ id: "azure-core", version: "1.2.0", digest: otherHash }],
        lockedAt: timestamp,
      },
    ],
  ] as const;

  it("validates a representative fixture for every target family", () => {
    for (const [schema, fixture] of fixtures) {
      assert.equal(Value.Check(schema, fixture), true, schema.$id ?? "unidentified schema");
    }
  });

  it("validates journal-bound input requests and submissions", () => {
    const request = {
      schemaVersion: CONTRACT_VERSION,
      requestId: "request-1",
      expectedHead: hash,
      ownerEpoch: 2,
      intake: { round: "business-discovery", ordinal: 1, total: 4 },
      questions: [{ id: "region", prompt: "Which region?", options: ["sweden", "germany"] }],
    };
    assert.equal(Value.Check(InputRequestV1Schema, request), true);
    const { intake: _intake, ...base } = request;
    const governance = {
      candidatePath: "governance/baseline.json",
      candidateHash: hash,
      observedAt: "2026-09-01T00:00:00Z",
      requestedAt: "2026-09-19T00:00:00Z",
      expiresAt: "2026-09-20T00:00:00Z",
      targetScope: "/subscriptions/11111111-1111-1111-1111-111111111111",
      refreshRequired: false,
    };
    assert.equal(Value.Check(InputRequestV1Schema, { ...base, governance }), true);
    assert.equal(Value.Check(InputRequestV1Schema, { ...request, governance }), false);
    assert.equal(
      Value.Check(InputRequestV1Schema, { ...base, governance, decision: { taskId: "task-1", id: "choice" } }),
      false,
    );
    for (const candidatePath of [
      "/baseline.json",
      "C:/baseline.json",
      "../baseline.json",
      "dir/../baseline.json",
      "./baseline.json",
      "dir\\baseline.json",
      "bad\u0000.json",
      "a".repeat(4097),
    ]) {
      assert.equal(Value.Check(InputRequestV1Schema, { ...base, governance: { ...governance, candidatePath } }), false);
    }
    for (const extra of [
      { candidateHash: "bad" },
      { observedAt: "not-a-date" },
      { requestedAt: undefined },
      { requestedAt: null },
      { requestedAt: "not-a-date" },
      { refreshRequired: "false" },
      { snapshot: {} },
    ]) {
      assert.equal(Value.Check(InputRequestV1Schema, { ...base, governance: { ...governance, ...extra } }), false);
    }
    assert.equal(
      Value.Check(InputRequestV1Schema, {
        schemaVersion: CONTRACT_VERSION,
        requestId: request.requestId,
        expectedHead: request.expectedHead,
        ownerEpoch: request.ownerEpoch,
        questions: request.questions,
      }),
      false,
    );
    assert.equal(
      Value.Check(InputSubmissionV1Schema, {
        schemaVersion: CONTRACT_VERSION,
        requestId: request.requestId,
        expectedHead: request.expectedHead,
        ownerEpoch: request.ownerEpoch,
        answers: [{ questionId: "region", value: "sweden" }],
      }),
      true,
    );
    assert.equal(Value.Check(InputSubmissionV1Schema, { ...request, answers: [] }), false);
    assert.equal(
      Value.Check(InputSubmissionV1Schema, {
        schemaVersion: CONTRACT_VERSION,
        requestId: request.requestId,
        expectedHead: request.expectedHead,
        ownerEpoch: request.ownerEpoch,
        answers: [
          { questionId: "budget", value: { kind: "budget", amount: 250, currency: "USD", cadence: "monthly" } },
        ],
      }),
      true,
    );
    assert.equal(
      hasValidInputRequestQuestions([
        { id: "one", prompt: "One?" },
        {
          id: "two",
          prompt: "Two?",
          options: ["a", "b"],
          multiSelect: true,
          recommendation: { value: ["a"], source: "default", rationale: "Recommended baseline." },
        },
      ]),
      true,
    );
    assert.equal(
      hasValidInputRequestQuestions([
        { id: "same", prompt: "One?" },
        { id: "same", prompt: "Two?" },
      ]),
      false,
    );
    assert.equal(hasValidInputRequestQuestions([{ id: "bad", prompt: "Bad?", multiSelect: true }]), false);
    assert.equal(hasValidInputRequestQuestions([{ id: "bad", prompt: "Bad?", options: [] }]), false);
    assert.equal(hasValidInputRequestQuestions([{ id: "bad", prompt: "Bad?", options: ["same", "same"] }]), false);
    assert.equal(
      hasValidInputRequestQuestions([
        {
          id: "bad",
          prompt: "Bad?",
          options: ["a", "b"],
          recommendation: { value: "c", source: "derived", rationale: "Outside options." },
        },
      ]),
      false,
    );
    assert.equal(
      hasValidInputRequestQuestions([
        { id: "bad", prompt: "Bad?", options: ["a", "b"], recommendation: null as never },
      ]),
      false,
    );
    assert.equal(
      Value.Check(InputRequestV1Schema, {
        ...request,
        questions: [{ id: "bad", prompt: "Bad?", options: ["same", "same"] }],
      }),
      false,
    );
  });

  it("validates reproducible cost arithmetic and uncertainty bounds", () => {
    const estimate = fixtures[2][1] as unknown as CostEstimateV1;
    assert.equal(hasValidCostArithmetic(estimate), true);
    assert.equal(hasValidCostArithmetic({ ...estimate, totalMonthlyCost: 145 }), false);
  });

  it("permits secret references but rejects secret literal fields", () => {
    const inputs = fixtures[6][1] as EnvironmentInputsV1;
    assert.equal(hasOnlyTypedSecretReferences(inputs), true);
    assert.equal(
      Value.Check(EnvironmentInputsV1Schema, {
        ...inputs,
        inputs: {
          deploymentToken: { kind: "secret-reference", provider: "environment", reference: "TOKEN", value: "secret" },
        },
      }),
      false,
    );
  });

  it("accepts optional non-empty execution addresses without changing binding descriptors", () => {
    const manifest = fixtures[7][1] as unknown as LogicalResourceManifestV1;
    assert.equal(Value.Check(LogicalResourceManifestV1Schema, manifest), true);
    for (const executionAddress of ["plan", "azapi_resource.plan", "data.azapi_resource.plan", "module.plan", "", 42]) {
      assert.equal(
        Value.Check(LogicalResourceManifestV1Schema, {
          ...manifest,
          resources: manifest.resources.map((resource) => ({ ...resource, executionAddress })),
        }),
        typeof executionAddress === "string" && executionAddress.length > 0,
      );
    }
  });

  it("requires unique logical IDs and resolvable dependency references", () => {
    const manifest = fixtures[7][1] as unknown as LogicalResourceManifestV1;
    assert.equal(hasValidLogicalResourceReferences(manifest), true);
    assert.equal(
      hasValidLogicalResourceReferences({
        ...manifest,
        resources: [
          ...manifest.resources,
          {
            logicalId: "duplicate-plan",
            type: "Microsoft.Web/serverfarms",
            implementationAddress: "duplicatePlan",
            implementationKind: "resource",
            ownership: "managed",
            dependsOn: ["missing"],
            generatedDependencies: ["missing"],
            sourcePath: "main.bicep",
          },
        ],
      }),
      false,
    );
  });

  it("requires track-specific read-only declarations for existing resource ownership", () => {
    const manifest = fixtures[7][1] as unknown as LogicalResourceManifestV1;
    for (const track of ["bicep", "terraform"] as const) {
      for (const implementationKind of ["resource", "module", "data", "existing"] as const) {
        for (const ownership of ["managed", "existing"] as const) {
          const referenceKind = track === "bicep" ? "existing" : "data";
          const expected =
            ownership === "existing"
              ? implementationKind === referenceKind
              : implementationKind === "resource" || implementationKind === "module";
          assert.equal(
            hasValidLogicalResourceReferences({
              ...manifest,
              track,
              resources: manifest.resources.map((resource) => ({ ...resource, implementationKind, ownership })),
            }),
            expected,
            `${track}: ${implementationKind} with ${ownership} ownership`,
          );
        }
      }
    }
  });

  it("binds encrypted plan attestations to the preview and approval recipient", () => {
    const attestation = fixtures[9][1] as ExecutionPlanAttestationV1;
    const preview: DeploymentPreviewV1 = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "example-project",
      runId: "run-1",
      environment: "prod",
      track: "terraform",
      operation: "apply",
      target: "/subscriptions/example",
      commit: hash,
      dependencyRevision: hash,
      ownerEpoch: 1,
      inputHash: hash,
      iacHash: hash,
      policyHash: hash,
      stateLineage: "lineage-1",
      stateSerial: 7,
      changes: [],
      blockers: [],
      createdAt: timestamp,
      expiresAt: expiry,
      previewHash: hash,
    };
    const approval: ApprovalEvidenceV1 = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "example-project",
      runId: "run-1",
      gate: 4,
      decision: "approved",
      actor: "release-manager",
      mechanism: "tty",
      dependencyHash: hash,
      previewHash: hash,
      writerEpoch: 1,
      recipientIdentity: "deploy-prod",
      decidedAt: timestamp,
      expiresAt: expiry,
    };

    assert.equal(Value.Check(ExecutionPlanAttestationV1Schema, attestation), true);
    assert.equal(Value.Check(DeploymentPreviewV1Schema, preview), true);
    assert.equal(Value.Check(ApprovalEvidenceV1Schema, approval), true);
    assert.equal(hasValidPreviewApprovalBinding(attestation, preview, approval), true);
    assert.equal(hasValidPreviewApprovalBinding(attestation, preview, { ...approval, previewHash: otherHash }), false);
    assert.equal(
      hasValidPreviewApprovalBinding(attestation, preview, {
        ...approval,
        writerEpoch: preview.ownerEpoch + 1,
        writerTransferClaimHash: otherHash,
      }),
      true,
    );
    assert.equal(
      hasValidPreviewApprovalBinding(attestation, preview, { ...approval, writerEpoch: preview.ownerEpoch + 1 }),
      false,
    );
    assert.equal(
      hasValidPreviewApprovalBinding(attestation, preview, {
        ...approval,
        writerTransferClaimHash: otherHash,
      }),
      false,
    );
  });

  it("permits only local and inherited approval mechanisms", () => {
    const base = {
      schemaVersion: CONTRACT_VERSION,
      projectId: "example-project",
      runId: "run-1",
      gate: 4,
      decision: "approved" as const,
      actor: "maintainer",
      dependencyHash: hash,
      previewHash: hash,
      writerEpoch: 2,
      recipientIdentity: "github-actions:owner/repo:123:1:deploy",
      decidedAt: timestamp,
      expiresAt: expiry,
    };
    assert.equal(
      Value.Check(ApprovalEvidenceV1Schema, {
        ...base,
        mechanism: "tty",
        writerTransferClaimHash: "b".repeat(64),
      }),
      true,
    );
    assert.equal(
      Value.Check(ApprovalEvidenceV1Schema, {
        ...base,
        mechanism: "tty",
        writerTransferClaimHash: "not-a-hash",
      }),
      false,
    );
    assert.equal(
      Value.Check(ApprovalEvidenceV1Schema, {
        ...base,
        mechanism: "github-environment",
      }),
      false,
    );
    assert.equal(Value.Check(ApprovalEvidenceV1Schema, { ...base, mechanism: "tty", githubContext: {} }), false);
  });

  it("provides complete metadata and lookup coverage for every schema", () => {
    assert.equal(hasCompleteContractMetadata(), true);
    assert.equal(Object.keys(schemaById).length, contractSchemas.length);
    assert.equal(Object.keys(contractMetadata).length, contractSchemas.length);
    for (const schema of contractSchemas) {
      assert.equal(schemaById[schema.$id ?? ""], schema);
      assert.ok((contractMetadata[schema.$id ?? ""]?.maxBytes ?? 0) > 0);
    }
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApprovalEvidenceV1,
  ArchitectureV1,
  DeploymentPreviewV1,
  DiagnosisV1,
  PolicyPropertyMapV1,
  OperationRecordV1,
  RequirementsV1,
  ResourceInventoryV1,
  RunConfigV1,
} from "@apexops/contracts";
import {
  DOCUMENT_REGISTRY,
  REQUIREMENTS_TEMPLATE_SLOTS,
  renderApprovalEvidence,
  renderArchitectureDecisionRecords,
  renderDeploymentPreview,
  renderDeploymentSummary,
  renderRequirementsDocument,
  renderRequirements,
  renderResourceInventory,
  renderRunStatus,
  renderOperationsRunbook,
  renderPolicyMappingMatrix,
} from "../index.js";

const hash = (character: string): string => character.repeat(64);

test("document registry limits template bindings to supported sources", () => {
  assert.equal(DOCUMENT_REGISTRY.requirements?.sourceAvailability, "available");
  assert.equal(DOCUMENT_REGISTRY.requirements?.templateAvailability, "available");
  assert.equal(DOCUMENT_REGISTRY.inventory?.sourceAvailability, "available");
  assert.equal(DOCUMENT_REGISTRY["architecture-assessment"]?.sourceAvailability, "available");
  assert.equal(DOCUMENT_REGISTRY["cost-estimate"]?.sourceAvailability, "available");
  assert.equal(DOCUMENT_REGISTRY["deployment-summary"]?.renderer, "deployment-summary-v1");
  assert.equal(DOCUMENT_REGISTRY["operations-runbook"]?.renderer, "operations-runbook-v1");
  assert.equal(DOCUMENT_REGISTRY["resource-inventory-template"]?.templateAvailability, "reference-only");
  for (const documentId of ["governance-constraints", "implementation-plan"]) {
    assert.equal(DOCUMENT_REGISTRY[documentId]?.sourceAvailability, "unavailable");
    assert.equal(DOCUMENT_REGISTRY[documentId]?.templateAvailability, "reference-only");
  }
});

test("requirements document rendering fills exact template slots with typed or unavailable values", () => {
  const input: RequirementsV1 = {
    schemaVersion: "1.0.0",
    projectId: "sample-project",
    workload: "API",
    environment: "prod",
    requirements: [
      { id: "REQ-1", statement: "Serve requests", priority: "must", status: "confirmed", source: "brief" },
    ],
    assumptions: [],
    unknowns: [],
    businessContext: "Retail greenfield web API",
    successCriteria: "100 concurrent users",
    nonFunctionalRequirements: "RTO 60 minutes; RPO 15 minutes",
    securityAndCompliance: "Managed identity; GDPR",
    budgetAndOperations: "500 USD monthly; Azure Monitor",
    regionalConstraints: "swedencentral",
    architectureHandoff: "Candidate services: Container Apps and Azure SQL",
  };
  const template = REQUIREMENTS_TEMPLATE_SLOTS.map((slot) => `{${slot}}`).join("\n");
  const rendered = renderRequirementsDocument(input, template, hash("a"), hash("b"));

  assert.doesNotMatch(rendered, /\{[a-z][a-z-]*\}/u);
  assert.match(rendered, /Retail greenfield web API/u);
  assert.match(rendered, /Candidate services: Container Apps and Azure SQL/u);
  assert.throws(
    () => renderRequirementsDocument(input, `${template}\n{unexpected-slot}`, hash("a"), hash("b")),
    /invalid slots/u,
  );
});

test("requirements rendering is deterministic, sorted, and escaped", () => {
  const input: RequirementsV1 = {
    schemaVersion: "1.0.0",
    projectId: "sample-project",
    workload: "API|worker\tpool\u0002",
    environment: "prod",
    requirements: [
      { id: "REQ-2", statement: "Second", priority: "should", status: "unknown", source: "user" },
      { id: "REQ-1", statement: "First|line\nnext", priority: "must", status: "confirmed", source: "brief" },
    ],
    assumptions: ["Zulu", "Alpha"],
    unknowns: ["Unknown B", "Unknown A"],
  };
  const reordered: RequirementsV1 = {
    ...input,
    requirements: [...input.requirements].reverse(),
    assumptions: [...input.assumptions].reverse(),
    unknowns: [...input.unknowns].reverse(),
  };

  const rendered = renderRequirements(input);
  assert.equal(rendered, renderRequirements(input));
  assert.equal(rendered, renderRequirements(reordered));
  assert.ok(rendered.indexOf("REQ-1") < rendered.indexOf("REQ-2"));
  assert.match(rendered, /First\\\|line<br>next/);
  assert.match(rendered, /API\\\|worker\\\\u0009pool\\\\u0002/);
  assert.doesNotMatch(rendered, /[\t\u0002]/);
});

test("run status displays sorted inherited gate provenance", () => {
  const gates: RunConfigV1["gates"] = [
    { gate: 4, state: "closed", dependencyHash: hash("d") },
    { gate: 2, state: "inherited", dependencyHash: hash("b"), inheritedFromRunId: "parent-run", reason: "promotion" },
    { gate: 1, state: "approved", dependencyHash: hash("a"), decidedAt: "2026-07-01T10:00:00Z" },
    { gate: 3, state: "open", dependencyHash: hash("c") },
  ];
  const run: RunConfigV1 = {
    schemaVersion: "1.0.0",
    projectId: "sample-project",
    runId: "prod-run",
    environment: "prod",
    targetScope: "/subscriptions/example",
    iacTool: "bicep",
    createdAt: "2026-07-01T09:00:00Z",
    runtimeLockHash: hash("e"),
    parentRunId: "parent-run",
    ownerEpoch: 3,
    gates,
  };

  const rendered = renderRunStatus(run);
  assert.equal(rendered, renderRunStatus({ ...run, gates: [...gates].reverse() }));
  assert.match(rendered, /\| 2 \| inherited \| parent-run \| - \| promotion \|/);
  assert.ok(rendered.indexOf("| 1 |") < rendered.indexOf("| 4 |"));
});

test("deployment preview emphasizes destructive changes and sorted blockers", () => {
  const preview: DeploymentPreviewV1 = {
    schemaVersion: "1.0.0",
    projectId: "sample-project",
    runId: "prod-run",
    environment: "prod",
    track: "terraform",
    operation: "apply",
    target: "production",
    commit: hash("a"),
    dependencyRevision: hash("a"),
    ownerEpoch: 2,
    inputHash: hash("b"),
    iacHash: hash("c"),
    policyHash: hash("d"),
    changes: [
      { resourceId: "z-resource", action: "delete", material: true, details: "data|loss" },
      { resourceId: "a-resource", action: "create", material: true },
    ],
    blockers: ["Zulu blocker", "Alpha|blocker"],
    createdAt: "2026-07-01T10:00:00Z",
    expiresAt: "2026-07-02T10:00:00Z",
    previewHash: hash("f"),
  };
  const reordered: DeploymentPreviewV1 = {
    ...preview,
    changes: [...preview.changes].reverse(),
    blockers: [...preview.blockers].reverse(),
  };

  const rendered = renderDeploymentPreview(preview);
  assert.equal(rendered, renderDeploymentPreview(reordered));
  assert.match(rendered, /\*\*DESTRUCTIVE CHANGES PRESENT\*\*/);
  assert.match(rendered, /\*\*DELETE\*\*/);
  assert.match(rendered, /\*\*BLOCKED:\*\* Alpha\\\|blocker/);
  assert.ok(rendered.indexOf("Alpha") < rendered.indexOf("Zulu"));
  assert.ok(rendered.indexOf("a-resource") < rendered.indexOf("z-resource"));
});

test("approval evidence renders supplied timestamps and optional binding fields", () => {
  const approval: ApprovalEvidenceV1 = {
    schemaVersion: "1.0.0",
    projectId: "sample-project",
    runId: "prod-run",
    gate: 4,
    decision: "approved",
    actor: "local-maintainer",
    mechanism: "tty",
    dependencyHash: hash("a"),
    previewHash: hash("b"),
    writerEpoch: 4,
    recipientIdentity: "github-actions:owner/repo:123:2:deploy",
    decidedAt: "2026-07-01T11:00:00Z",
    expiresAt: "2026-07-01T12:00:00Z",
  };

  const rendered = renderApprovalEvidence(approval);
  assert.equal(rendered, renderApprovalEvidence(approval));
  assert.match(rendered, /\*\*Decision:\*\* APPROVED/);
  assert.match(rendered, /2026-07-01T11:00:00Z/);
  assert.match(rendered, /github-actions:owner\/repo:123:2:deploy/);
});

test("ADR rendering preserves explicit alternatives and consequences without inventing approval", () => {
  const architecture: ArchitectureV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run",
    title: "Design",
    summary: "Design",
    sourceHashes: {},
    components: [],
    decisions: [],
    risks: [],
    decisionRecords: [
      {
        id: "ADR-0001",
        title: "Service|selection",
        context: "Requirements",
        decision: "Selected service",
        requirementIds: ["REQ-1"],
        alternatives: [
          { option: "A", benefits: "Low cost", drawbacks: "Limited scale", rejectionReason: "Demand exceeds capacity" },
          {
            option: "B",
            benefits: "Flexible",
            drawbacks: "Higher operations effort",
            rejectionReason: "Team capacity",
          },
        ],
        positiveConsequences: ["Demand met"],
        negativeConsequences: ["Higher cost"],
        wafImpacts: {
          security: "Identity",
          reliability: "Recovery",
          "performance-efficiency": "Scale",
          "cost-optimization": "Cost",
          "operational-excellence": "Staffing",
        },
        complianceConsiderations: "Target policy review required",
        implementationNotes: "Plan the selected resource",
      },
    ],
  };
  const rendered = renderArchitectureDecisionRecords(architecture, hash("a"));
  assert.equal(rendered, renderArchitectureDecisionRecords(architecture, hash("a")));
  assert.match(rendered, /Demand exceeds capacity/);
  assert.match(rendered, /Higher cost/);
  assert.match(rendered, /Service\\\|selection/);
  assert.match(rendered, /Gate approval and implemented state are separate evidence/);
  const missingRecords = { ...architecture };
  delete missingRecords.decisionRecords;
  assert.throws(() => renderArchitectureDecisionRecords(missingRecords, hash("a")), /unavailable/);
});

test("policy mapping matrix preserves design dispositions without exposing expected values or certifying compliance", () => {
  const policy: PolicyPropertyMapV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run",
    governanceHash: hash("a"),
    mappings: [
      {
        policyAssignmentId: "assignment",
        policyDefinitionId: "definition",
        policyDefinitionReferenceId: "member",
        effect: "deny",
        logicalResourceId: "storage",
        propertyPath: "properties.minimumTlsVersion",
        expectedValue: "DO_NOT_RENDER",
        disposition: "satisfied",
      },
    ],
  };
  const output = renderPolicyMappingMatrix(policy, hash("b"));
  assert.match(output, /member/);
  assert.match(output, /satisfied disposition alone is not execution evidence/);
  assert.doesNotMatch(output, /DO_NOT_RENDER/);
  assert.match(
    renderPolicyMappingMatrix({ ...policy, mappings: [] }, hash("b")),
    /does not establish absence of audit policies/,
  );
});

test("operations runbook renders explicit ownership and untested recovery without claiming execution", () => {
  const diagnosis: DiagnosisV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run",
    diagnosedAt: "2026-09-21T00:00:00Z",
    status: "unknown",
    observations: [],
    causes: [],
    operationalHandoff: {
      owner: "Operations",
      escalation: "On-call",
      maintenanceWindow: "Sunday UTC",
      accessPrerequisites: ["Read monitoring"],
      configurationReferences: [{ name: "ENDPOINT", source: "Deployment output" }],
      healthChecks: [{ resourceId: "/api", check: "Read /health", expectedOutcome: "HTTP 200", evidenceRefs: [] }],
      monitoring: "Review alert workspace",
      incidentResponse: {
        applicability: "applicable",
        owner: "On-call",
        prerequisites: ["Incident declared"],
        steps: ["Inspect service metrics"],
        verification: "Record findings",
        executionStatus: "untested",
      },
      rollback: {
        applicability: "not-applicable",
        rationale: "Replacement requires a new reviewed infrastructure change",
      },
      recovery: { applicability: "not-applicable", rationale: "State is owned by another service" },
      limitations: ["No restore exercise evidence"],
    },
  };
  const output = renderOperationsRunbook(diagnosis, hash("a"));
  assert.equal(output, renderOperationsRunbook(diagnosis, hash("a")));
  assert.match(output, /Execution status: untested/);
  assert.match(output, /not establish that these checks ran or passed/);
  assert.match(output, /State is owned by another service/);
  const missing = { ...diagnosis };
  delete missing.operationalHandoff;
  assert.throws(() => renderOperationsRunbook(missing, hash("a")), /unavailable/);
});

test("deployment summary distinguishes recorded evidence from live and operational claims", () => {
  const operation: OperationRecordV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run-1",
    operationId: "op-1",
    operation: "apply",
    state: "succeeded",
    previewHash: hash("a"),
    approvalHash: hash("b"),
    ownerEpoch: 1,
    updatedAt: "2026-09-21T00:00:00Z",
  };
  const inventory: ResourceInventoryV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run-1",
    deploymentHash: hash("c"),
    collectedAt: operation.updatedAt,
    resources: [
      {
        logicalId: "storage|consumer",
        resourceId: "/storage",
        type: "Storage",
        location: "swedencentral",
        properties: { secret: "DO_NOT_RENDER" },
      },
    ],
  };
  const approval: ApprovalEvidenceV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run-1",
    gate: 4,
    decision: "approved",
    actor: "consumer",
    mechanism: "tty",
    dependencyHash: hash("a"),
    previewHash: hash("a"),
    writerEpoch: 1,
    decidedAt: operation.updatedAt,
  };
  const input = {
    operation,
    inventory,
    approval,
    operationHash: hash("c"),
    inventoryHash: hash("d"),
    provider: "fake" as const,
    evidenceMode: "simulated" as const,
  };
  const rendered = renderDeploymentSummary(input);
  assert.equal(rendered, renderDeploymentSummary(input));
  assert.match(rendered, /Simulated evidence only/);
  assert.match(rendered, /storage\\\|consumer/);
  assert.doesNotMatch(rendered, /DO_NOT_RENDER/);
  assert.match(rendered, /restore tests.*not established/);
  assert.match(
    renderDeploymentSummary({ ...input, provider: "bicep", evidenceMode: "native" }),
    /does not independently verify live cloud/,
  );
  assert.match(
    renderDeploymentSummary({ ...input, inventory: { ...inventory, resources: [] } }),
    /not proof of absence/,
  );
});

test("resource inventory sorts resources and property keys", () => {
  const resources: ResourceInventoryV1["resources"] = [
    {
      logicalId: "storage",
      resourceId: "/storage/z",
      type: "Storage",
      location: "swedencentral",
      properties: { z: 2, a: "value|one" },
    },
    {
      logicalId: "api",
      resourceId: "/apps/a",
      type: "App",
      location: "swedencentral",
      properties: { enabled: true },
    },
  ];
  const inventory: ResourceInventoryV1 = {
    schemaVersion: "1.0.0",
    projectId: "sample-project",
    runId: "prod-run",
    deploymentHash: hash("a"),
    collectedAt: "2026-07-01T12:00:00Z",
    resources,
  };

  const rendered = renderResourceInventory(inventory);
  assert.equal(rendered, renderResourceInventory({ ...inventory, resources: [...resources].reverse() }));
  assert.ok(rendered.indexOf("| api |") < rendered.indexOf("| storage |"));
  assert.match(rendered, /\{"a":"value\\\|one","z":2\}/);
});

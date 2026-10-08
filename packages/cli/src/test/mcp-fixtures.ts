import { MCP_OUTPUT_SCHEMAS } from "../mcp-output-schemas.js";

// Valid MCP tool results shared by the output-contract and repeat-safety tests.
export const hash = "a".repeat(64);
export const timestamp = "2026-09-18T00:00:00.000Z";
export const selection = { projectId: "demo", runId: "run-1" };
export const run = {
  schemaVersion: "1.0.0",
  ...selection,
  environment: "dev",
  targetScope: "local",
  iacTool: "bicep",
  createdAt: timestamp,
  runtimeLockHash: hash,
  ownerEpoch: 1,
  gates: [1, 2, 3, 4].map((gate) => ({ gate, state: "closed", dependencyHash: hash })),
};
export const task = {
  schemaVersion: "1.0.0",
  ...selection,
  taskId: "task-1",
  role: "requirements",
  taskType: "requirements",
  expectedHead: hash,
  ownerEpoch: 1,
  createdAt: timestamp,
  expiresAt: timestamp,
  inputRefs: [hash],
  allowedOutputKinds: ["requirements"],
  capabilityGrants: [{ capability: "read", sideEffect: "none", expiresAt: timestamp }],
  maxOutputBytes: 6000,
};
export const request = {
  schemaVersion: "1.0.0",
  requestId: "request-1",
  expectedHead: hash,
  ownerEpoch: 1,
  questions: [{ id: "workload", prompt: "Workload?", options: ["web", "batch"] }],
  intake: { round: "business-discovery", ordinal: 1, total: 3 },
};
export const staged = { taskId: "task-1", kind: "requirements", path: "staged.json", bytes: 2, hash };
export const completion = { outputHashes: { requirements: hash }, summary: "Requirements accepted" };
export const inventory = {
  schemaVersion: "1.0.0",
  ...selection,
  deploymentHash: hash,
  collectedAt: timestamp,
  resources: [
    {
      logicalId: "api",
      resourceId: "/subscriptions/test/resources/api",
      type: "fake/service",
      location: "local",
      properties: { tags: { environment: "dev" }, capacity: 1, enabled: true },
    },
  ],
};
export const observation = {
  schemaVersion: "1.0.0",
  ...selection,
  observationId: hash,
  patternKey: hash,
  observedAt: timestamp,
  source: "deterministic-test",
  category: "correctness",
  severity: "low",
  statement: "Result validation is required",
  evidenceRefs: [hash],
  disposition: "active",
  redactionCount: 0,
};
export const proposal = {
  schemaVersion: "1.0.0",
  projectId: "demo",
  proposalId: hash,
  patternKey: hash,
  generatedAt: timestamp,
  target: "validator",
  title: "Validate results",
  summary: "Add output contracts",
  occurrenceCount: 2,
  runIds: ["run-1", "run-2"],
  evidenceRefs: [hash],
  confidence: "high",
  status: "pending",
  inert: true,
};
export const capability = {
  id: "test",
  state: "not-installed",
  requiredWorkflows: ["requirements"],
  action: "Install the pack",
};
export const status = { run, head: hash, events: 1, task: "requirements", blockers: [] };
export const doctorCheck = { id: "node", ok: true, value: "24", remedy: "Install Node" };
export const doctorReport = { healthy: true, checks: [doctorCheck], remedies: [], nextAction: "No action required" };
export const doctor = {
  healthy: true,
  nextAction: "No action required",
  remedies: [],
  counts: { total: 1, passed: 1, failed: 0 },
  checks: [doctorCheck],
  omitted: { passed: 0, failed: 0 },
  truncated: false,
};
export const approval = {
  schemaVersion: "1.0.0",
  ...selection,
  gate: 1,
  decision: "approved",
  actor: "tester",
  dependencyHash: hash,
  writerEpoch: 1,
  decidedAt: timestamp,
  mechanism: "tty",
};
export type ToolName = keyof typeof MCP_OUTPUT_SCHEMAS;
export const fixtures: Record<ToolName, Record<string, unknown>> = {
  status,
  releaseWriter: { released: true, projectId: "demo", runId: "run-1" },
  capabilityList: { packs: [capability] },
  capabilityStatus: capability,
  nextTask: { status: "task", task },
  taskContext: {
    task,
    inputs: [{ schemaVersion: "1.0.0" }],
    inputReferences: [{ hash, bytes: 2, inlined: true }],
    artifactHashes: { requirements: hash },
    recordedInput: { workload: "web", budget: { kind: "budget", amount: 0, currency: "EUR", cadence: "monthly" } },
    decisions: { services: ["web", "database"] },
    outputTemplates: { requirements: {} },
    outputRoot: "/workspace/.apex/work/task-1",
    status: "active",
    blockers: [],
  },
  readTaskInput: { subjectHash: hash, content: "{}", offset: 0 },
  recordInput: { recorded: true, requestId: "request-1" },
  governanceImport: { outputHash: hash, summary: "Imported" },
  governanceSelect: {
    status: "selected",
    choice: "reuse",
    candidateHash: hash,
    observedAt: timestamp,
    refreshRequired: false,
  },
  projectCreate: selection,
  projectList: { projects: [{ projectId: "demo", displayName: "Demo" }] },
  projectUse: selection,
  projectDelete: { deleted: "demo" },
  gateDecide: approval,
  reviewDecide: { status: "resolved" },
  stageArtifact: staged,
  stageFile: { taskId: "task-1", path: "main.bicep", bytes: 2, hash, idempotent: false },
  generateIac: { files: [], outputHashes: { "iac-handoff": hash }, treeHash: hash },
  validateTask: { valid: true, taskId: "task-1" },
  completeTask: completion,
  requirementsComplete: completion,
  architectureComplete: completion,
  reviewComplete: completion,
  planComplete: completion,
  preview: { markdown: "# Deployment preview" },
  reconcile: inventory,
  inventory,
  diagnose: { status, doctor },
  improvementObserve: { observation, deduplicated: false },
  improvementObservations: { observations: [observation] },
  improvementProposals: { proposals: [proposal] },
  render: { markdown: "# Status" },
  promote: run,
  doctor,
  doctorChecks: { checks: [doctorCheck] },
  submitEvidence: {
    status: "accepted",
    kind: "test",
    bytes: 2,
    retention: "project",
    hash,
    redacted: false,
    reasons: [],
  },
};

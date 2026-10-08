import {
  CONTRACT_VERSION,
  type ArchitectureV1,
  type ImplementationIntentV1,
  type IacBindingV1,
  type QualityScorecardV1,
  type RequirementsV1,
} from "@apexops/contracts";
import { reviewCaptureFileName, reviewCaptureKey, reviewHome, sha256Json, signReviewCapture } from "@apexops/kernel";
import { evaluateQualityScorecard } from "@apexops/renderers";
import { mkdtempSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import type { HostEnvironment } from "../host-profile.js";
import type { ApexService, ServiceOptions, TaskOutput } from "../service.js";
import { APEX_VERSION } from "../version.js";

const roots: string[] = [];

// Rubber-duck captures and their signing key live outside the workspace. Tests always use a suite-owned review home,
// even when the developer has APEX_REVIEW_HOME set, because rejection cases leave capture files behind.
process.env.APEX_REVIEW_HOME = mkdtempSync(join(tmpdir(), "apex-review-home-"));
roots.push(process.env.APEX_REVIEW_HOME);
// Doctor reads the Copilot CLI plugin store; never let the developer's own store decide test outcomes.
process.env.COPILOT_HOME = mkdtempSync(join(tmpdir(), "apex-copilot-home-"));
roots.push(process.env.COPILOT_HOME);

export async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "apex-cli-"));
  roots.push(root);
  return root;
}

after(async () =>
  Promise.all(
    roots.map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 10 : 0,
        retryDelay: 100,
      }),
    ),
  ),
);

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

export function requirements(projectId = "demo"): RequirementsV1 {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId,
    workload: "offline service",
    environment: "dev",
    requirements: [
      { id: "REQ-1", statement: "Deploy deterministically", priority: "must", status: "confirmed", source: "user" },
    ],
    assumptions: [],
    unknowns: [],
  };
}

export function intent(
  runId: string,
  projectId = "demo",
  sourceHashes: Record<string, string> = { requirements: "a".repeat(64) },
): ImplementationIntentV1 {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId,
    runId,
    sourceHashes,
    resources: [{ id: "api", type: "fake/service", purpose: "Serve requests", dependsOn: [], controls: [] }],
    outputs: ["endpoint"],
  };
}

export function workloadDecisionManifest(input: {
  runId: string;
  requirementsHash: string;
  architectureHash: string;
  costEstimateHash: string;
  projectId?: string;
  environment?: string;
}) {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId: input.projectId ?? "demo",
    runId: input.runId,
    environment: input.environment ?? "dev",
    sourceRequirementsHash: input.requirementsHash,
    architectureHash: input.architectureHash,
    costEstimateHash: input.costEstimateHash,
    environments: [input.environment ?? "dev"],
    requirementTraceability: [{ requirementId: "REQ-1", skuDecisionIds: ["api-sku"], sloDecisionIds: ["api-slo"] }],
    skuDecisions: [
      {
        id: "api-sku",
        logicalId: "api",
        service: "fake/service",
        sku: "test",
        quantity: 1,
        rationale: "Confirmed availability requirement",
        requirementIds: ["REQ-1"],
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
        requirementIds: ["REQ-1"],
        environmentOverrides: [],
      },
    ],
    revisions: [
      { number: 1, createdAt: "2026-01-01T00:00:00.000Z", sourceHash: input.requirementsHash, reason: "Initial" },
    ],
  };
}

export function architecture(runId: string): ArchitectureV1 {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId: "demo",
    runId,
    title: "Demo",
    summary: "Demo architecture",
    sourceHashes: { requirements: "a".repeat(64) },
    components: [
      {
        id: "api",
        service: "fake/service",
        resourceTypes: ["Microsoft.Web/sites"],
        purpose: "Serve",
        requirementIds: ["REQ-1"],
        dependsOn: [],
      },
    ],
    decisions: [],
    risks: [],
    wellArchitectedAssessment: {
      framework: "azure-well-architected-framework",
      assessmentType: "qualitative",
      pillars: (
        ["security", "reliability", "performance-efficiency", "cost-optimization", "operational-excellence"] as const
      ).map((pillar) => ({
        pillar,
        status: "aligned",
        assessment: `${pillar} is addressed for the test workload`,
        requirementIds: ["REQ-1"],
        evidenceRefs: [],
        recommendations: [],
        tradeoffs: [],
      })),
    },
  };
}

export function costEstimate(runId: string, monthlyCost = 1) {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId: "demo",
    runId,
    currency: "USD",
    pricingDate: "2026-01-01",
    lineItems: [
      {
        id: "api",
        service: "fake/service",
        sku: "test",
        quantity: 1,
        unitPrice: 1,
        unitsPerMonth: 1,
        monthlyCost,
        source: { provider: "test", uri: "https://example.test", retrievedAt: "2026-01-01T00:00:00.000Z" },
        uncertainty: { lowerMonthlyCost: 0, upperMonthlyCost: 2, confidence: "high", basis: "test" },
      },
    ],
    totalMonthlyCost: monthlyCost,
    assumptions: [],
  };
}

export function review(runId: string, subjectKind: string, subjectHash: string, findings: unknown[] = []) {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId: "demo",
    runId,
    subjectKind,
    subjectHash,
    reviewedAt: "2026-01-01T00:00:00.000Z",
    findings,
    ...(subjectKind === "architecture"
      ? {
          criteria: [
            "security",
            "reliability",
            "performance-efficiency",
            "cost-optimization",
            "operational-excellence",
          ].map((criterionId) => ({
            criterionId,
            outcome: "pass",
            rationale: `${criterionId} was independently reviewed`,
            findingIds: [],
          })),
        }
      : {}),
  };
}

interface ReviewValue {
  findings?: Array<{ id?: string; severity: string; title: string; detail: string }>;
  criteria?: Array<{ criterionId: string; outcome: string; rationale: string; findingIds?: string[] }>;
}

/** Rubber-duck's answer text for review findings, in the apex-review block format the kernel parses. */
export function reviewAnswer(input: unknown, prose = "Rubber-duck review notes.\n"): string {
  const value = input as ReviewValue;
  const answer = {
    findings: (value.findings ?? []).map(({ id, severity, title, detail }) => ({
      ...(id === undefined ? {} : { id }),
      severity,
      title,
      detail,
    })),
    ...(value.criteria === undefined
      ? {}
      : {
          criteria: value.criteria.map(({ criterionId, outcome, rationale, findingIds }) => ({
            criterionId,
            outcome,
            rationale,
            findingIds: findingIds ?? [],
          })),
        }),
  };
  return `${prose}\`\`\`apex-review\n${JSON.stringify(answer, null, 2)}\n\`\`\`\n`;
}

/** Writes a signed capture exactly as the managed postToolUse hook does for the task's issued rubber-duck prompt. */
export async function captureReview(
  service: ApexService,
  taskId: string,
  value: unknown,
  options: { prompt?: (prompt: string) => string; capturedAt?: string } = {},
): Promise<string> {
  const request = (await service.taskContext(taskId)).reviewRequest;
  if (request === undefined) throw new Error(`Task ${taskId} has no rubber-duck review request`);
  const home = reviewHome();
  const record = signReviewCapture(
    {
      prompt: options.prompt?.(request.prompt) ?? request.prompt,
      response: typeof value === "string" ? value : reviewAnswer(value),
      sessionId: "test-session",
      capturedAt: options.capturedAt ?? new Date().toISOString(),
    },
    await reviewCaptureKey(home),
  );
  const path = join(home, "captures", reviewCaptureFileName(record));
  await mkdir(join(home, "captures"), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(record));
  return path;
}

/** Completes a review task the only supported way: through a captured rubber-duck answer. */
export async function completeReviewTask(service: ApexService, taskId: string, value: unknown) {
  await captureReview(service, taskId, value);
  return service.completeReview(taskId);
}

/** Completes any task; review-findings bundles become captured rubber-duck answers. */
export async function completeOutputs(service: ApexService, taskId: string, outputs: TaskOutput[]) {
  const review = outputs.find(({ kind }) => kind === "review-findings");
  return review === undefined
    ? service.completeTaskOutputs(taskId, outputs)
    : completeReviewTask(service, taskId, review.value);
}

export function governance(runId: string) {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId: "demo",
    runId,
    targetScope: "local",
    source: "collected" as const,
    discoveredAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    summary: { assignmentCount: 0, denyCount: 0, modifyCount: 0, auditCount: 0, exemptionCount: 0 },
    constraintsRef: { mediaType: "application/json", uri: "memory://constraints", digest: "b".repeat(64), bytes: 0 },
  };
}

export function availabilityEvidence(
  runId: string,
  projectId = "demo",
  targetScope = "local",
  mode: "native" | "simulated" = "simulated",
  evidenceRefs = {
    pricing: "1".repeat(64),
    quota: "2".repeat(64),
    regionalAvailability: "3".repeat(64),
  },
  expiresAt = "2099-01-01T00:00:00.000Z",
  unavailableCheck?: "pricing" | "quota" | "regionalAvailability",
  collectedAt = "2026-01-01T00:00:00.000Z",
) {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId,
    runId,
    targetScope,
    mode,
    collectedAt,
    expiresAt,
    checks: {
      pricing: {
        status: unavailableCheck === "pricing" ? ("unavailable" as const) : ("current" as const),
        evidenceRef: evidenceRefs.pricing,
      },
      quota: {
        status: unavailableCheck === "quota" ? ("unavailable" as const) : ("current" as const),
        evidenceRef: evidenceRefs.quota,
      },
      regionalAvailability: {
        status: unavailableCheck === "regionalAvailability" ? ("unavailable" as const) : ("current" as const),
        evidenceRef: evidenceRefs.regionalAvailability,
      },
    },
  };
}

export async function acceptAvailabilityEvidence(
  service: ApexService,
  runId: string,
  projectId = "demo",
  targetScope = "local",
  options: {
    evidenceTargetScope?: string;
    expiresAt?: string;
    unavailableCheck?: "pricing" | "quota" | "regionalAvailability";
    collectedAt?: string;
    mode?: "native" | "simulated";
  } = {},
): Promise<string> {
  const refs = { pricing: "", quota: "", regionalAvailability: "" };
  for (const source of ["pricing", "quota", "regionalAvailability"] as const) {
    const accepted = (await service.acceptEvidence({
      kind: `${source}-evidence`,
      contentType: "application/json",
      value: { source, mode: "simulated", status: "current" },
      required: true,
    })) as { hash?: string };
    if (accepted.hash === undefined) throw new Error(`${source} evidence was not accepted`);
    refs[source] = accepted.hash;
  }
  const accepted = (await service.acceptEvidence({
    kind: "architecture-availability-v1",
    contentType: "application/json",
    value: availabilityEvidence(
      runId,
      projectId,
      options.evidenceTargetScope ?? targetScope,
      options.mode ?? "simulated",
      refs,
      options.expiresAt,
      options.unavailableCheck,
      options.collectedAt,
    ),
    required: true,
  })) as { hash?: string };
  if (accepted.hash === undefined) throw new Error("Availability evidence was not accepted");
  return accepted.hash;
}

export interface GovernanceFindingProjection {
  policyAssignmentId: string;
  policyDefinitionId: string;
  policyDefinitionReferenceId?: string;
  effect: "deny" | "modify" | "deployIfNotExists";
  propertyPath?: string;
}

export function policyMap(
  runId: string,
  governanceHash: string,
  findings: readonly GovernanceFindingProjection[] = [],
) {
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId: "demo",
    runId,
    governanceHash,
    mappings: findings.map((finding) => ({
      policyAssignmentId: finding.policyAssignmentId,
      policyDefinitionId: finding.policyDefinitionId,
      ...(finding.policyDefinitionReferenceId === undefined
        ? {}
        : { policyDefinitionReferenceId: finding.policyDefinitionReferenceId }),
      effect: finding.effect,
      logicalResourceId: "none",
      propertyPath: finding.propertyPath ?? "type",
      disposition: "not-applicable" as const,
      reason: "The test fixture deploys no resource this policy governs",
    })),
  };
}

export async function governanceFindings(service: ApexService, _taskId?: string, designedTypes?: readonly string[]) {
  const run = await service["currentRun"]();
  const events = await service["journal"](run).replay();
  const designed = designedTypes === undefined ? undefined : new Set(designedTypes.map((type) => type.toLowerCase()));
  return (await service["enforcingGovernanceFindings"](run, events))
    .filter(
      ({ resourceTypes }) =>
        designed === undefined ||
        resourceTypes.length === 0 ||
        resourceTypes.some((type) => designed.has(type.toLowerCase())),
    )
    .map((finding) => ({
      policyAssignmentId: finding.assignmentId,
      policyDefinitionId: finding.policyId,
      ...(finding.policyDefinitionReferenceId === undefined
        ? {}
        : { policyDefinitionReferenceId: finding.policyDefinitionReferenceId }),
      effect: finding.effect as GovernanceFindingProjection["effect"],
      resourceTypes: [...finding.resourceTypes],
    }));
}

export async function withPolicyMap(
  service: ApexService,
  taskId: string,
  outputs: TaskOutput[],
): Promise<TaskOutput[]> {
  if (outputs.some(({ kind }) => kind === "policy-property-map")) return outputs;
  const architectureOutput = outputs.find(({ kind }) => kind === "architecture")?.value as
    { runId: string; components: Array<{ resourceTypes: string[] }> } | undefined;
  const context = (await service.taskContext(taskId)) as { artifactHashes: Record<string, string> };
  const governanceHash = context.artifactHashes["governance-constraints"];
  if (architectureOutput === undefined || governanceHash === undefined) return outputs;
  return [
    ...outputs,
    {
      kind: "policy-property-map",
      value: policyMap(
        architectureOutput.runId,
        governanceHash,
        await governanceFindings(
          service,
          taskId,
          architectureOutput.components.flatMap(({ resourceTypes }) => resourceTypes),
        ),
      ),
    },
  ];
}

export async function importReferenceGovernance(service: ApexService): Promise<string> {
  const next = await nextTaskAfterInput(service);
  if (next.status !== "task" || next.task.taskType !== "governance-discovery")
    throw new Error("Expected governance-discovery");
  return (await service.importGovernanceReference()).outputHash;
}

export function planBundle(
  runId: string,
  track: "bicep" | "terraform",
  environmentInputs: Record<string, unknown> = {},
  sourceHashes: Record<string, string> = { requirements: "a".repeat(64) },
) {
  const implementation = intent(runId, "demo", sourceHashes);
  return [
    { kind: "implementation-intent" as const, value: implementation },
    {
      kind: "iac-binding" as const,
      value: {
        schemaVersion: CONTRACT_VERSION,
        projectId: "demo",
        runId,
        track,
        intentHash: sha256Json(implementation),
        resourceBindings: {
          api: {
            implementation: "native:Microsoft.Storage/storageAccounts@2023-05-01",
            version: "2023-05-01",
            parameters: { name: "apidemo", location: "swedencentral", parentId: "/", properties: {} },
          },
        },
      },
    },
    {
      kind: "environment-inputs" as const,
      value: {
        schemaVersion: CONTRACT_VERSION,
        projectId: "demo",
        runId,
        environment: "dev",
        inputs: environmentInputs,
      },
    },
  ];
}

export function codegenBundle(runId: string, track: "bicep" | "terraform", plan: ReturnType<typeof planBundle>) {
  const manifest = {
    schemaVersion: CONTRACT_VERSION,
    projectId: "demo",
    runId,
    track,
    resources: [
      {
        logicalId: "api",
        type: (plan[0]!.value as ImplementationIntentV1).resources[0]!.type,
        implementationAddress: (plan[1]!.value as IacBindingV1).resourceBindings.api!.implementation,
        executionAddress: track === "terraform" ? "azapi_resource.api" : "api",
        implementationKind: "resource",
        ownership: "managed",
        dependsOn: [],
        generatedDependencies: [],
        sourcePath: "main",
      },
    ],
  };
  return [
    { kind: "logical-resource-manifest" as const, value: manifest },
    {
      kind: "iac-handoff" as const,
      value: {
        schemaVersion: CONTRACT_VERSION,
        projectId: "demo",
        runId,
        track,
        rootPath: ".apex/work/code",
        treeHash: "c".repeat(64),
        intentHash: sha256Json(plan[0]!.value),
        bindingHash: sha256Json(plan[1]!.value),
        environmentInputsHash: sha256Json(plan[2]!.value),
        logicalResourceManifestHash: sha256Json(manifest),
        requiredToolVersions: { [track]: "test" },
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  ];
}

export function validationEvidence(runId: string, track: "bicep" | "terraform") {
  const validatorIds =
    track === "bicep"
      ? ["bicep:format", "bicep:build", "bicep:lint"]
      : ["terraform:format", "terraform:init-backend-false", "terraform:validate"];
  validatorIds.push("business:security-baseline", "business:policy-property-map", "business:logical-resource-parity");
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId: "demo",
    runId,
    createdAt: "2026-01-01T00:00:00.000Z",
    entries: validatorIds.map((kind) => ({
      kind,
      hash: "d".repeat(64),
      bytes: 1,
      required: true,
      retention: "immutable",
    })),
  };
}

export async function qualityReport(root: string, runId: string, projectId = "demo") {
  const scorecard = JSON.parse(
    await readFile(join(root, ".apex", "runtime", "quality-scorecard.v1.json"), "utf8"),
  ) as QualityScorecardV1;
  const measurements = [...scorecard.rules]
    .map(({ metric, scenario }) => ({ metric, scenario, samples: 0, evidenceRefs: [] as string[] }))
    .sort((left, right) =>
      `${left.metric}\u0000${left.scenario}`.localeCompare(`${right.metric}\u0000${right.scenario}`),
    );
  const measurementSet = { schemaVersion: CONTRACT_VERSION, measurements };
  await writeJson(join(root, ".apex", "quality", "measurements.json"), measurementSet);
  const measurementsHash = sha256Json(measurementSet);
  const evaluations = evaluateQualityScorecard(scorecard, measurements);
  return {
    schemaVersion: CONTRACT_VERSION,
    projectId,
    runId,
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    scorecardHash: sha256Json(scorecard),
    measurementsHash,
    status:
      evaluations.some(({ decision }) => decision === "fail") ||
      !evaluations.some(({ decision }) => decision === "pass")
        ? ("fail" as const)
        : ("pass" as const),
    checks: evaluations.map(({ metric, scenario, decision, value, samples, reason }) => ({
      id: metric,
      scenario,
      status: decision,
      ...(value === undefined ? {} : { value }),
      samples,
      evidenceRefs: decision === "omitted" ? [] : [measurementsHash],
      detail: reason,
    })),
  };
}

export async function prepareValidatedRun(service: ApexService, runId: string, track: "bicep" | "terraform") {
  const nextTask = async (expected: string) => {
    const next = await nextTaskAfterInput(service);
    if (next.status !== "task" || next.task.taskType !== expected) throw new Error(`Expected ${expected}`);
    return next.task.taskId;
  };
  const complete = async (expected: string, outputs: TaskOutput[]) =>
    completeOutputs(service, await nextTask(expected), outputs);
  const requirementHashes = await complete("requirements", [{ kind: "requirements", value: requirements() }]);
  await complete("requirements-review", [
    { kind: "review-findings", value: review(runId, "requirements", requirementHashes.outputHashes.requirements!) },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(service, runId);
  const governanceHash = await importReferenceGovernance(service);
  const architectureValue = architecture(runId);
  const costValue = costEstimate(runId);
  const architectureTask = await nextTask("architecture");
  const findings = await governanceFindings(service, architectureTask, ["Microsoft.Web/sites"]);
  const architectureHashes = await service.completeTaskOutputs(architectureTask, [
    { kind: "architecture", value: architectureValue },
    { kind: "cost-estimate", value: costValue },
    {
      kind: "workload-decision-manifest",
      value: workloadDecisionManifest({
        runId,
        requirementsHash: requirementHashes.outputHashes.requirements!,
        architectureHash: sha256Json(architectureValue),
        costEstimateHash: sha256Json(costValue),
      }),
    },
    { kind: "policy-property-map", value: policyMap(runId, governanceHash, findings) },
  ]);
  await complete("architecture-review", [
    { kind: "review-findings", value: review(runId, "architecture", architectureHashes.outputHashes.architecture!) },
  ]);
  await service.decideGateNumber(2, "approved", "tester");
  const plan = planBundle(
    runId,
    track,
    {},
    {
      requirements: requirementHashes.outputHashes.requirements!,
      architecture: architectureHashes.outputHashes.architecture!,
      "governance-constraints": governanceHash,
      "policy-property-map": architectureHashes.outputHashes["policy-property-map"]!,
    },
  );
  const planHashes = await complete("plan", plan);
  await complete("plan-review", [
    { kind: "review-findings", value: review(runId, "plan", planHashes.outputHashes["implementation-intent"]!) },
  ]);
  await service.decideGateNumber(3, "approved", "tester");
  await complete(`codegen-${track}`, codegenBundle(runId, track, plan));
  await complete(`validation-${track}`, [{ kind: "validation-evidence", value: validationEvidence(runId, track) }]);
}

export function inputAnswers(
  questions: Array<{ id: string; multiSelect?: boolean; options?: string[]; valueType?: string }>,
) {
  return questions.map(({ id, multiSelect, options, valueType }) => ({
    questionId: id,
    value:
      valueType === "budget"
        ? { kind: "budget" as const, amount: 250, currency: "USD", cadence: "monthly" as const }
        : valueType === "recovery"
          ? { kind: "recovery" as const, rtoMinutes: 60, rpoMinutes: 15 }
          : valueType === "data-classification"
            ? { kind: "data-classification" as const, classification: "internal" as const }
            : valueType === "compliance"
              ? { kind: "compliance" as const, scopes: ["gdpr"] }
              : options === undefined
                ? `test-${id}`
                : multiSelect === true
                  ? [options[0]!]
                  : options[0]!,
  }));
}

export async function nextTaskAfterInput(service: ApexService) {
  let next = await service.nextTask();
  while (next.status === "needs_input") {
    await service.recordInput({
      schemaVersion: "1.0.0",
      requestId: next.request.requestId,
      expectedHead: next.request.expectedHead,
      ownerEpoch: next.request.ownerEpoch,
      answers: inputAnswers(next.request.questions),
    });
    next = await service.nextTask();
  }
  return next;
}

export type HostFixtureKind = "windows" | "wsl2" | "linux" | "wsl1" | "macos";

const HOST_FIXTURES: Record<HostFixtureKind, Pick<HostEnvironment, "platform" | "release">> = {
  windows: { platform: "win32", release: "10.0.26200" },
  wsl2: { platform: "linux", release: "6.6.87.2-microsoft-standard-WSL2" },
  linux: { platform: "linux", release: "6.8.0-60-generic" },
  wsl1: { platform: "linux", release: "4.4.0-26100-Microsoft" },
  macos: { platform: "darwin", release: "25.0.0" },
};

/**
 * Doctor options for a fake host. `tools` maps each executable on PATH to its `--version` output; `plugin` writes the
 * Copilot CLI store record (`false` for none). Defaults describe a ready host for that kind.
 */
export async function hostFixture(
  kind: HostFixtureKind,
  input: {
    tools?: Record<string, string>;
    plugin?: false | Record<string, unknown> | Array<Record<string, unknown>>;
    configText?: string;
  } = {},
): Promise<
  Required<Pick<ServiceOptions, "hostEnvironment" | "executableChecker" | "processRunner">> & {
    calls: string[][];
    copilotHome: string;
  }
> {
  const copilotHome = await tempRoot();
  const tools = input.tools ?? {
    git: "git version 2.51.0",
    copilot: "GitHub Copilot CLI 1.0.93.",
    ...(kind === "wsl2" || kind === "linux"
      ? { bwrap: "bubblewrap 0.11.0", slirp4netns: "slirp4netns version 1.2.1" }
      : {}),
  };
  const plugin = input.plugin ?? { name: "apex", marketplace: "apex-plugins", version: APEX_VERSION, enabled: true };
  if (input.configText !== undefined) await writeFile(join(copilotHome, "config.json"), input.configText, "utf8");
  else if (plugin !== false)
    await writeFile(
      join(copilotHome, "config.json"),
      `// User settings belong in settings.json.\n// This file is managed automatically.\n${JSON.stringify({
        installedPlugins: Array.isArray(plugin) ? plugin : [plugin],
      })}\n`,
      "utf8",
    );
  const calls: string[][] = [];
  return {
    calls,
    copilotHome,
    hostEnvironment: { ...HOST_FIXTURES[kind], env: { COPILOT_HOME: copilotHome }, homedir: copilotHome },
    executableChecker: async (executable) => tools[executable] !== undefined,
    processRunner: {
      run: async (request) => {
        calls.push([request.executable, ...request.args]);
        const stdout = tools[request.executable];
        return {
          exitCode: stdout === undefined ? 1 : 0,
          signal: null,
          stdout: stdout === undefined ? "" : `${stdout}\n`,
          stderr: "",
          timedOut: false,
          outputTruncated: false,
        };
      },
    },
  };
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApexService, SUPPORTED_ARTIFACT_KINDS } from "./service.js";
import { APEX_VERSION } from "./version.js";

const artifactKind = z.enum(
  SUPPORTED_ARTIFACT_KINDS as [
    (typeof SUPPORTED_ARTIFACT_KINDS)[number],
    ...(typeof SUPPORTED_ARTIFACT_KINDS)[number][],
  ],
);
const taskOutput = z.object({ kind: artifactKind, value: z.unknown(), summary: z.string().optional() });
const reviewFinding = z
  .object({
    id: z.string().min(1),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    title: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();
const uniqueStrings = z
  .array(z.string().min(1))
  .min(1)
  .refine((values) => new Set(values).size === values.length);
const inputValue = z.union([
  z.string().min(1),
  uniqueStrings,
  z.object({ kind: z.literal("deferred"), owner: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
  z
    .object({
      kind: z.literal("budget"),
      amount: z.number().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      cadence: z.literal("monthly"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("recovery"),
      rtoMinutes: z.number().int().nonnegative(),
      rpoMinutes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("data-classification"),
      classification: z.enum(["public", "internal", "confidential", "restricted"]),
    })
    .strict(),
  z.object({ kind: z.literal("compliance"), scopes: uniqueStrings }).strict(),
]);
const inputSubmission = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    requestId: z.string().min(1),
    expectedHead: z.string().regex(/^[0-9a-f]{64}$/),
    ownerEpoch: z.number().int().positive(),
    answers: z
      .array(
        z
          .object({
            questionId: z.string().min(1),
            value: inputValue,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const projectCreateInput = z
  .object({
    projectId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    displayName: z.string().min(1).max(256),
    environment: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    targetScope: z.string().min(1).max(1024).optional(),
    iacTool: z.enum(["bicep", "terraform"]),
  })
  .strict();
const projectIdInput = z.object({ projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/) }).strict();
const projectUseInput = projectIdInput.extend({ runId: z.string().min(1).optional() });
const projectDeleteInput = projectIdInput.extend({ confirm: z.literal(true) });
const planCompletionInput = z
  .object({
    taskId: z.string().min(1),
    implementationIntent: z.unknown(),
    iacBinding: z
      .object({
        schemaVersion: z.literal("1.0.0"),
        projectId: z.string().min(1),
        runId: z.string().min(1),
        track: z.enum(["bicep", "terraform"]),
        resourceBindings: z.record(z.string().min(1), z.unknown()),
      })
      .strict(),
    environmentInputs: z.unknown(),
  })
  .strict();
const gateDecisionInput = z
  .object({
    gate: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    decision: z.enum(["approved", "rejected"]),
    confirm: z.literal(true),
  })
  .strict();
const reviewDecisionInput = z
  .object({
    reviewHash: z.string().regex(/^[0-9a-f]{64}$/),
    decisions: z
      .array(
        z
          .object({
            findingId: z.string().min(1),
            action: z.enum(["revise", "accept-risk"]),
            rationale: z.string().min(1),
            expiresAt: z.string().datetime().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const normalizeOutputs = (outputs: z.infer<typeof taskOutput>[]) =>
  outputs.map(({ kind, value, summary }) => ({
    kind,
    value,
    ...(summary === undefined ? {} : { summary }),
  }));

export function createMcpServer(service: ApexService): McpServer {
  const server = new McpServer({ name: "apex", version: APEX_VERSION });
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  });
  server.registerTool("status", { description: "Read selected APEX run status" }, async () =>
    result(await service.status()),
  );
  server.registerTool("capabilityList", { description: "Read capability pack availability" }, async () =>
    result(await service.capabilityList()),
  );
  server.registerTool(
    "capabilityStatus",
    { description: "Read one capability pack status", inputSchema: { pack: z.string() } },
    async ({ pack }) => result(await service.capabilityStatus(pack)),
  );
  server.registerTool(
    "nextTask",
    {
      description:
        "Get the next workflow result. Handle needs_input before requesting context; only status=task returns a task.taskId.",
    },
    async () => result(await service.nextTask()),
  );
  server.registerTool(
    "taskContext",
    {
      description: "Read context only for the exact task.taskId returned by nextTask with status=task.",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => result(await service.taskContext(taskId)),
  );
  server.registerTool(
    "readTaskInput",
    {
      description: "Read a bounded chunk of the accepted source artifact for an active review task.",
      inputSchema: {
        taskId: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(6_000).optional(),
      },
    },
    async ({ taskId, offset, limit }) => result(await service.readTaskInput(taskId, offset, limit)),
  );
  server.registerTool(
    "recordInput",
    { description: "Record answers for the exact pending kernel input request", inputSchema: inputSubmission },
    async (input) => result(await service.recordInput(input)),
  );
  server.registerTool(
    "projectCreate",
    {
      description: "Create and select a new project with its initial environment run",
      inputSchema: projectCreateInput,
    },
    async (input) => result(await service.createProject(input as Parameters<typeof service.createProject>[0])),
  );
  server.registerTool("projectList", { description: "List projects in the current workspace" }, async () =>
    result({ projects: await service.listProjects() }),
  );
  server.registerTool(
    "projectUse",
    { description: "Select an existing project and optionally one of its runs", inputSchema: projectUseInput },
    async ({ projectId, runId }) =>
      result(
        await service.use(projectId as Parameters<typeof service.use>[0], runId as Parameters<typeof service.use>[1]),
      ),
  );
  server.registerTool(
    "projectDelete",
    {
      description: "Delete a project and all of its run-bound state after explicit confirmation",
      inputSchema: projectDeleteInput,
    },
    async ({ projectId, confirm }) =>
      result(await service.deleteProject(projectId as Parameters<typeof service.deleteProject>[0], confirm)),
  );
  server.registerTool(
    "gateDecide",
    {
      description:
        "Record an explicitly confirmed human decision for Gate 1, 2, or 3 using the local OS username as actor. Gate 4 remains CLI-only.",
      inputSchema: gateDecisionInput,
    },
    async ({ gate, decision }) => result(await service.decideInteractiveGate(gate, decision)),
  );
  server.registerTool(
    "reviewDecide",
    {
      description:
        "Resolve all current review findings atomically by requesting revision or accepting permitted time-bound risk.",
      inputSchema: reviewDecisionInput,
    },
    async ({ reviewHash, decisions }) =>
      result(
        await service.decideReview(
          reviewHash,
          decisions.map(({ expiresAt, ...decision }) => ({
            ...decision,
            ...(expiresAt === undefined ? {} : { expiresAt }),
          })),
        ),
      ),
  );
  server.registerTool(
    "stageArtifact",
    {
      inputSchema: {
        taskId: z.string(),
        kind: artifactKind.optional(),
        value: z.unknown().optional(),
        summary: z.string().optional(),
        outputs: z.array(taskOutput).optional(),
      },
    },
    async ({ taskId, kind, value, summary, outputs }) => {
      if (outputs !== undefined)
        return result(
          await Promise.all(normalizeOutputs(outputs).map((output) => service.stageArtifact(taskId, output))),
        );
      if (kind === undefined) throw new Error("stageArtifact requires kind/value or outputs[]");
      return result(
        await service.stageArtifact(taskId, { kind, value, ...(summary === undefined ? {} : { summary }) }),
      );
    },
  );
  server.registerTool(
    "stageFile",
    {
      inputSchema: {
        taskId: z.string(),
        path: z.string(),
        content: z.string(),
        expectedSha: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional(),
      },
    },
    async ({ taskId, path, content, expectedSha }) =>
      result(await service.stageFile(taskId, path, content, expectedSha)),
  );
  server.registerTool(
    "generateIac",
    {
      inputSchema: {
        taskId: z.string(),
        existingResources: z.array(z.string()).optional(),
        azurermProviderConstraint: z.string().optional(),
        azapiProviderConstraint: z.string().optional(),
        lockFileContent: z.string().optional(),
      },
    },
    async ({ taskId, existingResources, azurermProviderConstraint, azapiProviderConstraint, lockFileContent }) =>
      result(
        await service.generateIac(taskId, {
          ...(existingResources === undefined ? {} : { existingResources }),
          ...(azurermProviderConstraint === undefined ? {} : { azurermProviderConstraint }),
          ...(azapiProviderConstraint === undefined ? {} : { azapiProviderConstraint }),
          ...(lockFileContent === undefined ? {} : { lockFileContent }),
        }),
      ),
  );
  server.registerTool(
    "validateTask",
    {
      inputSchema: {
        taskId: z.string(),
        kind: artifactKind.optional(),
        value: z.unknown().optional(),
        summary: z.string().optional(),
        outputs: z.array(taskOutput).optional(),
      },
    },
    async ({ taskId, kind, value, summary, outputs }) =>
      result(
        await service.validateTask(
          taskId,
          outputs === undefined
            ? kind === undefined
              ? undefined
              : { kind, value, ...(summary === undefined ? {} : { summary }) }
            : normalizeOutputs(outputs),
        ),
      ),
  );
  server.registerTool(
    "completeTask",
    {
      description: "Complete a task atomically with a nonempty outputs[] bundle.",
      inputSchema: {
        taskId: z.string(),
        outputs: z.array(taskOutput).min(1),
      },
    },
    async ({ taskId, outputs }) => result(await service.completeTaskOutputs(taskId, normalizeOutputs(outputs))),
  );
  server.registerTool(
    "requirementsComplete",
    {
      description: "Complete the active Requirements task atomically.",
      inputSchema: { taskId: z.string(), requirements: z.unknown() },
    },
    async ({ taskId, requirements }) =>
      result(
        await service.completeRequirements(taskId, requirements as Parameters<typeof service.completeRequirements>[1]),
      ),
  );
  server.registerTool(
    "architectureComplete",
    {
      description: "Complete the active Architecture task atomically with all required outputs.",
      inputSchema: {
        taskId: z.string(),
        architecture: z.unknown(),
        costEstimate: z.unknown(),
        decisionManifest: z.unknown(),
      },
    },
    async ({ taskId, architecture, costEstimate, decisionManifest }) =>
      result(
        await service.completeArchitecture(
          taskId,
          architecture as Parameters<typeof service.completeArchitecture>[1],
          costEstimate as Parameters<typeof service.completeArchitecture>[2],
          decisionManifest as Parameters<typeof service.completeArchitecture>[3],
        ),
      ),
  );
  server.registerTool(
    "reviewComplete",
    {
      description:
        "Complete the active review task; APEX derives subject identity, hash, timestamp, and evidence binding.",
      inputSchema: { taskId: z.string(), findings: z.array(reviewFinding) },
    },
    async ({ taskId, findings }) => result(await service.completeReview(taskId, findings)),
  );
  server.registerTool(
    "planComplete",
    {
      description:
        "Atomically complete a plan. Derives the canonical implementation intent hash for the binding; do not supply intentHash.",
      inputSchema: planCompletionInput,
    },
    async ({ taskId, implementationIntent, iacBinding, environmentInputs }) =>
      result(
        await service.completePlan(
          taskId,
          implementationIntent as Parameters<typeof service.completePlan>[1],
          iacBinding as Parameters<typeof service.completePlan>[2],
          environmentInputs as Parameters<typeof service.completePlan>[3],
        ),
      ),
  );
  server.registerTool("preview", { description: "Read the current operator-created deployment preview" }, async () =>
    result(await service.currentPreview()),
  );
  server.registerTool("reconcile", {}, async () => result(await service.reconcile()));
  server.registerTool("inventory", {}, async () => result(await service.inventory()));
  server.registerTool("diagnose", {}, async () => result(await service.diagnose()));
  server.registerTool(
    "improvementObserve",
    {
      description: "Submit one bounded redacted observation for the selected run",
      inputSchema: {
        taskId: z.string().optional(),
        observedAt: z.string().datetime().optional(),
        source: z.enum([
          "task-completion",
          "deterministic-test",
          "validation-failure",
          "capability-execution",
          "cache-check",
          "explicit-correction",
        ]),
        category: z.enum([
          "correctness",
          "security",
          "reliability",
          "performance",
          "usability",
          "documentation",
          "capability-gap",
        ]),
        severity: z.enum(["critical", "high", "medium", "low", "info"]),
        statement: z.string().min(1).max(1024),
        evidenceRefs: z
          .array(z.string().regex(/^[0-9a-f]{64}$/))
          .min(1)
          .max(32),
      },
    },
    async ({ taskId, observedAt, ...input }) =>
      result(
        await service.improvementObserve({
          ...input,
          ...(taskId === undefined ? {} : { taskId }),
          ...(observedAt === undefined ? {} : { observedAt }),
        }),
      ),
  );
  server.registerTool("improvementObservations", { description: "Read bounded observations" }, async () =>
    result(await service.improvementObservations()),
  );
  server.registerTool("improvementProposals", { description: "Read inert improvement proposals" }, async () =>
    result(await service.improvementProposals()),
  );
  server.registerTool(
    "render",
    { inputSchema: { kind: z.enum(["status", "requirements", "preview", "approval", "inventory"]) } },
    async ({ kind }) => result(await service.render(kind)),
  );
  server.registerTool(
    "promote",
    { inputSchema: { environment: z.string(), target: z.string() } },
    async ({ environment, target }) => result(await service.promote(environment, target)),
  );
  server.registerTool(
    "doctor",
    { inputSchema: { fix: z.boolean().optional(), yes: z.boolean().optional() } },
    async ({ fix, yes }) => result(await service.doctor(fix, yes)),
  );
  server.registerTool(
    "submitEvidence",
    {
      inputSchema: {
        taskId: z.string(),
        kind: z.string(),
        value: z.record(z.string(), z.json()),
        required: z.boolean().optional(),
      },
    },
    async ({ taskId, kind, value, required }) => {
      await service.taskContext(taskId);
      return result(
        await service.acceptEvidence({ kind, contentType: "application/json", value, required: required ?? false }),
      );
    },
  );
  return server;
}

export async function serveMcp(service: ApexService): Promise<void> {
  await createMcpServer(service).connect(new StdioServerTransport());
}

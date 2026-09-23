import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApexService, SUPPORTED_ARTIFACT_KINDS } from "./service.js";
import { APEX_VERSION } from "./version.js";
import { ApexError, EXIT_CODES, normalizeError, type ApexErrorCode } from "./errors.js";
import { SECRET_VALUE_PATTERN } from "@apexops/contracts";
import { MCP_OUTPUT_SCHEMAS } from "./mcp-output-schemas.js";
import { ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";

const errorMessages: Record<ApexErrorCode, string> = {
  APEX_USAGE: "Invalid operation arguments; check the tool input contract.",
  APEX_NOT_FOUND: "Requested APEX state was not found; refresh status and check the identifier.",
  APEX_CONFLICT: "The operation conflicts with current state; refresh status before retrying.",
  APEX_VALIDATION: "APEX validation failed; check the supplied input against the current task contract.",
  APEX_STALE: "Task is stale or expired; refresh status before retrying.",
  APEX_AUTHORIZATION:
    "Operation is not authorized in the current workflow state; check status and approval requirements.",
  APEX_INTERNAL: "APEX could not complete the operation.",
};

const artifactKind = z.enum(
  SUPPORTED_ARTIFACT_KINDS as [
    (typeof SUPPORTED_ARTIFACT_KINDS)[number],
    ...(typeof SUPPORTED_ARTIFACT_KINDS)[number][],
  ],
);
const taskOutput = z.object({ kind: artifactKind, value: z.unknown(), summary: z.string().optional() }).strict();
const stagingInput = (optional: boolean) =>
  z
    .object({
      taskId: z.string().min(1).max(128),
      kind: artifactKind.optional(),
      value: z.unknown().optional(),
      summary: z.string().max(4096).optional(),
      outputs: z.array(taskOutput).min(1).max(32).optional(),
    })
    .strict()
    .superRefine((input, context) => {
      const single = input.kind !== undefined && Object.hasOwn(input, "value");
      const anySingle = input.kind !== undefined || Object.hasOwn(input, "value") || input.summary !== undefined;
      if (
        (input.outputs !== undefined && anySingle) ||
        (input.outputs === undefined && (anySingle ? !single : !optional))
      )
        context.addIssue({
          code: "custom",
          message: "Supply exactly one complete kind/value form or a nonempty outputs bundle.",
        });
      if (input.outputs && new Set(input.outputs.map(({ kind }) => kind)).size !== input.outputs.length)
        context.addIssue({ code: "custom", message: "Output kinds must be unique." });
    })
    .meta({
      oneOf: [
        { required: ["outputs"], not: { anyOf: ["kind", "value", "summary"].map((key) => ({ required: [key] })) } },
        { required: ["kind", "value"], not: { required: ["outputs"] } },
        ...(optional
          ? [{ not: { anyOf: ["kind", "value", "summary", "outputs"].map((key) => ({ required: [key] })) } }]
          : []),
      ],
    });

const readOnlyTools = new Set(["status", "projectList"]);
const externalTools = new Set(["reconcile", "inventory", "diagnose", "doctor"]);

function assertBoundedInput(value: unknown): void {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  let bytes = 0;
  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (++nodes > 100_000 || entry.depth > 64 || bytes > 4 * 1024 * 1024)
      throw new ApexError("APEX_VALIDATION", "Input budget exceeded", EXIT_CODES.validation);
    if (typeof entry.value === "string") bytes += Buffer.byteLength(entry.value);
    else if (entry.value !== null && typeof entry.value === "object") {
      const children = Object.entries(entry.value);
      if (children.length + stack.length + nodes > 100_000)
        throw new ApexError("APEX_VALIDATION", "Input budget exceeded", EXIT_CODES.validation);
      for (const [key, child] of children) {
        bytes += Buffer.byteLength(key);
        stack.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024)
    throw new ApexError("APEX_VALIDATION", "Input budget exceeded", EXIT_CODES.validation);
}
const reviewFinding = z
  .object({
    id: z.string().min(1),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    title: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();
const reviewCriterion = z
  .object({
    criterionId: z.enum([
      "security",
      "reliability",
      "performance-efficiency",
      "cost-optimization",
      "operational-excellence",
    ]),
    outcome: z.enum(["pass", "finding", "not-applicable"]),
    rationale: z.string().min(1),
    findingIds: z.array(z.string().min(1)),
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
            action: z.enum(["revise", "accept-risk", "acknowledge", "dismiss"]),
            rationale: z.string().min(1).optional(),
            owner: z.string().min(1).optional(),
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

export function createMcpServer(service: ApexService, options: { queueTimeoutMs?: number } = {}): McpServer {
  const queueTimeoutMs = options.queueTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(queueTimeoutMs) || queueTimeoutMs < 1 || queueTimeoutMs > 30_000)
    throw new Error("Invalid MCP queue timeout");
  const server = new McpServer({ name: "apex", version: APEX_VERSION });
  const result = (value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("MCP success results require an object envelope");
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      structuredContent: value as Record<string, unknown>,
    };
  };
  const registerTool = server.registerTool.bind(server);
  const toolDefinitions: Tool[] = [];
  let active = false;
  const waiting: Array<{ start: () => void }> = [];
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) active = false;
    else next.start();
  };
  const acquire = (signal?: AbortSignal): Promise<() => void> => {
    if (signal?.aborted) return Promise.reject(new ApexError("APEX_CONFLICT", "Cancelled", EXIT_CODES.conflict));
    if (!active) {
      active = true;
      return Promise.resolve(release);
    }
    if (waiting.length >= 31) return Promise.reject(new ApexError("APEX_CONFLICT", "Queue full", EXIT_CODES.conflict));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        const index = waiting.indexOf(waiter);
        if (index < 0) return;
        waiting.splice(index, 1);
        cleanup();
        reject(new ApexError("APEX_CONFLICT", "Queue cancelled or expired", EXIT_CODES.conflict));
      };
      const waiter = {
        start: () => {
          cleanup();
          resolve(release);
        },
      };
      const timer = setTimeout(cancel, queueTimeoutMs);
      waiting.push(waiter);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  };
  let rateWindowStart = Date.now();
  let rateCount = 0;
  server.registerTool = (name, config, callback) => {
    const outputSchema = MCP_OUTPUT_SCHEMAS[name as keyof typeof MCP_OUTPUT_SCHEMAS];
    if (outputSchema === undefined) throw new Error(`Missing output schema for ${name}`);
    const inputSchema =
      config.inputSchema === undefined
        ? z.object({}).strict()
        : config.inputSchema instanceof z.ZodObject
          ? config.inputSchema.strict().meta(config.inputSchema.meta() ?? {})
          : z.object(config.inputSchema as z.ZodRawShape).strict();
    const guarded = async (...args: Parameters<typeof callback>) => {
      const extra = args.at(-1) as { signal?: AbortSignal };
      const checkCancelled = () => {
        if (extra.signal?.aborted) throw new ApexError("APEX_CONFLICT", "Cancelled", EXIT_CODES.conflict);
      };
      let releaseSlot: (() => void) | undefined;
      let serviceValidation: string | undefined;
      try {
        checkCancelled();
        if (Date.now() - rateWindowStart >= 60_000) {
          rateWindowStart = Date.now();
          rateCount = 0;
        }
        if (++rateCount > 240) throw new ApexError("APEX_CONFLICT", "Call rate exceeded", EXIT_CODES.conflict);
        assertBoundedInput(args[0]);
        const input = inputSchema.safeParse(args[0]);
        if (!input.success) throw new ApexError("APEX_VALIDATION", "Invalid tool arguments", EXIT_CODES.validation);
        releaseSlot = await acquire(extra.signal);
        checkCancelled();
        let response: Awaited<ReturnType<typeof callback>>;
        try {
          response = await Reflect.apply(
            callback,
            undefined,
            config.inputSchema === undefined ? [extra] : [input.data, extra],
          );
        } catch (error) {
          if (error instanceof ApexError && error.code === "APEX_VALIDATION") {
            const issues = Array.isArray(error.details)
              ? (error.details as Array<{ path?: unknown; message?: unknown }>)
                  .slice(0, 5)
                  .map(({ path, message }) => `${String(path)} ${String(message)}`)
              : [];
            const reason = issues.length === 0 ? error.message : `${error.message}: ${issues.join("; ")}`;
            if (!SECRET_VALUE_PATTERN.test(reason)) serviceValidation = reason;
          }
          throw error;
        }
        assertBoundedInput(response.structuredContent);
        if (!outputSchema.safeParse(response.structuredContent).success) throw new Error("Invalid MCP result contract");
        return response;
      } catch (error) {
        const { code } = normalizeError(error);
        // Kernel validation reasons let agents correct typed input; guard, internal and secret-like messages stay generic.
        const message = serviceValidation === undefined ? errorMessages[code] : serviceValidation.slice(0, 1_000);
        return { ...result({ error: { code, message } }), isError: true };
      } finally {
        releaseSlot?.();
      }
    };
    const inputJson = z.toJSONSchema(inputSchema, { target: "draft-7" });
    const wireInput = z.object({}).passthrough().default({});
    const annotations = {
      readOnlyHint: readOnlyTools.has(name),
      destructiveHint: !readOnlyTools.has(name),
      idempotentHint: readOnlyTools.has(name),
      openWorldHint: externalTools.has(name),
    };
    toolDefinitions.push({
      name,
      ...(config.description === undefined ? {} : { description: config.description }),
      inputSchema: inputJson as Tool["inputSchema"],
      outputSchema: z.toJSONSchema(outputSchema, { target: "draft-7" }) as NonNullable<Tool["outputSchema"]>,
      annotations,
    });
    return Reflect.apply(registerTool, server, [
      name,
      { ...config, inputSchema: wireInput, outputSchema, annotations },
      guarded,
    ]);
  };
  server.registerTool("status", { description: "Read selected APEX run status" }, async () =>
    result(await service.workspaceStatus()),
  );
  server.registerTool("capabilityList", { description: "Read capability pack availability" }, async () =>
    result({ packs: await service.capabilityList() }),
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
        "Advance the workflow by issuing a request or task; this can write state and is not retry-safe. For status=needs_input, collect answers and call recordInput; for status=needs_review, present findings and call reviewDecide with the user's decisions. Only status=task returns a task.taskId for taskContext. Do not poll unresolved input or review results.",
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
      description:
        "Read authoritative UTF-8-bounded task input; inputHash selects an authorized dependency or review-metadata from taskContext.",
      inputSchema: {
        taskId: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(6_000).optional(),
        inputHash: z.union([z.string().regex(/^[0-9a-f]{64}$/u), z.literal("review-metadata")]).optional(),
      },
    },
    async ({ taskId, offset, limit, inputHash }) =>
      result(await service.readTaskInput(taskId, offset, limit, inputHash)),
  );
  server.registerTool(
    "recordInput",
    {
      description: "Record answers for the exact pending kernel input request",
      inputSchema: inputSubmission,
      outputSchema: z.object({ recorded: z.literal(true), requestId: z.string().min(1) }).strict(),
    },
    async (input) => result(await service.recordInput(input)),
  );
  server.registerTool(
    "governanceImport",
    {
      description:
        "Import the active subscription from a reviewed local governance baseline; provide only its path, never baseline contents.",
      inputSchema: { path: z.string().min(1) },
    },
    async ({ path }) => result(await service.importGovernanceBaseline(path)),
  );
  server.registerTool(
    "governanceSelect",
    {
      description:
        "Prepare or recall the target governance snapshot reuse/refresh question; only a local path is accepted. Does not import or collect Azure policy.",
      inputSchema: { path: z.string().min(1), reopen: z.boolean().optional() },
    },
    async ({ path, reopen }) =>
      result(await service.selectGovernanceBaseline(path, ...(reopen === undefined ? [] : [{ reopen }]))),
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
        "Resolve review findings atomically by revision, Requirements obligation acknowledgment with an owner, or permitted time-bound risk.",
      inputSchema: reviewDecisionInput,
    },
    async ({ reviewHash, decisions }) =>
      result(
        await service.decideReview(
          reviewHash,
          decisions.map(({ rationale, owner, expiresAt, ...decision }) => ({
            ...decision,
            ...(rationale === undefined ? {} : { rationale }),
            ...(owner === undefined ? {} : { owner }),
            ...(expiresAt === undefined ? {} : { expiresAt }),
          })),
        ),
      ),
  );
  server.registerTool(
    "stageArtifact",
    {
      description:
        "Stage one typed artifact or an outputs[] bundle for the exact active task; staging does not complete the task.",
      inputSchema: stagingInput(false),
    },
    async ({ taskId, kind, value, summary, outputs }, extra) => {
      if (outputs !== undefined) {
        const artifacts = [];
        for (const output of normalizeOutputs(outputs)) {
          if (extra.signal.aborted) throw new ApexError("APEX_CONFLICT", "Cancelled", EXIT_CODES.conflict);
          artifacts.push(await service.stageArtifact(taskId, output));
        }
        return result({ artifacts });
      }
      if (kind === undefined) throw new Error("stageArtifact requires kind/value or outputs[]");
      return result(
        await service.stageArtifact(taskId, { kind, value, ...(summary === undefined ? {} : { summary }) }),
      );
    },
  );
  server.registerTool(
    "stageFile",
    {
      description:
        "Stage a generated file for the exact active task, optionally checking its expected SHA; does not deploy it.",
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
      description:
        "Generate IaC and complete the active CodeGen task from accepted inputs and bindings. Success already accepts the manifest and handoff; return the receipt without calling completeTask again. Does not authorize deployment.",
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
      description:
        "With only taskId for an IaC validation task, execute native checks and return runtime-owned outputs and execution metadata. valid:false and blockedValidatorIds mean required checks remain unexecuted; do not complete. Supplied artifacts are only checked/staged. Task completion and approval are separate.",
      inputSchema: stagingInput(true),
    },
    async ({ taskId, kind, value, summary, outputs }, extra) => {
      if (outputs !== undefined) {
        const staged = [];
        for (const output of normalizeOutputs(outputs)) {
          if (extra.signal.aborted) throw new ApexError("APEX_CONFLICT", "Cancelled", EXIT_CODES.conflict);
          const validated = await service.validateTask(taskId, output);
          if (validated.staged !== undefined)
            staged.push(...(Array.isArray(validated.staged) ? validated.staged : [validated.staged]));
        }
        return result({ valid: true, taskId, staged });
      }
      return result(
        await service.validateTask(
          taskId,
          kind === undefined ? undefined : { kind, value, ...(summary === undefined ? {} : { summary }) },
        ),
      );
    },
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
      description:
        "Complete Architecture atomically; APEX derives identity, artifact hashes, top-level requirementTraceability, and cost/SKU bindings. Each SKU and SLO decision lists its component requirementIds.",
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
      inputSchema: {
        taskId: z.string(),
        findings: z.array(reviewFinding),
        criteria: z.array(reviewCriterion).optional(),
      },
    },
    async ({ taskId, findings, criteria }) => result(await service.completeReview(taskId, findings, criteria)),
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
    result({ markdown: await service.currentPreview() }),
  );
  server.registerTool(
    "reconcile",
    { description: "Run the kernel-authorized reconciliation operation for the selected run." },
    async () => result(await service.reconcile()),
  );
  server.registerTool(
    "inventory",
    { description: "Run the bounded inventory operation for the selected run and return its evidence." },
    async () => result(await service.inventory()),
  );
  server.registerTool(
    "diagnose",
    { description: "Run bounded diagnosis for the selected run and return the kernel-recorded result." },
    async () => result(await service.diagnose()),
  );
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
    result({ observations: await service.improvementObservations() }),
  );
  server.registerTool("improvementProposals", { description: "Read inert improvement proposals" }, async () =>
    result({ proposals: await service.improvementProposals() }),
  );
  server.registerTool(
    "render",
    {
      description:
        "Render the selected run's status, requirements, preview, approval, inventory, structured Architecture decisions, implementation plan, plan-bound deployment guide, operational runbook, or evidence-bound deployment summary as a human-readable projection.",
      inputSchema: {
        kind: z.enum([
          "status",
          "requirements",
          "preview",
          "approval",
          "inventory",
          "deployment-summary",
          "deployment-guide",
          "implementation-plan",
          "architecture-decisions",
          "operations-runbook",
        ]),
      },
      outputSchema: z.object({ markdown: z.string() }).strict(),
    },
    async ({ kind }) => result({ markdown: await service.render(kind) }),
  );
  server.registerTool(
    "promote",
    {
      description:
        "Promote the selected run to a target environment through kernel checks; does not approve or execute deployment.",
      inputSchema: { environment: z.string(), target: z.string() },
    },
    async ({ environment, target }) => result(await service.promote(environment, target)),
  );
  server.registerTool(
    "doctor",
    {
      description:
        "Inspect local APEX installation health; request repairs with fix and explicit confirmation with yes.",
      inputSchema: { fix: z.boolean().optional(), yes: z.boolean().optional() },
    },
    async ({ fix, yes }) => result(await service.doctor(fix, yes)),
  );
  server.registerTool(
    "submitEvidence",
    {
      description:
        "Submit JSON evidence bound to the exact active task after validating its context; does not complete the task.",
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
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolDefinitions }));
  return server;
}

export async function serveMcp(service: ApexService): Promise<void> {
  await createMcpServer(service).connect(new StdioServerTransport());
}

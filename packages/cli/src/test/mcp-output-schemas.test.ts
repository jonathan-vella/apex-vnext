import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ResourceInventoryV1Schema } from "@apexops/contracts";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { McpServer } from "@modelcontextprotocol/server";
import { MCP_OUTPUT_SCHEMAS } from "../mcp-output-schemas.js";
import { summarizeDoctorReport } from "../mcp.js";
import { ApexService } from "../service.js";
import { ApexError, EXIT_CODES, normalizeError, remediationForApexError } from "../errors.js";
import { nextTaskAfterInput, requirements, tempRoot } from "./helpers.js";
import { connectMcp, connectMcpFactory } from "./mcp-client.js";
import {
  hash,
  timestamp,
  selection,
  run,
  task,
  request,
  staged,
  completion,
  inventory,
  observation,
  proposal,
  status,
  doctorReport,
  approval,
  fixtures,
  type ToolName,
} from "./mcp-fixtures.js";

const validVariants: Array<[ToolName, Record<string, unknown>]> = [
  ["nextTask", { status: "needs_input", request }],
  [
    "nextTask",
    {
      status: "needs_input",
      request: {
        schemaVersion: "1.0.0",
        requestId: "request-2",
        expectedHead: hash,
        ownerEpoch: 1,
        questions: request.questions,
        decision: { taskId: "task-1", id: "architecture" },
      },
    },
  ],
  [
    "nextTask",
    {
      status: "needs_review",
      review: {
        gate: 1,
        reviewHash: hash,
        findings: [
          {
            id: "finding-1",
            severity: "low",
            title: "Owner",
            detail: "Record owner",
            actions: ["revise", "acknowledge"],
          },
        ],
      },
    },
  ],
  [
    "taskContext",
    {
      ...fixtures.taskContext,
      governanceFindings: { count: 2, untypedCount: 0, resourceTypeCount: 1, read: "governance-findings:<types>" },
    },
  ],
  [
    "taskContext",
    {
      ...fixtures.taskContext,
      governanceFindings: [
        {
          policyAssignmentId: "/providers/Microsoft.Authorization/policyAssignments/a",
          policyDefinitionId: "/providers/Microsoft.Authorization/policyDefinitions/d",
          effect: "deny",
          displayName: "Deny public access",
          resourceTypes: ["Microsoft.Storage/storageAccounts"],
          requiredValue: false,
        },
      ],
    },
  ],
  ["stageArtifact", { artifacts: [staged] }],
  ["stageArtifact", { artifacts: [] }],
  ["validateTask", { valid: true, taskId: "task-1", staged }],
  ["validateTask", { valid: true, taskId: "task-1", staged: [staged] }],
  ["gateDecide", { ...approval, mechanism: "inherited", recipientIdentity: "tester", expiresAt: timestamp }],
  ["projectDelete", { deleted: "other", selected: selection }],
  ["readTaskInput", { ...fixtures.readTaskInput, nextOffset: 2, outputTemplate: {} }],
  ["status", { ...status, head: null, task: null }],
  [
    "taskContext",
    {
      ...fixtures.taskContext,
      recordedInput: null,
      reviewMetadataReference: {
        selector: "review-metadata",
        bytes: 2,
        inlined: false,
      },
      reviewMetadata: {
        subjectKind: "requirements",
        subjectHash: hash,
        criteria: ["security"],
        evidenceRefs: [hash],
        evidenceRefsRequired: true,
        dispositions: [
          {
            findingId: "finding-1",
            reviewHash: hash,
            subjectHash: hash,
            dependencyHash: hash,
            disposition: "acknowledged",
            actor: "tester",
            rationale: "Assigned",
            evidenceRefs: [],
            expiresAt: timestamp,
          },
        ],
      },
    },
  ],
  [
    "submitEvidence",
    {
      status: "quarantined",
      kind: "test",
      bytes: 2,
      retention: "optional",
      quarantinePath: "/workspace/quarantine.bin",
      redacted: false,
      reasons: ["high-risk-content"],
    },
  ],
];

const invalidVariants: Array<[ToolName, Record<string, unknown>]> = [
  ["nextTask", { status: "task", request }],
  ["nextTask", { status: "task", task, request }],
  [
    "nextTask",
    {
      status: "needs_input",
      request: { ...request, questions: [{ ...request.questions[0], options: ["web", "web"] }] },
    },
  ],
  ["nextTask", { status: "task", task: { ...task, inputRefs: [hash, hash] } }],
  ["nextTask", { status: "task", task: { ...task, unexpected: true } }],
  ["stageArtifact", { ...staged, artifacts: [staged] }],
  ["stageArtifact", { artifacts: [{ ...staged, hash: "invalid" }] }],
  ["validateTask", { valid: true, taskId: "task-1", staged: [{}] }],
  ["taskContext", { ...fixtures.taskContext, recordedInput: { services: ["web", "web"] } }],
  [
    "taskContext",
    {
      ...fixtures.taskContext,
      decisions: { budget: { kind: "budget", currency: "eur", amount: -1, cadence: "monthly" } },
    },
  ],
  ["taskContext", { ...fixtures.taskContext, artifactHashes: { requirements: "invalid" } }],
  ["taskContext", { ...fixtures.taskContext, outputTemplates: { unsupported: {} } }],
  ["taskContext", { ...fixtures.taskContext, governanceFindings: { count: -1 } }],
  [
    "taskContext",
    {
      ...fixtures.taskContext,
      governanceFindings: [
        {
          policyAssignmentId: "/providers/Microsoft.Authorization/policyAssignments/a",
          policyDefinitionId: "/providers/Microsoft.Authorization/policyDefinitions/d",
          effect: "audit",
          displayName: "Audit only",
          resourceTypes: [],
        },
      ],
    },
  ],
  ["completeTask", { ...completion, outputHashes: { unsupported: hash } }],
  ["inventory", { ...inventory, resources: [{ ...inventory.resources[0], resourceId: 1 }] }],
  ["promote", { ...run, gates: [] }],
  ["gateDecide", { ...approval, mechanism: "automatic" }],
  ["improvementObserve", { observation: { ...observation, evidenceRefs: [hash, hash] }, deduplicated: false }],
  ["improvementProposals", { proposals: [{ ...proposal, inert: false }] }],
  ["submitEvidence", { ...fixtures.submitEvidence, quarantinePath: "/workspace/quarantine.bin" }],
  ["readTaskInput", { ...fixtures.readTaskInput, nextOffset: -1 }],
];

test("canonical inventory contract remains precise after the Zod bridge", () => {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(MCP_OUTPUT_SCHEMAS.inventory);
  const { $id: _id, ...canonical } = JSON.parse(JSON.stringify(ResourceInventoryV1Schema));
  const inventoryBranch = structuredClone(schema.anyOf?.[0]);
  assert.ok(inventoryBranch?.properties);
  delete inventoryBranch.properties.nextCursor;
  assert.deepEqual(inventoryBranch, canonical);
  assert.equal(MCP_OUTPUT_SCHEMAS.inventory.safeParse({}).success, false);
  assert.equal(
    MCP_OUTPUT_SCHEMAS.inventory.safeParse({
      error: {
        code: "APEX_STALE",
        message: "Refresh status",
        remediation: "Call status to refresh state.",
      },
    }).success,
    true,
  );
});

test("output schema coverage matches every registered MCP tool", async () => {
  const { client, close } = await connectMcp(new ApexService(await tempRoot()), { name: "output-coverage" });
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, Object.keys(MCP_OUTPUT_SCHEMAS).length);
    assert.deepEqual(Object.keys(MCP_OUTPUT_SCHEMAS).sort(), tools.map(({ name }) => name).sort());
    for (const tool of tools) {
      assert.equal(tool.outputSchema?.type, "object", tool.name);
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      assert.ok(tool.inputSchema.properties?.workspace, tool.name);
      assert.ok(tool.inputSchema.required?.includes("workspace"), tool.name);
      const readOnly = ["status", "projectList"].includes(tool.name);
      assert.equal(tool.annotations?.readOnlyHint, readOnly, tool.name);
      assert.equal(tool.annotations?.idempotentHint, readOnly, tool.name);
      assert.equal(tool.annotations?.destructiveHint, !readOnly, tool.name);
      assert.equal(
        tool.annotations?.openWorldHint,
        ["reconcile", "inventory", "diagnose", "doctor", "doctorChecks"].includes(tool.name),
        tool.name,
      );
      assert.doesNotMatch(tool.name, /apply|deploy|execute/i);
    }
    const nextTask = tools.find(({ name }) => name === "nextTask")!;
    assert.match(nextTask.description!, /write state/i);
    assert.match(nextTask.description!, /not retry-safe/i);
    const gateDecide = tools.find(({ name }) => name === "gateDecide")!;
    const validateGate = new Ajv({ strict: false }).compile(gateDecide.inputSchema);
    for (const gate of [1, 2, 3])
      assert.equal(validateGate({ workspace: "/workspace", gate, decision: "approved", confirm: true }), true);
    assert.equal(validateGate({ workspace: "/workspace", gate: 4, decision: "approved", confirm: true }), false);
    for (const name of ["stageArtifact", "validateTask"]) {
      const validate = new Ajv({ strict: false }).compile(tools.find((tool) => tool.name === name)!.inputSchema);
      assert.equal(validate({ workspace: "/workspace", taskId: "task-1", kind: "requirements" }), false);
      assert.equal(
        validate({
          workspace: "/workspace",
          taskId: "task-1",
          kind: "requirements",
          value: {},
          outputs: [{ kind: "requirements", value: {} }],
        }),
        false,
      );
      assert.equal(validate({ workspace: "/workspace", taskId: "task-1", kind: "requirements", value: {} }), true);
      assert.equal(
        validate({ workspace: "/workspace", taskId: "task-1", outputs: [{ kind: "requirements", value: {} }] }),
        true,
      );
      assert.equal(validate({ workspace: "/workspace", taskId: "task-1" }), name === "validateTask");
    }
  } finally {
    await close();
  }
});

test("actual MCP handlers wrap service fixtures and sanitize failures for every registered tool", async (context) => {
  const taskId = task.taskId;
  const output = { kind: "requirements", value: {} };
  const submission = {
    schemaVersion: "1.0.0",
    requestId: request.requestId,
    expectedHead: hash,
    ownerEpoch: 1,
    answers: [{ questionId: "workload", value: "web" }],
  };
  const project = {
    projectId: "demo",
    displayName: "Demo",
    environment: "dev",
    targetScope: "local",
    iacTool: "bicep",
    riskOwner: "partner",
  };
  const decisions = [{ findingId: "finding-1", action: "revise" }];
  const binding = { schemaVersion: "1.0.0", ...selection, track: "bicep", resourceBindings: {} };
  const observationInput = {
    source: observation.source,
    category: observation.category,
    severity: observation.severity,
    statement: observation.statement,
    evidenceRefs: observation.evidenceRefs,
  };
  type ServiceMethod = {
    [Method in keyof ApexService]: ApexService[Method] extends (...args: never[]) => unknown ? Method : never;
  }[keyof ApexService];
  const cases: Record<ToolName, { method: ServiceMethod; input: Record<string, unknown>; args: unknown[] }> = {
    status: { method: "status", input: {}, args: [] },
    releaseWriter: { method: "releaseWriter", input: {}, args: [] },
    capabilityList: { method: "capabilityList", input: {}, args: [] },
    capabilityStatus: { method: "capabilityStatus", input: { pack: "test" }, args: ["test"] },
    nextTask: { method: "nextTask", input: {}, args: [] },
    taskContext: { method: "taskContext", input: { taskId }, args: [taskId] },
    readTaskInput: { method: "readTaskInput", input: { taskId }, args: [taskId, undefined, undefined, undefined] },
    recordInput: { method: "recordInput", input: submission, args: [submission] },
    governanceImport: { method: "importGovernanceBaseline", input: { path: "baseline.json" }, args: ["baseline.json"] },
    governanceSelect: { method: "selectGovernanceBaseline", input: { path: "baseline.json" }, args: ["baseline.json"] },
    projectCreate: { method: "createProject", input: project, args: [project] },
    projectList: { method: "listProjects", input: {}, args: [] },
    projectUse: { method: "use", input: { projectId: "demo" }, args: ["demo", undefined] },
    projectDelete: { method: "deleteProject", input: { projectId: "demo", confirm: true }, args: ["demo", true] },
    gateDecide: {
      method: "decideInteractiveGate",
      input: { gate: 1, decision: "approved", confirm: true },
      args: [1, "approved"],
    },
    reviewDecide: { method: "decideReview", input: { reviewHash: hash, decisions }, args: [hash, decisions] },
    stageArtifact: { method: "stageArtifact", input: { taskId, ...output }, args: [taskId, output] },
    stageFile: {
      method: "stageFile",
      input: { taskId, path: "main.bicep", content: "{}" },
      args: [taskId, "main.bicep", "{}", undefined],
    },
    generateIac: { method: "generateIac", input: { taskId }, args: [taskId, {}] },
    validateTask: { method: "validateTask", input: { taskId }, args: [taskId, undefined] },
    completeTask: { method: "completeTaskOutputs", input: { taskId, outputs: [output] }, args: [taskId, [output]] },
    requirementsComplete: { method: "completeRequirements", input: { taskId, requirements: {} }, args: [taskId, {}] },
    architectureComplete: {
      method: "completeArchitecture",
      input: { taskId, architecture: {}, costEstimate: {}, decisionManifest: {}, policyMappings: [] },
      args: [taskId, {}, {}, {}, []],
    },
    reviewComplete: { method: "completeReview", input: { taskId, findings: [] }, args: [taskId, [], undefined] },
    planComplete: {
      method: "completePlan",
      input: { taskId, implementationIntent: {}, iacBinding: binding, environmentInputs: {} },
      args: [taskId, {}, binding, {}],
    },
    preview: { method: "currentPreview", input: {}, args: [] },
    reconcile: { method: "reconcile", input: {}, args: [] },
    inventory: { method: "inventory", input: {}, args: [] },
    diagnose: { method: "diagnose", input: {}, args: [] },
    improvementObserve: { method: "improvementObserve", input: observationInput, args: [observationInput] },
    improvementObservations: { method: "improvementObservations", input: {}, args: [] },
    improvementProposals: { method: "improvementProposals", input: {}, args: [] },
    render: { method: "render", input: { kind: "status" }, args: ["status"] },
    promote: { method: "promote", input: { environment: "prod", target: "local" }, args: ["prod", "local"] },
    doctor: { method: "doctor", input: {}, args: [undefined, undefined] },
    doctorChecks: { method: "doctor", input: {}, args: [] },
    submitEvidence: {
      method: "acceptEvidence",
      input: { taskId, kind: "test", value: {} },
      args: [{ kind: "test", contentType: "application/json", value: {}, required: false }],
    },
  };
  const service = new ApexService(await tempRoot());
  const workspace = service.root;
  const responses = { ...fixtures };
  const calls: Array<{ method: keyof ApexService; args: unknown[] }> = [];
  let failure: { method: keyof ApexService; error: Error } | undefined;
  for (const name of Object.keys(cases) as ToolName[]) {
    const { method } = cases[name];
    context.mock.method(service, method, async (...args: unknown[]) => {
      calls.push({ method, args });
      if (failure?.method === method) throw failure.error;
      const value = responses[name];
      switch (name) {
        case "capabilityList":
          return value.packs;
        case "projectList":
          return value.projects;
        case "improvementObservations":
          return value.observations;
        case "improvementProposals":
          return value.proposals;
        case "preview":
        case "render":
          return value.markdown;
        case "doctor":
        case "doctorChecks":
          return doctorReport;
        case "diagnose":
          return { status, doctor: doctorReport };
        default:
          return value;
      }
    });
  }
  const { client, close } = await connectMcp(service, { name: "actual-output-consumer" });
  try {
    const { tools } = await client.listTools();
    const names = tools.map(({ name }) => name).sort();
    assert.deepEqual(Object.keys(cases).sort(), names);
    const ajv = new Ajv({ strict: false, allErrors: true });
    ajv.addFormat("date-time", (value: string) => Number.isFinite(Date.parse(value)));
    const validators = new Map(
      tools.map((tool) => {
        assert.ok(tool.outputSchema, tool.name);
        return [tool.name, ajv.compile(tool.outputSchema as Record<string, unknown>)];
      }),
    );
    const invoked = new Set<string>();
    const check = async (
      name: ToolName,
      expected: Record<string, unknown>,
      input = cases[name].input,
      args = [cases[name].args],
    ) => {
      calls.length = 0;
      const response = await client.callTool({ name, arguments: { workspace, ...input } });
      invoked.add(name);
      assert.equal(response.isError, undefined, `${name}: ${JSON.stringify(response)}`);
      assert.deepEqual(response.structuredContent, expected, name);
      assert.deepEqual(response.content, [{ type: "text", text: JSON.stringify(expected) }], name);
      const validate = validators.get(name)!;
      assert.equal(validate(response.structuredContent), true, `${name}: ${ajv.errorsText(validate.errors)}`);
      assert.deepEqual(MCP_OUTPUT_SCHEMAS[name].parse(response.structuredContent), expected, name);
      assert.deepEqual(
        calls,
        [
          ...(name === "submitEvidence" ? [{ method: "taskContext", args: [taskId] }] : []),
          ...args.map((args) => ({ method: cases[name].method, args })),
        ],
        name,
      );
    };
    for (const name of Object.keys(cases) as ToolName[]) await check(name, fixtures[name]);
    assert.deepEqual([...invoked].sort(), names);
    for (const tool of tools) {
      assert.ok(tool.inputSchema.properties?.workspace, tool.name);
      assert.ok(tool.inputSchema.required?.includes("workspace"), tool.name);
      const response = await client.callTool({ name: tool.name, arguments: cases[tool.name as ToolName].input });
      assert.equal(response.isError, true, tool.name);
    }
    for (const [name, value] of validVariants) {
      if (name === "stageArtifact") continue;
      responses[name] = value;
      await check(name, value);
      responses[name] = fixtures[name];
    }
    const secondOutput = { kind: "architecture", value: {} };
    const outputs = [output, secondOutput];
    await check("stageArtifact", { artifacts: [staged] }, { taskId, outputs: [output] });
    await check(
      "stageArtifact",
      { artifacts: [staged, staged] },
      { taskId, outputs },
      outputs.map((value) => [taskId, value]),
    );
    responses.validateTask = { valid: true, taskId, staged };
    await check("validateTask", responses.validateTask, { taskId, ...output }, [[taskId, output]]);
    await check(
      "validateTask",
      { valid: true, taskId, staged: [staged, staged] },
      { taskId, outputs },
      outputs.map((value) => [taskId, value]),
    );
    responses.validateTask = { valid: true, taskId, staged: [staged] };
    await check(
      "validateTask",
      { valid: true, taskId, staged: [staged, staged] },
      { taskId, outputs },
      outputs.map((value) => [taskId, value]),
    );
    responses.validateTask = fixtures.validateTask;
    await check("validateTask", { valid: true, taskId, staged: [] }, { taskId, outputs: [output] }, [[taskId, output]]);
    const secret = "private-token /workspace/private-file.json provider-debug-details";
    for (const [error, code, message] of [
      [new Error(secret), "APEX_INTERNAL", "APEX could not complete the operation."],
      [
        new ApexError("APEX_STALE", secret, EXIT_CODES.stale),
        "APEX_STALE",
        "Task is stale or expired; refresh status before retrying.",
      ],
    ] as const) {
      invoked.clear();
      for (const name of Object.keys(cases) as ToolName[]) {
        calls.length = 0;
        failure = { method: cases[name].method, error };
        const response = await client.callTool({ name, arguments: { workspace, ...cases[name].input } });
        invoked.add(name);
        const expected = { error: { code, message, remediation: remediationForApexError(normalizeError(error)) } };
        assert.equal(response.isError, true, name);
        assert.deepEqual(response.structuredContent, expected, name);
        assert.deepEqual(response.content, [{ type: "text", text: JSON.stringify(expected) }], name);
        assert.equal(JSON.stringify(response).includes(secret), false, name);
        assert.equal(validators.get(name)!(response.structuredContent), true, name);
        assert.deepEqual(MCP_OUTPUT_SCHEMAS[name].parse(response.structuredContent), expected, name);
        assert.deepEqual(
          calls,
          [
            ...(name === "submitEvidence" ? [{ method: "taskContext", args: [taskId] }] : []),
            { method: cases[name].method, args: cases[name].args },
          ],
          name,
        );
      }
      assert.deepEqual([...invoked].sort(), names);
    }
    failure = undefined;
    for (const [name, input] of [
      ...Object.entries(cases)
        .filter(([, { input }]) => Object.keys(input).length === 0)
        .map(([name]) => [name, { workspace, unexpected: true }]),
      ["gateDecide", { workspace, gate: 4, decision: "approved", confirm: true }],
    ] as Array<[ToolName, Record<string, unknown>]>) {
      calls.length = 0;
      const response = await client.callTool({ name, arguments: input });
      assert.equal(response.isError, true, name);
      const { error } = response.structuredContent as { error: { code: string; message: string } };
      assert.equal(error.code, "APEX_VALIDATION", name);
      assert.match(error.message, /^Invalid tool arguments: \/\S* /u, name);
      assert.equal(validators.get(name)!(response.structuredContent), true, name);
      assert.deepEqual(calls, [], name);
    }
  } finally {
    await close();
  }
});

test("SDK publishes and enforces all result contracts while bypassing error results", async () => {
  const server = new McpServer({ name: "output-contracts", version: "1.0.0" });
  const responses = { ...fixtures };
  let isError = false;
  for (const name of Object.keys(MCP_OUTPUT_SCHEMAS) as ToolName[]) {
    server.registerTool(name, { outputSchema: MCP_OUTPUT_SCHEMAS[name] }, async () => ({
      content: [{ type: "text", text: JSON.stringify(responses[name]) }],
      structuredContent: responses[name],
      ...(isError ? { isError: true } : {}),
    }));
  }
  const { client, close } = await connectMcpFactory(() => server, "output-consumer");
  try {
    const { tools } = await client.listTools();
    // The v2 SDK McpServer publishes zod schemas as JSON Schema 2020-12.
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    ajv.addFormat("date-time", (value: string) => Number.isFinite(Date.parse(value)));
    const validators = new Map(
      tools.map((tool) => {
        assert.equal(tool.outputSchema?.type, "object", tool.name);
        assert.equal(tool.outputSchema.additionalProperties, false, tool.name);
        assert.ok(MCP_OUTPUT_SCHEMAS[tool.name as ToolName] instanceof z.ZodObject);
        return [tool.name, ajv.compile(tool.outputSchema as Record<string, unknown>)];
      }),
    );
    for (const [name, value] of [...Object.entries(fixtures), ...validVariants] as Array<
      [ToolName, Record<string, unknown>]
    >) {
      responses[name] = value;
      const validate = validators.get(name)!;
      assert.equal(validate(value), true, `${name}: ${ajv.errorsText(validate.errors)}`);
      assert.deepEqual(MCP_OUTPUT_SCHEMAS[name].parse(value), value, name);
      const response = await client.callTool({ name });
      assert.equal(response.isError, undefined, `${name}: ${JSON.stringify(response)}`);
      assert.deepEqual(response.structuredContent, value, name);
    }
    for (const [name, value] of [
      ...Object.entries(fixtures).map(([name, value]) => [name, { ...value, unexpected: true }]),
      ...invalidVariants,
    ] as Array<[ToolName, Record<string, unknown>]>) {
      responses[name] = value;
      assert.equal(validators.get(name)!(value), false, `${name}: wire schema accepted invalid output`);
      assert.equal(MCP_OUTPUT_SCHEMAS[name].safeParse(value).success, false, name);
      assert.equal((await client.callTool({ name })).isError, true, name);
    }
    isError = true;
    responses.status = {
      error: {
        code: "APEX_STALE",
        message: "Task is stale",
        remediation:
          "Call status to refresh state and use the latest expected head, epoch, task, or cursor before retrying.",
      },
    };
    const error = await client.callTool({ name: "status" });
    assert.equal(error.isError, true);
    assert.deepEqual(error.structuredContent, responses.status);
  } finally {
    await close();
  }
});

test("schemas accept real offline service results through requirements completion", async () => {
  const service = new ApexService(await tempRoot(), {
    executableChecker: async () => false,
    azureAuthStatus: async () => ({ authenticated: false, detail: "Offline test" }),
  });
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const check = (name: ToolName, value: unknown) => assert.deepEqual(MCP_OUTPUT_SCHEMAS[name].parse(value), value);
  check("status", await service.status());
  check("nextTask", await service.nextTask());
  check("capabilityList", { packs: await service.capabilityList() });
  check("projectList", { projects: await service.listProjects() });
  check("doctor", summarizeDoctorReport(await service.doctor()));
  const next = await nextTaskAfterInput(service);
  check("nextTask", next);
  assert.equal(next.status, "task");
  const taskId = next.task.taskId;
  check("taskContext", await service.taskContext(taskId));
  check("readTaskInput", await service.readTaskInput(taskId));
  const output = { kind: "requirements" as const, value: requirements() };
  check("stageArtifact", await service.stageArtifact(taskId, output));
  check("validateTask", await service.validateTask(taskId));
  check("validateTask", await service.validateTask(taskId, output));
  check("validateTask", await service.validateTask(taskId, [output]));
  check("requirementsComplete", await service.completeRequirements(taskId, output.value));
});

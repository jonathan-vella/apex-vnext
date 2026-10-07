import { Server, type CallToolResult, type Tool } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { ApexService, SUPPORTED_ARTIFACT_KINDS } from "./service.js";
import { APEX_VERSION } from "./version.js";
import { ApexError, EXIT_CODES, normalizeError, remediationForApexError, type ApexErrorCode } from "./errors.js";
import { SECRET_VALUE_PATTERN } from "@apexops/contracts";
import { MCP_OUTPUT_SCHEMAS } from "./mcp-output-schemas.js";
import { TARGET_SCOPE_HINT, TARGET_SCOPE_PATTERN } from "./target-scope.js";
import { resolveMcpWorkspace } from "./workspace-root.js";

const errorMessages: Record<ApexErrorCode, string> = {
  APEX_USAGE: "Invalid operation arguments; check the tool input contract.",
  APEX_NOT_FOUND: "Requested APEX state was not found; refresh status and check the identifier.",
  APEX_CONFLICT: "The operation conflicts with current state; refresh status before retrying.",
  APEX_WRITER_CONFLICT: "Another worktree owns this run's writer lease; retry from that worktree or release the lease.",
  APEX_WORKSPACE_UNSUPPORTED:
    "The workspace path cannot be resolved to a supported APEX checkout; use a non-bare checkout or worktree.",
  APEX_VALIDATION: "APEX validation failed; check the supplied input against the current task contract.",
  APEX_STALE: "Task is stale or expired; refresh status before retrying.",
  APEX_AUTHORIZATION:
    "Operation is not authorized in the current workflow state; check status and approval requirements.",
  APEX_CURSOR_INVALID: "Cursor is invalid for this tool, workspace, or server session.",
  APEX_RESULT_TOO_LARGE: "MCP result exceeded the bounded result size and cannot be paged safely.",
  APEX_INTERNAL: "APEX could not complete the operation.",
};

export const MCP_SERVER_INSTRUCTIONS = [
  "APEX is a governed Azure workload lifecycle server; the kernel owns state, gates, authorization, and evidence.",
  "Every tool call must include workspace as an absolute checkout or git worktree path.",
  "Call status first, then use returned task, run, expected head, and owner epoch values exactly.",
  "Do not retry mutations blindly after timeout, cancellation, or conflict; refresh status and confirm intent first.",
  "Use ask_user for human approvals, risk decisions, missing inputs, and any choice the kernel requires.",
  "Large read results may include nextCursor; call the same tool with the same workspace and cursor until it is absent.",
].join(" ");

export const MCP_MAX_SERIALIZED_RESULT_BYTES = 64 * 1024;

const cursorInput = z.string().min(1).max(4096).optional();

const pagePaths: Partial<Record<keyof typeof MCP_OUTPUT_SCHEMAS, readonly string[]>> = {
  taskContext: ["inputs"],
  readTaskInput: ["content"],
  projectList: ["projects"],
  preview: ["markdown"],
  inventory: ["resources"],
  improvementObservations: ["observations"],
  improvementProposals: ["proposals"],
  render: ["markdown"],
};

type CursorPayload = {
  v: 1;
  tool: string;
  workspace: string;
  hash: string;
  path: string[];
  offset: number;
};

export interface McpServiceResolver {
  defaultService: ApexService;
  resolve(workspace: string): Promise<{ service: ApexService; workspace: string }>;
}

function serviceResolver(serviceOrResolver: ApexService | McpServiceResolver): McpServiceResolver {
  if (
    typeof (serviceOrResolver as McpServiceResolver).resolve === "function" &&
    (serviceOrResolver as McpServiceResolver).defaultService !== undefined
  ) {
    return serviceOrResolver as McpServiceResolver;
  }
  const service = serviceOrResolver as ApexService;
  return {
    defaultService: service,
    resolve: async (workspace) => {
      const resolved = await resolveMcpWorkspace(workspace);
      const serviceRoot = await realpath(service.root);
      const requestedRoot = resolve(resolved.root);
      const boundRoot = resolve(serviceRoot);
      const matches =
        process.platform === "win32"
          ? requestedRoot.toLocaleLowerCase() === boundRoot.toLocaleLowerCase()
          : requestedRoot === boundRoot;
      if (!matches) {
        throw new ApexError(
          "APEX_WORKSPACE_UNSUPPORTED",
          `Workspace ${resolved.workspace} resolves to ${requestedRoot}, but this MCP server is bound to ${boundRoot}; start the server with a workspace-aware service resolver for multi-worktree use`,
          EXIT_CODES.validation,
        );
      }
      return { service, workspace: resolved.workspace };
    },
  };
}

const workspaceInput = z.string().superRefine((workspace, context) => {
  if (!isAbsolute(workspace)) {
    context.addIssue({ code: "custom", message: "workspace must be an absolute path" });
    return;
  }
  try {
    if (!lstatSync(workspace).isDirectory()) {
      context.addIssue({ code: "custom", message: "workspace must be an existing directory" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "workspace must be an existing directory" });
  }
});

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

const resultEnvelopeBytes = (structuredContent: Record<string, unknown>) => {
  const text = JSON.stringify(structuredContent);
  return Buffer.byteLength(
    JSON.stringify({
      content: [{ type: "text", text }],
      structuredContent,
    }),
    "utf8",
  );
};
const resultHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function cursorError(message: string): ApexError {
  return new ApexError("APEX_CURSOR_INVALID", message, EXIT_CODES.validation);
}

function tooLargeError(tool: string): ApexError {
  return new ApexError(
    "APEX_RESULT_TOO_LARGE",
    `${tool} returned more than ${MCP_MAX_SERIALIZED_RESULT_BYTES} serialized bytes and no safe page fits`,
    EXIT_CODES.validation,
  );
}

function encodeCursor(secret: Buffer, payload: CursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function decodeBase64urlCursorPart(value: string, part: string): Buffer {
  if (value === "" || !/^[A-Za-z0-9_-]+$/u.test(value)) throw cursorError(`Malformed cursor ${part}`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw cursorError(`Non-canonical cursor ${part}`);
  return decoded;
}

function decodeCursor(secret: Buffer, cursor: string): CursorPayload {
  const [body, mac, extra] = cursor.split(".");
  if (body === undefined || mac === undefined || extra !== undefined) throw cursorError("Malformed cursor");
  const rawBody = decodeBase64urlCursorPart(body, "payload");
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = decodeBase64urlCursorPart(mac, "signature");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw cursorError("Tampered cursor");
  let decoded: CursorPayload;
  try {
    decoded = JSON.parse(rawBody.toString("utf8")) as CursorPayload;
  } catch {
    throw cursorError("Malformed cursor payload");
  }
  if (
    decoded === null ||
    decoded.v !== 1 ||
    typeof decoded.tool !== "string" ||
    typeof decoded.workspace !== "string" ||
    !/^[0-9a-f]{64}$/u.test(decoded.hash) ||
    !Array.isArray(decoded.path) ||
    decoded.path.some((entry) => typeof entry !== "string") ||
    !Number.isSafeInteger(decoded.offset) ||
    decoded.offset < 0
  ) {
    throw cursorError("Invalid cursor payload");
  }
  return decoded;
}

function getPageTarget(value: Record<string, unknown>, path: readonly string[]): unknown {
  let target: unknown = value;
  for (const segment of path) {
    if (target === null || typeof target !== "object" || Array.isArray(target)) return undefined;
    target = (target as Record<string, unknown>)[segment];
  }
  return target;
}

function withPageTarget(
  value: Record<string, unknown>,
  path: readonly string[],
  page: string | unknown[],
): Record<string, unknown> {
  const copy = structuredClone(value) as Record<string, unknown>;
  let target: Record<string, unknown> = copy;
  for (const segment of path.slice(0, -1)) target = target[segment] as Record<string, unknown>;
  target[path.at(-1)!] = page;
  return copy;
}

function applyResultPaging(
  secret: Buffer,
  tool: string,
  workspace: string,
  input: Record<string, unknown>,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const path = pagePaths[tool as keyof typeof MCP_OUTPUT_SCHEMAS];
  const cursor = input.cursor;
  if (cursor !== undefined && typeof cursor !== "string") throw cursorError("Cursor must be a string");
  if (path === undefined) {
    if (cursor !== undefined) throw cursorError("Tool does not accept cursors");
    if (resultEnvelopeBytes(value) > MCP_MAX_SERIALIZED_RESULT_BYTES) throw tooLargeError(tool);
    return value;
  }
  if (cursor === undefined && resultEnvelopeBytes(value) <= MCP_MAX_SERIALIZED_RESULT_BYTES) return value;
  const hash = resultHash(value);
  const payload =
    cursor === undefined
      ? { v: 1 as const, tool, workspace, hash, path: [...path], offset: 0 }
      : decodeCursor(secret, cursor);
  if (payload.tool !== tool || payload.workspace !== workspace || payload.path.join("/") !== path.join("/")) {
    throw cursorError("Cursor belongs to a different tool, workspace, or result path");
  }
  if (payload.hash !== hash) {
    throw new ApexError(
      "APEX_STALE",
      "Cursor result state changed before paging completed",
      EXIT_CODES.stale,
      undefined,
    );
  }
  const target = getPageTarget(value, path);
  if (typeof target !== "string" && !Array.isArray(target)) throw tooLargeError(tool);
  const total = target.length;
  if (total === 0) throw tooLargeError(tool);
  if (payload.offset >= total) throw cursorError("Cursor offset is outside the current result");
  let best: Record<string, unknown> | undefined;
  let low = 1;
  let high = total - payload.offset;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const end = payload.offset + count;
    const page = typeof target === "string" ? target.slice(payload.offset, end) : target.slice(payload.offset, end);
    const nextCursor = end < total ? encodeCursor(secret, { ...payload, offset: end }) : undefined;
    const candidate = {
      ...withPageTarget(value, path, page),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
    if (resultEnvelopeBytes(candidate) <= MCP_MAX_SERIALIZED_RESULT_BYTES) {
      best = candidate;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }
  if (best === undefined) throw tooLargeError(tool);
  return best;
}
// One line per failing field: keep the first message per path, then collapse array indexes so repeated mistakes such as
// "/decisionRecords/*/alternatives/*/benefits Expected string" appear once with a count.
function validationIssues(details: Array<{ path?: unknown; message?: unknown }>, limit = 8): string[] {
  const firstByPath = new Map<string, string>();
  for (const { path, message } of details) {
    if (!firstByPath.has(String(path))) firstByPath.set(String(path), String(message));
  }
  const groups = new Map<string, { path: string; message: string; count: number }>();
  for (const [path, message] of firstByPath) {
    const pattern = path.replace(/\/\d+(?=\/|$)/gu, "/*");
    const group = groups.get(`${pattern}\u0000${message}`);
    if (group === undefined) groups.set(`${pattern}\u0000${message}`, { path, message, count: 1 });
    else Object.assign(group, { path: pattern, count: group.count + 1 });
  }
  const lines = [...groups.values()].map(({ path, message, count }) =>
    count === 1 ? `${path} ${message}` : `${path} ${message} (${count} places)`,
  );
  return lines.length > limit ? [...lines.slice(0, limit), `${lines.length - limit} more`] : lines;
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
    findingIds: z.array(z.string().min(1)).default([]),
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
    targetScope: z.string().max(1024).regex(TARGET_SCOPE_PATTERN, `Use ${TARGET_SCOPE_HINT}`),
    iacTool: z.enum(["bicep", "terraform"]),
    riskOwner: z.enum(["partner", "customer"]),
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

type ToolExtra = { signal: AbortSignal };
type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> };
type ToolCallResult = ToolResult & { isError?: true };
type ToolConfig = { description?: string };
type ToolEntry = { definition: Tool; call(args: unknown, signal: AbortSignal): Promise<ToolCallResult> };

export interface McpServerOptions {
  queueTimeoutMs?: number;
}

/**
 * Builds the APEX MCP tool table and shared call state once, and returns a cheap, side-effect-free factory for
 * low-level SDK `Server` instances. Every instance from one factory shares the service resolver, single-slot queue,
 * rate limit, and cursor secret, so per-connection (stdio) and per-request (HTTP) instances behave as one server.
 */
export function createMcpServerFactory(
  serviceOrResolver: ApexService | McpServiceResolver,
  options: McpServerOptions = {},
): () => Server {
  const services = serviceResolver(serviceOrResolver);
  let activeService = services.defaultService;
  const service: ApexService = new Proxy(services.defaultService, {
    get(target, property, receiver) {
      const actual = activeService ?? target;
      const value = Reflect.get(actual, property, receiver);
      return typeof value === "function" ? value.bind(actual) : value;
    },
  });
  const queueTimeoutMs = options.queueTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(queueTimeoutMs) || queueTimeoutMs < 1 || queueTimeoutMs > 30_000)
    throw new Error("Invalid MCP queue timeout");
  // Cursors are only valid for the server process that issued them; a restart invalidates every outstanding cursor.
  const cursorSecret = randomBytes(32);
  const result = (value: unknown): ToolResult => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("MCP success results require an object envelope");
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      structuredContent: value as Record<string, unknown>,
    };
  };
  const tools = new Map<string, ToolEntry>();
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
  function registerTool<Schema extends z.ZodType<Record<string, unknown>>>(
    name: string,
    config: ToolConfig & { inputSchema: Schema },
    callback: (input: z.output<Schema>, extra: ToolExtra) => Promise<ToolResult>,
  ): void;
  function registerTool<Shape extends z.ZodRawShape>(
    name: string,
    config: ToolConfig & { inputSchema: Shape },
    callback: (input: z.output<z.ZodObject<Shape>>, extra: ToolExtra) => Promise<ToolResult>,
  ): void;
  function registerTool(name: string, config: ToolConfig, callback: (extra: ToolExtra) => Promise<ToolResult>): void;
  function registerTool(
    name: string,
    config: ToolConfig & { inputSchema?: z.ZodObject | z.ZodRawShape },
    callback: (...args: never[]) => Promise<ToolResult>,
  ): void {
    if (tools.has(name)) throw new Error(`Duplicate MCP tool ${name}`);
    const outputSchema = MCP_OUTPUT_SCHEMAS[name as keyof typeof MCP_OUTPUT_SCHEMAS];
    if (outputSchema === undefined) throw new Error(`Missing output schema for ${name}`);
    const originalInputSchema =
      config.inputSchema === undefined
        ? z.object({}).strict()
        : config.inputSchema instanceof z.ZodObject
          ? config.inputSchema.strict().meta(config.inputSchema.meta() ?? {})
          : z.object(config.inputSchema as z.ZodRawShape).strict();
    const inputSchema = originalInputSchema
      .extend({ workspace: workspaceInput })
      .strict()
      .meta(originalInputSchema.meta() ?? {});
    const guarded = async (args: unknown, signal: AbortSignal): Promise<ToolCallResult> => {
      const extra: ToolExtra = { signal };
      const checkCancelled = () => {
        if (signal.aborted) throw new ApexError("APEX_CONFLICT", "Cancelled", EXIT_CODES.conflict);
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
        assertBoundedInput(args);
        const input = inputSchema.safeParse(args);
        if (!input.success) {
          const issues = validationIssues(
            input.error.issues.map(({ path, message }) => ({ path: `/${path.map(String).join("/")}`, message })),
          );
          const reason =
            issues.length === 0 ? "Invalid tool arguments" : `Invalid tool arguments: ${issues.join("; ")}`;
          if (!SECRET_VALUE_PATTERN.test(reason)) serviceValidation = reason;
          throw new ApexError("APEX_VALIDATION", "Invalid tool arguments", EXIT_CODES.validation);
        }
        releaseSlot = await acquire(signal);
        checkCancelled();
        const { workspace, ...toolInput } = input.data as { workspace: string } & Record<string, unknown>;
        const resolved = await services.resolve(workspace);
        resolved.service.setWorkspacePath?.(resolved.workspace);
        activeService = resolved.service;
        let response: ToolResult;
        try {
          response = await Reflect.apply(
            callback,
            undefined,
            config.inputSchema === undefined ? [extra] : [toolInput, extra],
          );
        } catch (error) {
          const normalized = normalizeError(error);
          const governance =
            typeof (normalized.details as { reason?: unknown } | undefined)?.reason === "string" &&
            (normalized.details as { reason: string }).reason.startsWith("GOVERNANCE_");
          if (normalized.code === "APEX_VALIDATION" || governance) {
            const issues = validationIssues(
              Array.isArray(normalized.details)
                ? (normalized.details as Array<{ path?: unknown; message?: unknown }>)
                : [],
            );
            const reason = issues.length === 0 ? normalized.message : `${normalized.message}: ${issues.join("; ")}`;
            if (!SECRET_VALUE_PATTERN.test(reason)) serviceValidation = reason;
          }
          if (normalized.code === "APEX_WRITER_CONFLICT" && !SECRET_VALUE_PATTERN.test(normalized.message)) {
            serviceValidation = normalized.message;
          }
          if (normalized.code === "APEX_WORKSPACE_UNSUPPORTED" && !SECRET_VALUE_PATTERN.test(normalized.message)) {
            serviceValidation = normalized.message;
          }
          throw error;
        }
        if (response.structuredContent === undefined) throw new Error("MCP success results require structuredContent");
        response.structuredContent = applyResultPaging(
          cursorSecret,
          name,
          resolved.workspace,
          toolInput,
          response.structuredContent as Record<string, unknown>,
        );
        response.content = [{ type: "text", text: JSON.stringify(response.structuredContent) }];
        assertBoundedInput(response.structuredContent);
        if (!outputSchema.safeParse(response.structuredContent).success) throw new Error("Invalid MCP result contract");
        return response;
      } catch (error) {
        const normalized = normalizeError(error);
        const { code } = normalized;
        if (
          serviceValidation === undefined &&
          (code === "APEX_WRITER_CONFLICT" || code === "APEX_WORKSPACE_UNSUPPORTED") &&
          !SECRET_VALUE_PATTERN.test(normalized.message)
        ) {
          serviceValidation = normalized.message;
        }
        // Input-schema and kernel validation reasons let agents correct typed input; guard, internal and secret-like
        // messages stay generic.
        const message = serviceValidation === undefined ? errorMessages[code] : serviceValidation.slice(0, 2_000);
        return {
          ...result({ error: { code, message, remediation: remediationForApexError(normalized) } }),
          isError: true,
        };
      } finally {
        releaseSlot?.();
      }
    };
    const inputJson = z.toJSONSchema(inputSchema, { target: "draft-7", io: "input" });
    const annotations = {
      readOnlyHint: readOnlyTools.has(name),
      destructiveHint: !readOnlyTools.has(name),
      idempotentHint: readOnlyTools.has(name),
      openWorldHint: externalTools.has(name),
    };
    const definition: Tool = {
      name,
      ...(config.description === undefined ? {} : { description: config.description }),
      inputSchema: inputJson as Tool["inputSchema"],
      outputSchema: z.toJSONSchema(outputSchema, { target: "draft-7" }) as NonNullable<Tool["outputSchema"]>,
      annotations,
    };
    toolDefinitions.push(definition);
    tools.set(name, { definition, call: guarded });
  }
  registerTool("status", { description: "Read selected APEX run status" }, async () =>
    result(await service.workspaceStatus()),
  );
  registerTool(
    "releaseWriter",
    { description: "Release this workspace's writer lease for the selected run." },
    async () => result(await service.releaseWriter()),
  );
  registerTool("capabilityList", { description: "Read capability pack availability" }, async () =>
    result({ packs: await service.capabilityList() }),
  );
  registerTool(
    "capabilityStatus",
    { description: "Read one capability pack status", inputSchema: { pack: z.string() } },
    async ({ pack }) => result(await service.capabilityStatus(pack)),
  );
  registerTool(
    "nextTask",
    {
      description:
        "Advance the workflow by issuing a request or task; this can write state and is not retry-safe. For status=needs_input, collect answers and call recordInput; for status=needs_review, present findings and call reviewDecide with the user's decisions. Only status=task returns a task.taskId for taskContext. Do not poll unresolved input or review results.",
    },
    async () => result(await service.nextTask()),
  );
  registerTool(
    "taskContext",
    {
      description: "Read context only for the exact task.taskId returned by nextTask with status=task.",
      inputSchema: { taskId: z.string(), cursor: cursorInput },
    },
    async ({ taskId }) => result(await service.taskContext(taskId)),
  );
  registerTool(
    "readTaskInput",
    {
      description:
        "Read authoritative UTF-8-bounded task input; inputHash selects an authorized dependency, review-metadata, or governance-findings:<ARM types> for the enforcing policies an Architecture design must map.",
      inputSchema: {
        taskId: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(6_000).optional(),
        cursor: cursorInput,
        inputHash: z
          .union([
            z.string().regex(/^[0-9a-f]{64}$/u),
            z.literal("review-metadata"),
            z.string().regex(/^governance-findings:[A-Za-z0-9./,]{0,2000}$/u),
          ])
          .optional(),
      },
    },
    async ({ taskId, offset, limit, inputHash }) =>
      result(await service.readTaskInput(taskId, offset, limit, inputHash)),
  );
  registerTool(
    "recordInput",
    {
      description: "Record answers for the exact pending kernel input request",
      inputSchema: inputSubmission,
    },
    async (input) => result(await service.recordInput(input)),
  );
  registerTool(
    "governanceImport",
    {
      description:
        "Import governance for the active discovery task: either a reviewed local subscription baseline by path (never its contents) or reference: true for the shipped ALZ Corp reference baseline.",
      inputSchema: { path: z.string().min(1).optional(), reference: z.literal(true).optional() },
    },
    async ({ path, reference }) => {
      if ((path === undefined) === (reference === undefined))
        throw new ApexError("APEX_USAGE", "Provide exactly one of path or reference", EXIT_CODES.usage);
      return result(
        await (path === undefined ? service.importGovernanceReference() : service.importGovernanceBaseline(path)),
      );
    },
  );
  registerTool(
    "governanceSelect",
    {
      description:
        "Prepare or recall the target governance snapshot reuse/refresh question; only a local path is accepted. Does not import or collect Azure policy.",
      inputSchema: { path: z.string().min(1), reopen: z.boolean().optional() },
    },
    async ({ path, reopen }) =>
      result(await service.selectGovernanceBaseline(path, ...(reopen === undefined ? [] : [{ reopen }]))),
  );
  registerTool(
    "projectCreate",
    {
      description:
        "Create and select a new project with its initial environment run. targetScope is the user's explicit choice: local, or a full /subscriptions/<id>/resourceGroups/<name> path.",
      inputSchema: projectCreateInput,
    },
    async (input) => result(await service.createProject(input as Parameters<typeof service.createProject>[0])),
  );
  registerTool(
    "projectList",
    { description: "List projects in the current workspace", inputSchema: { cursor: cursorInput } },
    async () => result({ projects: await service.listProjects() }),
  );
  registerTool(
    "projectUse",
    { description: "Select an existing project and optionally one of its runs", inputSchema: projectUseInput },
    async ({ projectId, runId }) =>
      result(
        await service.use(projectId as Parameters<typeof service.use>[0], runId as Parameters<typeof service.use>[1]),
      ),
  );
  registerTool(
    "projectDelete",
    {
      description: "Delete a project and all of its run-bound state after explicit confirmation",
      inputSchema: projectDeleteInput,
    },
    async ({ projectId, confirm }) =>
      result(await service.deleteProject(projectId as Parameters<typeof service.deleteProject>[0], confirm)),
  );
  registerTool(
    "gateDecide",
    {
      description:
        "Record an explicitly confirmed human decision for Gate 1, 2, or 3 using the local OS username as actor. Gate 4 remains CLI-only.",
      inputSchema: gateDecisionInput,
    },
    async ({ gate, decision }) => result(await service.decideInteractiveGate(gate, decision)),
  );
  registerTool(
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
  registerTool(
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
  registerTool(
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
  registerTool(
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
  registerTool(
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
  registerTool(
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
  registerTool(
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
  registerTool(
    "architectureComplete",
    {
      description:
        "Complete Architecture atomically; APEX derives identity, artifact hashes, top-level requirementTraceability, and cost/SKU bindings. Each SKU and SLO decision lists its component requirementIds. policyMappings maps each governanceFindings entry from task context to a component; APEX marks findings whose resource types match no component resourceTypes not-applicable. A rejection lists every problem across all four inputs.",
      inputSchema: {
        taskId: z.string(),
        architecture: z.unknown(),
        costEstimate: z.unknown(),
        decisionManifest: z.unknown(),
        policyMappings: z.array(z.unknown()),
      },
    },
    async ({ taskId, architecture, costEstimate, decisionManifest, policyMappings }) =>
      result(
        await service.completeArchitecture(
          taskId,
          architecture as Parameters<typeof service.completeArchitecture>[1],
          costEstimate as Parameters<typeof service.completeArchitecture>[2],
          decisionManifest as Parameters<typeof service.completeArchitecture>[3],
          policyMappings as Parameters<typeof service.completeArchitecture>[4],
        ),
      ),
  );
  registerTool(
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
  registerTool(
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
  registerTool(
    "preview",
    { description: "Read the current operator-created deployment preview", inputSchema: { cursor: cursorInput } },
    async () => result({ markdown: await service.currentPreview() }),
  );
  registerTool(
    "reconcile",
    { description: "Run the kernel-authorized reconciliation operation for the selected run." },
    async () => result(await service.reconcile()),
  );
  registerTool(
    "inventory",
    {
      description: "Run the bounded inventory operation for the selected run and return its evidence.",
      inputSchema: { cursor: cursorInput },
    },
    async () => result(await service.inventory()),
  );
  registerTool(
    "diagnose",
    { description: "Run bounded diagnosis for the selected run and return the kernel-recorded result." },
    async () => result(await service.diagnose()),
  );
  registerTool(
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
  registerTool(
    "improvementObservations",
    { description: "Read bounded observations", inputSchema: { cursor: cursorInput } },
    async () => result({ observations: await service.improvementObservations() }),
  );
  registerTool(
    "improvementProposals",
    { description: "Read inert improvement proposals", inputSchema: { cursor: cursorInput } },
    async () => result({ proposals: await service.improvementProposals() }),
  );
  registerTool(
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
        cursor: cursorInput,
      },
    },
    async ({ kind }) => result({ markdown: await service.render(kind) }),
  );
  registerTool(
    "promote",
    {
      description:
        "Promote the selected run to a target environment through kernel checks; does not approve or execute deployment.",
      inputSchema: { environment: z.string(), target: z.string() },
    },
    async ({ environment, target }) => result(await service.promote(environment, target)),
  );
  registerTool(
    "doctor",
    {
      description:
        "Inspect local APEX installation health; request repairs with fix and explicit confirmation with yes.",
      inputSchema: { fix: z.boolean().optional(), yes: z.boolean().optional() },
    },
    async ({ fix, yes }) => result(await service.doctor(fix, yes)),
  );
  registerTool(
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
  // Unknown tool names keep the v1-era externally visible shape (an isError tool result, not a JSON-RPC error), now
  // as the standard APEX error envelope so clients parse one error contract.
  const unknownTool = (name: unknown): ToolCallResult => {
    const label = typeof name === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(name) ? ` ${name}` : "";
    const error = new ApexError(
      "APEX_USAGE",
      `Unknown tool${label}; call tools/list for available tools`,
      EXIT_CODES.usage,
    );
    return {
      ...result({ error: { code: error.code, message: error.message, remediation: remediationForApexError(error) } }),
      isError: true,
    };
  };
  return () => {
    const server = new Server(
      { name: "apex", version: APEX_VERSION },
      { capabilities: { tools: {} }, instructions: MCP_SERVER_INSTRUCTIONS },
    );
    server.setRequestHandler("tools/list", () => ({ tools: toolDefinitions }));
    server.setRequestHandler("tools/call", async (request, ctx) => {
      const tool = tools.get(request.params.name);
      if (tool === undefined) return unknownTool(request.params.name);
      const response = await tool.call(request.params.arguments ?? {}, ctx.mcpReq.signal);
      return server.projectCallToolResult(response as CallToolResult, tool.definition.outputSchema);
    });
    return server;
  };
}

export function createMcpServer(
  serviceOrResolver: ApexService | McpServiceResolver,
  options: McpServerOptions = {},
): Server {
  return createMcpServerFactory(serviceOrResolver, options)();
}

/**
 * Serves APEX over stdio until the connection ends (stdin EOF), the transport fails, or SIGINT/SIGTERM arrives.
 * `serveStdio` answers `server/discover` for protocol 2026-07-28 and, with `legacy: "serve"`, still serves a 2025-era
 * `initialize` (including the discover-then-initialize fallback) from the same factory. Stdout stays protocol-only.
 */
export async function serveMcp(serviceOrResolver: ApexService | McpServiceResolver): Promise<void> {
  const factory = createMcpServerFactory(serviceOrResolver);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let handle: StdioServerHandle | undefined;
    const signals = ["SIGINT", "SIGTERM"] as const;
    const cleanup = () => {
      process.stdin.off("error", fail);
      for (const signal of signals) process.off(signal, shutdown);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) resolve();
      else reject(error);
    };
    const shutdown = () => {
      void (handle?.close() ?? Promise.resolve()).then(() => finish(), finish);
    };
    function fail(error: Error) {
      void (handle?.close() ?? Promise.resolve()).then(
        () => finish(error),
        () => finish(error),
      );
    }
    class ApexStdioTransport extends StdioServerTransport {
      override async close(): Promise<void> {
        await super.close();
        finish();
      }
    }
    process.stdin.once("error", fail);
    for (const signal of signals) process.once(signal, shutdown);
    handle = serveStdio(factory, { legacy: "serve", transport: new ApexStdioTransport() });
  });
}

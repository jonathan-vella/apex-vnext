import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { ReviewCaptureV1Schema, registerContractFormats, type ReviewCaptureV1 } from "@apexops/contracts";
import { Value } from "@sinclair/typebox/value";
import { canonicalJson, sha256Bytes, sha256Text } from "./canonical.js";

/**
 * Captured rubber-duck reviews (DECISION-031). The kernel issues a review request with a single-use nonce and a prompt;
 * the APEX agent passes the prompt unchanged to the built-in `rubber-duck` agent; the managed `postToolUse` hook saves
 * the prompt and rubber-duck's exact output in a signed capture record outside the workspace. The kernel verifies the
 * record, binds it to the issued prompt and the reviewed artifact, and derives findings only from the captured output.
 *
 * The hook (plugin/hooks/apex-hook.mjs) is dependency-free, so it repeats the record format, canonical JSON, HMAC and
 * location rules below; tools/tests/vnext/plugin-hooks.test.mjs keeps both sides aligned.
 */

export const REVIEW_CAPTURE_SCHEMA = "apex-review-capture-v1" as const;
export const REVIEW_REQUEST_HEADER = "APEX-REVIEW";
export const REVIEW_ANSWER_FENCE = "apex-review";
export const REVIEW_AGENT = "rubber-duck";
export const REVIEW_MAX_ATTEMPTS = 2;
export const REVIEW_HOME_ENV = "APEX_REVIEW_HOME";
export const REVIEW_MAX_FINDINGS = 50;
/**
 * Budget for all finding titles and details together, measured as doubly JSON-escaped UTF-8 because an MCP result
 * carries its JSON once as structured content and once as escaped text. nextTask returns every open finding in one
 * result capped at 64 KiB, so the findings must fit there with their IDs and actions.
 */
export const REVIEW_MAX_FINDINGS_BYTES = 20_480;

const NONCE_PATTERN = /^[0-9a-f]{32}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FINDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const PILLARS = [
  "security",
  "reliability",
  "performance-efficiency",
  "cost-optimization",
  "operational-excellence",
] as const;
const OUTCOMES = ["pass", "finding", "not-applicable"] as const;
const TASK_TOOLS = new Set(["task", "Task", "Agent"]);
const MAX_CAPTURE_BYTES = 1024 * 1024;

export type ReviewCaptureFailure =
  | "missing"
  | "ambiguous"
  | "malformed"
  | "signature"
  | "not-rubber-duck"
  | "nonce-mismatch"
  | "prompt-mismatch"
  | "unparseable"
  | "inputs-changed";

/** A capture problem. Every reason fails the review closed; only `missing` leaves the request reusable. */
export class ReviewCaptureError extends Error {
  readonly reason: ReviewCaptureFailure;

  constructor(reason: ReviewCaptureFailure, message: string) {
    super(message);
    this.name = "ReviewCaptureError";
    this.reason = reason;
  }
}

/**
 * The review home (or a folder in it) is not private to this OS user: another user could replace the capture key or
 * inject captures, so nothing in it can be trusted until its owner and mode are fixed.
 */
export class ReviewHomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewHomeError";
  }
}

export type ReviewSeverity = (typeof SEVERITIES)[number];
export type ReviewPillar = (typeof PILLARS)[number];

export type ReviewCaptureRecordV1 = ReviewCaptureV1;

export interface ReviewAnswer {
  findings: Array<{ id: string; severity: ReviewSeverity; title: string; detail: string }>;
  criteria?: Array<{
    criterionId: ReviewPillar;
    outcome: (typeof OUTCOMES)[number];
    rationale: string;
    findingIds: string[];
  }>;
}

export interface ReviewPromptFile {
  label: "instructions" | "subject" | "input";
  kind: string;
  path: string;
  sha256: string;
}

export interface ReviewPromptRequest {
  nonce: string;
  gate: number;
  subjectKind: string;
  files: readonly ReviewPromptFile[];
  wellArchitected: boolean;
}

/** A fresh nonce, or one derived from a unique seed (the service's ID source) so deterministic runs stay reproducible. */
export function createReviewNonce(seed?: string): string {
  return seed === undefined ? randomBytes(16).toString("hex") : sha256Text(`apex-review-nonce\0${seed}`).slice(0, 32);
}

/** Line endings and trailing whitespace do not change a prompt's identity; every other byte does. */
export function normalizeReviewPrompt(prompt: string): string {
  return prompt
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n+$/u, "");
}

export function reviewPromptSha256(prompt: string): string {
  return sha256Text(normalizeReviewPrompt(prompt));
}

/** The nonce from the first non-empty prompt line `APEX-REVIEW: nonce=<32 hex>`, or undefined. */
export function reviewNonceFromPrompt(prompt: string): string | undefined {
  const first = prompt
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .find((line) => line.trim().length > 0);
  const match = /^APEX-REVIEW:\s+nonce=([0-9a-f]{32})\s*$/u.exec(first?.trim() ?? "");
  return match?.[1];
}

export function buildReviewPrompt(request: ReviewPromptRequest): string {
  if (!NONCE_PATTERN.test(request.nonce)) throw new TypeError("Review nonce must be 32 lowercase hex characters");
  if (request.files.filter(({ label }) => label === "subject").length !== 1)
    throw new TypeError("Review prompt needs exactly one subject file");
  for (const file of request.files) {
    if (!isAbsolute(file.path) || /[\r\n]/u.test(file.path)) throw new TypeError("Review files need absolute paths");
    if (!SHA256_PATTERN.test(file.sha256)) throw new TypeError("Review file hashes must be SHA-256");
  }
  const shape = request.wellArchitected
    ? '{"findings":[{"id":"F-1","severity":"high","title":"...","detail":"..."}],"criteria":[{"criterionId":"security","outcome":"finding","rationale":"...","findingIds":["F-1"]}]}'
    : '{"findings":[{"id":"F-1","severity":"high","title":"...","detail":"..."}]}';
  return [
    `${REVIEW_REQUEST_HEADER}: nonce=${request.nonce}`,
    "",
    `Review the APEX ${request.subjectKind} artifact for Gate ${request.gate} as an independent critic.`,
    "Only read files. Do not call APEX tools, edit files, run commands or ask the user.",
    "",
    "Read these files with the view tool. Each sha256 is the hash of the file content.",
    ...request.files.map((file) => `- ${file.label} (${file.kind}): ${file.path} sha256=${file.sha256}`),
    "",
    "Follow the instructions file. Reply with exactly one fenced code block whose info string is",
    `${REVIEW_ANSWER_FENCE} and whose content is one JSON object in this shape:`,
    shape,
    `severity is one of ${SEVERITIES.join(", ")}. Use "findings": [] when there are no problems.`,
    `Report at most ${REVIEW_MAX_FINDINGS} findings and keep all titles and details together under ` +
      `${Math.floor(REVIEW_MAX_FINDINGS_BYTES / 2048)} KB; merge related problems.`,
    ...(request.wellArchitected
      ? [
          `Give exactly one criteria entry for each pillar: ${PILLARS.join(", ")}.`,
          `outcome is one of ${OUTCOMES.join(", ")}.`,
        ]
      : []),
  ].join("\n");
}

/** Reviewer guidance per subject, carried over from the retired APEX Reviewer. */
export function buildReviewInstructions(subjectKind: string): string {
  const common = [
    "# APEX rubber-duck review",
    "",
    "Run an adversarial, evidence-linked review of the subject file. Use the input files only as evidence.",
    "Test completeness, contradictions, traceability, evidence freshness, security and governance, reliability and",
    "operations, and cost and scale. Return one finding per real issue with a concise title and a detail that states",
    "the evidence, the impact and a concrete remediation. Do not manufacture findings to fill a quota.",
    "",
    "Missing or unverified performance or scale targets, measurement boundaries or feasibility are validated later.",
    "Report at most one info finding titled `Check later: performance and scale validation` for them, never a higher",
    "severity. Availability and recovery targets, including RTO and RPO, are real findings when missing, contradictory",
    "or infeasible.",
  ];
  const specific: Record<string, string[]> = {
    requirements: [
      "",
      "## Requirements",
      "",
      "Missing named owners, latency measurement details, access, ingress and DNS design details, and GDPR lifecycle",
      "planning are advisory when documented as proposed recommendations; do not report blocking findings or owner",
      "assignment requests only because those recommendations are unconfirmed. Concrete contradictions, violated",
      "Azure Policy constraints, required security decisions and missing stage-required evidence remain findings.",
    ],
    architecture: [
      "",
      "## Architecture",
      "",
      "Assume regional and zonal support, quota, deployment feasibility, restore and failover checks are non-issues.",
      "Explicit partial pricing is valid cost documentation. APEX builds the hosting platform: application",
      "functionality such as business workflows, approval paths or application data-lifecycle rules is out of scope.",
      "Check the policy map: each enforcing finding maps to a component with a plausible property and disposition,",
      "`blocked` rows are findings, and every `not-applicable` reason is consistent with the design.",
      "",
      "Return one criteria entry for each Well-Architected pillar. Link `finding` outcomes to finding IDs, explain every",
      "`pass` or `not-applicable` outcome, and use `not-applicable` only where the accepted assessment says so.",
    ],
    plan: [
      "",
      "## Implementation plan",
      "",
      "Check that the implementation intent, IaC binding and environment inputs cover every accepted architecture",
      "component, that dependencies are acyclic and that governance and policy obligations carry into the plan.",
    ],
  };
  return [...common, ...(specific[subjectKind] ?? []), ""].join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max)
    throw new ReviewCaptureError("unparseable", `Review answer ${field} must be text of 1 to ${max} characters`);
  return value.trim();
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    throw new ReviewCaptureError("unparseable", `Review answer ${field} has unsupported fields: ${unknown.join(", ")}`);
}

/**
 * Derives findings from rubber-duck's captured output: exactly one ```apex-review fenced JSON block, checked strictly.
 * Text outside the block is ignored. Findings without an id get F-1, F-2, ... in answer order.
 */
export function parseReviewAnswer(response: string, options: { wellArchitected: boolean }): ReviewAnswer {
  const fence = /^[ \t]*(`{3,}|~{3,})[ \t]*apex-review[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*$/gmu;
  const blocks = [...response.matchAll(fence)];
  if (blocks.length !== 1)
    throw new ReviewCaptureError(
      "unparseable",
      `Review answer must contain exactly one ${REVIEW_ANSWER_FENCE} block; found ${blocks.length}`,
    );
  let value: unknown;
  try {
    value = JSON.parse(blocks[0]![2]!);
  } catch (error) {
    throw new ReviewCaptureError("unparseable", `Review answer JSON is invalid: ${(error as Error).message}`);
  }
  if (!isPlainObject(value)) throw new ReviewCaptureError("unparseable", "Review answer must be a JSON object");
  exactKeys(value, options.wellArchitected ? ["findings", "criteria"] : ["findings"], "object");
  if (!Array.isArray(value.findings) || value.findings.length > REVIEW_MAX_FINDINGS)
    throw new ReviewCaptureError(
      "unparseable",
      `Review answer findings must be an array of at most ${REVIEW_MAX_FINDINGS}`,
    );
  const findings = value.findings.map((finding, index) => {
    if (!isPlainObject(finding)) throw new ReviewCaptureError("unparseable", "Each review finding must be an object");
    exactKeys(finding, ["id", "severity", "title", "detail"], `finding ${index + 1}`);
    const id = finding.id === undefined ? `F-${index + 1}` : finding.id;
    if (typeof id !== "string" || !FINDING_ID_PATTERN.test(id))
      throw new ReviewCaptureError("unparseable", `Review finding ${index + 1} has an invalid id`);
    if (!SEVERITIES.includes(finding.severity as ReviewSeverity))
      throw new ReviewCaptureError(
        "unparseable",
        `Review finding ${id} severity must be one of ${SEVERITIES.join(", ")}`,
      );
    return {
      id,
      severity: finding.severity as ReviewSeverity,
      title: boundedText(finding.title, `finding ${id} title`, 300),
      detail: boundedText(finding.detail, `finding ${id} detail`, 8_000),
    };
  });
  const findingBytes = findings.reduce(
    (total, { title, detail }) => total + Buffer.byteLength(JSON.stringify(JSON.stringify([title, detail]))),
    0,
  );
  if (findingBytes > REVIEW_MAX_FINDINGS_BYTES)
    throw new ReviewCaptureError(
      "unparseable",
      `Review findings use ${findingBytes} bytes of titles and details; the limit is ${REVIEW_MAX_FINDINGS_BYTES}`,
    );
  const ids = findings.map(({ id }) => id);
  if (new Set(ids).size !== ids.length)
    throw new ReviewCaptureError("unparseable", "Review finding ids must be unique");
  if (!options.wellArchitected) return { findings };
  if (!Array.isArray(value.criteria) || value.criteria.length !== PILLARS.length)
    throw new ReviewCaptureError("unparseable", "Review answer criteria must cover the five Well-Architected pillars");
  const criteria = value.criteria.map((criterion) => {
    if (!isPlainObject(criterion)) throw new ReviewCaptureError("unparseable", "Each criteria entry must be an object");
    exactKeys(criterion, ["criterionId", "outcome", "rationale", "findingIds"], "criteria entry");
    if (!PILLARS.includes(criterion.criterionId as ReviewPillar))
      throw new ReviewCaptureError("unparseable", `Criteria entry pillar must be one of ${PILLARS.join(", ")}`);
    if (!OUTCOMES.includes(criterion.outcome as (typeof OUTCOMES)[number]))
      throw new ReviewCaptureError("unparseable", `Criteria outcome must be one of ${OUTCOMES.join(", ")}`);
    const findingIds = criterion.findingIds ?? [];
    if (
      !Array.isArray(findingIds) ||
      findingIds.some((id) => typeof id !== "string" || !ids.includes(id)) ||
      new Set(findingIds).size !== findingIds.length
    )
      throw new ReviewCaptureError("unparseable", `Criteria ${String(criterion.criterionId)} links unknown findings`);
    if (criterion.outcome !== "finding" && findingIds.length > 0)
      throw new ReviewCaptureError(
        "unparseable",
        `Criteria ${String(criterion.criterionId)} links findings, which only a finding outcome may do`,
      );
    return {
      criterionId: criterion.criterionId as ReviewPillar,
      outcome: criterion.outcome as (typeof OUTCOMES)[number],
      rationale: boundedText(criterion.rationale, `criteria ${String(criterion.criterionId)} rationale`, 4_000),
      findingIds: findingIds as string[],
    };
  });
  if (new Set(criteria.map(({ criterionId }) => criterionId)).size !== PILLARS.length)
    throw new ReviewCaptureError("unparseable", "Review answer criteria must name each pillar once");
  return { findings, criteria };
}

/** Folder shared by the hook and the kernel: `$APEX_REVIEW_HOME`, else `~/.apex/reviews`. Outside every workspace. */
export function reviewHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[REVIEW_HOME_ENV];
  if (configured !== undefined && configured.length > 0) {
    if (!isAbsolute(configured)) throw new Error(`${REVIEW_HOME_ENV} must be an absolute path`);
    return resolve(configured);
  }
  return join(homedir(), ".apex", "reviews");
}

async function plainDirectory(path: string, create: boolean): Promise<boolean> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (stat === undefined) {
    if (!create) return false;
    await mkdir(path, { recursive: true, mode: 0o700 });
    return plainDirectory(path, false);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Review folder is not a plain directory: ${path}`);
  if (process.platform !== "win32" && typeof process.getuid === "function") {
    if (stat.uid !== process.getuid())
      throw new ReviewHomeError(`Review folder is owned by another user: ${path}; it must belong to you`);
    if ((stat.mode & 0o022) !== 0)
      throw new ReviewHomeError(`Review folder is writable by other users: ${path}; run chmod 700 on it`);
  }
  return true;
}

/** Captures older than this belong to requests that expired (tasks live 24 hours) and can never be ingested. */
export const REVIEW_CAPTURE_RETENTION_MS = 48 * 60 * 60 * 1000;

/**
 * Removes captures whose request can no longer be ingested, so abandoned reviews do not keep model output in the
 * shared review home forever. Captures for live requests are younger than the retention and stay. Returns the count.
 */
export async function sweepReviewCaptures(
  home = reviewHome(),
  now = Date.now(),
  maxAgeMs = REVIEW_CAPTURE_RETENTION_MS,
): Promise<number> {
  const directory = join(home, "captures");
  if (!(await plainDirectory(home, false)) || !(await plainDirectory(directory, false))) return 0;
  let removed = 0;
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".json")) continue;
    const path = join(directory, name);
    const info = await lstat(path).catch(() => undefined);
    if (info === undefined || !info.isFile() || now - info.mtimeMs <= maxAgeMs) continue;
    await rm(path, { force: true });
    removed += 1;
  }
  return removed;
}

async function readRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Not a bounded regular file: ${path}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** The per-user HMAC key (32 random bytes, hex) shared with the hook; created with 0600 permissions when absent. */
export async function reviewCaptureKey(home = reviewHome()): Promise<Buffer> {
  await plainDirectory(home, true);
  const path = join(home, "capture.key");
  // Publish a fully written key through a hard link, which never replaces an existing key: the first writer wins and
  // no reader can see an empty or partial key. The hook uses the same protocol.
  const temporary = join(home, `.${randomBytes(8).toString("hex")}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${randomBytes(32).toString("hex")}\n`);
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Review capture key is not a regular file: ${path}`);
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    throw new Error(`Review capture key permissions must be 0600: ${path}`);
  const text = (await readRegularFile(path, 1024)).toString("utf8").trim();
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new Error(`Review capture key is malformed: ${path}`);
  return Buffer.from(text, "hex");
}

type UnsignedCapture = Omit<ReviewCaptureRecordV1, "signature">;

export function reviewCaptureSignature(record: UnsignedCapture, key: Buffer): string {
  return createHmac("sha256", key).update(canonicalJson(record)).digest("hex");
}

/** Builds a signed record exactly as the hook does. Used by tests and the hook parity check. */
export function signReviewCapture(
  input: {
    prompt: string;
    response: string;
    sessionId?: string | null;
    toolName?: string;
    agentType?: string;
    capturedAt: string;
  },
  key: Buffer,
): ReviewCaptureRecordV1 {
  const nonce = reviewNonceFromPrompt(input.prompt);
  if (nonce === undefined) throw new TypeError("Review prompt has no APEX-REVIEW nonce");
  const record: UnsignedCapture = {
    schema: REVIEW_CAPTURE_SCHEMA,
    nonce,
    sessionId: input.sessionId ?? null,
    toolName: input.toolName ?? "task",
    agentType: input.agentType ?? REVIEW_AGENT,
    prompt: input.prompt,
    requestSha256: sha256Text(input.prompt),
    response: input.response,
    responseSha256: sha256Text(input.response),
    capturedAt: input.capturedAt,
  };
  return { ...record, signature: reviewCaptureSignature(record, key) };
}

export function reviewCaptureFileName(record: Pick<ReviewCaptureRecordV1, "nonce" | "responseSha256">): string {
  return `${record.nonce}-${record.responseSha256.slice(0, 16)}.json`;
}

/** Checks one record's shape, signature, hashes and rubber-duck origin. Does not check the issued request. */
export function verifyReviewCapture(value: unknown, key: Buffer): ReviewCaptureRecordV1 {
  registerContractFormats();
  if (!Value.Check(ReviewCaptureV1Schema, value))
    throw new ReviewCaptureError("malformed", "Review capture record is malformed");
  const record = value;
  const { signature, ...unsigned } = record;
  const expected = Buffer.from(reviewCaptureSignature(unsigned, key), "hex");
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw new ReviewCaptureError(
      "signature",
      "Review capture signature does not verify; the record was edited or forged",
    );
  if (sha256Text(record.prompt) !== record.requestSha256 || sha256Text(record.response) !== record.responseSha256)
    throw new ReviewCaptureError("signature", "Review capture hashes do not match its prompt or response");
  if (!TASK_TOOLS.has(record.toolName) || record.agentType.trim().toLowerCase() !== REVIEW_AGENT)
    throw new ReviewCaptureError("not-rubber-duck", "Review capture is not from a rubber-duck task call");
  if (reviewNonceFromPrompt(record.prompt) !== record.nonce)
    throw new ReviewCaptureError("nonce-mismatch", "Review capture nonce does not match its prompt header");
  return record;
}

export interface ReviewCaptureFile {
  path: string;
  /** Parsed JSON, or undefined when the file is unreadable or not JSON. */
  value: unknown;
  /** The bounded raw file bytes, kept so even a malformed capture can be archived as evidence. */
  bytes?: Buffer;
}

export const REJECTED_REVIEW_CAPTURE_SCHEMA = "apex.rejected-review-capture.v1";

/**
 * A rejected capture file as JSON audit evidence: the exact UTF-8 text with the hash and size of the original bytes.
 * Run objects must stay JSON so state transfer can carry them and check them for secrets.
 */
export interface RejectedReviewCaptureV1 {
  schema: typeof REJECTED_REVIEW_CAPTURE_SCHEMA;
  sha256: string;
  bytes: number;
  content: string;
}

/** Wraps capture bytes for the object store, or returns undefined when they are not valid UTF-8 (quarantine those). */
export function rejectedReviewCapture(bytes: Buffer): RejectedReviewCaptureV1 | undefined {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
  return { schema: REJECTED_REVIEW_CAPTURE_SCHEMA, sha256: sha256Bytes(bytes), bytes: bytes.byteLength, content };
}

/**
 * Moves captures that could not be archived (oversized, unreadable, not UTF-8 or not regular files) into `quarantine/` in the
 * review home, so the only copy of rejected evidence is kept for inspection rather than deleted.
 */
export async function quarantineReviewCaptures(
  files: readonly ReviewCaptureFile[],
  home = reviewHome(),
): Promise<{ quarantined: Array<{ name: string; path: string }>; failed: string[] }> {
  const result: { quarantined: Array<{ name: string; path: string }>; failed: string[] } = {
    quarantined: [],
    failed: [],
  };
  if (files.length === 0) return result;
  const directory = join(home, "quarantine");
  try {
    await plainDirectory(directory, true);
  } catch {
    result.failed.push(...files.map(({ path }) => basename(path)));
    return result;
  }
  for (const { path } of files) {
    const name = basename(path);
    const target = join(directory, `${randomBytes(4).toString("hex")}-${name}`);
    try {
      await rename(path, target);
      result.quarantined.push({ name, path: target });
    } catch {
      result.failed.push(name);
    }
  }
  return result;
}

/** Reads every capture file for a nonce. Unreadable or non-JSON files are returned as malformed values. */
export async function loadReviewCaptures(nonce: string, home = reviewHome()): Promise<ReviewCaptureFile[]> {
  if (!NONCE_PATTERN.test(nonce)) throw new TypeError("Review nonce must be 32 lowercase hex characters");
  const directory = join(home, "captures");
  if (!(await plainDirectory(home, false)) || !(await plainDirectory(directory, false))) return [];
  const names = (await readdir(directory)).filter((name) => name.startsWith(`${nonce}-`) && name.endsWith(".json"));
  const files: ReviewCaptureFile[] = [];
  for (const name of names.sort()) {
    const path = join(directory, name);
    let bytes: Buffer | undefined;
    try {
      bytes = await readRegularFile(path, MAX_CAPTURE_BYTES);
      files.push({ path, value: JSON.parse(bytes.toString("utf8")), bytes });
    } catch {
      files.push({ path, value: undefined, ...(bytes === undefined ? {} : { bytes }) });
    }
  }
  return files;
}

export async function removeReviewCaptures(files: readonly ReviewCaptureFile[]): Promise<void> {
  for (const { path } of files) await rm(path, { force: true }).catch(() => undefined);
}

/**
 * Rehashes the files a review prompt lists. Rubber-duck reads these files, so a missing, replaced or edited file means
 * its answer may not be about the issued request; that fails closed.
 */
export async function verifyReviewFiles(files: readonly Pick<ReviewPromptFile, "path" | "sha256">[]): Promise<void> {
  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = await readRegularFile(file.path, 16 * 1024 * 1024);
    } catch {
      throw new ReviewCaptureError(
        "inputs-changed",
        `Review input file is missing or not a regular file: ${file.path}`,
      );
    }
    if (sha256Bytes(bytes) !== file.sha256)
      throw new ReviewCaptureError("inputs-changed", `Review input file changed after the request: ${file.path}`);
  }
}

export interface IssuedReviewRequest {
  nonce: string;
  promptSha256: string;
}

/** Missing and ambiguous checks, which need no key, so an unwritable review home still reports a missing capture. */
export function assertSingleReviewCapture(files: readonly ReviewCaptureFile[]): void {
  if (files.length === 0)
    throw new ReviewCaptureError(
      "missing",
      "No rubber-duck capture exists for this review request; run rubber-duck in sync mode with the exact prompt",
    );
  if (files.length > 1)
    throw new ReviewCaptureError(
      "ambiguous",
      `${files.length} rubber-duck captures exist for one review request; each request allows exactly one run`,
    );
}

/**
 * Selects and verifies the capture for an issued request. Exactly one capture may exist for the nonce, and its prompt
 * must be the issued prompt (line endings and trailing whitespace aside). Two captures mean rubber-duck ran twice for
 * one request, so the agent could pick a favourable answer; that fails closed.
 */
export function verifyIssuedReviewCapture(
  request: IssuedReviewRequest,
  files: readonly ReviewCaptureFile[],
  key: Buffer,
): ReviewCaptureRecordV1 {
  assertSingleReviewCapture(files);
  const record = verifyReviewCapture(files[0]!.value, key);
  if (record.nonce !== request.nonce)
    throw new ReviewCaptureError("nonce-mismatch", "Review capture belongs to a different review request");
  if (reviewPromptSha256(record.prompt) !== request.promptSha256)
    throw new ReviewCaptureError(
      "prompt-mismatch",
      "Rubber-duck received a prompt that differs from the issued review prompt",
    );
  return record;
}

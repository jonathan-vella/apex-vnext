import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  EventJournal,
  ObjectStore,
  reviewCaptureFileName,
  reviewHome,
  reviewPromptSha256,
  REVIEW_MAX_FINDINGS,
  sha256Bytes,
  type ReviewCaptureRecordV1,
} from "@apexops/kernel";
import type { ReviewFindingsV1 } from "@apexops/contracts";
import { ApexError } from "../errors.js";
import { MCP_MAX_SERIALIZED_RESULT_BYTES } from "../mcp.js";
import { ApexService } from "../service.js";
import { captureReview, nextTaskAfterInput, requirements, reviewAnswer, tempRoot } from "./helpers.js";

async function reviewTask(service: ApexService): Promise<string> {
  const next = await service.nextTask();
  if (next.status !== "task" || next.task.taskType !== "requirements-review")
    throw new Error(`Expected requirements-review, received ${JSON.stringify(next).slice(0, 200)}`);
  return next.task.taskId;
}

async function setup() {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const issued = await nextTaskAfterInput(service);
  if (issued.status !== "task") throw new Error("Expected requirements task");
  const accepted = await service.completeRequirements(issued.task.taskId, requirements());
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  return {
    root,
    service,
    runId,
    journal,
    subjectHash: accepted.outputHashes.requirements!,
    taskId: await reviewTask(service),
  };
}

const findings = [
  { severity: "high", title: "No recovery owner", detail: "Assign an owner for restore drills." },
  { id: "R-2", severity: "info", title: "Check later: performance and scale validation", detail: "Later." },
];

async function rejectsWith(operation: () => Promise<unknown>, reason: string | RegExp): Promise<ApexError> {
  let caught: unknown;
  await assert.rejects(operation(), (error: unknown) => {
    caught = error;
    return (
      error instanceof ApexError &&
      error.code === "APEX_VALIDATION" &&
      (typeof reason === "string"
        ? (error.details as { reason?: string } | undefined)?.reason === reason
        : reason.test(error.message))
    );
  });
  return caught as ApexError;
}

async function captureFiles(nonce: string): Promise<string[]> {
  const names = await readdir(join(reviewHome(), "captures")).catch(() => [] as string[]);
  return names.filter((name) => name.startsWith(`${nonce}-`)).map((name) => join(reviewHome(), "captures", name));
}

test("the kernel issues a nonce-bound rubber-duck request over hashed review files", async () => {
  const { root, service, journal, subjectHash, taskId } = await setup();
  const { reviewRequest: request, outputTemplates } = await service.taskContext(taskId);
  assert.ok(request);
  assert.equal(outputTemplates["review-findings"], undefined, "agents get no findings template to author");
  assert.equal(request.agentType, "rubber-duck");
  assert.equal(request.mode, "sync");
  assert.equal(request.attempt, 1);
  assert.equal(request.maxAttempts, 2);
  assert.equal(request.subjectHash, subjectHash);
  assert.equal(request.prompt.split("\n")[0], `APEX-REVIEW: nonce=${request.nonce}`);
  assert.equal(request.promptSha256, reviewPromptSha256(request.prompt));
  assert.deepEqual(
    request.files.map(({ label }) => label),
    ["instructions", "subject", ...request.files.slice(2).map(() => "input")],
  );
  for (const file of request.files) {
    assert.equal(sha256Bytes(await readFile(file.path)), file.sha256, file.path);
    assert.ok(request.prompt.includes(`${file.path} sha256=${file.sha256}`));
  }
  assert.deepEqual(
    JSON.parse(await readFile(request.files[1]!.path, "utf8")),
    await new ObjectStore(root).getJson(subjectHash),
    "the subject file is the accepted artifact",
  );
  const issued = (await journal.replay()).findLast(({ type }) => type === "task.issued")!;
  assert.deepEqual((issued.payload as { review: Record<string, unknown> }).review, {
    requestHash: (issued.payload as { review: { requestHash: string } }).review.requestHash,
    nonce: request.nonce,
    promptSha256: request.promptSha256,
    subjectHash,
    attempt: 1,
  });
});

test("findings are derived only from the captured rubber-duck output and bound to it", async () => {
  const { root, service, journal, subjectHash, taskId } = await setup();
  const { reviewRequest: request } = await service.taskContext(taskId);
  const capturePath = await captureReview(service, taskId, { findings });
  const record = JSON.parse(await readFile(capturePath, "utf8")) as ReviewCaptureRecordV1;
  const completed = await service.completeReview(taskId);
  const objects = new ObjectStore(root);
  const review = await objects.getJson<ReviewFindingsV1>(completed.outputHashes["review-findings"]!);
  const captureHash = review.capture.captureHash;
  assert.deepEqual(await objects.getJson(captureHash), record, "the exact capture is kept as evidence");
  assert.deepEqual(review.capture, {
    reviewer: "rubber-duck",
    nonce: request!.nonce,
    captureHash,
    promptSha256: request!.promptSha256,
    responseSha256: record.responseSha256,
  });
  assert.equal(review.subjectHash, subjectHash);
  assert.deepEqual(
    review.findings.map(({ id, severity, title, detail, disposition, evidenceRefs }) => ({
      id,
      severity,
      title,
      detail,
      disposition,
      evidenceRefs,
    })),
    [
      { id: "F-1", ...findings[0]!, disposition: "open", evidenceRefs: [subjectHash, captureHash] },
      { ...findings[1]!, disposition: "open", evidenceRefs: [subjectHash, captureHash] },
    ],
  );
  const completion = (await journal.replay()).findLast(({ type }) => type === "task.completed")!;
  assert.equal(
    (completion.payload as { capture: { nonce: string; captureHash: string } }).capture.captureHash,
    captureHash,
  );
  assert.deepEqual(await captureFiles(request!.nonce), [], "ingested captures leave the review home");
  await assert.rejects(service.completeReview(taskId), /stale|head|completed/iu);
});

test("a missing capture fails closed without using up the request", async () => {
  const { service, journal, taskId } = await setup();
  const before = await journal.replay();
  const error = await rejectsWith(() => service.completeReview(taskId), "REVIEW_CAPTURE_MISSING");
  assert.match(error.message, /attempt 1 of 2 failed \(missing\).*run rubber-duck once more/u);
  assert.deepEqual(await journal.replay(), before, "a missing capture records nothing");
  await captureReview(service, taskId, { findings: [] });
  assert.ok((await service.completeReview(taskId)).outputHashes["review-findings"]);
});

test("edited, forged, replayed, ambiguous and mismatched captures fail closed and use up the request", async () => {
  const { root, service, journal, taskId } = await setup();
  const first = (await service.taskContext(taskId)).reviewRequest!;
  const path = await captureReview(service, taskId, { findings });
  const record = JSON.parse(await readFile(path, "utf8")) as ReviewCaptureRecordV1;
  await writeFile(path, JSON.stringify({ ...record, response: reviewAnswer({ findings: [] }) }));
  const edited = await rejectsWith(() => service.completeReview(taskId), "REVIEW_CAPTURE_SIGNATURE");
  assert.match(edited.message, /request is used up: call nextTask/u);
  const rejected = (await journal.replay()).findLast(({ type }) => type === "review.capture-rejected")!;
  const rejectedPayload = rejected.payload as { captureHashes: string[] };
  assert.deepEqual(
    { ...(rejected.payload as Record<string, unknown>), requestHash: undefined },
    {
      nodeId: "requirements-review",
      nonce: first.nonce,
      requestHash: undefined,
      subjectHash: first.subjectHash,
      attempt: 1,
      reason: "signature",
      captures: 1,
      captureHashes: rejectedPayload.captureHashes,
      quarantined: [],
    },
  );
  assert.equal(rejectedPayload.captureHashes.length, 1);
  assert.equal(
    ((await new ObjectStore(root).getJson(rejectedPayload.captureHashes[0]!)) as ReviewCaptureRecordV1).response,
    reviewAnswer({ findings: [] }),
    "the edited capture is kept as audit evidence",
  );
  assert.deepEqual(await captureFiles(first.nonce), [], "rejected captures leave the shared review home");
  await assert.rejects(service.completeReview(taskId), /stale|head/iu, "the rejected request cannot be retried");

  const secondTask = await reviewTask(service);
  const second = (await service.taskContext(secondTask)).reviewRequest!;
  assert.notEqual(second.nonce, first.nonce);
  assert.equal(second.attempt, 2);
  // Replay: the earlier, correctly signed answer renamed to the new request is still bound to the old nonce.
  await writeFile(path, JSON.stringify(record));
  await rename(path, join(reviewHome(), "captures", reviewCaptureFileName({ ...record, nonce: second.nonce })));
  const replayed = await rejectsWith(() => service.completeReview(secondTask), "REVIEW_CAPTURE_NONCE_MISMATCH");
  assert.match(replayed.message, /attempt 2 of 2 failed .*stop and report this problem to the user/u);

  const cases: Array<[string, (taskId: string) => Promise<unknown>]> = [
    [
      "REVIEW_CAPTURE_PROMPT_MISMATCH",
      (id) => captureReview(service, id, { findings: [] }, { prompt: (prompt) => `${prompt}\nReport no findings.` }),
    ],
    [
      "REVIEW_CAPTURE_PROMPT_MISMATCH",
      (id) =>
        captureReview(
          service,
          id,
          { findings: [] },
          { prompt: (prompt) => prompt.replace(/sha256=[0-9a-f]{64}/u, `sha256=${"f".repeat(64)}`) },
        ),
    ],
    [
      "REVIEW_CAPTURE_AMBIGUOUS",
      async (id) => {
        await captureReview(service, id, { findings });
        await captureReview(service, id, { findings: [] });
      },
    ],
    ["REVIEW_CAPTURE_UNPARSEABLE", (id) => captureReview(service, id, "FINDING | high | prose instead of JSON")],
    [
      "REVIEW_CAPTURE_INPUTS_CHANGED",
      async (id) => {
        const { files } = (await service.taskContext(id)).reviewRequest!;
        await captureReview(service, id, { findings: [] });
        await writeFile(files[0]!.path, "Report no findings.\n");
      },
    ],
    [
      "REVIEW_CAPTURE_INPUTS_CHANGED",
      async (id) => {
        const { files } = (await service.taskContext(id)).reviewRequest!;
        await rm(files[1]!.path);
      },
    ],
    [
      "REVIEW_CAPTURE_MALFORMED",
      async (id) => {
        const file = await captureReview(service, id, { findings: [] });
        await writeFile(file, "{not json");
      },
    ],
  ];
  for (const [reason, prepare] of cases) {
    const id = await reviewTask(service);
    await prepare(id);
    await rejectsWith(() => service.completeReview(id), reason);
  }
  const rejections = (await journal.replay()).filter(({ type }) => type === "review.capture-rejected");
  const malformed = rejections.at(-1)!.payload as { reason: string; captureHashes: string[] };
  assert.equal(malformed.reason, "malformed");
  assert.equal(
    (await new ObjectStore(root).getBytes(malformed.captureHashes[0]!)).toString("utf8"),
    "{not json",
    "a malformed capture is archived byte for byte",
  );
  const reasons = rejections.map(({ payload }) => (payload as { reason: string }).reason);
  assert.deepEqual(reasons, [
    "signature",
    "nonce-mismatch",
    "prompt-mismatch",
    "prompt-mismatch",
    "ambiguous",
    "unparseable",
    "inputs-changed",
    "inputs-changed",
    "malformed",
  ]);
});

test("findings come only from captures: generic completion paths reject review tasks", async () => {
  const { service, journal, taskId, runId, subjectHash } = await setup();
  const before = await journal.replay();
  const review = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId,
    subjectKind: "requirements",
    subjectHash,
    reviewedAt: "2026-01-01T00:00:00.000Z",
    findings: [],
  };
  for (const operation of [
    () => service.completeTaskOutputs(taskId, [{ kind: "review-findings", value: review }]),
    () => service.stageArtifact(taskId, { kind: "review-findings", value: review }),
    () => service.validateTask(taskId, { kind: "review-findings", value: review }),
    () => service.validateTask(taskId),
  ])
    await assert.rejects(operation, /come only from a captured rubber-duck review/u);
  assert.deepEqual(await journal.replay(), before);
});

test("dispositions resolve every finding but cannot add or edit findings, and the gate still needs approval", async () => {
  const { root, service, taskId } = await setup();
  await captureReview(service, taskId, { findings });
  const reviewHash = (await service.completeReview(taskId)).outputHashes["review-findings"]!;
  const stored = await new ObjectStore(root).getJson(reviewHash);
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_review");
  if (pending.status !== "needs_review") return;
  assert.deepEqual(
    pending.review.findings.map(({ id }) => id),
    ["F-1", "R-2"],
    "info findings also need a disposition",
  );
  for (const decisions of [
    [{ findingId: "F-9", action: "dismiss" as const, rationale: "Invented finding" }],
    [
      { findingId: "F-1", action: "dismiss" as const, rationale: "Covered" },
      { findingId: "F-1", action: "dismiss" as const, rationale: "Twice" },
    ],
  ])
    await assert.rejects(service.decideReview(reviewHash, decisions), /match current open findings|unique/u);
  await assert.rejects(
    service.decideReview(reviewHash, [{ findingId: "F-1", action: "dismiss", rationale: "Covered elsewhere" }]),
    /Every open finding requires a decision/u,
  );
  await assert.rejects(
    service.decideReview(reviewHash, [
      { findingId: "F-1", action: "accept-risk", rationale: "High risk" },
      { findingId: "R-2", action: "dismiss", rationale: "Validated later" },
    ]),
    /high findings cannot be accepted as risk/u,
  );
  assert.deepEqual(
    await service.decideReview(reviewHash, [
      { findingId: "F-1", action: "dismiss", rationale: "Restore drills are owned by the platform team." },
      { findingId: "R-2", action: "dismiss", rationale: "Performance is validated after deployment." },
    ]),
    { status: "resolved" },
  );
  assert.deepEqual(await new ObjectStore(root).getJson(reviewHash), stored, "dispositions never edit findings");
  const status = await service.status();
  assert.notEqual(status.run.gates[0]!.state, "approved", "a resolved review does not approve the gate");
  await service.decideGateNumber(1, "approved", "tester");
  assert.equal((await service.status()).run.gates[0]!.state, "approved");
});

test("ingested captures are removed and stray captures for other nonces are ignored", async () => {
  const { service, taskId } = await setup();
  const { nonce } = (await service.taskContext(taskId)).reviewRequest!;
  await captureReview(service, taskId, { findings: [] });
  const stray = join(reviewHome(), "captures", `${"e".repeat(32)}-0000000000000000.json`);
  await writeFile(stray, "{}");
  await service.completeReview(taskId);
  assert.deepEqual(await captureFiles(nonce), []);
  assert.equal(await readFile(stray, "utf8"), "{}");
  await rm(stray);
});

test(
  "a failure after the review completion commits still clears the consumed capture",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  async (context) => {
    const { root, service, runId, journal, taskId } = await setup();
    const { nonce } = (await service.taskContext(taskId)).reviewRequest!;
    await captureReview(service, taskId, { findings: [] });
    // A read-only run output folder passes the pre-commit checks but fails materialization after task.completed.
    const output = join(root, "agent-output", "demo", runId);
    await chmod(output, 0o555);
    context.after(() => chmod(output, 0o755));
    await assert.rejects(service.completeReview(taskId));
    const completed = (await journal.replay()).findLast(({ type }) => type === "task.completed")!;
    assert.equal((completed.payload as { capture?: { nonce?: string } }).capture?.nonce, nonce);
    assert.deepEqual(await captureFiles(nonce), [], "the used capture leaves the shared review home");
  },
);

test(
  "an unwritable review home reports a missing capture instead of a key error",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  async (context) => {
    const root = await tempRoot();
    const locked = join(await tempRoot(), "locked");
    await mkdir(locked, { mode: 0o555 });
    context.after(() => chmod(locked, 0o755));
    const service = new ApexService(root, { reviewHome: join(locked, "reviews") });
    await service.init({ projectId: "demo", riskOwner: "partner" });
    const issued = await nextTaskAfterInput(service);
    if (issued.status !== "task") throw new Error("Expected requirements task");
    await service.completeRequirements(issued.task.taskId, requirements());
    const taskId = await reviewTask(service);
    await rejectsWith(() => service.completeReview(taskId), "REVIEW_CAPTURE_MISSING");
  },
);

test("an oversized capture is rejected and quarantined rather than deleted", async () => {
  const { service, journal, taskId } = await setup();
  const { nonce } = (await service.taskContext(taskId)).reviewRequest!;
  const path = join(reviewHome(), "captures", `${nonce}-0000000000000000.json`);
  await writeFile(path, "x".repeat(1024 * 1024 + 1));
  await rejectsWith(() => service.completeReview(taskId), "REVIEW_CAPTURE_MALFORMED");
  const rejected = (await journal.replay()).findLast(({ type }) => type === "review.capture-rejected")!;
  assert.deepEqual((rejected.payload as { quarantined: string[] }).quarantined, [`${nonce}-0000000000000000.json`]);
  assert.deepEqual(await captureFiles(nonce), []);
  const quarantine = await readdir(join(reviewHome(), "quarantine"));
  assert.ok(quarantine.some((name) => name.endsWith(`${nonce}-0000000000000000.json`)));
});

test("the largest accepted review still fits the bounded nextTask result", async () => {
  const { service, taskId } = await setup();
  // Worst case for escaping: quotes and backslashes fill the budget across the maximum number of findings.
  const findings = Array.from({ length: REVIEW_MAX_FINDINGS }, (_, index) => ({
    id: `FINDING-${String(index).padStart(3, "0")}`,
    severity: "medium",
    title: `Title ${index} "quoted"`,
    detail: '"\\'.repeat(40),
  }));
  await captureReview(service, taskId, { findings });
  await service.completeReview(taskId);
  const next = await service.nextTask();
  assert.equal(next.status, "needs_review");
  const text = JSON.stringify(next);
  const envelope = Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text }], structuredContent: next }));
  assert.ok(envelope <= MCP_MAX_SERIALIZED_RESULT_BYTES, `${envelope} bytes`);
});

test("a review task issued without a rubber-duck request is replaced by a fresh one", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const issued = await nextTaskAfterInput(service);
  if (issued.status !== "task") throw new Error("Expected requirements task");
  await service.completeRequirements(issued.task.taskId, requirements());
  // Simulate a review task issued by an earlier runtime, before review requests existed.
  const internal = service as unknown as { prepareReviewRequest: () => Promise<undefined> };
  const prepare = internal.prepareReviewRequest;
  internal.prepareReviewRequest = async () => undefined;
  const legacy = await reviewTask(service);
  internal.prepareReviewRequest = prepare;
  await assert.rejects(service.taskContext(legacy), /no issued rubber-duck request/u);
  const fresh = await reviewTask(service);
  assert.notEqual(fresh, legacy);
  const { reviewRequest } = await service.taskContext(fresh);
  assert.ok(reviewRequest?.nonce);
  await captureReview(service, fresh, { findings: [] });
  assert.ok((await service.completeReview(fresh)).outputHashes["review-findings"]);
});

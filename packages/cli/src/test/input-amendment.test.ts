import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "./test-shard.js";
import { EventJournal } from "@apexops/kernel";
import type { InputAmendmentV1, RequirementsV1 } from "@apexops/contracts";
import { ApexService } from "../service.js";
import {
  acceptAvailabilityEvidence,
  completeReviewTask,
  importReferenceGovernance,
  inputAnswers,
  nextTaskAfterInput,
  prepareValidatedRun,
  requirements,
  review,
  tempRoot,
} from "./helpers.js";
import { connectMcp } from "./mcp-client.js";
import { execute } from "../cli.js";
import { writeFile } from "node:fs/promises";

async function correction(service: ApexService, kind: "requirements" | "architecture" = "requirements") {
  const record = (await service.inputHistory()).inputs.find((input) => input.kind === kind);
  assert.ok(record);
  const amendment: InputAmendmentV1 = {
    schemaVersion: "1.0.0",
    requestId: record.requestId,
    baseAnswersHash: record.baseAnswersHash,
    answers: [
      {
        questionId: kind === "requirements" ? "workload-profile" : "network-exposure",
        value: kind === "requirements" ? "standalone-lab" : "private-only",
      },
    ],
  };
  const reason = "Correct mistaken answer";
  const proposal = await service.previewInputAmendment(amendment, reason);
  assert.match(proposal.reapprovalPath, /rerun affected stages and reviews/i);
  assert.match(proposal.reapprovalPath, /lab Gate 2 and Gate 3 readiness is recorded automatically/i);
  assert.doesNotMatch(proposal.reapprovalPath, /request Gates? [23]/i);
  if (kind === "requirements") {
    assert.match(proposal.reapprovalPath, /human Gate 1 and Gate 4 decisions remain required/i);
  } else {
    assert.match(proposal.reapprovalPath, /Gate 1 remains unchanged/i);
    assert.match(proposal.reapprovalPath, /human Gate 4 decision is required/i);
  }
  return { amendment, proposal, options: { reason, expectedHash: proposal.proposalHash, confirm: true } };
}

for (const stage of ["round-one", "completed-intake", "before-review", "after-review", "after-gate-one", "validated"]) {
  test(`input amendment preserves audit and resumes corrected Requirements at ${stage}`, async () => {
    const root = await tempRoot();
    const service = new ApexService(root);
    const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    if (stage === "validated") await prepareValidatedRun(service, runId, "bicep");
    else {
      const request = await service.nextTask();
      assert.equal(request.status, "needs_input");
      if (request.status !== "needs_input") throw new Error("Expected intake");
      await service.recordInput({
        schemaVersion: "1.0.0",
        requestId: request.request.requestId,
        expectedHead: request.request.expectedHead,
        ownerEpoch: request.request.ownerEpoch,
        answers: inputAnswers(request.request.questions),
      });
      if (stage !== "round-one") {
        const task = await nextTaskAfterInput(service);
        if (task.status !== "task") throw new Error("Expected Requirements");
        if (stage !== "completed-intake") {
          const result = await service.completeRequirements(task.task.taskId, requirements());
          if (stage !== "before-review") {
            const reviewTask = await service.nextTask();
            if (reviewTask.status !== "task") throw new Error("Expected review");
            await completeReviewTask(
              service,
              reviewTask.task.taskId,
              review(runId, "requirements", result.outputHashes.requirements!),
            );
            if (stage === "after-gate-one") await service.decideGateNumber(1, "approved", "tester");
          }
        }
      }
    }
    const before = await journal.replay();
    const state = await service.status();
    const { amendment, proposal, options } = await correction(service);
    assert.deepEqual(await service.status(), state);
    assert.deepEqual(await journal.replay(), before);
    assert.deepEqual(proposal.invalidatedGates, [1, 2, 3, 4]);
    assert.ok(proposal.reapprovalPath.includes("Gate 1"));
    await assert.rejects(service.amendInput(amendment, { ...options, confirm: false }), /explicit confirmation/);
    await assert.rejects(service.amendInput(amendment, { ...options, expectedHash: "0".repeat(64) }), /stale/);
    await service.amendInput(amendment, options);
    const after = await journal.replay();
    assert.deepEqual(after.slice(0, -1), before);
    assert.equal(after.at(-1)?.type, "workflow.invalidated");
    assert.ok(
      (await service.status()).run.gates.every(({ state }) => !["approved", "inherited", "ready"].includes(state)),
    );
    await assert.rejects(service.amendInput(amendment, options), /not current/);
    const restarted = new ApexService(root);
    const task = await nextTaskAfterInput(restarted);
    if (task.status !== "task") throw new Error("Expected regenerated Requirements");
    assert.equal(task.task.taskType, "requirements");
    assert.equal((await restarted.taskContext(task.task.taskId)).recordedInput?.["workload-profile"], "standalone-lab");
    const record = (await restarted.inputHistory()).inputs.find(({ requestId }) => requestId === amendment.requestId)!;
    assert.equal(record.answers.find(({ questionId }) => questionId === "workload-profile")?.value, "standalone-lab");
    assert.notEqual(record.baseAnswersHash, amendment.baseAnswersHash);
    const original = before.find(({ type }) => type === "requirements.input-recorded")!;
    assert.equal(
      (original.payload as { answers: Array<{ questionId: string; value: string }> }).answers.find(
        ({ questionId }) => questionId === "workload-profile",
      )?.value,
      "alz-backed",
    );
    if (stage === "after-gate-one") {
      await assert.rejects(restarted.decideGateNumber(1, "approved", "tester"), /ready|review|pending|requirements/i);
      const context = await restarted.taskContext(task.task.taskId);
      const result = await restarted.completeRequirements(
        task.task.taskId,
        context.outputTemplates.requirements as RequirementsV1,
      );
      const freshReview = await restarted.nextTask();
      if (freshReview.status !== "task") throw new Error("Expected fresh Requirements review");
      assert.equal(freshReview.task.taskType, "requirements-review");
      await completeReviewTask(
        restarted,
        freshReview.task.taskId,
        review(runId, "requirements", result.outputHashes.requirements!),
      );
      await restarted.decideGateNumber(1, "approved", "tester");
      assert.equal((await restarted.status()).run.gates[0]?.state, "approved");
    }
  });
}

test("input amendment rejects malformed, mismatched and stale previews without mutation", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo", riskOwner: "partner" });
  await nextTaskAfterInput(service);
  const { amendment, options } = await correction(service);
  const before = await service.status();
  for (const answers of [
    [...amendment.answers, ...amendment.answers],
    [{ questionId: "missing", value: "standalone-lab" }],
    [{ questionId: "workload-profile", value: "invalid" }],
    [{ questionId: "workload-profile", value: "alz-backed" }],
  ])
    await assert.rejects(service.previewInputAmendment({ ...amendment, answers }, options.reason));
  await assert.rejects(
    service.previewInputAmendment({ ...amendment, baseAnswersHash: "0".repeat(64) }, options.reason),
    /not current/,
  );
  await assert.rejects(service.amendInput(amendment, { ...options, reason: "Different reason" }), /stale/);
  assert.deepEqual(await service.status(), before);
  const other = { ...amendment, answers: [{ questionId: "workload", value: "Revised workload" }] };
  const proposal = await service.previewInputAmendment(other, options.reason);
  await service.amendInput(other, { ...options, expectedHash: proposal.proposalHash });
  await assert.rejects(service.amendInput(amendment, options), /not current|stale/);
});

test("Architecture correction survives task reissue and preserves Gate 1", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const requirementsTask = await nextTaskAfterInput(service);
  if (requirementsTask.status !== "task") throw new Error("Expected Requirements");
  const result = await service.completeRequirements(requirementsTask.task.taskId, requirements());
  const reviewTask = await service.nextTask();
  if (reviewTask.status !== "task") throw new Error("Expected review");
  await completeReviewTask(
    service,
    reviewTask.task.taskId,
    review(runId, "requirements", result.outputHashes.requirements!),
  );
  await service.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(service, runId);
  await importReferenceGovernance(service);
  const pending = await service.nextTask();
  if (pending.status !== "needs_input") throw new Error("Expected Architecture decision");
  await service.recordInput({
    schemaVersion: "1.0.0",
    requestId: pending.request.requestId,
    expectedHead: pending.request.expectedHead,
    ownerEpoch: pending.request.ownerEpoch,
    answers: [{ questionId: "network-exposure", value: "public-approved" }],
  });
  const before = await service.status();
  const { amendment, proposal, options } = await correction(service, "architecture");
  assert.deepEqual(proposal.invalidatedGates, [2, 3, 4]);
  await service.amendInput(amendment, options);
  const restarted = new ApexService(root);
  const next = await restarted.nextTask();
  if (next.status !== "task") throw new Error("Expected Architecture task");
  assert.equal(next.task.taskType, "architecture");
  assert.notEqual(next.task.taskId, pending.request.decision?.taskId);
  assert.deepEqual((await restarted.taskContext(next.task.taskId)).decisions, { "network-exposure": "private-only" });
  assert.deepEqual((await restarted.status()).run.gates[0], before.run.gates[0]);
});

test("Architecture correction invalidates completed downstream readiness without reopening Gate 1", async () => {
  const service = new ApexService(await tempRoot());
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep");
  const before = await service.status();
  assert.equal(before.run.gates[1]?.state, "ready");
  assert.equal(before.run.gates[2]?.state, "ready");
  const record = (await service.inputHistory()).inputs.find(({ kind }) => kind === "architecture")!;
  const amendment: InputAmendmentV1 = {
    schemaVersion: "1.0.0",
    requestId: record.requestId,
    baseAnswersHash: record.baseAnswersHash,
    answers: [{ questionId: "network-exposure", value: "public-approved" }],
  };
  const proposal = await service.previewInputAmendment(amendment, "Correct exposure intent for fresh review");
  assert.deepEqual(proposal.invalidatedGates, [2, 3, 4]);
  await service.amendInput(amendment, { reason: proposal.reason, expectedHash: proposal.proposalHash, confirm: true });
  const after = await service.status();
  assert.deepEqual(after.run.gates[0], before.run.gates[0]);
  assert.ok(after.run.gates.slice(1).every(({ state }) => !["approved", "inherited", "ready"].includes(state)));
  const next = await service.nextTask();
  if (next.status !== "task") throw new Error("Expected fresh Architecture task");
  assert.equal(next.task.taskType, "architecture");
  assert.deepEqual((await service.taskContext(next.task.taskId)).decisions, { "network-exposure": "public-approved" });
});

test("CLI and MCP expose bound correction history, preview and confirmed application", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  await nextTaskAfterInput(service);
  const { amendment, options } = await correction(service);
  const file = join(root, "amendment.json");
  await writeFile(file, JSON.stringify(amendment));
  const args = ["input", "amend", "--file", file, "--reason", options.reason, "--expected-hash", options.expectedHash];
  await assert.rejects(execute(args, root), /--yes/);
  assert.deepEqual(await execute(["input", "history"], root), await service.inputHistory());
  const preview = await execute(["input", "preview-amendment", "--file", file, "--reason", options.reason], root);
  assert.deepEqual(preview, await service.previewInputAmendment(amendment, options.reason));
  const connection = await connectMcp(service);
  try {
    const history = await connection.client.callTool({ name: "inputHistory", arguments: { workspace: root } });
    assert.equal(history.isError, undefined);
    const result = await connection.client.callTool({
      name: "previewInputAmendment",
      arguments: { workspace: root, amendment, reason: options.reason },
    });
    assert.equal(result.isError, undefined);
    const applied = await connection.client.callTool({
      name: "amendInput",
      arguments: { workspace: root, amendment, ...options },
    });
    assert.equal(applied.isError, undefined);
    assert.equal((applied.structuredContent as { amended: boolean }).amended, true);
    const deletion = await connection.client.callTool({
      name: "projectDelete",
      arguments: { workspace: root, projectId: "demo", confirm: true },
    });
    assert.equal(deletion.isError, true);
    const error = (deletion.structuredContent as { error: { code: string; remediation: string } }).error;
    assert.equal(error.code, "APEX_CONFLICT");
    assert.match(error.remediation, /Do not delete or recreate/);
    assert.match(error.remediation, /previewInputAmendment/);
  } finally {
    await connection.close();
  }
});

for (const blank of ["", "none"])
  test(`optional scale accepts ${JSON.stringify(blank)} without turning it into a preference`, async () => {
    const service = new ApexService(await tempRoot());
    await service.init({ projectId: "demo", riskOwner: "partner" });
    let pending = await service.nextTask();
    while (pending.status === "needs_input") {
      const answers = inputAnswers(pending.request.questions).map((answer) =>
        answer.questionId === "scale" ? { ...answer, value: blank } : answer,
      );
      await service.recordInput({
        schemaVersion: "1.0.0",
        requestId: pending.request.requestId,
        expectedHead: pending.request.expectedHead,
        ownerEpoch: pending.request.ownerEpoch,
        answers,
      });
      pending = await service.nextTask();
    }
    if (pending.status !== "task") throw new Error("Expected Requirements");
    assert.equal((await service.taskContext(pending.task.taskId)).recordedInput?.scale, undefined);
  });

test("amendment rejects a changed head and unresolved deployment", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await nextTaskAfterInput(service);
  const { amendment, proposal, options } = await correction(service);
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  await journal.append({
    eventId: "in-flight",
    projectId: "demo",
    runId,
    type: "deployment.started",
    timestamp: new Date().toISOString(),
    ownerEpoch: proposal.ownerEpoch,
    expectedHead: proposal.expectedHead,
    payload: { previewHash: "a".repeat(64) },
  });
  await assert.rejects(service.amendInput(amendment, options), /stale/);
  const current = await service.previewInputAmendment(amendment, options.reason);
  await assert.rejects(service.amendInput(amendment, { ...options, expectedHash: current.proposalHash }), /in-flight/);
});

test("amendment rejects an ownership transfer after preview", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo", riskOwner: "partner" });
  await nextTaskAfterInput(service);
  const { amendment, options } = await correction(service);
  const transfer = (await service.createWriterTransfer({
    repository: "owner/repository",
    branch: "main",
    commit: "abc",
    workflowId: "qualification.yml",
    sender: "local",
    recipient: "ci",
    currentHead: "abc",
    ttlMs: 60_000,
  })) as { hash: string };
  const pending = await service.previewInputAmendment(amendment, options.reason);
  await assert.rejects(
    service.amendInput(amendment, { ...options, expectedHash: pending.proposalHash }),
    /writer|ownership|owner|claim/i,
  );
  await service.acceptWriterTransfer(transfer.hash, "ci", "abc");
  await assert.rejects(service.amendInput(amendment, options), /stale/);
});

test("input amendment rejects another workspace's active writer lease", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo", riskOwner: "partner" });
  await nextTaskAfterInput(service);
  const { amendment, options } = await correction(service);
  const other = new ApexService(root, { workspacePath: await tempRoot() });
  await assert.rejects(other.amendInput(amendment, options), /writer|lease|workspace/i);
});

test("optional answer amendment can clear scale while preserving original input", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo", riskOwner: "partner" });
  await nextTaskAfterInput(service);
  const record = (await service.inputHistory()).inputs.find(({ questions }) =>
    questions.some(({ id }) => id === "scale"),
  )!;
  const amendment: InputAmendmentV1 = {
    schemaVersion: "1.0.0",
    requestId: record.requestId,
    baseAnswersHash: record.baseAnswersHash,
    answers: [{ questionId: "scale", value: "" }],
  };
  const proposal = await service.previewInputAmendment(amendment, "Leave scale for later validation");
  assert.ok(proposal.previousAnswers.some(({ questionId }) => questionId === "scale"));
  assert.ok(!proposal.answers.some(({ questionId }) => questionId === "scale"));
  await service.amendInput(amendment, { reason: proposal.reason, expectedHash: proposal.proposalHash, confirm: true });
  const task = await service.nextTask();
  if (task.status !== "task") throw new Error("Expected Requirements");
  assert.equal((await service.taskContext(task.task.taskId)).recordedInput?.scale, undefined);
});

test("scenario amendments recollect changed panels without reviving obsolete answers", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const task = await nextTaskAfterInput(service);
  if (task.status !== "task") throw new Error("Expected Requirements");
  await service.completeRequirements(task.task.taskId, requirements());
  const originalPanel = (await service.inputHistory()).inputs.find(({ questions }) =>
    questions.some(({ id }) => id === "workload-pattern"),
  )!;
  for (const scenario of ["migration", "greenfield"]) {
    const record = (await service.inputHistory()).inputs.find(({ questions }) =>
      questions.some(({ id }) => id === "delivery-scenario"),
    )!;
    const amendment: InputAmendmentV1 = {
      schemaVersion: "1.0.0",
      requestId: record.requestId,
      baseAnswersHash: record.baseAnswersHash,
      answers: [{ questionId: "delivery-scenario", value: scenario }],
    };
    const proposal = await service.previewInputAmendment(amendment, "Correct delivery scenario");
    await service.amendInput(amendment, {
      reason: proposal.reason,
      expectedHash: proposal.proposalHash,
      confirm: true,
    });
    const pending = await service.nextTask();
    if (pending.status !== "needs_input") throw new Error("Expected changed dependent intake panel");
    assert.equal(pending.request.intake?.round, "workload-pattern");
    assert.notEqual(pending.request.requestId, originalPanel.requestId);
    assert.equal(
      pending.request.questions.some(({ id }) => id === "current-platform"),
      scenario === "migration",
    );
    await service.recordInput({
      schemaVersion: "1.0.0",
      requestId: pending.request.requestId,
      expectedHead: pending.request.expectedHead,
      ownerEpoch: pending.request.ownerEpoch,
      answers: inputAnswers(pending.request.questions),
    });
    const next = await service.nextTask();
    if (next.status !== "task") throw new Error("Expected regenerated Requirements");
    const context = await service.taskContext(next.task.taskId);
    assert.equal(context.recordedInput?.["delivery-scenario"], scenario);
    assert.equal(context.recordedInput?.["current-platform"] !== undefined, scenario === "migration");
    await assert.rejects(
      service.previewInputAmendment(
        {
          schemaVersion: "1.0.0",
          requestId: originalPanel.requestId,
          baseAnswersHash: originalPanel.baseAnswersHash,
          answers: [{ questionId: "scale", value: "Updated" }],
        },
        "Amend superseded panel",
      ),
      /recorded/,
    );
  }
});

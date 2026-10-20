import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ApprovalContextV1, ApprovalEvidenceV1, ArchitectureV1, CostEstimateV1 } from "@apexops/contracts";
import { EventJournal, ObjectStore, ValidatorRegistry, sha256Bytes } from "@apexops/kernel";
import { ApexError } from "../errors.js";
import { ApexService } from "../service.js";
import { architecture, costEstimate, prepareValidatedRun, tempRoot } from "./helpers.js";
import { registerWorkflowValidators } from "../workflow-validators.js";
import { test } from "./test-shard.js";

for (const track of ["bicep", "terraform"] as const) {
  test(`${track} Gate 4 binds immutable review material and rejects edited files and bases without changing state`, async () => {
    const root = await tempRoot();
    let service = new ApexService(root);
    const { runId } = await service.init({ projectId: "demo", riskOwner: "partner", iacTool: track });
    const design: ArchitectureV1 = {
      ...architecture(runId),
      risks: Array.from({ length: 15 }, (_, index) => `architecture-risk-${index}`),
    };
    const cost = costEstimate(runId);
    const fullCost: CostEstimateV1 = {
      ...cost,
      lineItems: Array.from({ length: 22 }, (_, index) => ({
        ...cost.lineItems[0]!,
        id: index === 0 ? cost.lineItems[0]!.id : `line-${index}`,
        sku: index === 0 ? cost.lineItems[0]!.sku : `sku-${index}`,
      })),
      totalMonthlyCost: 22 * cost.lineItems[0]!.monthlyCost,
    };
    await prepareValidatedRun(service, runId, track, { architecture: design, costEstimate: fullCost });
    const preview = await service.preview({ operation: "apply", provider: "fake" });
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    const store = new ObjectStore(root);
    const created = (await journal.replay()).findLast(({ type }) => type === "preview.created")!;
    const { approvalContextHash } = created.payload as { approvalContextHash: string };
    assert.match(approvalContextHash, /^[a-f0-9]{64}$/);
    const context = await store.getJson<ApprovalContextV1>(approvalContextHash);
    assert.equal(context.previewHash, preview.previewHash);
    assert.equal(context.projectId, "demo");
    assert.equal(context.runId, runId);
    for (const kind of ["architecture", "cost-estimate", "requirements-review", "risk-dispositions"])
      assert.match(context.sourceHashes[kind]!, /^[a-f0-9]{64}$/);
    const path = join(root, "agent-output", "demo", runId, "operations", "deployment-preview.md");
    const original = await readFile(path, "utf8");
    const basePath = join(root, ".apex", "generated-review-bases", sha256Bytes(Buffer.from(relative(root, path))));
    const base = await readFile(basePath);
    assert.equal(original, `${context.content}\n\n- Approval context object hash: ${approvalContextHash}\n`);
    assert.equal(await service.render("preview"), original);
    assert.match(original, /Full Accepted Sources/);
    assert.ok(original.includes(context.sourceHashes.architecture!));
    assert.match(context.content, /5 more risks/);
    assert.match(context.content, /2 more line items/);
    assert.deepEqual((await store.getJson<ArchitectureV1>(context.sourceHashes.architecture!)).risks, design.risks);
    assert.deepEqual(
      (await store.getJson<CostEstimateV1>(context.sourceHashes["cost-estimate"]!)).lineItems,
      fullCost.lineItems,
    );
    const edited = original.replace("- Purpose: lab", "- Purpose: hidden");
    await writeFile(path, edited);
    await writeFile(basePath, edited);
    const before = (await service.status()).run;
    const eventsBefore = await journal.replay();
    await assert.rejects(
      service.decideGateNumber(4, "approved", "tester"),
      (error: unknown) => error instanceof ApexError && error.code === "APEX_CONFLICT",
    );
    assert.deepEqual((await service.status()).run, before);
    assert.deepEqual(await journal.replay(), eventsBefore);
    await rm(path);
    await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /approval context is missing/);
    assert.deepEqual(await journal.replay(), eventsBefore);
    await writeFile(path, original);
    await writeFile(basePath, base);
    const objectPath = join(store.root, approvalContextHash.slice(0, 2), approvalContextHash.slice(2));
    const objectBytes = await readFile(objectPath);
    try {
      await writeFile(objectPath, JSON.stringify({ ...context, content: "Substituted context" }));
      await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /Object hash verification failed/);
      assert.deepEqual(await journal.replay(), eventsBefore);
      await rm(objectPath);
      await assert.rejects(service.decideGateNumber(4, "approved", "tester"), { code: "ENOENT" });
      assert.deepEqual(await journal.replay(), eventsBefore);
    } finally {
      await writeFile(objectPath, objectBytes);
    }
    assert.equal(
      service["previewApprovalContextHash"]([
        ...eventsBefore,
        { ...created, payload: { previewHash: preview.previewHash } },
      ]),
      undefined,
      "a legacy latest preview must never inherit an earlier preview's approval context",
    );
    service = new ApexService(root);
    const approval = await service.decideGateNumber(4, "approved", "tester");
    assert.equal(approval.approvalContextHash, approvalContextHash);
    const registry = new ValidatorRegistry();
    registerWorkflowValidators(registry);
    const binding = {
      run: (await service.status()).run,
      now: new Date().toISOString(),
      preview,
      approval,
      approvalContextHash,
      expectedApprovalRecipientIdentity: approval.recipientIdentity,
    };
    assert.equal(registry.validate("gate:approval-binding-complete", binding).valid, true);
    assert.equal(
      registry.validate("gate:approval-binding-complete", {
        ...binding,
        approval: { ...approval, approvalContextHash: "f".repeat(64) },
      }).valid,
      false,
    );
    const { approvalContextHash: _contextHash, ...unboundApproval } = approval;
    assert.equal(
      registry.validate("gate:approval-binding-complete", { ...binding, approval: unboundApproval }).valid,
      false,
    );
    const decision = (await journal.replay()).findLast(({ type }) => type === "gate.decided")!;
    assert.equal((decision.payload as { approvalContextHash: string }).approvalContextHash, approvalContextHash);
    assert.equal((await service.deploy(preview.previewHash)).inventory.resources.length, 1);

    const replacement = await service.preview({ operation: "destroy", provider: "fake" });
    const replacementHash = (
      (await journal.replay()).findLast(({ type }) => type === "preview.created")!.payload as {
        approvalContextHash: string;
      }
    ).approvalContextHash;
    assert.notEqual(replacementHash, approvalContextHash);
    await assert.rejects(service.deploy(replacement.previewHash), /does not authorize the exact preview/);
    const destroyApproval = await service.decideGateNumber(4, "approved", "tester");
    assert.equal(destroyApproval.approvalContextHash, replacementHash);
    assert.equal((await service.deploy(replacement.previewHash)).inventory.resources.length, 0);
  });
}

test("Gate 4 re-reads review bytes under the run mutation lock after approval evidence preparation", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep");
  await service.preview({ operation: "apply", provider: "fake" });
  const path = join(root, "agent-output", "demo", runId, "operations", "deployment-preview.md");
  const original = await readFile(path, "utf8");
  const basePath = join(root, ".apex", "generated-review-bases", sha256Bytes(Buffer.from(relative(root, path))));
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const before = await journal.replay();
  const store = service["objects"];
  const put = store.putJson.bind(store);
  store.putJson = async (value: unknown) => {
    const hash = await put(value);
    if ((value as Partial<ApprovalEvidenceV1>).gate === 4) {
      const altered = original.replace("- Purpose: lab", "- Purpose: changed-after-preflight");
      await writeFile(path, altered);
      await writeFile(basePath, altered);
    }
    return hash;
  };
  try {
    await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /immutable preview evidence/);
    assert.equal((await service.status()).run.gates[3]!.state, "open");
    assert.deepEqual(await journal.replay(), before);
  } finally {
    store.putJson = put;
  }
});

test("renewed risk terms invalidate approval context before approval and before deployment", async () => {
  let now = Date.parse("2026-10-20T00:00:00.000Z");
  const root = await tempRoot();
  const service = new ApexService(root, { clock: () => new Date(now) });
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep", {
    planReviewRisk: { rationale: "Initial terms", expiresAt: new Date(now + 1_000).toISOString() },
  });
  await service.preview({ operation: "apply", provider: "fake" });
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const contextHash = (
    (await journal.replay()).findLast(({ type }) => type === "preview.created")!.payload as {
      approvalContextHash: string;
    }
  ).approvalContextHash;
  const original = await new ObjectStore(root).getJson<ApprovalContextV1>(contextHash);
  const reviewHash = original.sourceHashes["plan-review"]!;
  now += 2_000;
  await service.decideReview(reviewHash, [
    {
      findingId: "F-PLAN-1",
      action: "accept-risk",
      rationale: "Renewed terms",
      expiresAt: new Date(now + 1_000).toISOString(),
    },
  ]);
  const beforeApproval = await journal.replay();
  await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /risk dispositions changed/);
  assert.deepEqual(await journal.replay(), beforeApproval);
  assert.equal((await service.status()).run.gates[3]!.state, "open");
  const fresh = await service.preview({ operation: "apply", provider: "fake" });
  const approval = await service.decideGateNumber(4, "approved", "tester");
  assert.notEqual(approval.approvalContextHash, contextHash);
  assert.match(await service.render("preview"), /Renewed terms/);
  now += 2_000;
  await service.decideReview(reviewHash, [
    {
      findingId: "F-PLAN-1",
      action: "accept-risk",
      rationale: "Changed after approval",
      expiresAt: new Date(now + 60_000).toISOString(),
    },
  ]);
  const beforeDeploy = await journal.replay();
  await assert.rejects(service.deploy(fresh.previewHash), /risk dispositions changed/);
  assert.deepEqual(await journal.replay(), beforeDeploy);
});

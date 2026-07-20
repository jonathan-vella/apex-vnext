import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import type { ImprovementPolicyV1 } from "@apex/contracts";
import { ImprovementStore } from "@apex/kernel";
import { execute } from "../cli.js";
import { ApexService } from "../service.js";
import { tempRoot, writeJson } from "./helpers.js";

const policy: ImprovementPolicyV1 = {
  schemaVersion: "1.0.0",
  allowedSources: ["validation-failure", "explicit-correction"],
  allowedCategories: ["correctness", "security", "documentation"],
  recurrence: { threshold: 3, windowDays: 30 },
  retention: { observationDays: 90, decisionDays: 365 },
  limits: { statementCharacters: 1024, evidenceRefs: 32, observations: 100 },
  proposalTargets: ["documentation", "validator", "backlog"],
  humanDecisionRequired: true,
  automatedIssueCreation: false,
  contextInjection: false,
};

test("trusted service stores bounded observations without changing run authority", async () => {
  const root = await tempRoot();
  const service = new ApexService(root, { improvementPolicy: policy });
  const initialized = await service.init({ projectId: "demo" });
  const before = await service.status();
  const observed = await service.improvementObserve({
    source: "validation-failure",
    category: "correctness",
    severity: "medium",
    statement: "Validation failed with password=not-a-real-secret",
    evidenceRefs: ["a".repeat(64)],
  });
  const after = await service.status();
  assert.equal(observed.observation.runId, initialized.runId);
  assert.equal(observed.observation.statement, "Validation failed with [REDACTED]");
  assert.equal(after.head, before.head);
  assert.equal(after.run.ownerEpoch, before.run.ownerEpoch);
  assert.deepEqual(await service.improvementProposals(), []);
});

test("CLI observation uses structured files and destructive improvement operations require confirmation", async () => {
  const root = await tempRoot();
  await execute(["init", "--project", "demo"], root);
  const input = join(root, "observation.json");
  await writeJson(input, {
    source: "explicit-correction",
    category: "documentation",
    severity: "low",
    statement: "The operations guide omitted a bounded behavior.",
    evidenceRefs: ["b".repeat(64)],
  });
  const result = (await execute(["quality", "observe", "--file", input], root)) as {
    observation: { observationId: string; inert?: unknown };
  };
  assert.match(result.observation.observationId, /^[0-9a-f]{64}$/);
  await assert.rejects(execute(["quality", "prune"], root), /requires --yes/);
  await assert.rejects(
    execute(["quality", "delete-observation", "--observation", result.observation.observationId], root),
    /requires --yes/,
  );
  const foreign = await new ImprovementStore(root, policy).observe({
    projectId: "other-project",
    runId: "run-1",
    source: "explicit-correction",
    category: "documentation",
    severity: "low",
    statement: "Another project has separate evidence.",
    evidenceRefs: ["c".repeat(64)],
  });
  await assert.rejects(
    execute(
      ["quality", "delete-observation", "--observation", foreign.observation.observationId, "--yes"],
      root,
    ),
    /Improvement observation not found/,
  );
  assert.deepEqual(
    await execute(["quality", "delete-observation", "--observation", result.observation.observationId, "--yes"], root),
    { deleted: result.observation.observationId },
  );
});

test("CLI records only confirmed immutable human proposal decisions", async () => {
  const root = await tempRoot();
  await execute(["init", "--project", "demo"], root);
  const store = new ImprovementStore(root, policy, () => new Date("2026-07-17T12:00:00.000Z"));
  for (const runId of ["run-1", "run-2", "run-3"]) {
    await store.observe({
      projectId: "demo",
      runId,
      source: "validation-failure",
      category: "documentation",
      severity: "low",
      statement: "The guide omitted a required boundary.",
      evidenceRefs: [Buffer.from(runId.padEnd(64, "0")).toString("hex").slice(0, 64)],
    });
  }
  const proposal = (await store.scan("demo")).proposals[0]!;
  const command = [
    "quality",
    "decide",
    "--proposal",
    proposal.proposalId,
    "--actor",
    "maintainer",
    "--decision",
    "rejected",
    "--rationale",
    "False positive after human review.",
  ];
  await assert.rejects(execute(command, root), /requires --yes/);
  const decision = (await execute([...command, "--yes"], root)) as { decision: string };
  assert.equal(decision.decision, "rejected");
  const proposals = (await execute(["quality", "proposals"], root)) as Array<{ status: string }>;
  assert.equal(proposals[0]?.status, "rejected");
  await assert.rejects(execute([...command, "--yes"], root), /already has/);
});

test("improvement operations reject runtime policy drift", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  assert.deepEqual(await service.improvementObservations(), []);
  const policyPath = join(root, ".apex", "runtime", "improvement-policy.v1.json");
  await writeJson(policyPath, { ...policy, recurrence: { threshold: 2, windowDays: 30 } });
  await assert.rejects(service.improvementObservations(), /Improvement policy lock is not current/);
});

test("CLI exposes no proposal application or autonomous repository operation", async () => {
  const root = await tempRoot();
  await execute(["init", "--project", "demo"], root);
  for (const command of [
    ["quality", "apply"],
    ["quality", "create-issue"],
    ["quality", "create-pull-request"],
    ["quality", "inject-context"],
  ]) {
    await assert.rejects(execute(command, root), /Unknown command/);
  }
});

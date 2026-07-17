import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import type { ImprovementPolicyV1 } from "@apex/contracts";
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
  assert.deepEqual(
    await execute(["quality", "delete-observation", "--observation", result.observation.observationId, "--yes"], root),
    { deleted: result.observation.observationId },
  );
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

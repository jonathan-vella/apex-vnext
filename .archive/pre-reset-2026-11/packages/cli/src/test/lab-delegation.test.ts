import assert from "node:assert/strict";
import { test } from "./test-shard.js";
import type { LabDelegationPolicyV1 } from "@apexops/contracts";
import { ApexService } from "../service.js";
import { execute } from "../cli.js";
import { connectMcp } from "./mcp-client.js";
import { modernMcpClient } from "./mcp-client.js";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { completeOutputs, nextTaskAfterInput, requirements, review, tempRoot } from "./helpers.js";
import { sha256Json } from "@apexops/kernel";

const clock = () => new Date("2026-10-31T12:00:00.000Z");
const scope = "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/lab";

async function fixture(fixtureClock = clock) {
  const root = await tempRoot();
  const service = new ApexService(root, { clock: fixtureClock });
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner", targetScope: scope });
  const task = await nextTaskAfterInput(service);
  if (task.status !== "task") throw new Error("Expected synthetic Requirements task");
  const value = requirements();
  const completed = await completeOutputs(service, task.task.taskId, [{ kind: "requirements", value }]);
  const reviewTask = await nextTaskAfterInput(service);
  if (reviewTask.status !== "task") throw new Error("Expected synthetic Requirements review");
  await completeOutputs(service, reviewTask.task.taskId, [
    {
      kind: "review-findings",
      value: review(runId, "requirements", completed.outputHashes.requirements!),
    },
  ]);
  const policy: LabDelegationPolicyV1 = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId,
    purpose: "lab",
    environment: "dev",
    track: "bicep",
    cloud: "AzureCloud",
    tenantId: "22222222-2222-2222-2222-222222222222",
    subscriptionId: "11111111-1111-1111-1111-111111111111",
    targetScope: scope,
    requirementsHash: sha256Json(value),
    resourceIds: [`${scope}/providers/Microsoft.Storage/storageAccounts/archive`],
    gates: [1, 4],
    operation: "apply",
    writerEpoch: 1,
    recipientIdentity: "local",
    expiresAt: new Date(fixtureClock().getTime() + 60 * 60 * 1000).toISOString(),
  };
  return { root, service, policy };
}

test("lab delegation records synthetic policy consent and exposes Gate 1 through the real MCP handler", async () => {
  const { root, service, policy } = await fixture();
  const receipt = await service.confirmLabDelegation(policy, async (hash) => {
    assert.equal(hash, sha256Json(policy));
    return { actor: "synthetic-human-fixture" };
  });
  assert.equal(receipt.consent.futurePreviewReviewed, false);
  assert.equal(receipt.revoked, false);
  assert.equal(receipt.policyHash, sha256Json(receipt.policy));
  assert.equal(receipt.consentHash, sha256Json(receipt.consent));
  const { client, close } = await connectMcp(service);
  try {
    const status = await client.callTool({ name: "status", arguments: { workspace: root } });
    assert.equal(
      (status.structuredContent as { delegation: { policyHash: string } }).delegation.policyHash,
      receipt.policyHash,
    );
    const tools = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(tools.includes("delegationConfirm"), false, "MCP cannot create human consent");
    const decision = await client.callTool({
      name: "gateDelegate",
      arguments: { workspace: root, gate: 1, policyHash: receipt.policyHash, consentHash: receipt.consentHash },
    });
    assert.equal(decision.isError, undefined, JSON.stringify(decision));
    const approval = decision.structuredContent as { mechanism: string; actor: string };
    assert.equal(approval.mechanism, "lab-delegation");
    assert.equal(approval.actor, "agent:local");
    assert.notEqual(approval.actor, receipt.consent.actor);
    assert.equal((await service.status()).satisfiedGates.includes(1), true);
  } finally {
    await close();
  }
});

test("lab delegation refuses absent consent, wrong receipts and revoked consent while preserving manual Gate 1", async () => {
  const { root, service, policy } = await fixture();
  await assert.rejects(
    service.decideDelegatedGate(1, { policyHash: sha256Json(policy), consentHash: "a".repeat(64) }),
    /No human lab delegation/u,
  );
  const receipt = await service.confirmLabDelegation(policy, async () => ({ actor: "synthetic-human-fixture" }));
  await assert.rejects(
    service.decideDelegatedGate(1, { policyHash: "a".repeat(64), consentHash: receipt.consentHash }),
    /does not match/u,
  );
  const decision = (await execute(
    ["gate", "delegated", "--gate", "1", "--policy", receipt.policyHash, "--consent", receipt.consentHash],
    root,
    { clock },
  )) as { mechanism: string };
  assert.equal(decision.mechanism, "lab-delegation");
  await service.revokeLabDelegation(receipt.policyHash);
  assert.equal((await service.status()).satisfiedGates.includes(1), false);
  await assert.rejects(service.decideDelegatedGate(1, receipt), /revoked/u);
  const manual = await service.decideGateNumber(1, "approved", "synthetic-manual-fixture");
  assert.equal(manual.mechanism, "tty");
  assert.equal(manual.actor, "synthetic-manual-fixture");
});

test("lab delegation requires real terminal confirmation and blocks piped consent without creating a receipt", async () => {
  const { root, service } = await fixture();
  for (const flags of [["--yes"], ["--actor", "agent"], ["--json"]]) {
    await assert.rejects(
      execute(["lab", "delegation-confirm", "--file", "missing-fixture.json", ...flags], root, { clock }),
      /interactive terminal/u,
    );
  }
  await assert.rejects(service.labDelegation(), /No human lab delegation/u);
});

test("lab delegation expires Gate 1 without turning it into an inherited human decision", async () => {
  const { root, service, policy } = await fixture();
  const receipt = await service.confirmLabDelegation(policy, async () => ({ actor: "synthetic-human-fixture" }));
  await service.decideDelegatedGate(1, receipt);
  const expired = new ApexService(root, { clock: () => new Date(policy.expiresAt) });
  assert.equal((await expired.status()).satisfiedGates.includes(1), false);
  await assert.rejects(expired.decideDelegatedGate(1, receipt), /expire/u);
  assert.equal((await expired.status()).run.gates[0]!.state, "open");
});

test(
  "packaged lab delegation MCP entry records Gate 1 without installing a plugin",
  {
    skip: process.env.APEX_LAB_PLUGIN_ENTRY === undefined,
  },
  async () => {
    const { root, service, policy } = await fixture(() => new Date());
    const receipt = await service.confirmLabDelegation(policy, async () => ({ actor: "synthetic-human-fixture" }));
    await service.releaseWriter();
    const client = modernMcpClient("packaged-lab-fixture");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [process.env.APEX_LAB_PLUGIN_ENTRY!],
      cwd: root,
      stderr: "pipe",
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    });
    try {
      await client.connect(transport);
      const decision = await client.callTool({
        name: "gateDelegate",
        arguments: { workspace: root, gate: 1, policyHash: receipt.policyHash, consentHash: receipt.consentHash },
      });
      assert.notEqual(decision.isError, true, JSON.stringify(decision));
      const approval = decision.structuredContent as { mechanism: string; actor: string };
      assert.equal(approval.mechanism, "lab-delegation");
      assert.equal(approval.actor, "agent:local");
      assert.equal((await service.status()).satisfiedGates.includes(1), true);
    } finally {
      await client.close();
      await transport.close();
    }
  },
);

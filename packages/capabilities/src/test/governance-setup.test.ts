import assert from "node:assert/strict";
import test from "node:test";
import { planGovernanceSetup } from "../governance-setup.js";
import type { GovernanceSetupConfigV1 } from "@apexops/contracts";

const config: GovernanceSetupConfigV1 = {
  schemaVersion: "1.0.0",
  repository: "Example/COE",
  tenantId: "11111111-1111-1111-1111-111111111111",
  subscriptionId: "22222222-2222-2222-2222-222222222222",
  identity: { mode: "create", displayName: "coe-discovery" },
};
const repository = { id: 456, name: "COE", full_name: "Example/COE", owner: { id: 123, login: "Example" } };

test("governance setup binds observed immutable subjects without authorizing execution", () => {
  const oidc = { use_default: true, use_immutable_subject: true, sub_claim_prefix: "repo:Example@123/COE@456" };
  const plan = planGovernanceSetup(config, repository, oidc);
  assert.equal(plan.federation?.subject, "repo:Example@123/COE@456:environment:governance");
  assert.equal(plan.status, "pending");
  assert.equal(plan.executionAuthorized, false);
  assert.equal(plan.deploymentAuthorized, false);
  assert.equal(plan.variables.GOVERNANCE_BASELINE_ENABLED, "false");
  assert.equal(plan.variables.AZURE_CLIENT_ID, undefined);
  assert.equal(plan.proposedRole.scope, `/subscriptions/${config.subscriptionId}`);
  assert.deepEqual(planGovernanceSetup(config, repository, oidc), plan);
  assert.notEqual(
    planGovernanceSetup({ ...config, managementGroupId: "platform" }, repository, oidc).planHash,
    plan.planHash,
  );
});

test("governance setup accepts explicit name-based evidence but blocks guesses and mismatches", () => {
  const nameBased = { use_default: true, use_immutable_subject: false, sub_claim_prefix: "repo:Example/COE" };
  assert.equal(
    planGovernanceSetup(config, repository, nameBased).federation?.subject,
    "repo:Example/COE:environment:governance",
  );
  for (const evidence of [
    { use_default: true },
    { ...nameBased, use_default: false },
    { ...nameBased, use_immutable_subject: true },
    { ...nameBased, sub_claim_prefix: "repo:Other/COE" },
    null,
  ]) {
    const result = planGovernanceSetup(config, repository, evidence);
    assert.equal(result.status, "blocked");
    assert.equal(result.federation, undefined);
  }
  assert.equal(planGovernanceSetup(config, { ...repository, id: 0 }, nameBased).status, "blocked");
  assert.throws(
    () => planGovernanceSetup({ ...config, repository: "evil/repo?token=x" }, repository, nameBased),
    /Invalid/,
  );
  const reused = planGovernanceSetup(
    { ...config, identity: { mode: "reuse", clientId: config.tenantId, principalId: config.subscriptionId } },
    repository,
    nameBased,
  );
  assert.equal(reused.variables.AZURE_CLIENT_ID, config.tenantId);
  assert.ok(reused.pendingActions.some((item) => item.includes("binding and existing grants")));
});

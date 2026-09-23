import assert from "node:assert/strict";
import test from "node:test";
import { planGovernanceSetup, planGovernanceProvision } from "../governance-setup.js";
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

test("governance provisioning requires verified identity, protected environment and exact Reader semantics", () => {
  const reused = {
    ...config,
    identity: { mode: "reuse" as const, clientId: config.tenantId, principalId: config.subscriptionId },
  };
  const setup = planGovernanceSetup(reused, repository, {
    use_default: true,
    use_immutable_subject: true,
    sub_claim_prefix: "repo:Example@123/COE@456",
  });
  const evidence = {
    account: { tenantId: config.tenantId, id: config.subscriptionId, state: "Enabled", environmentName: "AzureCloud" },
    application: {
      id: "33333333-3333-3333-3333-333333333333",
      appId: reused.identity.clientId,
      signInAudience: "AzureADMyOrg",
    },
    principal: {
      id: reused.identity.principalId,
      appId: reused.identity.clientId,
      appOwnerOrganizationId: config.tenantId,
      accountEnabled: true,
      servicePrincipalType: "Application",
    },
    environment: {
      name: "governance",
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      protection_rules: [
        { type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "Team", id: 1 }] },
      ],
    },
    readerRole: {
      name: setup.proposedRole.id,
      roleName: "Reader",
      roleType: "BuiltInRole",
      permissions: [{ actions: ["*/read"], notActions: [], dataActions: [], notDataActions: [] }],
    },
    federations: [] as unknown[],
    assignments: [] as unknown[],
  };
  const plan = planGovernanceProvision(setup, evidence);
  assert.equal(plan.status, "ready");
  assert.equal(plan.executionAuthorized, false);
  assert.deepEqual(plan.actions, ["create-federation", "assign-reader"]);
  const credential = {
    name: plan.federationName,
    issuer: setup.federation!.issuer,
    subject: setup.federation!.subject,
    audiences: [setup.federation!.audience],
  };
  const assignment = {
    principalId: reused.identity.principalId,
    scope: setup.proposedRole.scope,
    roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${setup.proposedRole.id}`,
  };
  const complete = planGovernanceProvision(setup, {
    ...evidence,
    federations: [credential],
    assignments: [assignment],
  });
  assert.equal(complete.status, "ready");
  assert.deepEqual(complete.actions, []);
  assert.equal(complete.contextHash, plan.contextHash);
  assert.notEqual(complete.planHash, plan.planHash);
  for (const changed of [
    { ...evidence, account: { ...evidence.account, tenantId: "foreign" } },
    { ...evidence, account: { ...evidence.account, environmentName: "AzureChinaCloud" } },
    { ...evidence, principal: { ...evidence.principal, appId: "foreign" } },
    { ...evidence, environment: { ...evidence.environment, protection_rules: [] } },
    { ...evidence, environment: { ...evidence.environment, deployment_branch_policy: null } },
    {
      ...evidence,
      readerRole: {
        ...evidence.readerRole,
        permissions: [{ actions: ["*"], notActions: [], dataActions: [], notDataActions: [] }],
      },
    },
    { ...evidence, federations: [{ ...credential, audiences: ["foreign"] }] },
    { ...evidence, assignments: [{ ...assignment, condition: "restricted" }] },
    {
      ...evidence,
      assignments: [
        { ...assignment, scope: "/providers/Microsoft.Management/managementGroups/parent", condition: "restricted" },
      ],
    },
    {
      ...evidence,
      assignments: [
        {
          ...assignment,
          roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
        },
      ],
    },
    {
      ...evidence,
      assignments: [
        assignment,
        {
          ...assignment,
          scope: "/providers/Microsoft.Management/managementGroups/parent",
          roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c",
        },
      ],
    },
    { ...evidence, assignments: [{ ...assignment, principalId: "foreign" }] },
    { ...evidence, assignments: [{}] },
    { ...evidence, federations: null },
    { ...evidence, assignments: null },
  ]) {
    const blocked = planGovernanceProvision(setup, changed);
    assert.equal(blocked.status, "blocked");
    assert.deepEqual(blocked.actions, []);
  }
});

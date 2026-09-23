import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { GovernanceSetupConfigV1 } from "@apexops/contracts";
import type { ProcessRequest } from "@apexops/capabilities";
import { ApexService } from "../service.js";
import { execute } from "../cli.js";
import { tempRoot } from "./helpers.js";

async function fixture() {
  const root = await tempRoot();
  const config: GovernanceSetupConfigV1 = {
    schemaVersion: "1.0.0",
    repository: "Example/COE",
    tenantId: "11111111-1111-1111-1111-111111111111",
    subscriptionId: "22222222-2222-2222-2222-222222222222",
    identity: {
      mode: "reuse",
      clientId: "33333333-3333-3333-3333-333333333333",
      principalId: "44444444-4444-4444-4444-444444444444",
    },
  };
  const identity = config.identity as Extract<GovernanceSetupConfigV1["identity"], { mode: "reuse" }>;
  const appId = "55555555-5555-5555-5555-555555555555";
  const roleId = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
  const state = {
    federations: [] as unknown[],
    assignments: [] as unknown[],
    protections: true,
    failAssignment: false,
    wrongTenant: false,
    loseProtectionAfterFederation: false,
    hideFederationAfterWrite: false,
  };
  const calls: ProcessRequest[] = [];
  const processRunner = {
    run: async (request: ProcessRequest) => {
      calls.push(request);
      const args = request.args;
      let value: unknown;
      if (request.executable === "gh") {
        assert.deepEqual(args.slice(0, 5), ["api", "--hostname", "github.com", "--method", "GET"]);
        if (args[5] === "repos/Example/COE")
          value = { id: 456, full_name: "Example/COE", name: "COE", owner: { id: 123, login: "Example" } };
        else if (args[5] === "repos/Example/COE/actions/oidc/customization/sub")
          value = { use_default: true, use_immutable_subject: true, sub_claim_prefix: "repo:Example@123/COE@456" };
        else if (args[5] === "repos/Example/COE/environments/governance")
          value = {
            name: "governance",
            deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
            protection_rules: state.protections
              ? [{ type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "Team", id: 1 }] }]
              : [],
          };
        else throw new Error("Unexpected GitHub read");
      } else {
        assert.equal(request.executable, "az");
        const command = args.slice(0, 3).join(" ");
        if (args[0] === "account")
          value = {
            id: config.subscriptionId,
            tenantId: state.wrongTenant ? "foreign" : config.tenantId,
            state: "Enabled",
            environmentName: "AzureCloud",
          };
        else if (command === "ad app show")
          value = { id: appId, appId: identity.clientId, signInAudience: "AzureADMyOrg" };
        else if (command === "ad sp show")
          value = {
            id: identity.principalId,
            appId: identity.clientId,
            appOwnerOrganizationId: config.tenantId,
            accountEnabled: true,
            servicePrincipalType: "Application",
          };
        else if (command === "role definition list")
          value = [
            {
              name: roleId,
              roleName: "Reader",
              roleType: "BuiltInRole",
              permissions: [{ actions: ["*/read"], notActions: [], dataActions: [], notDataActions: [] }],
            },
          ];
        else if (command === "ad app federated-credential" && args[3] === "list") value = state.federations;
        else if (command === "role assignment list") {
          assert.ok(args.includes("--include-inherited"));
          value = state.assignments;
        } else if (command === "ad app federated-credential" && args[3] === "create") {
          assert.equal(args[args.indexOf("--id") + 1], appId);
          const credential = JSON.parse(await readFile(args[args.indexOf("--parameters") + 1]!, "utf8"));
          assert.equal(credential.subject, "repo:Example@123/COE@456:environment:governance");
          assert.deepEqual(credential.audiences, ["api://AzureADTokenExchange"]);
          if (!state.hideFederationAfterWrite) state.federations.push(credential);
          if (state.loseProtectionAfterFederation) state.protections = false;
          value = null;
        } else if (command === "role assignment create") {
          assert.equal(args[args.indexOf("--assignee-object-id") + 1], identity.principalId);
          assert.equal(args[args.indexOf("--role") + 1], roleId);
          assert.equal(args[args.indexOf("--scope") + 1], `/subscriptions/${config.subscriptionId}`);
          assert.equal(args[args.indexOf("--subscription") + 1], config.subscriptionId);
          state.assignments.push({
            principalId: identity.principalId,
            roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
            scope: `/subscriptions/${config.subscriptionId}`,
          });
          if (state.failAssignment) throw new Error("private command failure with unknown outcome");
          value = null;
        } else throw new Error(`Unexpected Azure operation ${command}`);
      }
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        outputTruncated: false,
        stdout: JSON.stringify(value),
        stderr: "",
      };
    },
  };
  return { root, config, state, calls, service: new ApexService(root, { processRunner }), processRunner };
}

test("confirmed governance provisioning creates only missing exact trust and Reader access", async () => {
  const { root, config, service, calls, processRunner } = await fixture();
  const plan = await service.planGovernanceProvision(config);
  assert.equal(plan.status, "ready");
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(service.provisionGovernance(config, plan.planHash, false), /explicit confirmation/);
  await assert.rejects(service.provisionGovernance(config, "f".repeat(64), true), /changed/);
  assert.equal(calls.filter(({ args }) => args.includes("create")).length, 0);
  await assert.rejects(
    execute(["bootstrap", "governance-provision", "--file", "missing.json"], root, { processRunner }),
    /--yes/,
  );
  const result = await service.provisionGovernance(config, plan.planHash, true);
  assert.equal(result.status, "configured");
  assert.deepEqual(
    result.actions.map(({ status }) => status),
    ["verified", "verified"],
  );
  assert.equal(result.collectionEnabled, false);
  assert.equal(result.deploymentAuthorized, false);
  assert.deepEqual(JSON.parse(await readFile(join(root, result.receiptPath), "utf8")).actions, result.actions);
  assert.ok((await readdir(root)).every((name) => name.endsWith(".json") && !name.includes("federation")));
  const again = await service.planGovernanceProvision(config);
  assert.deepEqual(again.actions, []);
  await service.provisionGovernance(config, again.planHash, true);
  assert.equal(calls.filter(({ args }) => args.includes("create")).length, 2);
});

test("governance provisioning refuses inherited Owner access without writing files or remote state", async () => {
  const { root, config, service, state, calls } = await fixture();
  assert.equal(config.identity.mode, "reuse");
  if (config.identity.mode !== "reuse") throw new Error("Expected existing identity");
  state.assignments.push({
    principalId: config.identity.principalId,
    scope: "/providers/Microsoft.Management/managementGroups/platform",
    roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
  });
  const plan = await service.planGovernanceProvision(config);
  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.actions, []);
  assert.ok(plan.blockers.some((message) => message.includes("not exclusively unconditional Reader")));
  await assert.rejects(service.provisionGovernance(config, plan.planHash, true), /prerequisites are blocked/);
  assert.equal(calls.filter(({ args }) => args.includes("create")).length, 0);
  assert.deepEqual(await readdir(root), []);
});

test("governance provisioning preserves partial remote results and requires a new plan after uncertainty", async () => {
  const { root, config, service, state, calls } = await fixture();
  const plan = await service.planGovernanceProvision(config);
  state.failAssignment = true;
  const result = await service.provisionGovernance(config, plan.planHash, true);
  assert.equal(result.status, "blocked");
  assert.deepEqual(
    result.actions.map(({ status }) => status),
    ["verified", "indeterminate"],
  );
  assert.doesNotMatch(JSON.stringify(result), /private command failure/);
  assert.equal(state.federations.length, 1);
  assert.equal(state.assignments.length, 1);
  await assert.rejects(service.provisionGovernance(config, plan.planHash, true), /changed/);
  assert.equal(calls.filter(({ args }) => args.includes("create")).length, 2);
  assert.equal(
    (await readdir(root)).some((name) => name.endsWith(".lock")),
    false,
  );
});

test("governance provisioning refuses changed protections, wrong tenants and concurrent setup", async () => {
  const { root, config, service, state, calls } = await fixture();
  const plan = await service.planGovernanceProvision(config);
  state.protections = false;
  await assert.rejects(service.provisionGovernance(config, plan.planHash, true), /changed/);
  state.protections = true;
  state.wrongTenant = true;
  assert.equal((await service.planGovernanceProvision(config)).status, "blocked");
  state.wrongTenant = false;
  await writeFile(join(root, ".apex-governance-setup.lock"), "other attempt");
  await assert.rejects(service.provisionGovernance(config, plan.planHash, true), /lock exists/);
  assert.equal(await readFile(join(root, ".apex-governance-setup.lock"), "utf8"), "other attempt");
  assert.equal(calls.filter(({ args }) => args.includes("create")).length, 0);
});

test("governance provisioning stops after missing read-back or changed environment protection", async () => {
  for (const option of ["loseProtectionAfterFederation", "hideFederationAfterWrite"] as const) {
    const { config, service, state, calls } = await fixture();
    const plan = await service.planGovernanceProvision(config);
    state[option] = true;
    const result = await service.provisionGovernance(config, plan.planHash, true);
    assert.equal(result.status, "blocked");
    assert.deepEqual(
      result.actions.map(({ status }) => status),
      ["indeterminate"],
    );
    assert.equal(calls.filter(({ args }) => args.slice(0, 3).join(" ") === "role assignment create").length, 0);
  }
});

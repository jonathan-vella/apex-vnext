import assert from "node:assert/strict";
import test from "node:test";
import { AzureCliReadAdapter, BicepCommandAdapter, TerraformCommandAdapter } from "../command-plans.js";
import { CapabilityPackLoader } from "../packs.js";

test("optional absent capability packs are reported without import", async () => {
  let resolutions = 0;
  const loader = new CapabilityPackLoader({
    async resolvePackageJson() {
      resolutions += 1;
      return undefined;
    },
  });
  const status = await loader.check({ packageName: "@apexops/optional-azure", version: "1.2.3", optional: true });
  assert.equal(resolutions, 1);
  assert.equal(status.available, false);
  assert.equal(status.compatible, false);
  assert.match(status.actionableMessage, /install version 1\.2\.3/);
});

test("Bicep validation and Azure read adapters generate safe argv arrays", () => {
  const bicep = new BicepCommandAdapter();
  assert.deepEqual(bicep.validate("infra/main.bicep"), {
    executable: "bicep",
    args: ["build", "infra/main.bicep"],
  });
  for (const method of ["preview", "apply", "stackApply", "stackDestroy", "stackList"])
    assert.equal(Reflect.has(bicep, method), false, `${method} must not exist; azd is the only Bicep executor`);

  const azure = new AzureCliReadAdapter();
  assert.deepEqual(azure.resourceGraph("Resources | take 1").args.slice(0, 3), ["graph", "query", "--graph-query"]);
  assert.deepEqual(azure.armGet("/subscriptions/sub/resourceGroups/rg", "2025-01-01").args.slice(0, 4), [
    "rest",
    "--method",
    "get",
    "--url",
  ]);
  assert.deepEqual(azure.taggedResourceGroups("sub; echo unsafe", "lab").args, [
    "group",
    "list",
    "--subscription",
    "sub; echo unsafe",
    "--tag",
    "azd-env-name=lab",
    "--output",
    "json",
  ]);
  assert.deepEqual(azure.resourceGroupResources("sub", "rg").args, [
    "resource",
    "list",
    "--subscription",
    "sub",
    "--resource-group",
    "rg",
    "--output",
    "json",
  ]);
  assert.deepEqual(azure.account().args, ["account", "show", "--output", "json"]);
});

test("Terraform requires and applies an exact saved plan", () => {
  const terraform = new TerraformCommandAdapter();
  assert.deepEqual(terraform.providerSchemas("/iac"), {
    executable: "terraform",
    args: ["providers", "schema", "-json"],
    cwd: "/iac",
  });
  assert.deepEqual(terraform.versionJson("/iac"), {
    executable: "terraform",
    args: ["version", "-json"],
    cwd: "/iac",
  });
  assert.deepEqual(terraform.preview("/iac", ".apex/local/run.tfplan").args, [
    "plan",
    "-out=.apex/local/run.tfplan",
    "-input=false",
  ]);
  assert.deepEqual(terraform.applyExact("/iac", ".apex/local/run.tfplan").args, [
    "apply",
    "-input=false",
    ".apex/local/run.tfplan",
  ]);
  assert.throws(() => terraform.applyExact("/iac", ""), /saved Terraform plan path/);
  assert.equal(typeof terraform.applyExact, "function");
  assert.equal(Reflect.has(terraform, "apply"), false);
  assert.equal(Reflect.has(terraform, "applyImplicit"), false);
});

test("native Terraform command plans use exact noninteractive argv", () => {
  const terraform = new TerraformCommandAdapter();
  assert.deepEqual(terraform.init("/iac", false).args, ["init", "-backend=false", "-input=false"]);
  assert.deepEqual(terraform.init("/iac", true).args, ["init", "-backend=true", "-input=false"]);
  assert.deepEqual(terraform.preview("/iac", "/plans/destroy.tfplan", true).args, [
    "plan",
    "-destroy",
    "-out=/plans/destroy.tfplan",
    "-input=false",
  ]);
  assert.deepEqual(terraform.showJson("/iac", "/plans/apply.tfplan").args, ["show", "-json", "/plans/apply.tfplan"]);
});

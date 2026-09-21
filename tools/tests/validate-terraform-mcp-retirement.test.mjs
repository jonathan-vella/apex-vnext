import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTerraformMcpRetirementInputs,
  findTerraformMcpRetirementErrors,
} from "../scripts/validate-terraform-mcp-retirement.mjs";

test("accepts current source without requiring historical evidence", () => {
  assert.deepEqual(findTerraformMcpRetirementErrors(collectTerraformMcpRetirementInputs()), []);
});

test("rejects every retired marker under renamed active files", () => {
  for (const marker of [
    "terraform-mcp-server",
    "hashicorp/terraform-mcp-server",
    "/go/bin/terraform-mcp-server",
    "mcp_terraform_search_providers",
    "mcp-terraform",
    "terraform/search_modules",
    "terraform/get_module_details",
    "terraform/get_latest_module_version",
    "ghcr.io/devcontainers/features/go:1",
  ]) {
    const inputs = collectTerraformMcpRetirementInputs();
    inputs.activeFiles["tools/scripts/renamed-owner.mjs"] = marker;
    assert.ok(
      findTerraformMcpRetirementErrors(inputs).some((error) => error.includes("retired marker remains active")),
    );
  }
});

test("collector covers current schemas, config, package sources and read failures", () => {
  const inputs = collectTerraformMcpRetirementInputs();
  for (const path of [
    "tools/schemas/iac-contract.schema.json",
    "config/workflow.v1.json",
    "packages/capabilities/src/terraform-registry-client.ts",
  ]) {
    assert.ok(path in inputs.activeFiles);
  }
  assert.throws(
    () =>
      collectTerraformMcpRetirementInputs(() => {
        throw new Error("unreadable");
      }),
    /unreadable/u,
  );
});

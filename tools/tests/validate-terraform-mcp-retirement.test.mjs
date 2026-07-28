import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectTerraformMcpRetirementInputs,
  findTerraformMcpRetirementErrors,
} from "../scripts/validate-terraform-mcp-retirement.mjs";

function validInputs() {
  return collectTerraformMcpRetirementInputs();
}

test("accepts intact archived evidence and retired active surfaces", () => {
  assert.deepEqual(findTerraformMcpRetirementErrors(validInputs()), []);
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
    const inputs = validInputs();
    inputs.activeFiles["tools/scripts/renamed-owner.mjs"] = marker;
    assert.equal(
      findTerraformMcpRetirementErrors(inputs).includes(
        `tools/scripts/renamed-owner.mjs: retired marker remains active: ${
          marker.startsWith("mcp_terraform_") ? "mcp_terraform_" : marker
        }`,
      ),
      true,
    );
  }
});

test("rejects missing, modified, or incompletely documented archive evidence", () => {
  const missing = validInputs();
  delete missing.archivedFiles["tools/registry/terraform-mcp-characterization.json"];
  assert.match(findTerraformMcpRetirementErrors(missing).join("\n"), /archived evidence is missing/u);

  const modified = validInputs();
  modified.archivedFiles["tools/scripts/validate-terraform-mcp-characterization.mjs"] = Buffer.from("modified");
  assert.match(findTerraformMcpRetirementErrors(modified).join("\n"), /archived evidence hash mismatch/u);

  const incomplete = validInputs();
  [incomplete.provenance.introducedBy, incomplete.provenance.archivedFrom] = [
    incomplete.provenance.archivedFrom,
    incomplete.provenance.introducedBy,
  ];
  assert.match(findTerraformMcpRetirementErrors(incomplete).join("\n"), /exact retirement contract/u);

  const tokenOnly = validInputs();
  tokenOnly.provenance = {
    tokens: JSON.stringify(tokenOnly.provenance),
  };
  assert.match(findTerraformMcpRetirementErrors(tokenOnly).join("\n"), /exact retirement contract/u);
});

test("collector covers active schemas, config, and package sources", () => {
  const inputs = validInputs();
  assert.equal("tools/schemas/iac-contract.schema.json" in inputs.activeFiles, true);
  assert.equal("config/workflow.v1.json" in inputs.activeFiles, true);
  assert.equal("packages/capabilities/src/terraform-registry-client.ts" in inputs.activeFiles, true);
});

test("archive bytes remain available only through inert paths", () => {
  const archived = readFileSync(
    ".archive/retired-automation/terraform-mcp/tools/registry/terraform-mcp-characterization.json",
    "utf8",
  );
  assert.match(archived, /"provenanceStatus": "observed-source-attributed-unpinned-acquisition"/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateTerraformMcpCharacterization } from "../scripts/validate-terraform-mcp-characterization.mjs";

const characterization = JSON.parse(
  readFileSync(new URL("../registry/terraform-mcp-characterization.json", import.meta.url), "utf8"),
);
const schema = JSON.parse(
  readFileSync(new URL("../registry/schemas/terraform-mcp-characterization.schema.json", import.meta.url), "utf8"),
);
const toolsFixture = JSON.parse(
  readFileSync(new URL("../registry/terraform-mcp-tools-list.fixture.json", import.meta.url), "utf8"),
);

function validate(value = characterization, fixture) {
  const fixturePath = value.toolsFixture.path;
  return validateTerraformMcpCharacterization({
    characterization: value,
    schema,
    read: (path, encoding) =>
      path === fixturePath && fixture !== undefined
        ? Buffer.from(JSON.stringify(fixture))
        : readFileSync(path, encoding),
  });
}

test("accepts the registry-only Terraform MCP characterization", () => {
  assert.deepEqual(validate(), []);
});

test("rejects tool drift and lifecycle authority escalation", () => {
  const invalid = structuredClone(characterization);
  invalid.tools[0].name = "terraform_apply";
  invalid.lifecycleAuthority.deniedToMcp = ["plan"];
  const errors = validate(invalid);
  assert.ok(errors.some((error) => error.includes("derive from the tracked full input schemas")));
  assert.ok(errors.some((error) => error.includes("lifecycle denial")));
});

test("rejects full input-schema substitution and incomplete consumers", () => {
  const invalid = structuredClone(characterization);
  invalid.consumers.pop();
  const fixture = structuredClone(toolsFixture);
  fixture[0].inputSchema.properties.module_name.type = "number";
  const errors = validate(invalid, fixture);
  assert.ok(errors.some((error) => error.includes("tools fixture SHA-256")));
  assert.ok(errors.some((error) => error.includes("complete active Terraform MCP inventory")));
  assert.ok(validate(characterization, []).some((error) => error.includes("tools fixture SHA-256")));
});

test("rejects stale config hashes and missing consumer markers", () => {
  const invalid = structuredClone(characterization);
  invalid.workspaceConfig.sha256 = "f".repeat(64);
  invalid.consumers[0].marker = "missing-marker";
  const errors = validate(invalid);
  assert.ok(errors.some((error) => error.includes("config SHA-256")));
  assert.ok(errors.some((error) => error.includes("consumer marker")));
});

test("rejects substituted binary provenance", () => {
  const invalid = structuredClone(characterization);
  invalid.runtime.commit = "f".repeat(40);
  invalid.runtime.binarySha256 = "e".repeat(64);
  const errors = validate(invalid);
  assert.ok(errors.some((error) => error.includes("schema /runtime/commit")));
  assert.ok(errors.some((error) => error.includes("schema /runtime/binarySha256")));
});

test("rejects substituted replacement ownership and removal gates", () => {
  const invalid = structuredClone(characterization);
  invalid.replacementOwners = [{ capability: "placeholder", owner: "placeholder" }];
  invalid.removalGate = "placeholder";
  const errors = validate(invalid);
  assert.ok(errors.some((error) => error.includes("approved Registry/native ownership map")));
  assert.ok(errors.some((error) => error.includes("lifecycle parity requirements")));
});
